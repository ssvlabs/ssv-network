/**
 * RMC scenarios: Multi-step removed-operator chains
 *
 * Tests compound sequences that exercise multiple BUG-21 code paths
 * in a single scenario. Each chain combines removeOperator with various
 * cluster operations to verify the guard holds across the full lifecycle.
 *
 * 7 scenarios covering the most representative multi-step sequences
 * from the e2e RMC test suite.
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
  depositToCluster,
  withdrawFromCluster,
  removeValidator,
  assertRemovedOpInvariant,
  assertDaoVUnitsNonNegative,
  assertClusterActive,
  assertClusterLiquidated,
} from "./_rm-helpers.ts";

// ---------------------------------------------------------------------------
// RMC-001: Remove op → deposit → mine → withdraw → verify balances
// ---------------------------------------------------------------------------
export const rmcDepositWithdrawChain: Scenario = {
  id: "RMC-remove-deposit-withdraw",
  tags: ["removed-operator", "chain", "bug-21", "rmc", "deposit", "withdraw"],

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

    // Step 2: Deposit ETH into cluster with removed op
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-deposit");
        // Contract balance should increase
        if (post.contractEthBalance <= pre.contractEthBalance) {
          throw new Error("Contract balance did not increase after deposit");
        }
      },
    );

    await ctx.mineBlocks(200);

    // Step 3: Withdraw from cluster with removed op
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-withdraw");
        assertDaoVUnitsNonNegative(post, "dao-after-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RMC-002: EB → remove op → liquidate → reactivate → verify full chain
// ---------------------------------------------------------------------------
export const rmcEBRemoveLiqReactivate: Scenario = {
  id: "RMC-eb-remove-liquidate-reactivate",
  tags: ["removed-operator", "chain", "bug-21", "rmc", "full-lifecycle"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: EB update to set deviation
    await ctx.step(
      "eb-update",
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

    // Step 3: Liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-liq");
        assertClusterLiquidated(post, "liq-check");
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
        assertDaoVUnitsNonNegative(post, "dao-after-reactivation");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RMC-003: Remove op → EB update → remove validator → verify all guards
// ---------------------------------------------------------------------------
export const rmcEBRemoveValidator: Scenario = {
  id: "RMC-remove-eb-remove-validator",
  tags: ["removed-operator", "chain", "bug-21", "rmc", "eb-update", "remove-validator"],

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

    await ctx.mineBlocks(100);

    // Step 2: EB update (vUnits guard fires)
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 64);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-eb");
      },
    );

    // Step 3: Remove validator (deviation cleanup guard fires)
    await ctx.step(
      "removeValidator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-remove-val");
        assertDaoVUnitsNonNegative(post, "dao-after-chain");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RMC-004: Remove 2 ops → liquidate → reactivate → EB update chain
// ---------------------------------------------------------------------------
export const rmcMultiOpFullChain: Scenario = {
  id: "RMC-multi-op-full-chain",
  tags: ["removed-operator", "chain", "bug-21", "rmc", "multi-op", "full-lifecycle"],

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

    await ctx.mineBlocks(100);

    // EB update after reactivation with 2 removed ops
    await ctx.step(
      "eb-update-after-chain",
      async () => {
        await performEBUpdate(ctx, record, 48);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op1.id, "op1-after-eb");
        assertRemovedOpInvariant(post, op2.id, "op2-after-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-full-chain");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RMC-005: Deposit → remove op → EB → withdraw → verify
// ---------------------------------------------------------------------------
export const rmcDepositRemoveEBWithdraw: Scenario = {
  id: "RMC-deposit-remove-eb-withdraw",
  tags: ["removed-operator", "chain", "bug-21", "rmc", "deposit", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: Deposit to ensure balance
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
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

    await ctx.mineBlocks(100);

    // Step 3: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-eb");
      },
    );

    // Step 4: Withdraw
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.5");
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-withdraw");
        assertDaoVUnitsNonNegative(post, "dao-after-chain");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RMC-006: Full lifecycle: remove → liq → reactivate → EB → remove validator
// ---------------------------------------------------------------------------
export const rmcFullLifecycle: Scenario = {
  id: "RMC-full-lifecycle",
  tags: ["removed-operator", "chain", "bug-21", "rmc", "full-lifecycle"],

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

    // Step 2: Drain and liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-liq");
      },
    );

    // Step 3: Reactivate
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

    // Step 4: EB update after reactivation
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-eb");
      },
    );

    // Step 5: Remove validator
    await ctx.step(
      "removeValidator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-remove-val");
        assertDaoVUnitsNonNegative(post, "dao-end-of-lifecycle");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RMC-007: EB swing stress — remove op → 3 EB updates → liquidate → reactivate
// ---------------------------------------------------------------------------
export const rmcEBSwingStress: Scenario = {
  id: "RMC-eb-swing-stress",
  tags: ["removed-operator", "chain", "bug-21", "rmc", "stress", "eb-update"],

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

    // Step 2: EB swing up
    await ctx.step(
      "eb-swing-up-1",
      async () => {
        await performEBUpdate(ctx, record, 64);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-swing-up-1");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: EB swing down
    await ctx.step(
      "eb-swing-down",
      async () => {
        await performEBUpdate(ctx, record, 32);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-swing-down");
      },
    );

    await ctx.mineBlocks(100);

    // Step 4: EB swing up again (higher)
    await ctx.step(
      "eb-swing-up-2",
      async () => {
        await performEBUpdate(ctx, record, 128);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-swing-up-2");
      },
    );

    // Step 5: Drain and liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate-after-swings",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-liq");
      },
    );

    // Step 6: Reactivate
    await ctx.step(
      "reactivate-after-swings",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-reactivation");
        assertClusterActive(post, "reactivation-check");
        assertDaoVUnitsNonNegative(post, "dao-after-stress");
      },
    );
  },
};
