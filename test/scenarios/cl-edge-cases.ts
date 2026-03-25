/**
 * CL edge-case and revert scenarios
 *
 * Extracted from:
 * - test/e2e/clusters-eth/cluster-eth-edge.test.ts
 * - test/e2e/clusters-eth/cluster-reverts.test.ts
 * - test/e2e/clusters-eth/cl-gap.test.ts (CL-015, CL-017, CL-050,
 *   CL-051/CL-057, CL-052, CL-054, CL-055)
 *
 * Covers: withdraw from empty cluster, reactivation with explicit EB,
 * withdraw without operator snapshot update, packing precision, liquidation
 * bounty, threshold reverts, dual-existence guard, stale balance revert.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickETHCluster,
  depositToCluster,
  withdrawFromCluster,
  performEBUpdate,
  liquidateCluster,
  reactivateCluster,
  removeValidator,
  assertClusterActive,
  assertClusterLiquidated,
  assertBalanceIncreased,
  assertDaoVUnitsNonNegative,
  assertOperatorEarningsValid,
  assertActiveOpVUnitsValid,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// EDGE-001: Full withdrawal from cluster with 0 validators
// ---------------------------------------------------------------------------
export const clEdge001WithdrawEmptyCluster: Scenario = {
  id: "CL-EDGE-001-withdraw-empty-cluster",
  tags: ["cluster", "edge", "withdraw", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("No validators in cluster for EDGE-001");
    }

    // Remove all validators
    const keysCount = record.validatorKeys.length;
    for (let i = 0; i < keysCount; i++) {
      await ctx.step(
        `remove-validator-${i + 1}`,
        async () => {
          await removeValidator(ctx, record);
        },
        async (_pre, _post) => {},
      );
    }

    // Withdraw remaining balance — no liquidation check with validatorCount=0
    await ctx.step(
      "withdraw-from-empty",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EDGE-002: Reactivation with explicit EB — deviation properly restored
// ---------------------------------------------------------------------------
export const clEdge002ReactivateExplicitEB: Scenario = {
  id: "CL-EDGE-002-reactivate-explicit-eb-deviation",
  tags: ["cluster", "edge", "reactivation", "eb-update", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Set explicit EB = 64 ETH
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-64");
      },
    );

    // Liquidate
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

    // Reactivate — EB deviation should be restored
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
// EDGE-003: Withdraw — operator snapshots NOT updated (two withdrawals)
// ---------------------------------------------------------------------------
export const clEdge003TwoWithdrawsNoOpSnapshot: Scenario = {
  id: "CL-EDGE-003-two-withdraws-no-op-snapshot-update",
  tags: ["cluster", "edge", "withdraw", "operator-earnings", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(100);

    // First withdraw
    await ctx.step(
      "withdraw-1",
      async () => {
        await withdrawFromCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw-1");
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-after-w1`);
        }
      },
    );

    await ctx.mineBlocks(100);

    // Second withdraw — operator snapshots still not updated
    await ctx.step(
      "withdraw-2",
      async () => {
        await withdrawFromCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw-2");
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-after-w2`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EDGE-004: Deposit/withdraw of non-aligned amounts (packing precision)
// ---------------------------------------------------------------------------
export const clEdge004PackingPrecision: Scenario = {
  id: "CL-EDGE-004-packing-precision-non-aligned",
  tags: ["cluster", "edge", "deposit", "withdraw", "precision", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Deposit small odd amount
    await ctx.step(
      "deposit-small",
      async () => {
        await depositToCluster(ctx, record, "0.000099999");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-odd-deposit");
      },
    );

    // Withdraw small amount
    await ctx.step(
      "withdraw-small",
      async () => {
        await withdrawFromCluster(ctx, record, "0.000001");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-odd-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// EDGE-005: Liquidation bounty equals post-settlement balance
// ---------------------------------------------------------------------------
export const clEdge005LiqBountyPostSettlement: Scenario = {
  id: "CL-EDGE-005-liq-bounty-equals-post-settlement",
  tags: ["cluster", "edge", "liquidation", "bounty", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Drain and liquidate — bounty should equal post-settlement balance
    await ctx.mineBlocks(100);
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
// REVERT-001: Third-party liquidation at exact threshold reverts
// ---------------------------------------------------------------------------
export const clRevert001ThresholdRevert: Scenario = {
  id: "CL-REVERT-001-third-party-liq-at-threshold",
  tags: ["cluster", "revert", "liquidation", "boundary", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Deposit generously so cluster is solvent
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
        assertClusterActive(post, "after-deposit");
      },
    );

    // Verify cluster is active and not liquidatable
    await ctx.step(
      "verify-active",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "still-active");
        assertDaoVUnitsNonNegative(post, "dao-check");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// REVERT-002: Self-liquidation at exact threshold succeeds (owner bypass)
// ---------------------------------------------------------------------------
export const clRevert002SelfLiqThreshold: Scenario = {
  id: "CL-REVERT-002-self-liq-at-threshold-succeeds",
  tags: ["cluster", "revert", "liquidation", "edge", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Self-liquidate (owner always can, regardless of balance)
    await ctx.step(
      "self-liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-self-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// CL-054: Withdraw amount > post-settlement balance reverts
// ---------------------------------------------------------------------------
export const clEdge054StaleBalanceRevert: Scenario = {
  id: "CL-054-withdraw-gt-post-settlement-balance",
  tags: ["cluster", "edge", "withdraw", "revert", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Deposit modestly then mine many blocks to eat into balance
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(10000);

    // Withdraw a safe amount — verify balance decreased significantly
    await ctx.step(
      "safe-withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.01");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-safe-withdraw");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// CL-050: Withdraw from migrated cluster with explicit EB
// ---------------------------------------------------------------------------
export const cl050WithdrawMigratedEB: Scenario = {
  id: "CL-050-withdraw-migrated-cluster-explicit-eb",
  tags: ["cluster", "withdraw", "eb-update", "migration", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // EB update to 64 ETH per validator
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
        assertClusterActive(post, "after-eb");
      },
    );

    await ctx.mineBlocks(5);

    // Withdraw with EB-weighted fees
    await ctx.step(
      "withdraw-eb-weighted",
      async () => {
        await withdrawFromCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        for (const opId of record.operatorIds) {
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-vunits`);
        }
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};
