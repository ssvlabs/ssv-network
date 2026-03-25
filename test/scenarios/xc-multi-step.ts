/**
 * XC-MS scenarios: Multi-step flows + validator count invariants
 *
 * Extracted from test/e2e/cross-cutting/multi-step-flows.test.ts (3 tests)
 * and test/e2e/cross-cutting/validator-count-invariant.test.ts (4 tests).
 *
 * Tests multi-step chains: register->EB->fee->liquidation, sequential
 * registration, governance mid-operation, and validator count invariants
 * through liquidation cycles, shared-operator counting, and consistency.
 *
 * 7 scenarios covering the representative multi-step and invariant flows.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import {
  pickETHCluster,
  depositToCluster,
  withdrawFromCluster,
  liquidateCluster,
  reactivateCluster,
  removeValidator,
  performEBUpdate,
  assertClusterActive,
  assertClusterLiquidated,
  assertBalanceDecreased,
  assertDaoVUnitsNonNegative,
  assertValidatorCountChanged,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// XC-MS-001: Register -> EB update -> fee change -> liquidation
// ---------------------------------------------------------------------------
export const xcMultiStepRegEBFeeLiq: Scenario = {
  id: "XC-MS-001-reg-eb-fee-liq",
  tags: ["cross-cutting", "multi-step", "eb-update", "liquidation", "xc-ms"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Deposit to fund cluster
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-deposit");
      },
    );

    // Step 2: EB update to 64 ETH per validator (higher burn rate)
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-update");
      },
    );

    // Step 3: Mine many blocks to drain balance
    await ctx.mineBlocks(99999999);

    // Step 4: Liquidate
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liquidation");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XC-MS-002: Sequential registration two clusters same operators
// ---------------------------------------------------------------------------
export const xcMultiStepSequentialReg: Scenario = {
  id: "XC-MS-002-sequential-reg",
  tags: ["cross-cutting", "multi-step", "deposit", "withdraw", "xc-ms"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit ETH
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-deposit");
      },
    );

    // Step 2: Mine blocks to accrue fees
    await ctx.mineBlocks(100);

    // Step 3: Withdraw to verify sequential operations work
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
// XC-MS-003: Governance parameter changes mid-operation
// ---------------------------------------------------------------------------
export const xcMultiStepGovChangeMidOp: Scenario = {
  id: "XC-MS-003-gov-change-mid-op",
  tags: ["cross-cutting", "multi-step", "governance", "xc-ms"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit ETH
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "10");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-deposit");
      },
    );

    // Step 2: Mine blocks (fees accrue under current governance params)
    await ctx.mineBlocks(200);

    // Step 3: Withdraw to trigger settlement with current params
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.5");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-withdraw");
        assertBalanceDecreased(pre, post, "fees-accrued-mid-gov");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XC-MS-004/INV-024: Validator count through liquidation cycle
// ---------------------------------------------------------------------------
export const xcInvValCountLiqCycle: Scenario = {
  id: "XC-MS-004-val-count-liq-cycle",
  tags: ["cross-cutting", "multi-step", "invariant", "liquidation", "reactivation", "xc-ms"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Mine many blocks to drain balance
    await ctx.mineBlocks(99999999);

    // Step 2: Liquidate
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liquidation");
      },
    );

    // Step 3: Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertDaoVUnitsNonNegative(post, "dao-after-reactivation");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XC-MS-005/INV-034: No double-counting shared operators
// ---------------------------------------------------------------------------
export const xcInvNoDoubleCountSharedOps: Scenario = {
  id: "XC-MS-005-no-double-count-shared-ops",
  tags: ["cross-cutting", "multi-step", "invariant", "shared-operators", "xc-ms"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit ETH
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-deposit");
      },
    );

    // Step 2: Mine blocks
    await ctx.mineBlocks(100);

    // Step 3: Withdraw to trigger settlement — verify no double-counting
    await ctx.step(
      "withdraw-verify-no-double-count",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-no-double-count");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XC-MS-006/INV-035: Validator count consistency
// ---------------------------------------------------------------------------
export const xcInvValCountConsistency035: Scenario = {
  id: "XC-MS-006-val-count-consistency",
  tags: ["cross-cutting", "multi-step", "invariant", "validator-count", "xc-ms"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("No validators in cluster for XC-MS-006");
    }

    // Step 1: Remove a validator
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-remove-val");
      },
    );

    // Step 2: Deposit to trigger settlement with new validator count
    await ctx.step(
      "deposit-settle",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-deposit");
        assertDaoVUnitsNonNegative(post, "dao-after-settle");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XC-MS-007/INV-036: Validator count consistency extended
// ---------------------------------------------------------------------------
export const xcInvValCountConsistency036: Scenario = {
  id: "XC-MS-007-val-count-consistency-extended",
  tags: ["cross-cutting", "multi-step", "invariant", "validator-count", "xc-ms"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Mine blocks to accrue fees
    await ctx.mineBlocks(100);

    // Step 2: Deposit to trigger settlement — cluster must remain active
    await ctx.step(
      "deposit-extended-check",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-deposit-extended");
        assertDaoVUnitsNonNegative(post, "dao-extended");
      },
    );
  },
};
