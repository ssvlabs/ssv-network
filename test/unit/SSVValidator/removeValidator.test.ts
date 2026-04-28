import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ethers } from "ethers";
import { ssvClustersHarnessFixture, getValidatorsHarnessFixture } from "../../setup/fixtures.ts";
import { defaultValidatorsFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, createCluster, makePublicKey, parseClusterFromEvent, computeClusterId } from "../../common/helpers.ts";
import { createLegacySSVCluster } from "../../helpers/cluster.ts";
import { DEDUCTED_DIGITS, DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, BPS_DENOMINATOR } from "../../common/constants.ts";
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
      expect(await validators.getEffectiveOperatorVUnits(operatorId)).to.equal(BPS_DENOMINATOR);
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

  it("Is reverted with 'ValidatorDoesNotExist' when validator was not registered", async function () {
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
    )).to.be.revertedWithCustomError(validators, Errors.VALIDATOR_DOES_NOT_EXIST);
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

  it("Is reverted with 'ValidatorDoesNotExist' when removing a validator twice", async function () {
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
    )).to.be.revertedWithCustomError(validators, Errors.VALIDATOR_DOES_NOT_EXIST);
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

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

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

  it("Keeps SSV cluster blocked operations after removing last SSV validator", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    const ssvCluster = createLegacySSVCluster({ balance: 10_000_000_000_000_000_000n });
    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

    const removeTx = await clusters.connect(clusterOwner).removeValidator(publicKey, operatorIds, ssvCluster);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(clusterAfterRemove.active).to.equal(true);

    await expect(
      clusters.connect(clusterOwner).withdraw(operatorIds, 1n, clusterAfterRemove)
    ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);

    await expect(
      clusters.connect(clusterOwner).reactivate(operatorIds, clusterAfterRemove, { value: DEFAULT_ETH_REGISTER_VALUE })
    ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);
  });

  it("Removes validator from liquidated legacy SSV cluster and verifies operator counts", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    const ssvCluster = createLegacySSVCluster({ balance: 0n });

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);
    for (const opId of operatorIds) {
      expect(await clusters.getOperatorValidatorCount(opId)).to.equal(1n);
    }
    expect(await clusters.getDaoValidatorCount()).to.equal(1n);

    const liquidateTx = await clusters.connect(clusterOwner).liquidateSSV(clusterOwner.address, operatorIds, ssvCluster);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
    for (const opId of operatorIds) {
      expect(await clusters.getOperatorValidatorCount(opId)).to.equal(0n);
    }
    expect(await clusters.getDaoValidatorCount()).to.equal(0n);

    const removeTx = await clusters.connect(clusterOwner).removeValidator(publicKey, operatorIds, liquidatedCluster);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(clusterAfterRemove.active).to.equal(false);

    for (const opId of operatorIds) {
      expect(await clusters.getOperatorValidatorCount(opId)).to.equal(0n);
    }
    expect(await clusters.getDaoValidatorCount()).to.equal(0n);
  });

  it("Handles remove -> liquidateSSV -> remove flow with expected SSV operator/DAO count deltas", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const pk1 = makePublicKey(11);
    const pk2 = makePublicKey(12);
    const ssvCluster = createLegacySSVCluster({ validatorCount: 2n, balance: 0n });

    await clusters.mockRegisterSSVValidator(pk1, operatorIds, clusterOwner.address, ssvCluster);
    await clusters.mockRegisterSSVValidator(pk2, operatorIds, clusterOwner.address, ssvCluster);

    const operatorCountStart = await clusters.getOperatorValidatorCount(operatorIds[0]);
    const daoCountStart = await clusters.getDaoValidatorCount();

    const remove1Tx = await clusters.connect(clusterOwner).removeValidator(pk1, operatorIds, ssvCluster);
    const remove1Receipt = await remove1Tx.wait();
    const clusterAfterRemove1 = parseClusterFromEvent(clusters, remove1Receipt, Events.VALIDATOR_REMOVED);

    const operatorCountAfterRemove1 = await clusters.getOperatorValidatorCount(operatorIds[0]);
    const daoCountAfterRemove1 = await clusters.getDaoValidatorCount();
    expect(operatorCountAfterRemove1).to.equal(operatorCountStart - 1n);
    expect(daoCountAfterRemove1).to.equal(daoCountStart - 1n);

    const liquidateTx = await clusters.connect(clusterOwner).liquidateSSV(clusterOwner.address, operatorIds, clusterAfterRemove1);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    const operatorCountAfterLiq = await clusters.getOperatorValidatorCount(operatorIds[0]);
    const daoCountAfterLiq = await clusters.getDaoValidatorCount();
    expect(operatorCountAfterLiq).to.equal(operatorCountAfterRemove1 - BigInt(clusterAfterRemove1.validatorCount));
    expect(daoCountAfterLiq).to.equal(daoCountAfterRemove1 - BigInt(clusterAfterRemove1.validatorCount));

    const remove2Tx = await clusters.connect(clusterOwner).removeValidator(pk2, operatorIds, liquidatedCluster);
    const remove2Receipt = await remove2Tx.wait();
    const clusterAfterRemove2 = parseClusterFromEvent(clusters, remove2Receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove2.validatorCount).to.equal(0n);
    expect(clusterAfterRemove2.active).to.equal(false);
    expect(await clusters.getOperatorValidatorCount(operatorIds[0])).to.equal(operatorCountAfterLiq);
    expect(await clusters.getDaoValidatorCount()).to.equal(daoCountAfterLiq);
  });

  it("Removes from SSV, migrates to ETH, removes from ETH, then adds to ETH without storage cross-contamination", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const pk1 = makePublicKey(21);
    const pk2 = makePublicKey(22);
    const pk3 = makePublicKey(23);
    const ssvCluster = createLegacySSVCluster({ validatorCount: 2n, balance: 0n });

    await clusters.mockRegisterSSVValidator(pk1, operatorIds, clusterOwner.address, ssvCluster);
    await clusters.mockRegisterSSVValidator(pk2, operatorIds, clusterOwner.address, ssvCluster);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    expect(await clusters.getSSVClusterHash(clusterId)).to.not.equal(ethers.ZeroHash);

    const removeSsvTx = await clusters.connect(clusterOwner).removeValidator(pk1, operatorIds, ssvCluster);
    const removeSsvReceipt = await removeSsvTx.wait();
    const ssvClusterAfterRemove = parseClusterFromEvent(clusters, removeSsvReceipt, Events.VALIDATOR_REMOVED);
    expect(ssvClusterAfterRemove.validatorCount).to.equal(1n);

    const migrateTx = await clusters.connect(clusterOwner).migrateClusterToETH(
      operatorIds,
      ssvClusterAfterRemove,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const migrateReceipt = await migrateTx.wait();
    const ethCluster = parseClusterFromEvent(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

    expect(await clusters.getSSVClusterHash(clusterId)).to.equal(ethers.ZeroHash);
    expect(await clusters.getClusterHash(clusterId)).to.not.equal(ethers.ZeroHash);

    const removeEthTx = await clusters.connect(clusterOwner).removeValidator(pk2, operatorIds, ethCluster);
    const removeEthReceipt = await removeEthTx.wait();
    const ethClusterAfterRemove = parseClusterFromEvent(clusters, removeEthReceipt, Events.VALIDATOR_REMOVED);
    expect(ethClusterAfterRemove.validatorCount).to.equal(0n);

    const addEthTx = await clusters.connect(clusterOwner).registerValidator(
      pk3,
      operatorIds,
      DEFAULT_SHARES,
      ethClusterAfterRemove,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const addEthReceipt = await addEthTx.wait();
    const ethClusterAfterAdd = parseClusterFromEvent(clusters, addEthReceipt, Events.VALIDATOR_ADDED);
    expect(ethClusterAfterAdd.validatorCount).to.equal(1n);

    expect(await clusters.getSSVClusterHash(clusterId)).to.equal(ethers.ZeroHash);
    expect(await clusters.getClusterHash(clusterId)).to.not.equal(ethers.ZeroHash);
  });

  it("SSV remove path leaves orphaned EB snapshot untouched (defensive behavior)", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(31);
    const ssvCluster = createLegacySSVCluster({ validatorCount: 1n });
    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    await clusters.mockSetClusterVUnits(clusterId, 50_000n);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(50_000n);

    const removeTx = await clusters.connect(clusterOwner).removeValidator(publicKey, operatorIds, ssvCluster);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(50_000n);
  });

  it("Processes SSV and ETH removals in the same block without storage/counter collision", async function () {
    const deployEightOperatorsFixture = async () => ssvClustersHarnessFixture(connection, 8);
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployEightOperatorsFixture);

    const ssvOperatorIds = operatorIds.slice(0, 4);
    const ethOperatorIds = operatorIds.slice(4, 8);

    const ssvPublicKey = makePublicKey(41);
    const ethPublicKey = makePublicKey(42);
    const ssvCluster = createLegacySSVCluster({ validatorCount: 1n, balance: 10_000_000_000_000_000_000n });
    await clusters.mockRegisterSSVValidator(ssvPublicKey, ssvOperatorIds, clusterOwner.address, ssvCluster);

    const registerEthTx = await clusters.connect(clusterOwner).registerValidator(
      ethPublicKey,
      ethOperatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerEthReceipt = await registerEthTx.wait();
    const ethCluster = parseClusterFromEvent(clusters, registerEthReceipt, Events.VALIDATOR_ADDED);

    const provider = connection.ethers.provider;
    await provider.send("evm_setAutomine", [false]);
    let removeSsvTx: any;
    let removeEthTx: any;
    try {
      removeSsvTx = await clusters.connect(clusterOwner).removeValidator(ssvPublicKey, ssvOperatorIds, ssvCluster);
      removeEthTx = await clusters.connect(clusterOwner).removeValidator(ethPublicKey, ethOperatorIds, ethCluster);
      await provider.send("evm_mine", []);
    } finally {
      await provider.send("evm_setAutomine", [true]);
    }

    const removeSsvReceipt = await removeSsvTx.wait();
    const removeEthReceipt = await removeEthTx.wait();
    expect(removeSsvReceipt.blockNumber).to.equal(removeEthReceipt.blockNumber);

    const ssvClusterId = computeClusterId(clusterOwner.address, ssvOperatorIds);
    const ethClusterId = computeClusterId(clusterOwner.address, ethOperatorIds);
    expect(await clusters.getSSVClusterHash(ssvClusterId)).to.not.equal(ethers.ZeroHash);
    expect(await clusters.getClusterHash(ethClusterId)).to.not.equal(ethers.ZeroHash);

    expect(await clusters.getOperatorValidatorCount(ssvOperatorIds[0])).to.equal(0n);
    expect(await clusters.getOperatorEthValidatorCount(ethOperatorIds[0])).to.equal(0n);
    expect(await clusters.getOperatorEthValidatorCount(ssvOperatorIds[0])).to.equal(0n);
    expect(await clusters.getOperatorValidatorCount(ethOperatorIds[0])).to.equal(0n);
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
    const expectedUpdatedVUnits = (BigInt(effectiveBalance) * BPS_DENOMINATOR + 31n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedUpdatedVUnits);
    const baselineBeforeRemove = 2n * BPS_DENOMINATOR;
    const deviationAfterUpdate = expectedUpdatedVUnits - baselineBeforeRemove;
    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(deviationAfterUpdate);
    expect(await clusters.getEffectiveOperatorVUnits(operatorIds[0])).to.equal(expectedUpdatedVUnits);

    const removeTx = await clusters.connect(clusterOwner).removeValidator(pk1, operatorIds, clusterAfterUpdate);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove.validatorCount).to.equal(1n);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedUpdatedVUnits - BPS_DENOMINATOR);
    const baselineAfterRemove = 1n * BPS_DENOMINATOR;
    const expectedClusterVUnitsAfterRemove = expectedUpdatedVUnits - BPS_DENOMINATOR;
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

    const expectedUpdatedVUnits = (BigInt(effectiveBalance) * BPS_DENOMINATOR + 31n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedUpdatedVUnits);

    const removeTx = await clusters.connect(clusterOwner).removeValidator(publicKey, operatorIds, clusterAfterUpdate);
    await removeTx.wait();

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
  });

  it("removing one validator keeps deviation but decrements DAO baseline exactly", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const firstPubKey = makePublicKey(101);
    const secondPubKey = makePublicKey(102);

    const regTx1 = await clusters.connect(clusterOwner).registerValidator(
      firstPubKey,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const clusterAfterReg1 = parseClusterFromEvent(clusters, await regTx1.wait(), Events.VALIDATOR_ADDED);

    const regTx2 = await clusters.connect(clusterOwner).registerValidator(
      secondPubKey,
      operatorIds,
      DEFAULT_SHARES,
      clusterAfterReg1,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const clusterAfterReg2 = parseClusterFromEvent(clusters, await regTx2.wait(), Events.VALIDATOR_ADDED);

    const clusterId = computeClusterId(await clusterOwner.getAddress(), operatorIds);
    const explicitEb = 160;
    await setValidSingleLeafRoot(clusters, clusterId, 1, explicitEb);

    const updateTx = await clusters.updateClusterBalance(
      1,
      await clusterOwner.getAddress(),
      operatorIds,
      clusterAfterReg2,
      explicitEb,
      []
    );
    const clusterAfterUpdate = parseClusterFromEvent(clusters, await updateTx.wait(), Events.CLUSTER_BALANCE_UPDATED);

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(50000n);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(50000n);

    const removeTx = await clusters.connect(clusterOwner).removeValidator(firstPubKey, operatorIds, clusterAfterUpdate);
    const clusterAfterRemove = parseClusterFromEvent(clusters, await removeTx.wait(), Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove.validatorCount).to.equal(1n);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(40000n);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(40000n);
  });

  it("removing the last validator clears DAO deviation for explicit-EB cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(103);
    const registerTx = await clusters.connect(clusterOwner).registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const clusterAfterRegister = parseClusterFromEvent(clusters, await registerTx.wait(), Events.VALIDATOR_ADDED);

    const clusterId = computeClusterId(await clusterOwner.getAddress(), operatorIds);
    await setValidSingleLeafRoot(clusters, clusterId, 1, 64);

    const updateTx = await clusters.updateClusterBalance(
      1,
      await clusterOwner.getAddress(),
      operatorIds,
      clusterAfterRegister,
      64,
      []
    );
    const clusterAfterUpdate = parseClusterFromEvent(clusters, await updateTx.wait(), Events.CLUSTER_BALANCE_UPDATED);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);

    const removeTx = await clusters.connect(clusterOwner).removeValidator(publicKey, operatorIds, clusterAfterUpdate);
    const clusterAfterRemove = parseClusterFromEvent(clusters, await removeTx.wait(), Events.VALIDATOR_REMOVED);

    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
  });
});
