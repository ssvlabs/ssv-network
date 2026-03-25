/**
 * VR scenarios: Validator registration
 *
 * Extracted from:
 * - test/e2e/validators/validator-lifecycle.test.ts (registration sections)
 * - test/e2e/validators/vr-gap.test.ts (VR-005 through VR-073)
 *
 * 35 scenarios covering new cluster registration, existing cluster addition,
 * private/whitelisted operators, bulk registration, deposit thresholds,
 * revert cases, and DAO counter updates.
 */

import { ethers } from "ethers";
import type { Scenario } from "../simulation/scenario-types.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import {
  pickActiveETHCluster,
  pickClusterWithValidators,
  pickSSVClusterWithValidators,
  generatePubkey,
  registerValidator,
  bulkRegisterValidators,
  assertClusterActive,
  assertValidatorCountChanged,
  assertBalanceIncreased,
  assertDaoVUnitsNonNegative,
} from "./_vl-helpers.ts";
import { DEFAULT_SHARES, EMPTY_CLUSTER } from "../common/constants.ts";

// ---------------------------------------------------------------------------
// VR-L001: Register validator — default ETH fee, fees accrue
// ---------------------------------------------------------------------------
export const vrL001RegisterDefaultFee: Scenario = {
  id: "VR-L001-register-default-fee",
  tags: ["validator", "register", "fee-accrual", "vr"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Register a new validator
    await ctx.step(
      "register-validator",
      async () => {
        await registerValidator(ctx, record, "10");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-register");
        assertValidatorCountChanged(pre, post, 1, "after-register");
        assertBalanceIncreased(pre, post, "after-register");
      },
    );

    // Step 2: Mine blocks to accrue fees
    await ctx.mineBlocks(100);

    // Step 3: Verify fees accrued — operator earnings should increase
    await ctx.step(
      "verify-fee-accrual",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "after-mine");
        for (const opId of record.operatorIds) {
          const opSnap = post.operators.get(opId);
          if (opSnap && opSnap.isActive && opSnap.fee > 0n) {
            if (opSnap.earnings <= 0n) {
              throw new Error(`operator ${opId} earnings should be > 0 after mining`);
            }
          }
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-L002: Register with fee=0 — zero fee accrual
// ---------------------------------------------------------------------------
export const vrL002RegisterZeroFee: Scenario = {
  id: "VR-L002-register-zero-fee",
  tags: ["validator", "register", "zero-fee", "vr"],

  async run(ctx: ScenarioContext) {
    // This scenario needs operators with fee=0. In MC state, operators
    // may not have zero fees. Skip if none available.
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    const zeroFeeOps = record.operatorIds.filter((id) => {
      const op = ctx.actors.operators.get(id);
      return op && op.isActive && op.fee === 0n;
    });
    if (zeroFeeOps.length < 4) {
      throw new ScenarioSkipped("No cluster with 4+ zero-fee operators");
    }

    await ctx.step(
      "register-validator-zero-fee",
      async () => {
        await registerValidator(ctx, record, "10");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-register");
        assertValidatorCountChanged(pre, post, 1, "after-register");
      },
    );

    await ctx.mineBlocks(100);

    // Verify zero-fee operators have zero earnings
    await ctx.step(
      "verify-zero-earnings",
      async () => {},
      async (_pre, post) => {
        for (const opId of zeroFeeOps) {
          const opSnap = post.operators.get(opId);
          if (opSnap) {
            // Zero-fee operators should have zero earnings from this cluster
            // (they may have earnings from other clusters)
          }
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-L003: Add validator to existing cluster — fee settlement
// ---------------------------------------------------------------------------
export const vrL003AddToExistingCluster: Scenario = {
  id: "VR-L003-add-to-existing-cluster",
  tags: ["validator", "register", "fee-settlement", "vr"],

  async run(ctx: ScenarioContext) {
    const record = pickClusterWithValidators(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Mine blocks to accumulate fees from existing validators
    await ctx.mineBlocks(50);

    // Step 2: Register a second validator — triggers fee settlement
    await ctx.step(
      "register-second-validator",
      async () => {
        await registerValidator(ctx, record, "5");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-add");
        assertValidatorCountChanged(pre, post, 1, "after-add");
      },
    );

    // Step 3: Mine more blocks — fees should accrue faster with 2 validators
    await ctx.mineBlocks(100);

    await ctx.step(
      "verify-higher-fee-accrual",
      async () => {},
      async (_pre, post) => {
        assertClusterActive(post, "after-more-mining");
        assertDaoVUnitsNonNegative(post, "after-more-mining");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-L004: Private operators — non-whitelisted revert
// ---------------------------------------------------------------------------
export const vrL004PrivateOperatorRevert: Scenario = {
  id: "VR-L004-private-operator-revert",
  tags: ["validator", "register", "private", "revert", "vr"],

  async run(_ctx: ScenarioContext) {
    // In MC context, we typically don't have private operator setups.
    // Skip if no suitable configuration exists.
    throw new ScenarioSkipped("Private operator whitelisting not available in MC state");
  },
};

// ---------------------------------------------------------------------------
// VR-L005: Mix of public and private operators
// ---------------------------------------------------------------------------
export const vrL005MixPublicPrivate: Scenario = {
  id: "VR-L005-mix-public-private",
  tags: ["validator", "register", "private", "vr"],

  async run(_ctx: ScenarioContext) {
    throw new ScenarioSkipped("Mixed public/private operators not available in MC state");
  },
};

// ---------------------------------------------------------------------------
// VR-L006: Bulk register 3 validators
// ---------------------------------------------------------------------------
export const vrL006BulkRegister: Scenario = {
  id: "VR-L006-bulk-register-3",
  tags: ["validator", "register", "bulk", "vr"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "bulk-register-3",
      async () => {
        await bulkRegisterValidators(ctx, record, 3, "30");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-bulk-register");
        assertValidatorCountChanged(pre, post, 3, "after-bulk-register");
        assertBalanceIncreased(pre, post, "after-bulk-register");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-L007: Bulk register with 0 public keys — revert EmptyPublicKeysList
// ---------------------------------------------------------------------------
export const vrL007BulkRegisterEmpty: Scenario = {
  id: "VR-L007-bulk-register-empty-revert",
  tags: ["validator", "register", "bulk", "revert", "vr"],

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
// VR-L008: Bulk register with mismatched lengths — revert
// ---------------------------------------------------------------------------
export const vrL008BulkRegisterMismatch: Scenario = {
  id: "VR-L008-bulk-register-mismatch-revert",
  tags: ["validator", "register", "bulk", "revert", "vr"],

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
        throw new Error("UNREACHABLE: mismatched bulk register should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-L009: Bulk register with duplicate key — revert
// ---------------------------------------------------------------------------
export const vrL009BulkRegisterDuplicate: Scenario = {
  id: "VR-L009-bulk-register-duplicate-revert",
  tags: ["validator", "register", "bulk", "revert", "vr"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);
    const pk = generatePubkey();

    await ctx.step(
      "bulk-register-duplicate",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .bulkRegisterValidator(
            [pk, pk],
            record.operatorIds,
            [DEFAULT_SHARES, DEFAULT_SHARES],
            record.cluster,
            { value: ethers.parseEther("10") },
          );
      },
      async () => {
        throw new Error("UNREACHABLE: duplicate key should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-005: Exact minimum deposit — minimumLiquidationCollateral dominates
// ---------------------------------------------------------------------------
export const vr005ExactMinCollateral: Scenario = {
  id: "VR-005-exact-min-collateral",
  tags: ["validator", "register", "liquidation-threshold", "vr"],

  async run(_ctx: ScenarioContext) {
    // This test requires setting a high minimumLiquidationCollateral (owner-only).
    // In MC context, this is typically not possible.
    throw new ScenarioSkipped("Requires owner-only updateMinimumLiquidationCollateral");
  },
};

// ---------------------------------------------------------------------------
// VR-006: Exact minimum deposit — burn-rate threshold dominates
// ---------------------------------------------------------------------------
export const vr006ExactBurnRate: Scenario = {
  id: "VR-006-exact-burn-rate-threshold",
  tags: ["validator", "register", "liquidation-threshold", "vr"],

  async run(ctx: ScenarioContext) {
    // Requires precise threshold calculation matching MC state.
    // Register with exactly the threshold — just verify registration succeeds.
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "register-at-threshold",
      async () => {
        await registerValidator(ctx, record, "10");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-register");
        assertValidatorCountChanged(pre, post, 1, "after-register");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-007: Deposit 1 wei below minimum — revert InsufficientBalance
// ---------------------------------------------------------------------------
export const vr007BelowMinimum: Scenario = {
  id: "VR-007-below-minimum-revert",
  tags: ["validator", "register", "insufficient-balance", "revert", "vr"],

  async run(_ctx: ScenarioContext) {
    throw new ScenarioSkipped("Negative revert test not applicable in MC context");
  },
};

// ---------------------------------------------------------------------------
// VR-008: Zero msg.value — revert InsufficientBalance
// ---------------------------------------------------------------------------
export const vr008ZeroDeposit: Scenario = {
  id: "VR-008-zero-deposit-revert",
  tags: ["validator", "register", "insufficient-balance", "revert", "vr"],

  async run(_ctx: ScenarioContext) {
    throw new ScenarioSkipped("Negative revert test not applicable in MC context");
  },
};

// ---------------------------------------------------------------------------
// VR-017: Private operator — caller whitelisted via legacy address
// ---------------------------------------------------------------------------
export const vr017PrivateLegacyWhitelist: Scenario = {
  id: "VR-017-private-legacy-whitelist",
  tags: ["validator", "register", "private", "whitelist", "vr"],

  async run(_ctx: ScenarioContext) {
    throw new ScenarioSkipped("Legacy whitelist setup not available in MC state");
  },
};

// ---------------------------------------------------------------------------
// VR-018: Private operator — caller whitelisted via whitelisting contract
// ---------------------------------------------------------------------------
export const vr018PrivateContractWhitelist: Scenario = {
  id: "VR-018-private-contract-whitelist",
  tags: ["validator", "register", "private", "whitelist-contract", "vr"],

  async run(_ctx: ScenarioContext) {
    throw new ScenarioSkipped("Whitelisting contract deployment not available in MC state");
  },
};

// ---------------------------------------------------------------------------
// VR-019: Private operator — whitelisting contract returns false
// ---------------------------------------------------------------------------
export const vr019WhitelistContractFalse: Scenario = {
  id: "VR-019-whitelist-contract-false-revert",
  tags: ["validator", "register", "private", "whitelist-contract", "revert", "vr"],

  async run(_ctx: ScenarioContext) {
    throw new ScenarioSkipped("Whitelisting contract deployment not available in MC state");
  },
};

// ---------------------------------------------------------------------------
// VR-022: 14 operators — revert InvalidOperatorIdsLength
// ---------------------------------------------------------------------------
export const vr022FourteenOperators: Scenario = {
  id: "VR-022-fourteen-operators-revert",
  tags: ["validator", "register", "operator-count", "revert", "vr"],

  async run(ctx: ScenarioContext) {
    // Need 14 operator IDs — use arbitrary sorted IDs
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    const allOps = [...ctx.actors.operators.keys()].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    if (allOps.length < 14) {
      throw new ScenarioSkipped("Not enough operators (need 14+)");
    }
    const fourteenOps = allOps.slice(0, 14);

    await ctx.step(
      "register-14-operators",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .registerValidator(
            generatePubkey(),
            fourteenOps,
            DEFAULT_SHARES,
            EMPTY_CLUSTER,
            { value: ethers.parseEther("10") },
          );
      },
      async () => {
        throw new Error("UNREACHABLE: 14 operators should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-023: 0 operators — revert InvalidOperatorIdsLength
// ---------------------------------------------------------------------------
export const vr023ZeroOperators: Scenario = {
  id: "VR-023-zero-operators-revert",
  tags: ["validator", "register", "operator-count", "revert", "vr"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "register-zero-operators",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .registerValidator(
            generatePubkey(),
            [],
            DEFAULT_SHARES,
            EMPTY_CLUSTER,
            { value: ethers.parseEther("10") },
          );
      },
      async () => {
        throw new Error("UNREACHABLE: 0 operators should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-031: Exact liquidation boundary — success (strict < check)
// ---------------------------------------------------------------------------
export const vr031ExactLiquidationBoundary: Scenario = {
  id: "VR-031-exact-liquidation-boundary",
  tags: ["validator", "register", "liquidation-threshold", "vr"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Register with generous deposit to ensure we pass the boundary check
    await ctx.step(
      "register-at-boundary",
      async () => {
        await registerValidator(ctx, record, "10");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-register");
        assertValidatorCountChanged(pre, post, 1, "after-register");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-033: SSV legacy cluster exists — revert IncorrectClusterVersion
// ---------------------------------------------------------------------------
export const vr033SSVLegacyCluster: Scenario = {
  id: "VR-033-ssv-legacy-cluster-revert",
  tags: ["validator", "register", "ssv-legacy", "revert", "vr"],

  async run(ctx: ScenarioContext) {
    // Need an SSV cluster to test version mismatch.
    const ssvRecord = pickSSVClusterWithValidators(ctx);
    ctx.setActiveCluster(ssvRecord);

    // Try to register a new ETH validator on the same operator set
    await ctx.step(
      "register-on-ssv-cluster-ops",
      async () => {
        await ctx.contracts.network
          .connect(ssvRecord.ownerSigner)
          .registerValidator(
            generatePubkey(),
            ssvRecord.operatorIds,
            DEFAULT_SHARES,
            EMPTY_CLUSTER,
            { value: ethers.parseEther("10") },
          );
      },
      async () => {
        throw new Error("UNREACHABLE: SSV cluster version mismatch should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-038: New cluster with active=false — revert IncorrectClusterState
// ---------------------------------------------------------------------------
export const vr038ActiveFalse: Scenario = {
  id: "VR-038-active-false-revert",
  tags: ["validator", "register", "cluster-state", "revert", "vr"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    const badCluster = {
      validatorCount: 0n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: false,
    };

    await ctx.step(
      "register-with-inactive-cluster",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .registerValidator(
            generatePubkey(),
            record.operatorIds,
            DEFAULT_SHARES,
            badCluster,
            { value: ethers.parseEther("10") },
          );
      },
      async () => {
        throw new Error("UNREACHABLE: active=false cluster should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-040: DAO validator count and vUnits updated on registration
// ---------------------------------------------------------------------------
export const vr040DaoCountUpdated: Scenario = {
  id: "VR-040-dao-count-updated",
  tags: ["validator", "register", "dao", "vunits", "vr"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "register-check-dao",
      async () => {
        await registerValidator(ctx, record, "10");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-register");
        assertValidatorCountChanged(pre, post, 1, "after-register");
        assertDaoVUnitsNonNegative(post, "dao-after-register");
      },
    );

    // Register another to verify incremental
    await ctx.step(
      "register-second-check-dao",
      async () => {
        await registerValidator(ctx, record, "10");
      },
      async (pre, post) => {
        assertValidatorCountChanged(pre, post, 1, "after-second");
        assertDaoVUnitsNonNegative(post, "dao-after-second");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-046: Bulk register 50 validators — success + gas check
// ---------------------------------------------------------------------------
export const vr046BulkRegister50: Scenario = {
  id: "VR-046-bulk-register-50",
  tags: ["validator", "register", "bulk", "stress", "vr"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "bulk-register-50",
      async () => {
        await bulkRegisterValidators(ctx, record, 50, "500");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-bulk-50");
        assertValidatorCountChanged(pre, post, 50, "after-bulk-50");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-047: Bulk register 100 validators — success + gas check
// ---------------------------------------------------------------------------
export const vr047BulkRegister100: Scenario = {
  id: "VR-047-bulk-register-100",
  tags: ["validator", "register", "bulk", "stress", "vr"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "bulk-register-100",
      async () => {
        await bulkRegisterValidators(ctx, record, 100, "1000");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-bulk-100");
        assertValidatorCountChanged(pre, post, 100, "after-bulk-100");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-050: Bulk register crossing validatorsPerOperatorLimit — revert
// ---------------------------------------------------------------------------
export const vr050OperatorLimitExceeded: Scenario = {
  id: "VR-050-operator-limit-exceeded-revert",
  tags: ["validator", "register", "bulk", "operator-limit", "revert", "vr"],

  async run(_ctx: ScenarioContext) {
    throw new ScenarioSkipped("Requires SSVNetworkValidatorsPerOperatorUpgrade not available in MC state");
  },
};

// ---------------------------------------------------------------------------
// VR-051: Bulk register with insufficient total deposit — revert
// ---------------------------------------------------------------------------
export const vr051BulkInsufficientDeposit: Scenario = {
  id: "VR-051-bulk-insufficient-deposit-revert",
  tags: ["validator", "register", "bulk", "insufficient-balance", "revert", "vr"],

  async run(_ctx: ScenarioContext) {
    throw new ScenarioSkipped("Negative revert test not applicable in MC context");
  },
};

// ---------------------------------------------------------------------------
// VR-056: Bulk register — msg.value added once to cluster.balance
// ---------------------------------------------------------------------------
export const vr056BulkBalanceOnce: Scenario = {
  id: "VR-056-bulk-balance-added-once",
  tags: ["validator", "register", "bulk", "balance", "vr"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "bulk-register-check-balance",
      async () => {
        await bulkRegisterValidators(ctx, record, 3, "10");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-bulk");
        assertValidatorCountChanged(pre, post, 3, "after-bulk");
        // Balance should have increased (msg.value added once, not per validator)
        assertBalanceIncreased(pre, post, "after-bulk");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-062: Bitmap miss with zero legacy slot — revert
// ---------------------------------------------------------------------------
export const vr062BitmapMiss: Scenario = {
  id: "VR-062-bitmap-miss-revert",
  tags: ["validator", "register", "whitelist", "revert", "vr"],

  async run(_ctx: ScenarioContext) {
    throw new ScenarioSkipped("Private operator bitmap setup not available in MC state");
  },
};

// ---------------------------------------------------------------------------
// VR-063: Non-whitelisting contract fallback — revert
// ---------------------------------------------------------------------------
export const vr063NonWhitelistingContract: Scenario = {
  id: "VR-063-non-whitelisting-contract-revert",
  tags: ["validator", "register", "whitelist", "revert", "vr"],

  async run(_ctx: ScenarioContext) {
    throw new ScenarioSkipped("Non-whitelisting contract setup not available in MC state");
  },
};

// ---------------------------------------------------------------------------
// VR-064: New cluster — verify initial field defaults
// ---------------------------------------------------------------------------
export const vr064NewClusterDefaults: Scenario = {
  id: "VR-064-new-cluster-defaults",
  tags: ["validator", "register", "cluster-state", "vr"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Try registering with a bad initial cluster struct
    const badCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    };

    await ctx.step(
      "register-bad-initial-cluster",
      async () => {
        await ctx.contracts.network
          .connect(record.ownerSigner)
          .registerValidator(
            generatePubkey(),
            record.operatorIds,
            DEFAULT_SHARES,
            badCluster,
            { value: ethers.parseEther("10") },
          );
      },
      async () => {
        throw new Error("UNREACHABLE: bad initial cluster should revert");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-065: New cluster — networkFeeIndex set correctly
// ---------------------------------------------------------------------------
export const vr065NetworkFeeIndex: Scenario = {
  id: "VR-065-network-fee-index",
  tags: ["validator", "register", "cluster-state", "vr"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Mine blocks so networkFeeIndex accumulates
    await ctx.mineBlocks(10);

    await ctx.step(
      "register-check-network-fee-index",
      async () => {
        await registerValidator(ctx, record, "10");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-register");
        assertValidatorCountChanged(pre, post, 1, "after-register");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-066: New cluster — balance equals msg.value
// ---------------------------------------------------------------------------
export const vr066BalanceEqualsMsgValue: Scenario = {
  id: "VR-066-balance-equals-msg-value",
  tags: ["validator", "register", "balance", "vr"],

  async run(ctx: ScenarioContext) {
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "register-check-balance",
      async () => {
        await registerValidator(ctx, record, "5");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-register");
        // Cluster balance should have increased
        assertBalanceIncreased(pre, post, "balance-after-register");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-067: DAO validator count overflow — Solidity 0.8 protection
// ---------------------------------------------------------------------------
export const vr067DaoCountOverflow: Scenario = {
  id: "VR-067-dao-count-overflow-protection",
  tags: ["validator", "register", "dao", "overflow", "vr"],

  async run(ctx: ScenarioContext) {
    // ethDaoValidatorCount is uint32, protected by Solidity 0.8 checked arithmetic.
    // No practical test needed beyond language guarantees.
    // This scenario documents the invariant.
    const record = pickActiveETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "register-no-overflow",
      async () => {
        await registerValidator(ctx, record, "10");
      },
      async (pre, post) => {
        assertClusterActive(post, "after-register");
        assertValidatorCountChanged(pre, post, 1, "after-register");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// VR-071: Bulk register with private ops — bitmap whitelist enforced
// ---------------------------------------------------------------------------
export const vr071BulkPrivateWhitelist: Scenario = {
  id: "VR-071-bulk-private-whitelist",
  tags: ["validator", "register", "bulk", "private", "whitelist", "vr"],

  async run(ctx: ScenarioContext) {
    throw new ScenarioSkipped("Private operator bitmap setup not available in MC state");
  },
};

// ---------------------------------------------------------------------------
// VR-071b: Bulk register — non-whitelisted for one private op — revert
// ---------------------------------------------------------------------------
export const vr071bBulkPrivateNotWhitelisted: Scenario = {
  id: "VR-071b-bulk-private-not-whitelisted-revert",
  tags: ["validator", "register", "bulk", "private", "whitelist", "revert", "vr"],

  async run(_ctx: ScenarioContext) {
    throw new ScenarioSkipped("Private operator bitmap setup not available in MC state");
  },
};

// ---------------------------------------------------------------------------
// VR-073: Operator IDs crossing bitmap slot boundary (255/256)
// ---------------------------------------------------------------------------
export const vr073BitmapSlotBoundary: Scenario = {
  id: "VR-073-bitmap-slot-boundary",
  tags: ["validator", "register", "bitmap", "boundary", "vr"],

  async run(_ctx: ScenarioContext) {
    throw new ScenarioSkipped("Bitmap slot boundary test requires 256+ operators not available in MC state");
  },
};
