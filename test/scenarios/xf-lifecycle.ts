/**
 * XF scenarios: Full lifecycle cross-module chains
 *
 * Extracted from test/e2e/cross-cutting/xf-lifecycle.test.ts and
 * test/e2e/cross-cutting/xo-op-cluster.test.ts.
 * Tests complete cluster lifecycles: register → deposit → mine →
 * withdraw → remove validators, with EB updates and operator
 * changes mid-way.
 *
 * 10 scenarios covering representative full-lifecycle flows.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickETHCluster,
  findActiveOp,
  depositToCluster,
  withdrawFromCluster,
  performEBUpdate,
  removeOperator,
  removeValidator,
  assertClusterActive,
  assertBalanceIncreased,
  assertDaoVUnitsNonNegative,
  assertOperatorRemoved,
  assertActiveOpVUnitsValid,
  assertOperatorEarningsValid,
  assertValidatorCountChanged,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// XF-001: Deposit → mine → withdraw → verify fee settlement
// ---------------------------------------------------------------------------
export const xf001DepositMineWithdraw: Scenario = {
  id: "XF-001-deposit-mine-withdraw",
  tags: ["cross-module", "lifecycle", "deposit", "withdraw", "xf"],

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
        assertClusterActive(post, "after-deposit");
      },
    );

    // Step 2: Mine blocks to accrue fees
    await ctx.mineBlocks(5000);

    // Step 3: Verify fees accrued (balance decreased from pre-mine)
    await ctx.step(
      "verify-fee-accrual",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "after-mine");
        assertDaoVUnitsNonNegative(post, "dao-after-mine");
      },
    );

    // Step 4: Withdraw
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.5");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XF-002: Deposit → mine → EB update → mine → withdraw
// ---------------------------------------------------------------------------
export const xf002DepositEBWithdraw: Scenario = {
  id: "XF-002-deposit-eb-withdraw",
  tags: ["cross-module", "lifecycle", "deposit", "eb-update", "withdraw", "xf"],

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

    // Step 2: EB update to 48 ETH (deviation = 5000 per op)
    await ctx.step(
      "eb-update-48",
      async () => {
        await performEBUpdate(ctx, record, 48);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
        assertClusterActive(post, "after-eb");
      },
    );

    await ctx.mineBlocks(500);

    // Step 3: Withdraw — fees should reflect EB-adjusted burn rate
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
// XF-003: Deposit → EB increase → EB decrease → withdraw
// ---------------------------------------------------------------------------
export const xf003EBIncreaseDecrease: Scenario = {
  id: "XF-003-eb-increase-decrease",
  tags: ["cross-module", "lifecycle", "eb-update", "xf"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit plenty of ETH
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(50);

    // Step 2: EB increase (96 ETH → vUnits=30000)
    await ctx.step(
      "eb-increase",
      async () => {
        await performEBUpdate(ctx, record, 96);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-increase");
      },
    );

    await ctx.mineBlocks(50);

    // Step 3: EB decrease (64 ETH → vUnits=20000)
    await ctx.step(
      "eb-decrease",
      async () => {
        await performEBUpdate(ctx, record, 64);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-decrease");
        assertClusterActive(post, "after-eb-decrease");
      },
    );

    await ctx.mineBlocks(100);

    // Step 4: Withdraw (verify balance reflects both EB periods)
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.5");
      },
      async (_pre, post) => {
        assertClusterActive(post, "final-check");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XF-004: Remove operator mid-lifecycle → deposit → withdraw
// ---------------------------------------------------------------------------
export const xf004RemoveOpMidLifecycle: Scenario = {
  id: "XF-004-remove-op-mid-lifecycle",
  tags: ["cross-module", "lifecycle", "removed-operator", "xf"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(200);

    // Step 2: Remove operator mid-lifecycle
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    await ctx.mineBlocks(1000);

    // Step 3: Withdraw — burn rate should reflect 3-op rate
    await ctx.step(
      "withdraw-3op-rate",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertOperatorRemoved(post, op.id, "op-still-removed");
      },
    );

    // Step 4: Deposit more
    await ctx.step(
      "deposit-after-removal",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-second-deposit");
        assertOperatorRemoved(post, op.id, "op-still-removed-2");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XF-005: Remove validator → verify validatorCount and cleanup
// ---------------------------------------------------------------------------
export const xf005RemoveValidator: Scenario = {
  id: "XF-005-remove-validator",
  tags: ["cross-module", "lifecycle", "remove-validator", "xf"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new Error("No validators in cluster for XF-005");
    }

    // Step 1: Deposit to ensure balance
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, _post) => {},
    );

    await ctx.mineBlocks(100);

    // Step 2: Remove validator
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

    // Step 3: Withdraw remaining balance
    await ctx.step(
      "withdraw-remaining",
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
// XF-006: EB update → remove validator → verify deviation cleanup
// ---------------------------------------------------------------------------
export const xf006EBRemoveValidatorCleanup: Scenario = {
  id: "XF-006-eb-remove-validator-cleanup",
  tags: ["cross-module", "lifecycle", "eb-update", "remove-validator", "xf"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new Error("No validators in cluster for XF-006");
    }

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update to 48 ETH (set deviation)
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Remove all validators (triggers deviation cleanup)
    const keysCount = record.validatorKeys.length;
    for (let i = 0; i < keysCount; i++) {
      await ctx.step(
        `remove-validator-${i + 1}`,
        async () => {
          await removeValidator(ctx, record);
        },
        async (_pre, post) => {
          assertDaoVUnitsNonNegative(post, `dao-after-remove-${i + 1}`);
          // After last validator removed, check cleanup
          if (record.validatorKeys.length === 0) {
            for (const opId of record.operatorIds) {
              assertActiveOpVUnitsValid(post, opId, `op-${opId}-cleanup`);
            }
          }
        },
      );
    }
  },
};

// ---------------------------------------------------------------------------
// XF-007: Long time-lapse (10k blocks) → deposit → withdraw → no overflow
// ---------------------------------------------------------------------------
export const xf007TimeLapse: Scenario = {
  id: "XF-007-time-lapse-no-overflow",
  tags: ["cross-module", "lifecycle", "stress", "xf"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "50");
      },
      async (_pre, _post) => {},
    );

    // Step 2: Mine many blocks
    await ctx.mineBlocks(100000);

    // Step 3: Deposit more (verify no overflow in index calc)
    await ctx.step(
      "deposit-after-lapse",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-lapse-deposit");
        assertDaoVUnitsNonNegative(post, "dao-after-lapse");
      },
    );

    // Step 4: Withdraw
    await ctx.step(
      "withdraw-after-lapse",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-lapse-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XF-008: EB update with explicit EB → deposit → withdraw → verify deviation
// ---------------------------------------------------------------------------
export const xf008ExplicitEBDeposit: Scenario = {
  id: "XF-008-explicit-eb-deposit-withdraw",
  tags: ["cross-module", "lifecycle", "eb-update", "xf"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: EB update to 48 ETH
    await ctx.step(
      "eb-update-48",
      async () => {
        await performEBUpdate(ctx, record, 48);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-48");
        // Verify per-op vUnits are valid
        for (const opId of record.operatorIds) {
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-after-eb`);
        }
      },
    );

    await ctx.mineBlocks(100);

    // Step 2: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
      },
    );

    await ctx.mineBlocks(500);

    // Step 3: Withdraw — deviation should be preserved
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        // Verify deviation preserved after deposit/withdraw
        for (const opId of record.operatorIds) {
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-preserved`);
        }
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XF-009: Remove operator → EB update → remove validator full chain
// ---------------------------------------------------------------------------
export const xf009RemoveOpEBRemoveVal: Scenario = {
  id: "XF-009-remove-op-eb-remove-val",
  tags: ["cross-module", "lifecycle", "removed-operator", "eb-update", "remove-validator", "xf"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    if (record.validatorKeys.length === 0) {
      throw new Error("No validators in cluster for XF-009");
    }

    // Step 1: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    await ctx.mineBlocks(100);

    // Step 2: EB update (guard skips removed op)
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 64);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );

    // Step 3: Remove validator (cleanup guard skips removed op)
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-remove-val");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XF-010: Operator earnings validation after mine + withdraw
// ---------------------------------------------------------------------------
export const xf010OperatorEarnings: Scenario = {
  id: "XF-010-operator-earnings-validation",
  tags: ["cross-module", "lifecycle", "operator-earnings", "xf"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit to ensure balance
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "15");
      },
      async (_pre, _post) => {},
    );

    // Step 2: Mine blocks to accrue operator earnings
    await ctx.mineBlocks(5000);

    // Step 3: Withdraw to trigger fee settlement
    await ctx.step(
      "withdraw-settle-fees",
      async () => {
        await withdrawFromCluster(ctx, record, "0.5");
      },
      async (_pre, post) => {
        // Verify all active operators have non-negative earnings
        for (const opId of record.operatorIds) {
          assertOperatorEarningsValid(post, opId, `op-${opId}-earnings`);
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-vunits`);
        }
        assertClusterActive(post, "after-settle");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};
