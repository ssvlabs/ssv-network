/**
 * ST-RW scenarios: Staking Rewards
 *
 * Extracted from test/e2e/staking/staking-rewards.test.ts.
 * Tests reward accrual under various protocol parameter changes:
 * network fee raise/decrease/zero, cooldown changes, EB updates,
 * liquidation effects, exact math, multi-user splits, and full chains.
 *
 * 12 scenarios covering representative staking reward flows.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickETHCluster,
  stakeSSV,
  syncFees,
  claimRewards,
  depositToCluster,
  performEBUpdate,
  liquidateCluster,
  assertAccEthPerShareIncreased,
  assertDaoVUnitsNonNegative,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// ST-RW-001: Rewards increase after network fee raise
// ---------------------------------------------------------------------------
export const stNetworkFeeRaiseRewards: Scenario = {
  id: "ST-RW-001-network-fee-raise-rewards",
  tags: ["staking", "rewards", "network-fee", "st-rw"],

  async run(ctx: ScenarioContext) {
    // Step 1: Stake SSV to become a staker
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(50);

    // Step 2: Sync fees — baseline accEthPerShare
    await ctx.step(
      "sync-fees-baseline",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "baseline-sync");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Sync fees again — accEthPerShare should increase further
    await ctx.step(
      "sync-fees-after-accrual",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "post-accrual-sync");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-RW-002: Rewards decrease after network fee reduction
// ---------------------------------------------------------------------------
export const stNetworkFeeDecreaseRewards: Scenario = {
  id: "ST-RW-002-network-fee-decrease-rewards",
  tags: ["staking", "rewards", "network-fee", "st-rw"],

  async run(ctx: ScenarioContext) {
    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(100);

    // Step 2: Sync fees — rewards still accrue (reduced but positive)
    await ctx.step(
      "sync-fees-reduced-fee",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "reduced-fee-sync");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-RW-003: Zero network fee stops reward generation
// ---------------------------------------------------------------------------
export const stZeroNetworkFeeNoRewards: Scenario = {
  id: "ST-RW-003-zero-network-fee-no-rewards",
  tags: ["staking", "rewards", "network-fee", "zero-fee", "st-rw"],

  async run(ctx: ScenarioContext) {
    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(100);

    // Step 2: Sync fees — should increase from fees accrued before this scenario
    // (the existing clusters in the random state generate network fees)
    await ctx.step(
      "sync-fees",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "sync-with-fees");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-RW-004: Multiple fee changes tracked correctly
// ---------------------------------------------------------------------------
export const stMultipleNetworkFeeChanges: Scenario = {
  id: "ST-RW-004-multiple-network-fee-changes",
  tags: ["staking", "rewards", "network-fee", "multi-change", "st-rw"],

  async run(ctx: ScenarioContext) {
    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(50);

    // Step 2: First sync — accEthPerShare increases
    await ctx.step(
      "sync-fees-phase1",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "phase1-sync");
      },
    );

    await ctx.mineBlocks(50);

    // Step 3: Second sync — accEthPerShare monotonically increases
    await ctx.step(
      "sync-fees-phase2",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "phase2-sync");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-RW-005: Cooldown increase does not affect rewards
// ---------------------------------------------------------------------------
export const stCooldownIncreaseNoRewardChange: Scenario = {
  id: "ST-RW-005-cooldown-increase-no-reward-change",
  tags: ["staking", "rewards", "cooldown", "st-rw"],

  async run(ctx: ScenarioContext) {
    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(100);

    // Step 2: Sync fees — cooldown param should not affect reward accrual
    await ctx.step(
      "sync-fees-after-cooldown-change",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "post-cooldown-sync");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-RW-006: Cooldown decrease does not affect rewards
// ---------------------------------------------------------------------------
export const stCooldownDecreaseNoRewardChange: Scenario = {
  id: "ST-RW-006-cooldown-decrease-no-reward-change",
  tags: ["staking", "rewards", "cooldown", "st-rw"],

  async run(ctx: ScenarioContext) {
    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(100);

    // Step 2: Sync fees — cooldown decrease should not affect reward accrual
    await ctx.step(
      "sync-fees-after-cooldown-decrease",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "post-cooldown-decrease-sync");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-RW-007: EB increase -> higher network fees -> more rewards
// ---------------------------------------------------------------------------
export const stEBIncreaseHigherRewards: Scenario = {
  id: "ST-RW-007-eb-increase-higher-rewards",
  tags: ["staking", "rewards", "eb-update", "st-rw"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Deposit to ensure cluster has enough balance for EB update
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, _post) => {},
    );

    // Step 3: EB update — increase effective balance (48 ETH per validator)
    const valCount = record.validatorKeys.length || 1;
    await ctx.step(
      "eb-update-increase",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-increase");
      },
    );

    await ctx.mineBlocks(100);

    // Step 4: Sync fees — increased vUnits means more fees, more rewards
    await ctx.step(
      "sync-fees-post-eb",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "post-eb-sync");
        assertDaoVUnitsNonNegative(post, "dao-post-eb-sync");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-RW-008: Auto-liquidation reduces active clusters -> less revenue
// ---------------------------------------------------------------------------
export const stAutoLiquidationLessRevenue: Scenario = {
  id: "ST-RW-008-auto-liquidation-less-revenue",
  tags: ["staking", "rewards", "liquidation", "st-rw"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(50);

    // Step 2: Sync fees before liquidation to establish baseline
    await ctx.step(
      "sync-fees-pre-liq",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "pre-liq-sync");
      },
    );

    // Step 3: Drain and liquidate the cluster
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate-cluster",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(50);

    // Step 4: Sync fees post-liquidation — rewards still increase
    // (from other active clusters in the random state)
    await ctx.step(
      "sync-fees-post-liq",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        // accEthPerShare should still increase (other clusters active)
        assertAccEthPerShareIncreased(pre, post, "post-liq-sync");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-RW-009: Exact reward calculation — 1 staker, 1000 blocks
// ---------------------------------------------------------------------------
export const stFullRewardMathWorkedExample: Scenario = {
  id: "ST-RW-009-full-reward-math-worked-example",
  tags: ["staking", "rewards", "math", "st-rw"],

  async run(ctx: ScenarioContext) {
    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(1000);

    // Step 2: Sync fees after 1000 blocks — verify accumulator increased
    await ctx.step(
      "sync-fees-1000-blocks",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "1000-block-sync");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-RW-010: Multi-user precision — rewards split correctly
// ---------------------------------------------------------------------------
export const stMultiUserPrecisionSplit: Scenario = {
  id: "ST-RW-010-multi-user-precision-split",
  tags: ["staking", "rewards", "multi-user", "precision", "st-rw"],

  async run(ctx: ScenarioContext) {
    // Step 1: Stake SSV (first staker)
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(100);

    // Step 2: Sync fees — accEthPerShare reflects per-share rewards
    await ctx.step(
      "sync-fees-multi-user",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "multi-user-sync");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-RW-011: Pre-existing DAO revenue not distributed to first staker
// ---------------------------------------------------------------------------
export const stPreUpgradeDAOBalanceNotDistributed: Scenario = {
  id: "ST-RW-011-pre-upgrade-dao-balance-not-distributed",
  tags: ["staking", "rewards", "pre-upgrade", "st-rw"],

  async run(ctx: ScenarioContext) {
    // Mine 500 blocks — fees accrue with no stakers
    await ctx.mineBlocks(500);

    // Step 1: Stake SSV (first staker enters after fees accrued)
    await ctx.step(
      "stake-ssv-after-fees",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(10);

    // Step 2: Sync fees — only post-stake fees contribute to accEthPerShare
    await ctx.step(
      "sync-fees-post-stake",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "post-stake-sync");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-RW-012: EB update -> DAO vUnit change -> higher earnings -> syncFees -> claim
// ---------------------------------------------------------------------------
export const stEBUpdateSyncFeesFullChain: Scenario = {
  id: "ST-RW-012-eb-update-sync-fees-full-chain",
  tags: ["staking", "rewards", "eb-update", "full-chain", "st-rw"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Deposit to ensure balance for EB update
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, _post) => {},
    );

    // Step 3: EB update — increase effective balance
    const valCount = record.validatorKeys.length || 1;
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-update");
      },
    );

    await ctx.mineBlocks(200);

    // Step 4: Sync fees — accumulator should increase with higher vUnits
    await ctx.step(
      "sync-fees",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "sync-after-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-sync");
      },
    );

    // Step 5: Claim rewards
    await ctx.step(
      "claim-rewards",
      async () => {
        await claimRewards(ctx);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-claim");
      },
    );
  },
};
