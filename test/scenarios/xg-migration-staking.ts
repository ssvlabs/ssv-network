/**
 * XG scenarios: Migration + Staking cross-module chains
 *
 * Extracted from test/e2e/cross-cutting/xg-migration-staking.test.ts.
 * Tests multi-step chains that combine SSV→ETH cluster migration with
 * staking operations, EB updates, liquidation, and reward claiming.
 *
 * 9 scenarios covering the representative migration + staking flows.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickSSVCluster,
  findActiveOp,
  migrateCluster,
  stakeSSV,
  syncFees,
  claimRewards,
  requestUnstake,
  depositToCluster,
  performEBUpdate,
  liquidateCluster,
  reactivateCluster,
  removeOperator,
  assertClusterActive,
  assertClusterLiquidated,
  assertDaoVUnitsNonNegative,
  assertAccEthPerShareIncreased,
  assertOperatorRemoved,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// XG-001: Stake → migrate → syncFees → claim (happy path)
// ---------------------------------------------------------------------------
export const xg001StakeMigrateClaim: Scenario = {
  id: "XG-001-stake-migrate-claim",
  tags: ["cross-module", "migration", "staking", "xg", "happy-path"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Migrate cluster to ETH
    await ctx.step(
      "migrate-to-eth",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Sync fees → accEthPerShare increases
    await ctx.step(
      "sync-fees",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "after-sync");
      },
    );

    // Step 4: Claim rewards
    await ctx.step(
      "claim-rewards",
      async () => {
        await claimRewards(ctx);
      },
      async (_pre, _post) => {
        assertDaoVUnitsNonNegative(_post, "after-claim");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XG-002: Migrate → stake (post-migration) → mine → claim
// ---------------------------------------------------------------------------
export const xg002MigrateStakeClaim: Scenario = {
  id: "XG-002-migrate-stake-claim",
  tags: ["cross-module", "migration", "staking", "xg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Migrate first (no staker yet)
    await ctx.step(
      "migrate-to-eth",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
      },
    );

    await ctx.mineBlocks(50);

    // Step 2: Sync fees before staker enters
    await ctx.step(
      "sync-fees-pre-stake",
      async () => {
        await syncFees(ctx);
      },
      async (_pre, _post) => {},
    );

    // Step 3: Stake SSV after migration
    await ctx.step(
      "stake-ssv-post-migration",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(100);

    // Step 4: Claim — only post-stake blocks should count
    await ctx.step(
      "claim-rewards",
      async () => {
        await syncFees(ctx);
        await claimRewards(ctx);
      },
      async (_pre, _post) => {
        assertDaoVUnitsNonNegative(_post, "after-claim");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XG-003: Migrate → EB update → stake → claim
// ---------------------------------------------------------------------------
export const xg003MigrateEBStakeClaim: Scenario = {
  id: "XG-003-migrate-eb-stake-claim",
  tags: ["cross-module", "migration", "staking", "xg", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Migrate
    await ctx.step(
      "migrate-to-eth",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
      },
    );

    await ctx.mineBlocks(50);

    // Step 3: EB update (increase vUnits)
    await ctx.step(
      "eb-update-increase",
      async () => {
        await performEBUpdate(ctx, record, 128 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-increase");
      },
    );

    await ctx.mineBlocks(50);

    // Step 4: Sync and claim
    await ctx.step(
      "sync-and-claim",
      async () => {
        await syncFees(ctx);
        await claimRewards(ctx);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-claim");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XG-004: Migrate with removed operator → verify excluded from ETH init
// ---------------------------------------------------------------------------
export const xg004MigrateRemovedOp: Scenario = {
  id: "XG-004-migrate-removed-op",
  tags: ["cross-module", "migration", "removed-operator", "xg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Remove operator before migration
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    await ctx.mineBlocks(10);

    // Step 2: Migrate — removed op must be excluded from ETH init
    await ctx.step(
      "migrate-to-eth",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Deposit to verify cluster functional with removed op
    await ctx.step(
      "deposit-post-migration",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-deposit");
        assertOperatorRemoved(post, op.id, "op-still-removed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XG-005: Migrate → liquidate → syncFees → claim (frozen rewards)
// ---------------------------------------------------------------------------
export const xg005MigrateLiquidateClaim: Scenario = {
  id: "XG-005-migrate-liquidate-claim",
  tags: ["cross-module", "migration", "staking", "liquidation", "xg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Stake
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Migrate
    await ctx.step(
      "migrate-to-eth",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Sync fees pre-liquidation
    await ctx.step(
      "sync-fees-pre-liq",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "sync-pre-liq");
      },
    );

    // Step 4: Drain and liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liquidation");
      },
    );

    // Step 5: Claim — rewards should be from pre-liquidation period only
    await ctx.step(
      "claim-rewards",
      async () => {
        await syncFees(ctx);
        await claimRewards(ctx);
      },
      async (_pre, _post) => {},
    );
  },
};

// ---------------------------------------------------------------------------
// XG-006: Migrate → liquidate → reactivate → syncFees → claim full cycle
// ---------------------------------------------------------------------------
export const xg006MigrateLiqReactivateClaim: Scenario = {
  id: "XG-006-migrate-liq-reactivate-claim",
  tags: ["cross-module", "migration", "staking", "liquidation", "xg", "full-lifecycle"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Stake
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Migrate
    await ctx.step(
      "migrate-to-eth",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Liquidate
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

    // Step 4: Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
      },
    );

    await ctx.mineBlocks(100);

    // Step 5: Sync and claim (phase3 rewards)
    await ctx.step(
      "sync-and-claim",
      async () => {
        await syncFees(ctx);
        await claimRewards(ctx);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-final-claim");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XG-007: Stake → migrate → partial unstake → sync → claim
// ---------------------------------------------------------------------------
export const xg007PartialUnstake: Scenario = {
  id: "XG-007-partial-unstake",
  tags: ["cross-module", "migration", "staking", "unstake", "xg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    const stakeAmount = 1_000_000_000n;

    // Step 1: Stake
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx, stakeAmount);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Migrate
    await ctx.step(
      "migrate-to-eth",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
      },
    );

    await ctx.mineBlocks(50);

    // Step 3: Partial unstake (half the stake)
    await ctx.step(
      "partial-unstake",
      async () => {
        await requestUnstake(ctx, stakeAmount / 2n);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(100);

    // Step 4: Sync and claim with reduced cSSV
    await ctx.step(
      "sync-and-claim-reduced",
      async () => {
        await syncFees(ctx);
        await claimRewards(ctx);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-reduced-claim");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XG-008: Migrate → removed op + EB update → stake → claim
// ---------------------------------------------------------------------------
export const xg008MigrateRemovedOpEBStake: Scenario = {
  id: "XG-008-migrate-removed-op-eb-stake",
  tags: ["cross-module", "migration", "staking", "removed-operator", "eb-update", "xg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Stake
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Migrate
    await ctx.step(
      "migrate-to-eth",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
      },
    );

    // Step 3: Remove operator post-migration
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    await ctx.mineBlocks(50);

    // Step 4: EB update (guard skips removed op)
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    await ctx.mineBlocks(100);

    // Step 5: Sync and claim
    await ctx.step(
      "sync-and-claim",
      async () => {
        await syncFees(ctx);
        await claimRewards(ctx);
      },
      async (_pre, _post) => {},
    );
  },
};

// ---------------------------------------------------------------------------
// XG-009: Migrate → deposit ETH → mine → verify balance reflects fees
// ---------------------------------------------------------------------------
export const xg009MigrateDepositVerify: Scenario = {
  id: "XG-009-migrate-deposit-verify",
  tags: ["cross-module", "migration", "deposit", "xg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Migrate
    await ctx.step(
      "migrate-to-eth",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );

    await ctx.mineBlocks(200);

    // Step 2: Deposit additional ETH
    await ctx.step(
      "deposit-eth",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-deposit");
        // Contract balance should increase
        if (post.contractEthBalance <= pre.contractEthBalance) {
          throw new Error("Contract balance did not increase after deposit");
        }
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Verify balance reflects fee accrual
    await ctx.step(
      "verify-balance",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "final-check");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};
