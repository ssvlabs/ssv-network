import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, EMPTY_CLUSTER } from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVClusters function `migrateClusterToETH()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner] = await connection.ethers.getSigners();
  });

  const deploySSVClustersAndPrepareOperatorsFixture = async () => {
    return ssvClustersHarnessFixture(connection);
  };

  it("Migrates an existing SSV cluster to ETH and emits the expected event", async function () {
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

    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await migrateTx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.MIGRATE_CLUSTER_TO_ETH]);
    const clusterAfterMigration = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

    await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);
    expect(clusterAfterMigration.active).to.equal(true);
    expect(clusterAfterMigration.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
    expect(clusterAfterMigration.validatorCount).to.equal(ssvCluster.validatorCount);
  });

  it("Is reverted with 'IncorrectClusterVersion' when migrating an ETH cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    // Register validator to create an ETH cluster, then attempt migration (expects SSV cluster).
    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      { ...EMPTY_CLUSTER },
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const ethCluster = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    await expect(clusters.migrateClusterToETH(
      operatorIds,
      ethCluster
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);
  });

  it("Is reverted with 'ClusterDoesNotExists' when migrating a missing cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await expect(clusters.migrateClusterToETH(
      operatorIds,
      { ...EMPTY_CLUSTER }
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_DOES_NOT_EXISTS);
  });
});
