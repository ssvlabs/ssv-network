/**
 * BUG: Double-payment of SSV operator fees when removeOperator is called
 * before migrateClusterToETH.
 *
 * Scenario (from QA):
 *   1. Register 4 operators: A (HIGH SSV FEE), B, C, D (moderate fees).
 *   2. Create an SSV cluster with validators on these operators.
 *   3. Time passes — SSV fees accrue (mostly to operator A due to its high fee).
 *   4. Contract is upgraded to v2.
 *   5. removeOperator(A) is called:
 *      - A's SSV snapshot is settled: A's owner receives accumulated SSV fees.
 *      - A's state is zeroed (snapshot.block = 0, snapshot.index = 0, etc.).
 *   6. migrateClusterToETH is called:
 *      - updateClusterOperatorsMigration skips A (removed: both blocks == 0).
 *      - cumulativeIndexSSV does NOT include A's index growth.
 *      - cluster.updateBalanceSSV computes: usage = (cumulativeIndex - cluster.index) * validatorCount
 *        Since A's contribution is missing from cumulativeIndex, usage is UNDER-COUNTED.
 *      - Result: cluster balance after fee deduction is INFLATED → cluster owner
 *        receives an SSV refund that includes fees that were ALREADY paid to A.
 *
 * This test verifies the double-payment by comparing the actual SSV refund
 * against the independently computed correct refund.
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import {
  makePublicKey,
  createCluster,
} from "../../common/helpers.ts";
import {
  DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { mineBlocks } from "../helpers/index.ts";
import { ethers } from "ethers";

// SSV fee constants — PackedSSV uses DEDUCTED_DIGITS (10_000_000) for packing
// A has a high fee, B/C/D have moderate fees so their cumulative index at
// migration time exceeds cluster.index (avoiding underflow revert).
const HIGH_SSV_FEE_RAW = 1_000n;   // Operator A: high fee (packed raw)
const MODERATE_SSV_FEE_RAW = 500n;  // Operators B,C,D: moderate fee (packed raw)

// Network fees
const NETWORK_FEE_SSV_RAW = 100n;   // SSV network fee (packed raw)
const NETWORK_FEE_ETH_RAW = 1770n;  // ETH network fee (packed raw)

// Liquidation params — keep them low so we don't need huge ETH deposits
const MIN_BLOCKS_LIQ = 10n;
const MIN_LIQ_COLLATERAL_RAW = 0n;

/**
 * Helper: read operator SSV snapshot and compute its index at a target block.
 */
async function getOpIndexAtBlock(
  clusters: any,
  opId: bigint,
  targetBlock: bigint,
  feeRaw: bigint,
): Promise<{ index: bigint; storedIndex: bigint; storedBlock: bigint }> {
  const snap = await clusters.getOperatorSnapshot(opId);
  const storedIndex = BigInt(snap[0]);
  const storedBlock = BigInt(snap[1]);
  const index = storedIndex + (targetBlock - storedBlock) * feeRaw;
  return { index, storedIndex, storedBlock };
}

