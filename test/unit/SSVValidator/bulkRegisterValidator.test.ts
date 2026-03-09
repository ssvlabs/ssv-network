import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { ssvValidatorsHarnessFixture, getValidatorsHarnessFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType } from '../../common/types.ts';
import { setupTestContext, createCluster, makePublicKey, makePublicKeys, parseClusterFromEvent, computeClusterId } from '../../common/helpers.ts';
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, VUNITS_PRECISION } from '../../common/constants.ts';
import { Events } from '../../common/events.ts';
import { Errors } from '../../common/errors.ts';
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVClusters function `bulkRegisterValidator()`", async () => {
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
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    await expect(tx).to.emit(validators, Events.VALIDATOR_ADDED);
  });

  it("Updates operatorEthVUnits even when cluster EB snapshot is not set", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];
    const shares = [DEFAULT_SHARES, DEFAULT_SHARES];

    const tx = await validators.connect(clusterOwner).bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    await tx.wait();

    for (const operatorId of operatorIds) {
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await validators.getEffectiveOperatorVUnits(operatorId)).to.equal(2n * VUNITS_PRECISION);
    }

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    expect(await validators.getClusterVUnits(clusterId)).to.equal(0n);
  });

  it("Increments stored EB snapshot vUnits when cluster EB snapshot is set", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const registerTx = await validators.connect(clusterOwner).registerValidator(
      makePublicKey(100),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const existingCluster = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const startVUnits = 5n * VUNITS_PRECISION;
    await validators.mockSetClusterVUnits(clusterId, startVUnits);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];
    const shares = [DEFAULT_SHARES, DEFAULT_SHARES];

    const tx = await validators.connect(clusterOwner).bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      existingCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    await tx.wait();

    expect(await validators.getClusterVUnits(clusterId)).to.equal(startVUnits + 2n * VUNITS_PRECISION);
    for (const operatorId of operatorIds) {
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await validators.getEffectiveOperatorVUnits(operatorId)).to.equal(3n * VUNITS_PRECISION);
    }
  });

  it("Registers 10 validators into a new cluster with 4 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_4]);
  });

  it("Registers 10 validators into an existing cluster with 4 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const registerTx = await validators.registerValidator(
      makePublicKey(100),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const existingCluster = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const publicKeys = makePublicKeys(10, 1);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      existingCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_4]);
  });

  it("Registers 10 validators into a new cluster with 7 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_7]);
  });

  it("Registers 10 validators into an existing cluster with 7 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    const registerTx = await validators.registerValidator(
      makePublicKey(100),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const existingCluster = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const publicKeys = makePublicKeys(10, 1);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      existingCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_7]);
  });

  it("Registers 10 validators into a new cluster with 10 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_10]);
  });

  it("Registers 10 validators into an existing cluster with 10 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    const registerTx = await validators.registerValidator(
      makePublicKey(100),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const existingCluster = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const publicKeys = makePublicKeys(10, 1);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      existingCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_10]);
  });

  it("Registers 10 validators into a new cluster with 13 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_13]);
  });

  it("Registers 10 validators into an existing cluster with 13 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const registerTx = await validators.registerValidator(
      makePublicKey(100),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const existingCluster = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const publicKeys = makePublicKeys(10, 1);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      existingCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_13]);
  });

  it("Is reverted with 'EmptyPublicKeysList' when no public keys are provided", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    await expect(validators.bulkRegisterValidator(
      [],
      operatorIds,
      [],
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
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.INVALID_PUBLIC_KEYS_LENGTH);

    await expect(validators.bulkRegisterValidator(
      [makePublicKey(1), invalidLengthPublicKey],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.INVALID_PUBLIC_KEYS_LENGTH);
  });

  it("Is reverted with 'PublicKeysSharesLengthMismatch' if there is a mismatch between public keys and shares", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    await expect(validators.bulkRegisterValidator(
      [makePublicKey(1), makePublicKey(2)],
      operatorIds,
      [DEFAULT_SHARES],
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
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.INVALID_OPERATOR_IDS_LENGTH);
  });

  it("Is reverted with 'UnsortedOperatorsList' if the list of operator ids is not sorted", async function () {
    const { validators } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);
    const operatorIds = [4n, 3n, 2n, 1n];

    await expect(validators.bulkRegisterValidator(
      [makePublicKey(1), makePublicKey(2)],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.UNSORTED_OPERATORS_LIST);
  });

  it("Is reverted with 'OperatorsListNotUnique' if the list of operator ids has duplications", async function () {
    const { validators } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);
    const operatorIds = [1n, 1n, 2n, 4n];

    await expect(validators.bulkRegisterValidator(
      [makePublicKey(1), makePublicKey(2)],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
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
      liquidatedCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.CLUSTER_IS_LIQUIDATED);
  });

  it("Is reverted with 'OperatorDoesNotExist' when one of the operators has been removed", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    await validators.mockRemoveOperator(operatorIds[2]);

    await expect(validators.bulkRegisterValidator(
      [makePublicKey(1), makePublicKey(2)],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.OPERATOR_DOES_NOT_EXIST);
  });

  it("Is reverted with 'OperatorDoesNotExist' when multiple operators have been removed", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    await validators.mockRemoveOperator(operatorIds[1]);
    await validators.mockRemoveOperator(operatorIds[3]);

    await expect(validators.bulkRegisterValidator(
      [makePublicKey(1), makePublicKey(2)],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.OPERATOR_DOES_NOT_EXIST);
  });
});
