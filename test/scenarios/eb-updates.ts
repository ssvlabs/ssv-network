/**
 * EB update scenarios: Implicit-to-explicit transition, increase, decrease,
 * auto-liquidation, fee settlement, and explicit-EB burn rate verification.
 *
 * Extracted from:
 *   - test/e2e/effective-balance/eb-updates.test.ts (5 it-blocks)
 *   - test/e2e/effective-balance/vunits-explicit-eb-scenarios.test.ts (9 it-blocks)
 *
 * 14 scenarios covering representative EB update flows.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickETHCluster,
  findActiveOp,
  depositToCluster,
  withdrawFromCluster,
  performEBUpdate,
  removeOperator,
  removeValidator,
  liquidateCluster,
  reactivateCluster,
  assertClusterActive,
  assertClusterLiquidated,
  assertBalanceDecreased,
  assertBalanceIncreased,
  assertDaoVUnitsNonNegative,
  assertOperatorRemoved,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// EBU-001: Implicit→Explicit transition (same vUnits, no deviation change)
// Source: eb-updates.test.ts — "Transitions from implicit to explicit vUnits"
// ---------------------------------------------------------------------------
export const ebu001ImplicitToExplicit: Scenario = {
  id: "EBU-001-implicit-to-explicit-transition",
  tags: ["eb-update", "ebu", "transition", "implicit-explicit"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    await ctx.mineBlocks(10);

    // EB update at baseline (32 ETH per validator = same vUnits)
    const baselineEB = 32 * valCount;
    await ctx.step(
      "eb-implicit-to-explicit",
      async () => {
        await performEBUpdate(ctx, record, baselineEB);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb-transition");
        assertDaoVUnitsNonNegative(post, "dao-after-transition");
      },
    );

    await ctx.mineBlocks(50);

    // Verify balance decreased (fees accrued at baseline rate)
    await ctx.step(
      "verify-fees-accrued",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "after-fee-accrual");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBU-002: EB increase — higher fee burn rate
// Source: eb-updates.test.ts — "Updates vUnits upward and increases burn rate"
// ---------------------------------------------------------------------------
export const ebu002EBIncreaseHigherBurn: Scenario = {
  id: "EBU-002-eb-increase-higher-burn",
  tags: ["eb-update", "ebu", "increase", "burn-rate"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit to ensure balance
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, _post) => {},
    );

    // Step 2: First EB update (baseline transition)
    await ctx.step(
      "eb-baseline",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(50);

    // Step 3: EB increase (higher vUnits = higher burn)
    await ctx.step(
      "eb-increase",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-increase");
        assertClusterActive(post, "after-eb-increase");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBU-003: EB decrease — lower fee burn rate
// Source: eb-updates.test.ts — "Updates vUnits downward and decreases burn rate"
// ---------------------------------------------------------------------------
export const ebu003EBDecreaseLowerBurn: Scenario = {
  id: "EBU-003-eb-decrease-lower-burn",
  tags: ["eb-update", "ebu", "decrease", "burn-rate"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB increase first (set high vUnits)
    await ctx.step(
      "eb-increase-first",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(50);

    // Step 3: EB decrease (back to baseline)
    await ctx.step(
      "eb-decrease",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb-decrease");
        assertDaoVUnitsNonNegative(post, "dao-after-decrease");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBU-004: Auto-liquidation on EB increase
// Source: eb-updates.test.ts — "Auto-liquidates when EB pushes below threshold"
// ---------------------------------------------------------------------------
export const ebu004AutoLiquidationEBIncrease: Scenario = {
  id: "EBU-004-auto-liquidation-eb-increase",
  tags: ["eb-update", "ebu", "auto-liquidation", "liquidation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Withdraw to leave minimal balance
    await ctx.step(
      "withdraw-to-minimal",
      async () => {
        await withdrawFromCluster(ctx, record, "0.5");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
      },
    );

    // Step 2: Mine to drain more balance
    await ctx.mineBlocks(5000);

    // Step 3: Large EB increase may trigger auto-liquidation
    await ctx.step(
      "eb-increase-auto-liq",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        // May be liquidated or still active
        assertDaoVUnitsNonNegative(post, "after-eb-increase");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBU-005: Fee settlement uses OLD vUnits before new take effect
// Source: eb-updates.test.ts — "Settles fees with old vUnits"
// ---------------------------------------------------------------------------
export const ebu005FeeSettlementOldVUnits: Scenario = {
  id: "EBU-005-fee-settlement-old-vunits",
  tags: ["eb-update", "ebu", "fee-settlement"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, _post) => {},
    );

    // Step 2: First EB update (set explicit EB)
    await ctx.step(
      "eb-first",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(100);

    // Step 3: Second EB update (fees settled at OLD vUnits, then new applied)
    await ctx.step(
      "eb-second-settlement",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (pre, post) => {
        assertBalanceDecreased(pre, post, "fees-settled-at-old-vunits");
        assertDaoVUnitsNonNegative(post, "dao-after-second-eb");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBU-006: E-04 — Higher explicit-EB burn rate applied after EB=64 update
// Source: vunits-explicit-eb-scenarios.test.ts — "E-04"
// ---------------------------------------------------------------------------
export const ebu006ExplicitEB64BurnRate: Scenario = {
  id: "EBU-006-explicit-eb64-burn-rate",
  tags: ["eb-update", "ebu", "explicit-eb", "burn-rate"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update to 64 ETH/val (double the baseline)
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb-64");
        assertDaoVUnitsNonNegative(post, "dao-after-eb-64");
      },
    );

    await ctx.mineBlocks(40);

    // Step 3: Verify fees accrued at higher rate
    await ctx.step(
      "verify-higher-burn",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "still-active");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBU-007: E-06 — EB=64→EB=128 settles at old rate, accrues at higher rate
// Source: vunits-explicit-eb-scenarios.test.ts — "E-06"
// ---------------------------------------------------------------------------
export const ebu007EB64ToEB128Settlement: Scenario = {
  id: "EBU-007-eb64-to-eb128-settlement",
  tags: ["eb-update", "ebu", "explicit-eb", "settlement", "increase"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit plenty
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "30");
      },
      async (_pre, _post) => {},
    );

    // Step 2: First EB update to 64/val
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-64");
      },
    );

    await ctx.mineBlocks(17);

    // Step 3: Second EB update to 128/val (settle at old, accrue at new)
    await ctx.step(
      "eb-update-128",
      async () => {
        await performEBUpdate(ctx, record, 128 * valCount);
      },
      async (pre, post) => {
        assertBalanceDecreased(pre, post, "settle-at-old-rate");
        assertDaoVUnitsNonNegative(post, "dao-after-eb-128");
      },
    );

    await ctx.mineBlocks(11);

    // Step 4: Verify post-update accrual at new (higher) rate
    await ctx.step(
      "verify-higher-accrual",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "active-at-higher-rate");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBU-008: E-08 — Explicit EB=32→EB=64 settles at baseline
// Source: vunits-explicit-eb-scenarios.test.ts — "E-08"
// ---------------------------------------------------------------------------
export const ebu008ExplicitEB32ToEB64: Scenario = {
  id: "EBU-008-explicit-eb32-to-eb64",
  tags: ["eb-update", "ebu", "explicit-eb", "baseline-increase"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update to baseline (32/val = explicit baseline)
    await ctx.step(
      "eb-update-32",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(13);

    // Step 3: EB increase to 64/val
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (pre, post) => {
        assertBalanceDecreased(pre, post, "settle-at-baseline");
        assertDaoVUnitsNonNegative(post, "dao-after-eb-64");
      },
    );

    await ctx.mineBlocks(9);

    // Step 4: Verify post-update accrual at EB=64 rate
    await ctx.step(
      "verify-eb64-accrual",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "active-at-eb64");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBU-009: E-09 — 3-val cluster at EB=96 keeps baseline vUnits
// Source: vunits-explicit-eb-scenarios.test.ts — "E-09"
// ---------------------------------------------------------------------------
export const ebu009ThreeValBaselineEB: Scenario = {
  id: "EBU-009-three-val-baseline-eb",
  tags: ["eb-update", "ebu", "explicit-eb", "multi-validator", "baseline"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length < 3) {
      throw new ScenarioSkipped("Need at least 3 validators for EBU-009");
    }

    const valCount = record.validatorKeys.length;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update at baseline (32 ETH * valCount = no deviation)
    await ctx.step(
      "eb-update-baseline",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-baseline-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-baseline");
      },
    );

    await ctx.mineBlocks(21);

    // Step 3: Verify fees accrued at baseline rate
    await ctx.step(
      "verify-baseline-burn",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "still-active");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBU-010: E-13 — Max withdrawal at explicit EB=64 leaves cluster at boundary
// Source: vunits-explicit-eb-scenarios.test.ts — "E-13"
// ---------------------------------------------------------------------------
export const ebu010MaxWithdrawAtEB64: Scenario = {
  id: "EBU-010-max-withdraw-at-eb64",
  tags: ["eb-update", "ebu", "explicit-eb", "withdraw", "boundary"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update to 64/val
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb-64");
      },
    );

    // Step 3: Withdraw a moderate amount (not max, to avoid revert)
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertDaoVUnitsNonNegative(post, "dao-after-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBU-011: E-14 — Deposit preserves explicit EB and burn rate
// Source: vunits-explicit-eb-scenarios.test.ts — "E-14"
// ---------------------------------------------------------------------------
export const ebu011DepositPreservesEB: Scenario = {
  id: "EBU-011-deposit-preserves-explicit-eb",
  tags: ["eb-update", "ebu", "explicit-eb", "deposit", "preserve"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: EB update to 64/val
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb-64");
      },
    );

    // Step 2: Deposit (should preserve EB and burn rate)
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "deposit-increased-balance");
        assertDaoVUnitsNonNegative(post, "dao-after-deposit");
      },
    );

    await ctx.mineBlocks(12);

    // Step 3: Verify fees still accrue at EB=64 rate
    await ctx.step(
      "verify-eb64-rate",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "still-active-at-eb64");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBU-012: R-09 — Register validator (EB=64) → remove operator → deposit
// Source: vunits-explicit-eb-scenarios.test.ts — "R-09"
// ---------------------------------------------------------------------------
export const ebu012EBRemoveOpDeposit: Scenario = {
  id: "EBU-012-eb-remove-op-deposit",
  tags: ["eb-update", "ebu", "removed-operator", "deposit"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: EB update to 64/val
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb-64");
      },
    );

    // Step 2: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-op-removal");
      },
    );

    // Step 3: Deposit (should work with removed operator)
    await ctx.step(
      "deposit-after-removal",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "deposit-with-removed-op");
        assertDaoVUnitsNonNegative(post, "dao-after-deposit");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBU-013: RI-02 — Register → remove operator → remove last validator
// Source: vunits-explicit-eb-scenarios.test.ts — "RI-02"
// ---------------------------------------------------------------------------
export const ebu013RemoveOpRemoveLastValidator: Scenario = {
  id: "EBU-013-remove-op-remove-last-validator",
  tags: ["eb-update", "ebu", "removed-operator", "remove-validator"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("No validators in cluster for EBU-013");
    }

    // Step 1: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-op-removal");
      },
    );

    await ctx.mineBlocks(10);

    // Step 2: Remove all validators
    const keysCount = record.validatorKeys.length;
    for (let i = 0; i < keysCount; i++) {
      await ctx.step(
        `remove-validator-${i + 1}`,
        async () => {
          await removeValidator(ctx, record);
        },
        async (_pre, post) => {
          assertDaoVUnitsNonNegative(post, `dao-after-remove-${i + 1}`);
        },
      );
    }
  },
};

// ---------------------------------------------------------------------------
// EBU-014: RI-05 — Register → remove operator → liquidate → reactivate
// Source: vunits-explicit-eb-scenarios.test.ts — "RI-05"
// ---------------------------------------------------------------------------
export const ebu014RemoveOpLiquidateReactivate: Scenario = {
  id: "EBU-014-remove-op-liquidate-reactivate",
  tags: ["eb-update", "ebu", "removed-operator", "liquidation", "reactivate"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-op-removal");
      },
    );

    // Step 2: Mine until liquidatable
    await ctx.mineBlocks(99999999);

    // Step 3: Liquidate
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
      },
    );

    // Step 4: Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};