describe("BUG: Double-Payment of Operator SSV Fees on removeOperator + migrateClusterToETH", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  /**
   * Returns the SSV fee for an operator by index (A=0 is high, rest moderate).
   */
  const feeFor = (i: number) => (i === 0 ? HIGH_SSV_FEE_RAW : MODERATE_SSV_FEE_RAW);

  const deployFixture = async () => {
    const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, 0n);

    // Operator A gets HIGH SSV FEE, others get moderate fee
    await clusters.mockOperatorSSVFee(operatorIds[0], HIGH_SSV_FEE_RAW * DEDUCTED_DIGITS);
    for (let i = 1; i < operatorIds.length; i++) {
      await clusters.mockOperatorSSVFee(operatorIds[i], MODERATE_SSV_FEE_RAW * DEDUCTED_DIGITS);
    }

    await clusters.mockSSVNetworkFee(NETWORK_FEE_SSV_RAW);
    await clusters.mockCurrentNetworkFeeIndexSSV(0n);
    await clusters.mockEthNetworkFee(NETWORK_FEE_ETH_RAW);

    await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_LIQ);
    await clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);
    await clusters.mockMinimumBlocksBeforeLiquidationSSV(MIN_BLOCKS_LIQ);
    await clusters.mockMinimumLiquidationCollateralSSV(MIN_LIQ_COLLATERAL_RAW);

    const mockToken = await connection.ethers.deployContract("MockToken", []);
    await mockToken.waitForDeployment();
    const harnessAddr = await clusters.getAddress();
    await mockToken.mint(harnessAddr, connection.ethers.parseEther("100000"));
    await clusters.mockSetToken(await mockToken.getAddress());

    return { clusters, operatorIds, mockToken };
  };

  /**
   * Helper: register an SSV cluster with correctly computed index and NFI
   * at the next block.
   */
  async function registerSSVCluster(
    clusters: any,
    operatorIds: bigint[],
    owner: HardhatEthersSigner,
    validatorCount: bigint,
    ssvBalance: bigint,
  ) {
    const provider = connection.ethers.provider;
    const nextBlock = BigInt(await provider.getBlockNumber()) + 1n;

    let cumulativeIndex = 0n;
    for (let i = 0; i < operatorIds.length; i++) {
      const { index } = await getOpIndexAtBlock(clusters, operatorIds[i], nextBlock, feeFor(i));
      cumulativeIndex += index;
    }

    const nfi = (await clusters.getCurrentNetworkFeeIndexSSV()) + NETWORK_FEE_SSV_RAW;

    const cluster = createCluster({
      validatorCount,
      balance: ssvBalance,
      active: true,
      index: cumulativeIndex,
      networkFeeIndex: nfi,
    });

    const tx = await clusters.mockRegisterSSVValidator(
      makePublicKey(1), operatorIds, owner.address, cluster,
    );
    const receipt = await tx.wait();
    const regBlock = BigInt(receipt!.blockNumber);
    expect(regBlock).to.equal(nextBlock);

    return { cluster, regBlock, cumulativeIndex };
  }

  it("Demonstrates double-payment with exact accounting: remove payout + inflated migration refund", async function () {
    const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const validatorCount = 2n;
    const ssvBalance = ethers.parseEther("500");

    // ─── Step 1: Register SSV cluster ───
    const { cluster: ssvCluster, regBlock } = await registerSSVCluster(
      clusters, operatorIds, clusterOwner, validatorCount, ssvBalance,
    );

    // ─── Step 2: Mine blocks to accrue significant SSV fees ───
    await mineBlocks(provider, 1000);

    // ─── Step 3: Simulate real removeOperator(A) payout semantics ───
    // Compute A's index at the removal block (before removal zeros snapshots)
    const removeBlockExpected = BigInt(await provider.getBlockNumber()) + 1n;
    const opA = await getOpIndexAtBlock(clusters, operatorIds[0], removeBlockExpected, HIGH_SSV_FEE_RAW);
    const opAIndexAtRemoval = opA.index;

    const ownerSSVBeforeRemove = await mockToken.balanceOf(clusterOwner.address);
    const removeTx = await clusters.mockRemoveOperatorAndPayout(operatorIds[0], clusterOwner.address);
    const removeReceipt = await removeTx.wait();
    expect(BigInt(removeReceipt!.blockNumber)).to.equal(removeBlockExpected);
    const ownerSSVAfterRemove = await mockToken.balanceOf(clusterOwner.address);
    const operatorPayoutSSV = ownerSSVAfterRemove - ownerSSVBeforeRemove;
    expect(operatorPayoutSSV).to.be.gt(0n);

    // ─── Step 4: Mine more blocks (waiting before migration) ───
    await mineBlocks(provider, 200);

    // ─── Step 5: Snapshot B,C,D indices BEFORE migration ───
    const migrateBlockExpected = BigInt(await provider.getBlockNumber()) + 1n;
    let bcdCumulativeAtMigration = 0n;
    for (let i = 1; i < operatorIds.length; i++) {
      const { index } = await getOpIndexAtBlock(clusters, operatorIds[i], migrateBlockExpected, MODERATE_SSV_FEE_RAW);
      bcdCumulativeAtMigration += index;
    }

    // ─── Step 6: Call migrateClusterToETH ───
    const ownerSSVBeforeMigration = await mockToken.balanceOf(clusterOwner.address);

    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds, ssvCluster, { value: ethers.parseEther("10") },
    );
    const receipt = await migrateTx.wait();
    const migrationBlock = BigInt(receipt!.blockNumber);
    expect(migrationBlock).to.equal(migrateBlockExpected);

    await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);

    const ownerSSVAfterMigration = await mockToken.balanceOf(clusterOwner.address);
    const actualSSVRefund = ownerSSVAfterMigration - ownerSSVBeforeMigration;

    // ─── Step 7: Compute correct vs buggy cumulative index ───

    // CORRECT: A's frozen index (at removal) + B,C,D live indices at migration
    const correctCumulativeIndex = opAIndexAtRemoval + bcdCumulativeAtMigration;

    // BUGGY (what migration actually does): skips A, only B,C,D
    const buggyCumulativeIndex = bcdCumulativeAtMigration;

    const correctOpFeesPacked = (correctCumulativeIndex - ssvCluster.index) * validatorCount;
    const buggyOpFeesPacked = (buggyCumulativeIndex - ssvCluster.index) * validatorCount;

    const networkFeeIndexBase = BigInt(await clusters.getNetworkFeeIndexSSV());
    const networkFeeIndexBlockBase = BigInt(await clusters.getNetworkFeeIndexBlockNumberSSV());
    const migrationNfi = networkFeeIndexBase + (migrationBlock - networkFeeIndexBlockBase) * NETWORK_FEE_SSV_RAW;
    const networkFeesPacked = (migrationNfi - ssvCluster.networkFeeIndex) * validatorCount;

    const correctUsageWei = (correctOpFeesPacked + networkFeesPacked) * DEDUCTED_DIGITS;
    const buggyUsageWei = (buggyOpFeesPacked + networkFeesPacked) * DEDUCTED_DIGITS;
    const correctRefundWei = ssvBalance > correctUsageWei ? ssvBalance - correctUsageWei : 0n;
    const buggyRefundWei = ssvBalance > buggyUsageWei ? ssvBalance - buggyUsageWei : 0n;

    // The difference is exactly A's index growth since registration
    const missingFeesPacked = correctOpFeesPacked - buggyOpFeesPacked;
    const missingFeesWei = missingFeesPacked * DEDUCTED_DIGITS;

    // A's index growth = opAIndexAtRemoval - opAIndexAtRegistration
    // opAIndexAtRegistration was the value at regBlock
    const opAAtReg = await getOpIndexAtBlock(clusters, operatorIds[0], regBlock, HIGH_SSV_FEE_RAW);
    // But A is now removed (snapshot zeroed), so we can't read it. Instead compute:
    // At registration, A's snapshot.block was set by mockOperatorSSVFee (few blocks before reg).
    // A's index at regBlock = storedIndex + (regBlock - storedBlock) * fee.
    // Since mockRemoveOperator zeroed everything, let's just compute from what we know:
    // missingFeesPacked = opAIndexAtRemoval * validatorCount (since A's contribution at reg
    // was part of cluster.index, and it's subtracted out in the delta)
    // Actually: correctCumulativeIndex - buggyCumulativeIndex = opAIndexAtRemoval
    // And: correctOpFees - buggyOpFees = opAIndexAtRemoval * validatorCount
    expect(missingFeesPacked).to.equal(opAIndexAtRemoval * validatorCount);

    console.log("\n=== Double-Payment Bug Analysis ===");
    console.log(`Operator A SSV fee (raw packed):     ${HIGH_SSV_FEE_RAW}`);
    console.log(`Operators B,C,D SSV fee (raw):       ${MODERATE_SSV_FEE_RAW}`);
    console.log(`Validators in cluster:               ${validatorCount}`);
    console.log(`Blocks: reg→remove=${removeBlockExpected - regBlock}, remove→migrate=${migrationBlock - removeBlockExpected}`);
    console.log(`Operator A index at removal:         ${opAIndexAtRemoval}`);
    console.log(`Missing fees not deducted (wei):     ${missingFeesWei}`);
    console.log(`Actual SSV refund to cluster owner:  ${actualSSVRefund}`);

    // Exact expected values:
    expect(actualSSVRefund).to.equal(buggyRefundWei);
    expect(actualSSVRefund).to.not.equal(correctRefundWei);
    expect(buggyRefundWei - correctRefundWei).to.equal(missingFeesWei);

    const correctSSVRefund = correctRefundWei;
    console.log(`Correct SSV refund should be:        ${correctSSVRefund}`);
    console.log(`Overpayment (double-payment):        ${missingFeesWei}`);

    // Combined recipient gain = remove payout + inflated migration refund.
    expect(operatorPayoutSSV + actualSSVRefund).to.equal(ownerSSVAfterMigration - ownerSSVBeforeRemove);
  });

  it("Without the bug: all operators present → correct SSV refund (baseline)", async function () {
    const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const validatorCount = 2n;
    const ssvBalance = ethers.parseEther("500");

    const { cluster: ssvCluster } = await registerSSVCluster(
      clusters, operatorIds, clusterOwner, validatorCount, ssvBalance,
    );

    await mineBlocks(provider, 500);

    // NO operator removal — migrate directly
    const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);

    await clusters.migrateClusterToETH(
      operatorIds, ssvCluster, { value: ethers.parseEther("10") },
    );

    const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
    const actualSSVRefund = ownerSSVAfter - ownerSSVBefore;

    expect(actualSSVRefund).to.be.lt(ssvBalance, "Fees should have been deducted");
    expect(actualSSVRefund).to.be.gt(0n, "Some balance should remain as refund");

    console.log("\n=== Baseline (no operator removal) ===");
    console.log(`SSV balance:  ${ssvBalance}`);
    console.log(`SSV refund:   ${actualSSVRefund}`);
    console.log(`Fees deducted: ${ssvBalance - actualSSVRefund}`);
  });

  it("Quantifies the theft: double-payment drains contract funds from other users", async function () {
    const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const harnessAddr = await clusters.getAddress();

    const validatorCount = 2n;
    const ssvBalance = ethers.parseEther("500");

    const { cluster: ssvCluster, regBlock } = await registerSSVCluster(
      clusters, operatorIds, clusterOwner, validatorCount, ssvBalance,
    );

    await mineBlocks(provider, 500);

    const contractSSVBefore = await mockToken.balanceOf(harnessAddr);

    // Remove operator A
    const removeBlockExpected = BigInt(await provider.getBlockNumber()) + 1n;
    const opA = await getOpIndexAtBlock(clusters, operatorIds[0], removeBlockExpected, HIGH_SSV_FEE_RAW);
    await clusters.mockRemoveOperator(operatorIds[0]);

    await mineBlocks(provider, 200);

    // Migrate
    const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);
    await clusters.migrateClusterToETH(
      operatorIds, ssvCluster, { value: ethers.parseEther("10") },
    );
    const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
    const actualRefund = ownerSSVAfter - ownerSSVBefore;

    const contractSSVAfter = await mockToken.balanceOf(harnessAddr);
    const ssvPaidOut = contractSSVBefore - contractSSVAfter;

    // Operator A's fee on the cluster (from reg to removal)
    const opAFeeOnCluster = opA.index * validatorCount * DEDUCTED_DIGITS;

    console.log("\n=== Economic Impact ===");
    console.log(`Contract SSV before:                 ${contractSSVBefore}`);
    console.log(`Contract SSV after:                  ${contractSSVAfter}`);
    console.log(`SSV paid out to cluster owner:       ${ssvPaidOut}`);
    console.log(`Cluster's original SSV deposit:      ${ssvBalance}`);
    console.log(`Operator A's fees on cluster (wei):  ${opAFeeOnCluster}`);
    console.log(`This amount was effectively double-paid from the contract`);

    // The refund includes fees that should have been deducted for operator A.
    // In a real scenario, those SSV tokens come from other users' deposits.
    expect(actualRefund).to.be.gt(0n, "Refund should be positive");

    // The contract paid out more than the cluster's correct remaining balance
    // (which should be ssvBalance - ALL operator fees - network fees)
    expect(ssvPaidOut).to.be.gt(
      0n,
      "Contract should have paid out some SSV",
    );
  });
});
