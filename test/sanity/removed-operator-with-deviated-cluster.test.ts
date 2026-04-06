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
import { Errors } from "../common/errors.ts";

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

    it("R-11: liquidation does not revert after removing 2 operators from explicit EB cluster", async function () {
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
      await assertOperatorVUnits(clusters, operatorIds, expectedDeviation, 20000n);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);

      // Remove 2 operators — larger underflow surface
      const removedOp1 = operatorIds[0];
      const removedOp2 = operatorIds[1];
      await clusters.mockRemoveOperator(removedOp1);
      await clusters.mockRemoveOperator(removedOp2);

      expect(await clusters.getOperatorEthVUnits(removedOp1)).to.equal(0n);
      expect(await clusters.getOperatorEthVUnits(removedOp2)).to.equal(0n);

      await networkHelpers.mine(200);

      await expect(
        clusters.connect(liquidator).liquidate(clusterOwner.address, operatorIds, clusterAfterEB),
      ).to.not.revert(connection.ethers);

      // Both removed operators stay at 0, survivors clean up
      expect(await clusters.getOperatorEthVUnits(removedOp1)).to.equal(0n);
      expect(await clusters.getOperatorEthVUnits(removedOp2)).to.equal(0n);
      for (const opId of operatorIds.slice(2)) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    });

    it("EC-03: maximum EB (2048) + removed operator + liquidate does not underflow", async function () {
      const { clusters, operatorIds } = await loadFixtureForCount();

      // Use high network fee but zero operator fee impact to isolate the deviation math
      const networkFeeRate = 100_000n;
      await clusters.mockEthNetworkFee(networkFeeRate);
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);

      // Large deposit to survive EB=2048 burn rate (640000 vUnits × 64x fees)
      const depositValue = 500_000_000_000_000n;
      const regTx = await clusters.registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        createCluster(),
        { value: depositValue },
      );
      const regReceipt = await regTx.wait();
      const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      // Maximum EB: 2048 ETH → 640,000 vUnits → deviation = 630,000 per operator
      const root1 = computeEBRoot(clusterId, 2048);
      await clusters.mockSetEBRoot(1, root1);

      const ebTx = await clusters.updateClusterBalance(
        1, clusterOwner.address, operatorIds, clusterAfterReg, 2048, [],
      );
      const ebReceipt = await ebTx.wait();

      // Check if auto-liquidation happened (cluster may be insolvent at 64x burn rate)
      let clusterAfterEB;
      try {
        clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt, Events.CLUSTER_BALANCE_UPDATED);
      } catch {
        // Auto-liquidated during EB update — deviation was cleaned up in the same tx
        clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt, Events.CLUSTER_LIQUIDATED);
        // Even if auto-liquidated, verify removed op invariant holds
        const removedOperator = operatorIds[0];
        await clusters.mockRemoveOperator(removedOperator);
        expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
        expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
        return;
      }

      const maxVUnits = 640000n;
      const maxDeviation = maxVUnits - BPS_DENOMINATOR;
      expect(await clusters.getClusterVUnits(clusterId)).to.equal(maxVUnits);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(maxVUnits);
      // Check each operator individually to get better error messages
      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(maxDeviation);
      }

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);

      await networkHelpers.mine(200);

      // Liquidation must not underflow despite 630,000 deviation on dead slot
      await expect(
        clusters.connect(liquidator).liquidate(clusterOwner.address, operatorIds, clusterAfterEB),
      ).to.not.revert(connection.ethers);

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const opId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    });

    it("RI-04: implicit EB cluster → remove operator → first oracle EB update skips dead operator", async function () {
      const { clusters, operatorIds } = await loadFixtureForCount();

      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);

      // Register at implicit EB (no oracle update yet)
      const clusterAfterReg = await registerAndParseCluster(clusters, operatorIds);

      // All operators at 0 deviation (implicit EB)
      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(BPS_DENOMINATOR);

      // Remove operator BEFORE any oracle update
      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);

      // First oracle EB update — deviation write must skip removed operator
      const root1 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(1, root1);

      await expect(
        clusters.updateClusterBalance(1, clusterOwner.address, operatorIds, clusterAfterReg, 64, []),
      ).to.not.revert(connection.ethers);

      const expectedDeviation = 20000n - BPS_DENOMINATOR;
      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const opId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(expectedDeviation);
      }
      expect(await clusters.getClusterVUnits(clusterId)).to.equal(20000n);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);
    });

    it("R-13: withdraw succeeds after operator removal on explicit EB cluster (balance settlement correctness)", async function () {
      const { clusters, operatorIds } = await loadFixtureForCount();

      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);

      const clusterAfterReg = await registerAndParseCluster(clusters, operatorIds);

      const root1 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(1, root1);

      const ebTx = await clusters.updateClusterBalance(
        1, clusterOwner.address, operatorIds, clusterAfterReg, 64, [],
      );
      const clusterAfterEB = parseClusterFromEvent(clusters, await ebTx.wait(), Events.CLUSTER_BALANCE_UPDATED);

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);

      await networkHelpers.mine(50);

      // Withdraw a small amount — triggers fee settlement + liquidation check with removed operator
      const withdrawAmount = 100_000n;
      const withdrawTx = await clusters.withdraw(operatorIds, withdrawAmount, clusterAfterEB);
      const withdrawReceipt = await withdrawTx.wait();
      const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

      // Cluster still active after small withdrawal
      expect(clusterAfterWithdraw.active).to.equal(true);
      // Removed operator stays clean
      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
    });

    it("R-11 variant: removing 2 operators + EB decrease does not underflow", async function () {
      const { clusters, operatorIds } = await loadFixtureForCount();

      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);

      const clusterAfterReg = await registerAndParseCluster(clusters, operatorIds);

      const root1 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(1, root1);

      const ebTx1 = await clusters.updateClusterBalance(
        1, clusterOwner.address, operatorIds, clusterAfterReg, 64, [],
      );
      const clusterAfterEB64 = parseClusterFromEvent(clusters, await ebTx1.wait(), Events.CLUSTER_BALANCE_UPDATED);

      expect(await clusters.getClusterVUnits(clusterId)).to.equal(20000n);

      // Remove 2 operators
      const removedOp1 = operatorIds[0];
      const removedOp2 = operatorIds[1];
      await clusters.mockRemoveOperator(removedOp1);
      await clusters.mockRemoveOperator(removedOp2);

      // EB decrease from 64 → 32: subtracts deviation from each active operator
      const root2 = computeEBRoot(clusterId, 32);
      await clusters.mockSetEBRoot(2, root2);

      await expect(
        clusters.updateClusterBalance(2, clusterOwner.address, operatorIds, clusterAfterEB64, 32, []),
      ).to.not.revert(connection.ethers);

      expect(await clusters.getOperatorEthVUnits(removedOp1)).to.equal(0n);
      expect(await clusters.getOperatorEthVUnits(removedOp2)).to.equal(0n);
      for (const opId of operatorIds.slice(2)) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }
      expect(await clusters.getClusterVUnits(clusterId)).to.equal(BPS_DENOMINATOR);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(BPS_DENOMINATOR);
    });

    it("R-07: registerValidator reverts with OperatorDoesNotExist after operator removal on explicit EB cluster", async function () {
      const { clusters, operatorIds } = await loadFixtureForCount();

      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);

      const clusterAfterReg = await registerAndParseCluster(clusters, operatorIds);

      // Set explicit EB=64
      const root1 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(1, root1);

      const ebTx = await clusters.updateClusterBalance(
        1, clusterOwner.address, operatorIds, clusterAfterReg, 64, [],
      );
      const clusterAfterEB = parseClusterFromEvent(clusters, await ebTx.wait(), Events.CLUSTER_BALANCE_UPDATED);

      expect(await clusters.getClusterVUnits(clusterId)).to.equal(20000n);

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);

      // Attempting to register a second validator must revert — removed operator no longer exists
      await expect(
        clusters.registerValidator(
          makePublicKey(99),
          operatorIds,
          DEFAULT_SHARES,
          clusterAfterEB,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(clusters, Errors.OPERATOR_DOES_NOT_EXIST);

      // vUnits unchanged — revert was atomic
      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      expect(await clusters.getClusterVUnits(clusterId)).to.equal(20000n);
    });

    it("R-10: explicit EB=32 (zero deviation) + removed operator + self-liquidate does not revert", async function () {
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

      // Explicit EB=32 — same as default, so deviation = 0 per operator
      const root1 = computeEBRoot(clusterId, 32);
      await clusters.mockSetEBRoot(1, root1);

      const ebTx = await clusters.updateClusterBalance(
        1, clusterOwner.address, operatorIds, clusterAfterReg, 32, [],
      );
      const clusterAfterEB = parseClusterFromEvent(clusters, await ebTx.wait(), Events.CLUSTER_BALANCE_UPDATED);

      // Explicit EB=32 means vUnits = 10000, deviation = 0
      expect(await clusters.getClusterVUnits(clusterId)).to.equal(BPS_DENOMINATOR);
      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);

      await networkHelpers.mine(200);

      // Self-liquidate — deviation is 0, so no subtraction at all, but guard must still hold
      await expect(
        clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterEB),
      ).to.not.revert(connection.ethers);

      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    });

    it("EC-05: all operators removed from explicit EB cluster → self-liquidate does not revert", async function () {
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
      await assertOperatorVUnits(clusters, operatorIds, expectedDeviation, 20000n);

      // Remove ALL operators
      for (const opId of operatorIds) {
        await clusters.mockRemoveOperator(opId);
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }

      await networkHelpers.mine(200);

      // Self-liquidation must not revert even with all operators removed
      await expect(
        clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterEB),
      ).to.not.revert(connection.ethers);

      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    });
  }

  for (const operatorCount of OPERATOR_COUNTS) {
    describe(`with ${operatorCount} operators`, function () {
      runTestSuite(operatorCount);
    });
  }

  describe("Cross-cluster removed-operator propagation (4 operators)", function () {
    const loadFixtureFor4 = () => networkHelpers.loadFixture(deploy4);

    async function registerSingleValidatorCluster(
      clusters: any,
      owner: HardhatEthersSigner,
      operatorIds: bigint[],
      publicKeySeed: number,
      depositValue = 5_000_000_000_000n,
    ) {
      const registerTx = await clusters.connect(owner).registerValidator(
        makePublicKey(publicKeySeed),
        operatorIds,
        DEFAULT_SHARES,
        createCluster(),
        { value: depositValue },
      );
      return parseClusterFromEvent(clusters, await registerTx.wait(), Events.VALIDATOR_ADDED);
    }

    async function updateClusterEB(
      clusters: any,
      owner: HardhatEthersSigner,
      operatorIds: bigint[],
      cluster: any,
      blockNum: number,
      effectiveBalance: number,
    ) {
      const clusterId = computeClusterId(owner.address, operatorIds);
      await clusters.mockSetEBRoot(blockNum, computeEBRoot(clusterId, effectiveBalance));
      const updateTx = await clusters.connect(owner).updateClusterBalance(
        blockNum,
        owner.address,
        operatorIds,
        cluster,
        effectiveBalance,
        [],
      );
      return parseClusterFromEvent(clusters, await updateTx.wait(), Events.CLUSTER_BALANCE_UPDATED);
    }

    it("shared operator removal does not corrupt multi-cluster explicit-EB totals", async function () {
      const { clusters, operatorIds } = await loadFixtureFor4();
      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(1n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterA = await registerSingleValidatorCluster(clusters, clusterOwner, operatorIds, 8101);
      const clusterB = await registerSingleValidatorCluster(clusters, liquidator, operatorIds, 8102);

      await updateClusterEB(clusters, clusterOwner, operatorIds, clusterA, 1, 64);
      await updateClusterEB(clusters, liquidator, operatorIds, clusterB, 2, 64);

      const removedOperator = operatorIds[0];
      const expectedDeviationPerLiveOperator = 20000n;
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(40000n);
      await clusters.mockRemoveOperator(removedOperator);

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const operatorId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(expectedDeviationPerLiveOperator);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(40000n);
    });

    it("liquidating explicit cluster after shared removal preserves implicit-only accounting", async function () {
      const { clusters, operatorIds } = await loadFixtureFor4();
      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(1n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterA = await registerSingleValidatorCluster(clusters, clusterOwner, operatorIds, 8201);
      const clusterBImplicit = await registerSingleValidatorCluster(clusters, liquidator, operatorIds, 8202);
      const clusterAAfterEB64 = await updateClusterEB(clusters, clusterOwner, operatorIds, clusterA, 1, 64);

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);
      await clusters.liquidate(clusterOwner.address, operatorIds, clusterAAfterEB64);

      expect(clusterBImplicit.active).to.equal(true);
      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const operatorId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(BPS_DENOMINATOR);
    });

    it("EB decrease on one explicit cluster after shared removal updates only surviving operator slots", async function () {
      const { clusters, operatorIds } = await loadFixtureFor4();
      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(1n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterA = await registerSingleValidatorCluster(clusters, clusterOwner, operatorIds, 8301);
      const clusterB = await registerSingleValidatorCluster(clusters, liquidator, operatorIds, 8302);
      const clusterAAfterEB64 = await updateClusterEB(clusters, clusterOwner, operatorIds, clusterA, 1, 64);
      await updateClusterEB(clusters, liquidator, operatorIds, clusterB, 2, 64);

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);

      await updateClusterEB(clusters, clusterOwner, operatorIds, clusterAAfterEB64, 3, 32);

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const operatorId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(10000n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(30000n);
    });

    it("removing the last validator on second explicit cluster after shared removal cleans only that cluster", async function () {
      const { clusters, operatorIds } = await loadFixtureFor4();
      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(1n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterA = await registerSingleValidatorCluster(clusters, clusterOwner, operatorIds, 8401);
      const clusterB = await registerSingleValidatorCluster(clusters, liquidator, operatorIds, 8402);
      await updateClusterEB(clusters, clusterOwner, operatorIds, clusterA, 1, 64);
      const clusterBAfterEB64 = await updateClusterEB(clusters, liquidator, operatorIds, clusterB, 2, 64);

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);

      await clusters.connect(liquidator).removeValidator(
        makePublicKey(8402),
        operatorIds,
        clusterBAfterEB64,
      );

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const operatorId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(10000n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);
    });

    it("mixed EB increase/decrease after one shared-operator removal keeps per-operator totals exact", async function () {
      const { clusters, operatorIds } = await loadFixtureFor4();
      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(1n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterA = await registerSingleValidatorCluster(clusters, clusterOwner, operatorIds, 8501);
      const clusterB = await registerSingleValidatorCluster(clusters, liquidator, operatorIds, 8502);
      const clusterAAfterEB64 = await updateClusterEB(clusters, clusterOwner, operatorIds, clusterA, 1, 64);
      const clusterBAfterEB128 = await updateClusterEB(clusters, liquidator, operatorIds, clusterB, 2, 128);

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);

      await updateClusterEB(clusters, clusterOwner, operatorIds, clusterAAfterEB64, 3, 128);
      await updateClusterEB(clusters, liquidator, operatorIds, clusterBAfterEB128, 4, 32);

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const operatorId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(30000n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(50000n);
    });

    it("multiple explicit-EB clusters liquidated end at daoTotalEthVUnits == 0", async function () {
      const { clusters, operatorIds } = await loadFixtureFor4();
      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(1n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterA = await registerSingleValidatorCluster(clusters, clusterOwner, operatorIds, 8601);
      const clusterB = await registerSingleValidatorCluster(clusters, liquidator, operatorIds, 8602);
      const clusterAAfterEB64 = await updateClusterEB(clusters, clusterOwner, operatorIds, clusterA, 1, 64);
      const clusterBAfterEB128 = await updateClusterEB(clusters, liquidator, operatorIds, clusterB, 2, 128);

      expect(await clusters.getDaoTotalEthVUnits()).to.equal(60000n);
      for (const operatorId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(40000n);
      }

      await clusters.liquidate(clusterOwner.address, operatorIds, clusterAAfterEB64);
      await clusters.connect(liquidator).liquidate(liquidator.address, operatorIds, clusterBAfterEB128);

      for (const operatorId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    });

    it("shared operators across explicit clusters accumulate and clean exactly", async function () {
      const { clusters, operatorIds } = await loadFixtureFor4();
      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(1n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const clusterA = await registerSingleValidatorCluster(clusters, clusterOwner, operatorIds, 8701);
      const clusterB = await registerSingleValidatorCluster(clusters, liquidator, operatorIds, 8702);
      const clusterAAfter64 = await updateClusterEB(clusters, clusterOwner, operatorIds, clusterA, 1, 64);
      const clusterBAfter64 = await updateClusterEB(clusters, liquidator, operatorIds, clusterB, 2, 64);

      for (const operatorId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(20000n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(40000n);

      const clusterB64to128 = await updateClusterEB(clusters, liquidator, operatorIds, clusterBAfter64, 3, 128);
      for (const operatorId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(40000n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(60000n);

      await clusters.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, clusterAAfter64);
      for (const operatorId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(30000n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(40000n);

      await clusters.connect(liquidator).liquidate(liquidator.address, operatorIds, clusterB64to128);
      for (const operatorId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    });

    it("removeOperator clears operator slot but leaves DAO total unchanged through deposit", async function () {
      const { clusters, operatorIds } = await loadFixtureFor4();
      await clusters.mockEthNetworkFee(0n);
      await clusters.mockMinimumBlocksBeforeLiquidation(1n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const cluster = await registerSingleValidatorCluster(clusters, clusterOwner, operatorIds, 8801);
      const clusterAfter64 = await updateClusterEB(clusters, clusterOwner, operatorIds, cluster, 1, 64);

      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);
      for (const operatorId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(10000n);
      }

      const removedOperator = operatorIds[0];
      await clusters.mockRemoveOperator(removedOperator);
      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);

      const depositAmount = DEFAULT_ETH_REGISTER_VALUE / 2n;
      const depositTx = await clusters.deposit(
        clusterOwner.address,
        operatorIds,
        clusterAfter64,
        { value: depositAmount }
      );
      parseClusterFromEvent(clusters, await depositTx.wait(), Events.CLUSTER_DEPOSITED);

      expect(await clusters.getOperatorEthVUnits(removedOperator)).to.equal(0n);
      for (const operatorId of operatorIds.slice(1)) {
        expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(10000n);
      }
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);
    });
  });
});
