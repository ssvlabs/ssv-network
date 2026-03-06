import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey } from "../../common/helpers.ts";
import {
  DECLARE_OPERATOR_FEE_PERIOD,
  ETH_DEDUCTED_DIGITS,
  EXECUTE_OPERATOR_FEE_PERIOD,
  MAXIMUM_OPERATORS_FEE,
  MINIMAL_OPERATOR_ETH_FEE,
  OPERATOR_MAX_FEE_INCREASE,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

/**
 *
 * CONTEXT:
 * - Legacy SSV operators (registered pre-v2) have ethSnapshot.block == 0
 * - When they call reduceOperatorFee for the first time, ensureETHDefaults should:
 *   1. Initialize ethSnapshot.block = block.number
 *   2. Assign ethFee = DEFAULT_OPERATOR_ETH_FEE (if SSV fee > 0)
 *   3. Mark operator as "has interacted with ETH system" (ethSnapshot.block > 0)
 * - After initialization, operator can reduce fee (even to 0)
 * - Later cluster migration will NOT overwrite the explicit fee
 */
describe("SSVOperators `reduceOperatorFee()` - ethSnapshot initialization", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(
      connection,
      MAXIMUM_OPERATORS_FEE,
      DECLARE_OPERATOR_FEE_PERIOD,
      EXECUTE_OPERATOR_FEE_PERIOD,
      OPERATOR_MAX_FEE_INCREASE
    );

  const DEFAULT_OPERATOR_ETH_FEE = 1_770_000_000n; // From OperatorLib.sol
  // For tests with ensureETHDefaults, we need a fee less than DEFAULT
  // Since MINIMAL_OPERATOR_ETH_FEE == DEFAULT_OPERATOR_ETH_FEE, we use a smaller value
  const REDUCED_FEE = 1_000_000_000n; // 1 gwei, less than DEFAULT (1.77 gwei)

  describe("ethSnapshot initialization on first reduceOperatorFee call", () => {
    it("Initializes ethSnapshot.block when reducing fee for uninitialized operator", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

      const initialFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await operators.registerOperator(makeOperatorKey(1), initialFee, false);

      // Manually clear ethSnapshot to simulate legacy operator
      await operators.mockClearEthSnapshot(1);
      await operators.mockSetSSVFee(1, 1_000_000n); // Set SSV fee > 0 for legacy operator

      const opBefore = await operators.getOperator(1);
      expect(opBefore.ethSnapshot.block).to.equal(0, "ethSnapshot.block should be 0 before reduceOperatorFee");

      // Reduce fee - this should initialize ethSnapshot
      await operators.reduceOperatorFee(1, REDUCED_FEE);

      const opAfter = await operators.getOperator(1);
      expect(opAfter.ethSnapshot.block).to.be.gt(0, "ethSnapshot.block should be initialized");
      expect(opAfter.ethFee).to.equal(REDUCED_FEE / ETH_DEDUCTED_DIGITS);
    });

    it("Does not re-initialize ethSnapshot.block if already set", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

      const initialFee = MINIMAL_OPERATOR_ETH_FEE * 3n;
      await operators.registerOperator(makeOperatorKey(1), initialFee, false);

      const opBefore = await operators.getOperator(1);
      const initialBlock = opBefore.ethSnapshot.block;
      expect(initialBlock).to.be.gt(0, "ethSnapshot.block should be set after registration");

      // Mine blocks to ensure block number changes
      await networkHelpers.mine(10n);

      // Reduce fee - should NOT reset ethSnapshot.block
      await operators.reduceOperatorFee(1, MINIMAL_OPERATOR_ETH_FEE * 2n);

      const opAfter = await operators.getOperator(1);
      expect(opAfter.ethSnapshot.block).to.be.gt(initialBlock, "ethSnapshot.block should be updated via updateSnapshot");
      expect(opAfter.ethFee).to.equal((MINIMAL_OPERATOR_ETH_FEE * 2n) / ETH_DEDUCTED_DIGITS);
    });
  });

  describe("ensureETHDefaults behavior with legacy SSV operators", () => {
    it("Legacy operator (ethSnapshot.block=0, ethFee=0, SSV fee>0) gets default fee before reduction", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

      // Register with normal fee
      await operators.registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE * 2n, false);

      // Simulate legacy SSV operator state: clear ethSnapshot, set SSV fee > 0
      await operators.mockClearEthSnapshot(1);
      await operators.mockSetSSVFee(1, 1_000_000n); // Non-zero SSV fee

      const opBefore = await operators.getOperator(1);
      expect(opBefore.ethSnapshot.block).to.equal(0);
      expect(opBefore.ethFee).to.equal(0n);
      expect(opBefore.fee).to.be.gt(0n, "SSV fee should be > 0");

      // Reduce fee - should trigger ensureETHDefaults
      // Expected: ethFee gets DEFAULT_OPERATOR_ETH_FEE, then reduced to target
      const targetFee = REDUCED_FEE;

      // This should:
      // 1. Call ensureETHDefaults
      // 2. ensureETHDefaults sees ethSnapshot.block == 0, ethFee == 0, SSV fee > 0
      // 3. Sets ethFee = DEFAULT_OPERATOR_ETH_FEE (1.77 gwei)
      // 4. Sets ethSnapshot.block = block.number
      // 5. Validates targetFee < DEFAULT_OPERATOR_ETH_FEE
      // 6. Sets ethFee = targetFee
      await operators.reduceOperatorFee(1, targetFee);

      const opAfter = await operators.getOperator(1);
      expect(opAfter.ethSnapshot.block).to.be.gt(0, "ethSnapshot.block should be initialized");
      expect(opAfter.ethFee).to.equal(targetFee / ETH_DEDUCTED_DIGITS, "ethFee should be reduced to target");
    });

    it("Reverts when a legacy operator reduces its fee to exact DEFAULT_OPERATOR_ETH_FEE amount", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

      await operators.registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE * 3n, false);

      // Simulate legacy state
      await operators.mockClearEthSnapshot(1);
      await operators.mockSetSSVFee(1, 1_000_000n);

      await expect(
        operators.reduceOperatorFee(1, DEFAULT_OPERATOR_ETH_FEE)
      ).to.be.revertedWithCustomError(operators, Errors.FEE_INCREASE_NOT_ALLOWED);
    });

    it("Legacy operator can reduce to zero (explicit zero fee)", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

      await operators.registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE * 2n, false);

      // Simulate legacy state
      await operators.mockClearEthSnapshot(1);
      await operators.mockSetSSVFee(1, 1_000_000n);

      // Reduce to zero
      // Expected:
      // 1. ensureETHDefaults assigns DEFAULT_OPERATOR_ETH_FEE
      // 2. Validation: 0 < DEFAULT_OPERATOR_ETH_FEE ✅
      // 3. ethFee = 0
      await operators.reduceOperatorFee(1, 0n);

      const opAfter = await operators.getOperator(1);
      expect(opAfter.ethSnapshot.block).to.be.gt(0, "ethSnapshot.block should be initialized");
      expect(opAfter.ethFee).to.equal(0n, "ethFee should be 0");
    });

    it("Reverts with FeeIncreaseNotAllowed when zero-fee operator (ethFee=0, SSV fee=0) tries to reduce fee to zero", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

      await operators.registerOperator(makeOperatorKey(1), 0n, false);

      await operators.mockClearEthSnapshot(1);

      const opBefore = await operators.getOperator(1);
      expect(opBefore.ethSnapshot.block).to.equal(0);
      expect(opBefore.ethFee).to.equal(0n);
      expect(opBefore.fee).to.equal(0n, "SSV fee should be 0");

      await expect(
        operators.reduceOperatorFee(1, 0n)
      ).to.be.revertedWithCustomError(operators, Errors.FEE_INCREASE_NOT_ALLOWED);
    });
  });

  describe("Edge case: ethSnapshot.block as marker for explicit fee", () => {
    it("After reduceOperatorFee, ethSnapshot.block > 0 prevents ensureETHDefaults from overwriting", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

      await operators.registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE * 2n, false);

      // Simulate legacy state
      await operators.mockClearEthSnapshot(1);
      await operators.mockSetSSVFee(1, 1_000_000n);

      // Reduce to zero (first interaction with ETH system)
      await operators.reduceOperatorFee(1, 0n);

      const opAfterReduce = await operators.getOperator(1);
      expect(opAfterReduce.ethSnapshot.block).to.be.gt(0, "ethSnapshot.block should be > 0");
      expect(opAfterReduce.ethFee).to.equal(0n, "ethFee should be 0");

      // Simulate cluster migration calling ensureETHDefaults
      await operators.mockCallEnsureETHDefaults(1);

      const opAfterMigration = await operators.getOperator(1);
      expect(opAfterMigration.ethFee).to.equal(0n, "ethFee should STILL be 0 (not overwritten to default)");
      expect(opAfterMigration.ethSnapshot.block).to.be.gt(0, "ethSnapshot.block should remain > 0");
    });

    it("Operator with ethSnapshot.block == 0 gets default on ensureETHDefaults", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

      await operators.registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      // Simulate legacy state
      await operators.mockClearEthSnapshot(1);
      await operators.mockSetSSVFee(1, 1_000_000n);

      const opBefore = await operators.getOperator(1);
      expect(opBefore.ethSnapshot.block).to.equal(0);
      expect(opBefore.ethFee).to.equal(0n);

      // Call ensureETHDefaults directly (simulates cluster migration)
      await operators.mockCallEnsureETHDefaults(1);

      const opAfter = await operators.getOperator(1);
      expect(opAfter.ethSnapshot.block).to.be.gt(0, "ethSnapshot.block should be initialized");
      expect(opAfter.ethFee).to.equal(DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS, "ethFee should be DEFAULT");
    });
  });

  describe("Interaction with fee change requests", () => {
    it("reduceOperatorFee clears pending fee request and initializes ethSnapshot", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

      await operators.registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE * 3n, false);

      // Create a pending fee request BEFORE clearing ethSnapshot
      const declaredFee = MINIMAL_OPERATOR_ETH_FEE * 4n;
      await operators.declareOperatorFee(1, declaredFee);

      const requestBefore = await operators.getOperatorFeeChangeRequest(1);
      expect(requestBefore.approvalBeginTime).to.be.gt(0, "Fee request should exist");

      // Now simulate legacy state (clear ethSnapshot)
      await operators.mockClearEthSnapshot(1);
      await operators.mockSetSSVFee(1, 1_000_000n);

      // Reduce fee - should clear request AND initialize ethSnapshot
      await operators.reduceOperatorFee(1, REDUCED_FEE);

      const requestAfter = await operators.getOperatorFeeChangeRequest(1);
      expect(requestAfter.approvalBeginTime).to.equal(0, "Fee request should be cleared");

      const opAfter = await operators.getOperator(1);
      expect(opAfter.ethSnapshot.block).to.be.gt(0, "ethSnapshot.block should be initialized");
      expect(opAfter.ethFee).to.equal(REDUCED_FEE / ETH_DEDUCTED_DIGITS);
    });
  });

  describe("Validation with uninitialized ethSnapshot", () => {
    it("Reverts with FeeIncreaseNotAllowed when reducing to value >= default fee", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

      await operators.registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE * 2n, false);

      // Simulate legacy state
      await operators.mockClearEthSnapshot(1);
      await operators.mockSetSSVFee(1, 1_000_000n);

      // Try to "reduce" to a value >= DEFAULT_OPERATOR_ETH_FEE
      // After ensureETHDefaults, ethFee = DEFAULT_OPERATOR_ETH_FEE
      // Validation: shrunkAmount.gte(operator.ethFee) should fail
      const tooHighFee = DEFAULT_OPERATOR_ETH_FEE + ETH_DEDUCTED_DIGITS;

      await expect(
        operators.reduceOperatorFee(1, tooHighFee)
      ).to.be.revertedWithCustomError(operators, Errors.FEE_INCREASE_NOT_ALLOWED);
    });

    it("Reverts with FeeTooLow when reducing below minimum (even after default assignment)", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

      await operators.registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE * 2n, false);

      // Simulate legacy state
      await operators.mockClearEthSnapshot(1);
      await operators.mockSetSSVFee(1, 1_000_000n);

      // Set minimum fee
      await operators.mockSetMinimumOperatorEthFee(Number(MINIMAL_OPERATOR_ETH_FEE));

      // Try to reduce below minimum (but not to zero)
      const belowMinimum = MINIMAL_OPERATOR_ETH_FEE - ETH_DEDUCTED_DIGITS;

      await expect(
        operators.reduceOperatorFee(1, belowMinimum)
      ).to.be.revertedWithCustomError(operators, Errors.FEE_TOO_LOW);
    });
  });

  describe("Gas usage tracking", () => {
    it("reduceOperatorFee succeeds with ethSnapshot initialization (higher gas expected)", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

      await operators.registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE * 2n, false);

      // Simulate legacy state
      await operators.mockClearEthSnapshot(1);
      await operators.mockSetSSVFee(1, 1_000_000n);

      // This call initializes ethSnapshot, assigns default fee, and reduces to target
      // Gas is higher than normal reduceOperatorFee due to ensureETHDefaults
      const tx = await operators.reduceOperatorFee(1, REDUCED_FEE);
      const receipt = await tx.wait();

      // Verify it succeeded
      expect(receipt!.status).to.equal(1);

      // Gas is approximately ~90k (vs ~62k for normal reduceOperatorFee)
      // We don't track it strictly since it's expected to be higher
      expect(receipt!.gasUsed).to.be.gt(80000n, "Gas should be higher due to initialization");
    });
  });

  describe("Event emission", () => {
    it("Emits OperatorFeeExecuted with correct parameters after initialization", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
      const [deployer] = await connection.ethers.getSigners();

      await operators.registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE * 2n, false);

      // Simulate legacy state
      await operators.mockClearEthSnapshot(1);
      await operators.mockSetSSVFee(1, 1_000_000n);

      const targetFee = REDUCED_FEE;
      const tx = await operators.reduceOperatorFee(1, targetFee);
      const receipt = await tx.wait();

      await expect(tx)
        .to.emit(operators, Events.OPERATOR_FEE_EXECUTED)
        .withArgs(deployer.address, 1, receipt!.blockNumber, targetFee);
    });

    it("Emit OperatorFeeExecuted from ensureETHDefaults during reduceOperatorFee", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

      await operators.registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE * 2n, false);

      // Simulate legacy state
      await operators.mockClearEthSnapshot(1);
      await operators.mockSetSSVFee(1, 1_000_000n);

      const tx = await operators.reduceOperatorFee(1, REDUCED_FEE);
      const receipt = await tx.wait();

      // Should emit exactly TWO OperatorFeeExecuted event (from reduceOperatorFee and ensureETHDefaults)
      const events = receipt!.logs.filter((log: any) => {
        try {
          const parsed = operators.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === Events.OPERATOR_FEE_EXECUTED;
        } catch {
          return false;
        }
      });

      expect(events.length).to.equal(2);
    });
  });
});
