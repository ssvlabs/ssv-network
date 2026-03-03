import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, VUNITS_PRECISION, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";
import { ethers } from "ethers";

describe("SSVClusters function `reactivate()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let otherAccount: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner, otherAccount] = await connection.ethers.getSigners();
  });

  const deploySSVClustersAndPrepareOperatorsFixture = async () => {
    return ssvClustersHarnessFixture(connection);
  };

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
  };

  const createAndFundCluster = async (clusters: any, operatorIds: bigint[], depositValue: bigint) => {
    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: depositValue }
    );
    const receipt = await registerTx.wait();
    return parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);
  };

  const setEB = async (clusters: any, clusterId: string, effectiveBalance: number, cluster: any, operatorIds: bigint[]) => {
    const blockNum = 1;
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const innerHash = ethers.keccak256(coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance]));
    const root = ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
    
    await clusters.mockSetEBRoot(blockNum, root);
    const updateTx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    );
    const updateReceipt = await updateTx.wait();
    return parseClusterFromEvent(clusters, updateReceipt, Events.CLUSTER_BALANCE_UPDATED);
  };

  const liquidationThresholdForVUnits = (
    vUnits: bigint,
    operatorFeePacked: bigint,
    operatorsCount: number,
    networkFeePacked: bigint,
    minimumBlocksBeforeLiquidation: bigint
  ): bigint => {
    const burnRatePacked = operatorFeePacked * BigInt(operatorsCount);
    return ((minimumBlocksBeforeLiquidation * (burnRatePacked + networkFeePacked) * vUnits) / VUNITS_PRECISION) * ETH_DEDUCTED_DIGITS;
  };

  const registerAndLiquidate = async (clusters: any, operatorIds: bigint[]) => {
    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterRegister);
    const liquidateReceipt = await liquidateTx.wait();
    const clusterAfterLiquidation = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    return { clusterAfterRegister, clusterAfterLiquidation };
  };

  it("Reactivates a liquidated cluster with sufficient balance and emits correct event", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, operatorIds);

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

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, operatorIds);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }

    const reactivateTx = await clusters.reactivate(
      operatorIds,
      clusterAfterLiquidation,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    await reactivateTx.wait();

    const baselineVUnits = clusterAfterLiquidation.validatorCount * VUNITS_PRECISION;
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(baselineVUnits);
    }
  });

  it("Is reverted with 'ClusterAlreadyEnabled' when trying to reactivate an active cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    await expect(clusters.reactivate(
      operatorIds,
      clusterAfterRegister,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_ALREADY_ENABLED);
  });

  it("Is reverted with 'ClusterDoesNotExists' when a non-owner tries to reactivate a cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, operatorIds);

    await expect(clusters.connect(otherAccount).reactivate(
      operatorIds,
      clusterAfterLiquidation,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_DOES_NOT_EXIST);
  });

  it("Is reverted with 'IncorrectClusterState' when provided cluster data is stale or mismatched", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, operatorIds);

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

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, operatorIds);

    // Make minimum collateral slightly higher than the provided deposit to force insufficiency.
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

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, operatorIds);

    // Increase liquidation runway requirements only for the reactivation call.
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

    const clusterAfterRegister = await createAndFundCluster(clusters, operatorIds, DEFAULT_ETH_REGISTER_VALUE);
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const clusterAfterEB64 = await setEB(clusters, clusterId, 64, clusterAfterRegister, operatorIds);

    const vUnitsAt64 = await clusters.getClusterVUnits(clusterId);
    expect(vUnitsAt64).to.equal(2n * VUNITS_PRECISION);

    await clusters.mockMinimumLiquidationCollateral(DEFAULT_ETH_REGISTER_VALUE + 1n);
    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterEB64);
    const liquidateReceipt = await liquidateTx.wait();
    const clusterAfterLiquidation = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    await clusters.mockMinimumLiquidationCollateral(0n);

    const baselineThreshold = liquidationThresholdForVUnits(
      VUNITS_PRECISION,
      operatorFeePacked,
      operatorIds.length,
      networkFeePacked,
      minimumBlocksBeforeLiquidation
    );
    const thresholdAt64 = liquidationThresholdForVUnits(
      vUnitsAt64,
      operatorFeePacked,
      operatorIds.length,
      networkFeePacked,
      minimumBlocksBeforeLiquidation
    );
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

    const clusterAfterRegister = await createAndFundCluster(clusters, operatorIds, DEFAULT_ETH_REGISTER_VALUE);
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const clusterAfterEB2048 = await setEB(clusters, clusterId, 2048, clusterAfterRegister, operatorIds);

    const vUnitsAt2048 = await clusters.getClusterVUnits(clusterId);
    expect(vUnitsAt2048).to.equal(64n * VUNITS_PRECISION);

    await clusters.mockMinimumLiquidationCollateral(DEFAULT_ETH_REGISTER_VALUE + 1n);
    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterEB2048);
    const liquidateReceipt = await liquidateTx.wait();
    const clusterAfterLiquidation = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    await clusters.mockMinimumLiquidationCollateral(0n);

    const baselineThreshold = liquidationThresholdForVUnits(
      VUNITS_PRECISION,
      operatorFeePacked,
      operatorIds.length,
      networkFeePacked,
      minimumBlocksBeforeLiquidation
    );
    const thresholdAt2048 = liquidationThresholdForVUnits(
      vUnitsAt2048,
      operatorFeePacked,
      operatorIds.length,
      networkFeePacked,
      minimumBlocksBeforeLiquidation
    );
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

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
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

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n); // deviation only
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(10_000n); // baseline + deviation
    }
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

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
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

    for (const operatorId of operatorIds) {
      // Explicit snapshot of 12000 vUnits with baseline of 10000 (1 validator) = deviation of 2000
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(2_000n); // deviation only
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(12_000n); // baseline + deviation
    }
  });

  it("Maintains daoTotalEthVUnits consistency through liquidation/reactivation", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    
    // Create cluster with EB deviation
    const cluster = await createAndFundCluster(clusters, operatorIds, ethers.parseEther("10"));
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    
    // Set EB to create deviation (1000 ETH, 31.25x baseline)
    const effectiveBalance = 1000;
    await setEB(clusters, clusterId, effectiveBalance, cluster, operatorIds);
    
    // Get initial DAO vUnits
    const initialDaoVUnits = await clusters.getDaoTotalEthVUnits();
    const clusterVUnits = await clusters.getClusterVUnits(clusterId);
    const baselineVUnits = cluster.validatorCount * VUNITS_PRECISION;
    
    // Calculate expected deviation (EB creates positive deviation)
    const expectedDeviation = clusterVUnits > baselineVUnits ? clusterVUnits - baselineVUnits : 0n;
    
    // The liquidation subtracts deviation from each operator, but DAO vUnits can't go negative
    const totalDeviationToSubtract = expectedDeviation * BigInt(operatorIds.length);
    const expectedAfterLiquidation = totalDeviationToSubtract > initialDaoVUnits ? 0n : initialDaoVUnits - totalDeviationToSubtract;
    
    // Liquidate cluster
    const liquidateTx = await clusters.liquidate(
      clusterOwner.address,
      operatorIds,
      cluster
    );
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
    
    // Verify DAO vUnits decreased correctly (can't go negative)
    const afterLiquidation = await clusters.getDaoTotalEthVUnits();
    expect(afterLiquidation).to.equal(expectedAfterLiquidation);
    
    // Reactivate cluster using the liquidated cluster state
    const reactivateTx = await clusters.reactivate(
      operatorIds,
      liquidatedCluster,
      { value: ethers.parseEther("20") }
    );
    await reactivateTx.wait();
    
    // Verify DAO vUnits restored to initial value
    const afterReactivation = await clusters.getDaoTotalEthVUnits();
    expect(afterReactivation).to.equal(initialDaoVUnits);
    
    // Verify EB snapshot preserved through liquidation/reactivation cycle
    const finalClusterVUnits = await clusters.getClusterVUnits(clusterId);
    expect(finalClusterVUnits).to.equal(clusterVUnits);
    
    // Additional EB preservation checks:
    // 1. Verify the EB snapshot still exists after reactivation
    const ebSnapshotAfterReactivation = await clusters.getClusterVUnits(clusterId);
    expect(ebSnapshotAfterReactivation).to.be.greaterThan(0, "EB snapshot should still exist after reactivation");
    
    // 2. Verify the EB value matches the original effective balance
    const expectedVUnits = ((BigInt(effectiveBalance) * VUNITS_PRECISION) + 31n) / 32n;
    expect(finalClusterVUnits).to.equal(expectedVUnits, "EB vUnits should match original effective balance calculation");
    
    // 3. Verify the deviation is still correctly calculated
    const finalBaselineVUnits = liquidatedCluster.validatorCount * VUNITS_PRECISION;
    const finalDeviation = finalClusterVUnits > finalBaselineVUnits ? finalClusterVUnits - finalBaselineVUnits : 0n;
    expect(finalDeviation).to.equal(expectedDeviation, "Deviation should be preserved through liquidation/reactivation");
    
    // 4. Verify operator deviation vUnits are preserved
    for (const operatorId of operatorIds) {
      const operatorEthVUnits = await clusters.getOperatorEthVUnits(operatorId);
      expect(operatorEthVUnits).to.equal(finalDeviation, "Each operator should have the deviation vUnits preserved");
    }
  });
});
