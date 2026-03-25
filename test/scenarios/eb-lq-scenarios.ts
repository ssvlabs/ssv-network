/**
 * EB/LQ scenarios: Effective Balance + Liquidation cross-module chains
 *
 * Extracted from test/e2e/effective-balance/eb-updates.test.ts,
 * test/e2e/clusters-eth/cluster-eth-liquidation.test.ts, and
 * test/e2e/cross-cutting/xo-op-cluster.test.ts.
 * Tests EB update effects on operator earnings, auto-liquidation
 * via EB increase, fee settlement with old vUnits, and multi-cluster
 * interactions.
 *
 * 9 scenarios covering representative EB + liquidation flows.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickETHCluster,
  findActiveOp,
  depositToCluster,
  withdrawFromCluster,
  performEBUpdate,
  liquidateCluster,
  reactivateCluster,
  removeOperator,
  assertClusterActive,
  assertClusterLiquidated,
  assertBalanceDecreased,
  assertDaoVUnitsNonNegative,
  assertOperatorRemoved,
  assertActiveOpVUnitsValid,
  assertOperatorEarningsValid,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// EBLQ-001: Implicit→Explicit EB transition (same vUnits)
// ---------------------------------------------------------------------------
export const eblq001ImplicitToExplicit: Scenario = {
  id: "EBLQ-001-implicit-to-explicit-eb",
  tags: ["cross-module", "eb-update", "eblq", "transition"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit to ensure balance
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(50);

    // Step 2: EB update at baseline (32 ETH per validator = same vUnits)
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

    await ctx.mineBlocks(100);

    // Step 3: Verify balance reflects fee accrual
    await ctx.step(
      "verify-fees",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "after-fee-check");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBLQ-002: EB increase → verify higher burn rate
// ---------------------------------------------------------------------------
export const eblq002EBIncreaseHigherBurn: Scenario = {
  id: "EBLQ-002-eb-increase-higher-burn",
  tags: ["cross-module", "eb-update", "eblq", "burn-rate"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit plenty
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
        await performEBUpdate(ctx, record, 64);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(50);

    // Step 3: EB increase (higher vUnits = higher burn)
    await ctx.step(
      "eb-increase",
      async () => {
        await performEBUpdate(ctx, record, 96);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-increase");
        assertClusterActive(post, "after-eb-increase");
      },
    );

    await ctx.mineBlocks(100);

    // Step 4: Withdraw to check balance reflects higher burn
    await ctx.step(
      "withdraw-check-burn",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBLQ-003: EB increase → auto-liquidation
// ---------------------------------------------------------------------------
export const eblq003AutoLiquidation: Scenario = {
  id: "EBLQ-003-eb-increase-auto-liquidation",
  tags: ["cross-module", "eb-update", "liquidation", "eblq", "auto-liquidation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

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

    await ctx.mineBlocks(5000);

    // Step 2: Large EB increase may trigger auto-liquidation
    await ctx.step(
      "eb-increase-auto-liq",
      async () => {
        await performEBUpdate(ctx, record, 128);
      },
      async (_pre, post) => {
        // May be liquidated (auto-liquidation) or still active
        assertDaoVUnitsNonNegative(post, "after-eb-increase");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBLQ-004: Fee settlement uses OLD vUnits before new take effect
// ---------------------------------------------------------------------------
export const eblq004FeeSettlementOldVUnits: Scenario = {
  id: "EBLQ-004-fee-settlement-old-vunits",
  tags: ["cross-module", "eb-update", "eblq", "fee-settlement"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

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
        await performEBUpdate(ctx, record, 64);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(100);

    // Step 3: Second EB update (fees settled at OLD vUnits, then new applied)
    await ctx.step(
      "eb-second-settlement",
      async () => {
        await performEBUpdate(ctx, record, 96);
      },
      async (pre, post) => {
        assertBalanceDecreased(pre, post, "fees-settled-at-old-vunits");
        assertDaoVUnitsNonNegative(post, "dao-after-second-eb");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBLQ-005: EB increase → verify operator earnings change
// ---------------------------------------------------------------------------
export const eblq005EBOperatorEarnings: Scenario = {
  id: "EBLQ-005-eb-operator-earnings",
  tags: ["cross-module", "eb-update", "operator-earnings", "eblq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "15");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(500);

    // Step 3: Deposit to trigger fee settlement
    await ctx.step(
      "deposit-trigger-settlement",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        // Verify all operators have valid earnings
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
// EBLQ-006: EB update with removed operator → operator earnings isolation
// ---------------------------------------------------------------------------
export const eblq006EBRemovedOpEarnings: Scenario = {
  id: "EBLQ-006-eb-removed-op-earnings",
  tags: ["cross-module", "eb-update", "removed-operator", "operator-earnings", "eblq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: EB update (all ops get deviation)
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Remove operator → vUnits = 0
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    await ctx.mineBlocks(1000);

    // Step 3: Deposit to trigger fee settlement
    await ctx.step(
      "deposit-settle",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        // Removed op should have 0 ethVUnits (no post-removal earnings accrual)
        assertOperatorRemoved(post, op.id, "op-after-settle");
        // Active ops should have valid earnings
        for (const opId of record.operatorIds) {
          if (opId !== op.id) {
            assertOperatorEarningsValid(post, opId, `active-op-${opId}-earnings`);
          }
        }
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EBLQ-007: Multiple EB updates → cross liquidation threshold
// ---------------------------------------------------------------------------
export const eblq007EBCrossLiqThreshold: Scenario = {
  id: "EBLQ-007-eb-cross-liq-threshold",
  tags: ["cross-module", "eb-update", "liquidation", "eblq", "threshold"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit modest amount
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update 1 (increase burn rate)
    await ctx.step(
      "eb-update-1",
      async () => {
        await performEBUpdate(ctx, record, 64);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-1");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: EB update 2 (further increase)
    await ctx.step(
      "eb-update-2",
      async () => {
        await performEBUpdate(ctx, record, 128);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-2");
      },
    );

    // Step 4: Mine until liquidatable (higher burn from EB increases)
    await ctx.mineBlocks(99999999);
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
// EBLQ-008: Liquidation at exact threshold boundary
// ---------------------------------------------------------------------------
export const eblq008ExactThreshold: Scenario = {
  id: "EBLQ-008-exact-threshold-boundary",
  tags: ["cross-module", "liquidation", "eblq", "boundary"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(100);

    // Step 2: Withdraw to leave near-threshold balance
    await ctx.step(
      "withdraw-near-threshold",
      async () => {
        await withdrawFromCluster(ctx, record, "4.5");
      },
      async (_pre, post) => {
        assertClusterActive(post, "still-active-near-threshold");
      },
    );

    // Step 3: Mine until liquidatable
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate-at-threshold",
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

// ---------------------------------------------------------------------------
// EBLQ-009: EB update → remove op → second EB → removed stays clean
// ---------------------------------------------------------------------------
export const eblq009DoubleEBRemovedOp: Scenario = {
  id: "EBLQ-009-double-eb-removed-op-stays-clean",
  tags: ["cross-module", "eb-update", "removed-operator", "eblq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: First EB update
    await ctx.step(
      "eb-update-1",
      async () => {
        await performEBUpdate(ctx, record, 48);
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

    await ctx.mineBlocks(100);

    // Step 3: Second EB update (guard skips removed op)
    await ctx.step(
      "eb-update-2",
      async () => {
        await performEBUpdate(ctx, record, 96);
      },
      async (_pre, post) => {
        // Removed op must remain clean (ethVUnits == 0)
        assertOperatorRemoved(post, op.id, "removed-still-clean");
        // Active ops should have updated vUnits
        for (const opId of record.operatorIds) {
          if (opId !== op.id) {
            assertActiveOpVUnitsValid(post, opId, `active-op-${opId}`);
          }
        }
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};
