import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from '../../setup/connection.ts';
import { ssvValidatorsHarnessFixture, getValidatorsHarnessFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType } from '../../common/types.ts';
import { makePublicKey, makePublicKeys, createCluster, parseClusterFromEvent } from '../../common/helpers.ts';
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_OPERATOR_ETH_FEE, DEFAULT_SHARES, EMPTY_CLUSTER, ETH_DEDUCTED_DIGITS, VUNITS_PRECISION } from '../../common/constants.ts';
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

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return connection.ethers.keccak256(
      connection.ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
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

    const expectedCluster = [
      1n,
      0n,
      0n,
      true,
      DEFAULT_ETH_REGISTER_VALUE,
    ];

    await expect(tx)
      .to.emit(validators, Events.VALIDATOR_ADDED)
      .withArgs(
        clusterOwner.address,
        operatorIds,
        publicKey,
        DEFAULT_SHARES,
        expectedCluster
      );
  });

  it("Initializes ETH defaults for legacy SSV operators and keeps them after registration", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    for (const operatorId of operatorIds) {
      await validators.mockSetOperatorLegacySSV(operatorId, 1);

      const beforeSnapshot = await validators.getOperatorEthSnapshot(operatorId);
      const beforeFee = await validators.getOperatorEthFee(operatorId);
      const beforeValidatorCount = await validators.getOperatorEthValidatorCount(operatorId);
      expect(beforeSnapshot.blockNumber).to.equal(0n);
      expect(beforeSnapshot.index).to.equal(0n);
      expect(beforeSnapshot.balance).to.equal(0n);
      expect(beforeFee).to.equal(0n);
      expect(beforeValidatorCount).to.equal(0n);
    }

    const tx = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    const expectedBlock = BigInt(receipt!.blockNumber);

    for (const operatorId of operatorIds) {
      await expect(tx).to.emit(validators, Events.OPERATOR_FEE_EXECUTED)
        .withArgs(clusterOwner.address, operatorId, expectedBlock, DEFAULT_OPERATOR_ETH_FEE);

      const afterSnapshot = await validators.getOperatorEthSnapshot(operatorId);
      const afterFee = await validators.getOperatorEthFee(operatorId);
      const afterValidatorCount = await validators.getOperatorEthValidatorCount(operatorId);
      expect(afterSnapshot.blockNumber).to.equal(expectedBlock);
      expect(afterSnapshot.index).to.equal(0n);
      expect(afterSnapshot.balance).to.equal(0n);
      expect(afterFee).to.equal(DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS);
      expect(afterValidatorCount).to.equal(1n);
    }
  });

  it("Legacy SSV operators with zero SSV fee initialize ETH snapshot but keep ethFee=0 on registration", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    for (const operatorId of operatorIds) {
      await validators.mockSetOperatorLegacySSV(operatorId, 0);
      const beforeSnapshot = await validators.getOperatorEthSnapshot(operatorId);
      const beforeFee = await validators.getOperatorEthFee(operatorId);
      expect(beforeSnapshot.blockNumber).to.equal(0n);
      expect(beforeFee).to.equal(0n);
    }

    const tx = await validators.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();

    const feeExecutedEvents = receipt?.logs
      .map((log: any) => {
        try {
          return validators.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter((parsed: any) => parsed?.name === Events.OPERATOR_FEE_EXECUTED);

    expect(feeExecutedEvents).to.have.length(0);

    for (const operatorId of operatorIds) {
      const afterSnapshot = await validators.getOperatorEthSnapshot(operatorId);
      const afterFee = await validators.getOperatorEthFee(operatorId);
      expect(afterSnapshot.blockNumber).to.equal(BigInt(receipt!.blockNumber));
      expect(afterFee).to.equal(0n);
    }
  });

  it("Updates operatorEthVUnits even when cluster EB snapshot is not set", async function () {
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
    await tx.wait();

    for (const operatorId of operatorIds) {
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(0n); // deviation only
      expect(await validators.getEffectiveOperatorVUnits(operatorId)).to.equal(VUNITS_PRECISION); // baseline + deviation
    }

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    expect(await validators.getClusterVUnits(clusterId)).to.equal(0n);
  });

  it("Keeps stored EB snapshot unset when registering into an existing cluster without an explicit EB snapshot", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const registerTx1 = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt1 = await registerTx1.wait();
    const clusterAfter1 = parseClusterFromEvent(validators, receipt1, Events.VALIDATOR_ADDED);

    const registerTx2 = await validators.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfter1,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    await registerTx2.wait();

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    expect(await validators.getClusterVUnits(clusterId)).to.equal(0n);
    for (const operatorId of operatorIds) {
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(0n); // deviation only
      expect(await validators.getEffectiveOperatorVUnits(operatorId)).to.equal(2n * VUNITS_PRECISION); // baseline + deviation
    }
  });

  it("Increments stored EB snapshot vUnits when cluster EB snapshot is set", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const registerTx = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const startVUnits = 3n * VUNITS_PRECISION;
    await validators.mockSetClusterVUnits(clusterId, startVUnits);

    const tx = await validators.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfterRegister,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    await tx.wait();

    expect(await validators.getClusterVUnits(clusterId)).to.equal(startVUnits + VUNITS_PRECISION);
    for (const operatorId of operatorIds) {
      // Cluster has 2 validators (baseline = 20000), explicit snapshot = 40000
      // But operatorEthVUnits is only updated by EB updates, not registration
      // The deviation in clusterEB.vUnits is implicit until an EB update syncs it
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(0n); // deviation only (not updated on registration)
      expect(await validators.getEffectiveOperatorVUnits(operatorId)).to.equal(2n * VUNITS_PRECISION); // baseline only
    }
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

    const liquidatedCluster = { ...EMPTY_CLUSTER, active: false };

    await expect(validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      liquidatedCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.CLUSTER_IS_LIQUIDATED);
  });

  it("Is reverted with 'OperatorDoesNotExist' when one of the operators has been removed", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    await validators.mockRemoveOperator(operatorIds[1]);

    await expect(validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.OPERATOR_DOES_NOT_EXIST);
  });

  it("Revert on removed operator is atomic and does not partially initialize earlier operators", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    for (const operatorId of operatorIds) {
      await validators.mockSetOperatorLegacySSV(operatorId, 1);
    }

    const firstOperator = operatorIds[0];
    const thirdOperator = operatorIds[2];
    const fourthOperator = operatorIds[3];

    await validators.mockRemoveOperator(operatorIds[1]);

    const beforeFirstSnapshot = await validators.getOperatorEthSnapshot(firstOperator);
    const beforeFirstFee = await validators.getOperatorEthFee(firstOperator);
    const beforeFirstCount = await validators.getOperatorEthValidatorCount(firstOperator);

    await expect(validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.OPERATOR_DOES_NOT_EXIST);

    const afterFirstSnapshot = await validators.getOperatorEthSnapshot(firstOperator);
    const afterFirstFee = await validators.getOperatorEthFee(firstOperator);
    const afterFirstCount = await validators.getOperatorEthValidatorCount(firstOperator);

    expect(afterFirstSnapshot.blockNumber).to.equal(beforeFirstSnapshot.blockNumber);
    expect(afterFirstSnapshot.index).to.equal(beforeFirstSnapshot.index);
    expect(afterFirstSnapshot.balance).to.equal(beforeFirstSnapshot.balance);
    expect(afterFirstFee).to.equal(beforeFirstFee);
    expect(afterFirstCount).to.equal(beforeFirstCount);

    for (const operatorId of [thirdOperator, fourthOperator]) {
      const snapshot = await validators.getOperatorEthSnapshot(operatorId);
      const fee = await validators.getOperatorEthFee(operatorId);
      const count = await validators.getOperatorEthValidatorCount(operatorId);
      expect(snapshot.blockNumber).to.equal(0n);
      expect(snapshot.index).to.equal(0n);
      expect(snapshot.balance).to.equal(0n);
      expect(fee).to.equal(0n);
      expect(count).to.equal(0n);
    }
  });

  it("Is reverted with 'OperatorDoesNotExist' when multiple operators have been removed", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    await validators.mockRemoveOperator(operatorIds[0]);
    await validators.mockRemoveOperator(operatorIds[2]);

    await expect(validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.OPERATOR_DOES_NOT_EXIST);
  });

  it("Is reverted with 'ExceedValidatorLimitWithData' when registering a validator that pushes operator over the limit", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    await validators.mockValidatorsPerOperatorLimit(5);

    const publicKeys = makePublicKeys(5);
    const shares = new Array(5).fill(DEFAULT_SHARES);
    const bulkTx = await validators.bulkRegisterValidator(
      publicKeys, operatorIds, shares, createCluster(), { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const bulkReceipt = await bulkTx.wait();
    const clusterAtLimit = parseClusterFromEvent(validators, bulkReceipt, Events.VALIDATOR_ADDED);

    await expect(validators.registerValidator(
      makePublicKey(6), operatorIds, DEFAULT_SHARES, clusterAtLimit, { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(validators, Errors.OPERATOR_VALIDATORS_LIMIT_EXCEEDED)
      .withArgs(operatorIds[0]);
  });

  it("Succeeds registering a validator after removing one to bring operator back below the limit", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    await validators.mockValidatorsPerOperatorLimit(5);

    const publicKeys = makePublicKeys(5);
    const shares = new Array(5).fill(DEFAULT_SHARES);
    const bulkTx = await validators.bulkRegisterValidator(
      publicKeys, operatorIds, shares, createCluster(), { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const bulkReceipt = await bulkTx.wait();
    const clusterAtLimit = parseClusterFromEvent(validators, bulkReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await validators.removeValidator(publicKeys[0], operatorIds, clusterAtLimit);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(validators, removeReceipt, Events.VALIDATOR_REMOVED);

    const tx = await validators.registerValidator(
      makePublicKey(6), operatorIds, DEFAULT_SHARES, clusterAfterRemove, { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    await expect(tx).to.emit(validators, Events.VALIDATOR_ADDED);
  });
});
