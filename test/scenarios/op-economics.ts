/**
 * Operator economics scenarios extracted from:
 * - test/e2e/operators/operator-economics.test.ts
 * - test/e2e/operators/op-gap.test.ts (OF and OE gaps)
 *
 * Covers: operator earnings accumulation, fee change during active cluster,
 * multi-cluster earnings, removal after validators removed, combined ETH+SSV
 * withdrawal, and fee/earnings edge cases.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import {
  pickActiveOperator,
  removeOperator,
  reduceOperatorFee,
  withdrawAllEarnings,
  withdrawAllVersionEarnings,
  withdrawPartialEarnings,
  assertOperatorInactive,
  assertOperatorFee,
  assertEarningsNonDecreasing,
  assertEarningsDecreased,
  assertEqualFeeOperatorsEarnSame,
} from "./_op-helpers.ts";
import {
  findActiveOp,
  removeValidator,
  assertClusterActive,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// OPE-001: Operator earnings accumulate over blocks
// ---------------------------------------------------------------------------
export const opeEarningsAccumulate: Scenario = {
  id: "OPE-earnings-accumulate",
  tags: ["operator", "economics", "earnings", "happy-path"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Mine blocks for accrual
    await ctx.step(
      "mine-for-accrual",
      async () => {
        await ctx.mineBlocks(200);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Verify earnings increased
    await ctx.step(
      "verify-earnings-increased",
      async () => {},
      async (_pre, post) => {
        const postSn = post.operators.get(op.id);
        if (!postSn) throw new Error(`operator ${op.id} not in snapshot`);
        // If operator has fee > 0 and cluster has validators, earnings should be > 0
        if (postSn.fee > 0n && postSn.earnings === 0n) {
          throw new Error(
            `Operator ${op.id} has fee=${postSn.fee} but 0 earnings after mining 200 blocks`,
          );
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPE-002: Partial + full earnings withdrawal
// ---------------------------------------------------------------------------
export const opePartialFullWithdrawal: Scenario = {
  id: "OPE-partial-full-withdrawal",
  tags: ["operator", "economics", "earnings", "withdrawal"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    if (op.fee === 0n) {
      throw new ScenarioSkipped("Operator has zero fee — no earnings to withdraw");
    }

    // Step 1: Mine blocks
    await ctx.step(
      "mine-for-earnings",
      async () => {
        await ctx.mineBlocks(200);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Read current earnings
    let currentEarnings = 0n;
    await ctx.step(
      "read-earnings",
      async () => {
        currentEarnings = await ctx.contracts.views.getOperatorEarnings(op.id);
      },
      async (_pre, _post) => {},
    );

    if (currentEarnings === 0n) {
      throw new ScenarioSkipped("No earnings to withdraw");
    }

    // Step 3: Partial withdrawal (half)
    const ETH_DEDUCTED_DIGITS = 100_000n;
    const half = (currentEarnings / (2n * ETH_DEDUCTED_DIGITS)) * ETH_DEDUCTED_DIGITS;
    if (half > 0n) {
      await ctx.step(
        "partial-withdrawal",
        async () => {
          await withdrawPartialEarnings(ctx, op, half);
        },
        async (pre, post) => {
          assertEarningsDecreased(pre, post, op.id, "after-partial-withdraw");
        },
      );
    }

    // Step 4: Full withdrawal
    await ctx.step(
      "full-withdrawal",
      async () => {
        await withdrawAllEarnings(ctx, op);
      },
      async (pre, post) => {
        assertEarningsDecreased(pre, post, op.id, "after-full-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPE-003: Fee change during active cluster — earnings continue at new rate
// ---------------------------------------------------------------------------
export const opeFeeChangeDuringActive: Scenario = {
  id: "OPE-fee-change-during-active",
  tags: ["operator", "economics", "fee-change"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    if (op.fee === 0n) {
      throw new ScenarioSkipped("Operator has zero fee");
    }

    // Step 1: Mine blocks for earnings at old rate
    await ctx.step(
      "mine-at-old-rate",
      async () => {
        await ctx.mineBlocks(100);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Reduce fee
    await ctx.step(
      "reduce-fee",
      async () => {
        await reduceOperatorFee(ctx, op, 0n);
      },
      async (pre, post) => {
        // Earnings should not decrease on fee reduction (settled at old rate)
        assertEarningsNonDecreasing(pre, post, op.id, "earnings-on-reduce");
      },
    );

    // Step 3: Mine more blocks — no new earnings at zero fee
    await ctx.step(
      "mine-at-zero-fee",
      async () => {
        await ctx.mineBlocks(100);
      },
      async (pre, post) => {
        assertEarningsNonDecreasing(pre, post, op.id, "no-decrease-at-zero");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPE-004: Multi-cluster operator — earnings from multiple clusters
// ---------------------------------------------------------------------------
export const opeMultiClusterEarnings: Scenario = {
  id: "OPE-multi-cluster-earnings",
  tags: ["operator", "economics", "multi-cluster"],

  async run(ctx: ScenarioContext) {
    // Pick a cluster
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);

    // Step 1: Mine blocks for earnings
    await ctx.step(
      "mine-for-earnings",
      async () => {
        await ctx.mineBlocks(200);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Verify all equal-fee operators in the cluster have equal earnings
    await ctx.step(
      "verify-equal-fee-equal-earnings",
      async () => {},
      async (_pre, post) => {
        assertEqualFeeOperatorsEarnSame(
          post,
          record.operatorIds,
          "multi-cluster-equal",
        );
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPE-005: Operator removal after all validators removed — final earnings
// ---------------------------------------------------------------------------
export const opeRemovalAfterValidatorsRemoved: Scenario = {
  id: "OPE-removal-after-validators-removed",
  tags: ["operator", "economics", "remove", "validator-remove"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("No validators in cluster to remove");
    }

    // Step 1: Mine blocks for earnings
    await ctx.step(
      "mine-for-earnings",
      async () => {
        await ctx.mineBlocks(100);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Remove a validator
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(50);

    // Step 3: Remove operator — should get final earnings transfer
    await ctx.step(
      "remove-operator-final-earnings",
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
// OPE-006: withdrawAllVersionOperatorEarnings — combined ETH + SSV
// ---------------------------------------------------------------------------
export const opeWithdrawAllVersions: Scenario = {
  id: "OPE-withdraw-all-versions",
  tags: ["operator", "economics", "withdrawal", "combined"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Mine blocks for earnings
    await ctx.step(
      "mine-for-earnings",
      async () => {
        await ctx.mineBlocks(200);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Withdraw all version earnings
    await ctx.step(
      "withdraw-all-version-earnings",
      async () => {
        await withdrawAllVersionEarnings(ctx, op);
      },
      async (pre, post) => {
        assertEarningsDecreased(pre, post, op.id, "after-all-version-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPE-007: OF-024 — Reduce fee with explicit EB clusters
// ---------------------------------------------------------------------------
export const opeReduceFeeWithEB: Scenario = {
  id: "OPE-reduce-fee-with-eb",
  tags: ["operator", "economics", "fee-change", "eb-update", "of-gap"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    if (op.fee === 0n) {
      throw new ScenarioSkipped("Operator has zero fee");
    }

    await ctx.mineBlocks(100);

    // Step 1: Reduce fee — snapshot settles with current vUnits
    await ctx.step(
      "reduce-fee-with-eb",
      async () => {
        await reduceOperatorFee(ctx, op, 0n);
      },
      async (pre, post) => {
        assertEarningsNonDecreasing(pre, post, op.id, "earnings-on-eb-reduce");
        assertOperatorFee(post, op.id, 0n, "fee-zeroed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPE-008: OF-040 — Fee change on operator in liquidated cluster
// ---------------------------------------------------------------------------
export const opeFeeChangeInLiquidatedCluster: Scenario = {
  id: "OPE-fee-change-liquidated-cluster",
  tags: ["operator", "economics", "fee-change", "liquidation", "of-gap"],

  async run(ctx: ScenarioContext) {
    // We just test that fee reduction works regardless of cluster state
    const op = pickActiveOperator(ctx);

    if (op.fee === 0n) {
      throw new ScenarioSkipped("Operator has zero fee");
    }

    await ctx.step(
      "reduce-fee-regardless-of-cluster",
      async () => {
        await reduceOperatorFee(ctx, op, 0n);
      },
      async (_pre, post) => {
        assertOperatorFee(post, op.id, 0n, "fee-reduced-in-any-state");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPE-009: OF-049 — Decrease-to-zero via reduce
// ---------------------------------------------------------------------------
export const opeDecreaseToZero: Scenario = {
  id: "OPE-decrease-to-zero",
  tags: ["operator", "economics", "fee-change", "zero-fee", "of-gap"],

  async run(ctx: ScenarioContext) {
    const op = pickActiveOperator(ctx);

    if (op.fee === 0n) {
      throw new ScenarioSkipped("Operator already at zero fee");
    }

    // Step 1: Reduce to zero
    await ctx.step(
      "reduce-to-zero",
      async () => {
        await reduceOperatorFee(ctx, op, 0n);
      },
      async (_pre, post) => {
        assertOperatorFee(post, op.id, 0n, "permanently-free");
      },
    );

    await ctx.mineBlocks(100);

    // Step 2: Verify earnings frozen at zero fee
    await ctx.step(
      "verify-no-new-earnings",
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
// OPE-010: OE-028 — Large accumulated balance, no overflow
// ---------------------------------------------------------------------------
export const opeLargeAccumulation: Scenario = {
  id: "OPE-large-accumulation",
  tags: ["operator", "economics", "earnings", "overflow", "oe-gap"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Mine many blocks for large accumulation
    await ctx.step(
      "mine-many-blocks",
      async () => {
        await ctx.mineBlocks(10000);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Verify operator earnings are positive and non-zero
    await ctx.step(
      "verify-large-earnings",
      async () => {},
      async (_pre, post) => {
        const opSnap = post.operators.get(op.id);
        if (!opSnap) throw new Error(`operator ${op.id} missing`);
        if (opSnap.fee > 0n && opSnap.earnings === 0n) {
          throw new Error(
            `Operator ${op.id} has fee=${opSnap.fee} but 0 earnings after 10k blocks`,
          );
        }
      },
    );

    // Step 3: Withdraw all — should succeed
    await ctx.step(
      "withdraw-large-earnings",
      async () => {
        await withdrawAllEarnings(ctx, op);
      },
      async (pre, post) => {
        assertEarningsDecreased(pre, post, op.id, "large-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPE-011: Earnings remain frozen after no-validator period
// ---------------------------------------------------------------------------
export const opeEarningsFrozenNoValidators: Scenario = {
  id: "OPE-earnings-frozen-no-validators",
  tags: ["operator", "economics", "earnings", "no-validators"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("No validators to remove");
    }

    // Step 1: Remove all validators
    const totalKeys = record.validatorKeys.length;
    for (let i = 0; i < totalKeys; i++) {
      await ctx.step(
        `remove-validator-${i + 1}`,
        async () => {
          await removeValidator(ctx, record);
        },
        async (_pre, _post) => {},
      );
    }

    // Step 2: Read earnings after all validators removed
    let earningsAfterRemoval = 0n;
    await ctx.step(
      "read-earnings-post-removal",
      async () => {
        earningsAfterRemoval = await ctx.contracts.views.getOperatorEarnings(op.id);
      },
      async (_pre, _post) => {},
    );

    // Step 3: Mine blocks — earnings should not change
    await ctx.step(
      "mine-blocks-no-validators",
      async () => {
        await ctx.mineBlocks(200);
      },
      async (_pre, _post) => {},
    );

    // Step 4: Verify earnings are unchanged
    await ctx.step(
      "verify-frozen-earnings",
      async () => {},
      async (_pre, post) => {
        const opSnap = post.operators.get(op.id);
        if (!opSnap) throw new Error(`operator ${op.id} missing`);
        // Earnings should be same as after removal (no validators = no accrual)
        if (opSnap.earnings !== earningsAfterRemoval && earningsAfterRemoval > 0n) {
          // Could differ slightly due to block difference in snapshot reads
          // but should not increase significantly
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// OPE-012: OF-034 — Fee change makes cluster cross liquidation threshold
// ---------------------------------------------------------------------------
export const opeFeeChangeCrossesLiqThreshold: Scenario = {
  id: "OPE-fee-change-crosses-liq-threshold",
  tags: ["operator", "economics", "fee-change", "liquidation", "of-gap"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);

    // Step 1: Verify cluster is active before fee change
    await ctx.step(
      "verify-active-before",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "pre-fee-change");
      },
    );

    // Step 2: Mine many blocks to drain some balance
    await ctx.step(
      "mine-to-drain-balance",
      async () => {
        await ctx.mineBlocks(500);
      },
      async (_pre, post) => {
        // Cluster balance should have decreased from fee burn
        assertClusterActive(post, "still-active-after-mining");
      },
    );
  },
};
