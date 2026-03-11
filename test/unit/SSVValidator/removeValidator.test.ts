import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture, getValidatorsHarnessFixture } from "../../setup/fixtures.ts";
import { defaultValidatorsFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, createCluster, makePublicKey, parseClusterFromEvent, computeClusterId } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, VUNITS_PRECISION } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";
import { computeEBRoot } from "../../helpers/oracle.ts";

describe("SSVClusters function `removeValidator()`", async () => {
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

  const setValidSingleLeafRoot = async (
    clusters: any,
    clusterId: string,
    blockNum: number,
    effectiveBalance: number
  ) => {
    const root = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);
  };

  it("Removes an existing validator, updates cluster state and emits correct events", async function () {
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

    const removeTx = await validators.removeValidator(publicKey, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(validators, removeReceipt, Events.VALIDATOR_REMOVED);

    await expect(removeTx).to.emit(validators, Events.VALIDATOR_REMOVED);
    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(clusterAfterRemove.active).to.equal(true);
  });

  it("Updates operatorEthVUnits on register/remove even when cluster EB snapshot is not set", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    const registerTx = await validators.connect(clusterOwner).registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    for (const operatorId of operatorIds) {
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await validators.getEffectiveOperatorVUnits(operatorId)).to.equal(VUNITS_PRECISION);
    }

    const removeTx = await validators.connect(clusterOwner).removeValidator(publicKey, operatorIds, clusterAfterRegister);
    await removeTx.wait();

    for (const operatorId of operatorIds) {
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await validators.getEffectiveOperatorVUnits(operatorId)).to.equal(0n);
    }
  });

  it("Removes a validator with 7 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

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
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(validators, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await validators.removeValidator(publicKey, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    await trackGasFromReceipt(removeReceipt, [GasGroup.REMOVE_VALIDATOR_13]);
  });

  it("Is reverted with 'IncorrectValidatorState' when validator was not registered", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const registeredKey = makePublicKey(1);
    const registerTx = await validators.registerValidator(
      registeredKey,
      operatorIds,
      DEFAULT_SHARES,
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
    )).to.be.revertedWithCustomError(validators, Errors.CLUSTER_DOES_NOT_EXIST);
  });

  it("Is reverted with 'IncorrectValidatorState' when removing a validator twice", async function () {
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

    const removeTx = await validators.removeValidator(publicKey, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(validators, removeReceipt, Events.VALIDATOR_REMOVED);

    await expect(validators.removeValidator(
      publicKey,
      operatorIds,
      clusterAfterRemove
    )).to.be.revertedWithCustomError(validators, Errors.INCORRECT_VALIDATOR_STATE);
  });

  it("Keeps explicit EB snapshot consistent across updateClusterBalance and remove", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const pk1 = makePublicKey(1);
    const pk2 = makePublicKey(2);

    const register1 = await clusters.connect(clusterOwner).registerValidator(
      pk1,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt1 = await register1.wait();
    const clusterAfter1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

    const register2 = await clusters.connect(clusterOwner).registerValidator(
      pk2,
      operatorIds,
      DEFAULT_SHARES,
      clusterAfter1,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt2 = await register2.wait();
    const clusterAfter2 = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

    const clusterId = computeClusterId(await clusterOwner.getAddress(), operatorIds);
    const blockNum = 1;
    const effectiveBalance = 160;

    await setValidSingleLeafRoot(clusters, clusterId, blockNum, effectiveBalance);

    const updateTx = await clusters.updateClusterBalance(
      blockNum,
      await clusterOwner.getAddress(),
      operatorIds,
      clusterAfter2,
      effectiveBalance,
      []
    );
    const updateReceipt = await updateTx.wait();
    const clusterAfterUpdate = parseClusterFromEvent(clusters, updateReceipt, "ClusterBalanceUpdated");
    const expectedUpdatedVUnits = (BigInt(effectiveBalance) * VUNITS_PRECISION + 31n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedUpdatedVUnits);
    const baselineBeforeRemove = 2n * VUNITS_PRECISION;
    const deviationAfterUpdate = expectedUpdatedVUnits - baselineBeforeRemove;
    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(deviationAfterUpdate);
    expect(await clusters.getEffectiveOperatorVUnits(operatorIds[0])).to.equal(expectedUpdatedVUnits);

    const removeTx = await clusters.connect(clusterOwner).removeValidator(pk1, operatorIds, clusterAfterUpdate);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove.validatorCount).to.equal(1n);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedUpdatedVUnits - VUNITS_PRECISION);
    const baselineAfterRemove = 1n * VUNITS_PRECISION;
    const expectedClusterVUnitsAfterRemove = expectedUpdatedVUnits - VUNITS_PRECISION;
    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(deviationAfterUpdate);
    expect(await clusters.getEffectiveOperatorVUnits(operatorIds[0])).to.equal(baselineAfterRemove + deviationAfterUpdate);
  });

  it("Clears remaining explicit EB vUnits when removing the last validator", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    const registerTx = await clusters.connect(clusterOwner).registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const clusterId = computeClusterId(await clusterOwner.getAddress(), operatorIds);
    const blockNum = 1;
    const effectiveBalance = 96;

    await setValidSingleLeafRoot(clusters, clusterId, blockNum, effectiveBalance);

    const updateTx = await clusters.updateClusterBalance(
      blockNum,
      await clusterOwner.getAddress(),
      operatorIds,
      clusterAfterRegister,
      effectiveBalance,
      []
    );
    const updateReceipt = await updateTx.wait();
    const clusterAfterUpdate = parseClusterFromEvent(clusters, updateReceipt, "ClusterBalanceUpdated");

    const expectedUpdatedVUnits = (BigInt(effectiveBalance) * VUNITS_PRECISION + 31n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedUpdatedVUnits);

    const removeTx = await clusters.connect(clusterOwner).removeValidator(publicKey, operatorIds, clusterAfterUpdate);
    await removeTx.wait();

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
  });
});
