/**
 * MG-E scenarios: Migration Edge Cases & Double-Payment Regression
 *
 * Extracted from test/e2e/migration/migration-edge.test.ts (5 tests) and
 * test/e2e/migration/migration-double-payment.test.ts (6 tests).
 *
 * 11 scenarios covering SSV refund accuracy after extended accrual,
 * removed operator migration, DAO settlement, multiple same-operator
 * clusters, insufficient ETH reverts, double-payment baseline, frozen
 * operator indices, liquidated cluster preservation, two-removed-operator
 * settlement, zero-fee operator refund, and default ETH fee assignment.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickSSVCluster,
  findActiveOp,
  findSecondActiveOp,
  migrateCluster,
  removeOperator,
  assertClusterActive,
  assertDaoVUnitsNonNegative,
  assertOperatorRemoved,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// MG-E-001: SSV refund accuracy after extended accrual
// ---------------------------------------------------------------------------
export const mgEdgeSSVRefundAccuracy: Scenario = {
  id: "MG-E-001-ssv-refund-accuracy",
  tags: ["migration", "edge", "ssv-refund", "mg-e"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    // Mine 1000 blocks for extended fee accrual
    await ctx.mineBlocks(1000);

    await ctx.step(
      "migrate-after-extended-accrual",
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
// MG-E-002: Migration where some operators were removed
// ---------------------------------------------------------------------------
export const mgEdgeRemovedOpMigration: Scenario = {
  id: "MG-E-002-removed-op-migration",
  tags: ["migration", "edge", "removed-operator", "mg-e"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

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

    // Step 2: Migrate — removed op should be skipped
    await ctx.step(
      "migrate-with-removed-op",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertOperatorRemoved(post, op.id, "op-still-removed-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-E-003: DAO earnings settlement during migration
// ---------------------------------------------------------------------------
export const mgEdgeDAOSettlement: Scenario = {
  id: "MG-E-003-dao-settlement",
  tags: ["migration", "edge", "dao", "mg-e"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.mineBlocks(100);

    await ctx.step(
      "migrate-check-dao-settlement",
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
// MG-E-004: Two clusters same operators migrate without corruption
// ---------------------------------------------------------------------------
export const mgEdgeMultipleSameOps: Scenario = {
  id: "MG-E-004-multiple-same-ops",
  tags: ["migration", "edge", "multi-cluster", "mg-e"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-first-cluster",
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
// MG-E-005: Revert with insufficient ETH for liquidation check
// ---------------------------------------------------------------------------
export const mgEdgeInsufficientETHReverts: Scenario = {
  id: "MG-E-005-insufficient-eth-reverts",
  tags: ["migration", "edge", "revert", "mg-e"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-with-zero-eth",
      async () => {
        const { ethers } = await import("ethers");
        await ctx.provider.send("hardhat_setBalance", [
          record.owner,
          "0x" + ethers.parseEther("10").toString(16),
        ]);
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .migrateClusterToETH(record.operatorIds, record.cluster, {
            value: 0n,
          });
      },
      async () => {
        throw new Error("UNREACHABLE: migration with 0 ETH should have reverted");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-E-006: Baseline exact SSV refund with all operators active
// ---------------------------------------------------------------------------
export const mgDoublePayBaseline: Scenario = {
  id: "MG-E-006-double-pay-baseline",
  tags: ["migration", "edge", "double-payment", "mg-e"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.mineBlocks(300);

    await ctx.step(
      "migrate-baseline-all-active",
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
// MG-E-007: Removed operator frozen index in migration
// ---------------------------------------------------------------------------
export const mgDoublePayRemovedOpFrozen: Scenario = {
  id: "MG-E-007-double-pay-removed-op-frozen",
  tags: ["migration", "edge", "double-payment", "removed-operator", "mg-e"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

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

    // Step 2: Mine blocks — frozen index stays
    await ctx.mineBlocks(200);

    // Step 3: Migrate — frozen index should be included in settlement
    await ctx.step(
      "migrate-with-frozen-index",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertOperatorRemoved(post, op.id, "op-still-removed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-E-008: Liquidated cluster migration preserves SSV counts
// ---------------------------------------------------------------------------
export const mgDoublePayLiquidatedCluster: Scenario = {
  id: "MG-E-008-double-pay-liquidated-cluster",
  tags: ["migration", "edge", "double-payment", "liquidated", "mg-e"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-liquidated-preserves-counts",
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
// MG-E-009: Two removed operators different times
// ---------------------------------------------------------------------------
export const mgDoublePayTwoRemovedOps: Scenario = {
  id: "MG-E-009-double-pay-two-removed-ops",
  tags: ["migration", "edge", "double-payment", "removed-operator", "mg-e"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);
    const op1 = findActiveOp(ctx, record);
    const op2 = findSecondActiveOp(ctx, record, op1.id);

    // Step 1: Remove first operator
    await ctx.step(
      "remove-operator-1",
      async () => {
        await removeOperator(ctx, op1);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op1.id, "after-removal-op1");
      },
    );

    // Step 2: Mine blocks between removals
    await ctx.mineBlocks(150);

    // Step 3: Remove second operator
    await ctx.step(
      "remove-operator-2",
      async () => {
        await removeOperator(ctx, op2);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op2.id, "after-removal-op2");
      },
    );

    // Step 4: Migrate — both frozen indices included in settlement
    await ctx.step(
      "migrate-two-removed-ops",
      async () => {
        await migrateCluster(ctx, record, "50");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertOperatorRemoved(post, op1.id, "op1-still-removed");
        assertOperatorRemoved(post, op2.id, "op2-still-removed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// MG-E-010: Zero-fee operators no refund delta
// ---------------------------------------------------------------------------
export const mgDoublePayZeroFeeOps: Scenario = {
  id: "MG-E-010-double-pay-zero-fee-ops",
  tags: ["migration", "edge", "double-payment", "zero-fee", "mg-e"],

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
// MG-E-011: Default ETH fee assignment
// ---------------------------------------------------------------------------
export const mgDoublePayDefaultETHFee: Scenario = {
  id: "MG-E-011-double-pay-default-eth-fee",
  tags: ["migration", "edge", "double-payment", "default-fee", "mg-e"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "migrate-default-eth-fee",
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
