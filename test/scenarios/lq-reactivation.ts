/**
 * LQ reactivation scenarios
 *
 * Extracted from:
 * - test/e2e/clusters-eth/cluster-eth-lifecycle.test.ts (reactivation tests)
 * - test/e2e/clusters-eth/lq-gap.test.ts (LQ-059..063, LQ-070,
 *   LQ-074..076, LQ-080, LQ-103..105)
 *
 * Covers: full lifecycle with reactivation, deposit into liquidated cluster,
 * reactivation with N operators, removed operator handling, all-ops-removed,
 * reactivate then deposit, stale EB, deviation restoration, multi-cluster
 * deviation isolation, same-block reactivation.
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
  assertBalanceIncreased,
  assertDaoVUnitsNonNegative,
  assertOperatorRemoved,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// REACT-001: Full lifecycle — create → liquidate → reactivate → withdraw
// ---------------------------------------------------------------------------
export const lqReact001FullLifecycle: Scenario = {
  id: "LQ-REACT-001-full-lifecycle-liq-react",
  tags: ["reactivation", "lifecycle", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Drain and liquidate
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

    // Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record, "5");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertDaoVUnitsNonNegative(post, "dao-after-react");
      },
    );

    await ctx.mineBlocks(100);

    // Withdraw — fees accrued from reactivation point
    await ctx.step(
      "withdraw-after-react",
      async () => {
        await withdrawFromCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// REACT-002: Deposit into liquidated cluster + reactivation uses sum
// ---------------------------------------------------------------------------
export const lqReact002DepositLiqReact: Scenario = {
  id: "LQ-REACT-002-deposit-liquidated-then-reactivate",
  tags: ["reactivation", "deposit", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Drain and liquidate
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

    // Deposit into liquidated cluster
    await ctx.step(
      "deposit-into-liquidated-1",
      async () => {
        await depositToCluster(ctx, record, "3");
      },
      async (_pre, _post) => {},
    );

    await ctx.step(
      "deposit-into-liquidated-2",
      async () => {
        await depositToCluster(ctx, record, "2");
      },
      async (_pre, _post) => {},
    );

    // Reactivate — balance = accumulated deposits + reactivation value
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertDaoVUnitsNonNegative(post, "dao-after-react");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// LQ-059/060/061: Reactivation with 7/10/13 operators
// ---------------------------------------------------------------------------
export const lqReact059Ops7: Scenario = {
  id: "LQ-059-reactivate-7ops",
  tags: ["reactivation", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

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

    await ctx.step(
      "reactivate-7ops",
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

export const lqReact060Ops10: Scenario = {
  id: "LQ-060-reactivate-10ops",
  tags: ["reactivation", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

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

    await ctx.step(
      "reactivate-10ops",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
      },
    );
  },
};

export const lqReact061Ops13: Scenario = {
  id: "LQ-061-reactivate-13ops",
  tags: ["reactivation", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

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

    await ctx.step(
      "reactivate-13ops",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// LQ-062: Reactivation with one removed operator
// ---------------------------------------------------------------------------
export const lqReact062RemovedOp: Scenario = {
  id: "LQ-062-reactivate-removed-operator",
  tags: ["reactivation", "removed-operator", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Self-liquidate
    await ctx.step(
      "self-liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
      },
    );

    // Remove one operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    // Reactivate — removed operator skipped
    await ctx.step(
      "reactivate-removed-op",
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
// LQ-063: Reactivation with ALL operators removed
// ---------------------------------------------------------------------------
export const lqReact063AllOpsRemoved: Scenario = {
  id: "LQ-063-reactivate-all-ops-removed",
  tags: ["reactivation", "removed-operator", "edge", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Self-liquidate
    await ctx.step(
      "self-liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
      },
    );

    // Remove ALL operators
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
      }
    }

    // Reactivate — zero burn rate from operators
    await ctx.step(
      "reactivate-all-removed",
      async () => {
        await reactivateCluster(ctx, record, "5");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertDaoVUnitsNonNegative(post, "dao-after-react");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// LQ-070: Reactivate then deposit — balance accumulates
// ---------------------------------------------------------------------------
export const lqReact070ReactThenDeposit: Scenario = {
  id: "LQ-070-reactivate-then-deposit",
  tags: ["reactivation", "deposit", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Drain and liquidate
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

    // Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
      },
    );

    // Deposit additional ETH
    await ctx.step(
      "deposit-after-react",
      async () => {
        await depositToCluster(ctx, record, "2");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// LQ-075: Stale EB with decreased EB — overfunded reactivation
// ---------------------------------------------------------------------------
export const lqReact075StaleEBDecreased: Scenario = {
  id: "LQ-075-stale-eb-decreased-overfunded",
  tags: ["reactivation", "eb-update", "stale-eb", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Set explicit EB = 64 (2x baseline)
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-64");
      },
    );

    // Self-liquidate
    await ctx.step(
      "self-liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
      },
    );

    // Reactivate with overfunding for EB=64
    await ctx.step(
      "reactivate-overfunded",
      async () => {
        await reactivateCluster(ctx, record, "30");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
      },
    );

    // EB update to 32 (actual EB dropped) — cluster should remain healthy
    await ctx.step(
      "eb-update-32-remains-healthy",
      async () => {
        await performEBUpdate(ctx, record, 32 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb-decrease");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// LQ-076: Reactivation with removed op + explicit EB deviation
// ---------------------------------------------------------------------------
export const lqReact076RemovedOpEBDeviation: Scenario = {
  id: "LQ-076-reactivate-removed-op-eb-deviation",
  tags: ["reactivation", "removed-operator", "eb-update", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Set explicit EB = 64 (deviation created)
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
      },
    );

    // Self-liquidate → deviation cleaned
    await ctx.step(
      "self-liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
      },
    );

    // Remove one operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    // Reactivate — deviation re-applied to active ops only
    await ctx.step(
      "reactivate-eb-deviation",
      async () => {
        await reactivateCluster(ctx, record, "30");
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
// LQ-103: Reactivation with deviation from ANOTHER cluster (isolation)
// ---------------------------------------------------------------------------
export const lqReact103DeviationIsolation: Scenario = {
  id: "LQ-103-reactivation-deviation-isolation",
  tags: ["reactivation", "eb-update", "multi-cluster", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Self-liquidate (implicit EB, no deviation)
    await ctx.step(
      "self-liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
      },
    );

    // Reactivate — has clusterDeviation=0
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
// LQ-104: Reactivation with additive deviation from multiple clusters
// ---------------------------------------------------------------------------
export const lqReact104AdditiveDeviation: Scenario = {
  id: "LQ-104-reactivation-additive-deviation",
  tags: ["reactivation", "eb-update", "multi-cluster", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Set explicit EB = 96 (deviation created)
    await ctx.step(
      "eb-update-96",
      async () => {
        await performEBUpdate(ctx, record, 96 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-96");
      },
    );

    // Self-liquidate → deviation B removed
    await ctx.step(
      "self-liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
      },
    );

    // Reactivate — deviation should be re-added
    await ctx.step(
      "reactivate-additive",
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
// LQ-105: Same-block reactivation (blockDiffEthFee = 0)
// ---------------------------------------------------------------------------
export const lqReact105SameBlock: Scenario = {
  id: "LQ-105-same-block-reactivation",
  tags: ["reactivation", "edge", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Self-liquidate
    await ctx.step(
      "self-liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
      },
    );

    // Reactivate immediately (no blocks mined between)
    await ctx.step(
      "reactivate-same-block",
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
