/**
 * RM4 scenarios: removeOperator → migrateClusterToETH
 *
 * Tests that migrateClusterToETH correctly excludes removed operators
 * when initializing ETH-side operator state. BUG-21: the migration
 * loop must skip operators with ethSnapshot.block == 0.
 *
 * 4 scenarios covering basic migration, multi-op, vUnits init check,
 * and daoTotalEthVUnits consistency.
 *
 * NOTE: These scenarios require SSV clusters (version == 0) in the
 * simulation state. If none exist, StepReverted fires and the runner
 * moves on.
 */

import { ethers } from "ethers";
import { VERSION_SSV } from "../simulation/types.ts";
import type { Scenario } from "../simulation/scenario-types.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
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

/** Pick an active SSV cluster (version == 0) for migration scenarios. */
function pickSSVCluster(ctx: ScenarioContext): ClusterRecord {
  const ssvClusters = [...ctx.simState.clusterBook.values()].filter(
    (c) => c.version === VERSION_SSV && c.cluster.active,
  );
  if (ssvClusters.length === 0) {
    throw new ScenarioSkipped("No SSV clusters available for migration");
  }
  return ctx.rng.pick(ssvClusters);
}

/** Migrate an SSV cluster to ETH. Updates record in place. */
async function migrateCluster(
  ctx: ScenarioContext,
  record: ClusterRecord,
): Promise<void> {
  const deposit = ethers.parseEther("50");
  await ctx.provider.send("hardhat_setBalance", [
    record.owner,
    "0x" + (deposit + ethers.parseEther("10")).toString(16),
  ]);
  const tx = await ctx.contracts.network
    .connect(record.ownerSigner)
    .migrateClusterToETH(record.operatorIds, record.cluster, {
      value: deposit,
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
// RM4-001: Remove op → migrate SSV→ETH → verify removed op excluded
// ---------------------------------------------------------------------------
export const rm4BasicMigration: Scenario = {
  id: "RM4-basic-migration",
  tags: ["removed-operator", "migration", "bug-21", "rm4"],

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

    await ctx.mineBlocks(10);

    // Step 2: Migrate to ETH — removed op must be excluded from ETH init
    await ctx.step(
      "migrateClusterToETH",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM4-002: Remove 2 ops → migrate → verify all excluded
// ---------------------------------------------------------------------------
export const rm4MultiOpMigration: Scenario = {
  id: "RM4-multi-op-migration",
  tags: ["removed-operator", "migration", "bug-21", "rm4", "multi-op"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);
    const op1 = findActiveClusterOperator(ctx, record);
    const op2 = findSecondActiveClusterOperator(ctx, record, op1.id);

    // Remove both operators
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

// ---------------------------------------------------------------------------
// RM4-003: Remove op → migrate → verify vUnits not initialized for removed op
// ---------------------------------------------------------------------------
export const rm4VUnitsNotInitialized: Scenario = {
  id: "RM4-vunits-not-initialized",
  tags: ["removed-operator", "migration", "bug-21", "rm4", "vunits"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveClusterOperator(ctx, record);

    let removedOpVUnitsBefore = 0n;

    // Step 1: Remove operator
    await ctx.step(
      "removeOperator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-removal");
        removedOpVUnitsBefore = post.operators.get(op.id)?.ethVUnits ?? 0n;
      },
    );

    // Step 2: Migrate — removed op's ethVUnits should remain 0
    await ctx.step(
      "migrateClusterToETH",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        const postVUnits = post.operators.get(op.id)?.ethVUnits ?? 0n;
        if (postVUnits !== removedOpVUnitsBefore) {
          throw new Error(
            `Removed op ethVUnits changed during migration: ${removedOpVUnitsBefore} → ${postVUnits}`,
          );
        }
        assertRemovedOpInvariant(post, op.id, "vunits-not-init");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// RM4-004: Remove op → mine → migrate → verify dao consistency
// ---------------------------------------------------------------------------
export const rm4DaoConsistency: Scenario = {
  id: "RM4-dao-consistency",
  tags: ["removed-operator", "migration", "bug-21", "rm4", "dao"],

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

    await ctx.mineBlocks(100);

    // Step 2: Migrate and check DAO vUnits
    await ctx.step(
      "migrateClusterToETH-check-dao",
      async () => {
        await migrateCluster(ctx, record);
      },
      async (_pre, post) => {
        assertRemovedOpInvariant(post, op.id, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};
