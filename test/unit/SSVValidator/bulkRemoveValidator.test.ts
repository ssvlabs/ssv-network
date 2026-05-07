import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ethers } from "ethers";
import { getValidatorsHarnessFixture, ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import { defaultValidatorsFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, createCluster, makePublicKey, makePublicKeys, parseClusterFromEvent, computeClusterId } from "../../common/helpers.ts";
import { createLegacySSVCluster } from "../../helpers/cluster.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, BPS_DENOMINATOR } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVClusters function `bulkRemoveValidator()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let deployClustersWith7Operators!: ReturnType<typeof getValidatorsHarnessFixture>;
  let deployClustersWith10Operators!: ReturnType<typeof getValidatorsHarnessFixture>;
  let deployClustersWith13Operators!: ReturnType<typeof getValidatorsHarnessFixture>;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner] } = await setupTestContext());

    deployClustersWith7Operators = getValidatorsHarnessFixture(connection, 7);
    deployClustersWith10Operators = getValidatorsHarnessFixture(connection, 10);
    deployClustersWith13Operators = getValidatorsHarnessFixture(connection, 13);
  });

  const deploySSVValidatorsAndPrepareOperatorsFixture = async () => {
    return defaultValidatorsFixture(connection);
  };

  const deploySSVClustersAndPrepareOperatorsFixture = async () => {
    return ssvClustersHarnessFixture(connection);
  };

  it("Removes multiple validators, updates cluster state and emits correct events", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];

    const registerTx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await validators.bulkRemoveValidator(publicKeys, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(validators, removeReceipt, Events.VALIDATOR_REMOVED);

    await expect(removeTx).to.emit(validators, Events.VALIDATOR_REMOVED);
    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(clusterAfterRemove.active).to.equal(true);
  });

  it("Updates operatorEthVUnits on bulk register/remove even when cluster EB snapshot is not set", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];

    const registerTx = await validators.connect(clusterOwner).bulkRegisterValidator(
      publicKeys,
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    for (const operatorId of operatorIds) {
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await validators.getEffectiveOperatorVUnits(operatorId)).to.equal(2n * BPS_DENOMINATOR);
    }

    const removeTx = await validators.connect(clusterOwner).bulkRemoveValidator(publicKeys, operatorIds, clusterAfterRegister);
    await removeTx.wait();

    for (const operatorId of operatorIds) {
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await validators.getEffectiveOperatorVUnits(operatorId)).to.equal(0n);
    }

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    expect(await validators.getClusterVUnits(clusterId)).to.equal(0n);
  });

  it("Decrements stored EB snapshot vUnits when set and removing a subset of validators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2), makePublicKey(3)];

    const registerTx = await validators.connect(clusterOwner).bulkRegisterValidator(
      publicKeys,
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES, DEFAULT_SHARES],
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    await validators.mockSetClusterVUnits(clusterId, 3n * BPS_DENOMINATOR);

    const removeTx = await validators.connect(clusterOwner).bulkRemoveValidator(
      [publicKeys[0], publicKeys[1]],
      operatorIds,
      clusterAfterRegister
    );
    await removeTx.wait();

    expect(await validators.getClusterVUnits(clusterId)).to.equal(1n * BPS_DENOMINATOR);
    for (const operatorId of operatorIds) {
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await validators.getEffectiveOperatorVUnits(operatorId)).to.equal(1n * BPS_DENOMINATOR);
    }
  });

  it("Clears stored EB snapshot vUnits when removing the last validators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];

    const registerTx = await validators.connect(clusterOwner).bulkRegisterValidator(
      publicKeys,
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    await validators.mockSetClusterVUnits(clusterId, 2n * BPS_DENOMINATOR);

    const removeTx = await validators.connect(clusterOwner).bulkRemoveValidator(publicKeys, operatorIds, clusterAfterRegister);
    await removeTx.wait();

    expect(await validators.getClusterVUnits(clusterId)).to.equal(0n);
    for (const operatorId of operatorIds) {
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
  });

  it("Removes 10 validators with 4 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const registerTx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await validators.bulkRemoveValidator(publicKeys, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    await trackGasFromReceipt(removeReceipt, [GasGroup.BULK_REMOVE_10_VALIDATOR_4]);
  });

  it("Removes 10 validators with 7 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const registerTx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await validators.bulkRemoveValidator(publicKeys, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    await trackGasFromReceipt(removeReceipt, [GasGroup.BULK_REMOVE_10_VALIDATOR_7]);
  });

  it("Removes 10 validators with 10 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const registerTx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await validators.bulkRemoveValidator(publicKeys, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    await trackGasFromReceipt(removeReceipt, [GasGroup.BULK_REMOVE_10_VALIDATOR_10]);
  });

  it("Removes 10 validators with 13 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const registerTx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await validators.bulkRemoveValidator(publicKeys, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    await trackGasFromReceipt(removeReceipt, [GasGroup.BULK_REMOVE_10_VALIDATOR_13]);
  });

  it("Is reverted with 'ValidatorDoesNotExist' when no public keys are provided", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    await expect(validators.bulkRemoveValidator(
      [],
      operatorIds,
      createCluster()
    )).to.be.revertedWithCustomError(validators, Errors.VALIDATOR_DOES_NOT_EXIST);
  });

  it("Is reverted with 'ValidatorDoesNotExist' when trying to remove non-existent validators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    const registerTx = await validators.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const missingKey = makePublicKey(2);
    await expect(validators.bulkRemoveValidator(
      [missingKey],
      operatorIds,
      clusterAfterRegister
    )).to.be.revertedWithCustomError(validators, Errors.VALIDATOR_DOES_NOT_EXIST);
  });

  it("Is reverted with 'IncorrectClusterState' when provided cluster data is stale or mismatched", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];
    const registerTx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const mismatchedCluster = {
      ...clusterAfterRegister,
      balance: clusterAfterRegister.balance + 1n,
    };

    await expect(validators.bulkRemoveValidator(
      publicKeys,
      operatorIds,
      mismatchedCluster
    )).to.be.revertedWithCustomError(validators, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("Is reverted with 'ClusterDoesNotExists' when attempting to remove from a missing cluster", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    await expect(validators.bulkRemoveValidator(
      [makePublicKey(1)],
      operatorIds,
      createCluster()
    )).to.be.revertedWithCustomError(validators, Errors.CLUSTER_DOES_NOT_EXIST);
  });

  it("Bulk removes multiple validators from active legacy SSV cluster and decrements operator/DAO counts by N", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2), makePublicKey(3)];
    const ssvCluster = createLegacySSVCluster({ validatorCount: 3n });

    await clusters.mockRegisterSSVValidator(publicKeys[0], operatorIds, clusterOwner.address, ssvCluster);
    await clusters.mockRegisterSSVValidator(publicKeys[1], operatorIds, clusterOwner.address, ssvCluster);
    await clusters.mockRegisterSSVValidator(publicKeys[2], operatorIds, clusterOwner.address, ssvCluster);

    const operatorCountBefore = await clusters.getOperatorValidatorCount(operatorIds[0]);
    const daoCountBefore = await clusters.getDaoValidatorCount();

    const removeTx = await clusters.connect(clusterOwner).bulkRemoveValidator(
      [publicKeys[0], publicKeys[1]],
      operatorIds,
      ssvCluster
    );
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove.validatorCount).to.equal(1n);
    expect(clusterAfterRemove.active).to.equal(true);
    const removedEvents = (removeReceipt.logs ?? []).filter((log: any) => {
      try {
        return clusters.interface.parseLog(log)?.name === Events.VALIDATOR_REMOVED;
      } catch {
        return false;
      }
    });
    expect(removedEvents.length).to.equal(2);
    const operatorCountAfter = await clusters.getOperatorValidatorCount(operatorIds[0]);
    const daoCountAfter = await clusters.getDaoValidatorCount();
    expect(operatorCountAfter).to.equal(operatorCountBefore - 2n);
    expect(daoCountAfter).to.equal(daoCountBefore - 2n);
  });

  it("Reverts bulk removal atomically when one validator in batch is invalid", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const key1 = makePublicKey(1);
    const key2 = makePublicKey(2);
    const missingKey = makePublicKey(3);

    const registerTx = await validators.bulkRegisterValidator(
      [key1, key2],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const operatorCountBefore = await validators.getOperatorEthValidatorCount(operatorIds[0]);
    const daoCountBefore = await validators.getDaoEthValidatorCount();

    await expect(
      validators.bulkRemoveValidator([key1, missingKey, key2], operatorIds, clusterAfterRegister)
    )
      .to.be.revertedWithCustomError(validators, Errors.VALIDATOR_DOES_NOT_EXIST);

    expect(await validators.getOperatorEthValidatorCount(operatorIds[0])).to.equal(operatorCountBefore);
    expect(await validators.getDaoEthValidatorCount()).to.equal(daoCountBefore);
    expect(await validators.getValidatorData(key1, clusterOwner.address)).to.not.equal(ethers.ZeroHash);
    expect(await validators.getValidatorData(key2, clusterOwner.address)).to.not.equal(ethers.ZeroHash);
  });

  it("Reverts SSV bulk removal atomically when one validator in batch is invalid", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const key1 = makePublicKey(11);
    const key2 = makePublicKey(12);
    const missingKey = makePublicKey(13);
    const ssvCluster = createLegacySSVCluster({ validatorCount: 2n });

    await clusters.mockRegisterSSVValidator(key1, operatorIds, clusterOwner.address, ssvCluster);
    await clusters.mockRegisterSSVValidator(key2, operatorIds, clusterOwner.address, ssvCluster);

    const operatorCountBefore = await clusters.getOperatorValidatorCount(operatorIds[0]);
    const daoCountBefore = await clusters.getDaoValidatorCount();

    await expect(
      clusters.connect(clusterOwner).bulkRemoveValidator([key1, missingKey, key2], operatorIds, ssvCluster)
    )
      .to.be.revertedWithCustomError(clusters, Errors.VALIDATOR_DOES_NOT_EXIST);

    expect(await clusters.getOperatorValidatorCount(operatorIds[0])).to.equal(operatorCountBefore);
    expect(await clusters.getDaoValidatorCount()).to.equal(daoCountBefore);
    expect(await clusters.getValidatorData(key1, clusterOwner.address)).to.not.equal(ethers.ZeroHash);
    expect(await clusters.getValidatorData(key2, clusterOwner.address)).to.not.equal(ethers.ZeroHash);
  });

  it("Keeps reactivate blocked for SSV clusters after bulk removing to zero validators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const key = makePublicKey(21);
    const ssvCluster = createLegacySSVCluster({ validatorCount: 1n });
    await clusters.mockRegisterSSVValidator(key, operatorIds, clusterOwner.address, ssvCluster);

    const removeTx = await clusters.connect(clusterOwner).bulkRemoveValidator([key], operatorIds, ssvCluster);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(clusterAfterRemove.active).to.equal(true);

    await expect(
      clusters.connect(clusterOwner).reactivate(operatorIds, clusterAfterRemove, { value: DEFAULT_ETH_REGISTER_VALUE })
    ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);
  });

  it("SSV active cluster bulk-removes all 2 validators with explicit vUnits=640_000 — clears to 0", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const key1 = makePublicKey(51);
    const key2 = makePublicKey(52);
    const ssvCluster = createLegacySSVCluster({ validatorCount: 2n });

    await clusters.mockRegisterSSVValidator(key1, operatorIds, clusterOwner.address, ssvCluster);
    await clusters.mockRegisterSSVValidator(key2, operatorIds, clusterOwner.address, ssvCluster);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    await clusters.mockSetClusterVUnits(clusterId, 640_000n);

    const removeTx = await clusters
      .connect(clusterOwner)
      .bulkRemoveValidator([key1, key2], operatorIds, ssvCluster);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
  });

  it("SSV active cluster bulk-removes 1 of 2 validators — vUnits snapshot unchanged", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const key1 = makePublicKey(61);
    const key2 = makePublicKey(62);
    const ssvCluster = createLegacySSVCluster({ validatorCount: 2n });

    await clusters.mockRegisterSSVValidator(key1, operatorIds, clusterOwner.address, ssvCluster);
    await clusters.mockRegisterSSVValidator(key2, operatorIds, clusterOwner.address, ssvCluster);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const storedVUnits = 640_000n;
    await clusters.mockSetClusterVUnits(clusterId, storedVUnits);

    const removeTx = await clusters
      .connect(clusterOwner)
      .bulkRemoveValidator([key1], operatorIds, ssvCluster);
    await removeTx.wait();

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(storedVUnits);
  });

  it("SSV liquidated cluster bulk-removes all 2 validators — clears vUnits to 0, operator/DAO SSV counts not decremented", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const key1 = makePublicKey(71);
    const key2 = makePublicKey(72);
    const ssvClusterLiquidated = createLegacySSVCluster({ validatorCount: 2n, active: false });

    await clusters.mockRegisterSSVValidator(key1, operatorIds, clusterOwner.address, ssvClusterLiquidated);
    await clusters.mockRegisterSSVValidator(key2, operatorIds, clusterOwner.address, ssvClusterLiquidated);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    await clusters.mockSetClusterVUnits(clusterId, 640_000n);

    const operatorCountBefore = await clusters.getOperatorValidatorCount(operatorIds[0]);
    const daoCountBefore = await clusters.getDaoValidatorCount();

    const removeTx = await clusters
      .connect(clusterOwner)
      .bulkRemoveValidator([key1, key2], operatorIds, ssvClusterLiquidated);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
    expect(await clusters.getOperatorValidatorCount(operatorIds[0])).to.equal(operatorCountBefore);
    expect(await clusters.getDaoValidatorCount()).to.equal(daoCountBefore);
  });
});
