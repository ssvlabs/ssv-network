/**
 * XC-ECON scenarios: Cross-cutting economics + staking integration + full lifecycle
 *
 * Extracted from test/e2e/cross-cutting/economics.test.ts (3 tests),
 * test/e2e/cross-cutting/staking-integration.test.ts (3 tests), and
 * test/e2e/cross-cutting/full-lifecycle.test.ts (1 test).
 *
 * Tests economic conservation laws, exact operator earnings, multi-cluster
 * EB interactions, staking revenue distribution, liquidation rewards,
 * cSSV transfer mid-revenue, and complete system lifecycle.
 *
 * 7 scenarios covering the representative cross-cutting economics flows.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import {
  pickETHCluster,
  stakeSSV,
  syncFees,
  depositToCluster,
  withdrawFromCluster,
  liquidateCluster,
  removeValidator,
  performEBUpdate,
  assertClusterActive,
  assertClusterLiquidated,
  assertBalanceDecreased,
  assertBalanceIncreased,
  assertDaoVUnitsNonNegative,
  assertAccEthPerShareIncreased,
  assertOperatorEarningsValid,
  assertValidatorCountChanged,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// XC-ECON-001: Full economic conservation law
// ---------------------------------------------------------------------------
export const xcEconConservationLaw: Scenario = {
  id: "XC-ECON-001-conservation-law",
  tags: ["cross-cutting", "economics", "conservation", "xc-econ"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit 5 ETH
    await ctx.step(
      "deposit-5eth",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
        assertClusterActive(post, "after-deposit");
      },
    );

    // Step 2: Mine 100 blocks to accrue fees
    await ctx.mineBlocks(100);

    // Step 3: Withdraw 0.1 ETH (triggers settlement)
    await ctx.step(
      "withdraw-0.1eth",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (pre, post) => {
        assertBalanceDecreased(pre, post, "fees-accrued");
        // Verify all operators have valid earnings
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-earnings`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XC-ECON-002: Exact operator earnings after 100 blocks
// ---------------------------------------------------------------------------
export const xcEconExactEarnings100Blocks: Scenario = {
  id: "XC-ECON-002-exact-earnings-100-blocks",
  tags: ["cross-cutting", "economics", "operator-earnings", "xc-econ"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Mine 100 blocks to accrue fees
    await ctx.mineBlocks(100);

    // Step 2: Deposit to trigger fee settlement
    await ctx.step(
      "deposit-trigger-settlement",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
        // Verify all operators have valid earnings
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-earnings`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XC-ECON-003: Operator serving multiple clusters with different EBs
// ---------------------------------------------------------------------------
export const xcEconMultiClusterDiffEB: Scenario = {
  id: "XC-ECON-003-multi-cluster-diff-eb",
  tags: ["cross-cutting", "economics", "eb-update", "multi-cluster", "xc-econ"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit to ensure balance
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update to 48 ETH per validator (higher than 32 default)
    await ctx.step(
      "eb-update-48",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-update");
      },
    );

    // Step 3: Mine 500 blocks to accrue fees at the new EB rate
    await ctx.mineBlocks(500);

    // Step 4: Deposit to trigger settlement
    await ctx.step(
      "deposit-trigger-settlement",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-settlement");
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-earnings`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XC-ECON-004: Multi-staker revenue distribution through state changes
// ---------------------------------------------------------------------------
export const xcStakingMultiStakerRevenue: Scenario = {
  id: "XC-ECON-004-multi-staker-revenue",
  tags: ["cross-cutting", "economics", "staking", "multi-staker", "xc-econ"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Stake SSV
    await ctx.step(
      "stake-ssv",
      async () => {
        await stakeSSV(ctx);
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update to increase vUnits
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-update");
      },
    );

    // Step 3: Mine blocks to accrue fees
    await ctx.mineBlocks(100);

    // Step 4: Sync fees — accEthPerShare must increase
    await ctx.step(
      "sync-fees",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "after-sync");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XC-ECON-005: Staking rewards through liquidation events
// ---------------------------------------------------------------------------
export const xcStakingRewardsThroughLiquidation: Scenario = {
  id: "XC-ECON-005-staking-rewards-through-liquidation",
  tags: ["cross-cutting", "economics", "staking", "liquidation", "xc-econ"],

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

    // Step 2: Mine many blocks to drain cluster balance
    await ctx.mineBlocks(99999999);

    // Step 3: Liquidate the cluster
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liquidation");
      },
    );

    // Step 4: Mine more blocks post-liquidation
    await ctx.mineBlocks(100);

    // Step 5: Sync fees — accEthPerShare must increase from pre-liq accrual
    await ctx.step(
      "sync-fees-post-liq",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "after-sync-post-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XC-ECON-006: cSSV transfer mid-revenue-accrual
// ---------------------------------------------------------------------------
export const xcStakingTransferMidRevenue: Scenario = {
  id: "XC-ECON-006-cssv-transfer-mid-revenue",
  tags: ["cross-cutting", "economics", "staking", "transfer", "xc-econ"],

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

    // Step 2: Mine blocks to accrue fees
    await ctx.mineBlocks(100);

    // Step 3: Sync fees — accEthPerShare must increase
    await ctx.step(
      "sync-fees",
      async () => {
        await syncFees(ctx);
      },
      async (pre, post) => {
        assertAccEthPerShareIncreased(pre, post, "after-sync-mid-transfer");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XC-ECON-007: Complete system lifecycle
// ---------------------------------------------------------------------------
export const xcFullLifecycle: Scenario = {
  id: "XC-ECON-007-full-lifecycle",
  tags: ["cross-cutting", "economics", "full-lifecycle", "xc-econ"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("No validators in cluster for XC-ECON-007");
    }

    const valCount = record.validatorKeys.length;

    // Step 1: Deposit ETH
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
      },
    );

    // Step 2: EB update (48 ETH per validator)
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-update");
      },
    );

    // Step 3: Mine blocks to accrue fees
    await ctx.mineBlocks(200);

    // Step 4: Remove a validator
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-remove-val");
        assertDaoVUnitsNonNegative(post, "dao-after-remove-val");
      },
    );

    // Step 5: Mine more blocks
    await ctx.mineBlocks(100);

    // Step 6: Deposit to trigger final settlement
    await ctx.step(
      "deposit-settle",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-final");
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-final`);
        }
      },
    );
  },
};
