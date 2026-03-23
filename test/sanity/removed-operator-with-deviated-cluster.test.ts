import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../setup/fixtures.ts";
import type { NetworkHelpersType } from "../common/types.ts";
import {
  setupTestContext,
  computeClusterId,
  computeEBRoot,
  createCluster,
  makePublicKey,
  parseClusterFromEvent,
  registerAndParseCluster,
  assertOperatorVUnits,
} from "../common/helpers.ts";
import { DEFAULT_SHARES, DEFAULT_ETH_REGISTER_VALUE, BPS_DENOMINATOR } from "../common/constants.ts";
import { Events } from "../common/events.ts";

const OPERATOR_FEE = 10_000_000_000n;
const OPERATOR_COUNTS = [4, 7, 10, 13];

describe("'removeOperator()' deletes operatorEthVUnits and does not affect clusters", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, liquidator] } = await setupTestContext());
  });

  async function deploy4() { return ssvClustersHarnessFixture(connection, 4, OPERATOR_FEE); }
  async function deploy7() { return ssvClustersHarnessFixture(connection, 7, OPERATOR_FEE); }
  async function deploy10() { return ssvClustersHarnessFixture(connection, 10, OPERATOR_FEE); }
  async function deploy13() { return ssvClustersHarnessFixture(connection, 13, OPERATOR_FEE); }
  const fixtures: Record<number, () => Promise<any>> = { 4: deploy4, 7: deploy7, 10: deploy10, 13: deploy13 };

  function runTestSuite(operatorCount: number) {
    const loadFixtureForCount = () => networkHelpers.loadFixture(fixtures[operatorCount]);

    it("liquidation does not revert after operator removal when cluster has EB deviation", async function () {
      const { clusters, operatorIds } = await loadFixtureForCount();

      const networkFeeRate = 100_000n;
      await clusters.mockEthNetworkFee(networkFeeRate);
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);

      const depositValue = 5_000_000_000_000n;
      const regTx = await clusters.registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        createCluster(),
        { value: depositValue },
      );
      const regReceipt = await regTx.wait();
      const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      const root1 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(1, root1);

      const ebTx = await clusters.updateClusterBalance(
        1,
        clusterOwner.address,
        operatorIds,
        clusterAfterReg,
        64,
        [],
      );
      const ebReceipt = await ebTx.wait();
      const clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt, Events.CLUSTER_BALANCE_UPDATED);

      expect(await clusters.getClusterVUnits(clusterId)).to.equal(20000n);

      const expectedDeviation = 20000n - BPS_DENOMINATOR;
      await assertOperatorVUnits(clusters, operatorIds, expectedDeviation, 20000n);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);

      await networkHelpers.mine(200);

      await expect(
        clusters.connect(liquidator).liquidate(clusterOwner.address, operatorIds, clusterAfterEB),
      ).to.not.revert(connection.ethers);

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const opId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    });

    it("'updateClusterBalance()' with previous deviation and EB decrease does not revert after operator removal", async function () {
      const { clusters, operatorIds } = await loadFixtureForCount();

      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);

      const clusterAfterReg = await registerAndParseCluster(clusters, operatorIds);

      const root1 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(1, root1);

      const ebTx1 = await clusters.updateClusterBalance(
        1,
        clusterOwner.address,
        operatorIds,
        clusterAfterReg,
        64,
        [],
      );
      const ebReceipt1 = await ebTx1.wait();
      const clusterAfterEB64 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

      expect(await clusters.getClusterVUnits(clusterId)).to.equal(20000n);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);

      const root2 = computeEBRoot(clusterId, 32);
      await clusters.mockSetEBRoot(2, root2);

      await expect(
        clusters.updateClusterBalance(2, clusterOwner.address, operatorIds, clusterAfterEB64, 32, []),
      ).to.not.revert(connection.ethers);

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const opId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }
      expect(await clusters.getClusterVUnits(clusterId)).to.equal(BPS_DENOMINATOR);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(BPS_DENOMINATOR);
    });

    it("'bulkRemoveValidator()' (emptying cluster) does not revert after operator removal", async function () {
      const { clusters, operatorIds } = await loadFixtureForCount();

      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(1n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);

      const clusterAfterReg = await registerAndParseCluster(clusters, operatorIds);

      const root1 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(1, root1);

      const ebTx = await clusters.updateClusterBalance(
        1,
        clusterOwner.address,
        operatorIds,
        clusterAfterReg,
        64,
        [],
      );
      const ebReceipt = await ebTx.wait();
      const clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt, Events.CLUSTER_BALANCE_UPDATED);

      expect(await clusters.getClusterVUnits(clusterId)).to.equal(20000n);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);

      await expect(
        clusters.removeValidator(makePublicKey(1), operatorIds, clusterAfterEB),
      ).to.not.revert(connection.ethers);

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const opId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }
      expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    });

    it("auto liquidation via 'updateClusterBalance()' does not revert after operator removal", async function () {
      const { clusters, operatorIds } = await loadFixtureForCount();

      const networkFee = 100_000n;
      await clusters.mockEthNetworkFee(networkFee);
      await clusters.mockMinimumBlocksBeforeLiquidation(100n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const depositValue = (BigInt(operatorIds.length) + 1n) * 3_000_000_000_000n;
      const regTx = await clusters.registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        createCluster(),
        { value: depositValue },
      );
      const regReceipt = await regTx.wait();
      const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);

      const root1 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(1, root1);

      const ebTx1 = await clusters.updateClusterBalance(
        1,
        clusterOwner.address,
        operatorIds,
        clusterAfterReg,
        64,
        [],
      );
      const ebReceipt1 = await ebTx1.wait();
      const clusterAfterEB64 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

      expect(clusterAfterEB64.active).to.equal(true);
      expect(await clusters.getClusterVUnits(clusterId)).to.equal(20000n);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);

      const removedOpId = operatorIds[0];
      await clusters.mockRemoveOperator(removedOpId);

      await networkHelpers.mine(140);

      const root2 = computeEBRoot(clusterId, 32);
      await clusters.mockSetEBRoot(2, root2);

      const autoLiqTx = await clusters.updateClusterBalance(
        2, clusterOwner.address, operatorIds, clusterAfterEB64, 32, [],
      );
      const autoLiqReceipt = await autoLiqTx.wait();
      const clusterAfterAutoLiq = parseClusterFromEvent(clusters, autoLiqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(clusterAfterAutoLiq.active).to.equal(false);

      expect(await clusters.getOperatorEthVUnits(removedOpId)).to.equal(0n);
      for (const opId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    });

    it("'updateClusterBalance()' with EB increase does not re-add deviation to removed operator", async function () {
      const { clusters, operatorIds } = await loadFixtureForCount();

      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);

      const clusterAfterReg = await registerAndParseCluster(clusters, operatorIds);

      const root1 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(1, root1);

      const ebTx1 = await clusters.updateClusterBalance(
        1,
        clusterOwner.address,
        operatorIds,
        clusterAfterReg,
        64,
        [],
      );
      const ebReceipt1 = await ebTx1.wait();
      const clusterAfterEB64 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

      expect(await clusters.getClusterVUnits(clusterId)).to.equal(20000n);

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);

      const root2 = computeEBRoot(clusterId, 128);
      await clusters.mockSetEBRoot(2, root2);

      await expect(
        clusters.updateClusterBalance(2, clusterOwner.address, operatorIds, clusterAfterEB64, 128, []),
      ).to.not.revert(connection.ethers);

      const expectedVUnits = 40000n;
      const expectedDeviation = expectedVUnits - BPS_DENOMINATOR;
      expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);
      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const opId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(expectedDeviation);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(expectedVUnits);
    });

    it("liquidating two clusters with common removed operator cleans up correctly and does not revert", async function () {
      const { clusters, operatorIds } = await loadFixtureForCount();

      const networkFeeRate = 100_000n;
      await clusters.mockEthNetworkFee(networkFeeRate);
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const depositValue = 5_000_000_000_000n;

      const clusterIdA = computeClusterId(clusterOwner.address, operatorIds);
      const regTxA = await clusters.registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        createCluster(),
        { value: depositValue },
      );
      const regReceiptA = await regTxA.wait();
      const clusterA = parseClusterFromEvent(clusters, regReceiptA, Events.VALIDATOR_ADDED);

      const clusterIdB = computeClusterId(liquidator.address, operatorIds);
      const regTxB = await clusters.connect(liquidator).registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        createCluster(),
        { value: depositValue },
      );
      const regReceiptB = await regTxB.wait();
      const clusterB = parseClusterFromEvent(clusters, regReceiptB, Events.VALIDATOR_ADDED);

      const rootA = computeEBRoot(clusterIdA, 64);
      await clusters.mockSetEBRoot(1, rootA);
      const ebTxA = await clusters.updateClusterBalance(
        1, clusterOwner.address, operatorIds, clusterA, 64, [],
      );
      const clusterAAfterEB = parseClusterFromEvent(clusters, await ebTxA.wait(), Events.CLUSTER_BALANCE_UPDATED);

      const rootB = computeEBRoot(clusterIdB, 64);
      await clusters.mockSetEBRoot(2, rootB);
      const ebTxB = await clusters.connect(liquidator).updateClusterBalance(
        2, liquidator.address, operatorIds, clusterB, 64, [],
      );
      const clusterBAfterEB = parseClusterFromEvent(clusters, await ebTxB.wait(), Events.CLUSTER_BALANCE_UPDATED);

      const deviationPerCluster = 20000n - BPS_DENOMINATOR;
      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(deviationPerCluster * 2n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n * 2n);

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);
      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);

      await networkHelpers.mine(200);

      await clusters.connect(liquidator).liquidate(clusterOwner.address, operatorIds, clusterAAfterEB);

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const opId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(deviationPerCluster);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);

      await clusters.connect(clusterOwner).liquidate(liquidator.address, operatorIds, clusterBAfterEB);

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const opId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    });

    it("'reactivate()' with EB deviation does not add deviation to a removed operator", async function () {
      const { clusters, operatorIds } = await loadFixtureForCount();

      const networkFeeRate = 100_000n;
      await clusters.mockEthNetworkFee(networkFeeRate);
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);

      const depositValue = 5_000_000_000_000n;
      const regTx = await clusters.registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        createCluster(),
        { value: depositValue },
      );
      const regReceipt = await regTx.wait();
      const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      const root1 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(1, root1);

      const ebTx = await clusters.updateClusterBalance(
        1, clusterOwner.address, operatorIds, clusterAfterReg, 64, [],
      );
      const clusterAfterEB = parseClusterFromEvent(clusters, await ebTx.wait(), Events.CLUSTER_BALANCE_UPDATED);

      const expectedDeviation = 20000n - BPS_DENOMINATOR;
      await assertOperatorVUnits(clusters, operatorIds, expectedDeviation);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);

      await networkHelpers.mine(200);

      const liqTx = await clusters.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, clusterAfterEB,
      );
      const clusterAfterLiq = parseClusterFromEvent(clusters, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);
      expect(clusterAfterLiq.active).to.equal(false);

      await assertOperatorVUnits(clusters, operatorIds, 0n);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);

      const reactivateTx = await clusters.reactivate(
        operatorIds, clusterAfterLiq, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const clusterAfterReactivate = parseClusterFromEvent(
        clusters, await reactivateTx.wait(), Events.CLUSTER_REACTIVATED,
      );
      expect(clusterAfterReactivate.active).to.equal(true);

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const opId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(expectedDeviation);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);
      expect(await clusters.getClusterVUnits(clusterId)).to.equal(20000n);
    });

    it("'migrateClusterToETH()' with EB deviation does not write deviation to removed operator", async function () {
      const { clusters, operatorIds } = await loadFixtureForCount();

      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const ssvCluster = {
        validatorCount: 1n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 0n,
        active: true,
      };

      await clusters.mockRegisterSSVValidator(
        makePublicKey(10), operatorIds, clusterOwner.address, ssvCluster,
      );

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const vUnitsEB64 = 20000n;
      await clusters.mockSetClusterVUnits(clusterId, vUnitsEB64);

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);

      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds, ssvCluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const clusterAfterMigration = parseClusterFromEvent(
        clusters, await migrateTx.wait(), Events.CLUSTER_MIGRATED_TO_ETH,
      );
      expect(clusterAfterMigration.active).to.equal(true);

      const expectedDeviation = vUnitsEB64 - BPS_DENOMINATOR;

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const opId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(expectedDeviation);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(vUnitsEB64);
      expect(await clusters.getClusterVUnits(clusterId)).to.equal(vUnitsEB64);
    });

    it("'migrateClusterToETH()' with removed operator skips removed operator's snapshot and fee accumulation", async function () {
      const { clusters, operatorIds } = await loadFixtureForCount();

      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const ssvCluster = {
        validatorCount: 1n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 0n,
        active: true,
      };

      await clusters.mockRegisterSSVValidator(
        makePublicKey(10), operatorIds, clusterOwner.address, ssvCluster,
      );

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);

      await networkHelpers.mine(50);

      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds, ssvCluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const clusterAfterMigration = parseClusterFromEvent(
        clusters, await migrateTx.wait(), Events.CLUSTER_MIGRATED_TO_ETH,
      );
      expect(clusterAfterMigration.active).to.equal(true);

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const opId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(BPS_DENOMINATOR);
    });
  }

  for (const operatorCount of OPERATOR_COUNTS) {
    describe(`with ${operatorCount} operators`, function () {
      runTestSuite(operatorCount);
    });
  }
});
