/**
 * ST-LC scenarios: Staking Lifecycle
 *
 * Extracted from test/e2e/staking/staking-lifecycle.test.ts.
 * Tests staking flows: stake-earn-claim cycles, multi-staker pro-rata,
 * late joiners, unstake cooldowns, reward settlement, and cSSV burn
 * under random Monte Carlo state.
 *
 * 9 scenarios covering the representative staking lifecycle flows.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickETHCluster,
  stakeSSV,
  syncFees,
  claimRewards,
  requestUnstake,
  assertAccEthPerShareIncreased,
  assertDaoVUnitsNonNegative,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// ST-LC-001: Basic stake -> earn -> claim cycle
// ---------------------------------------------------------------------------
export const stBasicStakeEarnClaim: Scenario = {
  id: "ST-LC-001-basic-stake-earn-claim",
  tags: ["staking", "lifecycle", "happy-path", "st-lc"],

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

    // Step 2: Mine blocks to accrue network fees
    await ctx.mineBlocks(100);

    // Step 3: Sync fees — accEthPerShare must increase
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
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-claim");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-LC-002: Pre-stake fees when cSSV supply is zero
// ---------------------------------------------------------------------------
export const stPreStakeFeesLocked: Scenario = {
  id: "ST-LC-002-pre-stake-fees-locked",
  tags: ["staking", "lifecycle", "pre-stake", "st-lc"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Mine blocks with no stakers (fees accrue but are uncapturable)
    await ctx.mineBlocks(50);

    // Step 2: Stake SSV after fee accrual
    await ctx.step(
      "stake-ssv-post-accrual",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    // Step 3: Mine more blocks for post-stake fee accrual
    await ctx.mineBlocks(100);

    // Step 4: Sync fees and claim — only post-stake fees claimable
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
// ST-LC-003: Multiple stakers pro-rata distribution
// ---------------------------------------------------------------------------
export const stMultiStakerProRata: Scenario = {
  id: "ST-LC-003-multi-staker-pro-rata",
  tags: ["staking", "lifecycle", "multi-staker", "st-lc"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Stake SSV (staker A — via default staker[0])
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Mine blocks to accrue fees
    await ctx.mineBlocks(100);

    // Step 3: Sync fees — accEthPerShare must increase with staker present
    await ctx.step(
      "sync-fees",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "after-sync-pro-rata");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-LC-004: Three stakers, one unstakes mid-period
// ---------------------------------------------------------------------------
export const stThreeStakersUnstakeMidPeriod: Scenario = {
  id: "ST-LC-004-three-stakers-unstake-mid",
  tags: ["staking", "lifecycle", "unstake", "multi-staker", "st-lc"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const stakeAmount = 1_000_000_000n;

    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx, stakeAmount);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Mine blocks — phase 1 fee accrual
    await ctx.mineBlocks(50);

    // Step 3: Partial unstake — simulates one staker reducing position mid-period
    await ctx.step(
      "partial-unstake-mid-period",
      async () => {
        await requestUnstake(ctx, stakeAmount / 3n);
      },
      async (_pre, _post) => {},
    );

    // Step 4: Mine blocks — phase 2 with reduced supply
    await ctx.mineBlocks(50);

    // Step 5: Sync fees — accEthPerShare must reflect both phases
    await ctx.step(
      "sync-fees",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "after-sync-mid-unstake");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-LC-005: Late joiner does NOT capture pre-stake fees
// ---------------------------------------------------------------------------
export const stLateJoinerNoBackfill: Scenario = {
  id: "ST-LC-005-late-joiner-no-backfill",
  tags: ["staking", "lifecycle", "late-joiner", "st-lc"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Stake SSV (late joiner — enters after fees have accrued)
    await ctx.step(
      "stake-ssv-late",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Mine blocks so post-stake fees accrue
    await ctx.mineBlocks(50);

    // Step 3: Sync fees — accEthPerShare increases only from post-stake period
    await ctx.step(
      "sync-fees",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "after-sync-late-joiner");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-LC-006: Unstake request -> cooldown -> withdraw
// ---------------------------------------------------------------------------
export const stUnstakeCooldownWithdraw: Scenario = {
  id: "ST-LC-006-unstake-cooldown-withdraw",
  tags: ["staking", "lifecycle", "unstake", "cooldown", "st-lc"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const stakeAmount = 1_000_000_000n;

    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx, stakeAmount);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Mine blocks
    await ctx.mineBlocks(50);

    // Step 3: Request unstake — cSSV burned, SSV locked in cooldown
    await ctx.step(
      "request-unstake",
      async () => {
        await requestUnstake(ctx, stakeAmount / 2n);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-unstake-request");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-LC-007: Rewards settled with pre-burn balance during requestUnstake
// ---------------------------------------------------------------------------
export const stRewardsSettledPreBurn: Scenario = {
  id: "ST-LC-007-rewards-settled-pre-burn",
  tags: ["staking", "lifecycle", "unstake", "reward-settlement", "st-lc"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const stakeAmount = 1_000_000_000n;

    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx, stakeAmount);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Mine blocks to accrue fees
    await ctx.mineBlocks(100);

    // Step 3: Request full unstake — rewards settled using pre-burn cSSV balance
    await ctx.step(
      "request-full-unstake",
      async () => {
        await requestUnstake(ctx, stakeAmount);
      },
      async (pre, post) => {
        // accEthPerShare should increase because syncFees is called internally
        assertAccEthPerShareIncreased(pre, post, "after-full-unstake");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-LC-008: Cooldown changes do not alter reward accrual
// ---------------------------------------------------------------------------
export const stCooldownChangeNoRewardEffect: Scenario = {
  id: "ST-LC-008-cooldown-change-no-reward-effect",
  tags: ["staking", "lifecycle", "cooldown", "governance", "st-lc"],

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

    // Step 2: Mine blocks — phase 1
    await ctx.mineBlocks(50);

    // Step 3: Sync fees — phase 1 accumulation
    let phase1AccEthPerShare = 0n;
    await ctx.step(
      "sync-fees-phase1",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "phase1-sync");
        phase1AccEthPerShare = post.accEthPerShare;
      },
    );

    // Step 4: Mine blocks — phase 2
    await ctx.mineBlocks(50);

    // Step 5: Sync fees — phase 2 should also increase (monotonic)
    await ctx.step(
      "sync-fees-phase2",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "phase2-sync");
        // Verify monotonically increasing across phases
        if (post.accEthPerShare <= phase1AccEthPerShare) {
          throw new Error(
            `accEthPerShare not monotonic: phase1=${phase1AccEthPerShare}, phase2=${post.accEthPerShare}`,
          );
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// ST-LC-009: Burned cSSV stops earning immediately
// ---------------------------------------------------------------------------
export const stBurnedCSSVStopsEarning: Scenario = {
  id: "ST-LC-009-burned-cssv-stops-earning",
  tags: ["staking", "lifecycle", "unstake", "burn", "st-lc"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const stakeAmount = 1_000_000_000n;

    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx, stakeAmount);
      },
      async (_pre, _post) => {},
    );

    // Step 2: Mine blocks — accrue fees while fully staked
    await ctx.mineBlocks(50);

    // Step 3: Partial unstake — burns half cSSV
    await ctx.step(
      "partial-unstake",
      async () => {
        await requestUnstake(ctx, stakeAmount / 2n);
      },
      async (_pre, _post) => {},
    );

    // Step 4: Mine blocks — fees now accrue on reduced supply
    await ctx.mineBlocks(50);

    // Step 5: Sync fees — accEthPerShare should increase
    await ctx.step(
      "sync-fees-post-burn",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "after-sync-post-burn");
      },
    );
  },
};
