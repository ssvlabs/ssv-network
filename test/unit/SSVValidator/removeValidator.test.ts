import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture, ssvValidatorsHarnessFixture, getValidatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, DEDUCTED_DIGITS, EMPTY_CLUSTER, VUNITS_PRECISION } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";
import { ethers } from "ethers";

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

  const deploySSVClustersAndPrepareOperatorsFixture = async () => {
    return ssvClustersHarnessFixture(connection);
  };

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
  };

  const createLegacySSVCluster = (overrides: Partial<typeof EMPTY_CLUSTER> = {}) => ({
    ...EMPTY_CLUSTER,
    validatorCount: 1n,
    active: true,
    balance: 10_000_000_000_000_000_000n,
    ...overrides,
  });

  const setValidSingleLeafRoot = async (
    clusters: any,
    clusterId: string,
    blockNum: number,
    effectiveBalance: number
  ) => {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const innerHash = ethers.keccak256(
      coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance])
    );
    const root = ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
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
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(0n); // deviation only
      expect(await validators.getEffectiveOperatorVUnits(operatorId)).to.equal(VUNITS_PRECISION); // baseline + deviation
    }

    const removeTx = await validators.connect(clusterOwner).removeValidator(publicKey, operatorIds, clusterAfterRegister);
    await removeTx.wait();

    for (const operatorId of operatorIds) {
      expect(await validators.getOperatorEthVUnits(operatorId)).to.equal(0n); // deviation only
      expect(await validators.getEffectiveOperatorVUnits(operatorId)).to.equal(0n); // baseline removed
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

  it("Removes validator from active legacy SSV cluster and verifies operator counts and cluster hash", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    const ssvCluster = createLegacySSVCluster();

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

    for (const opId of operatorIds) {
      expect(await clusters.getOperatorValidatorCount(opId)).to.equal(1n);
    }
    expect(await clusters.getDaoValidatorCount()).to.equal(1n);

    const clusterId = getClusterId(clusterOwner.address, operatorIds);

    const removeTx = await clusters.connect(clusterOwner).removeValidator(publicKey, operatorIds, ssvCluster);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(clusterAfterRemove.active).to.equal(true);

    for (const opId of operatorIds) {
      expect(await clusters.getOperatorValidatorCount(opId)).to.equal(0n);
    }

    const storedHash = await clusters.getSSVClusterHash(clusterId);
    expect(storedHash).to.not.equal(ethers.ZeroHash);

    const expectedHash = ethers.keccak256(
      ethers.solidityPacked(
        ["uint32", "uint64", "uint64", "uint256", "bool"],
        [
          clusterAfterRemove.validatorCount,
          clusterAfterRemove.networkFeeIndex,
          clusterAfterRemove.index,
          clusterAfterRemove.balance,
          clusterAfterRemove.active,
        ]
      )
    );
    expect(storedHash).to.equal(expectedHash);
  });

  it("Removes validator from liquidated legacy SSV cluster and verifies operator counts", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    const ssvCluster = createLegacySSVCluster({ balance: 0n });

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);
    const liquidateTx = await clusters.connect(clusterOwner).liquidateSSV(clusterOwner.address, operatorIds, ssvCluster);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    const removeTx = await clusters.connect(clusterOwner).removeValidator(publicKey, operatorIds, liquidatedCluster);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(clusterAfterRemove.active).to.equal(false);

    for (const opId of operatorIds) {
      expect(await clusters.getOperatorValidatorCount(opId)).to.equal(0n);
    }
  });

  it("Removes validator from SSV cluster with non-zero fees and verifies balance deduction", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const opFeeUnpacked = 10_000_000_000n;
    const networkFeeRaw = 500n;
    for (const opId of operatorIds) {
      await clusters.mockOperatorSSVFee(opId, opFeeUnpacked);
    }
    await clusters.mockSSVNetworkFee(networkFeeRaw);
    await clusters.mockCurrentNetworkFeeIndexSSV(0n);

    const snapshots: { index: bigint; block: bigint }[] = [];
    for (const opId of operatorIds) {
      const [index, blockNumber] = await clusters.getOperatorSnapshot(opId);
      snapshots.push({ index: BigInt(index), block: BigInt(blockNumber) });
    }
    const nfiAtRegister = await clusters.getCurrentNetworkFeeIndexSSV();

    const initialBalance = 100_000_000_000_000_000_000n;
    const publicKey = makePublicKey(1);
    const ssvCluster = createLegacySSVCluster({
      balance: initialBalance,
      index: snapshots.reduce((acc, s) => acc + s.index, 0n),
      networkFeeIndex: nfiAtRegister,
    });

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

    const removeTx = await clusters.connect(clusterOwner).removeValidator(publicKey, operatorIds, ssvCluster);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove.balance).to.be.lt(initialBalance);
    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(clusterAfterRemove.active).to.equal(true);

    const newIndex = clusterAfterRemove.index;
    const newNFI = clusterAfterRemove.networkFeeIndex;
    const indexDelta = newIndex - ssvCluster.index;
    const nfiDelta = newNFI - ssvCluster.networkFeeIndex;
    const totalUsagePacked = (indexDelta + nfiDelta) * 1n;
    const totalUsage = totalUsagePacked * DEDUCTED_DIGITS;
    const expectedBalance = initialBalance - totalUsage;

    expect(clusterAfterRemove.balance).to.equal(expectedBalance);
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

    const clusterId = getClusterId(await clusterOwner.getAddress(), operatorIds);
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

    // EB update to 160 ETH for 2 validators (80 ETH each)
    // vUnits = ceil(160 * 10000 / 32) = 50000
    const expectedUpdatedVUnits = (BigInt(effectiveBalance) * VUNITS_PRECISION + 31n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedUpdatedVUnits);
    
    // baseline = 2 validators * 10000 = 20000, deviation = 50000 - 20000 = 30000
    const baselineBeforeRemove = 2n * VUNITS_PRECISION;
    const deviationAfterUpdate = expectedUpdatedVUnits - baselineBeforeRemove;
    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(deviationAfterUpdate); // deviation only
    expect(await clusters.getEffectiveOperatorVUnits(operatorIds[0])).to.equal(expectedUpdatedVUnits); // baseline + deviation

    const removeTx = await clusters.connect(clusterOwner).removeValidator(pk1, operatorIds, clusterAfterUpdate);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove.validatorCount).to.equal(1n);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedUpdatedVUnits - VUNITS_PRECISION);
    
    // After removing 1 validator: baseline = 1 * 10000 = 10000
    // Cluster vUnits = 50000 - 10000 = 40000
    // deviation = 40000 - 10000 = 30000 (unchanged)
    const baselineAfterRemove = 1n * VUNITS_PRECISION;
    const expectedClusterVUnitsAfterRemove = expectedUpdatedVUnits - VUNITS_PRECISION;
    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(deviationAfterUpdate); // deviation unchanged
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

    const clusterId = getClusterId(await clusterOwner.getAddress(), operatorIds);
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
