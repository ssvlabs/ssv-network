import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture, getClustersHarnessFixture } from "../../setup/fixtures.ts";
import { defaultClustersFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, computeClusterId, computeEBRoot, createCluster, extractEventArgs, makePublicKey, parseClusterFromEvent, registerAndParseCluster } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, VUNITS_PRECISION } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { ethers } from "ethers";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

const OPERATOR_FEE = 10_000_000_000n;

describe("SSVClusters function `updateClusterBalance()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let otherAccount: HardhatEthersSigner;
  let deployClustersWith13Operators!: ReturnType<typeof getClustersHarnessFixture>;
  let deployClustersWith13OperatorsAutoLiq!: () => Promise<{ clusters: any; operatorIds: bigint[] }>;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, otherAccount] } = await setupTestContext());
    deployClustersWith13Operators = getClustersHarnessFixture(connection, 13);
    deployClustersWith13OperatorsAutoLiq = () => ssvClustersHarnessFixture(connection, 13, OPERATOR_FEE);
  });

  const deploySSVClustersAndPrepareOperatorsFixture = async () => {
    return defaultClustersFixture(connection);
  };



  it("Is reverted with 'RootNotFound' when EB root is missing for the provided block", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerAndParseCluster(clusters, operatorIds);

    await expect(clusters.updateClusterBalance(
      1,
      clusterOwner.address,
      operatorIds,
      cluster,
      32,
      []
    )).to.be.revertedWithCustomError(clusters, Errors.ROOT_NOT_FOUND);
  });

  it("Updates cluster balance when proof is valid", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerAndParseCluster(clusters, operatorIds);

    const blockNum = 1;
    const effectiveBalance = 32;

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const root = computeEBRoot(clusterId, effectiveBalance);

    await clusters.mockSetEBRoot(blockNum, root);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(VUNITS_PRECISION);
    }

    const tx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.UPDATE_CLUSTER_BALANCE]);

    await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(eventArgs.owner).to.equal(clusterOwner.address);
    expect(eventArgs.operatorIds).to.deep.equal(operatorIds);
    expect(eventArgs.blockNum).to.equal(BigInt(blockNum));
    expect(eventArgs.effectiveBalance).to.equal(effectiveBalance);

    const clusterAfter = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(clusterAfter.active).to.equal(true);
    expect(clusterAfter.validatorCount).to.equal(cluster.validatorCount);

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(VUNITS_PRECISION);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(VUNITS_PRECISION);
    }
  });

  it("Updates operator ETH vUnits when effective balance changes", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerAndParseCluster(clusters, operatorIds);

    const blockNum = 1;
    const effectiveBalance = 33;

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const root = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    const vUnitsPerValidator = 32n;
    const newVUnits = ((BigInt(effectiveBalance) * VUNITS_PRECISION) + vUnitsPerValidator - 1n) / vUnitsPerValidator;

    const tx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    );
    const receipt = await tx.wait();

    const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(eventArgs.effectiveBalance).to.equal(effectiveBalance);

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(newVUnits);
    for (const operatorId of operatorIds) {
      const deviation = newVUnits - VUNITS_PRECISION;
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(deviation);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(newVUnits);
    }
  });

  it("Is reverted with 'InvalidProof' when merkle proof is invalid", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerAndParseCluster(clusters, operatorIds);

    const blockNum = 1;
    const effectiveBalance = 32;

    await clusters.mockSetEBRoot(blockNum, ethers.keccak256("0x1234"));

    await expect(clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    )).to.be.revertedWithCustomError(clusters, Errors.INVALID_PROOF);
  });

  it("Is reverted with 'EBExceedsMaximum' when effective balance exceeds 2048 ETH per validator", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerAndParseCluster(clusters, operatorIds);

    const blockNum = 1;
    const effectiveBalance = 2049;

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const root = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    await expect(clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    )).to.be.revertedWithCustomError(clusters, Errors.EB_EXCEEDS_MAXIMUM);
  });

  it("Accepts EB at exactly maximum (2048 ETH per 1 validator) and produces 640000 vUnits", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerAndParseCluster(clusters, operatorIds);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const blockNum = 1;
    const effectiveBalance = 2048;

    const root = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    const tx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    );
    const receipt = await tx.wait();

    await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(eventArgs.effectiveBalance).to.equal(effectiveBalance);

    const expectedVUnits = 640_000n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);

    const expectedDeviation = 630_000n;
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(expectedDeviation);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(expectedVUnits);
    }
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(expectedVUnits);
  });

  it("Accepts EB at exactly maximum for 2-validator cluster (4096 ETH) and produces 1,280,000 vUnits", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const registerTx1 = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt1 = await registerTx1.wait();
    const clusterAfter1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

    const registerTx2 = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfter1,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt2 = await registerTx2.wait();
    const clusterWith2 = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const blockNum = 1;
    const effectiveBalance = 4096;

    const root = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    const tx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      clusterWith2,
      effectiveBalance,
      []
    );
    await tx.wait();

    await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);

    const expectedVUnits = 1_280_000n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);

    const expectedDeviation = 1_260_000n;
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(expectedDeviation);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(expectedVUnits);
    }
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(expectedVUnits);
  });

  it("Is reverted with 'EBExceedsMaximum' when EB exceeds 2048 ETH per validator for a 2-validator cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const registerTx1 = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt1 = await registerTx1.wait();
    const clusterAfter1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

    const registerTx2 = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfter1,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt2 = await registerTx2.wait();
    const clusterWith2 = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const blockNum = 1;
    const effectiveBalance = 4097;

    const root = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    await expect(clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      clusterWith2,
      effectiveBalance,
      []
    )).to.be.revertedWithCustomError(clusters, Errors.EB_EXCEEDS_MAXIMUM);
  });

  it("Is reverted with 'StaleUpdate' when blockNum is not increasing", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerAndParseCluster(clusters, operatorIds);

    const blockNum = 1;
    const effectiveBalance = 32;

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const root = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    const tx1 = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    );
    const receipt1 = await tx1.wait();
    const clusterAfter1 = parseClusterFromEvent(clusters, receipt1, Events.CLUSTER_BALANCE_UPDATED);

    await expect(clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      clusterAfter1,
      effectiveBalance,
      []
    )).to.be.revertedWithCustomError(clusters, Errors.STALE_UPDATE);
  });

  it("Updates only EB snapshot for SSV clusters (no ETH operator vUnits accounting)", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const ssvCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    };
    await clusters.mockRegisterSSVValidator(makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster);

    const blockNum = 1;
    const effectiveBalance = 32;

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const root = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
    expect(await clusters.getClusterHash(clusterId)).to.equal(ethers.ZeroHash);

    await (await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      ssvCluster,
      effectiveBalance,
      []
    )).wait();

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(VUNITS_PRECISION);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
    expect(await clusters.getClusterHash(clusterId)).to.equal(ethers.ZeroHash);
  });

  it("Succeeds on a liquidated cluster: updates EB snapshot but skips fee settlement and vUnit updates", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerAndParseCluster(clusters, operatorIds);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, cluster);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
    expect(liquidatedCluster.active).to.equal(false);
    expect(liquidatedCluster.balance).to.equal(0n);

    const operatorVUnitsBefore = await clusters.getOperatorEthVUnits(operatorIds[0]);
    expect(operatorVUnitsBefore).to.equal(0n);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);

    const blockNum = 1;
    const effectiveBalance = 33;
    const root = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    const tx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      liquidatedCluster,
      effectiveBalance,
      []
    );
    const receipt = await tx.wait();

    await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(eventArgs.effectiveBalance).to.equal(effectiveBalance);

    const clusterAfter = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(clusterAfter.active).to.equal(false);
    expect(clusterAfter.balance).to.equal(0n);

    const expectedVUnits = (BigInt(effectiveBalance) * VUNITS_PRECISION + 32n - 1n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);

    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(operatorVUnitsBefore);
  });

  it("EB update on insolvent liquidated cluster does not corrupt operator or DAO vUnit accounting", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    const cluster = await registerAndParseCluster(clusters, operatorIds);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const blockNum1 = 1;
    const effectiveBalance1 = 64;
    const root1 = computeEBRoot(clusterId, effectiveBalance1);
    await clusters.mockSetEBRoot(blockNum1, root1);

    const tx1 = await clusters.updateClusterBalance(
      blockNum1,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance1,
      []
    );
    const receipt1 = await tx1.wait();
    const clusterAfterEB = parseClusterFromEvent(clusters, receipt1, Events.CLUSTER_BALANCE_UPDATED);
    const deviationAfterEBUpdate = 10000n;
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(deviationAfterEBUpdate);
    }
    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterEB);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
    expect(liquidatedCluster.active).to.equal(false);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
    const daoVUnitsAfterLiquidation = await clusters.getDaoTotalEthVUnits();
    const blockNum2 = 2;
    const effectiveBalance2 = 128;
    const root2 = computeEBRoot(clusterId, effectiveBalance2);
    await clusters.mockSetEBRoot(blockNum2, root2);

    const tx2 = await clusters.updateClusterBalance(
      blockNum2,
      clusterOwner.address,
      operatorIds,
      liquidatedCluster,
      effectiveBalance2,
      []
    );
    const receipt2 = await tx2.wait();
    await expect(tx2).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const clusterAfterUpdate = parseClusterFromEvent(clusters, receipt2, Events.CLUSTER_BALANCE_UPDATED);
    expect(clusterAfterUpdate.active).to.equal(false);
    expect(clusterAfterUpdate.balance).to.equal(0n);
    const expectedVUnits2 = (BigInt(effectiveBalance2) * VUNITS_PRECISION + 32n - 1n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits2);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoVUnitsAfterLiquidation);
  });

  it("Is reverted with 'EBBelowMinimum' when effective balance is below 32 ETH per validator", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const registerTx1 = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt1 = await registerTx1.wait();
    const clusterAfter1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

    const registerTx2 = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfter1,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt2 = await registerTx2.wait();
    const clusterAfter2 = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

    const blockNum = 1;
    const effectiveBalance = 60;

    const clusterId = ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [clusterOwner.address, operatorIds])
    );
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const innerHash = ethers.keccak256(coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance]));
    const root = ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
    await clusters.mockSetEBRoot(blockNum, root);

    await expect(clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      clusterAfter2,
      effectiveBalance,
      []
    )).to.be.revertedWithCustomError(clusters, Errors.EB_BELOW_MINIMUM);
  });

  it("Multi-validator liquidated cluster: EB update preserves per-validator vUnit accounting", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    const registerTx1 = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt1 = await registerTx1.wait();
    const clusterAfter1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

    const registerTx2 = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfter1,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt2 = await registerTx2.wait();
    const clusterWith2Validators = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);
    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterWith2Validators);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
    expect(liquidatedCluster.active).to.equal(false);
    expect(liquidatedCluster.validatorCount).to.equal(2n);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const blockNum = 1;
    const effectiveBalance = 66;
    const root = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    const tx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      liquidatedCluster,
      effectiveBalance,
      []
    );
    const receipt = await tx.wait();

    await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const clusterAfter = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(clusterAfter.active).to.equal(false);
    expect(clusterAfter.balance).to.equal(0n);
    expect(clusterAfter.validatorCount).to.equal(2n);
    const expectedVUnits = (BigInt(effectiveBalance) * VUNITS_PRECISION + 32n - 1n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
  });

  it("EB decrease on liquidated cluster: updates snapshot without corrupting accounting", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerAndParseCluster(clusters, operatorIds);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const blockNum1 = 1;
    const effectiveBalance1 = 64;
    const root1 = computeEBRoot(clusterId, effectiveBalance1);
    await clusters.mockSetEBRoot(blockNum1, root1);

    const tx1 = await clusters.updateClusterBalance(
      blockNum1,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance1,
      []
    );
    const receipt1 = await tx1.wait();
    const clusterAfterEBIncrease = parseClusterFromEvent(clusters, receipt1, Events.CLUSTER_BALANCE_UPDATED);
    const deviationAfterIncrease = 10000n;
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(deviationAfterIncrease);
    }
    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterEBIncrease);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
    expect(liquidatedCluster.active).to.equal(false);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
    const daoVUnitsAfterLiquidation = await clusters.getDaoTotalEthVUnits();
    const blockNum2 = 2;
    const effectiveBalance2 = 40;
    const root2 = computeEBRoot(clusterId, effectiveBalance2);
    await clusters.mockSetEBRoot(blockNum2, root2);

    const tx2 = await clusters.updateClusterBalance(
      blockNum2,
      clusterOwner.address,
      operatorIds,
      liquidatedCluster,
      effectiveBalance2,
      []
    );
    const receipt2 = await tx2.wait();

    await expect(tx2).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const clusterAfterDecrease = parseClusterFromEvent(clusters, receipt2, Events.CLUSTER_BALANCE_UPDATED);
    expect(clusterAfterDecrease.active).to.equal(false);
    expect(clusterAfterDecrease.balance).to.equal(0n);
    const expectedVUnits2 = (BigInt(effectiveBalance2) * VUNITS_PRECISION + 32n - 1n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits2);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoVUnitsAfterLiquidation);
  });

  it("Liquidated cluster with implicit EB: first updateClusterBalance transitions to explicit tracking", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    const cluster = await registerAndParseCluster(clusters, operatorIds);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, cluster);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
    expect(liquidatedCluster.active).to.equal(false);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
    const blockNum = 1;
    const effectiveBalance = 35;
    const root = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    const tx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      liquidatedCluster,
      effectiveBalance,
      []
    );
    const receipt = await tx.wait();

    await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const clusterAfter = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(clusterAfter.active).to.equal(false);
    expect(clusterAfter.balance).to.equal(0n);
    const expectedVUnits = (BigInt(effectiveBalance) * VUNITS_PRECISION + 32n - 1n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
  });

  it("EB update with effectiveBalance = 0 on zero-validator cluster succeeds without modifying vUnit state", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerAndParseCluster(clusters, operatorIds);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const removeTx = await clusters.removeValidator(makePublicKey(1), operatorIds, cluster);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);
    expect(clusterAfterRemove.validatorCount).to.equal(0n);

    const daoVUnitsBefore = await clusters.getDaoTotalEthVUnits();

    const blockNum = 1;
    const root = computeEBRoot(clusterId, 0);
    await clusters.mockSetEBRoot(blockNum, root);

    const tx = await clusters.updateClusterBalance(
      blockNum, clusterOwner.address, operatorIds, clusterAfterRemove, 0, []
    );
    const receipt = await tx.wait();

    await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(eventArgs.effectiveBalance).to.equal(0);

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoVUnitsBefore);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
  });

  it("Oracle EB report effectiveBalance = 0 on active zero-validator cluster resets explicit EB to implicit-EB sentinel", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(0n);
    await clusters.mockEthNetworkFee(0n);

    const cluster = await registerAndParseCluster(clusters, operatorIds);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const blockNum1 = 1;
    const effectiveBalance1 = 64;
    const root1 = computeEBRoot(clusterId, effectiveBalance1);
    await clusters.mockSetEBRoot(blockNum1, root1);

    const ebTx1 = await clusters.updateClusterBalance(
      blockNum1, clusterOwner.address, operatorIds, cluster, effectiveBalance1, []
    );
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    const expectedVUnits = (64n * VUNITS_PRECISION + 32n - 1n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);

    const removeTx = await clusters.removeValidator(makePublicKey(1), operatorIds, clusterAfterEB);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);
    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(clusterAfterRemove.active).to.equal(true);

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
    const daoVUnitsAfterRemove = await clusters.getDaoTotalEthVUnits();

    const blockNum2 = 2;
    const root2 = computeEBRoot(clusterId, 0);
    await clusters.mockSetEBRoot(blockNum2, root2);

    const tx = await clusters.updateClusterBalance(
      blockNum2, clusterOwner.address, operatorIds, clusterAfterRemove, 0, []
    );
    const receipt = await tx.wait();

    await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(eventArgs.effectiveBalance).to.equal(0);

    const clusterAfterEB0 = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(clusterAfterEB0.active).to.equal(true);
    expect(clusterAfterEB0.validatorCount).to.equal(0n);

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoVUnitsAfterRemove);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
  });

  it("Updates vUnit accounting correctly for 13 operators at maximum EB (2048 ETH per validator)", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const cluster = await registerAndParseCluster(clusters, operatorIds);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const effectiveBalance = 2048;
    const blockNum = 1;
    const root = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    await clusters.updateClusterBalance(blockNum, clusterOwner.address, operatorIds, cluster, effectiveBalance, []);

    const expectedVUnits = (BigInt(effectiveBalance) * VUNITS_PRECISION + 32n - 1n) / 32n;
    const expectedDeviation = expectedVUnits - VUNITS_PRECISION;

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(expectedVUnits);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(expectedDeviation);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(expectedVUnits);
    }
  });
  it("Auto-liquidates cluster with 13 operators when EB increase to maximum makes it insolvent", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13OperatorsAutoLiq);

    await clusters.mockEthNetworkFee(100_000n);
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const depositValue = ethers.parseEther("0.0001");
    const regTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: depositValue }
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const root1 = computeEBRoot(clusterId, 32);
    await clusters.mockSetEBRoot(1, root1);
    const ebTx1 = await clusters.updateClusterBalance(1, clusterOwner.address, operatorIds, clusterAfterReg, 32, []);
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB32 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    expect(clusterAfterEB32.active).to.equal(true);
    await expect(
      clusters.connect(otherAccount).liquidate(clusterOwner.address, operatorIds, clusterAfterEB32)
    ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);

    const root2 = computeEBRoot(clusterId, 2048);
    await clusters.mockSetEBRoot(2, root2);
    const ebTx2 = await clusters.updateClusterBalance(2, clusterOwner.address, operatorIds, clusterAfterEB32, 2048, []);
    const ebReceipt2 = await ebTx2.wait();
    const clusterAfterEB2048 = parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_LIQUIDATED);

    expect(clusterAfterEB2048.active).to.equal(false);
    expect(clusterAfterEB2048.balance).to.equal(0n);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
  });
});
