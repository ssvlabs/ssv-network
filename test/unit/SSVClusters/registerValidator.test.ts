import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from '../../setup/connection.ts';
import { getClustersHarnessFixture, ssvClustersHarnessFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType } from '../../common/types.ts';
import { makePublicKey, parseClusterFromEvent } from '../../common/helpers.ts';
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, EMPTY_CLUSTER } from '../../common/constants.ts';
import { Events } from '../../common/events.ts';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import type { BigNumberish } from 'ethers';
import { Errors } from '../../common/errors.ts';
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVClusters function `registerValidator()`", async () => {
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

  it("Registers a new validator, creates new cluster with the expected data and emits correct events", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    const tx = await clusters.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    // todo check args with pre-calculated cluster
    await expect(tx).to.emit(clusters, Events.VALIDATOR_ADDED);
  });

  it("Registers a new validator with 7 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    const tx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]);
  });

  it("Registers a validator into an existing cluster with 7 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const tx = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      0,
      clusterAfterRegister,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_7]);
  });

  it("Registers a validator without additional deposit with 7 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE * 2n }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const tx = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      0,
      clusterAfterRegister,
      { value: 0 }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_7]);
  });

  it("Registers a new validator with 10 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    const tx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE_10]);
  });

  it("Registers a validator into an existing cluster with 10 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const tx = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      0,
      clusterAfterRegister,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_10]);
  });

  it("Registers a validator without additional deposit with 10 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE * 2n }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const tx = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      0,
      clusterAfterRegister,
      { value: 0 }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_10]);
  });

  it("Registers a new validator with 13 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const tx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]);
  });

  it("Registers a validator into an existing cluster with 13 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const tx = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      0,
      clusterAfterRegister,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_13]);
  });

  it("Registers a validator without additional deposit with 13 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE * 2n }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const tx = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      0,
      clusterAfterRegister,
      { value: 0 }
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_13]);
  });

  it("Is reverted with 'InvalidPublicKeyLength' when public key is empty or has invalid length", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const emptyPublicKey = '0x';
    const invalidLengthPublicKey = makePublicKey(1) + "11";

    await expect(clusters.registerValidator(
      emptyPublicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INVALID_PUBLIC_KEYS_LENGTH);

    await expect(clusters.registerValidator(
      invalidLengthPublicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INVALID_PUBLIC_KEYS_LENGTH);
  });

  it("Is reverted with 'PublicKeysSharesLengthMismatch' if there is a mismatch between public keys and shares", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await expect(clusters.bulkRegisterValidator(
      [makePublicKey(1)], // 1 pk
      operatorIds,
      [], // 0 shares
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.PUBLIC_KEYS_SHARES_LENGTH_MISMATCH);
  });

  it("Is reverted with 'ValidatorAlreadyExistsWithData' if trying to register already existing key", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    await clusters.registerValidator(publicKey, operatorIds, DEFAULT_SHARES, 0, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE });

    await expect(clusters.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
      )).to.be.revertedWithCustomError(clusters, Errors.VALIDATOR_ALREADY_EXISTS_WITH_DATA).withArgs(publicKey);
  });

  it("Is reverted with 'InvalidOperatorIdsLength' if the length is not allowed one for clusters", async function () {
    const { clusters } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    const operatorIds = [2n, 1n, 2n];

    await expect(clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INVALID_OPERATOR_IDS_LENGTH);
  });

  it("Is reverted with 'UnsortedOperatorsList' if the list of operator ids is not sorted", async function () {
    const { clusters } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    const operatorIds = [4n, 3n, 2n, 1n]; // no duplicates, just unsorted

    await expect(clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.UNSORTED_OPERATORS_LIST);
  });

  it("Is reverted with 'OperatorsListNotUnique' if the list of operator ids has duplications", async function () {
    const { clusters } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    let operatorIds = [1n, 1n, 2n, 4n]; // sorted but has duplicate

    await expect(clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.OPERATORS_LIST_NOT_UNIQUE);
  });

  it("Is reverted with 'ClusterIsLiquidated' when trying to register to a liquidated cluster", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    await clusters.mockSetClusterLiquidated(clusterOwner.address, operatorIds);

    EMPTY_CLUSTER.active = false;

    await expect(clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_IS_LIQUIDATED);
  });
});
