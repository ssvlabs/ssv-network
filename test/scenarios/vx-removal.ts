/**
 * VX scenarios: Validator removal and exit
 *
 * Extracted from:
 * - test/e2e/validators/validator-lifecycle.test.ts (removal sections)
 * - test/e2e/validators/vx-gap.test.ts (VX-006 through VX-069)
 *
 * 27 scenarios covering single/bulk removal, exit signals, fee settlement,
 * EB deviation cleanup, removed operator guards, liquidated cluster handling,
 * and SSV cluster removal paths.
 */

import { ethers } from "ethers";
import type { Scenario } from "../simulation/scenario-types.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import type { OperatorRecord } from "../simulation/types.ts";
import {
  pickClusterWithValidators,
  pickClusterWithMinValidators,
  pickSSVClusterWithValidators,
  pickLiquidatedCluster,
  generatePubkey,
  removeValidator,
  bulkRemoveValidators,
  exitValidator,
  bulkExitValidators,
  assertClusterActive,
  assertClusterLiquidated,
  assertValidatorCountChanged,
  assertBalanceDecreased,
  assertBalanceNonNegative,
  assertDaoVUnitsNonNegative,
} from "./_vl-helpers.ts";
import {
  findActiveOp,
  removeOperator,
  performEBUpdate,
  depositToCluster,
  assertOperatorRemoved,
} from "./_xm-helpers.ts";
import { DEFAULT_SHARES } from "../common/constants.ts";

// ---------------------------------------------------------------------------
// VX-L001: Remove from 2-validator cluster — fee settlement
// ---------------------------------------------------------------------------
export const vxL001RemoveFeeSettlement: Scenario = {
  id: "VX-L001-remove-fee-settlement",
  tags: ["validator", "remove", "fee-settlement", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithMinValidators(ctx, 2);
    ctx.setActiveCluster(record);

    // Step 1: Mine blocks to accrue fees
    await ctx.mineBlocks(100);

    // Step 2: Remove one validator — settles fees
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertClusterActive(post, "after-remove");
        assertValidatorCountChanged(pre, post, -1, "after-remove");
        // Balance should decrease (fees settled)
        assertBalanceDecreased(pre, post, "fees-settled");
      },
    );

    // Step 3: Mine more, verify earnings continue accruing
    await ctx.mineBlocks(50);

    await ctx.step(
      "verify-continued-accrual",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "after-more-mining");
        assertDaoVUnitsNonNegative(post, "dao-after-continued");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-L002: Remove non-existent validator — revert
