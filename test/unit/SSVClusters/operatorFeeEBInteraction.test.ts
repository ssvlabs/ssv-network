import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_SHARES, BPS_DENOMINATOR, ETH_DEDUCTED_DIGITS, MINIMAL_OPERATOR_ETH_FEE } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { mockEBAndUpdate } from "../../helpers/oracle.ts";
import { ethers } from "ethers";

const INITIAL_FEE = MINIMAL_OPERATOR_ETH_FEE;
const DOUBLED_FEE = MINIMAL_OPERATOR_ETH_FEE * 2n;
const TRIPLED_FEE = MINIMAL_OPERATOR_ETH_FEE * 3n;

describe("Operator fee change + EB burn rate interaction", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, liquidator] } = await setupTestContext());
  });


  const deployWithInitialFee = async () => ssvClustersHarnessFixture(connection, 4, INITIAL_FEE);
  const deployWithDoubledFee = async () => ssvClustersHarnessFixture(connection, 4, DOUBLED_FEE);

  const getOperatorSnapshotWei = async (clusters: any, operatorId: bigint) => {
    const [, snapshotBlock, operatorEarnings] = await clusters.getOperatorEthSnapshot(operatorId);
    return {
      snapshotBlock: BigInt(snapshotBlock),
      earningsWei: operatorEarnings * ETH_DEDUCTED_DIGITS,
    };
  };

  it("Fee increase with EB=64 cluster → burn rate doubles", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithInitialFee);

    const depositValue = ethers.parseEther("100");
    const regTx = await clusters.registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: depositValue },
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    const { cluster: clusterAfterEB, block: ebBlock } = await mockEBAndUpdate(clusters, clusterOwner.address, operatorIds, clusterAfterReg, 64, 1);
    const expectedVUnits = (64n * BPS_DENOMINATOR + 31n) / 32n;
    expect(expectedVUnits).to.equal(20000n);

    await networkHelpers.mine(500);
    const w1Tx = await clusters.withdraw(operatorIds, 0n, clusterAfterEB);
    await expect(w1Tx).to.emit(clusters, Events.CLUSTER_WITHDRAWN);
    const w1Receipt = await w1Tx.wait();
    const clusterAfterP1 = parseClusterFromEvent(clusters, w1Receipt, Events.CLUSTER_WITHDRAWN);
    const w1Block = BigInt(w1Receipt!.blockNumber);
    const burnP1 = clusterAfterEB.balance - clusterAfterP1.balance;
    const snapBeforeFeeExec = await getOperatorSnapshotWei(clusters, operatorIds[0]);

    const fcTx = await clusters.mockExecuteAllOperatorFees(operatorIds, DOUBLED_FEE);
    await expect(fcTx).to.emit(clusters, Events.OPERATOR_FEE_EXECUTED);
    const fcReceipt = await fcTx.wait();
    const fcBlock = BigInt(fcReceipt!.blockNumber);
    const snapAfterFeeExec = await getOperatorSnapshotWei(clusters, operatorIds[0]);

    await networkHelpers.mine(500);
    const w2Tx = await clusters.withdraw(operatorIds, 0n, clusterAfterP1);
    await expect(w2Tx).to.emit(clusters, Events.CLUSTER_WITHDRAWN);
    const w2Receipt = await w2Tx.wait();
    const clusterAfterP2 = parseClusterFromEvent(clusters, w2Receipt, Events.CLUSTER_WITHDRAWN);
    const w2Block = BigInt(w2Receipt!.blockNumber);
    const burnP2 = clusterAfterP1.balance - clusterAfterP2.balance;

    const settleTx = await clusters.mockExecuteAllOperatorFees([operatorIds[0]], DOUBLED_FEE);
    await expect(settleTx).to.emit(clusters, Events.OPERATOR_FEE_EXECUTED);
    const settleReceipt = await settleTx.wait();
    const settleBlock = BigInt(settleReceipt!.blockNumber);
    const snapAfterSettle = await getOperatorSnapshotWei(clusters, operatorIds[0]);

    const packedInitial = INITIAL_FEE / ETH_DEDUCTED_DIGITS;
    const packedDoubled = DOUBLED_FEE / ETH_DEDUCTED_DIGITS;
    const numOps = BigInt(operatorIds.length);

    const p1Blocks = w1Block - ebBlock;
    const expectedBurnP1 = (numOps * p1Blocks * packedInitial * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
    const expectedEarningsAtFeeExec = ((fcBlock - snapBeforeFeeExec.snapshotBlock) * packedInitial * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

    const transitionBlocks = fcBlock - w1Block;
    const p2NewFeeBlocks = w2Block - fcBlock;
    const idxOpP2 = numOps * (transitionBlocks * packedInitial + p2NewFeeBlocks * packedDoubled);
    const expectedBurnP2 = (idxOpP2 * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
    const expectedEarningsAtSettle = ((settleBlock - snapAfterFeeExec.snapshotBlock) * packedDoubled * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

    expect(burnP1).to.equal(expectedBurnP1);
    expect(burnP2).to.equal(expectedBurnP2);
    expect(burnP2).to.be.greaterThan(burnP1);
    expect(snapAfterFeeExec.earningsWei - snapBeforeFeeExec.earningsWei).to.equal(expectedEarningsAtFeeExec);
    expect(snapAfterSettle.earningsWei - snapAfterFeeExec.earningsWei).to.equal(expectedEarningsAtSettle);
  });

  it("Fee reduction with EB=128 cluster → savings reflected", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithDoubledFee);

    const depositValue = ethers.parseEther("100");
    const regTx = await clusters.registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: depositValue },
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    const { cluster: clusterAfterEB, block: ebBlock } = await mockEBAndUpdate(clusters, clusterOwner.address, operatorIds, clusterAfterReg, 128, 1);
    const expectedVUnits = (128n * BPS_DENOMINATOR + 31n) / 32n;
    expect(expectedVUnits).to.equal(40000n);

    await networkHelpers.mine(500);
    const w1Tx = await clusters.withdraw(operatorIds, 0n, clusterAfterEB);
    await expect(w1Tx).to.emit(clusters, Events.CLUSTER_WITHDRAWN);
    const w1Receipt = await w1Tx.wait();
    const clusterAfterP1 = parseClusterFromEvent(clusters, w1Receipt, Events.CLUSTER_WITHDRAWN);
    const w1Block = BigInt(w1Receipt!.blockNumber);
    const burnP1 = clusterAfterEB.balance - clusterAfterP1.balance;
    const snapBeforeFeeExec = await getOperatorSnapshotWei(clusters, operatorIds[0]);

    const fcTx = await clusters.mockExecuteAllOperatorFees(operatorIds, INITIAL_FEE);
    await expect(fcTx).to.emit(clusters, Events.OPERATOR_FEE_EXECUTED);
    const fcReceipt = await fcTx.wait();
    const fcBlock = BigInt(fcReceipt!.blockNumber);
    const snapAfterFeeExec = await getOperatorSnapshotWei(clusters, operatorIds[0]);

    await networkHelpers.mine(500);
    const w2Tx = await clusters.withdraw(operatorIds, 0n, clusterAfterP1);
    await expect(w2Tx).to.emit(clusters, Events.CLUSTER_WITHDRAWN);
    const w2Receipt = await w2Tx.wait();
    const clusterAfterP2 = parseClusterFromEvent(clusters, w2Receipt, Events.CLUSTER_WITHDRAWN);
    const w2Block = BigInt(w2Receipt!.blockNumber);
    const burnP2 = clusterAfterP1.balance - clusterAfterP2.balance;

    const settleTx = await clusters.mockExecuteAllOperatorFees([operatorIds[0]], INITIAL_FEE);
    await expect(settleTx).to.emit(clusters, Events.OPERATOR_FEE_EXECUTED);
    const settleReceipt = await settleTx.wait();
    const settleBlock = BigInt(settleReceipt!.blockNumber);
    const snapAfterSettle = await getOperatorSnapshotWei(clusters, operatorIds[0]);

    const packedDoubled = DOUBLED_FEE / ETH_DEDUCTED_DIGITS;
    const packedInitial = INITIAL_FEE / ETH_DEDUCTED_DIGITS;
    const numOps = BigInt(operatorIds.length);

    const p1Blocks = w1Block - ebBlock;
    const expectedBurnP1 = (numOps * p1Blocks * packedDoubled * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
    const expectedEarningsAtFeeExec = ((fcBlock - snapBeforeFeeExec.snapshotBlock) * packedDoubled * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

    const transitionBlocks = fcBlock - w1Block;
    const p2NewFeeBlocks = w2Block - fcBlock;
    const idxOpP2 = numOps * (transitionBlocks * packedDoubled + p2NewFeeBlocks * packedInitial);
    const expectedBurnP2 = (idxOpP2 * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
    const expectedEarningsAtSettle = ((settleBlock - snapAfterFeeExec.snapshotBlock) * packedInitial * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

    expect(burnP1).to.equal(expectedBurnP1);
    expect(burnP2).to.equal(expectedBurnP2);
    expect(burnP2).to.be.lessThan(burnP1);
    expect(snapAfterFeeExec.earningsWei - snapBeforeFeeExec.earningsWei).to.equal(expectedEarningsAtFeeExec);
    expect(snapAfterSettle.earningsWei - snapAfterFeeExec.earningsWei).to.equal(expectedEarningsAtSettle);
  });

  it("Fee change boundary accounting — total burn = sum of both rate periods", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithInitialFee);

    const depositValue = ethers.parseEther("100");
    const regTx = await clusters.registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: depositValue },
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    const { cluster: clusterAfterEB, block: ebBlock } = await mockEBAndUpdate(clusters, clusterOwner.address, operatorIds, clusterAfterReg, 96, 1);
    const expectedVUnits = (96n * BPS_DENOMINATOR + 31n) / 32n;
    expect(expectedVUnits).to.equal(30000n);

    await networkHelpers.mine(200);

    const fcTx = await clusters.mockExecuteAllOperatorFees(operatorIds, TRIPLED_FEE);
    await expect(fcTx).to.emit(clusters, Events.OPERATOR_FEE_EXECUTED);
    const fcReceipt = await fcTx.wait();
    const fcBlock = BigInt(fcReceipt!.blockNumber);

    await networkHelpers.mine(300);

    const wTx = await clusters.withdraw(operatorIds, 0n, clusterAfterEB);
    await expect(wTx).to.emit(clusters, Events.CLUSTER_WITHDRAWN);
    const wReceipt = await wTx.wait();
    const clusterAfterW = parseClusterFromEvent(clusters, wReceipt, Events.CLUSTER_WITHDRAWN);
    const wBlock = BigInt(wReceipt!.blockNumber);
    const totalBurn = clusterAfterEB.balance - clusterAfterW.balance;

    const packedInitial = INITIAL_FEE / ETH_DEDUCTED_DIGITS;
    const packedTripled = TRIPLED_FEE / ETH_DEDUCTED_DIGITS;
    const numOps = BigInt(operatorIds.length);

    const preChangeBlocks = fcBlock - ebBlock;
    const postChangeBlocks = wBlock - fcBlock;
    const idxOp = numOps * (preChangeBlocks * packedInitial + postChangeBlocks * packedTripled);
    const expectedBurn = (idxOp * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

    expect(totalBurn).to.equal(expectedBurn);
    expect(totalBurn).to.be.greaterThan(0n);
    expect(clusterAfterW.balance).to.be.greaterThan(0n);

    const totalBlocks = wBlock - ebBlock;
    const burnIfAllOld = (numOps * totalBlocks * packedInitial * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
    const burnIfAllNew = (numOps * totalBlocks * packedTripled * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

    expect(totalBurn).to.be.greaterThan(burnIfAllOld);
    expect(totalBurn).to.be.lessThan(burnIfAllNew);
  });

  it("Fee change with EB=0 (implicit vUnits mode) settles with baseline vUnits", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithInitialFee);

    const regTx = await clusters.registerValidator(
      makePublicKey(2), operatorIds, DEFAULT_SHARES, createCluster(), { value: ethers.parseEther("50") },
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);
    const regBlock = BigInt(regReceipt!.blockNumber);

    await networkHelpers.mine(100);
    const snapBeforeFeeExec = await getOperatorSnapshotWei(clusters, operatorIds[0]);
    const fcTx = await clusters.mockExecuteAllOperatorFees(operatorIds, DOUBLED_FEE);
    await expect(fcTx).to.emit(clusters, Events.OPERATOR_FEE_EXECUTED);
    const fcReceipt = await fcTx.wait();
    const fcBlock = BigInt(fcReceipt!.blockNumber);
    const snapAfterFeeExec = await getOperatorSnapshotWei(clusters, operatorIds[0]);

    await networkHelpers.mine(100);
    const wTx = await clusters.withdraw(operatorIds, 0n, clusterAfterReg);
    await expect(wTx).to.emit(clusters, Events.CLUSTER_WITHDRAWN);
    const wReceipt = await wTx.wait();
    const clusterAfterW = parseClusterFromEvent(clusters, wReceipt, Events.CLUSTER_WITHDRAWN);
    const wBlock = BigInt(wReceipt!.blockNumber);

    const packedInitial = INITIAL_FEE / ETH_DEDUCTED_DIGITS;
    const packedDoubled = DOUBLED_FEE / ETH_DEDUCTED_DIGITS;
    const baselineVUnits = 10_000n;
    const numOps = BigInt(operatorIds.length);

    const expectedBurn = (
      numOps * (
        (fcBlock - regBlock) * packedInitial +
        (wBlock - fcBlock) * packedDoubled
      ) * baselineVUnits / BPS_DENOMINATOR
    ) * ETH_DEDUCTED_DIGITS;
    expect(clusterAfterReg.balance - clusterAfterW.balance).to.equal(expectedBurn);

    const expectedFeeExecDelta = ((fcBlock - snapBeforeFeeExec.snapshotBlock) * packedInitial * baselineVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
    expect(snapAfterFeeExec.earningsWei - snapBeforeFeeExec.earningsWei).to.equal(expectedFeeExecDelta);

    const settleTx = await clusters.mockExecuteAllOperatorFees([operatorIds[0]], DOUBLED_FEE);
    await expect(settleTx).to.emit(clusters, Events.OPERATOR_FEE_EXECUTED);
    const settleReceipt = await settleTx.wait();
    const settleBlock = BigInt(settleReceipt!.blockNumber);
    const snapAfterSettle = await getOperatorSnapshotWei(clusters, operatorIds[0]);
    const expectedSettleDelta = ((settleBlock - snapAfterFeeExec.snapshotBlock) * packedDoubled * baselineVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
    expect(snapAfterSettle.earningsWei - snapAfterFeeExec.earningsWei).to.equal(expectedSettleDelta);
  });

  it("Fee change with removed operators skips removed entries and settles active operators", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithInitialFee);

    const regTx = await clusters.registerValidator(
      makePublicKey(3), operatorIds, DEFAULT_SHARES, createCluster(), { value: ethers.parseEther("60") },
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    const { cluster: clusterAfterEB } = await mockEBAndUpdate(clusters, clusterOwner.address, operatorIds, clusterAfterReg, 64, 1);

    await networkHelpers.mine(40);
    await clusters.mockRemoveOperator(operatorIds[0]);

    const fcTx = await clusters.mockExecuteAllOperatorFees(operatorIds, TRIPLED_FEE);
    await expect(fcTx).to.emit(clusters, Events.OPERATOR_FEE_EXECUTED);
    await fcTx.wait();

    await networkHelpers.mine(40);
    const wTx = await clusters.withdraw(operatorIds, 0n, clusterAfterEB);
    await expect(wTx).to.emit(clusters, Events.CLUSTER_WITHDRAWN);
    await wTx.wait();

    const [, removedBlock, removedBalance] = await clusters.getOperatorEthSnapshot(operatorIds[0]);
    expect(removedBlock).to.equal(0);
    expect(removedBalance).to.equal(0n);
    const activeOperatorSnapshot = await getOperatorSnapshotWei(clusters, operatorIds[1]);
    expect(activeOperatorSnapshot.earningsWei).to.be.greaterThan(0n);
  });

  it("Fee change can make cluster immediately liquidatable at max EB", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithInitialFee);

    await clusters.mockMinimumBlocksBeforeLiquidation(1n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const regTx = await clusters.registerValidator(
      makePublicKey(4), operatorIds, DEFAULT_SHARES, createCluster(), { value: 5_000_000_000_000n },
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    const { cluster: clusterAfterEB } = await mockEBAndUpdate(clusters, clusterOwner.address, operatorIds, clusterAfterReg, 2048, 1);
    await clusters.mockExecuteAllOperatorFees(operatorIds, TRIPLED_FEE);
    await networkHelpers.mine(2);

    const liqTx = await clusters.connect(liquidator).liquidate(
      clusterOwner.address,
      operatorIds,
      clusterAfterEB,
    );
    await expect(liqTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
  });

  it("Multiple fee changes in quick succession preserve exact accounting", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithInitialFee);

    const regTx = await clusters.registerValidator(
      makePublicKey(5), operatorIds, DEFAULT_SHARES, createCluster(), { value: ethers.parseEther("80") },
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);
    const { cluster: clusterAfterEB, block: ebBlock } = await mockEBAndUpdate(clusters, clusterOwner.address, operatorIds, clusterAfterReg, 96, 1);
    const vUnits = 30_000n;

    await networkHelpers.mine(10);
    const fc1Tx = await clusters.mockExecuteAllOperatorFees(operatorIds, DOUBLED_FEE);
    await expect(fc1Tx).to.emit(clusters, Events.OPERATOR_FEE_EXECUTED);
    const fc1Receipt = await fc1Tx.wait();
    const fc1Block = BigInt(fc1Receipt!.blockNumber);

    const fc2Tx = await clusters.mockExecuteAllOperatorFees(operatorIds, TRIPLED_FEE);
    await expect(fc2Tx).to.emit(clusters, Events.OPERATOR_FEE_EXECUTED);
    const fc2Receipt = await fc2Tx.wait();
    const fc2Block = BigInt(fc2Receipt!.blockNumber);

    await networkHelpers.mine(20);
    const wTx = await clusters.withdraw(operatorIds, 0n, clusterAfterEB);
    await expect(wTx).to.emit(clusters, Events.CLUSTER_WITHDRAWN);
    const wReceipt = await wTx.wait();
    const wBlock = BigInt(wReceipt!.blockNumber);
    const clusterAfterW = parseClusterFromEvent(clusters, wReceipt, Events.CLUSTER_WITHDRAWN);

    const packedInitial = INITIAL_FEE / ETH_DEDUCTED_DIGITS;
    const packedDoubled = DOUBLED_FEE / ETH_DEDUCTED_DIGITS;
    const packedTripled = TRIPLED_FEE / ETH_DEDUCTED_DIGITS;
    const numOps = BigInt(operatorIds.length);

    const expectedBurn = (
      numOps * (
        (fc1Block - ebBlock) * packedInitial +
        (fc2Block - fc1Block) * packedDoubled +
        (wBlock - fc2Block) * packedTripled
      ) * vUnits / BPS_DENOMINATOR
    ) * ETH_DEDUCTED_DIGITS;
    expect(clusterAfterEB.balance - clusterAfterW.balance).to.equal(expectedBurn);

    const snapAfterFc2 = await getOperatorSnapshotWei(clusters, operatorIds[0]);
    const settleTx = await clusters.mockExecuteAllOperatorFees([operatorIds[0]], TRIPLED_FEE);
    await expect(settleTx).to.emit(clusters, Events.OPERATOR_FEE_EXECUTED);
    const settleReceipt = await settleTx.wait();
    const settleBlock = BigInt(settleReceipt!.blockNumber);
    const snapAfterSettle = await getOperatorSnapshotWei(clusters, operatorIds[0]);
    const expectedSettleDelta = ((settleBlock - snapAfterFc2.snapshotBlock) * packedTripled * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
    expect(snapAfterSettle.earningsWei - snapAfterFc2.earningsWei).to.equal(expectedSettleDelta);
  });

  it("Fee change with max EB (2048 ETH/validator) uses capped vUnits in settlement", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithInitialFee);

    const regTx = await clusters.registerValidator(
      makePublicKey(6), operatorIds, DEFAULT_SHARES, createCluster(), { value: ethers.parseEther("120") },
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);
    const { cluster: clusterAfterEB, block: ebBlock } = await mockEBAndUpdate(clusters, clusterOwner.address, operatorIds, clusterAfterReg, 2048, 1);

    const maxVUnits = 640_000n;
    expect(await clusters.getEffectiveOperatorVUnits(operatorIds[0])).to.equal(maxVUnits);

    await networkHelpers.mine(20);
    const fcTx = await clusters.mockExecuteAllOperatorFees(operatorIds, DOUBLED_FEE);
    await expect(fcTx).to.emit(clusters, Events.OPERATOR_FEE_EXECUTED);
    const fcReceipt = await fcTx.wait();
    const fcBlock = BigInt(fcReceipt!.blockNumber);

    await networkHelpers.mine(20);
    const wTx = await clusters.withdraw(operatorIds, 0n, clusterAfterEB);
    await expect(wTx).to.emit(clusters, Events.CLUSTER_WITHDRAWN);
    const wReceipt = await wTx.wait();
    const wBlock = BigInt(wReceipt!.blockNumber);
    const clusterAfterW = parseClusterFromEvent(clusters, wReceipt, Events.CLUSTER_WITHDRAWN);

    const packedInitial = INITIAL_FEE / ETH_DEDUCTED_DIGITS;
    const packedDoubled = DOUBLED_FEE / ETH_DEDUCTED_DIGITS;
    const numOps = BigInt(operatorIds.length);

    const expectedBurn = (
      numOps * (
        (fcBlock - ebBlock) * packedInitial +
        (wBlock - fcBlock) * packedDoubled
      ) * maxVUnits / BPS_DENOMINATOR
    ) * ETH_DEDUCTED_DIGITS;
    expect(clusterAfterEB.balance - clusterAfterW.balance).to.equal(expectedBurn);

    const snapAfterFc = await getOperatorSnapshotWei(clusters, operatorIds[0]);
    const settleTx = await clusters.mockExecuteAllOperatorFees([operatorIds[0]], DOUBLED_FEE);
    await expect(settleTx).to.emit(clusters, Events.OPERATOR_FEE_EXECUTED);
    const settleReceipt = await settleTx.wait();
    const settleBlock = BigInt(settleReceipt!.blockNumber);
    const snapAfterSettle = await getOperatorSnapshotWei(clusters, operatorIds[0]);
    const expectedSettleDelta = ((settleBlock - snapAfterFc.snapshotBlock) * packedDoubled * maxVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
    expect(snapAfterSettle.earningsWei - snapAfterFc.earningsWei).to.equal(expectedSettleDelta);
  });

  it("Operator fee change with network fee accounting → both fees correctly deducted", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithInitialFee);

    const regTx = await clusters.registerValidator(
      makePublicKey(10), operatorIds, DEFAULT_SHARES, createCluster(), { value: ethers.parseEther("100") },
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    const { cluster: clusterAfterEB, block: ebBlock } = await mockEBAndUpdate(clusters, clusterOwner.address, operatorIds, clusterAfterReg, 64, 1);
    const vUnits = 20_000n;

    await networkHelpers.mine(100);

    const fcTx = await clusters.mockExecuteAllOperatorFees(operatorIds, DOUBLED_FEE);
    const fcReceipt = await fcTx.wait();
    const fcBlock = BigInt(fcReceipt!.blockNumber);

    const oldNetworkFeeIndex = clusterAfterEB.networkFeeIndex;

    await networkHelpers.mine(100);

    const wTx = await clusters.withdraw(operatorIds, 0n, clusterAfterEB);
    const wReceipt = await wTx.wait();
    const wBlock = BigInt(wReceipt!.blockNumber);
    const clusterAfterW = parseClusterFromEvent(clusters, wReceipt, Events.CLUSTER_WITHDRAWN);

    const numOps = BigInt(operatorIds.length);
    const packedInitialOp = INITIAL_FEE / ETH_DEDUCTED_DIGITS;
    const packedDoubledOp = DOUBLED_FEE / ETH_DEDUCTED_DIGITS;

    const p1Blocks = fcBlock - ebBlock;
    const p2Blocks = wBlock - fcBlock;
    const idxOp = numOps * (p1Blocks * packedInitialOp + p2Blocks * packedDoubledOp);
    const operatorFeeUnits = (idxOp * vUnits) / BPS_DENOMINATOR;

    const currentNetworkFeeIndex = clusterAfterW.networkFeeIndex;
    const idxNet = currentNetworkFeeIndex - oldNetworkFeeIndex;
    const networkFeeUnits = (idxNet * vUnits) / BPS_DENOMINATOR;

    const expectedBurn = (operatorFeeUnits + networkFeeUnits) * ETH_DEDUCTED_DIGITS;
    const actualBurn = clusterAfterEB.balance - clusterAfterW.balance;

    expect(actualBurn).to.equal(expectedBurn);
    expect(operatorFeeUnits).to.be.greaterThan(0n);
  });

  it("EB update between fee change execution updates vUnits for earnings calculation", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithInitialFee);

    const regTx = await clusters.registerValidator(
      makePublicKey(11), operatorIds, DEFAULT_SHARES, createCluster(), { value: ethers.parseEther("100") },
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    await networkHelpers.mine(50);

    await mockEBAndUpdate(clusters, clusterOwner.address, operatorIds, clusterAfterReg, 96, 1);
    const vUnitsAfterEB = 30_000n;

    await networkHelpers.mine(50);

    const snap2 = await getOperatorSnapshotWei(clusters, operatorIds[0]);
    const fcTx = await clusters.mockExecuteAllOperatorFees(operatorIds, DOUBLED_FEE);
    const fcReceipt = await fcTx.wait();
    const fcBlock = BigInt(fcReceipt!.blockNumber);
    const snap3 = await getOperatorSnapshotWei(clusters, operatorIds[0]);

    const packedInitial = INITIAL_FEE / ETH_DEDUCTED_DIGITS;
    const blocksDelta = fcBlock - snap2.snapshotBlock;
    const expectedDelta = (blocksDelta * packedInitial * vUnitsAfterEB / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

    expect(snap3.earningsWei - snap2.earningsWei).to.equal(expectedDelta);

    await networkHelpers.mine(50);

    const settleTx = await clusters.mockExecuteAllOperatorFees([operatorIds[0]], DOUBLED_FEE);
    const settleReceipt = await settleTx.wait();
    const settleBlock = BigInt(settleReceipt!.blockNumber);
    const snap4 = await getOperatorSnapshotWei(clusters, operatorIds[0]);

    const packedDoubled = DOUBLED_FEE / ETH_DEDUCTED_DIGITS;
    const blocksDelta2 = settleBlock - snap3.snapshotBlock;
    const expectedDelta2 = (blocksDelta2 * packedDoubled * vUnitsAfterEB / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

    expect(snap4.earningsWei - snap3.earningsWei).to.equal(expectedDelta2);
  });

  it("Fee change on 4-validator cluster with EB=128 (avg 32 ETH/validator)", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithInitialFee);

    const depositValue = ethers.parseEther("50");
    const reg1Tx = await clusters.registerValidator(
      makePublicKey(20), operatorIds, DEFAULT_SHARES, createCluster(), { value: depositValue },
    );
    const reg1Receipt = await reg1Tx.wait();
    let cluster = parseClusterFromEvent(clusters, reg1Receipt, Events.VALIDATOR_ADDED);

    for (let i = 1; i < 4; i++) {
      const regTx = await clusters.registerValidator(
        makePublicKey(20 + i), operatorIds, DEFAULT_SHARES, cluster, { value: depositValue },
      );
      const regReceipt = await regTx.wait();
      cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);
    }

    expect(cluster.validatorCount).to.equal(4);

    const { cluster: clusterAfterEB, block: ebBlock } = await mockEBAndUpdate(clusters, clusterOwner.address, operatorIds, cluster, 128, 1);
    const expectedVUnits = (128n * BPS_DENOMINATOR + 31n) / 32n;
    expect(expectedVUnits).to.equal(40_000n);

    await networkHelpers.mine(100);

    const fcTx = await clusters.mockExecuteAllOperatorFees(operatorIds, TRIPLED_FEE);
    const fcReceipt = await fcTx.wait();
    const fcBlock = BigInt(fcReceipt!.blockNumber);

    await networkHelpers.mine(100);

    const wTx = await clusters.withdraw(operatorIds, 0n, clusterAfterEB);
    const wReceipt = await wTx.wait();
    const wBlock = BigInt(wReceipt!.blockNumber);
    const clusterAfterW = parseClusterFromEvent(clusters, wReceipt, Events.CLUSTER_WITHDRAWN);

    const numOps = BigInt(operatorIds.length);
    const packedInitial = INITIAL_FEE / ETH_DEDUCTED_DIGITS;
    const packedTripled = TRIPLED_FEE / ETH_DEDUCTED_DIGITS;

    const p1Blocks = fcBlock - ebBlock;
    const p2Blocks = wBlock - fcBlock;
    const idxOp = numOps * (p1Blocks * packedInitial + p2Blocks * packedTripled);
    const expectedBurnOp = (idxOp * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

    const idxNet = clusterAfterW.networkFeeIndex - clusterAfterEB.networkFeeIndex;
    const expectedBurnNet = (idxNet * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

    const expectedTotalBurn = expectedBurnOp + expectedBurnNet;
    const actualBurn = clusterAfterEB.balance - clusterAfterW.balance;

    expect(actualBurn).to.equal(expectedTotalBurn);
    expect(cluster.validatorCount).to.equal(4);
    expect(clusterAfterW.validatorCount).to.equal(4);
  });
});
