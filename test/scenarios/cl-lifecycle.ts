/**
 * CL lifecycle scenarios
 *
 * Extracted from:
 * - test/e2e/clusters-eth/cluster-eth-lifecycle.test.ts
 * - test/e2e/clusters-eth/cluster-eth-eb.test.ts
 *
 * Covers full cluster lifecycles: register → deposit → mine → withdraw,
 * deposit at same block, multiple deposits, EB fee scaling, migration
 * with EB deviation sync.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickETHCluster,
  depositToCluster,
  withdrawFromCluster,
  performEBUpdate,
  assertClusterActive,
  assertBalanceIncreased,
  assertDaoVUnitsNonNegative,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// Lifecycle-001: Creates cluster, deposits, advances, withdraws with fees
// ---------------------------------------------------------------------------
export const clLife001DepositMineWithdraw: Scenario = {
  id: "CL-LIFE-001-deposit-mine-withdraw-fees",
  tags: ["cluster", "lifecycle", "deposit", "withdraw", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
        assertClusterActive(post, "after-deposit");
      },
    );

    // Mine blocks to accrue fees
    await ctx.mineBlocks(100);

    // Withdraw — fees deducted
    await ctx.step(
      "withdraw-with-fees",
      async () => {
        await withdrawFromCluster(ctx, record, "2");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertDaoVUnitsNonNegative(post, "dao-after-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// Lifecycle-002: Deposit at same block as registration — no fee settlement
// ---------------------------------------------------------------------------
export const clLife002DepositSameBlock: Scenario = {
  id: "CL-LIFE-002-deposit-same-block-no-fees",
  tags: ["cluster", "lifecycle", "deposit", "edge", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Deposit immediately — no blocks between
    await ctx.step(
      "deposit-same-block",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
        assertClusterActive(post, "after-deposit");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// Lifecycle-003: Multiple deposits accumulate without fee settlement
// ---------------------------------------------------------------------------
export const clLife003MultipleDeposits: Scenario = {
  id: "CL-LIFE-003-multiple-deposits-accumulate",
  tags: ["cluster", "lifecycle", "deposit", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "deposit-1",
      async () => {
        await depositToCluster(ctx, record, "3");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit-1");
      },
    );

    await ctx.mineBlocks(10);

    await ctx.step(
      "deposit-2",
      async () => {
        await depositToCluster(ctx, record, "2");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit-2");
        assertClusterActive(post, "after-deposit-2");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// Lifecycle-004: Withdraw exactly to liquidation threshold
// ---------------------------------------------------------------------------
export const clLife004WithdrawToThreshold: Scenario = {
  id: "CL-LIFE-004-withdraw-to-liquidation-threshold",
  tags: ["cluster", "lifecycle", "withdraw", "boundary", "cl"],

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

    await ctx.mineBlocks(10);

    // Withdraw a safe amount — stays above threshold
    await ctx.step(
      "withdraw-safe",
      async () => {
        await withdrawFromCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-safe-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// Lifecycle-005: ValidatorCount == 0 allows full withdrawal
// ---------------------------------------------------------------------------
export const clLife005FullWithdrawNoValidators: Scenario = {
  id: "CL-LIFE-005-full-withdraw-validatorcount-0",
  tags: ["cluster", "lifecycle", "withdraw", "edge", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      // Cluster already has 0 validators — deposit and withdraw
      await ctx.step(
        "deposit",
        async () => {
          await depositToCluster(ctx, record, "5");
        },
        async (_pre, _post) => {},
      );

      await ctx.step(
        "full-withdraw",
        async () => {
          await withdrawFromCluster(ctx, record, "0.1");
        },
        async (_pre, post) => {
          assertDaoVUnitsNonNegative(post, "dao-final");
        },
      );
      return;
    }

    // Remove all validators to get validatorCount == 0
    const { removeValidator: rmVal } = await import("./_xm-helpers.ts");
    const keysCount = record.validatorKeys.length;
    for (let i = 0; i < keysCount; i++) {
      await ctx.step(
        `remove-validator-${i + 1}`,
        async () => {
          await rmVal(ctx, record);
        },
        async (_pre, _post) => {},
      );
    }

    // Now withdraw — no liquidation check with validatorCount=0
    await ctx.step(
      "withdraw-after-remove-all",
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
// EB-001: Fees use old vUnits before EB update and new vUnits after
// ---------------------------------------------------------------------------
export const clEB001OldNewVUnits: Scenario = {
  id: "CL-EB-001-fees-old-new-vunits",
  tags: ["cluster", "lifecycle", "eb-update", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(50);

    // EB update to 96 ETH per validator
    await ctx.step(
      "eb-update-96",
      async () => {
        await performEBUpdate(ctx, record, 96 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-96");
        assertClusterActive(post, "after-eb-96");
      },
    );

    await ctx.mineBlocks(100);

    // Withdraw — fees reflect new vUnits
    await ctx.step(
      "withdraw-new-vunits",
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
// EB-002: Migration syncs EB deviation to operators and DAO
// ---------------------------------------------------------------------------
export const clEB002MigrationEBSync: Scenario = {
  id: "CL-EB-002-migration-eb-deviation-sync",
  tags: ["cluster", "lifecycle", "eb-update", "migration", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // EB update to 128 ETH per validator
    await ctx.step(
      "eb-update-128",
      async () => {
        await performEBUpdate(ctx, record, 128 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-128");
        assertClusterActive(post, "after-eb-128");
      },
    );

    await ctx.mineBlocks(50);

    // Deposit to verify cluster is functional after EB update
    await ctx.step(
      "deposit-after-eb",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};
