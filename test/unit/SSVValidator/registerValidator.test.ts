import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from '../../setup/connection.ts';
import { ssvValidatorsHarnessFixture, getValidatorsHarnessFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType } from '../../common/types.ts';
import { makePublicKey, parseClusterFromEvent } from '../../common/helpers.ts';
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, EMPTY_CLUSTER } from '../../common/constants.ts';
import { Events } from '../../common/events.ts';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { Errors } from '../../common/errors.ts';
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVClusters function `registerValidator()`", async () => {
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

  it("Registers a new validator, creates new cluster with the expected data and emits correct events", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    const tx = await validators.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    // todo check args with pre-calculated cluster
    await expect(tx).to.emit(validators, Events.VALIDATOR_ADDED);
  });

  it("Registers a new validator with 7 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    const tx = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]);
  });

  it("Registers a validator into an existing cluster with 7 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    const registerTx = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const tx = await validators.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfterRegister,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_7]);
  });

  it("Registers a validator without additional deposit with 7 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    const registerTx = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE * 2n }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const tx = await validators.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfterRegister,
      { value: 0 }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_7]);
  });

  it("Registers a new validator with 10 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    const tx = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE_10]);
  });

  it("Registers a validator into an existing cluster with 10 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    const registerTx = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const tx = await validators.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfterRegister,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_10]);
  });

  it("Registers a validator without additional deposit with 10 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    const registerTx = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE * 2n }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const tx = await validators.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfterRegister,
      { value: 0 }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_10]);
  });

  it("Registers a new validator with 13 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const tx = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]);
  });

  it("Registers a validator into an existing cluster with 13 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const registerTx = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const tx = await validators.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfterRegister,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_13]);
  });

  it("Registers a validator without additional deposit with 13 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const registerTx = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE * 2n }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const tx = await validators.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfterRegister,
      { value: 0 }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_13]);
  });

  it("Is reverted with 'InvalidPublicKeyLength' when public key is empty or has invalid length", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const emptyPublicKey = '0x';
    const invalidLengthPublicKey = makePublicKey(1) + "11";

    await expect(validators.registerValidator(
      emptyPublicKey,
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.INVALID_PUBLIC_KEYS_LENGTH);

    await expect(validators.registerValidator(
      invalidLengthPublicKey,
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.INVALID_PUBLIC_KEYS_LENGTH);
  });

  it("Is reverted with 'PublicKeysSharesLengthMismatch' if there is a mismatch between public keys and shares", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    await expect(validators.bulkRegisterValidator(
      [makePublicKey(1)], // 1 pk
      operatorIds,
      [], // 0 shares
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.PUBLIC_KEYS_SHARES_LENGTH_MISMATCH);
  });

  it("Is reverted with 'ValidatorAlreadyExistsWithData' if trying to register already existing key", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    await validators.registerValidator(publicKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE });

    await expect(validators.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
      )).to.be.revertedWithCustomError(validators, Errors.VALIDATOR_ALREADY_EXISTS_WITH_DATA).withArgs(publicKey);
  });

  it("Is reverted with 'InvalidOperatorIdsLength' if the length is not allowed one for clusters", async function () {
    const { validators } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);
    const operatorIds = [2n, 1n, 2n];

    await expect(validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.INVALID_OPERATOR_IDS_LENGTH);
  });

  it("Is reverted with 'UnsortedOperatorsList' if the list of operator ids is not sorted", async function () {
    const { validators } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);
    const operatorIds = [4n, 3n, 2n, 1n]; // no duplicates, just unsorted

    await expect(validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.UNSORTED_OPERATORS_LIST);
  });

  it("Is reverted with 'OperatorsListNotUnique' if the list of operator ids has duplications", async function () {
    const { validators } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);
    let operatorIds = [1n, 1n, 2n, 4n]; // sorted but has duplicate

    await expect(validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.OPERATORS_LIST_NOT_UNIQUE);
  });

  it("Is reverted with 'ClusterIsLiquidated' when trying to register to a liquidated cluster", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);
    await validators.mockSetClusterLiquidated(clusterOwner.address, operatorIds);

    EMPTY_CLUSTER.active = false;

    await expect(validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.CLUSTER_IS_LIQUIDATED);
  });
});
