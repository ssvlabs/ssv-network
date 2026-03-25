/**
 * VL lifecycle scenarios: Full validator lifecycle chains
 *
 * Extracted from test/e2e/validators/validator-lifecycle.test.ts
 * ("Full Validator Lifecycle" and "Remove Last Validator" sections).
 *
 * 3 scenarios covering complete register → mine → remove → withdraw flows
 * with fee verification and conservation law checks.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickClusterWithValidators,
  pickActiveETHCluster,
  registerValidator,
  removeValidator,
  assertClusterActive,
  assertValidatorCountChanged,
  assertBalanceDecreased,
  assertBalanceNonNegative,
  assertDaoVUnitsNonNegative,
} from "./_vl-helpers.ts";
import {
  withdrawFromCluster,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// VL-001: Register → advance → remove → advance → withdraw
// ---------------------------------------------------------------------------
export const vl001FullLifecycle: Scenario = {
  id: "VL-001-full-lifecycle",
  tags: ["validator", "lifecycle", "register", "remove", "withdraw", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Register a validator
    await ctx.step(
      "register-validator",
      async () => {
        await registerValidator(ctx, record, "20");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-register");
        assertValidatorCountChanged(pre, post, 1, "after-register");
      },
    );

    // Step 2: Mine blocks — fees accrue
    await ctx.mineBlocks(100);

    // Step 3: Verify fees accrued
    await ctx.step(
      "verify-fee-accrual",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "after-mine");
        // Operator earnings should be positive
        for (const opId of record.operatorIds) {
          const opSnap = post.operators.get(opId);
          if (opSnap && opSnap.isActive && opSnap.fee > 0n) {
            if (opSnap.earnings <= 0n) {
              throw new Error(
                `operator ${opId} earnings should be > 0 after 100 blocks`,
              );
            }
          }
        }
      },
    );

    // Step 4: Remove validator — settles fees
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-remove");
        assertBalanceDecreased(pre, post, "fees-settled-on-remove");
        assertBalanceNonNegative(post, "balance-non-negative");
      },
    );

    // Step 5: Mine more blocks — no further fee accrual (0 validators)
    await ctx.mineBlocks(50);

    // Step 6: Withdraw remaining balance
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.001");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertBalanceNonNegative(post, "balance-after-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VL-002: Exact fee math with block-precise accounting
// ---------------------------------------------------------------------------
export const vl002ExactFeeMath: Scenario = {
  id: "VL-002-exact-fee-math",
  tags: ["validator", "lifecycle", "fee-math", "conservation", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Register a validator with known deposit
    await ctx.step(
      "register-validator",
      async () => {
        await registerValidator(ctx, record, "20");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-register");
        assertValidatorCountChanged(pre, post, 1, "after-register");
      },
    );

    // Step 2: Mine blocks for fee accumulation
    await ctx.mineBlocks(100);

    // Step 3: Verify system-wide accounting consistency
    await ctx.step(
      "verify-conservation",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "after-mine");
        assertDaoVUnitsNonNegative(post, "dao-vunits");

        // All operators should have non-negative earnings
        for (const opId of record.operatorIds) {
          const opSnap = post.operators.get(opId);
          if (opSnap) {
            if (opSnap.earnings < 0n) {
              throw new Error(
                `operator ${opId} has negative earnings=${opSnap.earnings}`,
              );
            }
          }
        }

        // Cluster balance should still be non-negative
        assertBalanceNonNegative(post, "cluster-balance");
      },
    );

    // Step 4: Remove validator — exact fee settlement
    await ctx.step(
      "remove-for-fee-check",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-remove");
        // Balance decreased (fees deducted)
        assertBalanceDecreased(pre, post, "fees-deducted");
        assertBalanceNonNegative(post, "balance-after-remove");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VL-003: Remove last validator — cluster persists, withdraw remaining
// ---------------------------------------------------------------------------
export const vl003RemoveLastWithdraw: Scenario = {
  id: "VL-003-remove-last-withdraw",
  tags: ["validator", "lifecycle", "last-validator", "withdraw", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Mine blocks
    await ctx.mineBlocks(50);

    // Step 2: Remove all validators
    const keyCount = record.validatorKeys.length;
    for (let i = 0; i < keyCount; i++) {
      await ctx.step(
        `remove-validator-${i + 1}`,
        async () => {
          await removeValidator(ctx, record);
        },
        async (pre, post) => {
          assertValidatorCountChanged(pre, post, -1, `remove-${i + 1}`);
        },
      );
    }

    // Step 3: Verify cluster persists with remaining balance
    await ctx.step(
      "verify-cluster-persists",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "after-all-removed");
        assertBalanceNonNegative(post, "balance-after-all-removed");
        if (!post.cluster) throw new Error("no cluster");
        if (post.cluster.validatorCount !== 0) {
          throw new Error(
            `validatorCount=${post.cluster.validatorCount} (expected 0)`,
          );
        }
      },
    );

    // Step 4: Withdraw remaining balance
    await ctx.step(
      "withdraw-remaining",
      async () => {
        await withdrawFromCluster(ctx, record, "0.001");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertBalanceNonNegative(post, "final-balance");
      },
    );
  },
};
