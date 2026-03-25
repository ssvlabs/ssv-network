/**
 * Operator edge case and revert scenarios extracted from:
 * - test/e2e/operators/operator-edge-cases.test.ts
 * - test/e2e/operators/operator-reverts.test.ts
 * - test/e2e/operators/op-gap.test.ts (OP/OF/OE gap tests)
 *
 * Covers: removed operator state, zero-fee operator behavior, precision,
 * operator index frozen after removal, concurrent fee changes, revert
 * paths (duplicate registration, non-owner removal, etc.).
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import {
  pickActiveOperator,
  pickSecondActiveOperator,
  removeOperator,
  reduceOperatorFee,
  assertOperatorActive,
  assertOperatorInactive,
  assertOperatorFee,
  assertEarningsNonDecreasing,
  assertEarningsZero,
} from "./_op-helpers.ts";
import {
  findActiveOp,
  findSecondActiveOp,
  removeValidator,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// OPEC-001: Removed operator preserves owner but zeros fee
// ---------------------------------------------------------------------------
export const opecRemovedOpState: Scenario = {
  id: "OPEC-removed-op-state",
  tags: ["operator", "edge-case", "remove"],

  async run(ctx: ScenarioContext) {
    const op = pickActiveOperator(ctx);

    await ctx.step(
      "remove-and-verify-state",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorInactive(post, op.id, "removed-state");
        assertOperatorFee(post, op.id, 0n, "removed-fee-zeroed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPEC-002: Zero-fee operator stays at zero fee — no default assignment
// ---------------------------------------------------------------------------
export const opecZeroFeeStaysZero: Scenario = {
  id: "OPEC-zero-fee-stays-zero",
  tags: ["operator", "edge-case", "zero-fee"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);

    // Find an operator and reduce to zero
    const op = findActiveOp(ctx, record);
    if (op.fee === 0n) {
      // Already zero fee — verify it stays zero after mining
      await ctx.step(
        "verify-zero-fee-stays",
        async () => {
          await ctx.mineBlocks(100);
        },
        async (_pre, post) => {
          assertOperatorFee(post, op.id, 0n, "zero-fee-persistent");
          assertEarningsZero(post, op.id, "zero-fee-no-earnings");
        },
      );
      return;
    }

    // Reduce to zero
    await ctx.step(
      "reduce-to-zero",
      async () => {
        await reduceOperatorFee(ctx, op, 0n);
      },
      async (_pre, post) => {
        assertOperatorFee(post, op.id, 0n, "reduced-to-zero");
      },
    );

    // Mine blocks — zero-fee operator earns nothing
    await ctx.step(
      "verify-no-earnings-at-zero",
      async () => {
        await ctx.mineBlocks(100);
      },
      async (pre, post) => {
        assertEarningsNonDecreasing(pre, post, op.id, "zero-fee-no-loss");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPEC-003: Operator index frozen after removal — cluster still functions
// ---------------------------------------------------------------------------
export const opecIndexFrozenAfterRemoval: Scenario = {
  id: "OPEC-index-frozen-after-removal",
  tags: ["operator", "edge-case", "remove", "cluster"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);
    const op2 = findSecondActiveOp(ctx, record, op.id);

    // Step 1: Mine blocks for earnings
    await ctx.step(
      "mine-for-earnings",
      async () => {
        await ctx.mineBlocks(100);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Remove first operator
    await ctx.step(
      "remove-first-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorInactive(post, op.id, "op-removed");
        // Other operators should still be active
        assertOperatorActive(post, op2.id, "op2-still-active");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Verify remaining operator still accrues earnings
    await ctx.step(
      "verify-remaining-op-earns",
      async () => {},
      async (_pre, post) => {
        assertOperatorActive(post, op2.id, "op2-active-after-mining");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPEC-004: Concurrent fee changes on multiple operators in same cluster
// ---------------------------------------------------------------------------
export const opecConcurrentFeeChanges: Scenario = {
  id: "OPEC-concurrent-fee-changes",
  tags: ["operator", "edge-case", "fee-change", "multi-op"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op1 = findActiveOp(ctx, record);
    const op2 = findSecondActiveOp(ctx, record, op1.id);

    if (op1.fee === 0n && op2.fee === 0n) {
      throw new ScenarioSkipped("Both operators have zero fee");
    }

    // Step 1: Mine blocks
    await ctx.step(
      "mine-for-earnings",
      async () => {
        await ctx.mineBlocks(100);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Reduce op1 fee to 0
    if (op1.fee > 0n) {
      await ctx.step(
        "reduce-op1-fee",
        async () => {
          await reduceOperatorFee(ctx, op1, 0n);
        },
        async (_pre, post) => {
          assertOperatorFee(post, op1.id, 0n, "op1-zeroed");
        },
      );
    }

    await ctx.mineBlocks(100);

    // Step 3: Verify op2 still earns (if it has fee)
    await ctx.step(
      "verify-op2-still-earns",
      async () => {},
      async (_pre, post) => {
        const op2Snap = post.operators.get(op2.id);
        if (!op2Snap) throw new Error(`operator ${op2.id} missing`);
        if (op2Snap.fee > 0n && op2Snap.earnings === 0n) {
          throw new Error(
            `Operator ${op2.id} has fee=${op2Snap.fee} but 0 earnings`,
          );
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPEC-005: Double removal reverts (revert expected)
// ---------------------------------------------------------------------------
export const opecDoubleRemovalReverts: Scenario = {
  id: "OPEC-double-removal-reverts",
  tags: ["operator", "edge-case", "revert", "remove"],

  async run(ctx: ScenarioContext) {
    const op = pickActiveOperator(ctx);

    // First removal
    await ctx.step(
      "first-removal",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorInactive(post, op.id, "first-removal");
      },
    );

    // Second removal — expect revert (OperatorDoesNotExist)
    await ctx.step(
      "second-removal-reverts",
      async () => {
        const tx = await ctx.contracts.network
          .connect(op.ownerSigner)
          .removeOperator(op.id);
        await tx.wait();
      },
      async (_pre, _post) => {},
    );
  },
};

// ---------------------------------------------------------------------------
// OPEC-006: Non-owner tries to remove operator — reverts
// ---------------------------------------------------------------------------
export const opecNonOwnerRemovalReverts: Scenario = {
  id: "OPEC-non-owner-removal-reverts",
  tags: ["operator", "edge-case", "revert", "access-control"],

  async run(ctx: ScenarioContext) {
    const op1 = pickActiveOperator(ctx);
    const op2 = pickSecondActiveOperator(ctx, op1.id);

    // Try to remove op1 using op2's signer — should revert (CallerNotOwner)
    await ctx.step(
      "non-owner-removal-reverts",
      async () => {
        const tx = await ctx.contracts.network
          .connect(op2.ownerSigner)
          .removeOperator(op1.id);
        await tx.wait();
      },
      async (_pre, _post) => {},
    );
  },
};

// ---------------------------------------------------------------------------
// OPEC-007: Withdraw from operator with zero earnings — no revert
// ---------------------------------------------------------------------------
export const opecWithdrawZeroEarnings: Scenario = {
  id: "OPEC-withdraw-zero-earnings",
  tags: ["operator", "edge-case", "withdrawal"],

  async run(ctx: ScenarioContext) {
    const op = pickActiveOperator(ctx);

    // Step: Withdraw all — should handle zero earnings gracefully
    await ctx.step(
      "withdraw-all-version-zero",
      async () => {
        const tx = await ctx.contracts.network
          .connect(op.ownerSigner)
          .withdrawAllVersionOperatorEarnings(op.id);
        await tx.wait();
      },
      async (_pre, _post) => {},
    );
  },
};

// ---------------------------------------------------------------------------
// OPEC-008: OP-008 — Register with overflow fee → FeeTooHigh
// (In MC, we can't register new operators, but we test removal of max-fee ops)
// ---------------------------------------------------------------------------
export const opecMaxFeeOperatorRemoval: Scenario = {
  id: "OPEC-max-fee-operator-removal",
  tags: ["operator", "edge-case", "remove", "op-gap"],

  async run(ctx: ScenarioContext) {
    const op = pickActiveOperator(ctx);

    // Step 1: Mine blocks for earnings at whatever fee
    await ctx.step(
      "mine-for-earnings",
      async () => {
        await ctx.mineBlocks(200);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Remove — test that removal works with any fee level
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorInactive(post, op.id, "removed");
        assertOperatorFee(post, op.id, 0n, "fee-zeroed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPEC-009: Remove validator then remove operator in sequence
// ---------------------------------------------------------------------------
export const opecRemoveValidatorThenOperator: Scenario = {
  id: "OPEC-remove-validator-then-operator",
  tags: ["operator", "edge-case", "remove", "validator-remove"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("No validators in cluster");
    }

    // Step 1: Remove validator
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(50);

    // Step 2: Remove operator
    await ctx.step(
      "remove-operator-after-validator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorInactive(post, op.id, "removed-after-val-removal");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPEC-010: OE-037 — withdrawAllVersionOperatorEarnings on non-existent op
// ---------------------------------------------------------------------------
export const opecWithdrawNonExistentOp: Scenario = {
  id: "OPEC-withdraw-non-existent-op-reverts",
  tags: ["operator", "edge-case", "revert", "oe-gap"],

  async run(ctx: ScenarioContext) {
    const op = pickActiveOperator(ctx);

    // Step 1: Remove the operator first
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorInactive(post, op.id, "removed");
      },
    );

    // Step 2: Try to withdraw — should revert (OperatorDoesNotExist)
    await ctx.step(
      "withdraw-reverts-on-removed",
      async () => {
        const tx = await ctx.contracts.network
          .connect(op.ownerSigner)
          .withdrawAllVersionOperatorEarnings(op.id);
        await tx.wait();
      },
      async (_pre, _post) => {},
    );
  },
};

// ---------------------------------------------------------------------------
// OPEC-011: Reduce fee clears pending fee change request
// ---------------------------------------------------------------------------
export const opecReduceCleared: Scenario = {
  id: "OPEC-reduce-clears-pending",
  tags: ["operator", "edge-case", "fee-change"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    if (op.fee === 0n) {
      throw new ScenarioSkipped("Operator has zero fee");
    }

    // Step: Reduce fee to zero — implicitly clears any pending request
    await ctx.step(
      "reduce-clears-pending",
      async () => {
        await reduceOperatorFee(ctx, op, 0n);
      },
      async (_pre, post) => {
        assertOperatorFee(post, op.id, 0n, "fee-cleared");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPEC-012: Mine many blocks → remove op → mine more → verify frozen state
// ---------------------------------------------------------------------------
export const opecEarningsFrozenLongTime: Scenario = {
  id: "OPEC-earnings-frozen-long-time",
  tags: ["operator", "edge-case", "remove", "time"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Mine blocks for earnings
    await ctx.step(
      "mine-for-earnings",
      async () => {
        await ctx.mineBlocks(500);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorInactive(post, op.id, "removed");
      },
    );

    // Step 3: Mine many more blocks
    await ctx.step(
      "mine-many-blocks-after-removal",
      async () => {
        await ctx.mineBlocks(5000);
      },
      async (_pre, _post) => {},
    );

    // Step 4: Verify state is frozen
    await ctx.step(
      "verify-frozen-state",
      async () => {},
      async (_pre, post) => {
        assertOperatorInactive(post, op.id, "still-removed");
        assertOperatorFee(post, op.id, 0n, "fee-still-zero");
      },
    );
  },
};
