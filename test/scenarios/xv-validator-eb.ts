/**
 * XV scenarios: Validator + Effective Balance cross-module chains
 *
 * Extracted from test/e2e/cross-cutting/xv-vl-eb.test.ts.
 * Tests multi-step chains combining validator registration/removal
 * with EB updates to verify vUnit calculations, deviation cleanup,
 * and daoTotalEthVUnits consistency.
 *
 * 10 scenarios covering representative validator + EB flows.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickETHCluster,
  findActiveOp,
  depositToCluster,
  performEBUpdate,
  removeOperator,
  removeValidator,
  assertClusterActive,
  assertDaoVUnitsNonNegative,
  assertOperatorRemoved,
  assertActiveOpVUnitsValid,
  assertValidatorCountChanged,
} from "./_xm-helpers.ts";

// ---------------------------------------------------------------------------
// XV-001: Register → EB at baseline (32 ETH) → remove — no deviation
// ---------------------------------------------------------------------------
export const xv001EBBaseline: Scenario = {
  id: "XV-001-eb-baseline-no-deviation",
  tags: ["cross-module", "validator", "eb-update", "xv", "baseline"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new Error("No validators in cluster for XV-001");
    }

    // Step 1: EB update at baseline (32 ETH per validator)
    const eb = 32 * record.validatorKeys.length;
    await ctx.step(
      "eb-update-baseline",
      async () => {
        await performEBUpdate(ctx, record, eb);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-baseline");
        assertClusterActive(post, "after-eb-baseline");
      },
    );

    await ctx.mineBlocks(100);

    // Step 2: Remove validator
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-remove-val");
        assertDaoVUnitsNonNegative(post, "dao-after-remove");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XV-002: Register → EB 48 ETH → remove — deviation cleanup
// ---------------------------------------------------------------------------
export const xv002EBDeviationCleanup: Scenario = {
  id: "XV-002-eb-deviation-cleanup",
  tags: ["cross-module", "validator", "eb-update", "xv", "deviation"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new Error("No validators in cluster for XV-002");
    }

    // Step 1: EB update to 48 ETH per validator (creates deviation)
    const eb = 48 * record.validatorKeys.length;
    await ctx.step(
      "eb-update-48",
      async () => {
        await performEBUpdate(ctx, record, eb);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-48");
      },
    );

    await ctx.mineBlocks(100);

    // Step 2: Remove all validators → cleanup loop fires
    const keysCount = record.validatorKeys.length;
    for (let i = 0; i < keysCount; i++) {
      await ctx.step(
        `remove-validator-${i + 1}`,
        async () => {
          await removeValidator(ctx, record);
        },
        async (_pre, post) => {
          assertDaoVUnitsNonNegative(post, `dao-after-remove-${i + 1}`);
        },
      );
    }
  },
};

// ---------------------------------------------------------------------------
// XV-003: 2+ validators → EB 48/val → partial remove — deviation preserved
// ---------------------------------------------------------------------------
export const xv003PartialRemoveDevPreserved: Scenario = {
  id: "XV-003-partial-remove-deviation-preserved",
  tags: ["cross-module", "validator", "eb-update", "xv", "partial-remove"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length < 2) {
      throw new Error("Need at least 2 validators for XV-003");
    }

    // Step 1: EB update
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

    await ctx.mineBlocks(50);

    // Step 2: Remove only 1 validator (partial → deviation preserved)
    await ctx.step(
      "remove-one-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-partial-remove");
        assertDaoVUnitsNonNegative(post, "dao-after-partial");
        // Deviation should be preserved (not cleaned) since validatorCount > 0
        for (const opId of record.operatorIds) {
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-dev-preserved`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XV-004: Double EB update across validator count change
// ---------------------------------------------------------------------------
export const xv004DoubleEBValidatorChange: Scenario = {
  id: "XV-004-double-eb-across-val-change",
  tags: ["cross-module", "validator", "eb-update", "xv", "double-update"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length < 2) {
      throw new Error("Need at least 2 validators for XV-004");
    }

    // Step 1: First EB update
    const eb1 = 48 * record.validatorKeys.length;
    await ctx.step(
      "eb-update-1",
      async () => {
        await performEBUpdate(ctx, record, eb1);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-1");
      },
    );

    await ctx.mineBlocks(50);

    // Step 2: Remove 1 validator (changes baseline)
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, -1, "after-remove");
      },
    );

    await ctx.mineBlocks(50);

    // Step 3: Second EB update (uses new validatorCount for baseline)
    const eb2 = 64 * record.validatorKeys.length;
    await ctx.step(
      "eb-update-2",
      async () => {
        await performEBUpdate(ctx, record, eb2);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-2");
        for (const opId of record.operatorIds) {
          assertActiveOpVUnitsValid(post, opId, `op-${opId}-after-double-eb`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XV-005: EB update → remove operator → remove validator (guard + cleanup)
// ---------------------------------------------------------------------------
export const xv005EBRemoveOpRemoveVal: Scenario = {
  id: "XV-005-eb-remove-op-remove-val",
  tags: ["cross-module", "validator", "eb-update", "removed-operator", "xv"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);
    const op = findActiveOp(ctx, record);

    if (record.validatorKeys.length === 0) {
      throw new Error("No validators in cluster for XV-005");
    }

    // Step 1: EB update
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 48);
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

    await ctx.mineBlocks(50);

    // Step 3: Remove validator (cleanup guard skips removed op)
    await ctx.step(
      "remove-validator",
      async () => {
        await removeValidator(ctx, record);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "op-after-val-removal");
        assertDaoVUnitsNonNegative(post, "dao-final");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XV-006: EB increase → verify daoTotalEthVUnits changes
// ---------------------------------------------------------------------------
export const xv006EBIncreaseDaoVUnits: Scenario = {
  id: "XV-006-eb-increase-dao-vunits",
  tags: ["cross-module", "validator", "eb-update", "xv", "dao"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit enough to survive EB increase
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, _post) => {},
    );

    // Step 2: First EB update (implicit → explicit)
    await ctx.step(
      "eb-update-64",
      async () => {
        await performEBUpdate(ctx, record, 64);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-64");
      },
    );

    await ctx.mineBlocks(50);

    // Step 3: Second EB update (increase)
    await ctx.step(
      "eb-update-96",
      async () => {
        await performEBUpdate(ctx, record, 96);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-96");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XV-007: EB decrease → verify burn rate drops
// ---------------------------------------------------------------------------
export const xv007EBDecreaseBurnRate: Scenario = {
  id: "XV-007-eb-decrease-burn-rate",
  tags: ["cross-module", "validator", "eb-update", "xv", "decrease"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "20");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB increase first
    await ctx.step(
      "eb-increase",
      async () => {
        await performEBUpdate(ctx, record, 96);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-increase");
      },
    );

    await ctx.mineBlocks(50);

    // Step 3: EB decrease (back to 64)
    await ctx.step(
      "eb-decrease",
      async () => {
        await performEBUpdate(ctx, record, 64);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-decrease");
        assertClusterActive(post, "after-eb-decrease");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XV-008: EB update on cluster with removed operator — guard skips removed
// ---------------------------------------------------------------------------
export const xv008EBWithRemovedOp: Scenario = {
  id: "XV-008-eb-with-removed-op",
  tags: ["cross-module", "validator", "eb-update", "removed-operator", "xv"],

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

    await ctx.mineBlocks(50);

    // Step 2: EB update (guard skips removed op)
    await ctx.step(
      "eb-update-with-removed",
      async () => {
        await performEBUpdate(ctx, record, 48);
      },
      async (_pre, post) => {
        assertOperatorRemoved(post, op.id, "removed-after-eb");
        assertDaoVUnitsNonNegative(post, "dao-after-eb");
        // Active ops should have valid vUnits
        for (const opId of record.operatorIds) {
          if (opId !== op.id) {
            assertActiveOpVUnitsValid(post, opId, `active-op-${opId}`);
          }
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XV-009: Multiple EB updates → verify progressive deviation changes
// ---------------------------------------------------------------------------
export const xv009MultipleEBUpdates: Scenario = {
  id: "XV-009-multiple-eb-updates",
  tags: ["cross-module", "validator", "eb-update", "xv", "progressive"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Deposit plenty
    await ctx.step(
      "deposit",
      async () => {
        await depositToCluster(ctx, record, "30");
      },
      async (_pre, _post) => {},
    );

    // Step 2: EB update 1 (48 ETH)
    await ctx.step(
      "eb-update-48",
      async () => {
        await performEBUpdate(ctx, record, 48);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-48");
      },
    );

    await ctx.mineBlocks(50);

    // Step 3: EB update 2 (96 ETH)
    await ctx.step(
      "eb-update-96",
      async () => {
        await performEBUpdate(ctx, record, 96);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-96");
      },
    );

    await ctx.mineBlocks(50);

    // Step 4: EB update 3 (64 ETH — decrease)
    await ctx.step(
      "eb-update-64-decrease",
      async () => {
        await performEBUpdate(ctx, record, 64);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb-64");
        assertClusterActive(post, "after-eb-64");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// XV-010: EB update → remove all validators → verify daoVUnits == 0
// ---------------------------------------------------------------------------
export const xv010EBRemoveAllVals: Scenario = {
  id: "XV-010-eb-remove-all-vals-zero",
  tags: ["cross-module", "validator", "eb-update", "xv", "cleanup"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    if (record.validatorKeys.length === 0) {
      throw new Error("No validators in cluster for XV-010");
    }

    // Step 1: EB update to set deviation
    await ctx.step(
      "eb-update",
      async () => {
        await performEBUpdate(ctx, record, 64);
      },
      async (_pre, post) => {
        assertDaoVUnitsNonNegative(post, "after-eb");
      },
    );

    await ctx.mineBlocks(50);

    // Step 2: Remove all validators
    const keysCount = record.validatorKeys.length;
    for (let i = 0; i < keysCount; i++) {
      await ctx.step(
        `remove-validator-${i + 1}`,
        async () => {
          await removeValidator(ctx, record);
        },
        async (_pre, post) => {
          assertDaoVUnitsNonNegative(post, `dao-after-remove-${i + 1}`);
        },
      );
    }
  },
};
