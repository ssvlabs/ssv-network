import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { getTestConnection } from '../../setup/connection.ts';
import { ssvValidatorsHarnessFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType } from '../../common/types.ts';
import { makePublicKey } from '../../common/helpers.ts';
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, EMPTY_CLUSTER } from '../../common/constants.ts';
import { Events } from '../../common/events.ts';
import { Errors } from '../../common/errors.ts';

describe("SSVClusters function `bulkRegisterValidator()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;

  const createCluster = (overrides: Partial<typeof EMPTY_CLUSTER> = {}) => ({
    ...EMPTY_CLUSTER,
    active: true,
    ...overrides,
  });

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner] = await connection.ethers.getSigners();
  });

  const deploySSVValidatorsAndPrepareOperatorsFixture = async () => {
    return ssvValidatorsHarnessFixture(connection);
  };

  it("Registers multiple validators, creates new cluster with the expected data and emits correct events", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];
    const shares = [DEFAULT_SHARES, DEFAULT_SHARES];

    const tx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    // todo check args with pre-calculated cluster
    await expect(tx).to.emit(validators, Events.VALIDATOR_ADDED);
  });

  it("Is reverted with 'EmptyPublicKeysList' when no public keys are provided", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    await expect(validators.bulkRegisterValidator(
      [],
      operatorIds,
      [],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.EMPTY_PUBLIC_KEYS_LIST);
  });

  it("Is reverted with 'InvalidPublicKeyLength' when any public key is empty or has invalid length", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const emptyPublicKey = "0x";
    const invalidLengthPublicKey = makePublicKey(1) + "11";

    await expect(validators.bulkRegisterValidator(
      [emptyPublicKey],
      operatorIds,
      [DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.INVALID_PUBLIC_KEYS_LENGTH);

    await expect(validators.bulkRegisterValidator(
      [makePublicKey(1), invalidLengthPublicKey],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.INVALID_PUBLIC_KEYS_LENGTH);
  });

  it("Is reverted with 'PublicKeysSharesLengthMismatch' if there is a mismatch between public keys and shares", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    await expect(validators.bulkRegisterValidator(
      [makePublicKey(1), makePublicKey(2)], // 2 public keys
      operatorIds,
      [DEFAULT_SHARES], // only 1 share
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.PUBLIC_KEYS_SHARES_LENGTH_MISMATCH);
  });

  it("Is reverted with 'ValidatorAlreadyExistsWithData' if trying to register already existing key", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    await expect(validators.bulkRegisterValidator(
      [publicKey, publicKey],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.VALIDATOR_ALREADY_EXISTS_WITH_DATA).withArgs(publicKey);
  });

  it("Is reverted with 'InvalidOperatorIdsLength' if the length is not allowed one for clusters", async function () {
    const { validators } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);
    const operatorIds = [2n, 1n, 2n];

    await expect(validators.bulkRegisterValidator(
      [makePublicKey(1), makePublicKey(2)],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.INVALID_OPERATOR_IDS_LENGTH);
  });

  it("Is reverted with 'UnsortedOperatorsList' if the list of operator ids is not sorted", async function () {
    const { validators } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);
    const operatorIds = [4n, 3n, 2n, 1n]; // no duplicates, just unsorted

    await expect(validators.bulkRegisterValidator(
      [makePublicKey(1), makePublicKey(2)],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.UNSORTED_OPERATORS_LIST);
  });

  it("Is reverted with 'OperatorsListNotUnique' if the list of operator ids has duplications", async function () {
    const { validators } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);
    const operatorIds = [1n, 1n, 2n, 4n]; // sorted but has duplicate

    await expect(validators.bulkRegisterValidator(
      [makePublicKey(1), makePublicKey(2)],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.OPERATORS_LIST_NOT_UNIQUE);
  });

  it("Is reverted with 'ClusterIsLiquidated' when trying to register to a liquidated cluster", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);
    await validators.mockSetClusterLiquidated(clusterOwner.address, operatorIds);

    const liquidatedCluster = createCluster({ active: false });

    await expect(validators.bulkRegisterValidator(
      [makePublicKey(1), makePublicKey(2)],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      liquidatedCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.CLUSTER_IS_LIQUIDATED);
  });
});
