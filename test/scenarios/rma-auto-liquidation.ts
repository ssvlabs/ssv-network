/**
 * RMA scenarios: removeOperator → auto-liquidation compound path
 *
 * Tests the compound path: updateClusterBalance() → _updateOperatorVUnits()
 * → _liquidateAfterEBUpdateIfNeeded() with removed operators.
 *
 * When an EB update changes vUnits such that the cluster becomes
 * underfunded, _liquidateAfterEBUpdateIfNeeded is called internally.
 * BUG-21: all three code paths (vUnits update, deviation cleanup,
 * liquidation) must skip removed operators.
 *
 * 5 scenarios covering basic auto-liq, EB increase auto-liq,
 * multi-op, vUnits verification, and EB decrease auto-liq.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  findActiveClusterOperator,
  findSecondActiveClusterOperator,
  removeOperator,
  performEBUpdate,
  assertRemovedOpInvariant,
  assertDaoVUnitsNonNegative,
} from "./_rm-helpers.ts";

// ---------------------------------------------------------------------------
// RMA-001: Remove op → mine until low balance → EB increase → auto-liquidation
// ---------------------------------------------------------------------------
export const rmaBasicAutoLiquidation: Scenario = {
  id: "RMA-basic-auto-liquidation",
  tags: ["removed-operator", "auto-liquidation", "bug-21", "rma"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: Remove operator
    await ctx.step(
      "removeOperator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-removal");
      },
    );

    // Mine blocks to drain balance close to threshold
    await ctx.mineBlocks(99999999);

    // Step 2: EB increase that may trigger auto-liquidation
    // If balance is already below threshold, updateClusterBalance will
    // auto-liquidate the cluster.
    await ctx.step(
      "eb-update-trigger-auto-liq",
      async () => {
        await performEBUpdate(ctx, record, 96);
      },
      async (_pre, post) => {
        // Whether auto-liquidated or not, removed op must have ethVUnits == 0
        assertRemovedOpInvariant(post, op.id, "after-auto-liq-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-auto-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RMA-002: Explicit EB → remove op → EB increase → auto-liquidation
// ---------------------------------------------------------------------------
export const rmaExplicitEBAutoLiq: Scenario = {
  id: "RMA-explicit-eb-auto-liquidation",
  tags: ["removed-operator", "auto-liquidation", "bug-21", "rma", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: Set explicit EB to create deviation
    await ctx.step(
      "eb-update-baseline",
      async () => {
        await performEBUpdate(ctx, record, 48);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Remove operator
    await ctx.step(
      "removeOperator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-removal");
      },
    );

    // Drain balance
    await ctx.mineBlocks(99999999);

    // Step 3: Large EB increase → higher burn rate → auto-liquidation likely
    await ctx.step(
      "eb-update-high-auto-liq",
      async () => {
        await performEBUpdate(ctx, record, 128);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-explicit-auto-liq");
        assertDaoVUnitsNonNegative(post, "dao-after-explicit-auto-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RMA-003: Remove 2 ops → mine → EB increase → auto-liquidation
// ---------------------------------------------------------------------------
export const rmaMultiOpAutoLiq: Scenario = {
  id: "RMA-multi-op-auto-liquidation",
  tags: ["removed-operator", "auto-liquidation", "bug-21", "rma", "multi-op"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op1 = findActiveClusterOperator(ctx, record);
    const op2 = findSecondActiveClusterOperator(ctx, record, op1.id);

    // Remove both operators
    await ctx.step(
      "removeOperator-1",
      async () => {
        await removeOperator(ctx, op1);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op1.id, "after-removal-op1");
      },
    );

    await ctx.step(
      "removeOperator-2",
      async () => {
        await removeOperator(ctx, op2);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op2.id, "after-removal-op2");
      },
    );

    // Drain
    await ctx.mineBlocks(99999999);

    // EB increase with 2 removed ops → compound path
    await ctx.step(
      "eb-update-multi-auto-liq",
      async () => {
        await performEBUpdate(ctx, record, 96);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op1.id, "op1-after-auto-liq");
        assertRemovedOpInvariant(post, op2.id, "op2-after-auto-liq");
        assertDaoVUnitsNonNegative(post, "dao-after-multi-auto-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RMA-004: Remove op → EB update → mine → second EB update → auto-liq
// ---------------------------------------------------------------------------
export const rmaSequentialEBAutoLiq: Scenario = {
  id: "RMA-sequential-eb-auto-liquidation",
  tags: ["removed-operator", "auto-liquidation", "bug-21", "rma"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: Remove operator
    await ctx.step(
      "removeOperator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-removal");
      },
    );

    // Step 2: First EB update (normal)
    await ctx.step(
      "eb-update-1",
      async () => {
        await performEBUpdate(ctx, record, 48);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-eb-1");
      },
    );

    // Drain balance significantly
    await ctx.mineBlocks(99999999);

    // Step 3: Second EB update with much higher value → auto-liq path
    await ctx.step(
      "eb-update-2-auto-liq",
      async () => {
        await performEBUpdate(ctx, record, 128);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-sequential-auto-liq");
        assertDaoVUnitsNonNegative(post, "dao-after-sequential-auto-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RMA-005: Remove op → EB decrease → mine → auto-liq path (low balance)
// ---------------------------------------------------------------------------
export const rmaEBDecreaseAutoLiq: Scenario = {
  id: "RMA-eb-decrease-auto-liquidation",
  tags: ["removed-operator", "auto-liquidation", "bug-21", "rma", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: Set high EB first
    await ctx.step(
      "eb-update-high",
      async () => {
        await performEBUpdate(ctx, record, 128);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Remove operator
    await ctx.step(
      "removeOperator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-removal");
      },
    );

    // Drain most of balance
    await ctx.mineBlocks(99999999);

    // Step 3: EB "decrease" to a still-high value. The lower EB reduces burn
    // but if balance is already depleted, auto-liq still triggers.
    await ctx.step(
      "eb-update-decrease-auto-liq",
      async () => {
        await performEBUpdate(ctx, record, 64);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-eb-decrease-auto-liq");
        assertDaoVUnitsNonNegative(post, "dao-after-eb-decrease-auto-liq");
      },
    );
  },
};
