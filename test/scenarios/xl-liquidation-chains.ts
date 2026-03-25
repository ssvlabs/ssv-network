/**
 * XL scenarios: Liquidation + Reactivation cross-module chains
 *
 * Extracted from test/e2e/cross-cutting/xl-lq-chains.test.ts.
 * Tests multi-step chains combining deposit, EB updates, liquidation,
 * reactivation, and operator removal to verify state consistency
 * across liquidation cycles.
 *
 * 10 scenarios covering representative liquidation chain flows.
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
  assertDaoVUnitsNonNegative,
  assertOperatorRemoved,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// XL-001: EB 48 → liquidate → reactivate → EB 64 (full cycle)
// ---------------------------------------------------------------------------
export const xl001FullCycleEB: Scenario = {
  id: "XL-001-full-cycle-eb-liq-react",
  tags: ["cross-module", "liquidation", "reactivation", "eb-update", "xl", "full-lifecycle"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: EB update to 48 ETH (deviation created)
    await ctx.step(
      "eb-update-48",
      async () => {
        await performEBUpdate(ctx, record, 48 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-48");
        assertClusterActive(post, "after-eb-48");
      },
    );

    // Step 2: Drain and liquidate
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

    // Step 3: Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertDaoVUnitsNonNegative(post, "dao-after-reactivation");
      },
    );

    await ctx.mineBlocks(50);

    // Step 4: EB update to 64 ETH (new deviation)
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-64");
        assertClusterActive(post, "after-eb-64");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XL-002: EB decrease after reactivation — 64→48
// ---------------------------------------------------------------------------
export const xl002EBDecreaseAfterReactivation: Scenario = {
  id: "XL-002-eb-decrease-after-reactivation",
  tags: ["cross-module", "liquidation", "reactivation", "eb-update", "xl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: EB increase
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-64");
      },
    );

    // Step 2: Drain and liquidate
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

    // Step 3: Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
      },
    );

    await ctx.mineBlocks(50);

    // Step 4: EB decrease to 48 (lower deviation)
    await ctx.step(
      "eb-decrease-48",
      async () => {
        await performEBUpdate(ctx, record, 48 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-decrease");
        assertClusterActive(post, "after-eb-decrease");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XL-003: Implicit EB — liquidate → reactivate (no deviation)
// ---------------------------------------------------------------------------
export const xl003ImplicitEBLiqReact: Scenario = {
  id: "XL-003-implicit-eb-liq-react",
  tags: ["cross-module", "liquidation", "reactivation", "xl", "implicit-eb"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Drain and liquidate (implicit EB, no deviation)
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

    // Step 2: Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertDaoVUnitsNonNegative(post, "dao-after-reactivation");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Deposit to verify functional
    await ctx.step(
      "deposit-after-react",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-deposit");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XL-004: EB → remove operator → liquidate (guard skips removed op)
// ---------------------------------------------------------------------------
export const xl004EBRemoveOpLiquidate: Scenario = {
  id: "XL-004-eb-remove-op-liquidate",
  tags: ["cross-module", "liquidation", "removed-operator", "eb-update", "xl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
      },
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

    // Step 3: Liquidate (guard skips removed op in cleanup)
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
        assertOperatorRemoved(post, op.id, "op-after-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XL-005: EB → remove op → liquidate → reactivate (full path with guard)
// ---------------------------------------------------------------------------
export const xl005EBRemoveOpLiqReact: Scenario = {
  id: "XL-005-eb-remove-op-liq-react",
  tags: ["cross-module", "liquidation", "reactivation", "removed-operator", "eb-update", "xl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * record.validatorKeys.length);
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

    // Step 3: Liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
        assertOperatorRemoved(post, op.id, "op-after-liq");
      },
    );

    // Step 4: Reactivate (guard restores active ops only)
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertOperatorRemoved(post, op.id, "op-after-react");
        assertDaoVUnitsNonNegative(post, "dao-after-react");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XL-006: Double liquidation-reactivation cycle with EB
// ---------------------------------------------------------------------------
export const xl006DoubleLiqReactCycle: Scenario = {
  id: "XL-006-double-liq-react-cycle",
  tags: ["cross-module", "liquidation", "reactivation", "eb-update", "xl", "double-cycle"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * record.validatorKeys.length);
      },
      async (_pre, _post) => {},
    );

    // Cycle 1: Liquidate → Reactivate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate-1",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq-1");
      },
    );

    await ctx.step(
      "reactivate-1",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-react-1");
        assertDaoVUnitsNonNegative(post, "dao-after-react-1");
      },
    );

    // Cycle 2: Liquidate → Reactivate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate-2",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq-2");
      },
    );

    await ctx.step(
      "reactivate-2",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-react-2");
        assertDaoVUnitsNonNegative(post, "dao-after-react-2");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XL-007: Triple liq/react cycle with EB changes between cycles
// ---------------------------------------------------------------------------
export const xl007TripleCycleEBChanges: Scenario = {
  id: "XL-007-triple-cycle-eb-changes",
  tags: ["cross-module", "liquidation", "reactivation", "eb-update", "xl", "stress"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Cycle 1: EB 48 → liq → react
    await ctx.step(
      "eb-48",
      async () => {
        await performEBUpdate(ctx, record, 48 * record.validatorKeys.length);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liq-1",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq-1");
      },
    );
    await ctx.step(
      "react-1",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-react-1");
      },
    );

    // Cycle 2: EB 64 → liq → react
    await ctx.step(
      "eb-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liq-2",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq-2");
      },
    );
    await ctx.step(
      "react-2",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-react-2");
      },
    );

    // Cycle 3: EB 96 → liq → react
    await ctx.step(
      "eb-96",
      async () => {
        await performEBUpdate(ctx, record, 96 * record.validatorKeys.length);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liq-3",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq-3");
      },
    );
    await ctx.step(
      "react-3",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-react-3");
        assertDaoVUnitsNonNegative(post, "dao-after-triple");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XL-008: Liquidate → remove operator → reactivate (implicit EB)
// ---------------------------------------------------------------------------
export const xl008LiqRemoveOpReact: Scenario = {
  id: "XL-008-liq-remove-op-react",
  tags: ["cross-module", "liquidation", "reactivation", "removed-operator", "xl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Drain and liquidate
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

    // Step 2: Remove operator while liquidated
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    // Step 3: Reactivate with removed op
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertOperatorRemoved(post, op.id, "op-after-react");
        assertDaoVUnitsNonNegative(post, "dao-after-react");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XL-009: Deposit → withdraw to near threshold → liquidate → reactivate
// ---------------------------------------------------------------------------
export const xl009WithdrawToThresholdLiq: Scenario = {
  id: "XL-009-withdraw-to-threshold-liq",
  tags: ["cross-module", "liquidation", "reactivation", "withdraw", "xl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(100);

    // Step 2: Withdraw most balance
    await ctx.step(
      "withdraw-most",
      async () => {
        await withdrawFromCluster(ctx, record, "9");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-large-withdraw");
      },
    );

    // Step 3: Mine until liquidatable then liquidate
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

    // Step 4: Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertDaoVUnitsNonNegative(post, "dao-after-react");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XL-010: EB → liquidate → EB on liquidated cluster → reactivate
// ---------------------------------------------------------------------------
export const xl010EBOnLiquidatedCluster: Scenario = {
  id: "XL-010-eb-on-liquidated-cluster",
  tags: ["cross-module", "liquidation", "eb-update", "xl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: EB update
    await ctx.step(
      "eb-update-48",
      async () => {
        await performEBUpdate(ctx, record, 48 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-48");
      },
    );

    // Step 2: Drain and liquidate
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

    // Step 3: EB update on liquidated cluster (allowed)
    await ctx.step(
      "eb-update-on-liquidated",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
      },
      async (_pre, _post) => {
        // Cluster remains inactive
      },
    );

    // Step 4: Reactivate (uses new EB)
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertDaoVUnitsNonNegative(post, "dao-after-react");
      },
    );
  },
};