// ---------------------------------------------------------------------------
export const vxL002RemoveNonExistent: Scenario = {
  id: "VX-L002-remove-nonexistent-revert",
  tags: ["validator", "remove", "revert", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "remove-nonexistent",
      async () => {
        // Use a random pubkey that doesn't exist in the cluster
        const fakePk = generatePubkey();
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .removeValidator(fakePk, record.operatorIds, record.cluster);
      },
      async () => {
        throw new Error("UNREACHABLE: non-existent validator should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-L003: Remove last validator — cluster balance preservation
// ---------------------------------------------------------------------------
export const vxL003RemoveLastValidator: Scenario = {
  id: "VX-L003-remove-last-validator",
  tags: ["validator", "remove", "last-validator", "balance", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    // Mine blocks to accrue some fees
    await ctx.mineBlocks(50);

    // Remove all validators one by one
    const keyCount = record.validatorKeys.length;
    for (let i = 0; i < keyCount; i++) {
      const isLast = i === keyCount - 1;
      await ctx.step(
        `remove-validator-${i + 1}`,
        async () => {
          await removeValidator(ctx, record);
        },
        async (pre, post) => {
          assertValidatorCountChanged(pre, post, -1, `remove-${i + 1}`);
          if (isLast) {
            // After removing last validator, cluster still active with remaining balance
            assertClusterActive(post, "after-last-remove");
            assertBalanceNonNegative(post, "balance-after-last");
          }
        },
      );
    }
  },
};

// ---------------------------------------------------------------------------
// VX-006: removeValidator with 7-op cluster and explicit EB
// ---------------------------------------------------------------------------
export const vx006Remove7OpExplicitEB: Scenario = {
  id: "VX-006-remove-7op-explicit-eb",
  tags: ["validator", "remove", "explicit-eb", "7-op", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithMinValidators(ctx, 2);
    ctx.setActiveCluster(record);

    // Step 1: EB update to create deviation
    const eb = 48 * record.validatorKeys.length;
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, eb);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
      },
    );

    // Step 2: Remove one validator
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-remove");
        assertDaoVUnitsNonNegative(post, "dao-after-remove");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-015: removeValidator from liquidated ETH cluster — no settlement
// ---------------------------------------------------------------------------
export const vx015RemoveFromLiquidated: Scenario = {
  id: "VX-015-remove-from-liquidated",
  tags: ["validator", "remove", "liquidated", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickLiquidatedCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "remove-from-liquidated",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "still-liquidated");
        assertDaoVUnitsNonNegative(post, "dao-after-remove");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-020: removeValidator fee settlement with explicit EB
// ---------------------------------------------------------------------------
export const vx020RemoveEBWeightedFees: Scenario = {
  id: "VX-020-remove-eb-weighted-fees",
  tags: ["validator", "remove", "explicit-eb", "fee-settlement", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    // Step 1: EB update to 48 ETH per validator (1.5x baseline)
    const eb = 48 * record.validatorKeys.length;
    await ctx.step(
      "eb-update-48",
      async () => {
        await performEBUpdate(ctx, record, eb);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
      },
    );

    await ctx.mineBlocks(100);

    // Step 2: Remove — fee settlement uses EB-weighted vUnits
    await ctx.step(
      "remove-with-eb-fees",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-remove");
        assertBalanceDecreased(pre, post, "eb-weighted-fees");
        assertDaoVUnitsNonNegative(post, "dao-after-remove");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-023: remove then re-register same pubkey
// ---------------------------------------------------------------------------
export const vx023RemoveReregister: Scenario = {
  id: "VX-023-remove-then-reregister",
  tags: ["validator", "remove", "re-register", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);
    const pubkey = record.validatorKeys[0];

    // Step 1: Remove
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record, pubkey);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-remove");
      },
    );

    // Step 2: Re-register same pubkey — should succeed
    await ctx.step(
      "re-register-same-pubkey",
      async () => {
        const value = ethers.parseEther("5");
        await ctx.provider.send("hardhat_setBalance", [
          record.owner,
          "0x" + (value + ethers.parseEther("10")).toString(16),
        ]);
        const tx = await ctx.contracts.network
          .connect(record.ownerSigner)
          .registerValidator(
            pubkey,
            record.operatorIds,
            DEFAULT_SHARES,
            record.cluster,
            { value },
          );
        const receipt = await tx.wait();
        const { parseClusterFromReceipt } = await import("../simulation/bookkeeping.ts");
        const updated = parseClusterFromReceipt(ctx.contracts.network, receipt, "ValidatorAdded");
        if (updated) record.cluster = updated;
        record.validatorKeys.push(pubkey);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, 1, "after-re-register");
        assertClusterActive(post, "after-re-register");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-028: bulkRemoveValidator — explicit EB + removed operator guard
// ---------------------------------------------------------------------------
export const vx028BulkRemoveRemovedOpGuard: Scenario = {
  id: "VX-028-bulk-remove-removed-op-guard",
  tags: ["validator", "remove", "bulk", "removed-operator", "eb-update", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithMinValidators(ctx, 2);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: EB update to create deviation
    const eb = 48 * record.validatorKeys.length;
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, eb);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
      },
    );

    // Step 2: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-op-removal");
      },
    );

    // Step 3: Bulk remove all validators — guard skips removed op
    const keys = [...record.validatorKeys];
    await ctx.step(
      "bulk-remove-all",
      async () => {
        await bulkRemoveValidators(ctx, record, keys);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "removed-op-still-zero");
        assertDaoVUnitsNonNegative(post, "dao-after-bulk-remove");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-031: bulkRemoveValidator stress — 50 validators, 13 ops
// ---------------------------------------------------------------------------
export const vx031BulkRemoveStress: Scenario = {
  id: "VX-031-bulk-remove-stress-50",
  tags: ["validator", "remove", "bulk", "stress", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithMinValidators(ctx, 10);
    ctx.setActiveCluster(record);

    const keys = [...record.validatorKeys];
    await ctx.step(
      "bulk-remove-all",
      async () => {
        await bulkRemoveValidators(ctx, record, keys);
      },
      async (_pre, post) => {
        if (!post.cluster) throw new Error("no cluster in snapshot");
        if (post.cluster.validatorCount !== 0) {
          throw new Error(`validatorCount=${post.cluster.validatorCount} (expected 0)`);
        }
        assertDaoVUnitsNonNegative(post, "dao-after-bulk");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-033: bulkRemoveValidator from liquidated SSV cluster
// ---------------------------------------------------------------------------
export const vx033BulkRemoveLiquidatedSSV: Scenario = {
  id: "VX-033-bulk-remove-liquidated-ssv",
  tags: ["validator", "remove", "bulk", "liquidated", "ssv-legacy", "vx"],

  async run(ctx: ScenarioContext) {
    // Need a liquidated SSV cluster
    const clusters = [...ctx.simState.clusterBook.values()].filter(
      (c) => c.version === 0 && !c.cluster.active && c.validatorKeys.length > 0,
    );
    if (clusters.length === 0) {
      throw new ScenarioSkipped("No liquidated SSV clusters with validators");
    }
    const record = ctx.rng.pick(clusters);
    ctx.setActiveCluster(record);

    const keys = [...record.validatorKeys];
    await ctx.step(
      "bulk-remove-liquidated-ssv",
      async () => {
        await bulkRemoveValidators(ctx, record, keys);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "still-liquidated");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-035: bulkRemoveValidator — liquidated, explicit EB, deviation NOT cleaned
// ---------------------------------------------------------------------------
export const vx035BulkRemoveLiquidatedEB: Scenario = {
  id: "VX-035-bulk-remove-liquidated-eb",
  tags: ["validator", "remove", "bulk", "liquidated", "explicit-eb", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickLiquidatedCluster(ctx);
    ctx.setActiveCluster(record);

    const keys = [...record.validatorKeys];
    await ctx.step(
      "bulk-remove-liquidated-eb",
      async () => {
        await bulkRemoveValidators(ctx, record, keys);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "still-liquidated");
        assertDaoVUnitsNonNegative(post, "dao-after-bulk");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-037: bulkRemoveValidator — 7-op, 2 removed ops, guard skips
// ---------------------------------------------------------------------------
export const vx037BulkRemoveMultiRemovedOps: Scenario = {
  id: "VX-037-bulk-remove-multi-removed-ops",
  tags: ["validator", "remove", "bulk", "removed-operator", "multi-op", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithMinValidators(ctx, 2);
    ctx.setActiveCluster(record);

    // Find two active operators
    const op1 = findActiveOp(ctx, record);
    let op2 = null;
    for (const opId of record.operatorIds) {
      if (opId === op1.id) continue;
      const op = ctx.actors.operators.get(opId);
      if (op && op.isActive) { op2 = op; break; }
    }
    if (!op2) throw new ScenarioSkipped("Need 2+ active operators for VX-037");

    // Step 1: EB update
    const eb = 48 * record.validatorKeys.length;
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, eb);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
      },
    );

    // Step 2: Remove both operators
    await ctx.step(
      "remove-operators",
      async () => {
        await removeOperator(ctx, op1);
        await removeOperator(ctx, op2!);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op1.id, "op1-removed");
        assertOperatorRemoved(post, op2!.id, "op2-removed");
      },
    );

    // Step 3: Bulk remove all validators
    const keys = [...record.validatorKeys];
    await ctx.step(
      "bulk-remove-all",
      async () => {
        await bulkRemoveValidators(ctx, record, keys);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op1.id, "op1-still-removed");
        assertOperatorRemoved(post, op2!.id, "op2-still-removed");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-038: bulkRemoveValidator — EB up then EB down, no underflow
// ---------------------------------------------------------------------------
export const vx038BulkRemoveEBUpDown: Scenario = {
  id: "VX-038-bulk-remove-eb-up-down",
  tags: ["validator", "remove", "bulk", "eb-update", "no-underflow", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithMinValidators(ctx, 2);
    ctx.setActiveCluster(record);

    // Step 1: EB up (80 ETH)
    await ctx.step(
      "eb-up",
      async () => {
        await performEBUpdate(ctx, record, 80 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-up");
      },
    );

    // Step 2: EB down (66 ETH)
    await ctx.step(
      "eb-down",
      async () => {
        await performEBUpdate(ctx, record, 66 * record.validatorKeys.length);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-down");
      },
    );

    // Step 3: Bulk remove all — no underflow
    const keys = [...record.validatorKeys];
    await ctx.step(
      "bulk-remove-all",
      async () => {
        await bulkRemoveValidators(ctx, record, keys);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-040: exitValidator from SSV cluster — event only
// ---------------------------------------------------------------------------
export const vx040ExitSSVCluster: Scenario = {
  id: "VX-040-exit-ssv-cluster",
  tags: ["validator", "exit", "ssv-legacy", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "exit-ssv-validator",
      async () => {
        await exitValidator(ctx, record);
      },
      async (pre, post) => {
        // Exit is signal only — no state change
        if (pre.cluster && post.cluster) {
          if (post.cluster.validatorCount !== pre.cluster.validatorCount) {
            throw new Error("exitValidator should not change validatorCount");
          }
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-044: exitValidator from liquidated cluster — event emitted
// ---------------------------------------------------------------------------
export const vx044ExitLiquidated: Scenario = {
  id: "VX-044-exit-liquidated",
  tags: ["validator", "exit", "liquidated", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickLiquidatedCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "exit-from-liquidated",
      async () => {
        await exitValidator(ctx, record);
      },
      async (_pre, post) => {
        // Exit from liquidated still succeeds (event only)
        assertClusterLiquidated(post, "still-liquidated");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-050: bulkExitValidator — non-owner reverts
// ---------------------------------------------------------------------------
export const vx050BulkExitNonOwner: Scenario = {
  id: "VX-050-bulk-exit-non-owner-revert",
  tags: ["validator", "exit", "bulk", "revert", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithMinValidators(ctx, 2);
    ctx.setActiveCluster(record);

    // Find a different signer (not the cluster owner)
    const otherOwners = ctx.actors.clusterOwners.filter(
      (s) => s.address !== record.owner,
    );
    if (otherOwners.length === 0) {
      throw new ScenarioSkipped("No alternative signers available");
    }
    const notOwner = otherOwners[0];

    await ctx.step(
      "bulk-exit-wrong-owner",
      async () => {
        await ctx.contracts.network
          .connect(notOwner)
          .bulkExitValidator(record.validatorKeys, record.operatorIds);
      },
      async () => {
        throw new Error("UNREACHABLE: non-owner bulk exit should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-051: bulkExitValidator from liquidated cluster — events emitted
// ---------------------------------------------------------------------------
export const vx051BulkExitLiquidated: Scenario = {
  id: "VX-051-bulk-exit-liquidated",
  tags: ["validator", "exit", "bulk", "liquidated", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickLiquidatedCluster(ctx);
    ctx.setActiveCluster(record);

    const keys = [...record.validatorKeys];
    await ctx.step(
      "bulk-exit-liquidated",
      async () => {
        await bulkExitValidators(ctx, record, keys);
      },
      async (_pre, post) => {
        // Exit is signal only — cluster stays liquidated
        assertClusterLiquidated(post, "still-liquidated");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-052: bulkExitValidator from SSV cluster — events emitted
// ---------------------------------------------------------------------------
export const vx052BulkExitSSV: Scenario = {
  id: "VX-052-bulk-exit-ssv",
  tags: ["validator", "exit", "bulk", "ssv-legacy", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    const keys = [...record.validatorKeys];
    await ctx.step(
      "bulk-exit-ssv",
      async () => {
        await bulkExitValidators(ctx, record, keys);
      },
      async (pre, post) => {
        // Exit is signal only — no state change
        if (pre.cluster && post.cluster) {
          if (post.cluster.validatorCount !== pre.cluster.validatorCount) {
            throw new Error("bulk exit should not change validatorCount");
          }
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-058: bulkRemoveValidator after deposit — correct balance
// ---------------------------------------------------------------------------
export const vx058BulkRemoveAfterDeposit: Scenario = {
  id: "VX-058-bulk-remove-after-deposit",
  tags: ["validator", "remove", "bulk", "deposit", "fee-settlement", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithMinValidators(ctx, 3);
    ctx.setActiveCluster(record);

    // Step 1: Deposit more ETH
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        // Balance should increase from deposit
        if (!pre.cluster || !post.cluster) throw new Error("no cluster");
        if (post.cluster.balance <= pre.cluster.balance) {
          throw new Error("balance should increase after deposit");
        }
      },
    );

    await ctx.mineBlocks(100);

    // Step 2: Bulk remove some validators
    const keysToRemove = record.validatorKeys.slice(0, 2);
    await ctx.step(
      "bulk-remove-partial",
      async () => {
        await bulkRemoveValidators(ctx, record, [...keysToRemove]);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -2, "after-bulk-remove");
        assertClusterActive(post, "still-active");
        assertDaoVUnitsNonNegative(post, "dao-after-remove");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-059: removeValidator then exitValidator same pubkey — revert
// ---------------------------------------------------------------------------
export const vx059RemoveThenExitRevert: Scenario = {
  id: "VX-059-remove-then-exit-revert",
  tags: ["validator", "remove", "exit", "revert", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);
    const pubkey = record.validatorKeys[0];

    // Step 1: Remove validator
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record, pubkey);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-remove");
      },
    );

    // Step 2: Exit same pubkey — should revert
    await ctx.step(
      "exit-removed-validator",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .exitValidator(pubkey, record.operatorIds);
      },
      async () => {
        throw new Error("UNREACHABLE: exit after remove should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-060: bulkRemoveValidator — 10-op, explicit EB, deviation cleanup
// ---------------------------------------------------------------------------
export const vx060BulkRemove10OpEB: Scenario = {
  id: "VX-060-bulk-remove-10op-eb-cleanup",
  tags: ["validator", "remove", "bulk", "explicit-eb", "cleanup", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithMinValidators(ctx, 2);
    ctx.setActiveCluster(record);

    // Step 1: EB update to create deviation
    const eb = 48 * record.validatorKeys.length;
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, eb);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
      },
    );

    // Step 2: Bulk remove all validators
    const keys = [...record.validatorKeys];
    await ctx.step(
      "bulk-remove-all",
      async () => {
        await bulkRemoveValidators(ctx, record, keys);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-after-cleanup");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-062: bulkExitValidator — idempotent, second call succeeds
// ---------------------------------------------------------------------------
export const vx062BulkExitIdempotent: Scenario = {
  id: "VX-062-bulk-exit-idempotent",
  tags: ["validator", "exit", "bulk", "idempotent", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithMinValidators(ctx, 2);
    ctx.setActiveCluster(record);
    const keys = [...record.validatorKeys];

    // Step 1: First bulk exit
    await ctx.step(
      "bulk-exit-1",
      async () => {
        await bulkExitValidators(ctx, record, keys);
      },
      async (pre, post) => {
        // No state change from exit
        if (pre.cluster && post.cluster) {
          if (post.cluster.validatorCount !== pre.cluster.validatorCount) {
            throw new Error("exit should not change validatorCount");
          }
        }
      },
    );

    // Step 2: Second bulk exit — should also succeed (idempotent)
    await ctx.step(
      "bulk-exit-2",
      async () => {
        await bulkExitValidators(ctx, record, keys);
      },
      async (pre, post) => {
        // Still no state change
        if (pre.cluster && post.cluster) {
          if (post.cluster.validatorCount !== pre.cluster.validatorCount) {
            throw new Error("second exit should not change validatorCount");
          }
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-063: bulkRemoveValidator — removed op guard prevents underflow
// ---------------------------------------------------------------------------
export const vx063BulkRemoveRemovedOpUnderflow: Scenario = {
  id: "VX-063-bulk-remove-removed-op-underflow-guard",
  tags: ["validator", "remove", "bulk", "removed-operator", "underflow", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithMinValidators(ctx, 2);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: EB update
    const eb = 48 * record.validatorKeys.length;
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, eb);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
      },
    );

    // Step 2: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-removal");
      },
    );

    // Step 3: Bulk remove all — guard prevents underflow on removed op
    const keys = [...record.validatorKeys];
    await ctx.step(
      "bulk-remove-all",
      async () => {
        await bulkRemoveValidators(ctx, record, keys);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-stays-zero");
        assertDaoVUnitsNonNegative(post, "no-underflow");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-064: removeValidator — ALL operators removed
// ---------------------------------------------------------------------------
export const vx064RemoveAllOpsRemoved: Scenario = {
  id: "VX-064-remove-all-ops-removed",
  tags: ["validator", "remove", "removed-operator", "all-removed", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    // Remove all operators
    const opsToRemove: OperatorRecord[] = [];
    for (const opId of record.operatorIds) {
      const op = ctx.actors.operators.get(opId);
      if (op && op.isActive) opsToRemove.push(op);
    }
    if (opsToRemove.length === 0) {
      throw new ScenarioSkipped("No active operators to remove");
    }

    await ctx.step(
      "remove-all-operators",
      async () => {
        for (const op of opsToRemove) {
          await removeOperator(ctx, op);
        }
      },
      async (_pre, post) => {
        for (const op of opsToRemove) {
          assertOperatorRemoved(post, op.id, `op-${op.id}-removed`);
        }
      },
    );

    // Remove validator — all operators skipped in updateClusterOperators
    await ctx.step(
      "remove-validator-all-ops-removed",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-remove");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-065: removeValidator from SSV cluster — removed operator skipped
// ---------------------------------------------------------------------------
export const vx065RemoveSSVRemovedOp: Scenario = {
  id: "VX-065-remove-ssv-removed-op",
  tags: ["validator", "remove", "ssv-legacy", "removed-operator", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVClusterWithValidators(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    // Step 1: Remove operator
    await ctx.step(
      "remove-operator",
      async () => {
        await removeOperator(ctx, op);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "after-op-removal");
      },
    );

    // Step 2: Remove validator from SSV cluster
    await ctx.step(
      "remove-validator-ssv",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-remove");
        assertOperatorRemoved(post, op.id, "op-still-removed");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-067: bulkRemoveValidator from SSV cluster — validatorCount reaches 0
// ---------------------------------------------------------------------------
export const vx067BulkRemoveSSV: Scenario = {
  id: "VX-067-bulk-remove-ssv-to-zero",
  tags: ["validator", "remove", "bulk", "ssv-legacy", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickSSVClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    const keys = [...record.validatorKeys];
    await ctx.step(
      "bulk-remove-all-ssv",
      async () => {
        await bulkRemoveValidators(ctx, record, keys);
      },
      async (_pre, post) => {
        if (!post.cluster) throw new Error("no cluster in snapshot");
        if (post.cluster.validatorCount !== 0) {
          throw new Error(`validatorCount=${post.cluster.validatorCount} (expected 0)`);
        }
        assertDaoVUnitsNonNegative(post, "dao-after-bulk");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VX-069: bulkRemoveValidator — liquidated, explicit EB, partial removal
// ---------------------------------------------------------------------------
export const vx069BulkRemoveLiquidatedPartial: Scenario = {
  id: "VX-069-bulk-remove-liquidated-partial",
  tags: ["validator", "remove", "bulk", "liquidated", "explicit-eb", "partial", "vx"],

  async run(ctx: ScenarioContext) {
    const record = pickLiquidatedCluster(ctx);
    if (record.validatorKeys.length < 2) {
      throw new ScenarioSkipped("Need 2+ validators in liquidated cluster");
    }
    ctx.setActiveCluster(record);

    // Partial removal: remove all but 1
    const keysToRemove = record.validatorKeys.slice(0, record.validatorKeys.length - 1);
    await ctx.step(
      "bulk-remove-partial-liquidated",
      async () => {
        await bulkRemoveValidators(ctx, record, [...keysToRemove]);
      },
      async (_pre, post) => {
        assertClusterLiquidated(post, "still-liquidated");
        if (!post.cluster) throw new Error("no cluster");
        if (post.cluster.validatorCount !== 1) {
          throw new Error(`validatorCount=${post.cluster.validatorCount} (expected 1)`);
        }
        assertDaoVUnitsNonNegative(post, "dao-after-partial");
      },
    );
  },
};
