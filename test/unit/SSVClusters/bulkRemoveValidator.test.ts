import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { getClustersHarnessFixture, ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, makePublicKeys, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVClusters function `bulkRemoveValidator()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let deployClustersWith7Operators!: ReturnType<typeof getClustersHarnessFixture>;
  let deployClustersWith10Operators!: ReturnType<typeof getClustersHarnessFixture>;
  let deployClustersWith13Operators!: ReturnType<typeof getClustersHarnessFixture>;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner] = await connection.ethers.getSigners();

    deployClustersWith7Operators = getClustersHarnessFixture(connection, 7);
    deployClustersWith10Operators = getClustersHarnessFixture(connection, 10);
    deployClustersWith13Operators = getClustersHarnessFixture(connection, 13);
  });

  const deploySSVClustersAndPrepareOperatorsFixture = async () => {
    return ssvClustersHarnessFixture(connection);
  };

  it("Removes multiple validators, updates cluster state and emits correct events", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];

    const registerTx = await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await clusters.bulkRemoveValidator(publicKeys, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    await expect(removeTx).to.emit(clusters, Events.VALIDATOR_REMOVED);
    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(clusterAfterRemove.active).to.equal(true);
  });

  it("Removes 10 validators with 4 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const registerTx = await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await clusters.bulkRemoveValidator(publicKeys, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    await trackGasFromReceipt(removeReceipt, [GasGroup.BULK_REMOVE_10_VALIDATOR_4]);
  });

  it("Removes 10 validators with 7 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const registerTx = await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await clusters.bulkRemoveValidator(publicKeys, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    await trackGasFromReceipt(removeReceipt, [GasGroup.BULK_REMOVE_10_VALIDATOR_7]);
  });

  it("Removes 10 validators with 10 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const registerTx = await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await clusters.bulkRemoveValidator(publicKeys, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    await trackGasFromReceipt(removeReceipt, [GasGroup.BULK_REMOVE_10_VALIDATOR_10]);
  });

  it("Removes 10 validators with 13 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const registerTx = await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await clusters.bulkRemoveValidator(publicKeys, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    await trackGasFromReceipt(removeReceipt, [GasGroup.BULK_REMOVE_10_VALIDATOR_13]);
  });

  it("Is reverted with 'ValidatorDoesNotExist' when no public keys are provided", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await expect(clusters.bulkRemoveValidator(
      [],
      operatorIds,
      createCluster()
    )).to.be.revertedWithCustomError(clusters, Errors.VALIDATOR_DOES_NOT_EXIST);
  });

  it("Is reverted with 'IncorrectValidatorStateWithData' when trying to remove non-existent validators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    const registerTx = await clusters.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const missingKey = makePublicKey(2);
    await expect(clusters.bulkRemoveValidator(
      [missingKey],
      operatorIds,
      clusterAfterRegister
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_VALIDATOR_STATE_WITH_DATA).withArgs(missingKey);
  });

  it("Is reverted with 'IncorrectClusterState' when provided cluster data is stale or mismatched", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];
    const registerTx = await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const mismatchedCluster = {
      ...clusterAfterRegister,
      balance: clusterAfterRegister.balance + 1n,
    };

    await expect(clusters.bulkRemoveValidator(
      publicKeys,
      operatorIds,
      mismatchedCluster
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("Is reverted with 'ClusterDoesNotExists' when attempting to remove from a missing cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await expect(clusters.bulkRemoveValidator(
      [makePublicKey(1)],
      operatorIds,
      createCluster()
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_DOES_NOT_EXISTS);
  });
});
