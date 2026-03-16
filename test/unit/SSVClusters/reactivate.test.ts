import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import { defaultClustersFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, computeClusterId, makePublicKey, parseClusterFromEvent, registerAndParseCluster, registerAndLiquidate, assertOperatorVUnits, calcLiquidationThreshold } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, BPS_DENOMINATOR, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";
import { mockEBAndUpdate } from "../../helpers/oracle.ts";
import { ethers } from "ethers";

describe("SSVClusters function `reactivate()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let otherAccount: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, otherAccount] } = await setupTestContext());
  });

  const deploySSVClustersAndPrepareOperatorsFixture = async () => {
    return defaultClustersFixture(connection);
  };


  const getOperatorEthEarnings = async (clusters: any, operatorId: bigint): Promise<bigint> => {
    const [, , balance] = await clusters.getOperatorEthSnapshot(operatorId);
    return balance;
  };


  it("Reactivates a liquidated cluster with sufficient balance and emits correct event", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, clusterOwner.address, operatorIds);

    const reactivateTx = await clusters.reactivate(
      operatorIds,
      clusterAfterLiquidation,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const reactivateReceipt = await reactivateTx.wait();
    await trackGasFromReceipt(reactivateReceipt, [GasGroup.REACTIVATE_CLUSTER]);
    const clusterAfterReactivate = parseClusterFromEvent(clusters, reactivateReceipt, Events.CLUSTER_REACTIVATED);

    await expect(reactivateTx).to.emit(clusters, Events.CLUSTER_REACTIVATED);
    expect(clusterAfterReactivate.active).to.equal(true);
    expect(clusterAfterReactivate.validatorCount).to.equal(clusterAfterLiquidation.validatorCount);
  });

  it("Keeps operator deviation at zero when reactivating without EB snapshot", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, clusterOwner.address, operatorIds);

    await assertOperatorVUnits(clusters, operatorIds, 0n);

    const reactivateTx = await clusters.reactivate(
      operatorIds,
      clusterAfterLiquidation,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    await reactivateTx.wait();

    const baselineVUnits = clusterAfterLiquidation.validatorCount * BPS_DENOMINATOR;
    await assertOperatorVUnits(clusters, operatorIds, 0n, baselineVUnits);
  });

  it("Is reverted with 'ClusterAlreadyEnabled' when trying to reactivate an active cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterAfterRegister = await registerAndParseCluster(clusters, operatorIds);

    await expect(clusters.reactivate(
      operatorIds,
      clusterAfterRegister,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_ALREADY_ENABLED);
  });

  it("Is reverted with 'ClusterDoesNotExists' when a non-owner tries to reactivate a cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, clusterOwner.address, operatorIds);

    await expect(clusters.connect(otherAccount).reactivate(
      operatorIds,
      clusterAfterLiquidation,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_DOES_NOT_EXIST);
  });

  it("Is reverted with 'IncorrectClusterState' when provided cluster data is stale or mismatched", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, clusterOwner.address, operatorIds);

    const mismatchedCluster = {
      ...clusterAfterLiquidation,
      balance: clusterAfterLiquidation.balance + 1n,
    };

    await expect(clusters.reactivate(
      operatorIds,
      mismatchedCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("Is reverted with 'InsufficientBalance' when reactivation deposit is too low", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, clusterOwner.address, operatorIds);
    await clusters.mockMinimumLiquidationCollateral(DEFAULT_ETH_REGISTER_VALUE + 1_000_000_000n);

    await expect(clusters.reactivate(
      operatorIds,
      clusterAfterLiquidation,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);
  });

  it("Is reverted with 'InsufficientBalance' when reactivation deposit does not cover runway", async function () {
    const operatorFee = 5_000_000_000n;
    const deployFixture = async () => ssvClustersHarnessFixture(connection, 4, operatorFee);
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

    await clusters.mockMinimumLiquidationCollateral(0n);

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, clusterOwner.address, operatorIds);
    await clusters.mockMinimumBlocksBeforeLiquidation(1_000_000_000n);

    await expect(clusters.reactivate(
      operatorIds,
      clusterAfterLiquidation,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);

    const reactivateTx = await clusters.reactivate(
      operatorIds,
      clusterAfterLiquidation,
      { value: ethers.parseEther("30") }
    );
    await reactivateTx.wait();
  });

  it("Scales reactivation solvency threshold with EB=64 (2x baseline vUnits)", async function () {
    const operatorFeePacked = 100_000n;
    const operatorFee = operatorFeePacked * ETH_DEDUCTED_DIGITS;
    const networkFeePacked = 100_000n;
    const minimumBlocksBeforeLiquidation = 100n;
    const deployFixture = async () => ssvClustersHarnessFixture(connection, 4, operatorFee);
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

    await clusters.mockEthNetworkFee(networkFeePacked);
    await clusters.mockMinimumBlocksBeforeLiquidation(minimumBlocksBeforeLiquidation);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const clusterAfterRegister = await registerAndParseCluster(clusters, operatorIds);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const { cluster: clusterAfterEB64 } = await mockEBAndUpdate(clusters, clusterOwner.address, operatorIds, clusterAfterRegister, 64, 1);

    const vUnitsAt64 = await clusters.getClusterVUnits(clusterId);
    expect(vUnitsAt64).to.equal(2n * BPS_DENOMINATOR);

    await clusters.mockMinimumLiquidationCollateral(DEFAULT_ETH_REGISTER_VALUE + 1n);
    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterEB64);
    const liquidateReceipt = await liquidateTx.wait();
    const clusterAfterLiquidation = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    await clusters.mockMinimumLiquidationCollateral(0n);

    const baselineThreshold = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation,
      numOperators: BigInt(operatorIds.length),
      ethFee: operatorFeePacked,
      networkFee: networkFeePacked,
      effectiveVUnits: BPS_DENOMINATOR,
    });
    const thresholdAt64 = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation,
      numOperators: BigInt(operatorIds.length),
      ethFee: operatorFeePacked,
      networkFee: networkFeePacked,
      effectiveVUnits: vUnitsAt64,
    });
    expect(thresholdAt64).to.equal(baselineThreshold * 2n);

    await expect(
      clusters.reactivate(
        operatorIds,
        clusterAfterLiquidation,
        { value: baselineThreshold }
      )
    ).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);

    await expect(
      clusters.reactivate(
        operatorIds,
        clusterAfterLiquidation,
        { value: thresholdAt64 }
      )
    ).to.emit(clusters, Events.CLUSTER_REACTIVATED);
  });

  it("Enforces a much higher reactivation threshold when EB=2048", async function () {
    const operatorFeePacked = 100_000n;
    const operatorFee = operatorFeePacked * ETH_DEDUCTED_DIGITS;
    const networkFeePacked = 100_000n;
    const minimumBlocksBeforeLiquidation = 100n;
    const deployFixture = async () => ssvClustersHarnessFixture(connection, 4, operatorFee);
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

    await clusters.mockEthNetworkFee(networkFeePacked);
    await clusters.mockMinimumBlocksBeforeLiquidation(minimumBlocksBeforeLiquidation);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const clusterAfterRegister = await registerAndParseCluster(clusters, operatorIds);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const { cluster: clusterAfterEB2048 } = await mockEBAndUpdate(clusters, clusterOwner.address, operatorIds, clusterAfterRegister, 2048, 1);

    const vUnitsAt2048 = await clusters.getClusterVUnits(clusterId);
    expect(vUnitsAt2048).to.equal(64n * BPS_DENOMINATOR);

    await clusters.mockMinimumLiquidationCollateral(DEFAULT_ETH_REGISTER_VALUE + 1n);
    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterEB2048);
    const liquidateReceipt = await liquidateTx.wait();
    const clusterAfterLiquidation = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    await clusters.mockMinimumLiquidationCollateral(0n);

    const baselineThreshold = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation,
      numOperators: BigInt(operatorIds.length),
      ethFee: operatorFeePacked,
      networkFee: networkFeePacked,
      effectiveVUnits: BPS_DENOMINATOR,
    });
    const thresholdAt2048 = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation,
      numOperators: BigInt(operatorIds.length),
      ethFee: operatorFeePacked,
      networkFee: networkFeePacked,
      effectiveVUnits: vUnitsAt2048,
    });
    expect(thresholdAt2048).to.equal(baselineThreshold * 64n);

    await expect(
      clusters.reactivate(
        operatorIds,
        clusterAfterLiquidation,
        { value: thresholdAt2048 - 1n }
      )
    ).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);

    await expect(
      clusters.reactivate(
        operatorIds,
        clusterAfterLiquidation,
        { value: thresholdAt2048 }
      )
    ).to.emit(clusters, Events.CLUSTER_REACTIVATED);
  });

  it("Migrates a liquidated SSV cluster to ETH without requiring an EB snapshot", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const ssvCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    };

    const publicKey = makePublicKey(1);
    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

    const liquidateTx = await clusters.liquidateSSV(clusterOwner.address, operatorIds, ssvCluster);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);

    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      liquidatedCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const migrateReceipt = await migrateTx.wait();
    const clusterAfterMigration = parseClusterFromEvent(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

    await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);
    expect(clusterAfterMigration.active).to.equal(true);
    expect(clusterAfterMigration.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);

    await assertOperatorVUnits(clusters, operatorIds, 0n, 10_000n);
  });

  it("Migrates a liquidated SSV cluster to ETH using the stored EB snapshot when present", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const ssvCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    };

    const publicKey = makePublicKey(1);
    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    await clusters.mockSetClusterVUnits(clusterId, 12_000n);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(12_000n);

    const liquidateTx = await clusters.liquidateSSV(clusterOwner.address, operatorIds, ssvCluster);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      liquidatedCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    await migrateTx.wait();

    await assertOperatorVUnits(clusters, operatorIds, 2_000n, 12_000n);
  });

  it("Maintains daoTotalEthVUnits consistency through liquidation/reactivation", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    const cluster = await registerAndParseCluster(clusters, operatorIds, 1, ethers.parseEther("10"));
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const effectiveBalance = 1000;
    await mockEBAndUpdate(clusters, clusterOwner.address, operatorIds, cluster, effectiveBalance, 1);
    const initialDaoVUnits = await clusters.getDaoTotalEthVUnits();
    const clusterVUnits = await clusters.getClusterVUnits(clusterId);
    const baselineVUnits = cluster.validatorCount * BPS_DENOMINATOR;
    const expectedDeviation = clusterVUnits > baselineVUnits ? clusterVUnits - baselineVUnits : 0n;
    const totalDeviationToSubtract = expectedDeviation * BigInt(operatorIds.length);
    const expectedAfterLiquidation = totalDeviationToSubtract > initialDaoVUnits ? 0n : initialDaoVUnits - totalDeviationToSubtract;
    const liquidateTx = await clusters.liquidate(
      clusterOwner.address,
      operatorIds,
      cluster
    );
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
    const afterLiquidation = await clusters.getDaoTotalEthVUnits();
    expect(afterLiquidation).to.equal(expectedAfterLiquidation);
    const reactivateTx = await clusters.reactivate(
      operatorIds,
      liquidatedCluster,
      { value: ethers.parseEther("20") }
    );
    await reactivateTx.wait();
    const afterReactivation = await clusters.getDaoTotalEthVUnits();
    expect(afterReactivation).to.equal(initialDaoVUnits);
    const finalClusterVUnits = await clusters.getClusterVUnits(clusterId);
    expect(finalClusterVUnits).to.equal(clusterVUnits);
    const ebSnapshotAfterReactivation = await clusters.getClusterVUnits(clusterId);
    let expectedVUnits = ((BigInt(effectiveBalance) * BPS_DENOMINATOR) + 31n) / 32n;
    expect(ebSnapshotAfterReactivation).to.equal(expectedVUnits);
    expectedVUnits = ((BigInt(effectiveBalance) * BPS_DENOMINATOR) + 31n) / 32n;
    expect(finalClusterVUnits).to.equal(expectedVUnits, "EB vUnits should match original effective balance calculation");
    const finalBaselineVUnits = liquidatedCluster.validatorCount * BPS_DENOMINATOR;
    const finalDeviation = finalClusterVUnits > finalBaselineVUnits ? finalClusterVUnits - finalBaselineVUnits : 0n;
    expect(finalDeviation).to.equal(expectedDeviation, "Deviation should be preserved through liquidation/reactivation");
    await assertOperatorVUnits(clusters, operatorIds, finalDeviation);
  });

  it("Maintains accounting consistency across multiple liquidation/reactivation cycles", async function () {
    const operatorFee = 5_000_000_000n;
    const deployFixture = async () => ssvClustersHarnessFixture(connection, 4, operatorFee);
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

    const clusterAfterRegister = await registerAndParseCluster(clusters, operatorIds, 1, ethers.parseEther("10"));
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const { cluster: clusterAfterEB } = await mockEBAndUpdate(clusters, clusterOwner.address, operatorIds, clusterAfterRegister, 96, 1);

    const clusterVUnits = await clusters.getClusterVUnits(clusterId);
    const baselineVUnits = clusterAfterEB.validatorCount * BPS_DENOMINATOR;
    const expectedDeviation = clusterVUnits - baselineVUnits;
    const initialDaoVUnits = await clusters.getDaoTotalEthVUnits();

    expect(clusterVUnits).to.equal(3n * BPS_DENOMINATOR);
    expect(expectedDeviation).to.equal(2n * BPS_DENOMINATOR);
    await assertOperatorVUnits(clusters, operatorIds, expectedDeviation);

    await networkHelpers.mine(200);
    const liquidateTx1 = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterEB);
    const liquidateReceipt1 = await liquidateTx1.wait();
    const clusterAfterLiquidation1 = parseClusterFromEvent(clusters, liquidateReceipt1, Events.CLUSTER_LIQUIDATED);

    expect(clusterAfterLiquidation1.active).to.equal(false);
    expect(clusterAfterLiquidation1.balance).to.equal(0n);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    await assertOperatorVUnits(clusters, operatorIds, 0n);

    const cycle1Deposit = ethers.parseEther("3");
    const reactivateTx1 = await clusters.reactivate(
      operatorIds,
      clusterAfterLiquidation1,
      { value: cycle1Deposit }
    );
    const reactivateReceipt1 = await reactivateTx1.wait();
    const clusterAfterReactivation1 = parseClusterFromEvent(clusters, reactivateReceipt1, Events.CLUSTER_REACTIVATED);

    expect(clusterAfterReactivation1.active).to.equal(true);
    expect(clusterAfterReactivation1.balance).to.equal(cycle1Deposit);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(initialDaoVUnits);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(clusterVUnits);
    await assertOperatorVUnits(clusters, operatorIds, expectedDeviation);

    await networkHelpers.mine(200);
    const liquidateTx2 = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterReactivation1);
    const liquidateReceipt2 = await liquidateTx2.wait();
    const clusterAfterLiquidation2 = parseClusterFromEvent(clusters, liquidateReceipt2, Events.CLUSTER_LIQUIDATED);

    expect(clusterAfterLiquidation2.active).to.equal(false);
    expect(clusterAfterLiquidation2.balance).to.equal(0n);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    await assertOperatorVUnits(clusters, operatorIds, 0n);

    const cycle2Deposit = ethers.parseEther("7");
    const reactivateTx2 = await clusters.reactivate(
      operatorIds,
      clusterAfterLiquidation2,
      { value: cycle2Deposit }
    );
    const reactivateReceipt2 = await reactivateTx2.wait();
    const clusterAfterReactivation2 = parseClusterFromEvent(clusters, reactivateReceipt2, Events.CLUSTER_REACTIVATED);

    expect(clusterAfterReactivation2.active).to.equal(true);
    expect(clusterAfterReactivation2.balance).to.equal(cycle2Deposit);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(initialDaoVUnits);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(clusterVUnits);
    await assertOperatorVUnits(clusters, operatorIds, expectedDeviation);
  });

  it("Accrues operator earnings across cycles without double-counting", async function () {
    const operatorFee = 10_000_000_000n;
    const activeBlocksPerCycle = 120;
    const deployFixture = async () => ssvClustersHarnessFixture(connection, 4, operatorFee);
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

    const clusterAfterRegister = await registerAndParseCluster(clusters, operatorIds, 1, ethers.parseEther("10"));
    const trackedOperator = operatorIds[0];
    const initialEarnings = await getOperatorEthEarnings(clusters, trackedOperator);

    await networkHelpers.mine(activeBlocksPerCycle);
    const liquidateTx1 = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterRegister);
    const liquidateReceipt1 = await liquidateTx1.wait();
    const clusterAfterLiquidation1 = parseClusterFromEvent(clusters, liquidateReceipt1, Events.CLUSTER_LIQUIDATED);
    const earningsAfterLiquidation1 = await getOperatorEthEarnings(clusters, trackedOperator);
    const cycle1Increment = earningsAfterLiquidation1 - initialEarnings;
    expect(cycle1Increment).to.be.gt(0n);

    await networkHelpers.mine(300);
    const reactivateTx1 = await clusters.reactivate(
      operatorIds,
      clusterAfterLiquidation1,
      { value: ethers.parseEther("4") }
    );
    const reactivateReceipt1 = await reactivateTx1.wait();
    const clusterAfterReactivation1 = parseClusterFromEvent(clusters, reactivateReceipt1, Events.CLUSTER_REACTIVATED);
    const earningsAfterReactivation1 = await getOperatorEthEarnings(clusters, trackedOperator);
    expect(earningsAfterReactivation1).to.equal(earningsAfterLiquidation1);

    await networkHelpers.mine(activeBlocksPerCycle);
    const liquidateTx2 = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterReactivation1);
    const liquidateReceipt2 = await liquidateTx2.wait();
    const clusterAfterLiquidation2 = parseClusterFromEvent(clusters, liquidateReceipt2, Events.CLUSTER_LIQUIDATED);
    const earningsAfterLiquidation2 = await getOperatorEthEarnings(clusters, trackedOperator);
    const cycle2Increment = earningsAfterLiquidation2 - earningsAfterReactivation1;

    expect(cycle2Increment).to.equal(cycle1Increment);
    expect(earningsAfterLiquidation2 - initialEarnings).to.equal(cycle1Increment + cycle2Increment);

    await networkHelpers.mine(200);
    const reactivateTx2 = await clusters.reactivate(
      operatorIds,
      clusterAfterLiquidation2,
      { value: ethers.parseEther("5") }
    );
    await reactivateTx2.wait();
    const earningsAfterReactivation2 = await getOperatorEthEarnings(clusters, trackedOperator);
    expect(earningsAfterReactivation2).to.equal(earningsAfterLiquidation2);
  });
});
