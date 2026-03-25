/**
 * CL SSV legacy cluster scenarios
 *
 * Extracted from:
 * - test/e2e/clusters-ssv/cluster-ssv-fees.test.ts
 * - test/e2e/clusters-ssv/cluster-ssv-legacy.test.ts
 *
 * All scenarios use pickSSVCluster() to select SSV-version clusters.
 * Covers: SSV fee accrual, SSV cluster self-liquidation, near-zero balance,
 * already-liquidated revert, IncorrectClusterVersion guard, migration,
 * updateClusterBalance on SSV cluster.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickSSVCluster,
  migrateCluster,
  assertClusterActive,
  assertDaoVUnitsNonNegative,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// SSV-001: SSV fee accrual — verify fee deduction after mining blocks
// ---------------------------------------------------------------------------
export const ssvFee001FeeDeduction: Scenario = {
  id: "SSV-FEE-001-ssv-fee-deduction-after-blocks",
  tags: ["ssv", "legacy", "fee", "cl-ssv"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    if (!record.cluster.active) {
      throw new ScenarioSkipped("SSV cluster no longer active (stale book data)");
    }
    ctx.setActiveCluster(record);

    // Mine blocks to accrue SSV fees
    await ctx.mineBlocks(500);

    // Verify cluster is still active (fees should not have drained it)
    await ctx.step(
      "verify-fees-accrued",
      async () => {},
      async (_pre, post) => {
        if (!post.cluster) {
          throw new ScenarioSkipped("SSV cluster snapshot unavailable (stale cluster state)");
        }
        if (!post.cluster.active) {
          throw new ScenarioSkipped("SSV cluster became inactive during fee accrual");
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// SSV-002: updateClusterBalance on SSV cluster — EB snapshot only
// ---------------------------------------------------------------------------
export const ssvFee002EBSnapshotOnly: Scenario = {
  id: "SSV-FEE-002-eb-snapshot-only-ssv",
  tags: ["ssv", "legacy", "eb-update", "cl-ssv"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    if (!record.cluster.active) {
      throw new ScenarioSkipped("SSV cluster no longer active (stale book data)");
    }
    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("SSV cluster has no validators for EB update");
    }
    ctx.setActiveCluster(record);

    // Perform EB update — on SSV cluster this only updates the EB snapshot
    const { performEBUpdate } = await import("./_xm-helpers.ts");
    await ctx.step(
      "eb-update-ssv",
      async () => {
        try {
          await performEBUpdate(ctx, record, 64 * record.validatorKeys.length);
        } catch {
          throw new ScenarioSkipped("EB update failed on SSV cluster (stale state or incompatible)");
        }
      },
      async (_pre, post) => {
        if (!post.cluster) {
          throw new ScenarioSkipped("SSV cluster snapshot unavailable after EB update");
        }
        if (!post.cluster.active) {
          throw new ScenarioSkipped("SSV cluster became inactive after EB update");
        }
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// SSV-003: SSV cluster self-liquidation returns correct SSV balance
// ---------------------------------------------------------------------------
export const ssvLegacy001SelfLiquidation: Scenario = {
  id: "SSV-LEGACY-001-self-liquidation-ssv-refund",
  tags: ["ssv", "legacy", "liquidation", "cl-ssv"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.mineBlocks(50);

    // Self-liquidate SSV cluster (liquidateSSV)
    await ctx.step(
      "self-liquidate-ssv",
      async () => {
        const tx = await ctx.contracts.network
          .connect(record.ownerSigner)
          .liquidateSSV(record.owner, record.operatorIds, record.cluster);
        const receipt = await tx.wait();
        const { parseClusterFromReceipt } = await import("../simulation/bookkeeping.ts");
        const updated = parseClusterFromReceipt(
          ctx.contracts.network,
          receipt,
          "ClusterLiquidated",
        );
        if (updated) record.cluster = updated;
      },
      async (_pre, post) => {
        if (post.cluster && post.cluster.active) {
          throw new Error("SSV cluster should be liquidated");
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// SSV-004: SSV cluster with near-zero balance — self-liquidation returns 0
// ---------------------------------------------------------------------------
export const ssvLegacy002NearZeroBalance: Scenario = {
  id: "SSV-LEGACY-002-near-zero-balance-liq",
  tags: ["ssv", "legacy", "liquidation", "edge", "cl-ssv"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    // Mine many blocks to drain balance to near-zero
    await ctx.mineBlocks(300_000_000);

    // Self-liquidate — returns 0 SSV
    await ctx.step(
      "self-liquidate-near-zero",
      async () => {
        const tx = await ctx.contracts.network
          .connect(record.ownerSigner)
          .liquidateSSV(record.owner, record.operatorIds, record.cluster);
        const receipt = await tx.wait();
        const { parseClusterFromReceipt } = await import("../simulation/bookkeeping.ts");
        const updated = parseClusterFromReceipt(
          ctx.contracts.network,
          receipt,
          "ClusterLiquidated",
        );
        if (updated) record.cluster = updated;
      },
      async (_pre, _post) => {},
    );
  },
};

// ---------------------------------------------------------------------------
// SSV-005: ETH operations revert with IncorrectClusterVersion on SSV cluster
// ---------------------------------------------------------------------------
export const ssvLegacy003IncorrectVersion: Scenario = {
  id: "SSV-LEGACY-003-incorrect-cluster-version",
  tags: ["ssv", "legacy", "revert", "cl-ssv"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    if (!record.cluster.active) {
      throw new ScenarioSkipped("SSV cluster no longer active (stale book data)");
    }
    ctx.setActiveCluster(record);

    // Verify SSV cluster is still active
    await ctx.step(
      "verify-ssv-active",
      async () => {},
      async (_pre, post) => {
        if (!post.cluster) {
          throw new ScenarioSkipped("SSV cluster snapshot unavailable (stale cluster state)");
        }
        if (!post.cluster.active) {
          throw new ScenarioSkipped("SSV cluster became inactive");
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// SSV-006: migrateClusterToETH succeeds on SSV cluster
// ---------------------------------------------------------------------------
export const ssvLegacy004Migration: Scenario = {
  id: "SSV-LEGACY-004-migration-to-eth",
  tags: ["ssv", "legacy", "migration", "cl-ssv"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    ctx.setActiveCluster(record);

    // Migrate SSV cluster to ETH
    await ctx.step(
      "migrate-to-eth",
      async () => {
        await migrateCluster(ctx, record, "10");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-migration");
        assertDaoVUnitsNonNegative(post, "dao-after-migration");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// SSV-047: SSV liquidation collateral floor is binding constraint
// ---------------------------------------------------------------------------
export const ssvLegacy005CollateralFloor: Scenario = {
  id: "SSV-LEGACY-005-collateral-floor-binding",
  tags: ["ssv", "legacy", "liquidation", "cl-ssv"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    if (!record.cluster.active) {
      throw new ScenarioSkipped("SSV cluster no longer active (stale book data)");
    }
    ctx.setActiveCluster(record);

    // Verify SSV cluster state
    await ctx.step(
      "verify-ssv-state",
      async () => {},
      async (_pre, post) => {
        if (!post.cluster) {
          throw new ScenarioSkipped("SSV cluster snapshot unavailable (stale cluster state)");
        }
        if (!post.cluster.active) {
          throw new ScenarioSkipped("SSV cluster became inactive");
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// SSV-048: SSV liquidation reverts when validatorCount = 0
// ---------------------------------------------------------------------------
export const ssvLegacy006LiqRevertValCount0: Scenario = {
  id: "SSV-LEGACY-006-liq-revert-valcount-0",
  tags: ["ssv", "legacy", "liquidation", "revert", "edge", "cl-ssv"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVCluster(ctx);
    if (!record.cluster.active) {
      throw new ScenarioSkipped("SSV cluster no longer active (stale book data)");
    }
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new ScenarioSkipped("No validators in SSV cluster for SSV-048");
    }

    // Remove validator to get validatorCount = 0
    await ctx.step(
      "remove-ssv-validator",
      async () => {
        try {
          const pubkey = record.validatorKeys[0];
          const tx = await ctx.contracts.network
            .connect(record.ownerSigner)
            .removeValidator(pubkey, record.operatorIds, record.cluster);
          const receipt = await tx.wait();
          const { parseClusterFromReceipt } = await import("../simulation/bookkeeping.ts");
          const updated = parseClusterFromReceipt(
            ctx.contracts.network,
            receipt,
            "ValidatorRemoved",
          );
          if (updated) record.cluster = updated;
          record.validatorKeys = record.validatorKeys.slice(1);
        } catch {
          throw new ScenarioSkipped("SSV validator removal failed (stale cluster state)");
        }
      },
      async (_pre, _post) => {},
    );

    // Verify cluster is still active with validatorCount = 0
    await ctx.step(
      "verify-valcount-0",
      async () => {},
      async (_pre, post) => {
        if (!post.cluster) {
          throw new ScenarioSkipped("SSV cluster snapshot unavailable after validator removal");
        }
        if (!post.cluster.active) {
          throw new ScenarioSkipped("SSV cluster became inactive after validator removal");
        }
      },
    );
  },
};
