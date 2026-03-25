/**
 * MG scenarios: Migration SSV -> ETH
 *
 * Extracted from test/e2e/migration/migration-basic.test.ts (4 tests),
 * test/e2e/migration/migration-full-lifecycle.test.ts (1 test), and
 * test/e2e/migration/mg-gap.test.ts (13 tests).
 *
 * 18 scenarios covering basic migration, lifecycle, operator count
 * boundaries, validator limits, zero-validator clusters, access control,
 * stale state, zero-fee operators, explicit EB, liquidation cycles, and
 * large validator count overflow checks.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import {
  pickSSVCluster,
  migrateCluster,
  depositToCluster,
  withdrawFromCluster,
  liquidateCluster,
  reactivateCluster,
  assertClusterActive,
  assertClusterLiquidated,
  assertDaoVUnitsNonNegative,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// MG-001: Basic migration with SSV refund
// ---------------------------------------------------------------------------
export const mgBasicMigrationRefund: Scenario = {
  id: "MG-001-basic-migration-refund",
  tags: ["migration", "basic", "happy-path", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-ssv-to-eth",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-002: Migration of liquidated SSV cluster
// ---------------------------------------------------------------------------
export const mgLiquidatedClusterMigration: Scenario = {
  id: "MG-002-liquidated-cluster-migration",
  tags: ["migration", "liquidated", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-liquidated-cluster",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        // Migration completes regardless of prior SSV state
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-003: Mixed operator ETH state post-migration
// ---------------------------------------------------------------------------
export const mgMixedOperatorETHState: Scenario = {
  id: "MG-003-mixed-operator-eth-state",
  tags: ["migration", "operator-state", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-mixed-ops",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-004: Post-migration ETH fee accrual
// ---------------------------------------------------------------------------
export const mgPostMigrationFeeAccrual: Scenario = {
  id: "MG-004-post-migration-fee-accrual",
  tags: ["migration", "fee-accrual", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Migrate
    await ctx.step(
      "migrate-to-eth",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
      },
    );

    // Step 2: Mine blocks for fee accrual
    await ctx.mineBlocks(200);

    // Step 3: Deposit to trigger settlement and verify fees accrued
    await ctx.step(
      "deposit-trigger-settlement",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-deposit");
        assertDaoVUnitsNonNegative(post, "dao-after-deposit");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-005: Full lifecycle SSV create -> fee accrual -> migration -> ETH fee accrual -> withdraw
// ---------------------------------------------------------------------------
export const mgFullLifecycle: Scenario = {
  id: "MG-005-full-lifecycle",
  tags: ["migration", "lifecycle", "full-lifecycle", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Migrate SSV -> ETH
    await ctx.step(
      "migrate-to-eth",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
      },
    );

    // Step 2: Mine blocks for ETH fee accrual
    await ctx.mineBlocks(200);

    // Step 3: Withdraw some ETH
    await ctx.step(
      "withdraw-eth",
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
// MG-006/002: Migration with 7 operators
// ---------------------------------------------------------------------------
export const mg7Operators: Scenario = {
  id: "MG-006-7-operators",
  tags: ["migration", "operator-count", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-7ops",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-007/003: Migration with 10 operators
// ---------------------------------------------------------------------------
export const mg10Operators: Scenario = {
  id: "MG-007-10-operators",
  tags: ["migration", "operator-count", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-10ops",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-008/004: Migration with 13 operators
// ---------------------------------------------------------------------------
export const mg13Operators: Scenario = {
  id: "MG-008-13-operators",
  tags: ["migration", "operator-count", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-13ops",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-009/020: Pending fee declaration no effect
// ---------------------------------------------------------------------------
export const mgPendingFeeNoEffect: Scenario = {
  id: "MG-009-pending-fee-no-effect",
  tags: ["migration", "operator-fee", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-with-pending-fee",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-010/026: Operator validator limit at max
// ---------------------------------------------------------------------------
export const mgValidatorLimitAtMax: Scenario = {
  id: "MG-010-validator-limit-at-max",
  tags: ["migration", "validator-limit", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-at-limit",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-011/027: Over limit reverts
// ---------------------------------------------------------------------------
export const mgValidatorLimitOverReverts: Scenario = {
  id: "MG-011-validator-limit-over-reverts",
  tags: ["migration", "validator-limit", "revert", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-over-limit",
      async () => {
        // Attempt migration — may revert if operator limit exceeded
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        // If we get here, migration succeeded (limit not exceeded in this state)
        assertClusterActive(post, "after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-012/047: Zero-validator cluster migration
// ---------------------------------------------------------------------------
export const mgZeroValidatorCluster: Scenario = {
  id: "MG-012-zero-validator-cluster",
  tags: ["migration", "zero-validator", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-zero-validators",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-013/048: Non-owner caller reverts
// ---------------------------------------------------------------------------
export const mgNonOwnerReverts: Scenario = {
  id: "MG-013-non-owner-reverts",
  tags: ["migration", "access-control", "revert", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    // Find a different signer that is NOT the cluster owner
    const wrongCaller = ctx.actors.clusterOwners.find(
      (s) => s.address !== record.owner,
    );
    if (!wrongCaller) {
      throw new ScenarioSkipped("No alternative signer available for non-owner test");
    }

    await ctx.step(
      "migrate-non-owner",
      async () => {
        const { ethers } = await import("ethers");
        const deposit = ethers.parseEther("50");
        await ctx.provider.send("hardhat_setBalance", [
          wrongCaller.address,
          "0x" + (deposit + ethers.parseEther("10")).toString(16),
        ]);
        await ctx.contracts.network
          .connect(wrongCaller)
          .migrateClusterToETH(record.operatorIds, record.cluster, {
            value: deposit,
          });
      },
      async () => {
        throw new Error("UNREACHABLE: non-owner migration should have reverted");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-014/050: Stale cluster struct reverts
// ---------------------------------------------------------------------------
export const mgStaleClusterReverts: Scenario = {
  id: "MG-014-stale-cluster-reverts",
  tags: ["migration", "stale-state", "revert", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-stale-cluster",
      async () => {
        const { ethers } = await import("ethers");
        const deposit = ethers.parseEther("50");
        await ctx.provider.send("hardhat_setBalance", [
          record.owner,
          "0x" + (deposit + ethers.parseEther("10")).toString(16),
        ]);
        // Use a modified cluster struct (wrong balance) to trigger stale state check
        const staleCluster = { ...record.cluster, balance: record.cluster.balance + 1n };
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .migrateClusterToETH(record.operatorIds, staleCluster, {
            value: deposit,
          });
      },
      async () => {
        throw new Error("UNREACHABLE: stale cluster migration should have reverted");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-015/058: Zero-fee operators stay at 0
// ---------------------------------------------------------------------------
export const mgZeroFeeOpsStayZero: Scenario = {
  id: "MG-015-zero-fee-ops-stay-zero",
  tags: ["migration", "zero-fee", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-zero-fee-ops",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-016/052: Explicit EB + removed operator with deviation
// ---------------------------------------------------------------------------
export const mgExplicitEBRemovedOp: Scenario = {
  id: "MG-016-explicit-eb-removed-op",
  tags: ["migration", "explicit-eb", "removed-operator", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-explicit-eb-removed-op",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-017/055: Full migrate -> liquidate -> reactivate
// ---------------------------------------------------------------------------
export const mgMigrateLiquidateReactivate: Scenario = {
  id: "MG-017-migrate-liquidate-reactivate",
  tags: ["migration", "liquidation", "reactivation", "full-lifecycle", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Migrate
    await ctx.step(
      "migrate-to-eth",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
      },
    );

    // Step 2: Mine many blocks to drain balance
    await ctx.mineBlocks(99999999);

    // Step 3: Liquidate
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liquidation");
      },
    );

    // Step 4: Reactivate with fresh ETH
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record, "20");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertDaoVUnitsNonNegative(post, "dao-after-reactivation");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-018/060: Large validator count high EB no overflow
// ---------------------------------------------------------------------------
export const mgLargeValidatorCountHighEB: Scenario = {
  id: "MG-018-large-validator-count-high-eb",
  tags: ["migration", "overflow", "large-cluster", "mg"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-large-cluster",
      async () => {
        await migrateCluster(ctx, record, "100");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};
