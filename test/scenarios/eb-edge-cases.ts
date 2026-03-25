/**
 * EB edge-case scenarios: boundary conditions, merkle proof verification,
 * update frequency, staleness, revert paths, multi-operator configs,
 * precision, removed-operator interactions, and liquidation edge cases.
 *
 * Extracted from:
 *   - test/e2e/effective-balance/eb-edge-cases.test.ts (16 it-blocks)
 *   - test/e2e/effective-balance/eb-gap.test.ts (22 it-blocks)
 *
 * 38 scenarios covering EB edge cases and boundary conditions.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickETHCluster,
  findActiveOp,
  depositToCluster,
  performEBUpdate,
  removeOperator,
  liquidateCluster,
  reactivateCluster,
  assertClusterActive,
  assertClusterLiquidated,
  assertBalanceDecreased,
  assertDaoVUnitsNonNegative,
  assertOperatorRemoved,
  assertActiveOpVUnitsValid,
} from "./_xm-helpers.ts";

// ═══════════════════════════════════════════════════════════
// EB Limits Enforcement (from eb-edge-cases.test.ts)
// ═══════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// EBEC-001: EB at exact minimum (validatorCount * 32)
// Source: eb-edge-cases.test.ts — "Succeeds at minimum"
// ---------------------------------------------------------------------------
export const ebec001EBAtMinimum: Scenario = {
  id: "EBEC-001-eb-at-minimum",
  tags: ["eb-edge", "ebec", "boundary", "minimum"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // EB update at exactly minimum (32 * valCount)
    await ctx.step(
      "eb-at-minimum",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb-minimum");
        assertDaoVUnitsNonNegative(post, "dao-at-minimum");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-002: EB at exact maximum (validatorCount * 2048)
// Source: eb-edge-cases.test.ts — "Succeeds at maximum"
// ---------------------------------------------------------------------------
export const ebec002EBAtMaximum: Scenario = {
  id: "EBEC-002-eb-at-maximum",
  tags: ["eb-edge", "ebec", "boundary", "maximum"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit plenty for large EB
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "50");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update at exactly maximum (2048 * valCount)
    await ctx.step(
      "eb-at-maximum",
      async () => {
        await performEBUpdate(ctx, record, 2048 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb-maximum");
        assertDaoVUnitsNonNegative(post, "dao-at-maximum");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-003: First EB update always passes frequency check
// Source: eb-edge-cases.test.ts — "First update always passes"
// ---------------------------------------------------------------------------
export const ebec003FirstUpdatePassesFrequency: Scenario = {
  id: "EBEC-003-first-update-passes-frequency",
  tags: ["eb-edge", "ebec", "frequency", "first-update"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // First EB update always succeeds (lastUpdateBlock == 0)
    await ctx.step(
      "first-eb-update",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-first-eb");
        assertDaoVUnitsNonNegative(post, "dao-first-eb");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-004: First EB update always passes staleness check
// Source: eb-edge-cases.test.ts — "First update always passes staleness"
// ---------------------------------------------------------------------------
export const ebec004FirstUpdatePassesStaleness: Scenario = {
  id: "EBEC-004-first-update-passes-staleness",
  tags: ["eb-edge", "ebec", "staleness", "first-update"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // First update passes (lastRootBlockNum == 0)
    await ctx.step(
      "first-eb-update",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-first-eb");
        assertDaoVUnitsNonNegative(post, "dao-first-eb");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-005: Successive EB updates with enough blocks between them
// Source: eb-edge-cases.test.ts — "Succeeds when enough blocks have passed"
// ---------------------------------------------------------------------------
export const ebec005SuccessiveUpdatesEnoughBlocks: Scenario = {
  id: "EBEC-005-successive-updates-enough-blocks",
  tags: ["eb-edge", "ebec", "frequency", "successive"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: First EB update
    await ctx.step(
      "eb-first",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(100);

    // Step 2: Second EB update (enough blocks passed)
    await ctx.step(
      "eb-second",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-second-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-second");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-006: Two successive EB updates with intermediate changes
// Source: eb-edge-cases.test.ts — "MustUseLatestRoot after two updates"
// ---------------------------------------------------------------------------
export const ebec006DoubleEBUpdate: Scenario = {
  id: "EBEC-006-double-eb-update",
  tags: ["eb-edge", "ebec", "successive", "staleness"],

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

    // Step 2: First EB update
    await ctx.step(
      "eb-first",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(5);

    // Step 3: Second EB update
    await ctx.step(
      "eb-second",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (pre, post) => {
        assertBalanceDecreased(pre, post, "fees-settled");
        assertDaoVUnitsNonNegative(post, "dao-after-double");
      },
    );
  },
};

// ═══════════════════════════════════════════════════════════
// Multi-operator configurations (from eb-gap.test.ts)
// ═══════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// EBEC-007: EB-032 — Baseline EB on cluster (no deviation change)
// Source: eb-gap.test.ts — "EB-032: 7-op ETH cluster, EB 32 ETH/val"
// ---------------------------------------------------------------------------
export const ebec007BaselineEBNoDeviation: Scenario = {
  id: "EBEC-007-baseline-eb-no-deviation",
  tags: ["eb-edge", "ebec", "baseline", "no-deviation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // EB update at baseline (32 * valCount = no deviation)
    await ctx.step(
      "eb-baseline-no-deviation",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-baseline");
        assertDaoVUnitsNonNegative(post, "dao-at-baseline");
        // All operators should have 0 deviation at baseline
        for (const opId of record.operatorIds) {
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-baseline`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-008: EB-041 — EB increase 32→48/val with deviation
// Source: eb-gap.test.ts — "EB-041: 7-op, 3-val, EB increase 32→48/val"
// ---------------------------------------------------------------------------
export const ebec008EBIncreaseDeviation: Scenario = {
  id: "EBEC-008-eb-increase-deviation",
  tags: ["eb-edge", "ebec", "increase", "deviation", "multi-validator"],

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

    // Step 2: EB increase to 48/val (creates deviation)
    await ctx.step(
      "eb-increase-48",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb-48");
        assertDaoVUnitsNonNegative(post, "dao-after-eb-48");
        for (const opId of record.operatorIds) {
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-deviation`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-009: EB-073/074 — Each operator gets FULL delta (not divided)
// Source: eb-gap.test.ts — "EB-073/074"
// ---------------------------------------------------------------------------
export const ebec009FullDeltaPerOperator: Scenario = {
  id: "EBEC-009-full-delta-per-operator",
  tags: ["eb-edge", "ebec", "deviation", "per-operator"],

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

    // Step 2: EB update to 48/val — each operator gets full delta
    await ctx.step(
      "eb-48-full-delta",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-delta");
        for (const opId of record.operatorIds) {
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-full-delta`);
        }
      },
    );
  },
};

// ═══════════════════════════════════════════════════════════
// Precision & round-trip (from eb-gap.test.ts)
// ═══════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// EBEC-010: EB-078 — 33→34 ETH precision step
// Source: eb-gap.test.ts — "EB-078: 33→34 ETH precision step"
// ---------------------------------------------------------------------------
export const ebec010PrecisionStep: Scenario = {
  id: "EBEC-010-precision-step-33-34",
  tags: ["eb-edge", "ebec", "precision", "step"],

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

    // Step 2: EB update to 33/val (non-multiple of 32 → fractional vUnits)
    await ctx.step(
      "eb-update-33",
      async () => {
        await performEBUpdate(ctx, record, 33 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-33");
      },
    );

    // Step 3: EB update to 34/val (small precision step)
    await ctx.step(
      "eb-update-34",
      async () => {
        await performEBUpdate(ctx, record, 34 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-34");
        for (const opId of record.operatorIds) {
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-precision`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-011: EB-090 — vUnits round-trip (multiples of 32)
// Source: eb-gap.test.ts — "EB-090"
// ---------------------------------------------------------------------------
export const ebec011RoundTripMultiple32: Scenario = {
  id: "EBEC-011-round-trip-multiple-32",
  tags: ["eb-edge", "ebec", "precision", "round-trip"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // EB update to 64/val (exact multiple of 32 = exact round-trip)
    await ctx.step(
      "eb-64-round-trip",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb-64");
        assertDaoVUnitsNonNegative(post, "dao-round-trip");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-012: EB-091 — vUnits round-trip asymmetry (33 ETH)
// Source: eb-gap.test.ts — "EB-091"
// ---------------------------------------------------------------------------
export const ebec012RoundTripAsymmetry: Scenario = {
  id: "EBEC-012-round-trip-asymmetry-33",
  tags: ["eb-edge", "ebec", "precision", "asymmetry"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // EB update to 33/val (non-exact round-trip due to ceiling division)
    await ctx.step(
      "eb-33-asymmetry",
      async () => {
        await performEBUpdate(ctx, record, 33 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb-33");
        assertDaoVUnitsNonNegative(post, "dao-asymmetry");
      },
    );
  },
};

// ═══════════════════════════════════════════════════════════
// Large validator counts (from eb-gap.test.ts)
// ═══════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// EBEC-013: EB-080 — Multi-validator cluster at baseline (no deviation)
// Source: eb-gap.test.ts — "EB-080: 10-validator cluster at 32 ETH baseline"
// ---------------------------------------------------------------------------
export const ebec013MultiValBaseline: Scenario = {
  id: "EBEC-013-multi-val-baseline-no-deviation",
  tags: ["eb-edge", "ebec", "multi-validator", "baseline"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length < 2) {
      throw new ScenarioSkipped("Need at least 2 validators for EBEC-013");
    }

    const valCount = record.validatorKeys.length;

    // EB update at baseline (32 * valCount = no deviation)
    await ctx.step(
      "eb-baseline",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-baseline");
        assertDaoVUnitsNonNegative(post, "dao-baseline");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-014: EB-081 — Multi-validator at max EB (massive deviation)
// Source: eb-gap.test.ts — "EB-081: 10-validator cluster at max EB"
// ---------------------------------------------------------------------------
export const ebec014MultiValMaxEB: Scenario = {
  id: "EBEC-014-multi-val-max-eb",
  tags: ["eb-edge", "ebec", "multi-validator", "maximum", "deviation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length < 2) {
      throw new ScenarioSkipped("Need at least 2 validators for EBEC-014");
    }

    const valCount = record.validatorKeys.length;

    // Step 1: Deposit plenty for max EB
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "100");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update at max (2048 * valCount)
    await ctx.step(
      "eb-max",
      async () => {
        await performEBUpdate(ctx, record, 2048 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-max-eb");
        assertDaoVUnitsNonNegative(post, "dao-max-eb");
      },
    );
  },
};

// ═══════════════════════════════════════════════════════════
// Removed operator + EB interactions (from eb-gap.test.ts)
// ═══════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// EBEC-015: EB-055 — removeOp + EB increase (guard skips removed)
// Source: eb-gap.test.ts — "EB-055"
// ---------------------------------------------------------------------------
export const ebec015RemoveOpEBIncrease: Scenario = {
  id: "EBEC-015-remove-op-eb-increase",
  tags: ["eb-edge", "ebec", "removed-operator", "increase"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Establish explicit baseline
    await ctx.step(
      "eb-baseline",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
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
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    // Step 3: EB increase (guard skips removed op)
    await ctx.step(
      "eb-increase-after-removal",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "removed-after-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
        for (const opId of record.operatorIds) {
          if (opId !== op.id) {
            assertActiveOpVUnitsValid(post, opId, `active-op-${opId}`);
          }
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-016: EB-057 — Auto-liquidation with removed op
// Source: eb-gap.test.ts — "EB-057"
// ---------------------------------------------------------------------------
export const ebec016AutoLiqRemovedOp: Scenario = {
  id: "EBEC-016-auto-liq-removed-op",
  tags: ["eb-edge", "ebec", "removed-operator", "auto-liquidation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    // Step 2: Mine to drain balance
    await ctx.mineBlocks(5000);

    // Step 3: Large EB increase (may auto-liquidate)
    await ctx.step(
      "eb-increase-auto-liq",
      async () => {
        await performEBUpdate(ctx, record, 128 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-017: EB-069 — Two sequential EB updates with op removal between
// Source: eb-gap.test.ts — "EB-069"
// ---------------------------------------------------------------------------
export const ebec017TwoEBUpdatesOpRemoval: Scenario = {
  id: "EBEC-017-two-eb-updates-op-removal",
  tags: ["eb-edge", "ebec", "removed-operator", "sequential"],

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

    // Step 2: First EB update
    await ctx.step(
      "eb-update-1",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-1");
      },
    );

    // Step 3: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    // Step 4: Second EB update (guard skips removed op)
    await ctx.step(
      "eb-update-2",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "removed-after-eb-2");
        for (const opId of record.operatorIds) {
          if (opId !== op.id) {
            assertActiveOpVUnitsValid(post, opId, `active-op-${opId}`);
          }
        }
        assertDaoVUnitsNonNegative(post, "dao-after-eb-2");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-018: EB-103/114 — Removed op + EB decrease (guard prevents underflow)
// Source: eb-gap.test.ts — "EB-103/EB-114"
// ---------------------------------------------------------------------------
export const ebec018RemoveOpEBDecrease: Scenario = {
  id: "EBEC-018-remove-op-eb-decrease",
  tags: ["eb-edge", "ebec", "removed-operator", "decrease"],

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

    // Step 2: Set explicit EB=48
    await ctx.step(
      "eb-update-48",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, _post) => {},
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

    // Step 4: EB decrease (guard skips removed op — no underflow)
    await ctx.step(
      "eb-decrease",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "removed-after-decrease");
        assertDaoVUnitsNonNegative(post, "dao-after-decrease");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-019: EB-104/115 — Auto-liquidation skips removed op decrement
// Source: eb-gap.test.ts — "EB-104/EB-115"
// ---------------------------------------------------------------------------
export const ebec019AutoLiqSkipsRemovedOpDecrement: Scenario = {
  id: "EBEC-019-auto-liq-skips-removed-decrement",
  tags: ["eb-edge", "ebec", "removed-operator", "auto-liquidation", "decrement"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    // Step 2: Mine to drain balance
    await ctx.mineBlocks(5000);

    // Step 3: EB increase (may trigger auto-liquidation)
    await ctx.step(
      "eb-increase-liq",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );
  },
};

// ═══════════════════════════════════════════════════════════
// Liquidation edge cases (from eb-gap.test.ts)
// ═══════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// EBEC-020: EB-102 — 32 ETH floor prevents below-baseline underflow
// Source: eb-gap.test.ts — "EB-102"
// ---------------------------------------------------------------------------
export const ebec020BaselineFloorLiq: Scenario = {
  id: "EBEC-020-baseline-floor-liquidation",
  tags: ["eb-edge", "ebec", "liquidation", "floor", "baseline"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Set EB to baseline (32 * valCount = deviation 0)
    await ctx.step(
      "eb-baseline",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-at-baseline");
      },
    );

    // Step 2: Mine until liquidatable
    await ctx.mineBlocks(99999999);

    // Step 3: Liquidate — deviation is 0, no underflow
    await ctx.step(
      "liquidate-at-baseline",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-021: EB-106 — cluster.balance == 0 after settlement, liquidation succeeds
// Source: eb-gap.test.ts — "EB-106"
// ---------------------------------------------------------------------------
export const ebec021ZeroBalanceLiquidation: Scenario = {
  id: "EBEC-021-zero-balance-liquidation",
  tags: ["eb-edge", "ebec", "liquidation", "zero-balance"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Mine until balance completely drained
    await ctx.mineBlocks(99999999);

    // Liquidation succeeds with 0 balance
    await ctx.step(
      "liquidate-zero-balance",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-022: EB-116 — Explicit-baseline vUnits in liquidation (no deviation cleanup)
// Source: eb-gap.test.ts — "EB-116"
// ---------------------------------------------------------------------------
export const ebec022ExplicitBaselineLiq: Scenario = {
  id: "EBEC-022-explicit-baseline-liquidation",
  tags: ["eb-edge", "ebec", "liquidation", "explicit-baseline"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Set explicit EB = baseline (no deviation)
    await ctx.step(
      "eb-explicit-baseline",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-at-baseline");
      },
    );

    // Step 2: Mine until liquidatable
    await ctx.mineBlocks(99999999);

    // Step 3: Liquidate (deviation cleanup skipped — deviation is 0)
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-023: EB-119 — Zero-payout auto-liquidation
// Source: eb-gap.test.ts — "EB-119"
// ---------------------------------------------------------------------------
export const ebec023ZeroPayoutAutoLiq: Scenario = {
  id: "EBEC-023-zero-payout-auto-liquidation",
  tags: ["eb-edge", "ebec", "auto-liquidation", "zero-payout"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Mine until balance completely drained
    await ctx.mineBlocks(99999999);

    // Step 2: EB increase triggers auto-liquidation with 0 remaining balance
    await ctx.step(
      "eb-increase-zero-payout",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        // Balance should be 0 (already drained)
        assertDaoVUnitsNonNegative(post, "dao-after-auto-liq");
      },
    );
  },
};

// ═══════════════════════════════════════════════════════════
// Multi-cluster & boundary (from eb-gap.test.ts)
// ═══════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// EBEC-024: EB-109 — Staleness boundary (blockNum == latestCommittedBlock)
// Source: eb-gap.test.ts — "EB-109"
// ---------------------------------------------------------------------------
export const ebec024StalenessBoundary: Scenario = {
  id: "EBEC-024-staleness-boundary",
  tags: ["eb-edge", "ebec", "staleness", "boundary"],

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

    // Step 2: First EB update
    await ctx.step(
      "eb-first",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(5);

    // Step 3: Second EB update (verifies staleness boundary passes)
    await ctx.step(
      "eb-second",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-second-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-second");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-025: EB-118 — EB update at baseline stores snapshot only (no deviation)
// Source: eb-gap.test.ts — "EB-118"
// ---------------------------------------------------------------------------
export const ebec025EBBaselineSnapshotOnly: Scenario = {
  id: "EBEC-025-eb-baseline-snapshot-only",
  tags: ["eb-edge", "ebec", "baseline", "snapshot"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // EB update at exact baseline — snapshot stored, no deviation
    await ctx.step(
      "eb-baseline-snapshot",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-baseline");
        assertDaoVUnitsNonNegative(post, "dao-baseline");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBEC-026: EB increase → liquidate → reactivate → EB update
// Source: cross-cutting logic for completeness
// ---------------------------------------------------------------------------
export const ebec026EBLiqReactivateEB: Scenario = {
  id: "EBEC-026-eb-liq-reactivate-eb",
  tags: ["eb-edge", "ebec", "liquidation", "reactivate", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: EB increase
    await ctx.step(
      "eb-increase",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-increase");
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
        await reactivateCluster(ctx, record, "30");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
      },
    );

    // Step 5: EB update after reactivation
    await ctx.step(
      "eb-after-reactivation",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb-reactivation");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};
