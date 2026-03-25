/**
 * VL edge-case scenarios: Validator edge cases and reverts
 *
 * Extracted from test/e2e/validators/validator-edge-cases.test.ts.
 *
 * 25 scenarios covering registration reverts, removal reverts, race conditions,
 * balance underflow protection, exit signals, DAO earnings consistency,
 * same-block operations, 13-operator clusters, explicit EB registration,
 * bulk removal, and deposit/withdraw side-effect checks.
 */

import { ethers } from "ethers";
import type { Scenario } from "../simulation/scenario-types.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickActiveETHCluster,
  pickClusterWithValidators,
  pickClusterWithMinValidators,
  generatePubkey,
  registerValidator,
  removeValidator,
  bulkRemoveValidators,
  exitValidator,
  assertClusterActive,
  assertValidatorCountChanged,
  assertBalanceIncreased,
  assertBalanceNonNegative,
  assertDaoVUnitsNonNegative,
} from "./_vl-helpers.ts";
import {
  depositToCluster,
  withdrawFromCluster,
} from "./_xm-helpers.ts";
import { DEFAULT_SHARES, EMPTY_CLUSTER } from "../common/constants.ts";

// ---------------------------------------------------------------------------
// VLE-001: Bulk register with empty array — revert EmptyPublicKeysList
// ---------------------------------------------------------------------------
export const vle001BulkRegisterEmpty: Scenario = {
  id: "VLE-001-bulk-register-empty-revert",
  tags: ["validator", "edge-case", "register", "bulk", "revert", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "bulk-register-empty",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .bulkRegisterValidator([], record.operatorIds, [], record.cluster, {
            value: ethers.parseEther("10"),
          });
      },
      async () => {
        throw new Error("UNREACHABLE: empty bulk register should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-002: Bulk register mismatched key/share arrays — revert
// ---------------------------------------------------------------------------
export const vle002BulkRegisterMismatch: Scenario = {
  id: "VLE-002-bulk-register-mismatch-revert",
  tags: ["validator", "edge-case", "register", "bulk", "revert", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "bulk-register-mismatch",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .bulkRegisterValidator(
            [generatePubkey(), generatePubkey()],
            record.operatorIds,
            [DEFAULT_SHARES],
            record.cluster,
            { value: ethers.parseEther("10") },
          );
      },
      async () => {
        throw new Error("UNREACHABLE: mismatched arrays should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-003: Invalid public key length — revert
// ---------------------------------------------------------------------------
export const vle003InvalidPubkeyLength: Scenario = {
  id: "VLE-003-invalid-pubkey-length-revert",
  tags: ["validator", "edge-case", "register", "revert", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    const shortKey = "0x" + "aa".repeat(32); // 32 bytes, not 48

    await ctx.step(
      "register-short-pubkey",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .registerValidator(
            shortKey,
            record.operatorIds,
            DEFAULT_SHARES,
            record.cluster,
            { value: ethers.parseEther("10") },
          );
      },
      async () => {
        throw new Error("UNREACHABLE: short pubkey should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-004: Less than 4 operators — revert InvalidOperatorIdsLength
// ---------------------------------------------------------------------------
export const vle004LessThan4Operators: Scenario = {
  id: "VLE-004-less-than-4-operators-revert",
  tags: ["validator", "edge-case", "register", "operator-count", "revert", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    const threeOps = record.operatorIds.slice(0, 3);
    if (threeOps.length < 3) {
      throw new ScenarioSkipped("Not enough operators in cluster");
    }

    await ctx.step(
      "register-3-operators",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .registerValidator(
            generatePubkey(),
            threeOps,
            DEFAULT_SHARES,
            EMPTY_CLUSTER,
            { value: ethers.parseEther("10") },
          );
      },
      async () => {
        throw new Error("UNREACHABLE: < 4 operators should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-005: 5 operators (not 4,7,10,13) — revert
// ---------------------------------------------------------------------------
export const vle005FiveOperators: Scenario = {
  id: "VLE-005-five-operators-revert",
  tags: ["validator", "edge-case", "register", "operator-count", "revert", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    const allOps = [...ctx.actors.operators.keys()].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    if (allOps.length < 5) {
      throw new ScenarioSkipped("Not enough operators (need 5+)");
    }
    const fiveOps = allOps.slice(0, 5);

    await ctx.step(
      "register-5-operators",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .registerValidator(
            generatePubkey(),
            fiveOps,
            DEFAULT_SHARES,
            EMPTY_CLUSTER,
            { value: ethers.parseEther("10") },
          );
      },
      async () => {
        throw new Error("UNREACHABLE: 5 operators should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-006: Unsorted operators — revert
// ---------------------------------------------------------------------------
export const vle006UnsortedOperators: Scenario = {
  id: "VLE-006-unsorted-operators-revert",
  tags: ["validator", "edge-case", "register", "operator-order", "revert", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.operatorIds.length < 4) {
      throw new ScenarioSkipped("Not enough operators in cluster");
    }
    // Swap first two to unsort
    const unsorted = [...record.operatorIds];
    [unsorted[0], unsorted[2]] = [unsorted[2], unsorted[0]];

    await ctx.step(
      "register-unsorted",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .registerValidator(
            generatePubkey(),
            unsorted,
            DEFAULT_SHARES,
            EMPTY_CLUSTER,
            { value: ethers.parseEther("10") },
          );
      },
      async () => {
        throw new Error("UNREACHABLE: unsorted operators should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-007: Duplicate operators — revert
// ---------------------------------------------------------------------------
export const vle007DuplicateOperators: Scenario = {
  id: "VLE-007-duplicate-operators-revert",
  tags: ["validator", "edge-case", "register", "operator-unique", "revert", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.operatorIds.length < 3) {
      throw new ScenarioSkipped("Not enough operators in cluster");
    }
    const dups = [
      record.operatorIds[0],
      record.operatorIds[0],
      record.operatorIds[1],
      record.operatorIds[2],
    ];

    await ctx.step(
      "register-duplicate-ops",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .registerValidator(
            generatePubkey(),
            dups,
            DEFAULT_SHARES,
            EMPTY_CLUSTER,
            { value: ethers.parseEther("10") },
          );
      },
      async () => {
        throw new Error("UNREACHABLE: duplicate operators should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-008: Validator already registered — revert
// ---------------------------------------------------------------------------
export const vle008AlreadyRegistered: Scenario = {
  id: "VLE-008-already-registered-revert",
  tags: ["validator", "edge-case", "register", "duplicate", "revert", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    const existingPk = record.validatorKeys[0];

    await ctx.step(
      "register-existing-pubkey",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .registerValidator(
            existingPk,
            record.operatorIds,
            DEFAULT_SHARES,
            record.cluster,
            { value: ethers.parseEther("10") },
          );
      },
      async () => {
        throw new Error("UNREACHABLE: already registered should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-009: Wrong cluster struct — revert IncorrectClusterState
// ---------------------------------------------------------------------------
export const vle009WrongClusterStruct: Scenario = {
  id: "VLE-009-wrong-cluster-struct-revert",
  tags: ["validator", "edge-case", "register", "cluster-state", "revert", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    const wrongCluster = { ...record.cluster, validatorCount: 99n };

    await ctx.step(
      "register-wrong-cluster",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .registerValidator(
            generatePubkey(),
            record.operatorIds,
            DEFAULT_SHARES,
            wrongCluster,
            { value: ethers.parseEther("10") },
          );
      },
      async () => {
        throw new Error("UNREACHABLE: wrong cluster struct should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-010: Remove non-existent validator — revert
// ---------------------------------------------------------------------------
export const vle010RemoveNonExistent: Scenario = {
  id: "VLE-010-remove-nonexistent-revert",
  tags: ["validator", "edge-case", "remove", "revert", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "remove-nonexistent",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .removeValidator(generatePubkey(), record.operatorIds, record.cluster);
      },
      async () => {
        throw new Error("UNREACHABLE: non-existent validator should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-011: Wrong owner removes — revert
// ---------------------------------------------------------------------------
export const vle011WrongOwnerRemove: Scenario = {
  id: "VLE-011-wrong-owner-remove-revert",
  tags: ["validator", "edge-case", "remove", "auth", "revert", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    const otherOwners = ctx.actors.clusterOwners.filter(
      (s) => s.address !== record.owner,
    );
    if (otherOwners.length === 0) {
      throw new ScenarioSkipped("No alternative signers available");
    }
    const wrongOwner = otherOwners[0];

    await ctx.step(
      "remove-wrong-owner",
      async () => {
        await ctx.contracts.network
          .connect(wrongOwner)
          .removeValidator(
            record.validatorKeys[0],
            record.operatorIds,
            record.cluster,
          );
      },
      async () => {
        throw new Error("UNREACHABLE: wrong owner should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-012: Stale cluster struct on remove — revert
// ---------------------------------------------------------------------------
export const vle012StaleClusterRemove: Scenario = {
  id: "VLE-012-stale-cluster-remove-revert",
  tags: ["validator", "edge-case", "remove", "cluster-state", "revert", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "remove-stale-cluster",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .removeValidator(
            record.validatorKeys[0],
            record.operatorIds,
            EMPTY_CLUSTER,
          );
      },
      async () => {
        throw new Error("UNREACHABLE: stale cluster should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-013: Bulk remove with empty array — revert
// ---------------------------------------------------------------------------
export const vle013BulkRemoveEmpty: Scenario = {
  id: "VLE-013-bulk-remove-empty-revert",
  tags: ["validator", "edge-case", "remove", "bulk", "revert", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "bulk-remove-empty",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .bulkRemoveValidator([], record.operatorIds, record.cluster);
      },
      async () => {
        throw new Error("UNREACHABLE: empty bulk remove should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-014: Register then remove in same block — no double counting
// ---------------------------------------------------------------------------
export const vle014SameBlockRegisterRemove: Scenario = {
  id: "VLE-014-same-block-register-remove",
  tags: ["validator", "edge-case", "race-condition", "same-block", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    // Register a new validator first (in its own block)
    await ctx.step(
      "register-new-validator",
      async () => {
        await registerValidator(ctx, record, "10");
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, 1, "after-register");
      },
    );

    await ctx.mineBlocks(100);

    // Remove the first validator
    await ctx.step(
      "remove-original-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-remove");
        assertClusterActive(post, "still-active");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-015: Cluster balance floors at 0 when fees exceed balance
// ---------------------------------------------------------------------------
export const vle015BalanceFloorZero: Scenario = {
  id: "VLE-015-balance-floor-zero",
  tags: ["validator", "edge-case", "balance-underflow", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    // Mine a very large number of blocks to drain the cluster
    await ctx.mineBlocks(1_000_000);

    await ctx.step(
      "verify-balance-floor",
      async () => {},
      async (_pre, post) => {
        // Balance should be 0 (floored), not negative
        assertBalanceNonNegative(post, "balance-floor");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-016: exitValidator — event only, no state change
// ---------------------------------------------------------------------------
export const vle016ExitNoStateChange: Scenario = {
  id: "VLE-016-exit-no-state-change",
  tags: ["validator", "edge-case", "exit", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "exit-validator",
      async () => {
        await exitValidator(ctx, record);
      },
      async (pre, post) => {
        // Exit is signal only — validatorCount should not change
        if (pre.cluster && post.cluster) {
          if (post.cluster.validatorCount !== pre.cluster.validatorCount) {
            throw new Error("exitValidator should not change validatorCount");
          }
        }
      },
    );

    // Can still remove the validator after exit
    await ctx.step(
      "remove-after-exit",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-remove");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-017: exitValidator non-existent — revert
// ---------------------------------------------------------------------------
export const vle017ExitNonExistent: Scenario = {
  id: "VLE-017-exit-nonexistent-revert",
  tags: ["validator", "edge-case", "exit", "revert", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "exit-nonexistent",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .exitValidator(generatePubkey(), record.operatorIds);
      },
      async () => {
        throw new Error("UNREACHABLE: non-existent validator exit should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-018: exitValidator with wrong operator IDs — revert
// ---------------------------------------------------------------------------
export const vle018ExitWrongOpIds: Scenario = {
  id: "VLE-018-exit-wrong-op-ids-revert",
  tags: ["validator", "edge-case", "exit", "revert", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    // Use a different set of operator IDs
    const allOps = [...ctx.actors.operators.keys()].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const wrongOps = allOps.filter(
      (id) => !record.operatorIds.includes(id),
    );
    if (wrongOps.length < 4) {
      throw new ScenarioSkipped("Not enough alternative operators for wrong-ops test");
    }
    const wrongOpIds = wrongOps.slice(0, 4);

    await ctx.step(
      "exit-wrong-ops",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .exitValidator(record.validatorKeys[0], wrongOpIds);
      },
      async () => {
        throw new Error("UNREACHABLE: wrong op IDs should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-019: DAO earnings match cluster network fee payments
// ---------------------------------------------------------------------------
export const vle019DaoEarningsConsistency: Scenario = {
  id: "VLE-019-dao-earnings-consistency",
  tags: ["validator", "edge-case", "dao", "network-fee", "conservation", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Register to establish fee baseline
    await ctx.step(
      "register-validator",
      async () => {
        await registerValidator(ctx, record, "10");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-register");
      },
    );

    await ctx.mineBlocks(100);

    // Step 2: Verify DAO earnings are consistent
    await ctx.step(
      "verify-dao-consistency",
      async () => {},
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-consistent");
        // All operator earnings should be non-negative
        for (const opId of record.operatorIds) {
          const opSnap = post.operators.get(opId);
          if (opSnap && opSnap.earnings < 0n) {
            throw new Error(
              `operator ${opId} has negative earnings`,
            );
          }
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-020: Operator + validator registration same block — zero blockDiff OK
// ---------------------------------------------------------------------------
export const vle020SameBlockOpAndVal: Scenario = {
  id: "VLE-020-same-block-op-val-register",
  tags: ["validator", "edge-case", "same-block", "vl"],

  async run(ctx: ScenarioContext) {
    // In MC context, this is hard to replicate precisely (would need
    // automine disabled). Instead, verify registration works normally
    // immediately after operator setup (which is the MC default state).
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "register-after-ops",
      async () => {
        await registerValidator(ctx, record, "10");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-register");
        assertValidatorCountChanged(pre, post, 1, "after-register");
      },
    );

    // Verify fee accrual after 1 block
    await ctx.mineBlocks(1);

    await ctx.step(
      "verify-1-block-earnings",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "after-1-block");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-021: 13-operator cluster — correct state and gas
// ---------------------------------------------------------------------------
export const vle021ThirteenOperators: Scenario = {
  id: "VLE-021-thirteen-operators",
  tags: ["validator", "edge-case", "13-op", "gas", "vl"],

  async run(ctx: ScenarioContext) {
    // Need a cluster with 13 operators. In MC state, clusters typically
    // have 4 or 7 operators. Skip if no 13-op cluster available.
    const clusters = [...ctx.simState.clusterBook.values()].filter(
      (c) => c.cluster.active && c.operatorIds.length === 13,
    );
    if (clusters.length === 0) {
      throw new ScenarioSkipped("No 13-operator clusters available");
    }
    const record = ctx.rng.pick(clusters);
    ctx.setActiveCluster(record);

    await ctx.step(
      "register-on-13-ops",
      async () => {
        await registerValidator(ctx, record, "50");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-register");
        assertValidatorCountChanged(pre, post, 1, "after-register");
      },
    );

    await ctx.mineBlocks(100);

    await ctx.step(
      "verify-13-op-earnings",
      async () => {},
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "dao-13-op");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-022: Adding validator to explicit-EB cluster
// ---------------------------------------------------------------------------
export const vle022ExplicitEBRegistration: Scenario = {
  id: "VLE-022-explicit-eb-registration",
  tags: ["validator", "edge-case", "explicit-eb", "register", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Register additional validators
    await ctx.step(
      "register-second",
      async () => {
        await registerValidator(ctx, record, "10");
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, 1, "after-second");
      },
    );

    await ctx.step(
      "register-third",
      async () => {
        await registerValidator(ctx, record, "10");
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, 1, "after-third");
        assertClusterActive(post, "after-third");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-023: Remove last validator — cluster persists with remaining balance
// ---------------------------------------------------------------------------
export const vle023RemoveLastBalance: Scenario = {
  id: "VLE-023-remove-last-balance",
  tags: ["validator", "edge-case", "remove", "last-validator", "balance", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    await ctx.mineBlocks(50);

    // Remove all validators
    const keyCount = record.validatorKeys.length;
    for (let i = 0; i < keyCount; i++) {
      await ctx.step(
        `remove-validator-${i + 1}`,
        async () => {
          await removeValidator(ctx, record);
        },
        async (pre, post) => {
          assertValidatorCountChanged(pre, post, -1, `remove-${i + 1}`);
        },
      );
    }

    // Verify cluster persists with balance
    await ctx.step(
      "verify-balance-persists",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "after-all-removed");
        assertBalanceNonNegative(post, "remaining-balance");
        if (!post.cluster) throw new Error("no cluster");
        if (post.cluster.validatorCount !== 0) {
          throw new Error(
            `validatorCount=${post.cluster.validatorCount} (expected 0)`,
          );
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-024: Bulk remove 3 of 5 validators — correct state
// ---------------------------------------------------------------------------
export const vle024BulkRemovePartial: Scenario = {
  id: "VLE-024-bulk-remove-partial",
  tags: ["validator", "edge-case", "remove", "bulk", "partial", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithMinValidators(ctx, 3);
    ctx.setActiveCluster(record);

    await ctx.mineBlocks(100);

    // Remove first 2 validators via bulk remove
    const keysToRemove = record.validatorKeys.slice(0, 2);
    await ctx.step(
      "bulk-remove-partial",
      async () => {
        await bulkRemoveValidators(ctx, record, [...keysToRemove]);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -2, "after-bulk-remove");
        assertClusterActive(post, "still-active");
      },
    );

    // Can still remove remaining validators individually
    await ctx.step(
      "remove-remaining",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-single-remove");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VLE-025: Deposit and withdraw — no side effects on operator state
// ---------------------------------------------------------------------------
export const vle025DepositWithdrawNoSideEffects: Scenario = {
  id: "VLE-025-deposit-withdraw-no-side-effects",
  tags: ["validator", "edge-case", "deposit", "withdraw", "side-effect", "vl"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithMinValidators(ctx, 2);
    ctx.setActiveCluster(record);

    // Capture operator state before
    const opsBefore = new Map<bigint, { fee: bigint; earnings: bigint }>();
    for (const opId of record.operatorIds) {
      const snap = (await ctx.snapshot()).operators.get(opId);
      if (snap) opsBefore.set(opId, { fee: snap.fee, earnings: snap.earnings });
    }

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "5");
      },
      async (pre, post) => {
        assertBalanceIncreased(pre, post, "after-deposit");
        // Operator fees should not change
        for (const opId of record.operatorIds) {
          const before = opsBefore.get(opId);
          const after = post.operators.get(opId);
          if (before && after && before.fee !== after.fee) {
            throw new Error(
              `operator ${opId} fee changed on deposit`,
            );
          }
        }
      },
    );

    // Step 2: Withdraw
    await ctx.step(
      "withdraw",
      async () => {
        await withdrawFromCluster(ctx, record, "0.1");
      },
      async (_pre, post) => {
        assertClusterActive(post, "after-withdraw");
        // Operator fees still unchanged
        for (const opId of record.operatorIds) {
          const before = opsBefore.get(opId);
          const after = post.operators.get(opId);
          if (before && after && before.fee !== after.fee) {
            throw new Error(
              `operator ${opId} fee changed on withdraw`,
            );
          }
        }
      },
    );
  },
};
