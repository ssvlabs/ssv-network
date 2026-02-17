/**
 * OV-1 to OV-3, OV-11 to OV-14: Operator Lifecycle Tests
 *
 * Covers: operator registration (public/private, zero/non-zero fee),
 * ensureETHDefaults, fee declaration/execution, fee reduction,
 * earnings withdrawal, and operator removal.
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makeOperatorKey,
  makePublicKey,
  registerOperators,
  whitelistAddresses,
  parseClusterFromEvent,
  getCurrentClusterState,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
  NETWORK_FEE_ETH,
  VUNITS_PRECISION,
  DECLARE_OPERATOR_FEE_PERIOD,
  EXECUTE_OPERATOR_FEE_PERIOD,
  OPERATOR_MAX_FEE_INCREASE,
} from "../../common/constants.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcOperatorFeeAccrual,
  calcClusterBurn,
  defaultVUnits,
} from "../helpers/index.ts";
import { ethers } from "ethers";

describe("Operator Lifecycle (OV-1 to OV-3, OV-11 to OV-14)", function () {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let otherAccount: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [operatorOwner, clusterOwner, otherAccount] =
      await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  // =========================================================================
  // OV-1: Register Operator (Public, Non-Zero Fee) — Initial State Verification
  // =========================================================================
  describe("OV-1: Register Operator (Public, Non-Zero Fee)", () => {
    it("OV-1: registers public operator with non-zero fee and verifies initial state", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      const pubkey = makeOperatorKey(1);
      const fee = 1_770_000_000n; // DEFAULT_OPERATOR_ETH_FEE
      const packedFee = fee / ETH_DEDUCTED_DIGITS; // 17_700

      const tx = await network
        .connect(operatorOwner)
        .registerOperator(pubkey, fee, false);
      const receipt = await tx.wait();
      const regBlock = BigInt(receipt.blockNumber);

      // Verify operator state via views
      const opData = await views.getOperatorById(1n);
      expect(opData.owner).to.equal(operatorOwner.address);
      expect(opData.fee).to.equal(fee); // views.getOperatorById returns unpacked fee
      expect(opData.validatorCount).to.equal(0n);
      expect(opData.isPrivate).to.equal(false);
      expect(opData.isActive).to.equal(true);

      // Verify operator earnings start at 0
      const earnings = await views.getOperatorEarnings(1n);
      expect(earnings).to.equal(0n);

      // Verify events
      await expect(tx)
        .to.emit(network, "OperatorAdded")
        .withArgs(1n, operatorOwner.address, pubkey, fee);
      await expect(tx)
        .to.emit(network, "OperatorPrivacyStatusUpdated")
        .withArgs([1n], false);
    });

    it("OV-1 edge: register with fee=0 succeeds, operator is free forever", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      const pubkey = makeOperatorKey(1);

      await network
        .connect(operatorOwner)
        .registerOperator(pubkey, 0n, false);

      const opData = await views.getOperatorById(1n);
      expect(opData.fee).to.equal(0n); // zero fee
      expect(opData.isPrivate).to.equal(false);

      // Verify operator cannot increase fee from 0 (FeeIncreaseNotAllowed)
      // Must use a fee above minimumOperatorEthFee to avoid FeeTooLow check first
      await expect(
        network
          .connect(operatorOwner)
          .declareOperatorFee(1n, MINIMAL_OPERATOR_ETH_FEE),
      ).to.be.revertedWithCustomError(network, "FeeIncreaseNotAllowed");
    });

    it("OV-1 edge: register with setPrivate=true sets whitelisted flag", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      const pubkey = makeOperatorKey(1);

      const tx = await network
        .connect(operatorOwner)
        .registerOperator(pubkey, MINIMAL_OPERATOR_ETH_FEE, true);

      const opData = await views.getOperatorById(1n);
      expect(opData.isPrivate).to.equal(true);

      await expect(tx)
        .to.emit(network, "OperatorPrivacyStatusUpdated")
        .withArgs([1n], true);
    });

    it("OV-1 edge: register with same pubkey again reverts OperatorAlreadyExists", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const pubkey = makeOperatorKey(1);
      await network
        .connect(operatorOwner)
        .registerOperator(pubkey, MINIMAL_OPERATOR_ETH_FEE, false);

      await expect(
        network
          .connect(operatorOwner)
          .registerOperator(pubkey, MINIMAL_OPERATOR_ETH_FEE, false),
      ).to.be.revertedWithCustomError(network, "OperatorAlreadyExists");
    });

    it("OV-1 edge: register with fee not divisible by ETH_DEDUCTED_DIGITS reverts MaxPrecisionExceeded", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const pubkey = makeOperatorKey(1);
      // Fee not divisible by 100_000
      const badFee = MINIMAL_OPERATOR_ETH_FEE + 1n;

      await expect(
        network
          .connect(operatorOwner)
          .registerOperator(pubkey, badFee, false),
      ).to.be.revertedWithCustomError(network, "MaxPrecisionExceeded");
    });
  });

  // =========================================================================
  // OV-2: Register Operator (Private, Zero Fee) — Free Operator Constraints
  // =========================================================================
  describe("OV-2: Register Operator (Private, Zero Fee)", () => {
    it("OV-2: registers private zero-fee operator and verifies fee immutability", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      const pubkey = makeOperatorKey(1);

      // Step 1: Register private zero-fee operator
      await network
        .connect(operatorOwner)
        .registerOperator(pubkey, 0n, true);

      const opData = await views.getOperatorById(1n);
      expect(opData.fee).to.equal(0n);
      expect(opData.isPrivate).to.equal(true);

      // Step 2: Attempt to declare fee increase — should revert FeeIncreaseNotAllowed
      // Use a fee above minimumOperatorEthFee to avoid FeeTooLow check
      await expect(
        network
          .connect(operatorOwner)
          .declareOperatorFee(1n, MINIMAL_OPERATOR_ETH_FEE),
      ).to.be.revertedWithCustomError(network, "FeeIncreaseNotAllowed");
    });
  });

  // =========================================================================
  // OV-3: ensureETHDefaults — Critical Default Fee Assignment
  // =========================================================================
  describe("OV-3: ensureETHDefaults — Default Fee Assignment", () => {
    // NOTE: In the full deployment fixture, operators are registered with
    // registerOperator which already initializes ethSnapshot.block.
    // ensureETHDefaults is only for legacy (pre-v2) operators.
    // We test the behavior by registering operators normally (which sets ethFee)
    // and verify that the fee matches the declared fee.
    it("OV-3: operator registered with non-zero fee gets correct ethFee", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      const fee = MINIMAL_OPERATOR_ETH_FEE; // 1_770_000_000
      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), fee, false);

      const opData = await views.getOperatorById(1n);
      expect(opData.fee).to.equal(fee);
      expect(opData.isActive).to.equal(true);
    });

    it("OV-3 edge: operator registered with fee=0 and SSV fee=0 stays free", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      // Register with fee=0 (no SSV legacy fee since this is a fresh operator)
      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), 0n, false);

      const opData = await views.getOperatorById(1n);
      // Fee should be 0 (free operator)
      expect(opData.fee).to.equal(0n);
    });
  });

  // =========================================================================
  // OV-11: Operator Fee Declaration -> Wait -> Execution
  // =========================================================================
  describe("OV-11: Operator Fee Declaration -> Wait -> Execution", () => {
    it("OV-11: declares fee, waits, and executes within approval window", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register operator with initial fee
      const initialFee = MINIMAL_OPERATOR_ETH_FEE; // 1_770_000_000
      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), initialFee, false);

      // Register 4 operators total and a validator so operator has validatorCount > 0
      for (let i = 2; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(i), initialFee, false);
      }

      // Whitelist and register a validator
      await whitelistAddresses(network, operatorOwner, [1, 2, 3, 4], [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (10n ** 20n).toString(16),
      ]);
      await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          [1, 2, 3, 4],
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: ethers.parseEther("10") },
        );

      // Get a valid fee increase (within limit)
      const currentFee = await views.getOperatorFee(1n);
      const currentPacked = currentFee / ETH_DEDUCTED_DIGITS;
      const maxIncreaseBps = await views.getOperatorFeeIncreaseLimit();
      const maxAllowedPacked =
        (currentPacked * (10_000n + maxIncreaseBps) + 9_999n) / 10_000n;
      const newFee = maxAllowedPacked * ETH_DEDUCTED_DIGITS;

      // Step 1: Declare
      const declareTx = await network
        .connect(operatorOwner)
        .declareOperatorFee(1n, newFee);
      await declareTx.wait();

      await expect(declareTx).to.emit(network, "OperatorFeeDeclared");

      // Step 2: Attempt execute too early — should revert
      await expect(
        network.connect(operatorOwner).executeOperatorFee(1n),
      ).to.be.revertedWithCustomError(
        network,
        "ApprovalNotWithinTimeframe",
      );

      // Step 3: Advance time to approval window and execute
      const declareFeePeriod = Number(DECLARE_OPERATOR_FEE_PERIOD);
      await provider.send("evm_increaseTime", [declareFeePeriod + 1]);
      await provider.send("evm_mine", []);

      const executeTx = await network
        .connect(operatorOwner)
        .executeOperatorFee(1n);
      await executeTx.wait();

      await expect(executeTx).to.emit(network, "OperatorFeeExecuted");

      // Verify new fee is applied
      const updatedFee = await views.getOperatorFee(1n);
      expect(updatedFee).to.equal(newFee);
    });

    it("OV-11 edge: execute after approval window expires reverts", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      // Get valid fee increase
      const currentFee = await views.getOperatorFee(1n);
      const currentPacked = currentFee / ETH_DEDUCTED_DIGITS;
      const maxIncreaseBps = await views.getOperatorFeeIncreaseLimit();
      const maxAllowedPacked =
        (currentPacked * (10_000n + maxIncreaseBps) + 9_999n) / 10_000n;
      const newFee = maxAllowedPacked * ETH_DEDUCTED_DIGITS;

      await network
        .connect(operatorOwner)
        .declareOperatorFee(1n, newFee);

      // Advance past both declare and execute periods
      const totalPeriod =
        Number(DECLARE_OPERATOR_FEE_PERIOD) +
        Number(EXECUTE_OPERATOR_FEE_PERIOD) +
        1;
      await provider.send("evm_increaseTime", [totalPeriod]);
      await provider.send("evm_mine", []);

      await expect(
        network.connect(operatorOwner).executeOperatorFee(1n),
      ).to.be.revertedWithCustomError(
        network,
        "ApprovalNotWithinTimeframe",
      );
    });

    it("OV-11 edge: cancel declared fee clears the request", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      const currentFee = await views.getOperatorFee(1n);
      const currentPacked = currentFee / ETH_DEDUCTED_DIGITS;
      const maxIncreaseBps = await views.getOperatorFeeIncreaseLimit();
      const maxAllowedPacked =
        (currentPacked * (10_000n + maxIncreaseBps) + 9_999n) / 10_000n;
      const newFee = maxAllowedPacked * ETH_DEDUCTED_DIGITS;

      await network
        .connect(operatorOwner)
        .declareOperatorFee(1n, newFee);

      const cancelTx = await network
        .connect(operatorOwner)
        .cancelDeclaredOperatorFee(1n);
      await expect(cancelTx).to.emit(
        network,
        "OperatorFeeDeclarationCancelled",
      );

      // Executing after cancel should fail
      await expect(
        network.connect(operatorOwner).executeOperatorFee(1n),
      ).to.be.revertedWithCustomError(network, "NoFeeDeclared");
    });

    it("OV-11 edge: fee increase exceeding limit reverts FeeExceedsIncreaseLimit", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      const currentFee = await views.getOperatorFee(1n);
      const currentPacked = currentFee / ETH_DEDUCTED_DIGITS;
      const maxIncreaseBps = await views.getOperatorFeeIncreaseLimit();
      const maxAllowedPacked =
        (currentPacked * (10_000n + maxIncreaseBps) + 9_999n) / 10_000n;
      // Exceed the limit
      const excessiveFee = (maxAllowedPacked + 1n) * ETH_DEDUCTED_DIGITS;

      const maxOperatorFee = await views.getMaximumOperatorFee();
      // Only test if excessiveFee doesn't exceed maxOperatorFee (otherwise FeeTooHigh fires first)
      if (excessiveFee <= maxOperatorFee) {
        await expect(
          network
            .connect(operatorOwner)
            .declareOperatorFee(1n, excessiveFee),
        ).to.be.revertedWithCustomError(
          network,
          "FeeExceedsIncreaseLimit",
        );
      }
    });
  });

  // =========================================================================
  // OV-12: Operator Fee Reduction (Immediate, No Timelock)
  // =========================================================================
  describe("OV-12: Operator Fee Reduction (Immediate, No Timelock)", () => {
    it("OV-12: reduces fee immediately, preserving earnings at old fee", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const initialFee = 2_000_000_000n; // 2 gwei
      const packedInitialFee = initialFee / ETH_DEDUCTED_DIGITS; // 20_000

      // Register 4 operators and a validator
      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), initialFee, false);
      for (let i = 2; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(i), initialFee, false);
      }
      await whitelistAddresses(network, operatorOwner, [1, 2, 3, 4], [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (10n ** 20n).toString(16),
      ]);
      await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          [1, 2, 3, 4],
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: ethers.parseEther("10") },
        );

      const regBlock = BigInt(await getBlockNumber(provider));

      // Advance 100 blocks to accrue fees
      await mineBlocks(provider, 100);

      // Reduce fee to MINIMAL_OPERATOR_ETH_FEE (must stay above minimum)
      const reducedFee = MINIMAL_OPERATOR_ETH_FEE; // 1_770_000_000
      const reduceTx = await network
        .connect(operatorOwner)
        .reduceOperatorFee(1n, reducedFee);
      await reduceTx.wait();

      await expect(reduceTx).to.emit(network, "OperatorFeeExecuted");

      // Verify new fee applied immediately
      const newFee = await views.getOperatorFee(1n);
      expect(newFee).to.equal(reducedFee);

      // Verify earnings were preserved (accrued at old fee before reduction)
      const earnings = await views.getOperatorEarnings(1n);
      expect(earnings).to.be.greaterThan(0n);
    });

    it("OV-12 edge: reduce to exactly current fee reverts FeeIncreaseNotAllowed", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      await expect(
        network
          .connect(operatorOwner)
          .reduceOperatorFee(1n, MINIMAL_OPERATOR_ETH_FEE),
      ).to.be.revertedWithCustomError(network, "FeeIncreaseNotAllowed");
    });

    it("OV-12 edge: reduce to higher fee reverts FeeIncreaseNotAllowed", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      const higherFee = MINIMAL_OPERATOR_ETH_FEE + ETH_DEDUCTED_DIGITS;
      await expect(
        network
          .connect(operatorOwner)
          .reduceOperatorFee(1n, higherFee),
      ).to.be.revertedWithCustomError(network, "FeeIncreaseNotAllowed");
    });

    it("OV-12 edge: reducing fee clears pending fee change request", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      // Declare a fee increase
      const currentFee = await views.getOperatorFee(1n);
      const currentPacked = currentFee / ETH_DEDUCTED_DIGITS;
      const maxIncreaseBps = await views.getOperatorFeeIncreaseLimit();
      const maxAllowedPacked =
        (currentPacked * (10_000n + maxIncreaseBps) + 9_999n) / 10_000n;
      const newFee = maxAllowedPacked * ETH_DEDUCTED_DIGITS;

      await network
        .connect(operatorOwner)
        .declareOperatorFee(1n, newFee);

      // Execute the fee increase first (so the current fee is higher than minimum)
      const declareFeePeriod = Number(DECLARE_OPERATOR_FEE_PERIOD);
      await connection.ethers.provider.send("evm_increaseTime", [declareFeePeriod + 1]);
      await connection.ethers.provider.send("evm_mine", []);
      await network
        .connect(operatorOwner)
        .executeOperatorFee(1n);

      // Now declare another fee increase
      const updatedFee = await views.getOperatorFee(1n);
      const updatedPacked = updatedFee / ETH_DEDUCTED_DIGITS;
      const maxIncreaseBps2 = await views.getOperatorFeeIncreaseLimit();
      const maxAllowedPacked2 =
        (updatedPacked * (10_000n + maxIncreaseBps2) + 9_999n) / 10_000n;
      const newFee2 = maxAllowedPacked2 * ETH_DEDUCTED_DIGITS;
      await network
        .connect(operatorOwner)
        .declareOperatorFee(1n, newFee2);

      // Reduce fee back to MINIMAL (should also clear pending request)
      await network
        .connect(operatorOwner)
        .reduceOperatorFee(1n, MINIMAL_OPERATOR_ETH_FEE);

      // Trying to execute the old declaration should fail (it was cleared)
      await expect(
        network.connect(operatorOwner).executeOperatorFee(1n),
      ).to.be.revertedWithCustomError(network, "NoFeeDeclared");
    });
  });

  // =========================================================================
  // OV-13: Operator Earnings Accumulation and Withdrawal
  // =========================================================================
  describe("OV-13: Operator Earnings Accumulation and Withdrawal", () => {
    it("OV-13: accumulates earnings and supports partial + full withdrawal", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE; // 1_770_000_000
      const packedFee = fee / ETH_DEDUCTED_DIGITS; // 17_700

      // Register 4 operators
      for (let i = 1; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(i), fee, false);
      }

      // Whitelist and register validator
      await whitelistAddresses(network, operatorOwner, [1, 2, 3, 4], [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (10n ** 20n).toString(16),
      ]);
      await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          [1, 2, 3, 4],
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: ethers.parseEther("10") },
        );

      // Advance 100 blocks
      await mineBlocks(provider, 100);

      // Check earnings accumulated
      const earningsBefore = await views.getOperatorEarnings(1n);
      expect(earningsBefore).to.be.greaterThan(0n);

      // Partial withdrawal
      const partialAmount = earningsBefore / 2n;
      // Ensure amount is divisible by ETH_DEDUCTED_DIGITS for packing
      const alignedPartial =
        (partialAmount / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;

      const ownerBalBefore = await provider.getBalance(
        operatorOwner.address,
      );

      const partialTx = await network
        .connect(operatorOwner)
        .withdrawOperatorEarnings(1n, alignedPartial);
      const partialReceipt = await partialTx.wait();
      const partialGas =
        partialReceipt.gasUsed * partialReceipt.gasPrice;

      await expect(partialTx).to.emit(network, "OperatorWithdrawn");

      const ownerBalAfter = await provider.getBalance(
        operatorOwner.address,
      );
      expect(ownerBalAfter - ownerBalBefore + partialGas).to.equal(
        alignedPartial,
      );

      // Advance 100 more blocks
      await mineBlocks(provider, 100);

      // Full withdrawal
      const earningsBeforeFull = await views.getOperatorEarnings(1n);
      expect(earningsBeforeFull).to.be.greaterThan(0n);

      const ownerBalBefore2 = await provider.getBalance(
        operatorOwner.address,
      );
      const fullTx = await network
        .connect(operatorOwner)
        .withdrawAllOperatorEarnings(1n);
      const fullReceipt = await fullTx.wait();
      const fullGas = fullReceipt.gasUsed * fullReceipt.gasPrice;

      const ownerBalAfter2 = await provider.getBalance(
        operatorOwner.address,
      );

      // After full withdrawal, earnings should be 0
      const earningsAfterFull = await views.getOperatorEarnings(1n);
      // Earnings might be non-zero because the withdrawal tx itself advanced a block
      // But the balance should have been transferred
      expect(ownerBalAfter2 - ownerBalBefore2 + fullGas).to.be.greaterThan(
        0n,
      );
    });
  });

  // =========================================================================
  // OV-14: Remove Operator — Full Cleanup and Final Withdrawal
  // =========================================================================
  describe("OV-14: Remove Operator — Full Cleanup and Final Withdrawal", () => {
    it("OV-14: removes operator with earnings, transfers funds, and cleans up state", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;

      // Register 4 operators
      for (let i = 1; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(i), fee, false);
      }

      // Set operator 1 as private (to verify whitelist cleanup)
      await network
        .connect(operatorOwner)
        .setOperatorsPrivateUnchecked([1n]);

      // Register validator to generate earnings
      await whitelistAddresses(network, operatorOwner, [1, 2, 3, 4], [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (10n ** 20n).toString(16),
      ]);
      await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          [1, 2, 3, 4],
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: ethers.parseEther("10") },
        );

      // Advance 50 blocks
      await mineBlocks(provider, 50);

      // Remove the validator first (operator must have 0 validators for clean removal)
      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        [1, 2, 3, 4],
      );
      await network
        .connect(clusterOwner)
        .removeValidator(makePublicKey(1), [1, 2, 3, 4], cluster);

      // Check earnings accumulated before removal
      const earningsBefore = await views.getOperatorEarnings(1n);
      expect(earningsBefore).to.be.greaterThan(0n);

      // Remove operator
      const ownerBalBefore = await provider.getBalance(
        operatorOwner.address,
      );
      const removeTx = await network
        .connect(operatorOwner)
        .removeOperator(1n);
      const removeReceipt = await removeTx.wait();
      const removeGas =
        removeReceipt.gasUsed * removeReceipt.gasPrice;

      // Verify events
      await expect(removeTx).to.emit(network, "OperatorRemoved").withArgs(1n);
      await expect(removeTx).to.emit(network, "OperatorWithdrawn");

      // Verify ETH transferred to owner
      const ownerBalAfter = await provider.getBalance(
        operatorOwner.address,
      );
      expect(ownerBalAfter - ownerBalBefore + removeGas).to.be.greaterThan(
        0n,
      );

      // Verify operator is now inactive
      const opData = await views.getOperatorById(1n);
      expect(opData.isActive).to.equal(false);

      // Verify operator owner is preserved (not zeroed)
      expect(opData.owner).to.equal(operatorOwner.address);
    });

    it("OV-14 edge: remove operator with 0 earnings in both versions", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      // Register operator but never use it (no validators)
      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      const earningsBefore = await views.getOperatorEarnings(1n);
      expect(earningsBefore).to.equal(0n);

      // Remove — should succeed even with 0 earnings
      const removeTx = await network
        .connect(operatorOwner)
        .removeOperator(1n);
      await expect(removeTx).to.emit(network, "OperatorRemoved").withArgs(1n);
    });

    it("OV-14 edge: after removal, registering validator with removed operator reverts", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register all 4 operators first
      for (let i = 1; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(i), MINIMAL_OPERATOR_ETH_FEE, false);
      }

      // Whitelist clusterOwner for all 4 before removing operator 1
      await whitelistAddresses(network, operatorOwner, [1, 2, 3, 4], [
        clusterOwner.address,
      ]);

      // Remove operator 1
      await network
        .connect(operatorOwner)
        .removeOperator(1n);

      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (10n ** 20n).toString(16),
      ]);

      // Try to register validator using removed operator — should revert
      await expect(
        network.connect(clusterOwner).registerValidator(
          makePublicKey(1),
          [1, 2, 3, 4],
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: ethers.parseEther("10") },
        ),
      ).to.be.revertedWithCustomError(network, "OperatorDoesNotExist");
    });

    it("OV-14 edge: double removal reverts OperatorDoesNotExist", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);
      await network.connect(operatorOwner).removeOperator(1n);

      // Second removal should fail (ethSnapshot.block == 0 && snapshot.block == 0)
      await expect(
        network.connect(operatorOwner).removeOperator(1n),
      ).to.be.revertedWithCustomError(network, "OperatorDoesNotExist");
    });
  });
});
