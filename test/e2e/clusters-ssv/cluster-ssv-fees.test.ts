import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  getCurrentClusterState,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEDUCTED_DIGITS,
  EMPTY_CLUSTER,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  getBlockNumber,
} from "../../helpers/index.ts";
import {
  setupOracles,
  commitEBRoot,
  computeClusterId,
  computeEBRoot,
} from "../../helpers/index.ts";
import { makeOperatorKey } from "../../helpers/index.ts";
import { ethers } from "ethers";

const OP_SSV_FEE_RAW = 2_000n;
const OP_SSV_FEE_UNPACKED = OP_SSV_FEE_RAW * DEDUCTED_DIGITS;
const NETWORK_FEE_SSV_RAW = 1_000n;
const NETWORK_FEE_SSV_UNPACKED = NETWORK_FEE_SSV_RAW * DEDUCTED_DIGITS;

describe("CM-17 & CM-25: SSV Cluster Fee Mechanics", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;
  let staker: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, oracle1, oracle2, oracle3, oracle4, staker] } = await setupTestContext());
  });

  describe("SSV Fee Accrual — Verify Exact SSV Deduction Over N Blocks", () => {
    const deployFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      await legacyNetwork.updateNetworkFee(NETWORK_FEE_SSV_UNPACKED);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        operatorIds.push(Number(expectedId));
      }

      const ssvBalance = ethers.parseEther("900");
      await ssvToken.mint(clusterOwner.address, ssvBalance);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvBalance,
      );

      const perValidatorDeposit = ssvBalance / 3n;

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, perValidatorDeposit, EMPTY_CLUSTER,
      );
      let cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, perValidatorDeposit, cluster,
      );
      cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(3), operatorIds, DEFAULT_SHARES, perValidatorDeposit, cluster,
      );
      cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      expect(BigInt(cluster.validatorCount)).to.equal(3n);

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster, ssvBalance };
    };

    it("Verifies exact SSV fee deduction after 500 blocks with 3 validators", async function () {
      const { network, views, ssvToken, operatorIds, cluster, ssvBalance } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 500);

      const balanceBefore = await views.getBalanceSSV(
        clusterOwner.address, operatorIds, cluster,
      );
      const burnRate = await views.getBurnRateSSV(
        clusterOwner.address, operatorIds, cluster,
      );
      expect(balanceBefore).to.be.greaterThan(0n);

      const ownerBalanceBefore = await ssvToken.balanceOf(clusterOwner.address);

      const tx = await network.connect(clusterOwner).liquidateSSV(
        clusterOwner.address, operatorIds, cluster,
      );
      await tx.wait();
      await expect(tx).to.emit(network, Events.CLUSTER_LIQUIDATED);

      const ownerBalanceAfter = await ssvToken.balanceOf(clusterOwner.address);
      const ssvRefund = ownerBalanceAfter - ownerBalanceBefore;

      const expectedRefund = balanceBefore - burnRate;
      expect(ssvRefund).to.equal(expectedRefund);

      const totalFeesDeducted = ssvBalance - ssvRefund;
      expect(totalFeesDeducted).to.be.greaterThan(0n);
      expect(ssvRefund).to.be.lessThan(ssvBalance);

      expect(totalFeesDeducted % DEDUCTED_DIGITS).to.equal(0n);

      const packedFees = totalFeesDeducted / DEDUCTED_DIGITS;
      expect(packedFees).to.be.greaterThan(0n);
    });
  });

  describe("updateClusterBalance on SSV Cluster — EB Snapshot Only", () => {
    const deployFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        operatorIds.push(Number(expectedId));
      }

      const ssvBalance = ethers.parseEther("100");
      await ssvToken.mint(clusterOwner.address, ssvBalance);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvBalance,
      );

      const halfDeposit = ssvBalance / 2n;
      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, halfDeposit, EMPTY_CLUSTER,
      );
      let cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, halfDeposit, cluster,
      );
      cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(2n);

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      await setupOracles(newNetwork, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster, ssvBalance };
    };

    it("Only updates EB snapshot on SSV cluster, no fee settlement", async function () {
      const { network, views, operatorIds, cluster, ssvBalance } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);

      const balanceBefore = await views.getBalanceSSV(
        clusterOwner.address, operatorIds, cluster,
      );

      const effectiveBalance = 64;
      const root = computeEBRoot(clusterId, effectiveBalance);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);

      await mineBlocks(provider, 10);

      const tx = await network.connect(clusterOwner).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster,
        effectiveBalance, [],
      );
      await tx.wait();

      await expect(tx).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);

      const updatedCluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, operatorIds,
      );
      const eb = await views.getEffectiveBalance(
        clusterOwner.address, operatorIds, updatedCluster,
      );
      expect(eb).to.equal(effectiveBalance);

      const balanceAfter = await views.getBalanceSSV(
        clusterOwner.address, operatorIds, updatedCluster,
      );

      expect(balanceAfter).to.be.greaterThan(0n);
      expect(balanceAfter).to.be.lessThan(balanceBefore);
    });
  });
});
