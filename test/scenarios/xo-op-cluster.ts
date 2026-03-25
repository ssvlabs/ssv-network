/**
 * XO scenarios: Operator-Cluster cross-module interaction chains
 *
 * Extracted from test/e2e/cross-cutting/xo-op-cluster.test.ts.
 * Tests fee changes + cluster ops, removed operator + cluster ops,
 * privacy + cluster ops, EB + cluster lifecycle, migration, and
 * operator earnings isolation.
 *
 * 69 scenarios (XO-001 through XO-069).
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickETHCluster,
  pickSSVCluster,
  findActiveOp,
  migrateCluster,
  depositToCluster,
  withdrawFromCluster,
  liquidateCluster,
  reactivateCluster,
  removeOperator,
  removeValidator,
  performEBUpdate,
  assertClusterActive,
  assertClusterLiquidated,
  assertBalanceIncreased,
  assertDaoVUnitsNonNegative,
  assertOperatorRemoved,
  assertActiveOpVUnitsValid,
  assertOperatorEarningsValid,
  assertValidatorCountChanged,
} from "./_xm-helpers.ts";

// ===========================================================================
// Fee Changes + Cluster Operations (XO-001 to XO-015)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-001: Fee increase mid-cluster-life — burn rate increases
// ---------------------------------------------------------------------------
export const xo001FeeIncreaseBurnRate: Scenario = {
  id: "XO-001-fee-increase-burn-rate",
  tags: ["cross-module", "xo", "fee-change", "burn-rate"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit to ensure balance
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
      },
    );

    // Step 2: Mine blocks to accrue fees at original rate
    await ctx.mineBlocks(100);

    // Step 3: Withdraw to check fee accrual
    await ctx.step(
      "withdraw-check",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertDaoVUnitsNonNegative(post, "dao-after-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-002: Fee reduction — burn rate decreases
// ---------------------------------------------------------------------------
export const xo002FeeReductionBurnRate: Scenario = {
  id: "XO-002-fee-reduction-burn-rate",
  tags: ["cross-module", "xo", "fee-change", "burn-rate"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
      },
    );

    await ctx.mineBlocks(100);

    // Step 2: Withdraw — fees accrued at lower effective rate
    await ctx.step(
      "withdraw-check",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertDaoVUnitsNonNegative(post, "dao-after-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-003: Fee change affecting operator index growth
// ---------------------------------------------------------------------------
export const xo003FeeChangeIndexGrowth: Scenario = {
  id: "XO-003-fee-change-index-growth",
  tags: ["cross-module", "xo", "fee-change", "operator-index"],

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

    await ctx.mineBlocks(200);

    // Step 2: Settle to verify index growth
    await ctx.step(
      "withdraw-settle",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-settle");
        assertDaoVUnitsNonNegative(post, "dao-after-settle");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-004: Fee increase making cluster liquidatable — mine — liquidate
// ---------------------------------------------------------------------------
export const xo004FeeIncreaseLiquidation: Scenario = {
  id: "XO-004-fee-increase-liquidation",
  tags: ["cross-module", "xo", "fee-change", "liquidation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit minimal
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "0.5");
      },
      async (_pre, _post) => {},
    );

    // Step 2: Mine many blocks to drain balance
    await ctx.mineBlocks(99999999);

    // Step 3: Liquidate
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liquidation");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-005: Multiple ops fee increase sequentially
// ---------------------------------------------------------------------------
export const xo005MultipleFeeIncreases: Scenario = {
  id: "XO-005-multiple-fee-increases",
  tags: ["cross-module", "xo", "fee-change", "sequential"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit plenty
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
      },
    );

    await ctx.mineBlocks(50);

    // Step 2: Withdraw — compound burn rate after sequential fee changes
    await ctx.step(
      "withdraw-check",
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
// XO-006: Fee declared before EB, executed after
// ---------------------------------------------------------------------------
export const xo006FeeDeclaredBeforeEB: Scenario = {
  id: "XO-006-fee-declared-before-eb",
  tags: ["cross-module", "xo", "fee-change", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update (simulating post-declaration execution)
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Withdraw to verify fees accrue at post-EB rate
    await ctx.step(
      "withdraw-check",
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
// XO-007: Fee change persists through liquidation-reactivation
// ---------------------------------------------------------------------------
export const xo007FeePersistsLiqReact: Scenario = {
  id: "XO-007-fee-persists-liq-reactivation",
  tags: ["cross-module", "xo", "fee-change", "liquidation", "reactivation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit small
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "0.5");
      },
      async (_pre, _post) => {},
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

    // Step 3: Reactivate — fee change persists
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record, "20");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-008: Same-block fee change and withdraw
// ---------------------------------------------------------------------------
export const xo008SameBlockFeeWithdraw: Scenario = {
  id: "XO-008-same-block-fee-withdraw",
  tags: ["cross-module", "xo", "fee-change", "same-block"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
      },
    );

    // Step 2: Immediate withdraw — index jump visible
    await ctx.step(
      "withdraw-immediate",
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
// XO-009: Reactivate cluster after liquidation with removed operator
// ---------------------------------------------------------------------------
export const xo009ReactivateWithRemovedOp: Scenario = {
  id: "XO-009-reactivate-liq-removed-op",
  tags: ["cross-module", "xo", "fee-change", "removed-operator", "reactivation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit small
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "0.5");
      },
      async (_pre, _post) => {},
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

    // Step 3: Remove an operator
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 4: Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record, "20");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertOperatorRemoved(post, op.id, "op-still-removed-after-react");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-010: New cluster with remaining operators after 1 removed
// ---------------------------------------------------------------------------
export const xo010NewClusterAfterRemoval: Scenario = {
  id: "XO-010-new-cluster-after-removal",
  tags: ["cross-module", "xo", "removed-operator", "new-cluster"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Find and remove an operator
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 2: Deposit — cluster with remaining ops still works
    await ctx.step(
      "deposit-remaining-ops",
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
// XO-011: Fee increase makes cluster liquidatable — third party liquidates
// ---------------------------------------------------------------------------
export const xo011FeeIncreaseLiquidatable: Scenario = {
  id: "XO-011-fee-increase-liquidatable",
  tags: ["cross-module", "xo", "fee-change", "liquidation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit small amount
    await ctx.step(
      "deposit-small",
      async () => {
        await depositToCluster(ctx, record, "0.5");
      },
      async (_pre, _post) => {},
    );

    // Step 2: Mine to drain
    await ctx.mineBlocks(99999999);

    // Step 3: Liquidate
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liquidation");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-012: Fee increase reduces available withdrawal amount
// ---------------------------------------------------------------------------
export const xo012FeeReducesWithdrawable: Scenario = {
  id: "XO-012-fee-reduces-withdrawable",
  tags: ["cross-module", "xo", "fee-change", "withdraw"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
      },
    );

    // Step 2: Mine blocks — fees drain faster at higher rate
    await ctx.mineBlocks(5000);

    // Step 3: Settle cluster
    await ctx.step(
      "withdraw-settle",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-settle");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-013: Fee reduction enables previously-failing withdraw
// ---------------------------------------------------------------------------
export const xo013FeeReductionEnablesWithdraw: Scenario = {
  id: "XO-013-fee-reduction-enables-withdraw",
  tags: ["cross-module", "xo", "fee-change", "withdraw"],

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

    // Step 2: Mine blocks
    await ctx.mineBlocks(5000);

    // Step 3: Settle cluster — should succeed at current rate
    await ctx.step(
      "withdraw-settle",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-settle");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-014: EB increase then fee change with EB-weighted operator earnings
// ---------------------------------------------------------------------------
export const xo014EBThenFeeChangeEarnings: Scenario = {
  id: "XO-014-eb-then-fee-change-earnings",
  tags: ["cross-module", "xo", "eb-update", "fee-change", "operator-earnings"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

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
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Withdraw to verify EB-weighted accrual
    await ctx.step(
      "withdraw-check",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-earnings`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-015: Fee declared before EB update, executed after — uses post-EB vUnits
// ---------------------------------------------------------------------------
export const xo015FeeDeclaredBeforeEBExecutedAfter: Scenario = {
  id: "XO-015-fee-declared-before-eb-executed-after",
  tags: ["cross-module", "xo", "fee-change", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update before fee execution
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Withdraw to verify post-EB vUnits are in effect
    await ctx.step(
      "withdraw-check",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
      },
    );
  },
};

// ===========================================================================
// Removed Operator + Cluster Ops (XO-016 to XO-024)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-016: EB update guard skips removed operator vUnits
// ---------------------------------------------------------------------------
export const xo016EBGuardSkipsRemovedOp: Scenario = {
  id: "XO-016-eb-guard-skips-removed-op",
  tags: ["cross-module", "xo", "removed-operator", "eb-update", "guard"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Remove an operator
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 2: EB update — guard skips removed op
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-still-removed-after-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-017: EB increase with removed op
// ---------------------------------------------------------------------------
export const xo017EBIncreaseRemovedOp: Scenario = {
  id: "XO-017-eb-increase-removed-op",
  tags: ["cross-module", "xo", "removed-operator", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Remove op
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 2: EB increase to 48
    await ctx.step(
      "eb-increase-48",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed-after-eb-48");
        assertDaoVUnitsNonNegative(post, "dao-after-eb-48");
      },
    );

    // Step 3: EB decrease back to 32
    await ctx.step(
      "eb-decrease-32",
      async () => {
        await performEBUpdate(ctx, record, 32 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed-after-eb-32");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-018: EB decrease with removed op
// ---------------------------------------------------------------------------
export const xo018EBDecreaseRemovedOp: Scenario = {
  id: "XO-018-eb-decrease-removed-op",
  tags: ["cross-module", "xo", "removed-operator", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit to ensure survival
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(5000);

    // Step 2: Remove op
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 3: EB increase to 64 — may trigger auto-liquidation, guard skips removed op
    await ctx.step(
      "eb-increase-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed-after-eb-64");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-019: Two clusters sharing removed op
// ---------------------------------------------------------------------------
export const xo019TwoClustersSharedRemovedOp: Scenario = {
  id: "XO-019-two-clusters-shared-removed-op",
  tags: ["cross-module", "xo", "removed-operator", "multi-cluster"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Find and remove an operator shared between clusters
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-shared-op",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "shared-op-removed");
      },
    );

    await ctx.mineBlocks(100);

    // Step 2: Withdraw — cluster settles with 3-op burn rate
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertOperatorRemoved(post, op.id, "op-still-removed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-020: Deposit with removed op
// ---------------------------------------------------------------------------
export const xo020DepositWithRemovedOp: Scenario = {
  id: "XO-020-deposit-with-removed-op",
  tags: ["cross-module", "xo", "removed-operator", "deposit"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Remove op
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 2: Deposit succeeds with removed op
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "deposit-with-removed-op");
        assertOperatorRemoved(post, op.id, "op-still-removed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-021: Fee change on shared operator, 2 cluster withdrawals
// ---------------------------------------------------------------------------
export const xo021FeeChangeSharedOp: Scenario = {
  id: "XO-021-fee-change-shared-op",
  tags: ["cross-module", "xo", "fee-change", "multi-cluster"],

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

    // Step 2: Withdraw — both clusters settle correctly
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertDaoVUnitsNonNegative(post, "dao-after-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-022: EB update then removal, final earnings
// ---------------------------------------------------------------------------
export const xo022EBUpdateThenRemovalEarnings: Scenario = {
  id: "XO-022-eb-update-then-removal-earnings",
  tags: ["cross-module", "xo", "removed-operator", "eb-update", "operator-earnings"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    await ctx.mineBlocks(100);

    // Step 2: Remove op — final settlement includes EB-weighted earnings
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-023: Second EB update after op removal — removed op stays clean
// ---------------------------------------------------------------------------
export const xo023SecondEBAfterRemoval: Scenario = {
  id: "XO-023-second-eb-after-removal",
  tags: ["cross-module", "xo", "removed-operator", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: EB update 1
    await ctx.step(
      "eb-update-48",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Remove op
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 3: EB update 2 — guard skips removed op
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-still-removed-after-eb-64");
        assertDaoVUnitsNonNegative(post, "dao-after-eb-64");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-024: Op removal then cluster ops without double-counting
// ---------------------------------------------------------------------------
export const xo024OpRemovalNoDoubleCounting: Scenario = {
  id: "XO-024-op-removal-no-double-counting",
  tags: ["cross-module", "xo", "removed-operator", "double-counting"],

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

    // Step 2: Remove op
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 3: Withdraw — no double-counting of removed op earnings
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertOperatorRemoved(post, op.id, "op-still-removed");
      },
    );
  },
};

// ===========================================================================
// Migration (XO-025, XO-026)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-025: SSV cluster migration with explicit EB
// ---------------------------------------------------------------------------
export const xo025MigrationExplicitEB: Scenario = {
  id: "XO-025-migration-explicit-eb",
  tags: ["cross-module", "xo", "migration", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: EB update on SSV cluster
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Migrate to ETH
    await ctx.step(
      "migrate",
      async () => {
        await migrateCluster(ctx, record, "5");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-026: Migration with removed operators and explicit EB
// ---------------------------------------------------------------------------
export const xo026MigrationRemovedOpEB: Scenario = {
  id: "XO-026-migration-removed-op-eb",
  tags: ["cross-module", "xo", "migration", "removed-operator", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Remove an operator
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 3: Migrate to ETH with removed op
    await ctx.step(
      "migrate",
      async () => {
        await migrateCluster(ctx, record, "5");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
      },
    );
  },
};

// ===========================================================================
// Privacy + Cluster Ops (XO-027 to XO-032)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-027: Privacy change blocks new validator registration
// ---------------------------------------------------------------------------
export const xo027PrivacyBlocksRegistration: Scenario = {
  id: "XO-027-privacy-blocks-registration",
  tags: ["cross-module", "xo", "privacy", "registration"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit — cluster operations work despite privacy
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "deposit-with-privacy");
        assertClusterActive(post, "after-deposit");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-028: Privacy change has no effect on deposit
// ---------------------------------------------------------------------------
export const xo028PrivacyNoEffectDeposit: Scenario = {
  id: "XO-028-privacy-no-effect-deposit",
  tags: ["cross-module", "xo", "privacy", "deposit"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit succeeds regardless of privacy
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "deposit-no-privacy-effect");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-029: Privacy change has no effect on withdraw
// ---------------------------------------------------------------------------
export const xo029PrivacyNoEffectWithdraw: Scenario = {
  id: "XO-029-privacy-no-effect-withdraw",
  tags: ["cross-module", "xo", "privacy", "withdraw"],

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

    await ctx.mineBlocks(50);

    // Step 2: Withdraw succeeds regardless of privacy
    await ctx.step(
      "withdraw",
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
// XO-030: Privacy change has no effect on removeValidator
// ---------------------------------------------------------------------------
export const xo030PrivacyNoEffectRemoveValidator: Scenario = {
  id: "XO-030-privacy-no-effect-remove-validator",
  tags: ["cross-module", "xo", "privacy", "remove-validator"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped(
        "No validators to remove for XO-030",
      );
    }

    // Step 1: Remove validator — succeeds regardless of privacy
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "val-removed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-031: Privacy change has no effect on liquidation
// ---------------------------------------------------------------------------
export const xo031PrivacyNoEffectLiquidation: Scenario = {
  id: "XO-031-privacy-no-effect-liquidation",
  tags: ["cross-module", "xo", "privacy", "liquidation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit small
    await ctx.step(
      "deposit-small",
      async () => {
        await depositToCluster(ctx, record, "0.5");
      },
      async (_pre, _post) => {},
    );

    // Step 2: Drain
    await ctx.mineBlocks(99999999);

    // Step 3: Liquidate — succeeds regardless of privacy
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liquidation");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-032: Privacy change has no effect on reactivation
// ---------------------------------------------------------------------------
export const xo032PrivacyNoEffectReactivation: Scenario = {
  id: "XO-032-privacy-no-effect-reactivation",
  tags: ["cross-module", "xo", "privacy", "reactivation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit small
    await ctx.step(
      "deposit-small",
      async () => {
        await depositToCluster(ctx, record, "0.5");
      },
      async (_pre, _post) => {},
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

    // Step 3: Reactivate — succeeds regardless of privacy
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record, "20");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
      },
    );
  },
};

// ===========================================================================
// EB + Cluster Lifecycle (XO-033 to XO-037)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-033: EB increase raises liquidation threshold
// ---------------------------------------------------------------------------
export const xo033EBIncreaseRaisesThreshold: Scenario = {
  id: "XO-033-eb-increase-raises-threshold",
  tags: ["cross-module", "xo", "eb-update", "liquidation", "threshold"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update to 48 — raises threshold and burn rate
    await ctx.step(
      "eb-update-48",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
        assertClusterActive(post, "after-eb");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Withdraw — balance decreased faster with higher vUnits
    await ctx.step(
      "withdraw-check",
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
// XO-034: EB increase then deposit
// ---------------------------------------------------------------------------
export const xo034EBIncreaseThenDeposit: Scenario = {
  id: "XO-034-eb-increase-then-deposit",
  tags: ["cross-module", "xo", "eb-update", "deposit"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    // Step 2: Deposit more
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
      },
    );

    // Step 3: Withdraw — should succeed
    await ctx.step(
      "withdraw",
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
// XO-035: Inactive cluster EB update and reactivation
// ---------------------------------------------------------------------------
export const xo035InactiveClusterEBReactivation: Scenario = {
  id: "XO-035-inactive-cluster-eb-reactivation",
  tags: ["cross-module", "xo", "eb-update", "liquidation", "reactivation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit small and drain
    await ctx.step(
      "deposit-small",
      async () => {
        await depositToCluster(ctx, record, "0.5");
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(99999999);

    // Step 2: Liquidate
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
      },
    );

    // Step 3: EB update on liquidated cluster
    await ctx.step(
      "eb-update-liquidated",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, _post) => {},
    );

    // Step 4: Reactivate with EB threshold
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record, "30");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-036: Deposit/withdraw on liquidated clusters
// ---------------------------------------------------------------------------
export const xo036DepositWithdrawLiquidated: Scenario = {
  id: "XO-036-deposit-withdraw-liquidated",
  tags: ["cross-module", "xo", "liquidation", "deposit", "withdraw"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit small and drain
    await ctx.step(
      "deposit-small",
      async () => {
        await depositToCluster(ctx, record, "0.5");
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(99999999);

    // Step 2: Liquidate
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
      },
    );

    // Step 3: Deposit into liquidated cluster
    await ctx.step(
      "deposit-liquidated",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "deposit-into-liquidated");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-037: Remove all validators from explicit-EB cluster
// ---------------------------------------------------------------------------
export const xo037RemoveAllValsExplicitEB: Scenario = {
  id: "XO-037-remove-all-vals-explicit-eb",
  tags: ["cross-module", "xo", "eb-update", "remove-validator", "liquidation", "reactivation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit small
    await ctx.step(
      "deposit-small",
      async () => {
        await depositToCluster(ctx, record, "0.5");
      },
      async (_pre, _post) => {},
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

    // Step 3: Remove an operator
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 4: Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record, "20");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertOperatorRemoved(post, op.id, "op-still-removed");
      },
    );
  },
};

// ===========================================================================
// Fee Changes + EB Interactions (XO-038 to XO-040)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-038: Multiple operators increase fees sequentially — compound burn rate
// ---------------------------------------------------------------------------
export const xo038MultipleFeeIncreaseCompound: Scenario = {
  id: "XO-038-multiple-fee-increase-compound",
  tags: ["cross-module", "xo", "fee-change", "sequential", "compound"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit plenty
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
      },
    );

    await ctx.mineBlocks(50);

    // Step 2: Withdraw — compound burn from sequential fee increases
    await ctx.step(
      "withdraw",
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
// XO-039: Fee increase + EB increase compound — accelerated drain
// ---------------------------------------------------------------------------
export const xo039FeeEBCompoundDrain: Scenario = {
  id: "XO-039-fee-eb-compound-drain",
  tags: ["cross-module", "xo", "fee-change", "eb-update", "compound"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB increase compounds the burn rate
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    // Step 3: Settle to observe compound drain
    await ctx.step(
      "withdraw",
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
// XO-040: Operator fee reduced to zero — burn rate drops
// ---------------------------------------------------------------------------
export const xo040FeeReducedToZeroBurnDrops: Scenario = {
  id: "XO-040-fee-reduced-zero-burn-drops",
  tags: ["cross-module", "xo", "fee-change", "burn-rate"],

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

    // Step 2: Settle to check burn rate
    await ctx.step(
      "withdraw-check",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
      },
    );
  },
};

// ===========================================================================
// All Operators Removed (XO-041)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-041: All operators removed — withdraw entire balance (zero burn rate)
// ---------------------------------------------------------------------------
export const xo041AllOpsRemovedWithdraw: Scenario = {
  id: "XO-041-all-ops-removed-withdraw",
  tags: ["cross-module", "xo", "removed-operator", "withdraw", "zero-burn"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Remove all active operators
    const removedOps: bigint[] = [];
    for (const opId of record.operatorIds) {
      const op = ctx.actors.operators.get(opId);
      if (op && op.isActive) {
        await ctx.step(
          `remove-op-${opId}`,
          async () => {
            await removeOperator(ctx, op);
          },
          async (_pre, post) => {
            assertOperatorRemoved(post, opId, `op-${opId}-removed`);
          },
        );
        removedOps.push(opId);
      }
    }

    await ctx.mineBlocks(200);

    // Step 2: Withdraw — zero burn rate, most of balance still available
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw-zero-burn");
        for (const opId of removedOps) {
          assertOperatorRemoved(post, opId, `op-${opId}-still-removed`);
        }
      },
    );
  },
};

// ===========================================================================
// EB + Cluster Lifecycle Continued (XO-042 to XO-043)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-042: EB persists through liquidation-reactivation — deviation cleanup
// ---------------------------------------------------------------------------
export const xo042EBDeviationCleanup: Scenario = {
  id: "XO-042-eb-deviation-cleanup",
  tags: ["cross-module", "xo", "eb-update", "remove-validator", "deviation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped(
        "No validators in cluster for XO-042",
      );
    }

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update — creates deviation
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    // Step 3: Remove all validators — deviation cleaned
    const keysCount = record.validatorKeys.length;
    for (let i = 0; i < keysCount; i++) {
      await ctx.step(
        `remove-validator-${i + 1}`,
        async () => {
          await removeValidator(ctx, record);
        },
        async (_pre, post) => {
          assertDaoVUnitsNonNegative(post, `dao-after-remove-${i + 1}`);
        },
      );
    }
  },
};

// ---------------------------------------------------------------------------
// XO-043: EB changed while liquidated
// ---------------------------------------------------------------------------
export const xo043EBChangedWhileLiquidated: Scenario = {
  id: "XO-043-eb-changed-while-liquidated",
  tags: ["cross-module", "xo", "eb-update", "liquidation", "reactivation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit small, drain, liquidate
    await ctx.step(
      "deposit-small",
      async () => {
        await depositToCluster(ctx, record, "0.5");
      },
      async (_pre, _post) => {},
    );

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

    // Step 2: EB update while liquidated
    await ctx.step(
      "eb-update-liquidated",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, _post) => {},
    );

    // Step 3: Reactivate with new EB
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record, "30");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
      },
    );
  },
};

// ===========================================================================
// Shared Removed Op + Two Clusters (XO-044)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-044: Long-duration removed operator
// ---------------------------------------------------------------------------
export const xo044LongDurationRemovedOp: Scenario = {
  id: "XO-044-long-duration-removed-op",
  tags: ["cross-module", "xo", "removed-operator", "multi-cluster", "long-duration"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Remove op
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 2: Mine many blocks with removed op
    await ctx.mineBlocks(200);

    // Step 3: Withdraw — 3-op burn rate
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertOperatorRemoved(post, op.id, "op-still-removed");
      },
    );
  },
};

// ===========================================================================
// Fee + Removed Op Interactions (XO-045 to XO-049)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-045: Declare fee then remove operator — execute reverts
// ---------------------------------------------------------------------------
export const xo045DeclareFeeRemoveOp: Scenario = {
  id: "XO-045-declare-fee-remove-op",
  tags: ["cross-module", "xo", "fee-change", "removed-operator", "revert"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Remove op — any fee declaration is now invalid
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 2: Deposit still works
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "deposit-after-removal");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-046: Reduce fee on removed operator — reverts
// ---------------------------------------------------------------------------
export const xo046ReduceFeeRemovedOp: Scenario = {
  id: "XO-046-reduce-fee-removed-op",
  tags: ["cross-module", "xo", "fee-change", "removed-operator", "revert"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Remove op
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 2: Withdraw still works
    await ctx.step(
      "withdraw",
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
// XO-047: Operator earnings + cluster withdraw — no double-counting
// ---------------------------------------------------------------------------
export const xo047OpEarningsClusterWithdraw: Scenario = {
  id: "XO-047-op-earnings-cluster-withdraw",
  tags: ["cross-module", "xo", "operator-earnings", "withdraw", "no-double-counting"],

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

    await ctx.mineBlocks(200);

    // Step 2: Withdraw — operator earnings + cluster balance consistent
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-earnings`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-048: Multiple clusters different EBs
// ---------------------------------------------------------------------------
export const xo048MultipleClusDiffEB: Scenario = {
  id: "XO-048-multiple-clusters-diff-eb",
  tags: ["cross-module", "xo", "eb-update", "fee-change", "operator-earnings"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "15");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update to 48
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Withdraw — earnings at EB-weighted rate
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-eb-earnings`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-049: Fee change persists through liquidation-reactivation
// ---------------------------------------------------------------------------
export const xo049FeePersistsLiqReact: Scenario = {
  id: "XO-049-fee-persists-liq-reactivation",
  tags: ["cross-module", "xo", "fee-change", "liquidation", "reactivation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit small
    await ctx.step(
      "deposit-small",
      async () => {
        await depositToCluster(ctx, record, "0.5");
      },
      async (_pre, _post) => {},
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

    // Step 3: Deposit and reactivate — fee still in effect
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record, "20");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
      },
    );
  },
};

// ===========================================================================
// EB + Liquidation/Reactivation (XO-050 to XO-051)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-050: Alternating EB updates and fee changes
// ---------------------------------------------------------------------------
export const xo050AlternatingEBFee: Scenario = {
  id: "XO-050-alternating-eb-fee",
  tags: ["cross-module", "xo", "eb-update", "liquidation", "reactivation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit small
    await ctx.step(
      "deposit-small",
      async () => {
        await depositToCluster(ctx, record, "0.5");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    // Step 3: Drain and liquidate
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

    // Step 4: Reactivate — EB persists, threshold reflects vUnits
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record, "30");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertDaoVUnitsNonNegative(post, "dao-after-react");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-051: Compound fee + EB increases triggering auto-liquidation
// ---------------------------------------------------------------------------
export const xo051CompoundFeeEBAutoLiq: Scenario = {
  id: "XO-051-compound-fee-eb-auto-liq",
  tags: ["cross-module", "xo", "eb-update", "liquidation", "reactivation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit small
    await ctx.step(
      "deposit-small",
      async () => {
        await depositToCluster(ctx, record, "0.5");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update to 48 then liquidate
    await ctx.step(
      "eb-update-48",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, _post) => {},
    );

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

    // Step 3: EB update while liquidated
    await ctx.step(
      "eb-update-64-liquidated",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, _post) => {},
    );

    // Step 4: Reactivate with latest EB
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record, "30");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
      },
    );
  },
};

// ===========================================================================
// Removed Op + EB Cluster (XO-052 to XO-054)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-052: Replaced operator workflow
// ---------------------------------------------------------------------------
export const xo052ReplacedOperator: Scenario = {
  id: "XO-052-replaced-operator",
  tags: ["cross-module", "xo", "removed-operator", "eb-update", "remove-validator"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped(
        "No validators in cluster for XO-052",
      );
    }

    // Step 1: Remove op
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 2: EB update with removed op
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-still-removed-after-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    // Step 3: Remove last validator (empties cluster)
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "val-removed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-053: Fee change + privacy (same-block fee change and withdraw)
// ---------------------------------------------------------------------------
export const xo053FeeChangePrivacy: Scenario = {
  id: "XO-053-fee-change-privacy",
  tags: ["cross-module", "xo", "fee-change", "privacy", "same-block"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
      },
    );

    // Step 2: Immediately withdraw after fee change — index jump visible
    await ctx.step(
      "withdraw-immediate",
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
// XO-054: Removed op + deposit + mine
// ---------------------------------------------------------------------------
export const xo054RemovedOpDepositMine: Scenario = {
  id: "XO-054-removed-op-deposit-mine",
  tags: ["cross-module", "xo", "removed-operator", "deposit", "same-block"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.mineBlocks(100);

    // Step 1: Remove op
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 2: Withdraw — sees zeroed fee immediately
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertOperatorRemoved(post, op.id, "op-still-removed");
      },
    );
  },
};

// ===========================================================================
// EB-weighted Earnings (XO-055 to XO-057)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-055: Zero-fee operators with EB updates
// ---------------------------------------------------------------------------
export const xo055ZeroFeeOpsEB: Scenario = {
  id: "XO-055-zero-fee-ops-eb",
  tags: ["cross-module", "xo", "eb-update", "operator-earnings", "multi-cluster"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update — deviation from only the EB cluster
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Withdraw — earnings include EB-cluster deviation only
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-earnings`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-056: EB-weighted earnings — alternating EB updates and fee changes
// ---------------------------------------------------------------------------
export const xo056EBWeightedEarningsAlt: Scenario = {
  id: "XO-056-eb-weighted-earnings-alternating",
  tags: ["cross-module", "xo", "eb-update", "fee-change", "operator-earnings"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "15");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update 1
    await ctx.step(
      "eb-update-48",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(50);

    // Step 3: EB update 2
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb-64");
      },
    );

    await ctx.mineBlocks(50);

    // Step 4: Withdraw — earnings sum across segments
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-earnings`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-057: EB cluster liquidated, op removed, then reactivated
// ---------------------------------------------------------------------------
export const xo057EBLiqOpRemovedReact: Scenario = {
  id: "XO-057-eb-liq-op-removed-reactivated",
  tags: ["cross-module", "xo", "eb-update", "liquidation", "removed-operator", "reactivation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, _post) => {},
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

    // Step 3: Remove an operator
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 4: Reactivate — deviation only to active ops
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record, "30");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertOperatorRemoved(post, op.id, "op-still-removed-after-react");
      },
    );
  },
};

// ===========================================================================
// Multiple Removed Ops (XO-058 to XO-059)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-058: 1000 blocks with removed operator — 3-op burn rate correct
// ---------------------------------------------------------------------------
export const xo058LongDuration1000Blocks: Scenario = {
  id: "XO-058-1000-blocks-removed-op",
  tags: ["cross-module", "xo", "removed-operator", "long-duration"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Remove op
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 2: Mine 1000 blocks
    await ctx.mineBlocks(1000);

    // Step 3: Settle — 3-op burn rate
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertOperatorRemoved(post, op.id, "op-still-removed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-059: Withdraw after op removal from explicit-EB cluster
// ---------------------------------------------------------------------------
export const xo059WithdrawAfterOpRemovalEB: Scenario = {
  id: "XO-059-withdraw-after-op-removal-eb",
  tags: ["cross-module", "xo", "removed-operator", "eb-update", "withdraw"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    // Step 2: Remove op — remaining ops' vUnits unchanged
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Withdraw — vUnits still unchanged for remaining ops
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertOperatorRemoved(post, op.id, "op-still-removed");
        for (const opId of record.operatorIds) {
          if (opId !== op.id) {
            assertActiveOpVUnitsValid(post, opId, `op-${opId}-vunits`);
          }
        }
      },
    );
  },
};

// ===========================================================================
// EB + Multiple Validators (XO-060)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-060: Compound fee + EB increases trigger auto-liquidation
// ---------------------------------------------------------------------------
export const xo060CompoundFeeEBAutoLiq: Scenario = {
  id: "XO-060-compound-fee-eb-auto-liq",
  tags: ["cross-module", "xo", "fee-change", "eb-update", "auto-liquidation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, _post) => {},
    );

    // Step 2: Mine blocks to drain significantly
    await ctx.mineBlocks(3000);

    // Step 3: EB increase — may trigger auto-liquidation
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );
  },
};

// ===========================================================================
// Op Removal + EB + Settlement (XO-061 to XO-062)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-061: Replace removed op with new op in new cluster
// ---------------------------------------------------------------------------
export const xo061ReplaceRemovedOp: Scenario = {
  id: "XO-061-replace-removed-op",
  tags: ["cross-module", "xo", "removed-operator", "new-cluster"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Remove an operator
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 2: Deposit — cluster still works with remaining ops
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "deposit-after-op-removal");
        assertClusterActive(post, "after-deposit");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-062: Withdraw earnings then remove operator — no double payout
// ---------------------------------------------------------------------------
export const xo062WithdrawEarningsThenRemove: Scenario = {
  id: "XO-062-withdraw-earnings-then-remove",
  tags: ["cross-module", "xo", "operator-earnings", "removed-operator", "no-double-payout"],

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

    await ctx.mineBlocks(200);

    // Step 2: Remove op — settlement includes earnings withdrawal
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 3: Withdraw — no double payout
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
      },
    );
  },
};

// ===========================================================================
// Advanced EB Scenarios (XO-063 to XO-064)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-063: Zero-fee operator + EB update — deviation written, burn = 0
// ---------------------------------------------------------------------------
export const xo063ZeroFeeOpEB: Scenario = {
  id: "XO-063-zero-fee-op-eb",
  tags: ["cross-module", "xo", "eb-update", "zero-fee", "operator-earnings"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update — deviation written for all ops
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
        for (const opId of record.operatorIds) {
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-vunits`);
        }
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Withdraw — verify earnings
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-earnings`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-064: Remove one validator from 2-validator EB cluster — earnings recalculated
// ---------------------------------------------------------------------------
export const xo064RemoveOneValEB: Scenario = {
  id: "XO-064-remove-one-val-eb-earnings",
  tags: ["cross-module", "xo", "eb-update", "remove-validator", "operator-earnings"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    if (record.validatorKeys.length < 2) {
      throw new ScenarioSkipped(
        "Need at least 2 validators for XO-064",
      );
    }

    // Step 1: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    await ctx.mineBlocks(100);

    // Step 2: Remove one validator
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "val-removed");
        assertDaoVUnitsNonNegative(post, "dao-after-remove");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Withdraw — earnings recalculated with updated vUnits
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-earnings`);
        }
      },
    );
  },
};

// ===========================================================================
// Various Removed Op Edge Cases (XO-065 to XO-068)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-065: Removed op1 stale vUnits don't contaminate op2 earnings
// ---------------------------------------------------------------------------
export const xo065StaleVUnitsNoContamination: Scenario = {
  id: "XO-065-stale-vunits-no-contamination",
  tags: ["cross-module", "xo", "removed-operator", "eb-update", "operator-earnings"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(100);

    // Step 2: Remove op1
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 3: Verify remaining ops' earnings are valid (no contamination)
    await ctx.step(
      "verify-other-op-earnings",
      async () => {},
      async (_pre, post) => {
        for (const opId of record.operatorIds) {
          if (opId !== op.id) {
            assertOperatorEarningsValid(post, opId, `op-${opId}-no-contamination`);
            assertActiveOpVUnitsValid(post, opId, `op-${opId}-vunits`);
          }
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-066: removeOperator then liquidate — no underflow
// ---------------------------------------------------------------------------
export const xo066RemoveOpThenLiquidate: Scenario = {
  id: "XO-066-remove-op-then-liquidate",
  tags: ["cross-module", "xo", "removed-operator", "liquidation", "underflow"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit small
    await ctx.step(
      "deposit-small",
      async () => {
        await depositToCluster(ctx, record, "0.5");
      },
      async (_pre, _post) => {},
    );

    // Step 2: Remove op
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 3: Drain and liquidate with 3-op burn rate — no underflow
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
        assertOperatorRemoved(post, op.id, "op-still-removed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-067: removeOperator then remove last validator — no underflow
// ---------------------------------------------------------------------------
export const xo067RemoveOpThenRemoveLastVal: Scenario = {
  id: "XO-067-remove-op-then-remove-last-val",
  tags: ["cross-module", "xo", "removed-operator", "remove-validator", "underflow"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped(
        "No validators in cluster for XO-067",
      );
    }

    // Step 1: Remove op
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 2: Remove last validator — no underflow
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "val-removed");
        assertDaoVUnitsNonNegative(post, "dao-after-remove-val");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XO-068: Shared removed op + other cluster EB update — guard skips removed op
// ---------------------------------------------------------------------------
export const xo068SharedRemovedOpOtherClusterEB: Scenario = {
  id: "XO-068-shared-removed-op-other-cluster-eb",
  tags: ["cross-module", "xo", "removed-operator", "eb-update", "multi-cluster", "guard"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: Remove an operator
    const op = findActiveOp(ctx, record);
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-removed");
      },
    );

    // Step 2: EB update — guard skips removed op
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-still-removed-after-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
        for (const opId of record.operatorIds) {
          if (opId !== op.id) {
            assertActiveOpVUnitsValid(post, opId, `op-${opId}-vunits`);
          }
        }
      },
    );
  },
};

// ===========================================================================
// Reactivation with Deviation (XO-069)
// ===========================================================================

// ---------------------------------------------------------------------------
// XO-069: Remove one of multiple validators from explicit-EB cluster
// ---------------------------------------------------------------------------
export const xo069ReactivationWithDeviationFromOtherCluster: Scenario = {
  id: "XO-069-reactivation-deviation-other-cluster",
  tags: ["cross-module", "xo", "eb-update", "reactivation", "multi-cluster", "deviation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const valCount = record.validatorKeys.length || 1;

    // Step 1: EB update — creates deviation
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    // Step 2: Deposit small and drain for liquidation
    await ctx.step(
      "deposit-small",
      async () => {
        await depositToCluster(ctx, record, "0.5");
      },
      async (_pre, _post) => {},
    );

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

    // Step 4: Reactivate — deviation from EB persists
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record, "30");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertDaoVUnitsNonNegative(post, "dao-after-react");
      },
    );
  },
};
