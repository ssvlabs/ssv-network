/**
 * RM3 scenarios: removeOperator → removeValidator / bulkRemoveValidator
 *
 * Tests the deviation cleanup loop in SSVValidators.sol that subtracts
 * remainingVUnits from all operators. BUG-21: the loop must skip removed
 * operators whose operatorEthVUnits was deleted to 0.
 *
 * 4 scenarios covering basic removal, explicit EB + removal, all validators
 * removed, and multi-op removed.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  findActiveClusterOperator,
  findSecondActiveClusterOperator,
  removeOperator,
  performEBUpdate,
  removeValidator,
  assertRemovedOpInvariant,
  assertDaoVUnitsNonNegative,
} from "./_rm-helpers.ts";

// ---------------------------------------------------------------------------
// RM3-001: Remove op → remove validator → verify guard
// ---------------------------------------------------------------------------
export const rm3BasicRemoveValidator: Scenario = {
  id: "RM3-basic-remove-validator",
  tags: ["removed-operator", "remove-validator", "bug-21", "rm3"],

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

    // Step 2: Remove a validator — deviation cleanup must skip removed op
    await ctx.step(
      "removeValidator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, post) => {
        // Removed op must still have ethVUnits == 0
        assertRemovedOpInvariant(post, op.id, "after-remove-validator");
        assertDaoVUnitsNonNegative(post, "dao-after-remove-validator");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM3-002: Remove op → explicit EB → remove validator → verify
// ---------------------------------------------------------------------------
export const rm3ExplicitEBRemoveValidator: Scenario = {
  id: "RM3-explicit-eb-remove-validator",
  tags: ["removed-operator", "remove-validator", "bug-21", "rm3", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: Set explicit EB (creates deviation for all ops)
    await ctx.step(
      "eb-update",
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
        assertRemovedOpInvariant(post, op.id, "after-removal");
      },
    );

    await ctx.mineBlocks(50);

    // Step 3: Remove validator — must not underflow on removed op's ethVUnits
    await ctx.step(
      "removeValidator-with-deviation",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-remove-val-with-deviation");
        assertDaoVUnitsNonNegative(post, "dao-after-remove-val-deviation");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM3-003: Remove op → remove ALL validators → verify cleanup
// ---------------------------------------------------------------------------
export const rm3AllValidatorsRemoved: Scenario = {
  id: "RM3-all-validators-removed",
  tags: ["removed-operator", "remove-validator", "bug-21", "rm3"],

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

    // Step 2: Remove validators one by one until none left
    let validatorIdx = 0;
    while (record.validatorKeys.length > 0) {
      validatorIdx++;
      await ctx.step(
        `removeValidator-${validatorIdx}`,
        async () => {
          await removeValidator(ctx, record);
        },
        async (_pre, post) => {
          assertRemovedOpInvariant(post, op.id, `after-remove-val-${validatorIdx}`);
        },
      );
    }

    // Step 3: Verify final state
    await ctx.step(
      "verify-final-state",
      async () => {},
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "final-state");
        assertDaoVUnitsNonNegative(post, "dao-final");
        // Cluster should have 0 validators
        if (post.cluster && post.cluster.validatorCount !== 0) {
          throw new Error(
            `Expected 0 validators, got ${post.cluster.validatorCount}`,
          );
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM3-004: Remove 2 ops → remove validator → verify both guarded
// ---------------------------------------------------------------------------
export const rm3MultiOpRemoveValidator: Scenario = {
  id: "RM3-multi-op-remove-validator",
  tags: ["removed-operator", "remove-validator", "bug-21", "rm3", "multi-op"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op1 = findActiveClusterOperator(ctx, record);
    const op2 = findSecondActiveClusterOperator(ctx, record, op1.id);

    // Step 1: Remove both operators
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

    await ctx.mineBlocks(50);

    // Step 2: Remove validator — must skip both removed ops
    await ctx.step(
      "removeValidator-multi-removed",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op1.id, "op1-after-remove-val");
        assertRemovedOpInvariant(post, op2.id, "op2-after-remove-val");
        assertDaoVUnitsNonNegative(post, "dao-after-multi-remove-val");
      },
    );
  },
};
