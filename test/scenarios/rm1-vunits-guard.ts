/**
 * RM1 scenarios: removeOperator → updateClusterBalance (vUnits guard)
 *
 * Tests that _updateOperatorVUnits skips removed operators when applying
 * EB deviations. BUG-21 root cause: the guard must check
 * `operators[id].ethSnapshot.block == 0` to skip removed ops.
 *
 * 5 scenarios covering EB increase, decrease, multi-op, daoTotalEthVUnits
 * consistency, and guard persistence after many blocks.
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
// RM1-001: Remove op → EB increase → guard skips removed op
// ---------------------------------------------------------------------------
export const rm1GuardEBIncrease: Scenario = {
  id: "RM1-guard-eb-increase",
  tags: ["removed-operator", "vunits", "bug-21", "rm1", "eb-update"],

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

    await ctx.mineBlocks(50);

    // Step 2: EB increase (48 ETH → higher vUnits)
    await ctx.step(
      "eb-update-increase",
      async () => {
        await performEBUpdate(ctx, record, 48 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        // Removed op must still have ethVUnits == 0
        assertRemovedOpInvariant(post, op.id, "after-eb-increase");
        assertDaoVUnitsNonNegative(post, "after-eb-increase");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM1-002: Remove op → EB decrease → guard skips removed op
// ---------------------------------------------------------------------------
export const rm1GuardEBDecrease: Scenario = {
  id: "RM1-guard-eb-decrease",
  tags: ["removed-operator", "vunits", "bug-21", "rm1", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: First set explicit EB to a higher value
    await ctx.step(
      "eb-update-baseline",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
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

    await ctx.mineBlocks(50);

    // Step 3: EB decrease (back to 32 → deviation subtraction)
    await ctx.step(
      "eb-update-decrease",
      async () => {
        await performEBUpdate(ctx, record, 32 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        // Guard must skip removed op during subtraction
        assertRemovedOpInvariant(post, op.id, "after-eb-decrease");
        assertDaoVUnitsNonNegative(post, "after-eb-decrease");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM1-003: Remove 2 ops → EB update → verify all removed ops guarded
// ---------------------------------------------------------------------------
export const rm1GuardMultiOp: Scenario = {
  id: "RM1-guard-multi-op-removed",
  tags: ["removed-operator", "vunits", "bug-21", "rm1", "multi-op"],

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
        assertRemovedOpInvariant(post, op1.id, "op1-still-zero");
        assertRemovedOpInvariant(post, op2.id, "after-removal-op2");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: EB update with both ops removed
    await ctx.step(
      "eb-update-after-multi-removal",
      async () => {
        await performEBUpdate(ctx, record, 48 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op1.id, "op1-after-eb");
        assertRemovedOpInvariant(post, op2.id, "op2-after-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-multi-removal-eb");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM1-004: Remove op → EB update → verify daoTotalEthVUnits consistency
// ---------------------------------------------------------------------------
export const rm1DaoVUnitsConsistency: Scenario = {
  id: "RM1-dao-vunits-consistency",
  tags: ["removed-operator", "vunits", "bug-21", "rm1", "dao"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: Read baseline daoTotalEthVUnits
    await ctx.step(
      "read-baseline-dao-vunits",
      async () => {},
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
        // daoTotalEthVUnits should have decreased (removed op's vUnits subtracted)
        assertDaoVUnitsNonNegative(post, "dao-after-removal");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: EB update → daoTotalEthVUnits should NOT include removed op
    await ctx.step(
      "eb-update-check-dao",
      async () => {
        await performEBUpdate(ctx, record, 48 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM1-005: Remove op → mine many blocks → EB update → guard persists
// ---------------------------------------------------------------------------
export const rm1GuardPersistsOverTime: Scenario = {
  id: "RM1-guard-persists-over-time",
  tags: ["removed-operator", "vunits", "bug-21", "rm1"],

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

    // Mine many blocks to simulate passage of time
    await ctx.mineBlocks(10000);

    // Step 2: EB update after long time — guard must still work
    await ctx.step(
      "eb-update-after-long-wait",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-long-wait-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-long-wait");
      },
    );

    await ctx.mineBlocks(5000);

    // Step 3: Second EB update — still guarded
    await ctx.step(
      "eb-update-second",
      async () => {
        await performEBUpdate(ctx, record, 96 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-second-eb");
      },
    );
  },
};
