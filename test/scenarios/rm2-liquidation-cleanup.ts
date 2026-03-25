/**
 * RM2 scenarios: removeOperator → liquidation (deviation cleanup)
 *
 * Tests that _executeLiquidation correctly skips removed operators
 * when subtracting EB deviations from operatorEthVUnits. BUG-21 would
 * cause uint64 underflow when subtracting from a zeroed mapping entry.
 *
 * 5 scenarios covering basic liquidation, explicit EB, multi-op,
 * daoTotalEthVUnits after liquidation, and large cluster stress.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  findActiveClusterOperator,
  findSecondActiveClusterOperator,
  removeOperator,
  performEBUpdate,
  liquidateCluster,
  assertRemovedOpInvariant,
  assertDaoVUnitsNonNegative,
  assertClusterLiquidated,
} from "./_rm-helpers.ts";

// ---------------------------------------------------------------------------
// RM2-001: Remove op → drain → liquidate → verify removed op ethVUnits == 0
// ---------------------------------------------------------------------------
export const rm2BasicLiquidation: Scenario = {
  id: "RM2-basic-liquidation",
  tags: ["removed-operator", "liquidation", "bug-21", "rm2"],

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

    // Drain the cluster by mining many blocks
    await ctx.mineBlocks(99999999);

    // Step 2: Liquidate
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-liquidation");
        assertClusterLiquidated(post, "liquidation-check");
        assertDaoVUnitsNonNegative(post, "dao-after-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM2-002: Remove op → explicit EB → liquidate → verify deviation cleanup
// ---------------------------------------------------------------------------
export const rm2ExplicitEBLiquidation: Scenario = {
  id: "RM2-explicit-eb-liquidation",
  tags: ["removed-operator", "liquidation", "bug-21", "rm2", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: Set explicit EB (creates deviation)
    await ctx.step(
      "eb-update-baseline",
      async () => {
        await performEBUpdate(ctx, record, 48);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Remove operator (deletes its ethVUnits)
    await ctx.step(
      "removeOperator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-removal-with-deviation");
      },
    );

    // Drain cluster
    await ctx.mineBlocks(99999999);

    // Step 3: Liquidate — deviation cleanup must skip removed op
    await ctx.step(
      "liquidate-with-deviation",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-deviation-liq");
        assertClusterLiquidated(post, "liq-check");
        assertDaoVUnitsNonNegative(post, "dao-after-deviation-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM2-003: Remove 2 ops → liquidate → verify all cleaned up
// ---------------------------------------------------------------------------
export const rm2MultiOpLiquidation: Scenario = {
  id: "RM2-multi-op-liquidation",
  tags: ["removed-operator", "liquidation", "bug-21", "rm2", "multi-op"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op1 = findActiveClusterOperator(ctx, record);
    const op2 = findSecondActiveClusterOperator(ctx, record, op1.id);

    // Step 1: Remove first operator
    await ctx.step(
      "removeOperator-1",
      async () => {
        await removeOperator(ctx, op1);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op1.id, "after-removal-op1");
      },
    );

    // Step 2: Remove second operator
    await ctx.step(
      "removeOperator-2",
      async () => {
        await removeOperator(ctx, op2);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op2.id, "after-removal-op2");
      },
    );

    // Drain and liquidate
    await ctx.mineBlocks(99999999);

    // Step 3: Liquidate with 2 removed ops
    await ctx.step(
      "liquidate-multi-removed",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op1.id, "op1-after-multi-liq");
        assertRemovedOpInvariant(post, op2.id, "op2-after-multi-liq");
        assertClusterLiquidated(post, "multi-liq-check");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM2-004: Remove op → liquidate → verify daoTotalEthVUnits consistent
// ---------------------------------------------------------------------------
export const rm2DaoVUnitsAfterLiq: Scenario = {
  id: "RM2-dao-vunits-after-liquidation",
  tags: ["removed-operator", "liquidation", "bug-21", "rm2", "dao"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: Set explicit EB
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 64);
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
        assertDaoVUnitsNonNegative(post, "dao-after-removal");
      },
    );

    // Drain and liquidate
    await ctx.mineBlocks(99999999);

    // Step 3: Liquidate and check dao consistency
    await ctx.step(
      "liquidate-check-dao",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-liq");
        assertDaoVUnitsNonNegative(post, "dao-after-liq");
        // daoTotalEthVUnits should have decreased or stayed same (never increased)
        if (post.daoTotalEthVUnits > pre.daoTotalEthVUnits) {
          throw new Error(
            `daoTotalEthVUnits increased during liquidation: ${pre.daoTotalEthVUnits} → ${post.daoTotalEthVUnits}`,
          );
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM2-005: Explicit EB → remove op → EB decrease → drain → liquidate
// ---------------------------------------------------------------------------
export const rm2EBDecreaseBeforeLiq: Scenario = {
  id: "RM2-eb-decrease-before-liquidation",
  tags: ["removed-operator", "liquidation", "bug-21", "rm2", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: High EB baseline
    await ctx.step(
      "eb-update-high",
      async () => {
        await performEBUpdate(ctx, record, 96);
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

    // Step 3: EB decrease (deviation subtraction with removed op)
    await ctx.step(
      "eb-update-decrease",
      async () => {
        await performEBUpdate(ctx, record, 32);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-eb-decrease");
      },
    );

    // Drain and liquidate
    await ctx.mineBlocks(99999999);

    // Step 4: Liquidate
    await ctx.step(
      "liquidate-after-eb-decrease",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "final-liq-check");
        assertClusterLiquidated(post, "final-liq");
      },
    );
  },
};
