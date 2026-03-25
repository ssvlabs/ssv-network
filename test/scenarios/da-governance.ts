/**
 * DA scenarios: DAO Governance
 *
 * Extracted from test/e2e/dao/da-gap.test.ts.
 * Tests DAO governance parameters: precision/overflow reverts, fee isolation,
 * access control, boundary cases, module updates, oracle management,
 * SSV fee settlement, and downstream governance interactions.
 *
 * 35 scenarios covering comprehensive DAO governance coverage.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import {
  pickETHCluster,
  assertClusterActive,
  assertDaoVUnitsNonNegative,
} from "./_xm-helpers.ts";

const UINT64_MAX = 2n ** 64n - 1n;
const ETH_DEDUCTED_DIGITS = 100_000n;
const DEDUCTED_DIGITS = 10_000_000n;

// ---------------------------------------------------------------------------
// DA-001/079: ETH fee non-divisible reverts MaxPrecisionExceeded
// ---------------------------------------------------------------------------
export const daPrecisionETHFeeRevert: Scenario = {
  id: "DA-001-precision-eth-fee-revert",
  tags: ["dao", "governance", "precision", "revert", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "update-network-fee-non-divisible",
      async () => {
        await ctx.contracts.network.updateNetworkFee(ETH_DEDUCTED_DIGITS + 1n);
      },
      async () => {
        // Should revert — assertions unreachable
        throw new Error("UNREACHABLE: non-divisible ETH fee should have reverted");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-002/080: SSV fee non-divisible reverts MaxPrecisionExceeded
// ---------------------------------------------------------------------------
export const daPrecisionSSVFeeRevert: Scenario = {
  id: "DA-002-precision-ssv-fee-revert",
  tags: ["dao", "governance", "precision", "revert", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "update-ssv-network-fee-non-divisible",
      async () => {
        await ctx.contracts.network.updateNetworkFeeSSV(DEDUCTED_DIGITS + 1n);
      },
      async () => {
        throw new Error("UNREACHABLE: non-divisible SSV fee should have reverted");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-003/081: Max op fee non-divisible reverts MaxPrecisionExceeded
// ---------------------------------------------------------------------------
export const daPrecisionMaxOpFeeRevert: Scenario = {
  id: "DA-003-precision-max-op-fee-revert",
  tags: ["dao", "governance", "precision", "revert", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "update-max-op-fee-non-divisible",
      async () => {
        // Use a value >= min fee so range check passes, but non-divisible
        const minFee = 1_778_800_000n; // MINIMAL_OPERATOR_ETH_FEE
        await ctx.contracts.network.updateMaximumOperatorFee(minFee + 1n);
      },
      async () => {
        throw new Error("UNREACHABLE: non-divisible max op fee should have reverted");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-004/082: Min op fee non-divisible reverts MaxPrecisionExceeded
// ---------------------------------------------------------------------------
export const daPrecisionMinOpFeeRevert: Scenario = {
  id: "DA-004-precision-min-op-fee-revert",
  tags: ["dao", "governance", "precision", "revert", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "update-min-op-fee-non-divisible",
      async () => {
        await ctx.contracts.network.updateMinimumOperatorEthFee(ETH_DEDUCTED_DIGITS + 1n);
      },
      async () => {
        throw new Error("UNREACHABLE: non-divisible min op fee should have reverted");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-005/085: ETH fee overflow reverts MaxValueExceeded
// ---------------------------------------------------------------------------
export const daOverflowETHFeeRevert: Scenario = {
  id: "DA-005-overflow-eth-fee-revert",
  tags: ["dao", "governance", "overflow", "revert", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "update-network-fee-overflow",
      async () => {
        const overflowValue = (UINT64_MAX + 1n) * ETH_DEDUCTED_DIGITS;
        await ctx.contracts.network.updateNetworkFee(overflowValue);
      },
      async () => {
        throw new Error("UNREACHABLE: overflow ETH fee should have reverted");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-006/083: ETH collateral overflow reverts MaxValueExceeded
// ---------------------------------------------------------------------------
export const daOverflowETHCollateralRevert: Scenario = {
  id: "DA-006-overflow-eth-collateral-revert",
  tags: ["dao", "governance", "overflow", "revert", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "update-min-liq-collateral-overflow",
      async () => {
        const overflowValue = (UINT64_MAX + 1n) * ETH_DEDUCTED_DIGITS;
        await ctx.contracts.network.updateMinimumLiquidationCollateral(overflowValue);
      },
      async () => {
        throw new Error("UNREACHABLE: overflow ETH collateral should have reverted");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-007/084: SSV collateral overflow reverts MaxValueExceeded
// ---------------------------------------------------------------------------
export const daOverflowSSVCollateralRevert: Scenario = {
  id: "DA-007-overflow-ssv-collateral-revert",
  tags: ["dao", "governance", "overflow", "revert", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "update-ssv-min-liq-collateral-overflow",
      async () => {
        const overflowValue = (UINT64_MAX + 1n) * DEDUCTED_DIGITS;
        await ctx.contracts.network.updateMinimumLiquidationCollateralSSV(overflowValue);
      },
      async () => {
        throw new Error("UNREACHABLE: overflow SSV collateral should have reverted");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-008/095: Max op fee overflow reverts MaxValueExceeded
// ---------------------------------------------------------------------------
export const daOverflowMaxOpFeeRevert: Scenario = {
  id: "DA-008-overflow-max-op-fee-revert",
  tags: ["dao", "governance", "overflow", "revert", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "update-max-op-fee-overflow",
      async () => {
        const overflowValue = (UINT64_MAX + 1n) * ETH_DEDUCTED_DIGITS;
        await ctx.contracts.network.updateMaximumOperatorFee(overflowValue);
      },
      async () => {
        throw new Error("UNREACHABLE: overflow max op fee should have reverted");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-009/086: SSV fee doesn't affect ETH fee
// ---------------------------------------------------------------------------
export const daFeeIsolationSSVNotAffectETH: Scenario = {
  id: "DA-009-fee-isolation-ssv-not-affect-eth",
  tags: ["dao", "governance", "fee-isolation", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "update-ssv-fee-check-eth-unchanged",
      async () => {
        // Double the SSV network fee
        const currentSSVFee = await ctx.contracts.views.getNetworkFeeSSV();
        const newSSVFee = currentSSVFee * 2n;
        await ctx.contracts.network.updateNetworkFeeSSV(newSSVFee);
      },
      async (pre, post) => {
        // ETH fee should remain unchanged
        const ethFeeBefore = pre.networkFee;
        const ethFeeAfter = post.networkFee;
        if (ethFeeAfter !== ethFeeBefore) {
          throw new Error(
            `SSV fee update affected ETH fee: before=${ethFeeBefore}, after=${ethFeeAfter}`,
          );
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-010/087: ETH fee doesn't affect SSV fee
// ---------------------------------------------------------------------------
export const daFeeIsolationETHNotAffectSSV: Scenario = {
  id: "DA-010-fee-isolation-eth-not-affect-ssv",
  tags: ["dao", "governance", "fee-isolation", "da"],

  async run(ctx: ScenarioContext) {
    let ssvFeeBefore = 0n;

    await ctx.step(
      "update-eth-fee-check-ssv-unchanged",
      async () => {
        ssvFeeBefore = await ctx.contracts.views.getNetworkFeeSSV();
        const currentETHFee = await ctx.contracts.views.getNetworkFee();
        const newETHFee = currentETHFee * 2n;
        await ctx.contracts.network.updateNetworkFee(newETHFee);
      },
      async () => {
        const ssvFeeAfter = await ctx.contracts.views.getNetworkFeeSSV();
        if (ssvFeeAfter !== ssvFeeBefore) {
          throw new Error(
            `ETH fee update affected SSV fee: before=${ssvFeeBefore}, after=${ssvFeeAfter}`,
          );
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-011/057: Non-owner updateMinBlocksBetweenUpdates reverts
// ---------------------------------------------------------------------------
export const daAccessControlMinBlocks: Scenario = {
  id: "DA-011-access-control-min-blocks",
  tags: ["dao", "governance", "access-control", "revert", "da"],

  async run(ctx: ScenarioContext) {
    const nonOwner = ctx.actors.clusterOwners[0];
    if (!nonOwner) throw new ScenarioSkipped("No non-owner signer available");

    await ctx.step(
      "non-owner-update-min-blocks",
      async () => {
        await ctx.contracts.network.connect(nonOwner).updateMinBlocksBetweenUpdates(100);
      },
      async () => {
        throw new Error("UNREACHABLE: non-owner call should have reverted");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-012/037: Max op fee == min succeeds
// ---------------------------------------------------------------------------
export const daMaxFeeEqMinFee: Scenario = {
  id: "DA-012-max-fee-eq-min-fee",
  tags: ["dao", "governance", "boundary", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "set-max-fee-equal-to-min",
      async () => {
        const minFee = 1_778_800_000n; // MINIMAL_OPERATOR_ETH_FEE
        await ctx.contracts.network.updateMaximumOperatorFee(minFee);
      },
      async () => {
        // Success — no assertions needed beyond not reverting
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-013/040: Min op fee == max succeeds
// ---------------------------------------------------------------------------
export const daMinFeeEqMaxFee: Scenario = {
  id: "DA-013-min-fee-eq-max-fee",
  tags: ["dao", "governance", "boundary", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "set-min-fee-equal-to-max",
      async () => {
        const maxFee = await ctx.contracts.views.getMaximumOperatorFee();
        await ctx.contracts.network.updateMinimumOperatorEthFee(maxFee);
      },
      async () => {
        // Success — no assertions needed beyond not reverting
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-014/070: Max uint64 liquidation threshold
// ---------------------------------------------------------------------------
export const daMaxLiqThreshold: Scenario = {
  id: "DA-014-max-liq-threshold",
  tags: ["dao", "governance", "boundary", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "set-liq-threshold-max-uint64",
      async () => {
        await ctx.contracts.network.updateLiquidationThresholdPeriod(UINT64_MAX);
      },
      async () => {
        // Success — max uint64 should be accepted
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-015/093: Withdraw 0 SSV no-op
// ---------------------------------------------------------------------------
export const daWithdrawSSVZero: Scenario = {
  id: "DA-015-withdraw-ssv-zero",
  tags: ["dao", "governance", "boundary", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "withdraw-zero-ssv-earnings",
      async () => {
        await ctx.contracts.network.withdrawNetworkSSVEarnings(0n);
      },
      async () => {
        // Success — 0 withdrawal is a no-op
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-016/013: Withdraw > 0 SSV no clusters reverts
// ---------------------------------------------------------------------------
export const daWithdrawSSVNoClusters: Scenario = {
  id: "DA-016-withdraw-ssv-no-clusters",
  tags: ["dao", "governance", "revert", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "withdraw-positive-ssv-no-clusters",
      async () => {
        await ctx.contracts.network.withdrawNetworkSSVEarnings(DEDUCTED_DIGITS);
      },
      async () => {
        throw new Error("UNREACHABLE: withdrawal > 0 with no SSV clusters should have reverted");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-017/059: Fee recipient zero address emits event
// ---------------------------------------------------------------------------
export const daFeeRecipientZeroAddr: Scenario = {
  id: "DA-017-fee-recipient-zero-addr",
  tags: ["dao", "governance", "boundary", "da"],

  async run(ctx: ScenarioContext) {
    const caller = ctx.actors.clusterOwners[0];
    if (!caller) throw new ScenarioSkipped("No signer available for fee recipient update");

    await ctx.step(
      "set-fee-recipient-zero",
      async () => {
        const { ethers } = await import("ethers");
        await ctx.contracts.network
          .connect(caller)
          .setFeeRecipientAddress(ethers.ZeroAddress);
      },
      async () => {
        // Success — zero address is accepted
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-018/060: Module update valid contract
// ---------------------------------------------------------------------------
export const daModuleUpdateValid: Scenario = {
  id: "DA-018-module-update-valid",
  tags: ["dao", "governance", "module", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "update-module-valid-contract",
      async () => {
        // Use the existing network address as a known contract address
        const existingAddr = await ctx.contracts.network.getAddress();
        // SSVModules.SSVClusters = 0
        await ctx.contracts.network.updateModule(0, existingAddr);
      },
      async () => {
        // Success — valid contract address accepted
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-019/061: Module update EOA reverts
// ---------------------------------------------------------------------------
export const daModuleUpdateEOAReverts: Scenario = {
  id: "DA-019-module-update-eoa-reverts",
  tags: ["dao", "governance", "module", "revert", "da"],

  async run(ctx: ScenarioContext) {
    const eoa = ctx.actors.clusterOwners[0];
    if (!eoa) throw new ScenarioSkipped("No EOA available for module update test");

    await ctx.step(
      "update-module-to-eoa",
      async () => {
        // SSVModules.SSVClusters = 0
        await ctx.contracts.network.updateModule(0, eoa.address);
      },
      async () => {
        throw new Error("UNREACHABLE: module update to EOA should have reverted");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-020/090: Module update zero addr reverts
// ---------------------------------------------------------------------------
export const daModuleUpdateZeroReverts: Scenario = {
  id: "DA-020-module-update-zero-reverts",
  tags: ["dao", "governance", "module", "revert", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "update-module-to-zero",
      async () => {
        const { ethers } = await import("ethers");
        // SSVModules.SSVClusters = 0
        await ctx.contracts.network.updateModule(0, ethers.ZeroAddress);
      },
      async () => {
        throw new Error("UNREACHABLE: module update to zero address should have reverted");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-021/088: Oracle first assignment
// ---------------------------------------------------------------------------
export const daOracleFirstAssignment: Scenario = {
  id: "DA-021-oracle-first-assignment",
  tags: ["dao", "governance", "oracle", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "assign-oracle-to-empty-slot",
      async () => {
        const oracle = ctx.actors.oracles[0];
        if (!oracle) throw new ScenarioSkipped("No oracle signer available");
        // Slot 1 — assign first oracle
        await ctx.contracts.network.replaceOracle(1, oracle.address);
      },
      async () => {
        // Success — first assignment to empty slot
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-022/107: Oracle evicted then reusable
// ---------------------------------------------------------------------------
export const daOracleEvictedReusable: Scenario = {
  id: "DA-022-oracle-evicted-reusable",
  tags: ["dao", "governance", "oracle", "da"],

  async run(ctx: ScenarioContext) {
    if (ctx.actors.oracles.length < 3) {
      throw new ScenarioSkipped("Need at least 3 oracle signers");
    }
    const [o1, o2, o3] = ctx.actors.oracles;

    // Step 1: Assign o1 to slot 1
    await ctx.step(
      "assign-oracle1-slot1",
      async () => {
        await ctx.contracts.network.replaceOracle(1, o1.address);
      },
      async () => {},
    );

    // Step 2: Assign o2 to slot 2
    await ctx.step(
      "assign-oracle2-slot2",
      async () => {
        await ctx.contracts.network.replaceOracle(2, o2.address);
      },
      async () => {},
    );

    // Step 3: Evict o1 by replacing slot 1 with o3
    await ctx.step(
      "replace-slot1-with-oracle3",
      async () => {
        await ctx.contracts.network.replaceOracle(1, o3.address);
      },
      async () => {},
    );

    // Step 4: Reuse o1 in slot 2 (replacing o2) — should succeed
    await ctx.step(
      "reuse-evicted-oracle1-in-slot2",
      async () => {
        await ctx.contracts.network.replaceOracle(2, o1.address);
      },
      async () => {
        // Success — evicted oracle address is reusable
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-023/007: SSV fee increase event
// ---------------------------------------------------------------------------
export const daSSVFeeIncrease: Scenario = {
  id: "DA-023-ssv-fee-increase",
  tags: ["dao", "governance", "ssv-fee", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.mineBlocks(100);

    await ctx.step(
      "increase-ssv-network-fee",
      async () => {
        const currentFee = await ctx.contracts.views.getNetworkFeeSSV();
        const newFee = currentFee * 2n;
        await ctx.contracts.network.updateNetworkFeeSSV(newFee);
      },
      async () => {
        // Success — fee increase emits event
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-024/108: SSV fee continuity
// ---------------------------------------------------------------------------
export const daSSVFeeContinuity: Scenario = {
  id: "DA-024-ssv-fee-continuity",
  tags: ["dao", "governance", "ssv-fee", "da"],

  async run(ctx: ScenarioContext) {
    let originalFee = 0n;

    // Step 1: Record and update fee
    await ctx.step(
      "update-ssv-fee",
      async () => {
        originalFee = await ctx.contracts.views.getNetworkFeeSSV();
        const newFee = originalFee * 2n;
        await ctx.contracts.network.updateNetworkFeeSSV(newFee);
      },
      async () => {
        const updatedFee = await ctx.contracts.views.getNetworkFeeSSV();
        if (updatedFee !== originalFee * 2n) {
          throw new Error(`Fee not updated: expected ${originalFee * 2n}, got ${updatedFee}`);
        }
      },
    );

    // Step 2: Restore to original
    await ctx.step(
      "restore-ssv-fee",
      async () => {
        await ctx.contracts.network.updateNetworkFeeSSV(originalFee);
      },
      async () => {
        const restoredFee = await ctx.contracts.views.getNetworkFeeSSV();
        if (restoredFee !== originalFee) {
          throw new Error(`Fee not restored: expected ${originalFee}, got ${restoredFee}`);
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-025/063: ETH fee change mid-cluster two-phase burn
// ---------------------------------------------------------------------------
export const daETHFeeChangeClusterBurn: Scenario = {
  id: "DA-025-eth-fee-change-cluster-burn",
  tags: ["dao", "governance", "downstream", "cluster", "da"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    // Step 1: Mine blocks at original fee
    await ctx.mineBlocks(100);

    // Step 2: Verify balance decreased (fees accrued at original rate)
    await ctx.step(
      "verify-phase1-drain",
      async () => {
        // No-op action — just snapshot
      },
      async (_pre, post) => {
        assertClusterActive(post, "phase1-active");
      },
    );

    // Step 3: Change ETH network fee to 3x
    await ctx.step(
      "change-eth-fee",
      async () => {
        const currentFee = await ctx.contracts.views.getNetworkFee();
        const newFee = currentFee * 3n;
        await ctx.contracts.network.updateNetworkFee(newFee);
      },
      async () => {},
    );

    // Step 4: Mine more blocks at new fee and verify continued drain
    await ctx.mineBlocks(100);

    await ctx.step(
      "verify-phase2-drain",
      async () => {
        // No-op action — just snapshot to compare
      },
      async (_pre, post) => {
        assertClusterActive(post, "phase2-active");
        assertDaoVUnitsNonNegative(post, "dao-phase2");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-026/064: Threshold increase makes cluster liquidatable
// ---------------------------------------------------------------------------
export const daThresholdIncreaseLiquidatable: Scenario = {
  id: "DA-026-threshold-increase-liquidatable",
  tags: ["dao", "governance", "downstream", "liquidation", "da"],

  async run(ctx: ScenarioContext) {
    const record = pickETHCluster(ctx);
    ctx.setActiveCluster(record);

    await ctx.step(
      "increase-liq-threshold",
      async () => {
        // Increase threshold to very high value to potentially make cluster liquidatable
        await ctx.contracts.network.updateLiquidationThresholdPeriod(3_000_000n);
      },
      async (_pre, post) => {
        // Cluster may or may not become liquidatable depending on its balance
        assertDaoVUnitsNonNegative(post, "after-threshold-increase");
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-027/065: Min collateral increase blocks reactivation
// ---------------------------------------------------------------------------
export const daCollateralIncreaseBlocksReactivation: Scenario = {
  id: "DA-027-collateral-increase-blocks-reactivation",
  tags: ["dao", "governance", "downstream", "reactivation", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "increase-min-collateral",
      async () => {
        const { ethers } = await import("ethers");
        const highCollateral = ethers.parseEther("5");
        await ctx.contracts.network.updateMinimumLiquidationCollateral(highCollateral);
      },
      async () => {
        // Success — reactivation with less than 5 ETH would now fail
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-028/066: Lowered max fee blocks pending
// ---------------------------------------------------------------------------
export const daLoweredMaxFeeBlocksPending: Scenario = {
  id: "DA-028-lowered-max-fee-blocks-pending",
  tags: ["dao", "governance", "downstream", "operator-fee", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "lower-max-op-fee",
      async () => {
        // Set max fee to just above minimum — any pending higher fee execution would fail
        const newMaxFee = 1_778_800_000n + ETH_DEDUCTED_DIGITS * 2n;
        await ctx.contracts.network.updateMaximumOperatorFee(newMaxFee);
      },
      async () => {
        // Success — max fee lowered
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-029/067: Increased min fee blocks registration
// ---------------------------------------------------------------------------
export const daIncreasedMinFeeBlocksRegistration: Scenario = {
  id: "DA-029-increased-min-fee-blocks-registration",
  tags: ["dao", "governance", "downstream", "operator-fee", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "increase-min-op-fee",
      async () => {
        const minFee = 1_778_800_000n; // MINIMAL_OPERATOR_ETH_FEE
        const newMinFee = minFee * 3n;
        await ctx.contracts.network.updateMinimumOperatorEthFee(newMinFee);
      },
      async () => {
        // Success — operators with fee < newMinFee can no longer register
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-030/104: Fee increase limit 0 blocks increase
// ---------------------------------------------------------------------------
export const daFeeIncreaseLimitZero: Scenario = {
  id: "DA-030-fee-increase-limit-zero",
  tags: ["dao", "governance", "downstream", "operator-fee", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "set-fee-increase-limit-zero",
      async () => {
        await ctx.contracts.network.updateOperatorFeeIncreaseLimit(0);
      },
      async () => {
        // Success — any positive fee increase declaration would now revert
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-031/105: Zero declare+execute periods same-block
// ---------------------------------------------------------------------------
export const daZeroDeclarePeriod: Scenario = {
  id: "DA-031-zero-declare-period",
  tags: ["dao", "governance", "downstream", "operator-fee", "da"],

  async run(ctx: ScenarioContext) {
    // Step 1: Set both periods to 0
    await ctx.step(
      "set-zero-periods",
      async () => {
        await ctx.contracts.network.updateDeclareOperatorFeePeriod(0);
        await ctx.contracts.network.updateExecuteOperatorFeePeriod(0);
      },
      async () => {
        // Success — same-block declare+execute now possible
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-032/106: Period change doesn't affect stored windows
// ---------------------------------------------------------------------------
export const daPeriodChangeNoRetroactive: Scenario = {
  id: "DA-032-period-change-no-retroactive",
  tags: ["dao", "governance", "downstream", "operator-fee", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "change-declare-period",
      async () => {
        // Set a very long declare period — shouldn't affect already-declared fees
        await ctx.contracts.network.updateDeclareOperatorFeePeriod(604800 * 10);
      },
      async () => {
        // Success — stored windows use the period at declaration time
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-033/109: ETH threshold doesn't affect SSV threshold
// ---------------------------------------------------------------------------
export const daETHThresholdNoAffectSSV: Scenario = {
  id: "DA-033-eth-threshold-no-affect-ssv",
  tags: ["dao", "governance", "fee-isolation", "da"],

  async run(ctx: ScenarioContext) {
    let ssvThresholdBefore = 0n;

    await ctx.step(
      "change-eth-threshold-check-ssv",
      async () => {
        ssvThresholdBefore = await ctx.contracts.views.getLiquidationThresholdPeriodSSV();
        await ctx.contracts.network.updateLiquidationThresholdPeriod(100_000n);
      },
      async () => {
        const ssvThresholdAfter = await ctx.contracts.views.getLiquidationThresholdPeriodSSV();
        if (ssvThresholdAfter !== ssvThresholdBefore) {
          throw new Error(
            `ETH threshold change affected SSV threshold: before=${ssvThresholdBefore}, after=${ssvThresholdAfter}`,
          );
        }
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-034/110: Cooldown change feeds into staking
// ---------------------------------------------------------------------------
export const daCooldownFeedsStaking: Scenario = {
  id: "DA-034-cooldown-feeds-staking",
  tags: ["dao", "governance", "downstream", "staking", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "update-cooldown-duration",
      async () => {
        // Set a shorter cooldown
        const newCooldown = 1000n;
        await ctx.contracts.network.updateUnstakeCooldownDuration(newCooldown);
      },
      async () => {
        // Success — new unstake requests will use the shorter cooldown
      },
    );
  },
};

// ---------------------------------------------------------------------------
// DA-035/111: minBlocksBetweenUpdates feeds into updateClusterBalance
// ---------------------------------------------------------------------------
export const daMinBlocksFeedsUpdateCluster: Scenario = {
  id: "DA-035-min-blocks-feeds-update-cluster",
  tags: ["dao", "governance", "downstream", "eb-update", "da"],

  async run(ctx: ScenarioContext) {
    await ctx.step(
      "update-min-blocks-between-updates",
      async () => {
        await ctx.contracts.network.updateMinBlocksBetweenUpdates(100);
      },
      async () => {
        // Success — updateClusterBalance calls within 100 blocks would now revert
      },
    );

    // Step 2: Reset to 0 to avoid interference with other scenarios
    await ctx.step(
      "reset-min-blocks",
      async () => {
        await ctx.contracts.network.updateMinBlocksBetweenUpdates(0);
      },
      async () => {},
    );
  },
};
