import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { getTestConnection } from '../../setup/connection.ts';
import { getClustersHarnessFixture, ssvClustersHarnessFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType } from '../../common/types.ts';
import { createCluster, makePublicKey, makePublicKeys, parseClusterFromEvent } from '../../common/helpers.ts';
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES } from '../../common/constants.ts';
import { Events } from '../../common/events.ts';
import { Errors } from '../../common/errors.ts';
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVClusters function `bulkRegisterValidator()`", async () => {
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

  it("Registers multiple validators, creates new cluster with the expected data and emits correct events", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];
    const shares = [DEFAULT_SHARES, DEFAULT_SHARES];

    const tx = await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    // todo check args with pre-calculated cluster
    await expect(tx).to.emit(clusters, Events.VALIDATOR_ADDED);
  });

  it("Registers 10 validators into a new cluster with 4 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_4]);
  });

  it("Registers 10 validators into an existing cluster with 4 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const registerTx = await clusters.registerValidator(
      makePublicKey(100),
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const existingCluster = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const publicKeys = makePublicKeys(10, 1);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      existingCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_4]);
  });

  it("Registers 10 validators into a new cluster with 7 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_7]);
  });

  it("Registers 10 validators into an existing cluster with 7 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    const registerTx = await clusters.registerValidator(
      makePublicKey(100),
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const existingCluster = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const publicKeys = makePublicKeys(10, 1);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      existingCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_7]);
  });

  it("Registers 10 validators into a new cluster with 10 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_10]);
  });

  it("Registers 10 validators into an existing cluster with 10 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    const registerTx = await clusters.registerValidator(
      makePublicKey(100),
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const existingCluster = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const publicKeys = makePublicKeys(10, 1);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      existingCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_10]);
  });

  it("Registers 10 validators into a new cluster with 13 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_13]);
  });

  it("Registers 10 validators into an existing cluster with 13 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const registerTx = await clusters.registerValidator(
      makePublicKey(100),
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const existingCluster = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const publicKeys = makePublicKeys(10, 1);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const tx = await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      existingCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_13]);
  });

  it("Is reverted with 'EmptyPublicKeysList' when no public keys are provided", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await expect(clusters.bulkRegisterValidator(
      [],
      operatorIds,
      [],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.EMPTY_PUBLIC_KEYS_LIST);
  });

  it("Is reverted with 'InvalidPublicKeyLength' when any public key is empty or has invalid length", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const emptyPublicKey = "0x";
    const invalidLengthPublicKey = makePublicKey(1) + "11";

    await expect(clusters.bulkRegisterValidator(
      [emptyPublicKey],
      operatorIds,
      [DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INVALID_PUBLIC_KEYS_LENGTH);

    await expect(clusters.bulkRegisterValidator(
      [makePublicKey(1), invalidLengthPublicKey],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INVALID_PUBLIC_KEYS_LENGTH);
  });

  it("Is reverted with 'PublicKeysSharesLengthMismatch' if there is a mismatch between public keys and shares", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await expect(clusters.bulkRegisterValidator(
      [makePublicKey(1), makePublicKey(2)], // 2 public keys
      operatorIds,
      [DEFAULT_SHARES], // only 1 share
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.PUBLIC_KEYS_SHARES_LENGTH_MISMATCH);
  });

  it("Is reverted with 'ValidatorAlreadyExistsWithData' if trying to register already existing key", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    await expect(clusters.bulkRegisterValidator(
      [publicKey, publicKey],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.VALIDATOR_ALREADY_EXISTS_WITH_DATA).withArgs(publicKey);
  });

  it("Is reverted with 'InvalidOperatorIdsLength' if the length is not allowed one for clusters", async function () {
    const { clusters } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    const operatorIds = [2n, 1n, 2n];

    await expect(clusters.bulkRegisterValidator(
      [makePublicKey(1), makePublicKey(2)],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INVALID_OPERATOR_IDS_LENGTH);
  });

  it("Is reverted with 'UnsortedOperatorsList' if the list of operator ids is not sorted", async function () {
    const { clusters } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    const operatorIds = [4n, 3n, 2n, 1n]; // no duplicates, just unsorted

    await expect(clusters.bulkRegisterValidator(
      [makePublicKey(1), makePublicKey(2)],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.UNSORTED_OPERATORS_LIST);
  });

  it("Is reverted with 'OperatorsListNotUnique' if the list of operator ids has duplications", async function () {
    const { clusters } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    const operatorIds = [1n, 1n, 2n, 4n]; // sorted but has duplicate

    await expect(clusters.bulkRegisterValidator(
      [makePublicKey(1), makePublicKey(2)],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.OPERATORS_LIST_NOT_UNIQUE);
  });

  it("Is reverted with 'ClusterIsLiquidated' when trying to register to a liquidated cluster", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    await clusters.mockSetClusterLiquidated(clusterOwner.address, operatorIds);

    const liquidatedCluster = createCluster({ active: false });

    await expect(clusters.bulkRegisterValidator(
      [makePublicKey(1), makePublicKey(2)],
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      liquidatedCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_IS_LIQUIDATED);
  });
});
