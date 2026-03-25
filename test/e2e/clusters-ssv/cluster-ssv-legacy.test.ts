import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  getCurrentClusterState,
  parseClusterFromEvent,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEFAULT_ETH_REGISTER_VALUE,
  DEDUCTED_DIGITS,
  EMPTY_CLUSTER,
  TOKEN_REGISTER_AMOUNT,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { mineBlocks } from "../../helpers/index.ts";
import { makeOperatorKey } from "../../helpers/index.ts";
import { ethers } from "ethers";

// ---------------------------------------------------------------------------
//  Diamond storage readers for cluster hash verification
// ---------------------------------------------------------------------------
function mainStorageBaseSlot(): bigint {
  return BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.main"))) - 1n;
}

async function readETHClusterHash(
  provider: any,
  contractAddress: string,
  clusterKey: string,
): Promise<bigint> {
  const baseSlot = mainStorageBaseSlot() + 10n;
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const storageSlot = ethers.keccak256(
    coder.encode(["bytes32", "uint256"], [clusterKey, baseSlot]),
  );
  const raw = await provider.getStorage(contractAddress, storageSlot);
  return BigInt(raw);
}

async function readSSVClusterHash(
  provider: any,
  contractAddress: string,
  clusterKey: string,
): Promise<bigint> {
  const baseSlot = mainStorageBaseSlot() + 1n;
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const storageSlot = ethers.keccak256(
    coder.encode(["bytes32", "uint256"], [clusterKey, baseSlot]),
  );
  const raw = await provider.getStorage(contractAddress, storageSlot);
  return BigInt(raw);
}

function computeClusterKey(ownerAddress: string, operatorIds: number[]): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["address", "uint64[]"],
      [ownerAddress, operatorIds.map(BigInt)],
    ),
  );
}

const OP_SSV_FEE_UNPACKED = 10_000_000_000n;

describe("SSV Cluster Legacy Operations", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner] } = await setupTestContext());
  });

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

    const ssvAmount = TOKEN_REGISTER_AMOUNT * 2n;
    await ssvToken.mint(clusterOwner.address, ssvAmount);
    await ssvToken.connect(clusterOwner).approve(
      await legacyNetwork.getAddress(), ssvAmount,
    );

    await legacyNetwork.connect(clusterOwner).registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
    );
    const cluster = await getCurrentClusterState(
      connection, legacyNetwork, clusterOwner.address, operatorIds,
    );

    const { newNetwork, newViews } = await upgradeToStakingVersion(
      connection, legacyNetwork, legacyViews,
    );

    return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
  };

  describe("SSV Cluster Self-Liquidation", () => {
    it("Self-liquidation returns correct SSV balance after fee deduction", async function () {
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);

      const expectedBalance = await views.getBalanceSSV(
        clusterOwner.address, operatorIds, cluster,
      );
      const burnRate = await views.getBurnRateSSV(
        clusterOwner.address, operatorIds, cluster,
      );

      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);

      const liqTx = await network.connect(clusterOwner).liquidateSSV(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();
      await expect(liqTx).to.emit(network, Events.CLUSTER_LIQUIDATED);

      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const ssvRefund = ownerSSVAfter - ownerSSVBefore;

      const expectedRefund = expectedBalance - burnRate;
      expect(ssvRefund).to.equal(expectedRefund);
      expect(ssvRefund).to.be.greaterThan(0n);
      expect(ssvRefund).to.be.lessThan(TOKEN_REGISTER_AMOUNT);

      const totalFeesDeducted = TOKEN_REGISTER_AMOUNT - ssvRefund;
      expect(totalFeesDeducted % DEDUCTED_DIGITS).to.equal(0n);

      const clusterAfter = parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(clusterAfter.active).to.equal(false);
      expect(clusterAfter.balance).to.equal(0n);

      for (const opId of operatorIds) {
        const opSSV = await views.getOperatorByIdSSV(opId);
        expect(opSSV.validatorCount).to.equal(0);
      }
    });

    it("SSV cluster with near-zero balance — self-liquidation returns 0 SSV (edge)", async function () {
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 300_000_000);

      const balanceBefore = await views.getBalanceSSV(
        clusterOwner.address, operatorIds, cluster,
      );
      expect(balanceBefore).to.equal(0n);

      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);

      await network.connect(clusterOwner).liquidateSSV(
        clusterOwner.address, operatorIds, cluster,
      );

      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(0n);
    });

    it("Already liquidated SSV cluster reverts (edge)", async function () {
      const { network, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);

      await network.connect(clusterOwner).liquidateSSV(
        clusterOwner.address, operatorIds, cluster,
      );

      const liquidatedCluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, operatorIds,
      );
      expect(liquidatedCluster.active).to.equal(false);

      await expect(
        network.connect(clusterOwner).liquidateSSV(
          clusterOwner.address, operatorIds, liquidatedCluster,
        ),
      ).to.be.revertedWithCustomError(network, Errors.CLUSTER_IS_LIQUIDATED);
    });
  });

  describe("SSV Blocked Operations", () => {
    it("ETH operations revert with IncorrectClusterVersion on SSV cluster", async function () {
      const { network, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);

      await expect(
        network.connect(clusterOwner).registerValidator(
          makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);

      const deposit = ethers.parseEther("1");
      await expect(
        network.connect(clusterOwner).deposit(
          clusterOwner.address, operatorIds, cluster, { value: deposit },
        ),
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);

      await expect(
        network.connect(clusterOwner).reactivate(
          operatorIds, cluster, { value: deposit },
        ),
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);

      await expect(
        network.connect(clusterOwner).withdraw(operatorIds, deposit, cluster),
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);

      await expect(
        network.connect(clusterOwner).liquidate(
          clusterOwner.address, operatorIds, cluster,
        ),
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);

      // removeValidator is allowed on SSV clusters (BUG-12 fix)
      const removeTx = await network.connect(clusterOwner).removeValidator(makePublicKey(1), operatorIds, cluster);
      const removeReceipt = await removeTx.wait();
      const clusterAfterRemove = parseClusterFromEvent(network, removeReceipt, Events.VALIDATOR_REMOVED);
      expect(clusterAfterRemove.validatorCount).to.equal(0n);
      expect(clusterAfterRemove.active).to.equal(true);

      await expect(
        network.connect(clusterOwner).liquidateSSV(clusterOwner.address, operatorIds, clusterAfterRemove),
      ).to.emit(network, Events.CLUSTER_LIQUIDATED);
    });

    it("migrateClusterToETH succeeds on SSV cluster", async function () {
      const { network, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);

      await expect(
        network.connect(clusterOwner).migrateClusterToETH(
          operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      // INV-031: After migration, s.ethClusters[key] != 0 and s.clusters[key] == 0
      const provider = connection.ethers.provider;
      const contractAddress = await network.getAddress();
      const clusterKey = computeClusterKey(clusterOwner.address, operatorIds);
      const ethClusterHash = await readETHClusterHash(provider, contractAddress, clusterKey);
      const ssvClusterHash = await readSSVClusterHash(provider, contractAddress, clusterKey);
      expect(ethClusterHash).to.not.equal(0n, "INV-031: ethClusters[key] != 0 after migration");
      expect(ssvClusterHash).to.equal(0n, "INV-031: clusters[key] == 0 after migration (SSV cluster cleared)");
    });
  });
});
