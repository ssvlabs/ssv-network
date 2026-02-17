/**
 * E2E Scenario Tests: ETH Cluster Lifecycle
 * Covers CM-1, CM-2, CM-3, CM-9, CM-10
 *
 * Uses harness fixture for precise parameter control (the full network
 * enforces MINIMAL_LIQUIDATION_THRESHOLD = 21_480 which conflicts with
 * the scenario spec's minimumBlocksBeforeLiquidation = 100).
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  createCluster,
  makePublicKey,
  parseClusterFromEvent,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  ETH_DEDUCTED_DIGITS,
  VUNITS_PRECISION,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcClusterBurn,
  calcLiquidationThreshold,
  defaultVUnits,
  snapshotContractBalance,
} from "../helpers/index.ts";

/**
 * Scenario constants matching CM-1/CM-2/CM-3 preconditions:
 * - 4 operators with ethFee = 1_000_000_000 (packed raw = 10_000)
 * - Network fee: packed raw = 5_000 → unpacked = 500_000_000
 * - minimumBlocksBeforeLiquidation = 100
 * - minimumLiquidationCollateral packed raw = 100_000 → unpacked = 10 gwei
 */
const OP_ETH_FEE = 1_000_000_000n;
const OP_ETH_FEE_RAW = OP_ETH_FEE / ETH_DEDUCTED_DIGITS; // 10_000
const NETWORK_FEE_RAW = 5_000n;
const MIN_BLOCKS_BEFORE_LIQ = 100n;
const MIN_LIQ_COLLATERAL_RAW = 100_000n; // packed raw
const NUM_OPERATORS = 4n;

