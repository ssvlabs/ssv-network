/**
 * RM6 scenarios: Migration Init Guard — removeOperator + migrateClusterToETH
 *
 * Tests the updateClusterOperatorsMigration guard at OperatorLib.sol:363-365:
 *   if (operator.snapshot.block == 0 && operator.ethSnapshot.block == 0) continue;
 *
 * When an operator is removed, both snapshot blocks are zeroed. The migration
 * init loop must skip these operators to avoid re-initializing dead state.
 *
 * 3 scenarios covering basic guard, mine blocks + guard, and multi-validator.
 *
 * NOTE: Requires SSV clusters in the simulation state.
 */

import { VERSION_SSV } from "../simulation/types.ts";
import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import type { ClusterRecord } from "../simulation/types.ts";
import { parseClusterFromReceipt } from "../simulation/bookkeeping.ts";
import {
  findActiveClusterOperator,
  findSecondActiveClusterOperator,
  removeOperator,
  assertRemovedOpInvariant,
  assertDaoVUnitsNonNegative,
} from "./_rm-helpers.ts";

function pickSSVCluster(ctx: ScenarioContext): ClusterRecord {
  const ssvClusters = [...ctx.simState.clusterBook.values()].filter(
    (c) => c.version === VERSION_SSV && c.cluster.active,
  );
  if (ssvClusters.length === 0) {
    throw new Error("No SSV clusters available for migration");
  }
  return ctx.rng.pick(ssvClusters);
}

async function migrateCluster(
  ctx: ScenarioContext,
  record: ClusterRecord,
): Promise<void> {
  const tx = await ctx.contracts.network
    .connect(record.ownerSigner)
    .migrateClusterToETH(record.operatorIds, record.cluster, {
      value: 0n,
    });
  const receipt = await tx.wait();
  const updated = parseClusterFromReceipt(
    ctx.contracts.network,
    receipt,
    "ClusterMigratedToETH",
  );
  if (updated) record.cluster = updated;
  record.version = 1;
}

// ---------------------------------------------------------------------------
// RM6-001: Remove op → migrate → verify init guard skips removed op
// ---------------------------------------------------------------------------
export const rm6BasicInitGuard: Scenario = {
  id: "RM6-basic-init-guard",
  tags: ["removed-operator", "migration-init", "bug-21", "rm6"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: Remove operator
    await ctx.step(
      "removeOperator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-removal");
      },
    );

    // Step 2: Migrate — init guard must skip removed op
    await ctx.step(
      "migrateClusterToETH",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-migration-init");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM6-002: Remove op → mine blocks → migrate → verify guard persists
// ---------------------------------------------------------------------------
export const rm6GuardAfterMine: Scenario = {
  id: "RM6-guard-after-mine",
  tags: ["removed-operator", "migration-init", "bug-21", "rm6"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    // Step 1: Remove operator
    await ctx.step(
      "removeOperator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-removal");
      },
    );

    // Mine blocks to advance time significantly
    await ctx.mineBlocks(5000);

    // Step 2: Migrate after long wait
    await ctx.step(
      "migrateClusterToETH-delayed",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-delayed-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-delayed-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM6-003: Remove 2 ops → migrate → verify both skipped in init
// ---------------------------------------------------------------------------
export const rm6MultiOpInitGuard: Scenario = {
  id: "RM6-multi-op-init-guard",
  tags: ["removed-operator", "migration-init", "bug-21", "rm6", "multi-op"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);
    const op1 = findActiveClusterOperator(ctx, record);
    const op2 = findSecondActiveClusterOperator(ctx, record, op1.id);

    // Remove both
    await ctx.step(
      "removeOperator-1",
      async () => {
        await removeOperator(ctx, op1);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op1.id, "after-removal-op1");
      },
    );

    await ctx.step(
      "removeOperator-2",
      async () => {
        await removeOperator(ctx, op2);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op2.id, "after-removal-op2");
      },
    );

    // Migrate
    await ctx.step(
      "migrateClusterToETH",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op1.id, "op1-after-migration");
        assertRemovedOpInvariant(post, op2.id, "op2-after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-multi-migration");
      },
    );
  },
};
