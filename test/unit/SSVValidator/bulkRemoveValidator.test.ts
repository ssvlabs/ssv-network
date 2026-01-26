import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvValidatorsHarnessFixture, getValidatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, makePublicKeys, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, VUNITS_PRECISION } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";
import { ethers } from "ethers";

describe("SSVClusters function `bulkRemoveValidator()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let deployClustersWith7Operators!: ReturnType<typeof getValidatorsHarnessFixture>;
  let deployClustersWith10Operators!: ReturnType<typeof getValidatorsHarnessFixture>;
  let deployClustersWith13Operators!: ReturnType<typeof getValidatorsHarnessFixture>;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner] = await connection.ethers.getSigners();

    deployClustersWith7Operators = getValidatorsHarnessFixture(connection, 7);
    deployClustersWith10Operators = getValidatorsHarnessFixture(connection, 10);
    deployClustersWith13Operators = getValidatorsHarnessFixture(connection, 13);
  });

  const deploySSVValidatorsAndPrepareOperatorsFixture = async () => {
    return ssvValidatorsHarnessFixture(connection);
  };

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
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
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(2n * VUNITS_PRECISION);
    }

    const removeTx = await validators.connect(clusterOwner).bulkRemoveValidator(publicKeys, operatorIds, clusterAfterRegister);
    await removeTx.wait();

    for (const operatorId of operatorIds) {
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
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

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    await validators.mockSetClusterVUnits(clusterId, 3n * VUNITS_PRECISION);

    const removeTx = await validators.connect(clusterOwner).bulkRemoveValidator(
      [publicKeys[0], publicKeys[1]],
      operatorIds,
      clusterAfterRegister
    );
    await removeTx.wait();

    expect(await validators.getClusterVUnits(clusterId)).to.equal(1n * VUNITS_PRECISION);
    for (const operatorId of operatorIds) {
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(1n * VUNITS_PRECISION);
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

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    await validators.mockSetClusterVUnits(clusterId, 2n * VUNITS_PRECISION);

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

  it("Is reverted with 'IncorrectValidatorStateWithData' when trying to remove non-existent validators", async function () {
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
    )).to.be.revertedWithCustomError(validators, Errors.INCORRECT_VALIDATOR_STATE_WITH_DATA).withArgs(missingKey);
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
    )).to.be.revertedWithCustomError(validators, Errors.CLUSTER_DOES_NOT_EXISTS);
  });
});
