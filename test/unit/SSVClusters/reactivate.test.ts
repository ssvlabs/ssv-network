import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES } from "../../common/constants.ts";
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
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_DOES_NOT_EXISTS);
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
      0,
      clusterAfterLiquidation,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);

    const reactivateTx = await clusters.reactivate(
      operatorIds,
      0,
      clusterAfterLiquidation,
      { value: ethers.parseEther("30") }
    );
    await reactivateTx.wait();
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
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(10_000n);
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
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(12_000n);
    }
  });
});
