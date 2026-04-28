import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  getCurrentClusterState,
  extractEventArgs,
  parseClusterFromEvent,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEFAULT_ETH_REGISTER_VALUE,
  EMPTY_CLUSTER,
  TOKEN_REGISTER_AMOUNT,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
} from "../../helpers/index.ts";
import { makeOperatorKey } from "../../helpers/index.ts";
import { ethers } from "ethers";

const OP_SSV_FEE_UNPACKED = 10_000_000_000n;

describe("Migration SSV → ETH", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner] } = await setupTestContext());
  });

  describe("Basic Migration With SSV Refund", () => {
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

      const ssvDeposit = TOKEN_REGISTER_AMOUNT;
      await ssvToken.mint(clusterOwner.address, ssvDeposit * 2n);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvDeposit * 2n,
      );

      const halfDeposit = ssvDeposit;
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

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
    };

    it("Migrates SSV cluster to ETH with correct SSV refund and ETH deposit", async function () {
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 100);

      const ssvBalanceBefore = await views.getBalanceSSV(
        clusterOwner.address, operatorIds, cluster,
      );
      const burnRate = await views.getBurnRateSSV(
        clusterOwner.address, operatorIds, cluster,
      );

      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt = await migrateTx.wait();
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      const eventArgs = extractEventArgs(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(eventArgs.ethDeposited).to.equal(DEFAULT_ETH_REGISTER_VALUE);

      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const ssvRefund = ownerSSVAfter - ownerSSVBefore;
      expect(ssvRefund).to.equal(eventArgs.ssvRefunded);

      const expectedRefund = ssvBalanceBefore - burnRate;
      expect(ssvRefund).to.equal(expectedRefund);

      const clusterAfter = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfter.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(clusterAfter.active).to.equal(true);
      expect(clusterAfter.validatorCount).to.equal(2n);
      expect(clusterAfter.index).to.equal(0n);

      for (const opId of operatorIds) {
        const opSSV = await views.getOperatorByIdSSV(opId);
        expect(opSSV.validatorCount).to.equal(0);
        const opETH = await views.getOperatorById(opId);
        expect(opETH.validatorCount).to.equal(2);
      }

      expect(await views.getNetworkValidatorsCount()).to.equal(2);

      await expect(migrateTx).to.not.emit(network, Events.CLUSTER_REACTIVATED);
    });

    it("Migration with insufficient ETH reverts (edge)", async function () {
      const { network, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);

      await expect(
        network.connect(clusterOwner).migrateClusterToETH(
          operatorIds, cluster, { value: 0n },
        ),
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });
  });

  describe("Migration of Liquidated SSV Cluster", () => {
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

      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );

      let cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );
      await legacyNetwork.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );
      expect(cluster.active).to.equal(false);

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
    };

    it("Migrates liquidated SSV cluster — no SSV refund, emits ClusterReactivated", async function () {
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);

      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt = await migrateTx.wait();
      const eventArgs = extractEventArgs(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(0n);
      expect(eventArgs.ssvRefunded).to.equal(0n);

      await expect(migrateTx).to.emit(network, Events.CLUSTER_REACTIVATED);

      const clusterAfter = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfter.active).to.equal(true);
      expect(clusterAfter.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(await views.getNetworkValidatorsCount()).to.equal(1);
    });
  });

  describe("Migration With Mixed Operator ETH State", () => {
    const deployFixtureMixed = async () => {
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

      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT,
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

    it("Operators with different ETH fees produce correct cumulative index after migration", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixtureMixed);
      const provider = connection.ethers.provider;

      const fees = [2_000_000_000n, 3_000_000_000n, 2_500_000_000n];
      for (let i = 0; i < 3; i++) {
        await network.connect(clusterOwner).declareOperatorFee(
          BigInt(operatorIds[i]), fees[i],
        );
      }

      await provider.send("evm_increaseTime", [604800]);
      await mineBlocks(provider, 1);

      for (let i = 0; i < 3; i++) {
        await network.connect(clusterOwner).executeOperatorFee(BigInt(operatorIds[i]));
      }

      await mineBlocks(provider, 200);

      const ethDeposit = ethers.parseEther("5");
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster,
        { value: ethDeposit },
      );
      await migrateTx.wait();

      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      for (const opId of operatorIds) {
        const op = await views.getOperatorById(opId);
        expect(op.validatorCount).to.equal(1);
      }

      for (const opId of operatorIds) {
        const opSSV = await views.getOperatorByIdSSV(opId);
        expect(opSSV.validatorCount).to.equal(0);
      }

      expect(await views.getNetworkValidatorsCount()).to.equal(1);
    });

    it("Migration succeeds with default ETH fees (auto-assigned on migration)", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixtureMixed);

      const ethDeposit = ethers.parseEther("10");
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster,
        { value: ethDeposit },
      );

      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      const receipt = await migrateTx.wait();
      const clusterAfter = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfter.balance).to.equal(ethDeposit);
      expect(clusterAfter.validatorCount).to.equal(1n);

      for (const opId of operatorIds) {
        const op = await views.getOperatorById(opId);
        expect(op.validatorCount).to.equal(1);
      }

      expect(await views.getNetworkValidatorsCount()).to.equal(1);
    });
  });

  describe("Post-Migration ETH Fee Accrual", () => {
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

      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT * 2n);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT * 2n,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      let cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );
      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, cluster,
      );
      cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
    };

    it("ETH fees accrue correctly after migration, not SSV fees", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateReceipt = await migrateTx.wait();
      const migrateBlock = migrateReceipt!.blockNumber;
      let migratedCluster = parseClusterFromEvent(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

      await mineBlocks(provider, 50);

      const balanceBeforeReg = await views.getBalance(
        clusterOwner.address, operatorIds, migratedCluster,
      );
      expect(balanceBeforeReg).to.be.lessThan(DEFAULT_ETH_REGISTER_VALUE);
      expect(balanceBeforeReg).to.be.greaterThan(0n);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(3), operatorIds, DEFAULT_SHARES, migratedCluster,
        { value: 0n },
      );
      const regReceipt = await regTx.wait();
      const clusterAfterReg = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      expect(clusterAfterReg.validatorCount).to.equal(3n);

      expect(BigInt(clusterAfterReg.balance)).to.be.lessThan(DEFAULT_ETH_REGISTER_VALUE);
      expect(BigInt(clusterAfterReg.balance)).to.be.greaterThan(0n);

      for (const opId of operatorIds) {
        const opSSV = await views.getOperatorByIdSSV(opId);
        expect(opSSV.validatorCount).to.equal(0);
        const opETH = await views.getOperatorById(opId);
        expect(opETH.validatorCount).to.equal(3);
      }
    });
  });
});
