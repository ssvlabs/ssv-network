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
  DEFAULT_OPERATOR_ETH_FEE,
  CLUSTER_VERSION_ETH,
  CLUSTER_VERSION_SSV,
  DEDUCTED_DIGITS,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE_ETH,
  ETH_DEDUCTED_DIGITS,
  EMPTY_CLUSTER,
  TOKEN_REGISTER_AMOUNT,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
  BPS_DENOMINATOR,
} from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  setupLegacyClusterAndUpgradeWithOptions,
  calcClusterBurn,
  calcOperatorFeeAccrual,
  calcNetworkFeeAccrual,
  calcLiquidationThreshold,
  defaultVUnits,
} from "../../helpers/index.ts";
import { makeOperatorKey } from "../../helpers/index.ts";
import { ethers } from "ethers";

const OP_SSV_FEE_UNPACKED = 10_000_000_000n;

describe("Migration Edge Cases", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let clusterOwnerB: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, clusterOwnerB] } = await setupTestContext());
  });

  describe("Migration — SSV Refund Is Exactly Correct After Extended Fee Accrual", () => {
    const OP_SSV_FEE_CUSTOM = 1_500n * DEDUCTED_DIGITS;

    const deployFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_CUSTOM, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_CUSTOM, false);
        operatorIds.push(Number(expectedId));
      }

      const ssvDeposit = ethers.parseEther("500");
      await ssvToken.mint(clusterOwner.address, ssvDeposit);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvDeposit,
      );

      const halfDeposit = ssvDeposit / 2n;
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

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster, ssvDeposit };
    };

    it("SSV refund matches independent fee calculation after 1000 blocks", async function () {
      const { network, views, ssvToken, operatorIds, cluster, ssvDeposit } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 1000);

      const ssvBalanceBefore = await views.getBalanceSSV(
        clusterOwner.address, operatorIds, cluster,
      );
      const burnRate = await views.getBurnRateSSV(
        clusterOwner.address, operatorIds, cluster,
      );

      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);

      const ethDeposit = ethers.parseEther("10");
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster,
        { value: ethDeposit },
      );
      const receipt = await migrateTx.wait();

      const eventArgs = extractEventArgs(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const actualRefund = BigInt(eventArgs.ssvRefunded);

      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const tokenRefund = ownerSSVAfter - ownerSSVBefore;
      expect(tokenRefund).to.equal(actualRefund);

      const expectedRefund = ssvBalanceBefore - burnRate;
      expect(actualRefund).to.equal(expectedRefund);
      expect(actualRefund).to.be.lessThan(ssvDeposit);

      const totalFees = ssvDeposit - actualRefund;
      expect(totalFees % DEDUCTED_DIGITS).to.equal(0n);
    });
  });

  describe("Migration of Cluster Where Some Operators Were Removed", () => {
    const deployLegacyClusterWithRemovedOperatorFixture = async () =>
      setupLegacyClusterAndUpgradeWithOptions(connection, clusterOwner, clusterOwner, {
        preUpgradeBlocks: 50n,
        removedOperatorIndices: [3],
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

    it("Migration succeeds when Op1 is removed — removed operator is skipped", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);

      await network.connect(clusterOwner).removeOperator(operatorIds[0]);

      const ethDeposit = ethers.parseEther("10");
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster,
        { value: ethDeposit },
      );
      await migrateTx.wait();

      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      const op0 = await views.getOperatorById(operatorIds[0]);
      expect(op0.validatorCount).to.equal(0);

      for (let i = 1; i < operatorIds.length; i++) {
        const op = await views.getOperatorById(operatorIds[i]);
        expect(op.validatorCount).to.equal(1);
      }
    });

    it("CAT-1-3 migrates a legacy cluster with one removed operator and continues as a 3-operator ETH cluster", async function () {
      const {
        newNetwork,
        newViews,
        ssvToken,
        operatorIds,
        cluster,
        removedOperatorIds,
      } = await networkHelpers.loadFixture(deployLegacyClusterWithRemovedOperatorFixture);
      const provider = connection.ethers.provider;

      const removedOperatorId = removedOperatorIds[0];
      const activeOperatorIds = operatorIds.filter((id) => id !== removedOperatorId);

      expect(await newViews.getClusterAssetType(clusterOwner.address, operatorIds)).to.equal(CLUSTER_VERSION_SSV);
      expect(cluster.active).to.equal(true);
      expect(cluster.validatorCount).to.equal(1n);
      expect(await newViews.getNetworkValidatorsCount()).to.equal(0n);

      for (const opId of activeOperatorIds) {
        const opSSV = await newViews.getOperatorByIdSSV(opId);
        const opETH = await newViews.getOperatorById(opId);
        expect(BigInt(opSSV.validatorCount)).to.equal(1n);
        expect(BigInt(opETH.validatorCount)).to.equal(0n);
        expect(BigInt(opETH.fee)).to.equal(DEFAULT_OPERATOR_ETH_FEE);
      }

      const removedSSV = await newViews.getOperatorByIdSSV(removedOperatorId);
      const removedETH = await newViews.getOperatorById(removedOperatorId);
      expect(BigInt(removedSSV.validatorCount)).to.equal(0n);
      expect(BigInt(removedETH.validatorCount)).to.equal(0n);
      expect(BigInt(removedETH.fee)).to.equal(0n);

      const ssvBalanceBefore = await newViews.getBalanceSSV(clusterOwner.address, operatorIds, cluster);
      const burnRateSSV = await newViews.getBurnRateSSV(clusterOwner.address, operatorIds, cluster);
      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);

      const migrateTx = await newNetwork.connect(clusterOwner).migrateClusterToETH(
        operatorIds,
        cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateReceipt = await migrateTx.wait();
      await expect(migrateTx).to.emit(newNetwork, Events.CLUSTER_MIGRATED_TO_ETH);

      const migrateEventArgs = extractEventArgs(newNetwork, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const migratedCluster = parseClusterFromEvent(newNetwork, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const actualRefund = ownerSSVAfter - ownerSSVBefore;
      const expectedRefund = ssvBalanceBefore - burnRateSSV;

      expect(actualRefund).to.equal(expectedRefund);
      expect(BigInt(migrateEventArgs.ssvRefunded)).to.equal(expectedRefund);
      expect(BigInt(migrateEventArgs.ethDeposited)).to.equal(DEFAULT_ETH_REGISTER_VALUE);

      expect(await newViews.getClusterAssetType(clusterOwner.address, operatorIds)).to.equal(CLUSTER_VERSION_ETH);
      await expect(
        newViews.getBalanceSSV(clusterOwner.address, operatorIds, migratedCluster),
      ).to.be.revertedWithCustomError(newViews, Errors.INCORRECT_CLUSTER_VERSION);
      expect(await newViews.getBalance(clusterOwner.address, operatorIds, migratedCluster)).to.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(migratedCluster.active).to.equal(true);
      expect(migratedCluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(migratedCluster.validatorCount).to.equal(1n);
      expect(await newViews.getNetworkValidatorsCount()).to.equal(1n);

      const networkFee = BigInt(await newViews.getNetworkFee());
      const networkFeeRaw = networkFee / ETH_DEDUCTED_DIGITS;
      const preRegisterBurnRate = calcClusterBurn({
        blockDiff: 1n,
        numOperators: 3n,
        ethFee: DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS,
        networkFee: networkFeeRaw,
        effectiveVUnits: defaultVUnits(1n),
      });

      expect(await newViews.getBurnRate(clusterOwner.address, operatorIds, migratedCluster)).to.equal(preRegisterBurnRate);

      for (const opId of activeOperatorIds) {
        const opSSV = await newViews.getOperatorByIdSSV(opId);
        const opETH = await newViews.getOperatorById(opId);
        expect(BigInt(opSSV.validatorCount)).to.equal(0n);
        expect(BigInt(opETH.validatorCount)).to.equal(1n);
        expect(BigInt(opETH.fee)).to.equal(DEFAULT_OPERATOR_ETH_FEE);
      }

      const removedSSVAfter = await newViews.getOperatorByIdSSV(removedOperatorId);
      const removedETHAfter = await newViews.getOperatorById(removedOperatorId);
      expect(BigInt(removedSSVAfter.validatorCount)).to.equal(0n);
      expect(BigInt(removedETHAfter.validatorCount)).to.equal(0n);
      expect(BigInt(removedETHAfter.fee)).to.equal(0n);
      expect(await newViews.getOperatorEarnings(removedOperatorId)).to.equal(0n);

      const postMigrationBlocks = 200n;
      await mineBlocks(provider, Number(postMigrationBlocks));

      const expectedBalanceBeforeWithdraw =
        DEFAULT_ETH_REGISTER_VALUE -
        calcClusterBurn({
          blockDiff: postMigrationBlocks,
          numOperators: 3n,
          ethFee: DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS,
          networkFee: networkFeeRaw,
          effectiveVUnits: defaultVUnits(1n),
        });
      expect(await newViews.getBalance(clusterOwner.address, operatorIds, migratedCluster)).to.equal(expectedBalanceBeforeWithdraw);

      const preWithdrawBlock = BigInt(await provider.getBlockNumber());
      const withdrawAmount = ethers.parseEther("1");
      const withdrawTx = await newNetwork.connect(clusterOwner).withdraw(
        operatorIds,
        withdrawAmount,
        migratedCluster,
      );
      const withdrawReceipt = await withdrawTx.wait();
      const clusterAfterWithdraw = parseClusterFromEvent(newNetwork, withdrawReceipt, Events.CLUSTER_WITHDRAWN);
      const blocksAccruedForWithdraw = BigInt(withdrawReceipt!.blockNumber) - preWithdrawBlock;

      const expectedBalanceAfterWithdraw =
        expectedBalanceBeforeWithdraw -
        calcClusterBurn({
          blockDiff: blocksAccruedForWithdraw,
          numOperators: 3n,
          ethFee: DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS,
          networkFee: networkFeeRaw,
          effectiveVUnits: defaultVUnits(1n),
        }) -
        withdrawAmount;

      expect(clusterAfterWithdraw.balance).to.equal(expectedBalanceAfterWithdraw);
      expect(clusterAfterWithdraw.active).to.equal(true);
      expect(clusterAfterWithdraw.validatorCount).to.equal(1n);
      expect(await newViews.getBalance(clusterOwner.address, operatorIds, clusterAfterWithdraw)).to.equal(expectedBalanceAfterWithdraw);
      expect(await newViews.getNetworkValidatorsCount()).to.equal(1n);

      const expectedOperatorEarnings =
        calcOperatorFeeAccrual(postMigrationBlocks + blocksAccruedForWithdraw, DEFAULT_OPERATOR_ETH_FEE, defaultVUnits(1n));

      const expectedNetworkEarnings =
        calcNetworkFeeAccrual((postMigrationBlocks + blocksAccruedForWithdraw) * networkFeeRaw, defaultVUnits(1n));

      for (const opId of activeOperatorIds) {
        const opSSV = await newViews.getOperatorByIdSSV(opId);
        const opETH = await newViews.getOperatorById(opId);
        expect(BigInt(opSSV.validatorCount)).to.equal(0n);
        expect(BigInt(opETH.validatorCount)).to.equal(1n);
        expect(BigInt(opETH.fee)).to.equal(DEFAULT_OPERATOR_ETH_FEE);
        expect(await newViews.getOperatorEarnings(opId)).to.equal(expectedOperatorEarnings);
      }

      const removedSSVFinal = await newViews.getOperatorByIdSSV(removedOperatorId);
      const removedETHFinal = await newViews.getOperatorById(removedOperatorId);
      expect(BigInt(removedSSVFinal.validatorCount)).to.equal(0n);
      expect(BigInt(removedETHFinal.validatorCount)).to.equal(0n);
      expect(BigInt(removedETHFinal.fee)).to.equal(0n);
      expect(await newViews.getOperatorEarnings(removedOperatorId)).to.equal(0n);
      expect(await newViews.getNetworkEarnings()).to.equal(expectedNetworkEarnings);

      await expect(
        newNetwork.connect(clusterOwner).registerValidator(
          makePublicKey(124),
          operatorIds,
          DEFAULT_SHARES,
          clusterAfterWithdraw,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(newNetwork, Errors.OPERATOR_DOES_NOT_EXIST);

      await expect(
        newNetwork.connect(clusterOwner).registerValidator(
          makePublicKey(125),
          activeOperatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(newNetwork, Errors.INVALID_OPERATOR_IDS_LENGTH);
    });
  });

  describe("Migration of Cluster Where All Operators Were Removed", () => {
    const deployLegacyClusterWithAllOperatorsRemovedFixture = async () =>
      setupLegacyClusterAndUpgradeWithOptions(connection, clusterOwnerB, clusterOwner, {
        preUpgradeBlocks: 50n,
        removedOperatorIndices: [0, 1, 2, 3],
      });

    it("CAT-1-4 migrates a legacy cluster with all operators removed and burns only the network fee", async function () {
      const {
        newNetwork,
        newViews,
        ssvToken,
        operatorIds,
        cluster,
        removedOperatorIds,
      } = await networkHelpers.loadFixture(deployLegacyClusterWithAllOperatorsRemovedFixture);
      const provider = connection.ethers.provider;

      expect(await newViews.getClusterAssetType(clusterOwner.address, operatorIds)).to.equal(CLUSTER_VERSION_SSV);
      expect(cluster.active).to.equal(true);
      expect(BigInt(cluster.validatorCount)).to.equal(1n);
      expect(BigInt(await newViews.getNetworkValidatorsCount())).to.equal(0n);

      for (const operatorId of removedOperatorIds) {
        const opSSV = await newViews.getOperatorByIdSSV(operatorId);
        const opETH = await newViews.getOperatorById(operatorId);
        expect(BigInt(opSSV.validatorCount)).to.equal(0n);
        expect(BigInt(opETH.validatorCount)).to.equal(0n);
        expect(BigInt(opETH.fee)).to.equal(0n);
        expect(BigInt(await newViews.getOperatorEarnings(operatorId))).to.equal(0n);
      }

      const ssvBalanceBefore = await newViews.getBalanceSSV(clusterOwner.address, operatorIds, cluster);
      const burnRateSSV = await newViews.getBurnRateSSV(clusterOwner.address, operatorIds, cluster);
      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);

      const migrateTx = await newNetwork.connect(clusterOwner).migrateClusterToETH(
        operatorIds,
        cluster,
        { value: MINIMUM_LIQUIDATION_PERIOD_COLLATERAL },
      );
      const migrateReceipt = await migrateTx.wait();
      await expect(migrateTx).to.emit(newNetwork, Events.CLUSTER_MIGRATED_TO_ETH);

      const migratedCluster = parseClusterFromEvent(newNetwork, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const migrateEventArgs = extractEventArgs(newNetwork, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const expectedRefund = ssvBalanceBefore - burnRateSSV;

      expect(ownerSSVAfter - ownerSSVBefore).to.equal(expectedRefund);
      expect(BigInt(migrateEventArgs.ssvRefunded)).to.equal(expectedRefund);
      expect(BigInt(migrateEventArgs.ethDeposited)).to.equal(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL);
      expect(await newViews.getClusterAssetType(clusterOwner.address, operatorIds)).to.equal(CLUSTER_VERSION_ETH);
      await expect(
        newViews.getBalanceSSV(clusterOwner.address, operatorIds, migratedCluster),
      ).to.be.revertedWithCustomError(newViews, Errors.INCORRECT_CLUSTER_VERSION);
      expect(await newViews.getBalance(clusterOwner.address, operatorIds, migratedCluster)).to.equal(
        MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
      );
      expect(migratedCluster.active).to.equal(true);
      expect(BigInt(migratedCluster.validatorCount)).to.equal(1n);
      expect(BigInt(await newViews.getNetworkValidatorsCount())).to.equal(1n);
      expect(
        await newViews.getBurnRate(clusterOwner.address, operatorIds, migratedCluster),
      ).to.equal(NETWORK_FEE_ETH);

      for (const operatorId of removedOperatorIds) {
        const opSSV = await newViews.getOperatorByIdSSV(operatorId);
        const opETH = await newViews.getOperatorById(operatorId);
        expect(BigInt(opSSV.validatorCount)).to.equal(0n);
        expect(BigInt(opETH.validatorCount)).to.equal(0n);
        expect(BigInt(opETH.fee)).to.equal(0n);
        expect(BigInt(await newViews.getOperatorEarnings(operatorId))).to.equal(0n);
      }

      await mineBlocks(provider, 1000);

      expect(
        await newViews.getBurnRate(clusterOwner.address, operatorIds, migratedCluster),
      ).to.equal(NETWORK_FEE_ETH);
      expect(
        await newViews.getBalance(clusterOwner.address, operatorIds, migratedCluster),
      ).to.equal(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL - NETWORK_FEE_ETH * 1000n);
      for (const operatorId of removedOperatorIds) {
        expect(BigInt(await newViews.getOperatorEarnings(operatorId))).to.equal(0n);
      }
      expect(BigInt(await newViews.getNetworkEarnings())).to.equal(NETWORK_FEE_ETH * 1000n);
    });
  });

  describe("DAO Earnings Settlement During Migration", () => {
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

      const ssvDeposit = TOKEN_REGISTER_AMOUNT * 2n;
      await ssvToken.mint(clusterOwner.address, ssvDeposit);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvDeposit,
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

    it("DAO earnings for both SSV and ETH are settled during migration", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 100);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await migrateTx.wait();

      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      const networkValidators = await views.getNetworkValidatorsCount();
      expect(networkValidators).to.equal(2);

      for (const opId of operatorIds) {
        const opETH = await views.getOperatorById(opId);
        expect(opETH.validatorCount).to.equal(2);
        const opSSV = await views.getOperatorByIdSSV(opId);
        expect(opSSV.validatorCount).to.equal(0);
      }
    });
  });

  describe("Multiple Migrations — Same Operators, Different Clusters", () => {
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

      const ssvDeposit = TOKEN_REGISTER_AMOUNT * 3n;
      await ssvToken.mint(clusterOwner.address, ssvDeposit);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvDeposit,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      let clusterA = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );
      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, clusterA,
      );
      clusterA = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      await ssvToken.mint(clusterOwnerB.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwnerB).approve(
        await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT,
      );

      await legacyNetwork.connect(clusterOwnerB).registerValidator(
        makePublicKey(3), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      const clusterB = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwnerB.address, operatorIds,
      );

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, clusterA, clusterB };
    };

    it("Two clusters with same operators migrate correctly without index corruption", async function () {
      const { network, views, operatorIds, clusterA, clusterB } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 100);

      const migrateTx1 = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, clusterA,
        { value: ethers.parseEther("5") },
      );
      await migrateTx1.wait();
      await expect(migrateTx1).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      for (const opId of operatorIds) {
        const opETH = await views.getOperatorById(opId);
        expect(opETH.validatorCount).to.equal(2);
      }

      await mineBlocks(provider, 100);

      const migrateTx2 = await network.connect(clusterOwnerB).migrateClusterToETH(
        operatorIds, clusterB,
        { value: ethers.parseEther("3") },
      );
      const receipt2 = await migrateTx2.wait();
      await expect(migrateTx2).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      for (const opId of operatorIds) {
        const opETH = await views.getOperatorById(opId);
        expect(opETH.validatorCount).to.equal(3);
      }

      for (const opId of operatorIds) {
        const opSSV = await views.getOperatorByIdSSV(opId);
        expect(opSSV.validatorCount).to.equal(0);
      }

      expect(await views.getNetworkValidatorsCount()).to.equal(3);

      const clusterBAfter = parseClusterFromEvent(network, receipt2, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterBAfter.balance).to.equal(ethers.parseEther("3"));
      expect(clusterBAfter.validatorCount).to.equal(1n);
    });
  });

  describe("Revert — Migrate With Insufficient ETH For Liquidation Check", () => {
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

      const ssvDeposit = TOKEN_REGISTER_AMOUNT * 2n;
      await ssvToken.mint(clusterOwner.address, ssvDeposit);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvDeposit,
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

    const ethFeeRaw = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
    const networkFeeRaw = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;

    it("Reverts when ETH deposit is below liquidation threshold", async function () {
      const { network, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);

      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
        numOperators: 4n,
        ethFee: ethFeeRaw,
        networkFee: networkFeeRaw,
        effectiveVUnits: defaultVUnits(2n),
      });

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster,
        { value: threshold },
      );
      await migrateTx.wait();
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);
    });

    it("Reverts when ETH deposit is 1 wei below threshold", async function () {
      const { network, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);

      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
        numOperators: 4n,
        ethFee: ethFeeRaw,
        networkFee: networkFeeRaw,
        effectiveVUnits: defaultVUnits(2n),
      });

      await expect(
        network.connect(clusterOwner).migrateClusterToETH(
          operatorIds, cluster,
          { value: threshold - 1n },
        ),
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    it("Reverts when ETH deposit is 0", async function () {
      const { network, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);

      await expect(
        network.connect(clusterOwner).migrateClusterToETH(
          operatorIds, cluster,
          { value: 0n },
        ),
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });
  });
});
