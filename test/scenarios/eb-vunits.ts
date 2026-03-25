/**
 * EB vUnits scenarios: operator vUnit tracking across single and
 * multiple clusters, deviation accumulation, and cross-cluster interactions.
 *
 * Extracted from:
 *   - test/e2e/effective-balance/eb-operator-vunits.test.ts (1 it-block)
 *   - test/e2e/effective-balance/eb-gap.test.ts (EB-032..EB-091 vUnit tests)
 *   - test/e2e/effective-balance/vunits-explicit-eb-scenarios.test.ts (E-11)
 *
 * 9 scenarios covering operator vUnit tracking flows.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickETHCluster,
  findActiveOp,
  findSecondActiveOp,
  depositToCluster,
  performEBUpdate,
  removeOperator,
  assertClusterActive,
  assertDaoVUnitsNonNegative,
  assertOperatorRemoved,
  assertActiveOpVUnitsValid,
  assertOperatorEarningsValid,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// EBVU-001: vUnit deviation from single EB increase
// Source: eb-operator-vunits.test.ts — "Accumulates vUnit deviations"
// (single cluster portion)
// ---------------------------------------------------------------------------
export const ebvu001SingleClusterDeviation: Scenario = {
  id: "EBVU-001-single-cluster-deviation",
  tags: ["eb-vunits", "ebvu", "deviation", "single-cluster"],

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

    // Step 2: First EB update (implicit → explicit baseline)
    await ctx.step(
      "eb-baseline",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-baseline");
        for (const opId of record.operatorIds) {
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-baseline`);
        }
      },
    );

    await ctx.mineBlocks(5);

    // Step 3: EB increase (creates deviation)
    await ctx.step(
      "eb-increase-48",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-48");
        for (const opId of record.operatorIds) {
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-deviation`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBVU-002: Progressive deviation across multiple EB updates
// Source: eb-operator-vunits.test.ts — successive updates 64→96
// ---------------------------------------------------------------------------
export const ebvu002ProgressiveDeviation: Scenario = {
  id: "EBVU-002-progressive-deviation",
  tags: ["eb-vunits", "ebvu", "deviation", "progressive"],

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

    // Step 2: First EB update (baseline transition)
    await ctx.step(
      "eb-update-32",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(5);

    // Step 3: EB increase to 48/val
    await ctx.step(
      "eb-update-48",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-48");
      },
    );

    await ctx.mineBlocks(5);

    // Step 4: EB increase to 64/val (further deviation)
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-64");
        for (const opId of record.operatorIds) {
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-progressive`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBVU-003: EB increase then decrease — deviation adjusts both directions
// Source: eb-gap.test.ts — EB increase + decrease patterns
// ---------------------------------------------------------------------------
export const ebvu003IncreaseDecrease: Scenario = {
  id: "EBVU-003-increase-decrease-deviation",
  tags: ["eb-vunits", "ebvu", "deviation", "increase", "decrease"],

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

    // Step 2: EB increase (adds deviation)
    await ctx.step(
      "eb-increase",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-increase");
      },
    );

    await ctx.mineBlocks(10);

    // Step 3: EB decrease back to baseline (removes deviation)
    await ctx.step(
      "eb-decrease",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-decrease");
        for (const opId of record.operatorIds) {
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-after-decrease`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBVU-004: Removed operator vUnits stay at 0 across EB updates
// Source: eb-gap.test.ts — EB-055, EB-069
// ---------------------------------------------------------------------------
export const ebvu004RemovedOpVUnitsStayZero: Scenario = {
  id: "EBVU-004-removed-op-vunits-stay-zero",
  tags: ["eb-vunits", "ebvu", "removed-operator"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update (all ops get deviation)
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
      },
    );

    // Step 3: Remove operator (clears vUnits)
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    // Step 4: EB increase (guard skips removed op — vUnits stays 0)
    await ctx.step(
      "eb-increase-after-removal",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "removed-still-zero");
        for (const opId of record.operatorIds) {
          if (opId !== op.id) {
            assertActiveOpVUnitsValid(post, opId, `live-op-${opId}`);
          }
        }
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBVU-005: Operator earnings reflect EB-based vUnits
// Source: eb-gap.test.ts and eb-operator-vunits.test.ts
// ---------------------------------------------------------------------------
export const ebvu005OperatorEarningsVUnits: Scenario = {
  id: "EBVU-005-operator-earnings-vunits",
  tags: ["eb-vunits", "ebvu", "operator-earnings"],

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

    // Step 2: EB update to 48/val
    await ctx.step(
      "eb-update-48",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(500);

    // Step 3: Deposit to trigger fee settlement
    await ctx.step(
      "deposit-settle-fees",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-earnings`);
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-vunits`);
        }
        assertDaoVUnitsNonNegative(post, "dao-after-settlement");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBVU-006: E-11 — Register second validator after EB=64 adds baseline vUnits
// Source: vunits-explicit-eb-scenarios.test.ts — "E-11"
// ---------------------------------------------------------------------------
export const ebvu006SecondValAfterEB: Scenario = {
  id: "EBVU-006-second-val-after-eb",
  tags: ["eb-vunits", "ebvu", "register-validator", "baseline-addition"],

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

    // Step 2: EB update to 64/val (doubles baseline)
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-64");
        for (const opId of record.operatorIds) {
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-after-eb`);
        }
      },
    );

    await ctx.mineBlocks(14);

    // Step 3: Verify earnings accrued at EB=64 rate
    await ctx.step(
      "verify-eb64-earnings",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "active-at-eb64");
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-earnings`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBVU-007: daoTotalEthVUnits increases with EB increase
// Source: eb-gap.test.ts — EB-041, EB-081 patterns
// ---------------------------------------------------------------------------
export const ebvu007DaoVUnitsIncrease: Scenario = {
  id: "EBVU-007-dao-vunits-increase",
  tags: ["eb-vunits", "ebvu", "dao-vunits", "increase"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "30");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB increase (should increase daoTotalEthVUnits)
    await ctx.step(
      "eb-increase",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-increase");
      },
    );

    await ctx.mineBlocks(50);

    // Step 3: Further EB increase
    await ctx.step(
      "eb-further-increase",
      async () => {
        await performEBUpdate(ctx, record, 96 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-further");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBVU-008: daoTotalEthVUnits decreases with EB decrease
// Source: eb-gap.test.ts — deviation decrease patterns
// ---------------------------------------------------------------------------
export const ebvu008DaoVUnitsDecrease: Scenario = {
  id: "EBVU-008-dao-vunits-decrease",
  tags: ["eb-vunits", "ebvu", "dao-vunits", "decrease"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "30");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB increase first (establish high deviation)
    await ctx.step(
      "eb-increase",
      async () => {
        await performEBUpdate(ctx, record, 96 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-increase");
      },
    );

    await ctx.mineBlocks(10);

    // Step 3: EB decrease (should decrease daoTotalEthVUnits)
    await ctx.step(
      "eb-decrease",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-decrease");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBVU-009: Two operators — one removed, one active — EB update isolation
// Source: eb-gap.test.ts — EB-055 multi-op pattern
// ---------------------------------------------------------------------------
export const ebvu009TwoOpsEBIsolation: Scenario = {
  id: "EBVU-009-two-ops-eb-isolation",
  tags: ["eb-vunits", "ebvu", "removed-operator", "isolation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op1 = findActiveOp(ctx, record);
    const op2 = findSecondActiveOp(ctx, record, op1.id);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update (both ops get deviation)
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertActiveOpVUnitsValid(post, op1.id, "op1-deviation");
        assertActiveOpVUnitsValid(post, op2.id, "op2-deviation");
      },
    );

    // Step 3: Remove op1
    await ctx.step(
      "remove-op1",
      async () => {
        await removeOperator(ctx, op1);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op1.id, "op1-removed");
        assertActiveOpVUnitsValid(post, op2.id, "op2-still-active");
      },
    );

    // Step 4: EB increase (op1 stays 0, op2 gets new deviation)
    await ctx.step(
      "eb-increase",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op1.id, "op1-still-removed");
        assertActiveOpVUnitsValid(post, op2.id, "op2-updated");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};
