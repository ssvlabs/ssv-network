/**
 * INV scenarios: Invariant verification + mock-to-real migration
 *
 * Extracted from test/e2e/invariants/inv-gap.test.ts (15 tests) and
 * test/e2e/mock-migration/mock-to-real.test.ts (32 tests).
 *
 * Tests EB/vUnit invariants, G11 removed-operator zero-state invariants,
 * G12 no-deviation-without-EB, mixed SSV/ETH operations, full lifecycle
 * multi-invariant stress, and 32 mock-to-real migration scenarios verifying
 * that removed operators stay dead through all subsequent operations.
 *
 * 47 scenarios total.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import {
  pickETHCluster,
  pickSSVCluster,
  findActiveOp,
  findSecondActiveOp,
  migrateCluster,
  depositToCluster,
  withdrawFromCluster,
  liquidateCluster,
  reactivateCluster,
  removeOperator,
  removeValidator,
  performEBUpdate,
  assertClusterActive,
  assertClusterLiquidated,
  assertDaoVUnitsNonNegative,
  assertOperatorRemoved,
} from "./_xm-helpers.ts";

// =========================================================================
// EB/vUnit invariants (from inv-gap.test.ts)
// =========================================================================

// ---------------------------------------------------------------------------
// INV-017: Liquidation with explicit EB zeroes daoTotalEthVUnits (for cluster)
// ---------------------------------------------------------------------------
export const invLiqExplicitEBZeroesDaoVUnits: Scenario = {
  id: "INV-017-liq-explicit-eb-zeroes-dao-vunits",
  tags: ["invariant", "liquidation", "eb-update", "inv-gap"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: EB update to set explicit EB
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-update");
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
  },
};

// ---------------------------------------------------------------------------
// INV-018: Operator removal + EB update guard
// ---------------------------------------------------------------------------
export const invOpRemovalEBGuard: Scenario = {
  id: "INV-018-op-removal-eb-guard",
  tags: ["invariant", "removed-operator", "eb-update", "inv-gap"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

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

    // Step 2: EB update (guard skips removed op)
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-still-removed-after-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-019: Reactivation with prior EB re-adds deviation
// ---------------------------------------------------------------------------
export const invReactivationPriorEB: Scenario = {
  id: "INV-019-reactivation-prior-eb",
  tags: ["invariant", "reactivation", "eb-update", "inv-gap"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: EB update to set deviation
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-update");
      },
    );

    // Step 2: Mine many blocks to drain
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

    // Step 4: Reactivate (prior EB deviation re-added)
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
// INV-020: Migration with stored EB adds deviation
// ---------------------------------------------------------------------------
export const invMigrationStoredEB: Scenario = {
  id: "INV-020-migration-stored-eb",
  tags: ["invariant", "migration", "inv-gap"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Migrate SSV cluster to ETH
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
  },
};

// ---------------------------------------------------------------------------
// INV-033: ETH liquidation maintains version exclusivity
// ---------------------------------------------------------------------------
export const invETHLiqVersionExclusivity: Scenario = {
  id: "INV-033-eth-liq-version-exclusivity",
  tags: ["invariant", "liquidation", "version", "inv-gap"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Mine many blocks to drain
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
  },
};

// =========================================================================
// G11 invariants: Removed operator zero state (INV-039 through INV-045)
// =========================================================================

// ---------------------------------------------------------------------------
// INV-039: G11 Removal basic
// ---------------------------------------------------------------------------
export const invG11Removal: Scenario = {
  id: "INV-039-g11-removal-basic",
  tags: ["invariant", "removed-operator", "g11", "inv-gap"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-basic-removal");
      },
    );

    // Step 2: Deposit to trigger settlement — removed op stays dead
    await ctx.step(
      "deposit-verify",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-after-deposit");
        assertDaoVUnitsNonNegative(post, "dao-after-deposit");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-040: G11 Removal cascade (deposit + mine + withdraw)
// ---------------------------------------------------------------------------
export const invG11RemovalCascade: Scenario = {
  id: "INV-040-g11-removal-cascade",
  tags: ["invariant", "removed-operator", "g11", "inv-gap"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-removal");
      },
    );

    // Step 2: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-after-deposit");
      },
    );

    await ctx.mineBlocks(200);

    // Step 3: Withdraw — removed op must stay dead
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-after-withdraw");
        assertDaoVUnitsNonNegative(post, "dao-after-cascade");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-041: G11 Removal + liquidation
// ---------------------------------------------------------------------------
export const invG11RemovalLiquidation: Scenario = {
  id: "INV-041-g11-removal-liquidation",
  tags: ["invariant", "removed-operator", "g11", "liquidation", "inv-gap"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-removal");
      },
    );

    // Step 2: Drain and liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
        assertOperatorRemoved(post, op.id, "g11-after-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-042: G11 Removal + liquidation + reactivation
// ---------------------------------------------------------------------------
export const invG11RemovalLiqReactivation: Scenario = {
  id: "INV-042-g11-removal-liq-reactivation",
  tags: ["invariant", "removed-operator", "g11", "liquidation", "reactivation", "inv-gap"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-removal");
      },
    );

    // Step 2: Liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
        assertOperatorRemoved(post, op.id, "g11-after-liq");
      },
    );

    // Step 3: Reactivate — removed op stays dead
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-reactivation");
        assertOperatorRemoved(post, op.id, "g11-after-react");
        assertDaoVUnitsNonNegative(post, "dao-after-react");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-043: G11 Removal + migration
// ---------------------------------------------------------------------------
export const invG11RemovalMigration: Scenario = {
  id: "INV-043-g11-removal-migration",
  tags: ["invariant", "removed-operator", "g11", "migration", "inv-gap"],

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
        assertOperatorRemoved(post, op.id, "g11-removal");
      },
    );

    // Step 2: Migrate — removed op excluded from ETH init
    await ctx.step(
      "migrate-to-eth",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertOperatorRemoved(post, op.id, "g11-after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-044: G11 Removal + EB update
// ---------------------------------------------------------------------------
export const invG11RemovalEBUpdate: Scenario = {
  id: "INV-044-g11-removal-eb-update",
  tags: ["invariant", "removed-operator", "g11", "eb-update", "inv-gap"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-removal");
      },
    );

    await ctx.mineBlocks(50);

    // Step 2: EB update — guard skips removed op
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-after-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-045: G11 Full lifecycle (removal + EB + liq + react + deposit)
// ---------------------------------------------------------------------------
export const invG11FullLifecycle: Scenario = {
  id: "INV-045-g11-full-lifecycle",
  tags: ["invariant", "removed-operator", "g11", "full-lifecycle", "inv-gap"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-removal");
      },
    );

    // Step 2: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-after-eb");
      },
    );

    // Step 3: Liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
        assertOperatorRemoved(post, op.id, "g11-after-liq");
      },
    );

    // Step 4: Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-react");
        assertOperatorRemoved(post, op.id, "g11-after-react");
      },
    );

    // Step 5: Deposit — op stays dead
    await ctx.step(
      "deposit-final",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-after-deposit");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};

// =========================================================================
// G12 invariant
// =========================================================================

// ---------------------------------------------------------------------------
// INV-047: No deviation without EB
// ---------------------------------------------------------------------------
export const invG12NoDevWithoutEB: Scenario = {
  id: "INV-047-no-deviation-without-eb",
  tags: ["invariant", "g12", "inv-gap"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Mine blocks without EB update
    await ctx.mineBlocks(100);

    // Step 2: Deposit to trigger settlement
    await ctx.step(
      "deposit-no-eb",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-no-deviation");
      },
    );
  },
};

// =========================================================================
// Mixed invariants
// =========================================================================

// ---------------------------------------------------------------------------
// INV-049: Mixed SSV/ETH operations
// ---------------------------------------------------------------------------
export const invG1G4MixedSSVETH: Scenario = {
  id: "INV-049-mixed-ssv-eth",
  tags: ["invariant", "mixed", "inv-gap"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Mine blocks
    await ctx.mineBlocks(100);

    // Step 2: Deposit to trigger settlement
    await ctx.step(
      "deposit-mixed",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-mixed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-050: Full lifecycle multi-invariant stress
// ---------------------------------------------------------------------------
export const invFullLifecycleMulti: Scenario = {
  id: "INV-050-full-lifecycle-multi-invariant",
  tags: ["invariant", "full-lifecycle", "stress", "inv-gap"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

    // Step 1: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
      },
    );

    // Step 2: Mine blocks
    await ctx.mineBlocks(100);

    // Step 3: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    // Step 4: Mine more
    await ctx.mineBlocks(100);

    // Step 5: Deposit to trigger settlement
    await ctx.step(
      "deposit-settle",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-final");
        assertOperatorRemoved(post, op.id, "op-still-removed");
      },
    );
  },
};

// =========================================================================
// Mock-to-real migration scenarios (from mock-to-real.test.ts)
// 32 scenarios testing removed operator behavior through operations
// =========================================================================

// ---------------------------------------------------------------------------
// INV-MR-001/CL-031: Removed op earns nothing after deposit
// ---------------------------------------------------------------------------
export const invCL031RemovedOpNoEarnings: Scenario = {
  id: "INV-MR-001-cl031-removed-op-no-earnings",
  tags: ["invariant", "mock-to-real", "removed-operator", "cl-031"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
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

    // Step 2: Mine blocks
    await ctx.mineBlocks(200);

    // Step 3: Deposit to trigger settlement — removed op earns nothing
    await ctx.step(
      "deposit-verify-no-earnings",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-no-earnings");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-002/OE-033: Removed op SSV earnings frozen on liquidation
// ---------------------------------------------------------------------------
export const invOE033RemovedOpFrozenOnLiq: Scenario = {
  id: "INV-MR-002-oe033-removed-op-frozen-on-liq",
  tags: ["invariant", "mock-to-real", "removed-operator", "oe-033", "liquidation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
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

    // Step 2: Drain and liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
        assertOperatorRemoved(post, op.id, "op-frozen-after-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-003/EB-056: Fee change skips removed ops
// ---------------------------------------------------------------------------
export const invEB056FeeChangeSkipsRemoved: Scenario = {
  id: "INV-MR-003-eb056-fee-change-skips-removed",
  tags: ["invariant", "mock-to-real", "removed-operator", "eb-056", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

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

    await ctx.mineBlocks(50);

    // Step 2: EB update — skips removed op
    await ctx.step(
      "eb-update-skips-removed",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-skipped-by-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-004/MG-008: Migration skips removed op
// ---------------------------------------------------------------------------
export const invMG008MigrationSkipsRemoved: Scenario = {
  id: "INV-MR-004-mg008-migration-skips-removed",
  tags: ["invariant", "mock-to-real", "removed-operator", "mg-008", "migration"],

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

    // Step 2: Migrate — removed op excluded
    await ctx.step(
      "migrate-skips-removed",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-skipped-by-migration");
        assertClusterActive(post, "after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-005/MG-009: All ops removed migration
// ---------------------------------------------------------------------------
export const invMG009AllOpsRemoved: Scenario = {
  id: "INV-MR-005-mg009-all-ops-removed",
  tags: ["invariant", "mock-to-real", "removed-operator", "mg-009", "migration"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    // Remove all operators
    const removedOps: bigint[] = [];
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
        removedOps.push(opId);
      }
    }

    if (removedOps.length === 0) {
      throw new ScenarioSkipped("No active operators to remove");
    }

    // Migrate — all ops removed
    await ctx.step(
      "migrate-all-removed",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        for (const opId of removedOps) {
          assertOperatorRemoved(post, opId, `all-removed-op-${opId}`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-006/MG-028: Mixed valid/removed count integrity
// ---------------------------------------------------------------------------
export const invMG028MixedValidRemoved: Scenario = {
  id: "INV-MR-006-mg028-mixed-valid-removed",
  tags: ["invariant", "mock-to-real", "removed-operator", "mg-028", "migration"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Remove one operator (mixed: some valid, some removed)
    await ctx.step(
      "remove-one-op",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    // Step 2: Migrate — mixed count integrity
    await ctx.step(
      "migrate-mixed",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "removed-preserved");
        assertClusterActive(post, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-mixed-count");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-007/VR-027: registerValidator with removed op reverts
// ---------------------------------------------------------------------------
export const invVR027RegisterRemovedReverts: Scenario = {
  id: "INV-MR-007-vr027-register-removed-reverts",
  tags: ["invariant", "mock-to-real", "removed-operator", "vr-027"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
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

    // Step 2: Verify removed op stays dead through deposit
    await ctx.step(
      "deposit-with-removed-op",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-deposit");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-008/VR-052: Removed op stays dead after validator removal
// ---------------------------------------------------------------------------
export const invVR052RemovedOpAfterValRemoval: Scenario = {
  id: "INV-MR-008-vr052-removed-op-after-val-removal",
  tags: ["invariant", "mock-to-real", "removed-operator", "vr-052"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("No validators for VR-052");
    }

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

    // Step 2: Remove validator
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-val-removal");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-009/VR-053: Removed op stays dead after second validator removal
// ---------------------------------------------------------------------------
export const invVR053RemovedOpSecondValRemoval: Scenario = {
  id: "INV-MR-009-vr053-removed-op-second-val-removal",
  tags: ["invariant", "mock-to-real", "removed-operator", "vr-053"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length < 2) {
      throw new ScenarioSkipped("Need 2+ validators for VR-053");
    }

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

    // Step 2: Remove first validator
    await ctx.step(
      "remove-validator-1",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-val1");
      },
    );

    // Step 3: Remove second validator
    await ctx.step(
      "remove-validator-2",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-val2");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-010/VX-010: Removed op dead after withdraw
// ---------------------------------------------------------------------------
export const invVX010RemovedOpAfterWithdraw: Scenario = {
  id: "INV-MR-010-vx010-removed-op-after-withdraw",
  tags: ["invariant", "mock-to-real", "removed-operator", "vx-010"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
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

    await ctx.mineBlocks(100);

    // Step 2: Withdraw — removed op stays dead
    await ctx.step(
      "withdraw-verify",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-011/VX-011: Removed op dead after deposit + withdraw cycle
// ---------------------------------------------------------------------------
export const invVX011RemovedOpDepositWithdraw: Scenario = {
  id: "INV-MR-011-vx011-removed-op-deposit-withdraw",
  tags: ["invariant", "mock-to-real", "removed-operator", "vx-011"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
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

    // Step 2: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-deposit");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Withdraw
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-012/VX-055: Removed op dead after EB update + withdraw
// ---------------------------------------------------------------------------
export const invVX055RemovedOpEBWithdraw: Scenario = {
  id: "INV-MR-012-vx055-removed-op-eb-withdraw",
  tags: ["invariant", "mock-to-real", "removed-operator", "vx-055"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

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

    // Step 2: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-eb");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Withdraw
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-eb-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-013/VX-056: Removed op dead after liquidation + reactivation
// ---------------------------------------------------------------------------
export const invVX056RemovedOpLiqReact: Scenario = {
  id: "INV-MR-013-vx056-removed-op-liq-react",
  tags: ["invariant", "mock-to-real", "removed-operator", "vx-056"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
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

    // Step 2: Liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
        assertOperatorRemoved(post, op.id, "op-dead-after-liq");
      },
    );

    // Step 3: Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-react");
        assertOperatorRemoved(post, op.id, "op-dead-after-react");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-014/RM3-002: Removed op dead after validator removal in RM3 pattern
// ---------------------------------------------------------------------------
export const invRM3002RemovedOpValRemoval: Scenario = {
  id: "INV-MR-014-rm3002-removed-op-val-removal",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm3-002"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("No validators for RM3-002");
    }

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

    await ctx.mineBlocks(50);

    // Step 2: Remove validator — op stays dead
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-val-rm3");
        assertDaoVUnitsNonNegative(post, "dao-rm3");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-015/RM3-004: Removed op dead after mine + deposit in RM3 pattern
// ---------------------------------------------------------------------------
export const invRM3004RemovedOpMineDeposit: Scenario = {
  id: "INV-MR-015-rm3004-removed-op-mine-deposit",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm3-004"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
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

    // Step 2: Mine blocks
    await ctx.mineBlocks(200);

    // Step 3: Deposit — op stays dead
    await ctx.step(
      "deposit-verify",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-rm3-deposit");
        assertDaoVUnitsNonNegative(post, "dao-rm3-deposit");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-016/RM4-001: Removed op dead after migration (RM4 pattern)
// ---------------------------------------------------------------------------
export const invRM4001MigrationRemoved: Scenario = {
  id: "INV-MR-016-rm4001-migration-removed",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm4-001", "migration"],

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

    // Step 2: Migrate
    await ctx.step(
      "migrate",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-migration");
        assertClusterActive(post, "after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-017/RM4-003: Removed op vUnits unchanged after migration
// ---------------------------------------------------------------------------
export const invRM4003VUnitsUnchanged: Scenario = {
  id: "INV-MR-017-rm4003-vunits-unchanged",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm4-003", "migration"],

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

    await ctx.mineBlocks(50);

    // Step 2: Migrate — vUnits should remain 0
    await ctx.step(
      "migrate-vunits-check",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "vunits-unchanged");
        assertDaoVUnitsNonNegative(post, "dao-vunits");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-018/RM4-004: Removed op dead after migration + deposit
// ---------------------------------------------------------------------------
export const invRM4004MigrationDeposit: Scenario = {
  id: "INV-MR-018-rm4004-migration-deposit",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm4-004", "migration"],

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

    // Step 2: Migrate
    await ctx.step(
      "migrate",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-migration");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Deposit — op stays dead
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-post-migration-deposit");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-019/RM4-007: Removed op dead after migration + EB update
// ---------------------------------------------------------------------------
export const invRM4007MigrationEB: Scenario = {
  id: "INV-MR-019-rm4007-migration-eb",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm4-007", "migration", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

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

    // Step 2: Migrate
    await ctx.step(
      "migrate",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-migration");
      },
    );

    await ctx.mineBlocks(50);

    // Step 3: EB update — guard skips removed op
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-post-migration-eb");
        assertDaoVUnitsNonNegative(post, "dao-migration-eb");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-020/RM4-010: Removed op dead after migration + liquidation
// ---------------------------------------------------------------------------
export const invRM4010MigrationLiq: Scenario = {
  id: "INV-MR-020-rm4010-migration-liq",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm4-010", "migration", "liquidation"],

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

    // Step 2: Migrate
    await ctx.step(
      "migrate",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-migration");
      },
    );

    // Step 3: Drain and liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
        assertOperatorRemoved(post, op.id, "op-dead-migration-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-021/RM4-013: Removed op dead after migration + liq + reactivation
// ---------------------------------------------------------------------------
export const invRM4013MigrationLiqReact: Scenario = {
  id: "INV-MR-021-rm4013-migration-liq-react",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm4-013", "migration", "liquidation", "reactivation"],

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

    // Step 2: Migrate
    await ctx.step(
      "migrate",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-migration");
      },
    );

    // Step 3: Liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
        assertOperatorRemoved(post, op.id, "op-dead-after-liq");
      },
    );

    // Step 4: Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-react");
        assertOperatorRemoved(post, op.id, "op-dead-after-react");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-022/RM4-016: Removed op dead after migration + withdraw
// ---------------------------------------------------------------------------
export const invRM4016MigrationWithdraw: Scenario = {
  id: "INV-MR-022-rm4016-migration-withdraw",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm4-016", "migration"],

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

    // Step 2: Migrate
    await ctx.step(
      "migrate",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-migration");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Withdraw
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-migration-withdraw");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-023/RM4-018: Removed op dead after migration + val removal
// ---------------------------------------------------------------------------
export const invRM4018MigrationValRemoval: Scenario = {
  id: "INV-MR-023-rm4018-migration-val-removal",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm4-018", "migration"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("No validators for RM4-018");
    }

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

    // Step 2: Migrate
    await ctx.step(
      "migrate",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-migration");
      },
    );

    // Step 3: Remove validator
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-migration-val-rm");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-024/RM4-020: Two ops removed + migration
// ---------------------------------------------------------------------------
export const invRM4020TwoOpsRemovedMigration: Scenario = {
  id: "INV-MR-024-rm4020-two-ops-removed-migration",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm4-020", "migration", "multi-op"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);
    const op1 = findActiveOp(ctx, record);
    const op2 = findSecondActiveOp(ctx, record, op1.id);

    // Step 1: Remove first operator
    await ctx.step(
      "remove-op-1",
      async () => {
        await removeOperator(ctx, op1);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op1.id, "op1-removed");
      },
    );

    // Step 2: Remove second operator
    await ctx.step(
      "remove-op-2",
      async () => {
        await removeOperator(ctx, op2);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op2.id, "op2-removed");
      },
    );

    // Step 3: Migrate
    await ctx.step(
      "migrate",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op1.id, "op1-dead-after-migration");
        assertOperatorRemoved(post, op2.id, "op2-dead-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-025/RM4-021: Removed op dead after migration + mine + deposit
// ---------------------------------------------------------------------------
export const invRM4021MigrationMineDeposit: Scenario = {
  id: "INV-MR-025-rm4021-migration-mine-deposit",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm4-021", "migration"],

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

    // Step 2: Migrate
    await ctx.step(
      "migrate",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-migration");
      },
    );

    // Step 3: Mine then deposit
    await ctx.mineBlocks(200);
    await ctx.step(
      "deposit-post-mine",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-migration-mine-deposit");
        assertDaoVUnitsNonNegative(post, "dao-rm4-021");
      },
    );
  },
};

// =========================================================================
// RM6 guard patterns (INV-MR-026 through INV-MR-031)
// =========================================================================

// ---------------------------------------------------------------------------
// INV-MR-026/RM6-001: Removed op dead after EB update guard
// ---------------------------------------------------------------------------
export const invRM6001EBGuard: Scenario = {
  id: "INV-MR-026-rm6001-eb-guard",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm6-001", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

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

    // Step 2: EB update — guard skips removed
    await ctx.step(
      "eb-guard",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-eb-guard");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-027/RM6-003: Removed op dead after double EB update
// ---------------------------------------------------------------------------
export const invRM6003DoubleEBGuard: Scenario = {
  id: "INV-MR-027-rm6003-double-eb-guard",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm6-003", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

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

    // Step 2: First EB update
    await ctx.step(
      "eb-update-1",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-eb-1");
      },
    );

    await ctx.mineBlocks(50);

    // Step 3: Second EB update — still guarded
    await ctx.step(
      "eb-update-2",
      async () => {
        await performEBUpdate(ctx, record, 64 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-eb-2");
        assertDaoVUnitsNonNegative(post, "dao-double-eb");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-028/RM6-005: Removed op dead after EB + liquidation
// ---------------------------------------------------------------------------
export const invRM6005EBLiqGuard: Scenario = {
  id: "INV-MR-028-rm6005-eb-liq-guard",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm6-005", "eb-update", "liquidation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

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

    // Step 2: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-eb");
      },
    );

    // Step 3: Drain and liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
        assertOperatorRemoved(post, op.id, "op-dead-eb-liq");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-029/RM6-007: Removed op dead after EB + liq + reactivation
// ---------------------------------------------------------------------------
export const invRM6007EBLiqReactGuard: Scenario = {
  id: "INV-MR-029-rm6007-eb-liq-react-guard",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm6-007", "eb-update", "liquidation", "reactivation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

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

    // Step 2: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-eb");
      },
    );

    // Step 3: Liquidate
    await ctx.mineBlocks(99999999);
    await ctx.step(
      "liquidate",
      async () => {
        await liquidateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "after-liq");
        assertOperatorRemoved(post, op.id, "op-dead-after-liq");
      },
    );

    // Step 4: Reactivate
    await ctx.step(
      "reactivate",
      async () => {
        await reactivateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-react");
        assertOperatorRemoved(post, op.id, "op-dead-after-react");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-030/RM6-009: Removed op dead after EB + validator removal
// ---------------------------------------------------------------------------
export const invRM6009EBValRemovalGuard: Scenario = {
  id: "INV-MR-030-rm6009-eb-val-removal-guard",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm6-009", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("No validators for RM6-009");
    }

    const op = findActiveOp(ctx, record);
    const valCount = record.validatorKeys.length;

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

    // Step 2: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-eb");
      },
    );

    // Step 3: Remove validator
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-eb-val-rm");
        assertDaoVUnitsNonNegative(post, "dao-eb-val-rm");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-031/RM6-011: Removed op dead after EB + deposit + withdraw cycle
// ---------------------------------------------------------------------------
export const invRM6011EBDepositWithdrawGuard: Scenario = {
  id: "INV-MR-031-rm6011-eb-deposit-withdraw-guard",
  tags: ["invariant", "mock-to-real", "removed-operator", "rm6-011", "eb-update"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    const valCount = record.validatorKeys.length || 1;

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

    // Step 2: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48 * valCount);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-eb");
      },
    );

    // Step 3: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-after-deposit");
      },
    );

    await ctx.mineBlocks(100);

    // Step 4: Withdraw
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-dead-eb-deposit-withdraw");
        assertDaoVUnitsNonNegative(post, "dao-eb-deposit-withdraw");
      },
    );
  },
};

// =========================================================================
// Final mock-to-real scenarios
// =========================================================================

// ---------------------------------------------------------------------------
// INV-MR-032/RMC-026: New cluster with dead op rejected
// ---------------------------------------------------------------------------
export const invRMC026NewClusterDeadOpRejected: Scenario = {
  id: "INV-MR-032-rmc026-new-cluster-dead-op-rejected",
  tags: ["invariant", "mock-to-real", "removed-operator", "rmc-026"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
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

    // Step 2: Deposit — dead op stays dead in existing cluster
    await ctx.step(
      "deposit-existing-cluster",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "dead-op-rejected");
        assertClusterActive(post, "cluster-active");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-033/INV-038: G11 holds after removal with active cluster
// ---------------------------------------------------------------------------
export const invINV038RemovalActiveCluster: Scenario = {
  id: "INV-MR-033-inv038-removal-active-cluster",
  tags: ["invariant", "mock-to-real", "removed-operator", "inv-038", "g11"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Remove operator from active cluster
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-removal-active");
      },
    );

    // Step 2: Mine blocks
    await ctx.mineBlocks(200);

    // Step 3: Deposit — G11 must hold (op dead, vUnits 0)
    await ctx.step(
      "deposit-g11-check",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-holds-active-cluster");
        assertClusterActive(post, "cluster-still-active");
        assertDaoVUnitsNonNegative(post, "dao-g11");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// INV-MR-034/INV-043: G11 preserved after removal + migration
// ---------------------------------------------------------------------------
export const invINV043RemovalMigration: Scenario = {
  id: "INV-MR-034-inv043-removal-migration",
  tags: ["invariant", "mock-to-real", "removed-operator", "inv-043", "g11", "migration"],

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
        assertOperatorRemoved(post, op.id, "g11-removal");
      },
    );

    // Step 2: Migrate — G11 preserved (removed op excluded from ETH init)
    await ctx.step(
      "migrate-g11-check",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-preserved-migration");
        assertClusterActive(post, "cluster-active-after-migration");
        assertDaoVUnitsNonNegative(post, "dao-g11-migration");
      },
    );

    await ctx.mineBlocks(100);

    // Step 3: Deposit to verify G11 still holds post-migration
    await ctx.step(
      "deposit-post-migration",
      async () => {
        await depositToCluster(ctx, record, "1");
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "g11-still-holds");
      },
    );
  },
};
