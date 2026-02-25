import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_SHARES, VUNITS_PRECISION, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

const INITIAL_FEE = 10_000_000_000n;
const DOUBLED_FEE = 20_000_000_000n;
const TRIPLED_FEE = 30_000_000_000n;

describe("Operator fee change + EB burn rate interaction", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds]),
    );
  };

  const getEBRoot = (clusterId: string, effectiveBalance: number): string => {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const innerHash = ethers.keccak256(coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance]));
    return ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
  };

  const deployWithInitialFee = async () => ssvClustersHarnessFixture(connection, 4, INITIAL_FEE);
  const deployWithDoubledFee = async () => ssvClustersHarnessFixture(connection, 4, DOUBLED_FEE);

  const setEB = async (
    clusters: any,
    operatorIds: bigint[],
    cluster: any,
    effectiveBalance: number,
  ) => {
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const ebBlockNum = 1;
    const root = getEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(ebBlockNum, root);
    const tx = await clusters.updateClusterBalance(
      ebBlockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      [],
    );
    const receipt = await tx.wait();
    return {
      cluster: parseClusterFromEvent(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED),
      block: BigInt(receipt!.blockNumber),
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

    const { cluster: clusterAfterEB, block: ebBlock } = await setEB(clusters, operatorIds, clusterAfterReg, 64);
    const expectedVUnits = (64n * VUNITS_PRECISION + 31n) / 32n;
    expect(expectedVUnits).to.equal(20000n);

    await networkHelpers.mine(500);
    const w1Tx = await clusters.withdraw(operatorIds, 0n, clusterAfterEB);
    const w1Receipt = await w1Tx.wait();
    const clusterAfterP1 = parseClusterFromEvent(clusters, w1Receipt, Events.CLUSTER_WITHDRAWN);
    const w1Block = BigInt(w1Receipt!.blockNumber);
    const burnP1 = clusterAfterEB.balance - clusterAfterP1.balance;

    const fcTx = await clusters.mockExecuteAllOperatorFees(operatorIds, DOUBLED_FEE);
    const fcReceipt = await fcTx.wait();
    const fcBlock = BigInt(fcReceipt!.blockNumber);

    await networkHelpers.mine(500);
    const w2Tx = await clusters.withdraw(operatorIds, 0n, clusterAfterP1);
    const w2Receipt = await w2Tx.wait();
    const clusterAfterP2 = parseClusterFromEvent(clusters, w2Receipt, Events.CLUSTER_WITHDRAWN);
    const w2Block = BigInt(w2Receipt!.blockNumber);
    const burnP2 = clusterAfterP1.balance - clusterAfterP2.balance;

    const packedInitial = INITIAL_FEE / ETH_DEDUCTED_DIGITS;
    const packedDoubled = DOUBLED_FEE / ETH_DEDUCTED_DIGITS;
    const numOps = BigInt(operatorIds.length);

    const p1Blocks = w1Block - ebBlock;
    const expectedBurnP1 = (numOps * p1Blocks * packedInitial * expectedVUnits / VUNITS_PRECISION) * ETH_DEDUCTED_DIGITS;

    const transitionBlocks = fcBlock - w1Block;
    const p2NewFeeBlocks = w2Block - fcBlock;
    const idxOpP2 = numOps * (transitionBlocks * packedInitial + p2NewFeeBlocks * packedDoubled);
    const expectedBurnP2 = (idxOpP2 * expectedVUnits / VUNITS_PRECISION) * ETH_DEDUCTED_DIGITS;

    expect(burnP1).to.equal(expectedBurnP1);
    expect(burnP2).to.equal(expectedBurnP2);
    expect(burnP2).to.be.greaterThan(burnP1);

    const ratio = (burnP2 * 1000n) / burnP1;
    expect(ratio).to.be.greaterThan(1990n);
    expect(ratio).to.be.lessThan(2010n);
  });

  it("Fee reduction with EB=128 cluster → savings reflected", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithDoubledFee);

    const depositValue = ethers.parseEther("100");
    const regTx = await clusters.registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: depositValue },
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    const { cluster: clusterAfterEB, block: ebBlock } = await setEB(clusters, operatorIds, clusterAfterReg, 128);
    const expectedVUnits = (128n * VUNITS_PRECISION + 31n) / 32n;
    expect(expectedVUnits).to.equal(40000n);

    await networkHelpers.mine(500);
    const w1Tx = await clusters.withdraw(operatorIds, 0n, clusterAfterEB);
    const w1Receipt = await w1Tx.wait();
    const clusterAfterP1 = parseClusterFromEvent(clusters, w1Receipt, Events.CLUSTER_WITHDRAWN);
    const w1Block = BigInt(w1Receipt!.blockNumber);
    const burnP1 = clusterAfterEB.balance - clusterAfterP1.balance;

    const fcTx = await clusters.mockExecuteAllOperatorFees(operatorIds, INITIAL_FEE);
    const fcReceipt = await fcTx.wait();
    const fcBlock = BigInt(fcReceipt!.blockNumber);

    await networkHelpers.mine(500);
    const w2Tx = await clusters.withdraw(operatorIds, 0n, clusterAfterP1);
    const w2Receipt = await w2Tx.wait();
    const clusterAfterP2 = parseClusterFromEvent(clusters, w2Receipt, Events.CLUSTER_WITHDRAWN);
    const w2Block = BigInt(w2Receipt!.blockNumber);
    const burnP2 = clusterAfterP1.balance - clusterAfterP2.balance;

    const packedDoubled = DOUBLED_FEE / ETH_DEDUCTED_DIGITS;
    const packedInitial = INITIAL_FEE / ETH_DEDUCTED_DIGITS;
    const numOps = BigInt(operatorIds.length);

    const p1Blocks = w1Block - ebBlock;
    const expectedBurnP1 = (numOps * p1Blocks * packedDoubled * expectedVUnits / VUNITS_PRECISION) * ETH_DEDUCTED_DIGITS;

    const transitionBlocks = fcBlock - w1Block;
    const p2NewFeeBlocks = w2Block - fcBlock;
    const idxOpP2 = numOps * (transitionBlocks * packedDoubled + p2NewFeeBlocks * packedInitial);
    const expectedBurnP2 = (idxOpP2 * expectedVUnits / VUNITS_PRECISION) * ETH_DEDUCTED_DIGITS;

    expect(burnP1).to.equal(expectedBurnP1);
    expect(burnP2).to.equal(expectedBurnP2);
    expect(burnP2).to.be.lessThan(burnP1);

    const ratio = (burnP2 * 1000n) / burnP1;
    expect(ratio).to.be.greaterThan(490n);
    expect(ratio).to.be.lessThan(510n);
  });

  it("Fee change boundary accounting — total burn = sum of both rate periods", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithInitialFee);

    const depositValue = ethers.parseEther("100");
    const regTx = await clusters.registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: depositValue },
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    const { cluster: clusterAfterEB, block: ebBlock } = await setEB(clusters, operatorIds, clusterAfterReg, 96);
    const expectedVUnits = (96n * VUNITS_PRECISION + 31n) / 32n;
    expect(expectedVUnits).to.equal(30000n);

    await networkHelpers.mine(200);

    const fcTx = await clusters.mockExecuteAllOperatorFees(operatorIds, TRIPLED_FEE);
    const fcReceipt = await fcTx.wait();
    const fcBlock = BigInt(fcReceipt!.blockNumber);

    await networkHelpers.mine(300);

    const wTx = await clusters.withdraw(operatorIds, 0n, clusterAfterEB);
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
    const expectedBurn = (idxOp * expectedVUnits / VUNITS_PRECISION) * ETH_DEDUCTED_DIGITS;

    expect(totalBurn).to.equal(expectedBurn);
    expect(totalBurn).to.be.greaterThan(0n);
    expect(clusterAfterW.balance).to.be.greaterThan(0n);

    const totalBlocks = wBlock - ebBlock;
    const burnIfAllOld = (numOps * totalBlocks * packedInitial * expectedVUnits / VUNITS_PRECISION) * ETH_DEDUCTED_DIGITS;
    const burnIfAllNew = (numOps * totalBlocks * packedTripled * expectedVUnits / VUNITS_PRECISION) * ETH_DEDUCTED_DIGITS;

    expect(totalBurn).to.be.greaterThan(burnIfAllOld);
    expect(totalBurn).to.be.lessThan(burnIfAllNew);
  });
});
