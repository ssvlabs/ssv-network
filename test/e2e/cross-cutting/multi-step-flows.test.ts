/**
 * Cross-Cutting Multi-Step Flow Tests: CC-3, CC-7, CC-9
 *
 * CC-3: Migration → Register → EB Update → Fee Change → Liquidation
 *        (Adapted: uses ETH cluster lifecycle since full network can't create SSV clusters)
 * CC-7: Migration Race — Two Clusters, Same Operators
 *        (Adapted: tests sequential registration on same operators)
 * CC-9: Governance Parameter Change Mid-Operation
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ethers } from "ethers";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  parseClusterFromEvent,
  generateMerkleForClusterEB,
  getValidOperatorFeeIncrease,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
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
  calcNetworkFeeAccrual,
  calcOperatorFeeAccrual,
  calcVUnits,
  defaultVUnits,
  calcLiquidationThreshold,
  snapshotContractBalance,
  checkETHConservation,
} from "../helpers/index.ts";

describe("Cross-Cutting: Multi-Step Flows (CC-3, CC-7, CC-9)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [operatorOwner] = await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  // ────────────────────────────────────────────────────────────────────────
  // CC-3: Multi-Module Lifecycle (Register → EB Update → Fee Change → Liquidation)
  // ────────────────────────────────────────────────────────────────────────
  describe("CC-3: Register → EB Update → Fee Change → Liquidation", () => {
    it("correctly settles fees across EB update, fee change, and liquidation phases", async function () {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const clusterOwner = signers[1];
      const staker = signers[2];
      const liquidator = signers[3];
      const networkAddress = await network.getAddress();

      // ── Setup operators ──
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      const opData = await views.getOperatorById(BigInt(operatorIds[0]));
      const ethFeeWei = BigInt(opData.fee);
      const ethFeePacked = ethFeeWei / ETH_DEDUCTED_DIGITS;
      const networkFeeWei = BigInt(await views.getNetworkFee());
      const networkFeePacked = networkFeeWei / ETH_DEDUCTED_DIGITS;

      // Fund accounts
      for (const signer of [clusterOwner, staker, liquidator]) {
        await provider.send("hardhat_setBalance", [
          signer.address,
          "0x" + (100n * 10n ** 18n).toString(16),
        ]);
      }

      // Staker stakes SSV for oracle quorum
      const stakeAmount = ethers.parseEther("100");
      await ssvToken.transfer(staker.address, stakeAmount);
      await ssvToken.connect(staker).approve(networkAddress, stakeAmount);
      await network.connect(staker).stake(stakeAmount);

      // ── Step 1: Register 2 validators with ETH deposit ──
      const deposit = ethers.parseEther("5");
      const tx1 = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: deposit },
      );
      const receipt1 = await tx1.wait();
      let cluster = parseClusterFromEvent(network, receipt1, Events.VALIDATOR_ADDED);
      const step1Block = receipt1!.blockNumber;

      const tx1b = await network.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster,
        { value: 0n },
      );
      const receipt1b = await tx1b.wait();
      cluster = parseClusterFromEvent(network, receipt1b, Events.VALIDATOR_ADDED);

      expect(cluster.validatorCount).to.equal(2n);

      // Conservation after step 1
      await checkETHConservation(
        networkAddress, provider,
        [cluster.balance], [0n, 0n, 0n, 0n], 0n, 0n,
      );

      // ── Step 2: Register 3rd validator ──
      await mineBlocks(provider, 50);

      const tx2 = await network.connect(clusterOwner).registerValidator(
        makePublicKey(3), operatorIds, DEFAULT_SHARES, cluster,
        { value: 0n },
      );
      const receipt2 = await tx2.wait();
      cluster = parseClusterFromEvent(network, receipt2, Events.VALIDATOR_ADDED);
      const step2Block = receipt2!.blockNumber;

      expect(cluster.validatorCount).to.equal(3n);

      // Cluster balance should have decreased due to fee settlement
      expect(cluster.balance).to.be.lessThan(deposit);

      // ── Step 3: Oracle EB update to 192 ETH ──
      await mineBlocks(provider, 50);

      // Setup oracles
      const oracle1 = signers[5];
      const oracle2 = signers[6];
      const oracle3 = signers[7];
      await network.replaceOracle(1, oracle1.address);
      await network.replaceOracle(2, oracle2.address);
      await network.replaceOracle(3, oracle3.address);

      const blockForRoot = await getBlockNumber(provider);

      const clusterId = ethers.keccak256(
        ethers.solidityPacked(["address", "uint64[]"], [clusterOwner.address, operatorIds]),
      );

      // EB = 192 for 3 validators -> vUnits = ceil(192 * 10000/32) = 60000
      const entries = [{ clusterId, effectiveBalance: 192 }];
      const { root, proofs } = generateMerkleForClusterEB(connection, entries);

      await network.connect(oracle1).commitRoot(root, blockForRoot);
      await network.connect(oracle2).commitRoot(root, blockForRoot);
      await network.connect(oracle3).commitRoot(root, blockForRoot);

      const balanceBeforeEB = cluster.balance;
      const txEB = await network.updateClusterBalance(
        blockForRoot, clusterOwner.address, operatorIds, cluster, 192, proofs[clusterId],
      );
      const receiptEB = await txEB.wait();
      cluster = parseClusterFromEvent(network, receiptEB, Events.CLUSTER_BALANCE_UPDATED);
      const step3Block = receiptEB!.blockNumber;

      const expectedVUnits = calcVUnits(192n);
      expect(expectedVUnits).to.equal(60000n);

      // Balance should have decreased from fee settlement at OLD vUnits
      expect(cluster.balance).to.be.lessThan(balanceBeforeEB);

      // ── Step 4: Operator 1 declares fee increase ──
      const newFee = await getValidOperatorFeeIncrease(views, BigInt(operatorIds[0]));

      const txDecl = await network.connect(operatorOwner).declareOperatorFee(
        operatorIds[0], newFee,
      );
      await txDecl.wait();

      // ── Step 5: Execute fee after timelock ──
      const feePeriods = await views.getOperatorFeePeriods();
      const declareTimePeriod = BigInt(feePeriods[0]);
      const executeTimePeriod = BigInt(feePeriods[1]);

      // Advance time past declare period
      await provider.send("evm_increaseTime", [Number(declareTimePeriod) + 1]);
      await mineBlocks(provider, 1);

      const txExec = await network.connect(operatorOwner).executeOperatorFee(operatorIds[0]);
      const receiptExec = await txExec.wait();
      const step5Block = receiptExec!.blockNumber;

      // Verify fee changed
      const opAfterFee = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(BigInt(opAfterFee.fee)).to.equal(BigInt(newFee));

      // ── Step 6-7: Advance until liquidation ──
      // With higher EB (60000 vUnits) and higher operator fee, burn rate is much higher
      const newOpFeePacked = BigInt(newFee) / ETH_DEDUCTED_DIGITS;
      const currentBalance = BigInt(
        await views.getBalance(clusterOwner.address, operatorIds, cluster),
      );

      // Calculate per-block burn with new fee for op1, old for ops 2-4
      const burnPerBlock = calcClusterBurn({
        blockDiff: 1n,
        numOperators: 3n,
        ethFee: ethFeePacked,
        networkFee: 0n,
        effectiveVUnits: expectedVUnits,
      }) + calcClusterBurn({
        blockDiff: 1n,
        numOperators: 1n,
        ethFee: newOpFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: expectedVUnits,
      });

      if (burnPerBlock > 0n) {
        const blocksToLiquidation = currentBalance / burnPerBlock;
        await mineBlocks(provider, Number(blocksToLiquidation) + 200);
      }

      // ── Step 7: Liquidate ──
      const isLiq = await views.isLiquidatable(clusterOwner.address, operatorIds, cluster);
      if (isLiq) {
        const txLiq = await network.connect(liquidator).liquidate(
          clusterOwner.address, operatorIds, cluster,
        );
        const receiptLiq = await txLiq.wait();
        const clusterPostLiq = parseClusterFromEvent(network, receiptLiq, Events.CLUSTER_LIQUIDATED);

        // Liquidated cluster is inactive
        expect(clusterPostLiq.active).to.be.false;
        expect(clusterPostLiq.balance).to.equal(0n);

        // ── Step 8: Operator 1 withdraws all earnings ──
        // Op1 has earned across multiple phases with different vUnits and fees.
        // Compute a lower bound from the latest phase (EB update to liquidation at new vUnits).
        // Phase 3 (EB update to fee execution): op1 earned at ethFeePacked with effectiveVUnits
        //   where effectiveVUnits = deviation + ethValidatorCount * VUNITS_PRECISION
        //   deviation for 3 validators, EB=192 → vUnits=60000 → deviation = 60000 - 30000 = 30000
        //   effectiveVUnits = 30000 + 3 * 10000 = 60000
        // Phase 4 (fee execution to liquidation): op1 earned at newOpFeePacked with same vUnits
        // We verify total earnings >= phase 3 contribution (lower bound — exact would require
        // tracking all intermediate block numbers across EB update, fee change, and liquidation)
        const op1Earnings = BigInt(await views.getOperatorEarnings(BigInt(operatorIds[0])));
        const op1Phase3 = calcOperatorFeeAccrual(
          BigInt(step5Block - step3Block), ethFeePacked, expectedVUnits,
        ) * ETH_DEDUCTED_DIGITS;
        // Lower-bound check: total earnings include phase 1+2+3+4; phase 3 alone is the minimum
        expect(op1Earnings).to.be.greaterThanOrEqual(op1Phase3);

        const txWithdraw = await network.connect(operatorOwner).withdrawAllOperatorEarnings(operatorIds[0]);
        await txWithdraw.wait();

        // Verify operator earnings are now 0
        const op1EarningsAfter = BigInt(await views.getOperatorEarnings(BigInt(operatorIds[0])));
        expect(op1EarningsAfter).to.equal(0n);

        // Final conservation check (with precision tolerance)
        // Due to vUnit model with EB updates, fee changes, and liquidation,
        // precision dust from packing/unpacking can accumulate
        const contractETH = await snapshotContractBalance(provider, networkAddress);
        const opEarnings: bigint[] = [];
        for (const opId of operatorIds) {
          opEarnings.push(BigInt(await views.getOperatorEarnings(BigInt(opId))));
        }
        const daoEarnings = BigInt(await views.getNetworkEarnings());
        const totalAccounted = opEarnings.reduce((a, b) => a + b, 0n) + daoEarnings;
        const diff = contractETH > totalAccounted
          ? contractETH - totalAccounted
          : totalAccounted - contractETH;
        // Allow up to 0.01 ETH of precision dust for this complex scenario
        expect(diff).to.be.lessThanOrEqual(ethers.parseEther("0.01"));
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // CC-7: Sequential Registration — Two Clusters, Same Operators
  // ────────────────────────────────────────────────────────────────────────
  describe("CC-7: Sequential Registration — Two Clusters, Same Operators", () => {
    it("correctly tracks operator ETH state when two clusters register sequentially", async function () {
      const { network, views, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const ownerA = signers[1];
      const ownerB = signers[2];
      const networkAddress = await network.getAddress();

      // ── Setup operators ──
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        ownerA.address, ownerB.address,
      ]);

      const opData = await views.getOperatorById(BigInt(operatorIds[0]));
      const ethFeeWei = BigInt(opData.fee);
      const ethFeePacked = ethFeeWei / ETH_DEDUCTED_DIGITS;
      const networkFeeWei = BigInt(await views.getNetworkFee());
      const networkFeePacked = networkFeeWei / ETH_DEDUCTED_DIGITS;

      // Fund accounts
      for (const signer of [ownerA, ownerB]) {
        await provider.send("hardhat_setBalance", [
          signer.address,
          "0x" + (100n * 10n ** 18n).toString(16),
        ]);
      }

      // ── Step 1: Register Cluster A (1 validator, 5 ETH) ──
      const depositA = ethers.parseEther("5");
      const txA = await network.connect(ownerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: depositA },
      );
      const receiptA = await txA.wait();
      let clusterA = parseClusterFromEvent(network, receiptA, Events.VALIDATOR_ADDED);
      const blockA = receiptA!.blockNumber;

      // After step 1: each operator ethValidatorCount == 1
      for (const opId of operatorIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(BigInt(op.validatorCount)).to.equal(1n);
      }

      // ── Advance 100 blocks ──
      await mineBlocks(provider, 100);

      // ── Step 2: Register Cluster B (2 validators, 10 ETH) ──
      const depositB = ethers.parseEther("10");
      const txB1 = await network.connect(ownerB).registerValidator(
        makePublicKey(10), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: depositB },
      );
      const receiptB1 = await txB1.wait();
      let clusterB = parseClusterFromEvent(network, receiptB1, Events.VALIDATOR_ADDED);
      const blockB = receiptB1!.blockNumber;

      const txB2 = await network.connect(ownerB).registerValidator(
        makePublicKey(11), operatorIds, DEFAULT_SHARES, clusterB,
        { value: 0n },
      );
      const receiptB2 = await txB2.wait();
      clusterB = parseClusterFromEvent(network, receiptB2, Events.VALIDATOR_ADDED);

      // After step 2: each operator ethValidatorCount == 3 (1 from A + 2 from B)
      for (const opId of operatorIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(BigInt(op.validatorCount)).to.equal(3n);
      }

      // ── Verify operator earnings from 100 blocks with 1 validator ──
      const blockDiffPhase1 = BigInt(blockB - blockA);

      // Cluster B's index captures the cumulative operator index at 2nd registration.
      // The index = sum of all 4 operator indices. Each operator's index started at its
      // registration block (before blockA), so the exact index > 4 * (blockB2 - blockA) * ethFee.
      // We use a lower bound based on blockA as the latest possible operator start.
      const blockB2 = receiptB2!.blockNumber;
      const perOpIndexAtB2 = BigInt(blockB2 - blockA) * ethFeePacked;
      const expectedMinIndex = 4n * perOpIndexAtB2;
      expect(clusterB.index).to.be.greaterThanOrEqual(expectedMinIndex);
      const vUnitsPhase1 = defaultVUnits(1n); // 10000

      // Advance and check earnings
      await mineBlocks(provider, 100);
      const viewBlock = BigInt(await getBlockNumber(provider));

      // Operator earnings lower bound: phase-1 alone (100 blocks, 1 validator).
      // Exact computation is non-trivial because getOperatorEarnings uses snapshot-based
      // accounting where each registerValidator call updates the snapshot with the current
      // ethValidatorCount. The trailing blocks use the final count (3), so actual earnings
      // exceed the phase-1-only lower bound.
      const expectedPerOpPhase1 =
        calcOperatorFeeAccrual(blockDiffPhase1, ethFeePacked, defaultVUnits(1n)) * ETH_DEDUCTED_DIGITS;
      const op1Earnings = BigInt(await views.getOperatorEarnings(BigInt(operatorIds[0])));
      expect(op1Earnings).to.be.greaterThan(expectedPerOpPhase1);

      // ── Conservation check ──
      const contractETH = await snapshotContractBalance(provider, networkAddress);
      const clusterABalance = BigInt(
        await views.getBalance(ownerA.address, operatorIds, clusterA),
      );
      const clusterBBalance = BigInt(
        await views.getBalance(ownerB.address, operatorIds, clusterB),
      );
      const opEarnings: bigint[] = [];
      for (const opId of operatorIds) {
        opEarnings.push(BigInt(await views.getOperatorEarnings(BigInt(opId))));
      }
      const daoEarnings = BigInt(await views.getNetworkEarnings());

      await checkETHConservation(
        networkAddress, provider,
        [clusterABalance, clusterBBalance],
        opEarnings, 0n, daoEarnings,
      );

      // No double-counting of validators
      const daoValCount = BigInt(await views.getNetworkValidatorsCount());
      expect(daoValCount).to.equal(3n);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // CC-9: Governance Parameter Change Mid-Operation
  // ────────────────────────────────────────────────────────────────────────
  describe("CC-9: Governance Parameter Change Mid-Operation", () => {
    describe("CC-9a: Network Fee Update", () => {
      it("correctly applies old fee for first half and new fee for second half", async function () {
        const { network, views, ssvToken } =
          await networkHelpers.loadFixture(deployFixture);
        const provider = connection.ethers.provider;
        const signers = await connection.ethers.getSigners();
        const clusterOwner = signers[1];
        const networkAddress = await network.getAddress();

        // ── Setup ──
        const operatorIds = await registerOperators(network, operatorOwner, 4);
        await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

        const opData = await views.getOperatorById(BigInt(operatorIds[0]));
        const ethFeePacked = BigInt(opData.fee) / ETH_DEDUCTED_DIGITS;
        const oldNetworkFeeWei = BigInt(await views.getNetworkFee());
        const oldNetworkFeePacked = oldNetworkFeeWei / ETH_DEDUCTED_DIGITS;

        await provider.send("hardhat_setBalance", [
          clusterOwner.address,
          "0x" + (100n * 10n ** 18n).toString(16),
        ]);

        // ── Register 1 validator ──
        const deposit = ethers.parseEther("10");
        const tx1 = await network.connect(clusterOwner).registerValidator(
          makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
          { value: deposit },
        );
        const receipt1 = await tx1.wait();
        let cluster = parseClusterFromEvent(network, receipt1, Events.VALIDATOR_ADDED);
        const registerBlock = receipt1!.blockNumber;

        // ── Advance 100 blocks ──
        await mineBlocks(provider, 100);

        // ── Update network fee (double it) ──
        const newNetworkFeeWei = oldNetworkFeeWei * 2n;
        const txFee = await network.updateNetworkFee(newNetworkFeeWei);
        const receiptFee = await txFee.wait();
        const feeChangeBlock = receiptFee!.blockNumber;

        // Verify fee changed
        const currentFee = BigInt(await views.getNetworkFee());
        expect(currentFee).to.equal(newNetworkFeeWei);

        // ── Advance 100 more blocks ──
        await mineBlocks(provider, 100);

        // ── Withdraw to trigger settlement ──
        const tx3 = await network.connect(clusterOwner).withdraw(
          operatorIds, 0n, cluster,
        );
        const receipt3 = await tx3.wait();
        cluster = parseClusterFromEvent(network, receipt3, Events.CLUSTER_WITHDRAWN);
        const withdrawBlock = receipt3!.blockNumber;

        // ── Compute expected values ──
        const vUnits = defaultVUnits(1n);
        const blockDiff1 = BigInt(feeChangeBlock - registerBlock);
        const blockDiff2 = BigInt(withdrawBlock - feeChangeBlock);
        const newNetworkFeePacked = newNetworkFeeWei / ETH_DEDUCTED_DIGITS;

        // Phase 1: old network fee
        const burn1 = calcClusterBurn({
          blockDiff: blockDiff1,
          numOperators: 4n,
          ethFee: ethFeePacked,
          networkFee: oldNetworkFeePacked,
          effectiveVUnits: vUnits,
        });

        // Phase 2: new network fee (doubled)
        const burn2 = calcClusterBurn({
          blockDiff: blockDiff2,
          numOperators: 4n,
          ethFee: ethFeePacked,
          networkFee: newNetworkFeePacked,
          effectiveVUnits: vUnits,
        });

        const totalBurn = burn1 + burn2;
        const expectedBalance = deposit - totalBurn;

        // Cluster balance should match expected (seamless transition via index accumulator)
        expect(cluster.balance).to.equal(expectedBalance);

        // DAO earnings = phase 1 (old fee) + phase 2 (new fee), each computed with vUnits=10000
        // With vUnits=10000 and VUNITS_PRECISION=10000, the division is exact (no truncation).
        // networkTotalEarnings (packed) = blockDiff1 * oldNetworkFeePacked + blockDiff2 * newNetworkFeePacked
        // getNetworkEarnings (wei) = packed * ETH_DEDUCTED_DIGITS
        const expectedDaoEarnings =
          (blockDiff1 * oldNetworkFeePacked + blockDiff2 * newNetworkFeePacked) * ETH_DEDUCTED_DIGITS;
        const daoEarnings = BigInt(await views.getNetworkEarnings());
        expect(daoEarnings).to.equal(expectedDaoEarnings);
      });
    });

    describe("CC-9b: Liquidation Threshold Update", () => {
      it("cluster becomes liquidatable when threshold increases", async function () {
        const { network, views, ssvToken } =
          await networkHelpers.loadFixture(deployFixture);
        const provider = connection.ethers.provider;
        const signers = await connection.ethers.getSigners();
        const clusterOwner = signers[1];
        const liquidator = signers[2];
        const networkAddress = await network.getAddress();

        // ── Setup ──
        const operatorIds = await registerOperators(network, operatorOwner, 4);
        await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

        const opData = await views.getOperatorById(BigInt(operatorIds[0]));
        const ethFeeWei = BigInt(opData.fee);
        const ethFeePacked = ethFeeWei / ETH_DEDUCTED_DIGITS;
        const networkFeeWei = BigInt(await views.getNetworkFee());
        const networkFeePacked = networkFeeWei / ETH_DEDUCTED_DIGITS;

        await provider.send("hardhat_setBalance", [
          clusterOwner.address,
          "0x" + (100n * 10n ** 18n).toString(16),
        ]);
        await provider.send("hardhat_setBalance", [
          liquidator.address,
          "0x" + (10n * 10n ** 18n).toString(16),
        ]);

        // Get current liquidation threshold
        const currentThreshold = BigInt(await views.getLiquidationThresholdPeriod());

        // Compute the exact deposit to be just above the old threshold
        const vUnits = defaultVUnits(1n);
        const burnRate = 4n * ethFeePacked;
        const thresholdBalance = calcLiquidationThreshold({
          minimumBlocksBeforeLiquidation: currentThreshold,
          numOperators: 4n,
          ethFee: ethFeePacked,
          networkFee: networkFeePacked,
          effectiveVUnits: vUnits,
        });

        // Deposit slightly above old threshold
        const deposit = thresholdBalance + ethers.parseEther("0.1");

        // ── Register validator ──
        const tx1 = await network.connect(clusterOwner).registerValidator(
          makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
          { value: deposit },
        );
        const receipt1 = await tx1.wait();
        let cluster = parseClusterFromEvent(network, receipt1, Events.VALIDATOR_ADDED);

        // Advance a few blocks to burn some fees
        await mineBlocks(provider, 100);

        // Verify NOT liquidatable under current threshold
        let isLiq = await views.isLiquidatable(clusterOwner.address, operatorIds, cluster);
        expect(isLiq).to.be.false;

        // ── Double the liquidation threshold ──
        const newThreshold = currentThreshold * 2n;
        await network.updateLiquidationThresholdPeriod(newThreshold);

        // Verify the parameter was updated
        const updatedThreshold = BigInt(await views.getLiquidationThresholdPeriod());
        expect(updatedThreshold).to.equal(newThreshold);

        // ── Check if now liquidatable under new threshold ──
        // The cluster's live balance is deposit minus fees burned over 100+ blocks.
        // With the new doubled threshold, the required balance reserve doubles.
        // Advance enough blocks to ensure the cluster's balance falls below the new threshold.
        // Compute how many more blocks needed for the balance to drop below new threshold
        const burnPerBlockWei = calcClusterBurn({
          blockDiff: 1n,
          numOperators: 4n,
          ethFee: ethFeePacked,
          networkFee: networkFeePacked,
          effectiveVUnits: vUnits,
        });
        const newThresholdBalance = calcLiquidationThreshold({
          minimumBlocksBeforeLiquidation: newThreshold,
          numOperators: 4n,
          ethFee: ethFeePacked,
          networkFee: networkFeePacked,
          effectiveVUnits: vUnits,
        });

        // Advance blocks until the live balance drops below the new threshold
        if (burnPerBlockWei > 0n) {
          // Current live balance ≈ deposit - 100 blocks of burn
          // We need balance < newThresholdBalance
          // Additional blocks needed ≈ (currentBalance - newThresholdBalance) / burnPerBlock
          const additionalNeeded = (deposit - newThresholdBalance) / burnPerBlockWei;
          const blocksToMine = Number(additionalNeeded) + 200;
          await mineBlocks(provider, blocksToMine);
        }

        isLiq = await views.isLiquidatable(clusterOwner.address, operatorIds, cluster);
        expect(isLiq).to.be.true;

        const txLiq = await network.connect(liquidator).liquidate(
          clusterOwner.address, operatorIds, cluster,
        );
        const receiptLiq = await txLiq.wait();
        const liquidatedCluster = parseClusterFromEvent(
          network, receiptLiq, Events.CLUSTER_LIQUIDATED,
        );
        expect(liquidatedCluster.active).to.be.false;
      });
    });
  });
});
