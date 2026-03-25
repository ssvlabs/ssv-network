/**
 * RM5 scenarios: removeOperator → liquidation → reactivation
 *
 * Tests that reactivate() does not re-initialize vUnits for removed
 * operators. BUG-21: the reactivation flow must check ethSnapshot.block
 * and skip removed operators when setting up new operator state.
 *
 * 5 scenarios covering basic reactivation, explicit EB + reactivation,
 * multi-op, vUnits verification, and reactivation → EB update chain.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  findActiveClusterOperator,
  findSecondActiveClusterOperator,
  removeOperator,
  performEBUpdate,
  liquidateCluster,
  reactivateCluster,
  assertRemovedOpInvariant,
  assertDaoVUnitsNonNegative,
  assertClusterActive,
} from "./_rm-helpers.ts";

// ---------------------------------------------------------------------------
// RM5-001: Remove op → liquidate → reactivate → verify removed op not re-inited
// ---------------------------------------------------------------------------
export const rm5BasicReactivation: Scenario = {
  id: "RM5-basic-reactivation",
  tags: ["removed-operator", "reactivation", "bug-21", "rm5"],

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

    // Drain cluster
    await ctx.mineBlocks(99999999);

    // Step 2: Liquidate
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-liquidation");
      },
    );

    // Step 3: Reactivate — must NOT re-initialize removed op
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-reactivation");
        assertClusterActive(post, "reactivation-check");
        assertDaoVUnitsNonNegative(post, "dao-after-reactivation");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM5-002: Remove op → explicit EB → liquidate → reactivate → verify
// ---------------------------------------------------------------------------
export const rm5ExplicitEBReactivation: Scenario = {
  id: "RM5-explicit-eb-reactivation",
  tags: ["removed-operator", "reactivation", "bug-21", "rm5", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: Set explicit EB (creates deviation)
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
      },
    );

    // Drain and liquidate
    await ctx.mineBlocks(99999999);

    // Step 3: Liquidate
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-liq");
      },
    );

    // Step 4: Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-reactivation");
        assertClusterActive(post, "reactivation-check");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM5-003: Remove 2 ops → liquidate → reactivate → verify all guarded
// ---------------------------------------------------------------------------
export const rm5MultiOpReactivation: Scenario = {
  id: "RM5-multi-op-reactivation",
  tags: ["removed-operator", "reactivation", "bug-21", "rm5", "multi-op"],

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

    // Drain and liquidate
    await ctx.mineBlocks(99999999);

    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op1.id, "op1-after-liq");
        assertRemovedOpInvariant(post, op2.id, "op2-after-liq");
      },
    );

    // Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op1.id, "op1-after-reactivation");
        assertRemovedOpInvariant(post, op2.id, "op2-after-reactivation");
        assertClusterActive(post, "reactivation-check");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM5-004: Remove op → liquidate → reactivate → verify vUnits correct
// ---------------------------------------------------------------------------
export const rm5ReactivateVUnits: Scenario = {
  id: "RM5-reactivate-vunits-check",
  tags: ["removed-operator", "reactivation", "bug-21", "rm5", "vunits"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: Remove operator and record vUnits
    await ctx.step(
      "removeOperator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-removal");
      },
    );

    // Drain and liquidate
    await ctx.mineBlocks(99999999);

    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, _post) => {},
    );

    // Reactivate and verify vUnits
    await ctx.step(
      "reactivate-check-vunits",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-reactivation");
        // Active ops should have baseline vUnits restored
        for (const opId of record.operatorIds) {
          if (opId === op.id) continue;
          const opSnap = post.operators.get(opId);
          if (opSnap && opSnap.isActive) {
            // Active op's ethVUnits should be non-negative
            if (opSnap.ethVUnits < 0n) {
              throw new Error(
                `Active operator ${opId} has negative ethVUnits after reactivation`,
              );
            }
          }
        }
        assertDaoVUnitsNonNegative(post, "dao-after-reactivation");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM5-005: Remove op → liquidate → reactivate → EB update → verify
// ---------------------------------------------------------------------------
export const rm5ReactivateThenEB: Scenario = {
  id: "RM5-reactivate-then-eb-update",
  tags: ["removed-operator", "reactivation", "bug-21", "rm5", "eb-update"],

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

    // Drain and liquidate
    await ctx.mineBlocks(99999999);

    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, _post) => {},
    );

    // Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-reactivation");
        assertClusterActive(post, "reactivation-check");
      },
    );

    await ctx.mineBlocks(50);

    // Step 4: EB update after reactivation — guard must still skip removed op
    await ctx.step(
      "eb-update-after-reactivation",
      async () => {
        await performEBUpdate(ctx, record, 48);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-eb-post-reactivation");
        assertDaoVUnitsNonNegative(post, "dao-after-eb-post-reactivation");
      },
    );
  },
};
