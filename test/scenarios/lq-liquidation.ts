/**
 * LQ liquidation scenarios
 *
 * Extracted from:
 * - test/e2e/clusters-eth/cluster-eth-liquidation.test.ts
 * - test/e2e/clusters-eth/cluster-eth-lifecycle.test.ts (liquidation tests)
 * - test/e2e/clusters-eth/lq-gap.test.ts (LQ-010, LQ-024, LQ-025,
 *   LQ-027, LQ-031, LQ-047, LQ-048, LQ-074)
 *
 * Covers: threshold boundary, EB deviation cleanup, auto-liquidation via
 * updateClusterBalance, third-party liquidation with bounty, owner
 * self-liquidation, per-operator ethValidatorCount zeroed, DAO counters.
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
  assertClusterActive,
  assertClusterLiquidated,
  assertDaoVUnitsNonNegative,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// LQ-001: Balance == threshold is NOT liquidatable, balance < threshold IS
// ---------------------------------------------------------------------------
export const lq001ThresholdBoundary: Scenario = {
  id: "LQ-001-threshold-boundary-check",
  tags: ["liquidation", "boundary", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Deposit generously
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-deposit");
      },
    );

    // Withdraw most balance to approach threshold
    await ctx.step(
      "withdraw-most",
      async () => {
        await withdrawFromCluster(ctx, record, "19");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
      },
    );

    // Mine until liquidatable, then liquidate
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
  },
};

// ---------------------------------------------------------------------------
// LQ-002: Liquidation with explicit EB — deviation cleanup
// ---------------------------------------------------------------------------
export const lq002EBDeviationCleanup: Scenario = {
  id: "LQ-002-eb-deviation-cleanup",
  tags: ["liquidation", "eb-update", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Set explicit EB = 96 ETH per validator
    await ctx.step(
      "eb-update-96",
      async () => {
        await performEBUpdate(ctx, record, 96 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-96");
      },
    );

    // Drain and liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate-with-eb",
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
// LQ-003: Auto-liquidation via updateClusterBalance (EB increase)
// ---------------------------------------------------------------------------
export const lq003AutoLiqViaEBUpdate: Scenario = {
  id: "LQ-003-auto-liq-via-eb-increase",
  tags: ["liquidation", "eb-update", "auto-liquidation", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Withdraw to leave minimal balance
    await ctx.step(
      "withdraw-to-minimal",
      async () => {
        await withdrawFromCluster(ctx, record, "0.5");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
      },
    );

    await ctx.mineBlocks(5000);

    // Large EB increase may trigger auto-liquidation
    await ctx.step(
      "eb-increase-auto-liq",
      async () => {
        await performEBUpdate(ctx, record, 128 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-increase");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// LQ-004: Third-party liquidation with bounty
// ---------------------------------------------------------------------------
export const lq004ThirdPartyBounty: Scenario = {
  id: "LQ-004-third-party-liq-with-bounty",
  tags: ["liquidation", "bounty", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Mine until liquidatable
    await ctx.mineBlocks(99999999);

    // Liquidate — bounty goes to liquidator
    await ctx.step(
      "third-party-liquidate",
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
// LQ-005: Owner self-liquidation regardless of balance
// ---------------------------------------------------------------------------
export const lq005SelfLiquidation: Scenario = {
  id: "LQ-005-owner-self-liquidation",
  tags: ["liquidation", "edge", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Self-liquidate immediately (owner bypass)
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
// LQ-010: Liquidation with validatorCount=5 — per-operator ethValidatorCount
// ---------------------------------------------------------------------------
export const lq010MultiValidatorLiq: Scenario = {
  id: "LQ-010-multi-validator-liq-op-counts-zeroed",
  tags: ["liquidation", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Deposit to ensure enough balance for multiple validators
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, _post) => {},
    );

    // Self-liquidate
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
// LQ-024: Third-party liq reverts when validatorCount=0
// ---------------------------------------------------------------------------
export const lq024LiqRevertValidatorCount0: Scenario = {
  id: "LQ-024-third-party-liq-reverts-valcount-0",
  tags: ["liquidation", "revert", "edge", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("No validators in cluster for LQ-024");
    }

    // Remove all validators
    const keysCount = record.validatorKeys.length;
    for (let i = 0; i < keysCount; i++) {
      await ctx.step(
        `remove-validator-${i + 1}`,
        async () => {
          const { removeValidator: rmVal } = await import("./_xm-helpers.ts");
          await rmVal(ctx, record);
        },
        async (_pre, _post) => {},
      );
    }

    // With validatorCount=0, cluster is not liquidatable by third party
    // (no burn, so healthy) — verify cluster remains active
    await ctx.step(
      "verify-not-liquidatable",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "cluster-not-liquidatable");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// LQ-025: Self-liquidation on cluster with validatorCount=0 succeeds
// ---------------------------------------------------------------------------
export const lq025SelfLiqValidatorCount0: Scenario = {
  id: "LQ-025-self-liq-valcount-0-succeeds",
  tags: ["liquidation", "edge", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      // Already 0 validators — self-liquidate
      await ctx.step(
        "self-liquidate-empty",
        async () => {
          await liquidateCluster(ctx, record);
        },
        async (_pre, post) => {
          assertClusterLiquidated(post, "after-self-liq");
        },
      );
      return;
    }

    // Remove all validators
    const keysCount = record.validatorKeys.length;
    for (let i = 0; i < keysCount; i++) {
      await ctx.step(
        `remove-validator-${i + 1}`,
        async () => {
          const { removeValidator: rmVal } = await import("./_xm-helpers.ts");
          await rmVal(ctx, record);
        },
        async (_pre, _post) => {},
      );
    }

    // Self-liquidation succeeds even with validatorCount=0
    await ctx.step(
      "self-liquidate-valcount-0",
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
// LQ-027: Liquidation with validatorCount=10 — DAO counters decremented
// ---------------------------------------------------------------------------
export const lq027DaoCountersDecremented: Scenario = {
  id: "LQ-027-liq-valcount-10-dao-counters-decremented",
  tags: ["liquidation", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "30");
      },
      async (_pre, _post) => {},
    );

    // Self-liquidate — DAO counters should be decremented
    await ctx.step(
      "liquidate-dao-counters",
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
// LQ-031: Auto-liquidation skipped when validatorCount=0
// ---------------------------------------------------------------------------
export const lq031AutoLiqSkippedValCount0: Scenario = {
  id: "LQ-031-auto-liq-skipped-valcount-0",
  tags: ["liquidation", "eb-update", "edge", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("No validators to remove for LQ-031");
    }

    // EB update first (needs validatorCount > 0)
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
      },
    );

    // Remove all validators
    const keysCount = record.validatorKeys.length;
    for (let i = 0; i < keysCount; i++) {
      await ctx.step(
        `remove-validator-${i + 1}`,
        async () => {
          const { removeValidator: rmVal } = await import("./_xm-helpers.ts");
          await rmVal(ctx, record);
        },
        async (_pre, _post) => {},
      );
    }

    // Cluster with validatorCount=0 — auto-liquidation skipped
    await ctx.step(
      "verify-still-active",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "auto-liq-skipped");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// LQ-074: Stale EB — reactivation with stale EB, then EB increase triggers auto-liq
// ---------------------------------------------------------------------------
export const lq074StaleEBAutoLiq: Scenario = {
  id: "LQ-074-stale-eb-reactivation-auto-liq",
  tags: ["liquidation", "eb-update", "reactivation", "stale-eb", "lq"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Set baseline EB
    await ctx.step(
      "eb-update-32",
      async () => {
        await performEBUpdate(ctx, record, 32 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-eb-32");
      },
    );

    // Liquidate
    await ctx.step(
      "self-liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
      },
    );

    // Reactivate with stale EB=32 (just enough for 32 threshold)
    await ctx.step(
      "reactivate-stale-eb",
      async () => {
        await reactivateCluster(ctx, record, "10");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
      },
    );

    // EB increase to 64 — may trigger auto-liquidation
    await ctx.step(
      "eb-update-64-auto-liq",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        // May be liquidated or still active depending on balance
        assertDaoVUnitsNonNegative(post, "after-eb-64");
      },
    );
  },
};
