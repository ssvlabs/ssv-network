import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvValidatorsHarnessFixture, getValidatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVClusters function `removeValidator()`", async () => {
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

  it("Removes an existing validator, updates cluster state and emits correct events", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    const registerTx = await validators.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await validators.removeValidator(publicKey, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(validators, removeReceipt, Events.VALIDATOR_REMOVED);

    await expect(removeTx).to.emit(validators, Events.VALIDATOR_REMOVED);
    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(clusterAfterRemove.active).to.equal(true);
  });

  it("Removes a validator with 7 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    const publicKey = makePublicKey(1);

    const registerTx = await validators.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await validators.removeValidator(publicKey, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    await trackGasFromReceipt(removeReceipt, [GasGroup.REMOVE_VALIDATOR_7]);
  });

  it("Removes a validator with 10 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    const publicKey = makePublicKey(1);

    const registerTx = await validators.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await validators.removeValidator(publicKey, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    await trackGasFromReceipt(removeReceipt, [GasGroup.REMOVE_VALIDATOR_10]);
  });

  it("Removes a validator with 13 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const publicKey = makePublicKey(1);

    const registerTx = await validators.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await validators.removeValidator(publicKey, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    await trackGasFromReceipt(removeReceipt, [GasGroup.REMOVE_VALIDATOR_13]);
  });

  it("Is reverted with 'ValidatorDoesNotExist' when validator was not registered", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const registeredKey = makePublicKey(1);
    const registerTx = await validators.registerValidator(
      registeredKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const nonExistingKey = makePublicKey(2);
    await expect(validators.removeValidator(
      nonExistingKey,
      operatorIds,
      clusterAfterRegister
    )).to.be.revertedWithCustomError(validators, Errors.INCORRECT_VALIDATOR_STATE);
  });

  it("Is reverted with 'IncorrectClusterState' when provided cluster data is stale or mismatched", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    const registerTx = await validators.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const mismatchedCluster = {
      ...clusterAfterRegister,
      balance: clusterAfterRegister.balance + 1n,
    };

    await expect(validators.removeValidator(
      publicKey,
      operatorIds,
      mismatchedCluster
    )).to.be.revertedWithCustomError(validators, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("Is reverted with 'ClusterDoesNotExists' when attempting to remove from a missing cluster", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    await expect(validators.removeValidator(
      makePublicKey(1),
      operatorIds,
      createCluster()
    )).to.be.revertedWithCustomError(validators, Errors.CLUSTER_DOES_NOT_EXISTS);
  });

  it("Is reverted with 'ValidatorDoesNotExist' when removing a validator twice", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    const registerTx = await validators.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await validators.removeValidator(publicKey, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(validators, removeReceipt, Events.VALIDATOR_REMOVED);

    await expect(validators.removeValidator(
      publicKey,
      operatorIds,
      clusterAfterRemove
    )).to.be.revertedWithCustomError(validators, Errors.INCORRECT_VALIDATOR_STATE);
  });
});
