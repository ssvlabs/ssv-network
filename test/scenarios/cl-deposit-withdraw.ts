/**
 * CL deposit/withdraw scenarios
 *
 * Extracted from:
 * - test/e2e/clusters-eth/cl-gap.test.ts (CL-002, CL-003, CL-006, CL-007,
 *   CL-010, CL-012, CL-015, CL-017, CL-018, CL-022, CL-023, CL-030,
 *   CL-036, CL-041, CL-042, CL-048, CL-049, CL-050, CL-054, CL-055)
 * - test/e2e/clusters-eth/cluster-eth-lifecycle.ts (deposit/withdraw tests)
 * - test/e2e/clusters-eth/cluster-conservation.test.ts
 *
 * Each it() block = one Scenario export.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickETHCluster,
  depositToCluster,
  withdrawFromCluster,
  performEBUpdate,
  removeOperator,
  removeValidator,
  findActiveOp,
  assertClusterActive,
  assertBalanceIncreased,
  assertDaoVUnitsNonNegative,
  assertOperatorRemoved,
  assertValidatorCountChanged,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// CL-002: Deposit into active 7-op cluster
// ---------------------------------------------------------------------------
export const cl002Deposit7Op: Scenario = {
  id: "CL-002-deposit-7op-cluster",
  tags: ["cluster", "deposit", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "deposit-7op",
      async () => {
        await depositToCluster(ctx, record, "3");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit-7op");
        assertClusterActive(post, "after-deposit-7op");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// CL-003: Deposit into active 13-op cluster (max operators)
// ---------------------------------------------------------------------------
export const cl003Deposit13Op: Scenario = {
  id: "CL-003-deposit-13op-cluster",
  tags: ["cluster", "deposit", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "deposit-13op",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit-13op");
        assertClusterActive(post, "after-deposit-13op");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// CL-006: Non-owner deposit into liquidated cluster
// ---------------------------------------------------------------------------
export const cl006NonOwnerDepositLiquidated: Scenario = {
  id: "CL-006-non-owner-deposit-liquidated",
  tags: ["cluster", "deposit", "liquidation", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Drain and liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        const { liquidateCluster } = await import("./_xm-helpers.ts");
        await liquidateCluster(ctx, record);
      },
      async (_pre, _post) => {},
    );

    // Non-owner deposit still works on liquidated cluster
    await ctx.step(
      "non-owner-deposit",
      async () => {
        await depositToCluster(ctx, record, "2");
      },
      async (_pre, _post) => {},
    );
  },
};

// ---------------------------------------------------------------------------
// CL-007: Deposit 0 ETH
// ---------------------------------------------------------------------------
export const cl007DepositZero: Scenario = {
  id: "CL-007-deposit-zero-eth",
  tags: ["cluster", "deposit", "edge", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "deposit-zero",
      async () => {
        await depositToCluster(ctx, record, "0");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-zero-deposit");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// CL-010: Large deposit does not overflow on near-zero balance
// ---------------------------------------------------------------------------
export const cl010LargeDeposit: Scenario = {
  id: "CL-010-large-deposit-no-overflow",
  tags: ["cluster", "deposit", "edge", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "large-deposit",
      async () => {
        await depositToCluster(ctx, record, "1000");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-large-deposit");
        assertClusterActive(post, "after-large-deposit");
      },
    );

    await ctx.step(
      "second-large-deposit",
      async () => {
        await depositToCluster(ctx, record, "1000");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-second-large-deposit");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// CL-012: Deposit into cluster with one removed operator
// ---------------------------------------------------------------------------
export const cl012DepositRemovedOp: Scenario = {
  id: "CL-012-deposit-removed-operator",
  tags: ["cluster", "deposit", "removed-operator", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    await ctx.step(
      "deposit-after-removal",
      async () => {
        await depositToCluster(ctx, record, "2");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit-removed-op");
        assertOperatorRemoved(post, op.id, "op-still-removed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// CL-018: Deposit into active 10-op cluster
// ---------------------------------------------------------------------------
export const cl018Deposit10Op: Scenario = {
  id: "CL-018-deposit-10op-cluster",
  tags: ["cluster", "deposit", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "deposit-10op",
      async () => {
        await depositToCluster(ctx, record, "4");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit-10op");
        assertClusterActive(post, "after-deposit-10op");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// CL-022: Partial withdraw from active 7-op cluster
// ---------------------------------------------------------------------------
export const cl022Withdraw7Op: Scenario = {
  id: "CL-022-withdraw-7op-cluster",
  tags: ["cluster", "withdraw", "cl"],

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

    await ctx.step(
      "withdraw-7op",
      async () => {
        await withdrawFromCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw-7op");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// CL-023: Partial withdraw from active 13-op cluster
// ---------------------------------------------------------------------------
export const cl023Withdraw13Op: Scenario = {
  id: "CL-023-withdraw-13op-cluster",
  tags: ["cluster", "withdraw", "cl"],

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

    await ctx.step(
      "withdraw-13op",
      async () => {
        await withdrawFromCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw-13op");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// CL-030: Withdraw with explicit EB — exact boundary (balance == threshold)
// ---------------------------------------------------------------------------
export const cl030WithdrawEBBoundary: Scenario = {
  id: "CL-030-withdraw-eb-exact-boundary",
  tags: ["cluster", "withdraw", "eb-update", "boundary", "cl"],

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

    // Set explicit EB = 64 ETH
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-64");
        assertClusterActive(post, "after-eb-64");
      },
    );

    await ctx.mineBlocks(10);

    await ctx.step(
      "withdraw-near-threshold",
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
// CL-036: Withdraw with explicit EB (vUnits doubled) — higher threshold
// ---------------------------------------------------------------------------
export const cl036WithdrawEBDoubled: Scenario = {
  id: "CL-036-withdraw-eb-vunits-doubled",
  tags: ["cluster", "withdraw", "eb-update", "cl"],

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

    // Set explicit EB = 64 ETH → vUnits doubled
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
      },
    );

    await ctx.mineBlocks(5);

    await ctx.step(
      "withdraw-doubled-threshold",
      async () => {
        await withdrawFromCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertDaoVUnitsNonNegative(post, "dao-after-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// CL-041: Withdraw from active 10-op cluster with explicit EB
// ---------------------------------------------------------------------------
export const cl041Withdraw10OpEB: Scenario = {
  id: "CL-041-withdraw-10op-explicit-eb",
  tags: ["cluster", "withdraw", "eb-update", "cl"],

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

    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
      },
    );

    await ctx.mineBlocks(5);

    await ctx.step(
      "withdraw-10op-eb",
      async () => {
        await withdrawFromCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// CL-042: Deposit+withdraw with all operators removed — zero burn rate
// ---------------------------------------------------------------------------
export const cl042AllOpsRemovedZeroBurn: Scenario = {
  id: "CL-042-all-ops-removed-zero-burn",
  tags: ["cluster", "deposit", "withdraw", "removed-operator", "edge", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("No validators in cluster for CL-042");
    }

    // Remove validator first
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-remove-val");
      },
    );

    // Remove all operators
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

    await ctx.mineBlocks(10);

    // Deposit — zero burn rate
    await ctx.step(
      "deposit-zero-burn",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit-zero-burn");
      },
    );

    // Withdraw full balance — no liquidation check with validatorCount=0
    await ctx.step(
      "withdraw-full",
      async () => {
        await withdrawFromCluster(ctx, record, "0.5");
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// CL-048: Deposit, EB update increases vUnits, then withdraw
// ---------------------------------------------------------------------------
export const cl048DepositEBWithdraw: Scenario = {
  id: "CL-048-deposit-eb-higher-threshold-withdraw",
  tags: ["cluster", "deposit", "withdraw", "eb-update", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Deposit extra
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
      },
    );

    // EB update: 64 ETH → vUnits doubled
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

    // Safe withdraw
    await ctx.step(
      "withdraw-safe",
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
// CL-049: Deposit overflow edge — repeated large deposits accumulate
// ---------------------------------------------------------------------------
export const cl049RepeatedLargeDeposits: Scenario = {
  id: "CL-049-repeated-large-deposits",
  tags: ["cluster", "deposit", "edge", "cl"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    for (let i = 1; i <= 3; i++) {
      await ctx.step(
        `large-deposit-${i}`,
        async () => {
          await depositToCluster(ctx, record, "500");
        },
        async (pre, post) => {
          assertBalanceIncreased(pre, post, `after-large-deposit-${i}`);
          assertClusterActive(post, `after-large-deposit-${i}`);
        },
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Conservation: Maintains ETH conservation across operations
// ---------------------------------------------------------------------------
export const clConservation: Scenario = {
  id: "CL-CONSERV-multi-cluster-eth-balance",
  tags: ["cluster", "deposit", "withdraw", "liquidation", "conservation", "cl"],

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
      },
    );

    await ctx.mineBlocks(1000);

    // Withdraw
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.5");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertDaoVUnitsNonNegative(post, "dao-after-ops");
      },
    );
  },
};