describe("E2E: ETH Cluster Lifecycle (CM-1, CM-2, CM-3, CM-9, CM-10)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner, liquidator] = await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, OP_ETH_FEE);

    // Set protocol parameters via harness mocks (bypasses min checks)
    await clusters.mockEthNetworkFee(NETWORK_FEE_RAW);
    await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_BEFORE_LIQ);
    await clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);

    // Fund the harness contract with ETH (needed for withdraw and liquidation bounty)
    const harnessAddr = await clusters.getAddress();
    await connection.ethers.provider.send("hardhat_setBalance", [
      harnessAddr,
      "0x" + (100n * 10n ** 18n).toString(16),
    ]);

    return { clusters, operatorIds };
  };

  // ─── CM-1: ETH Cluster Lifecycle — Create, Deposit, Advance, Withdraw, Verify Balance ───

  describe("CM-1: ETH Cluster Lifecycle", () => {
    it("creates cluster, deposits, advances blocks, withdraws with correct fee deduction", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Step 1: Register validator with 10 ETH at block B0
      const deposit = 10n * 10n ** 18n;
      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: deposit },
      );
      const regReceipt = await regTx.wait();
      const b0 = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);
      expect(cluster.balance).to.equal(deposit);
      expect(cluster.validatorCount).to.equal(1n);
      expect(cluster.active).to.equal(true);

      // Step 2: Deposit 5 ETH at B0+50
      // TODO(DISC-OV-8): deposit does NOT update operator snapshots or settle cluster fees — test matches code behavior, FLOWS.md says otherwise
      await mineBlocks(provider, 49);
      const depositVal = 5n * 10n ** 18n;
      const depTx = await clusters.deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: depositVal },
      );
      const depReceipt = await depTx.wait();
      cluster = parseClusterFromEvent(clusters, depReceipt, Events.CLUSTER_DEPOSITED);

      // Balance = old + msg.value, NO fee settlement
      expect(cluster.balance).to.equal(deposit + depositVal);

      // Step 3: Withdraw 2 ETH at B0+100 (fees settled)
      const currentBlock = await getBlockNumber(provider);
      const blocksToMine = (b0 + 100) - currentBlock - 1;
      if (blocksToMine > 0) await mineBlocks(provider, blocksToMine);

      const withdrawAmount = 2n * 10n ** 18n;
      const contractBalBefore = await snapshotContractBalance(provider, await clusters.getAddress());
      const withdrawTx = await clusters.withdraw(operatorIds, withdrawAmount, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const wBlock = withdrawReceipt!.blockNumber;
      const clusterAfter = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

      // Compute expected fees for wBlock - b0 blocks
      const blockDiff = BigInt(wBlock - b0);
      const vUnits = defaultVUnits(1n); // 10_000
      const expectedFees = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const expectedBalance = deposit + depositVal - expectedFees - withdrawAmount;
      expect(clusterAfter.balance).to.equal(expectedBalance);

      // Contract ETH balance decreased by withdrawal amount
      const contractBalAfter = await snapshotContractBalance(provider, await clusters.getAddress());
      expect(contractBalBefore - contractBalAfter).to.equal(withdrawAmount);

      // TODO(DISC-CM-3): withdraw does NOT update operator snapshots to storage — earnings lag until next snapshot-updating call
      // (we verify indirectly: if snapshots were updated, the balance would differ)
    });

    it("deposit at same block as registration — no fee settlement (edge)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: 10n * 10n ** 18n },
      );
      let cluster = parseClusterFromEvent(clusters, await regTx.wait(), Events.VALIDATOR_ADDED);

      // Deposit immediately
      const depTx = await clusters.deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: 5n * 10n ** 18n },
      );
      cluster = parseClusterFromEvent(clusters, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      // TODO(DISC-OV-8): deposit does NOT settle fees — balance = initial + deposit with no deductions
      expect(cluster.balance).to.equal(15n * 10n ** 18n);
    });

    it("multiple deposits accumulate without fee settlement (edge)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: 5n * 10n ** 18n },
      );
      let cluster = parseClusterFromEvent(clusters, await regTx.wait(), Events.VALIDATOR_ADDED);

      await mineBlocks(connection.ethers.provider, 10);

      let depTx = await clusters.deposit(
        clusterOwner.address, operatorIds, cluster, { value: 3n * 10n ** 18n },
      );
      cluster = parseClusterFromEvent(clusters, await depTx.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.balance).to.equal(8n * 10n ** 18n);

      await mineBlocks(connection.ethers.provider, 10);

      depTx = await clusters.deposit(
        clusterOwner.address, operatorIds, cluster, { value: 2n * 10n ** 18n },
      );
      cluster = parseClusterFromEvent(clusters, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      // TODO(DISC-OV-8): all deposits accumulated without fee settlement — code behavior diverges from FLOWS.md
      expect(cluster.balance).to.equal(10n * 10n ** 18n);
    });
  });

  // ─── CM-2: Withdraw Exactly To Liquidation Threshold (Boundary) ───

  describe("CM-2: Withdraw Exactly To Liquidation Threshold", () => {
    it("allows withdraw to exact threshold but rejects 1 more wei", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register with 10 ETH
      const deposit = 10n * 10n ** 18n;
      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: deposit },
      );
      const regReceipt = await regTx.wait();
      const b0 = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      // Advance 9 blocks (withdraw tx will be at B0+10)
      await mineBlocks(provider, 9);

      // Compute fees at B0+10
      const blockDiff = 10n;
      const vUnits = defaultVUnits(1n);
      const feesAt10 = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const balanceAfterFees = deposit - feesAt10;

      // Liquidation threshold
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const maxWithdrawable = balanceAfterFees - liqThreshold;

      // Withdraw maxWithdrawable — should succeed
      const withdrawTx = await clusters.withdraw(operatorIds, maxWithdrawable, cluster);
      cluster = parseClusterFromEvent(clusters, await withdrawTx.wait(), Events.CLUSTER_WITHDRAWN);

      // balance == exact liquidation threshold
      // isLiquidatableWithEB uses `cluster.balance < liquidationThreshold`
      // 450_000_000_000 < 450_000_000_000 → false → NOT liquidatable → succeed
      expect(cluster.balance).to.equal(liqThreshold);

      // Attempt withdraw 1 more wei — should revert
      await expect(
        clusters.withdraw(operatorIds, 1n, cluster),
      ).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);
    });

    it("validatorCount == 0 allows full withdrawal (edge)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register then remove validator
      const deposit = 5n * 10n ** 18n;
      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: deposit },
      );
      const regReceipt = await regTx.wait();
      const regBlock = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      await mineBlocks(provider, 5);

      // Remove validator — settles fees from regBlock to removeBlock
      const removeTx = await clusters.removeValidator(makePublicKey(1), operatorIds, cluster);
      const removeReceipt = await removeTx.wait();
      const removeBlock = removeReceipt!.blockNumber;
      cluster = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);

      // Compute exact remaining balance: deposit - fees for (removeBlock - regBlock) blocks
      const blockDiff = BigInt(removeBlock - regBlock);
      const vUnits = defaultVUnits(1n);
      const fees = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const expectedFullBalance = deposit - fees;

      // Withdraw entire remaining balance — liquidation check skipped for vc=0
      const fullBalance = cluster.balance;
      expect(fullBalance).to.equal(expectedFullBalance);

      const wTx = await clusters.withdraw(operatorIds, fullBalance, cluster);
      cluster = parseClusterFromEvent(clusters, await wTx.wait(), Events.CLUSTER_WITHDRAWN);
      expect(cluster.balance).to.equal(0n);
    });
  });

  // ─── CM-3: ETH Cluster — Third-Party Liquidation With Bounty Verification ───

  describe("CM-3: Third-Party Liquidation With Bounty", () => {
    it("liquidates cluster after balance drops below threshold, liquidator receives bounty", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register with small balance (1e12 = 0.000001 ETH)
      const smallDeposit = 1_000_000_000_000n; // 1e12
      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: smallDeposit },
      );
      const regReceipt = await regTx.wait();
      const b0 = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      const vUnits = defaultVUnits(1n);
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      // liqThreshold = 450_000_000_000

      const perBlockBurn = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      // perBlockBurn = 4_500_000_000

      // Blocks to drain past threshold: (1e12 - 450e9) / 4.5e9 ≈ 122.2
      // At block 122: NOT liquidatable. At block 123: liquidatable.

      // Advance to just before liquidation threshold
      // Mine enough blocks so the next real tx is at B0+122
      const currentBlock1 = await getBlockNumber(provider);
      const targetForNotLiq = b0 + 122;
      const blocksToMineForNotLiq = targetForNotLiq - currentBlock1 - 1;
      if (blocksToMineForNotLiq > 0) await mineBlocks(provider, blocksToMineForNotLiq);

      // Verify NOT liquidatable at B0+122 (reverted tx may not advance block)
      await expect(
        clusters.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster),
      ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);

      // Ensure we're past the threshold: mine to B0+123
      const currentBlock2 = await getBlockNumber(provider);
      const targetForLiq = b0 + 123;
      const blocksToMineForLiq = targetForLiq - currentBlock2 - 1;
      if (blocksToMineForLiq > 0) await mineBlocks(provider, blocksToMineForLiq);

      // Liquidation at B0+123 should succeed
      const liqBalBefore = await provider.getBalance(liquidator.address);
      const liqTx = await clusters.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();
      const liqBlock = liqReceipt!.blockNumber;
      const blockDiff = BigInt(liqBlock - b0);

      // Compute expected bounty
      const totalFees = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      // Exact post-settlement balance: deposit - (blockDiff * perBlockBurn)
      // perBlockBurn = (4 * 10_000 + 5_000) * 10_000 / 10_000 * 100_000 = 4_500_000_000
      const perBlockBurnCM3 = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const balanceAfterFees = smallDeposit - totalFees;
      expect(balanceAfterFees).to.equal(smallDeposit - blockDiff * perBlockBurnCM3);
      expect(balanceAfterFees).to.be.lessThan(liqThreshold);

      // Verify liquidator received bounty (accounting for gas)
      const liqBalAfter = await provider.getBalance(liquidator.address);
      const gasUsed = liqReceipt!.gasUsed * liqReceipt!.gasPrice;
      expect(liqBalAfter - liqBalBefore + gasUsed).to.equal(balanceAfterFees);

      // Verify cluster state
      const liqCluster = parseClusterFromEvent(clusters, liqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);
      expect(liqCluster.index).to.equal(0n);
      expect(liqCluster.networkFeeIndex).to.equal(0n);

      // Verify operator ethValidatorCount decremented
      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthValidatorCount(opId)).to.equal(0);
      }

      // Verify ethDaoValidatorCount decreased
      expect(await clusters.getDaoEthValidatorCount()).to.equal(0);
    });

    it("owner can always self-liquidate regardless of balance (edge)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Create cluster with large balance
      const deposit = 10n * 10n ** 18n;
      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: deposit },
      );
      const regReceipt = await regTx.wait();
      const b0 = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      // Self-liquidation at B0+1 — always allowed for owner
      const ownerBalBefore = await provider.getBalance(clusterOwner.address);
      const selfLiqTx = await clusters.liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const selfLiqReceipt = await selfLiqTx.wait();
      const selfLiqBlock = selfLiqReceipt!.blockNumber;
      const blockDiff = BigInt(selfLiqBlock - b0);

      const vUnits = defaultVUnits(1n);
      const totalFees = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const expectedBounty = deposit - totalFees;

      const ownerBalAfter = await provider.getBalance(clusterOwner.address);
      const gasUsed = selfLiqReceipt!.gasUsed * selfLiqReceipt!.gasPrice;
      expect(ownerBalAfter - ownerBalBefore + gasUsed).to.equal(expectedBounty);

      const liqCluster = parseClusterFromEvent(clusters, selfLiqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);
    });
  });

  // ─── CM-9: Reactivation After Liquidation — Full Cycle ───

  describe("CM-9: Reactivation After Liquidation", () => {
    it("full lifecycle: create → liquidate → reactivate → verify fee accrual from reactivation point", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Step 1: Create cluster with small balance
      const smallDeposit = 1_000_000_000_000n; // 1e12
      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: smallDeposit },
      );
      const regReceipt = await regTx.wait();
      const b0 = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      // Step 2: Advance to liquidation (123 blocks)
      await mineBlocks(provider, 122);
      const liqTx = await clusters.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();
      cluster = parseClusterFromEvent(clusters, liqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(cluster.active).to.equal(false);
      expect(cluster.balance).to.equal(0n);

      // Step 3: Reactivate with 5 ETH
      await mineBlocks(provider, 76);

      const reactivateAmount = 5n * 10n ** 18n;
      const reactivateTx = await clusters.reactivate(
        operatorIds, cluster, { value: reactivateAmount },
      );
      const reactivateReceipt = await reactivateTx.wait();
      const reactivateBlock = reactivateReceipt!.blockNumber;
      cluster = parseClusterFromEvent(clusters, reactivateReceipt, Events.CLUSTER_REACTIVATED);

      // TODO(DISC-CM-5): reactivate uses cluster.balance += msg.value (additive, not replacement) — test matches code, FLOWS.md implies replacement
      expect(cluster.active).to.equal(true);
      expect(cluster.balance).to.equal(reactivateAmount);

      // Step 4: Verify fee accrual from reactivation point only (100 blocks later)
      await mineBlocks(provider, 99);
      const withdrawTx = await clusters.withdraw(operatorIds, 1n * 10n ** 18n, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const withdrawBlock = withdrawReceipt!.blockNumber;
      const clusterAfter = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

      const blocksSinceReactivation = BigInt(withdrawBlock - reactivateBlock);
      const vUnits = defaultVUnits(1n);
      const feesAfterReactivation = calcClusterBurn({
        blockDiff: blocksSinceReactivation,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      // No "phantom fees" from the liquidated period
      const expectedBalance = reactivateAmount - feesAfterReactivation - 1n * 10n ** 18n;
      expect(clusterAfter.balance).to.equal(expectedBalance);
    });
  });

  // ─── CM-10: Deposit Into Liquidated Cluster + Reactivation ───

  describe("CM-10: Deposit Into Liquidated Cluster + Reactivation", () => {
    it("deposits into liquidated cluster accumulate, reactivation uses sum", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Create and liquidate cluster
      const smallDeposit = 1_000_000_000_000n;
      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: smallDeposit },
      );
      let cluster = parseClusterFromEvent(clusters, await regTx.wait(), Events.VALIDATOR_ADDED);

      await mineBlocks(provider, 122);
      const liqTx = await clusters.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      cluster = parseClusterFromEvent(clusters, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);
      expect(cluster.active).to.equal(false);
      expect(cluster.balance).to.equal(0n);

      // TODO(DISC-OV-9): deposit does NOT check cluster.active — allows deposit into liquidated cluster
      const deposit1 = 3n * 10n ** 18n;
      const dep1Tx = await clusters.deposit(
        clusterOwner.address, operatorIds, cluster, { value: deposit1 },
      );
      cluster = parseClusterFromEvent(clusters, await dep1Tx.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.active).to.equal(false); // remains inactive
      expect(cluster.balance).to.equal(deposit1);

      // Step 3: Another deposit
      const deposit2 = 2n * 10n ** 18n;
      const dep2Tx = await clusters.deposit(
        clusterOwner.address, operatorIds, cluster, { value: deposit2 },
      );
      cluster = parseClusterFromEvent(clusters, await dep2Tx.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.active).to.equal(false);
      expect(cluster.balance).to.equal(deposit1 + deposit2);

      // TODO(DISC-CM-5): reactivation uses += so balance = previous deposits + msg.value
      const reactivateAmount = 1n * 10n ** 18n;
      const reactivateTx = await clusters.reactivate(
        operatorIds, cluster, { value: reactivateAmount },
      );
      cluster = parseClusterFromEvent(clusters, await reactivateTx.wait(), Events.CLUSTER_REACTIVATED);

      expect(cluster.active).to.equal(true);
      expect(cluster.balance).to.equal(deposit1 + deposit2 + reactivateAmount);
    });
  });
});
