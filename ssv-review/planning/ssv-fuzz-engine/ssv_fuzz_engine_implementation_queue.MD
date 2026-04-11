# SSV Fuzz Engine Implementation Queue

This is the execution-oriented follow-up to:

- [e2e_tests (1).MD](./e2e_tests%20(1).MD)
- [e2e_tests_cto_extension_batch_1.MD](./e2e_tests_cto_extension_batch_1.MD)
- [CTOs_e2e_scenarios.csv](./CTOs_e2e_scenarios.csv)

It answers one practical question:

> What should be implemented next in `test/ssv-fuzz-engine`, in what order, and with which shared helper work?

The queue below is based on the current file set in:

- [test/ssv-fuzz-engine](test/ssv-fuzz-engine)

and the current reusable helper base in:

- [test/ssv-fuzz-engine/core/setup.ts](test/ssv-fuzz-engine/core/setup.ts)
- [test/ssv-fuzz-engine/core/steps.ts](test/ssv-fuzz-engine/core/steps.ts)
- [test/ssv-fuzz-engine/core/assertions.ts](test/ssv-fuzz-engine/core/assertions.ts)

---

## Current Baseline

The engine already has strong coverage for:

- CAT-1 migration archetypes:
  healthy, liquidated, removed operator, all removed, zero-fee, max-fee, mixed-fee, near-liquidation, zero-validator, large-cluster, private-operators, pending-fee, shared-operator variants.
- CAT-2 core ETH lifecycle:
  full lifecycle, liquidation, self-liquidation, third-party liquidation, reactivation with removed operators, insufficient registration funding, withdrawal boundary, shared operators, zero-fee cluster.
- CAT-3 core EB lifecycle:
  implicit->explicit, auto-liquidation, EB decrease, max EB, SSV snapshot path, boundary validation, quorum, stale root, liquidated cluster update, shared-ops EB.
- Several CAT-4/CAT-6 slices:
  operator fee declare/execute, overwrite, increase limit, dual earnings withdrawal, operator removal interleave, multi-cluster removal, governance max-fee pending declaration, oracle replacement, network-fee dual-cluster behavior.

That means the next work should avoid re-implementing those files and should instead target the remaining dense gaps.

---

## Priority Order

### Wave 1: Removed-Operator Bug-Regression Core

These are the highest-value files to implement first. They cover the densest bug surface from the CTO corpus and should be treated as blocking for “removed-operator coverage is solid.”

1. Create [test/ssv-fuzz-engine/removed-operator-eb-write-regressions.fuzz.ts](test/ssv-fuzz-engine/removed-operator-eb-write-regressions.fuzz.ts)
   Covers:
   `CAT-5-11`
   Source CTO families:
   `RM1-001..RM1-025`, plus the removed-operator invariant rows about stale vUnits / resurrection.
   Why first:
   This is the canonical reproduction set for “removed operator gets written to again” and “EB decrease underflows after removal.”
   Reuse:
   existing EB helpers, `assertDaoVUnitsMatchCluster`, `captureEBTransitionSnapshot`, `assertEBTransitionSettledAtVUnits`.
   New helpers needed:
   `setupRemovedOperatorExplicitEBSeed(opCount, removedPositions, initialEB)` -> setupRemovedOperatorLegacyMigrationSeed exists in setup.ts:186, but only for legacy/migration context. A new post-upgrade ETH-native version is needed.
   `assertRemovedOperatorZeroedState()`
   `assertNoRemovedOperatorVUnitsWrite()`

2. Create [test/ssv-fuzz-engine/removed-operator-liquidation-divergence.fuzz.ts](test/ssv-fuzz-engine/removed-operator-liquidation-divergence.fuzz.ts)
   Covers:
   `CAT-5-12`
   Source CTO families:
   `RM2-*`, `RMA-022`, `RMA-023`.
   Why second:
   It isolates the manual vs auto-liquidation difference and makes liquidation cleanup behavior explicit instead of implicit inside larger lifecycle tests.
   Reuse:
   `liquidateOrReactivate`, phase-aware balance/earnings assertions.
   New helpers needed:
   `driveClusterToLiquidationBoundary()` -> liquidateOrReactivate in steps.ts:104 already handles the liquidation flow but doesn't drive balance to boundary deterministically. New helper justified.
   `triggerAutoLiquidationViaEB()`
   `assertManualVsAutoLiquidationEquivalent()` or an equivalent outcome comparator.

3. Create [test/ssv-fuzz-engine/removed-operator-last-validator-cleanup.fuzz.ts](test/ssv-fuzz-engine/removed-operator-last-validator-cleanup.fuzz.ts)
   Covers:
   `CAT-5-13`
   Source CTO families:
   `RM3-*`, `VX-028`, `VX-037`, `VX-038`.
   Why third:
   Last-validator cleanup is a separate failure mode from liquidation and is easy to regress silently.
   Reuse:
   `removeValidators`, `ebValidatorLifecycle`, cluster/EB assertions.
   New helpers needed:
   `setupLastValidatorRemovalSeed(singleOrBulk, opCount, removedCount, explicitEB)`
   `assertLastValidatorCleanupExact()`
   `assertEBSnapshotClearedWhenClusterEmpty()`

4. Create [test/ssv-fuzz-engine/removed-operator-reactivation-terminal.fuzz.ts](test/ssv-fuzz-engine/removed-operator-reactivation-terminal.fuzz.ts)
   Covers:
   `CAT-5-14`
   Source CTO families:
   `RM5-*` and the “all operators removed” reactivation cases.
   Why fourth:
   This closes the terminal paths after liquidation and catches “burnRate = 0” / all-removed / validator-limit weirdness.
   Reuse:
   existing reactivation helpers and removed-operator migration skip assertions.
   New helpers needed:
   `computeReactivationFundingForLiveOperators()`
   `assertAllRemovedOperatorsStillSkipped()`
   `setupAllRemovedEthClusterSeed()`

### Wave 2: Migration × Staking Cross-Product

These are the next most valuable because they connect two major subsystems that currently have only partial direct fuzz coverage together.

5. Create [test/ssv-fuzz-engine/migration-staking-sequential.fuzz.ts](test/ssv-fuzz-engine/migration-staking-sequential.fuzz.ts)
   Covers:
   `CAT-PM-15`
   Source CTO families:
   `XG-001..XG-009`, `XG-014`, `XG-015`.
   Why fifth:
   It gives you the first direct migration-to-staking bridge rather than keeping migration and staking mostly separate.
   Reuse:
   `setupLegacyMigrationSeed`, migration assertions, staking assertions.
   New helpers needed:
   `setupMigrationStakingSeed(clusterCount, sharedOps, stakerCount)`
   `syncFeesAndClaimAll()`
   `assertStakerProRataAcrossMigrationWaves()`

6. Create [test/ssv-fuzz-engine/migration-staking-zero-supply.fuzz.ts](test/ssv-fuzz-engine/migration-staking-zero-supply.fuzz.ts)
   Covers:
   `CAT-PM-16`
   Source CTO families:
   `XG-010..XG-013`, `XG-016..XG-024`, plus staking zero-supply / payout-failure edges.
   Why sixth:
   Zero-supply windows and payout failures are exactly the kind of subtle accounting transitions fuzzing is good at.
   Reuse:
   `assertCSSVTotalSupply`, `assertStakerCSSVBalances`, `assertStakingRewards`.
   New helpers needed:
   `drainToZeroCSSVSupply()`
   `claimWithRejectingRecipient()`
   `assertNoFreeRewardsAcrossZeroSupplyWindow()`

7. Create [test/ssv-fuzz-engine/migration-threshold-refund-continuity.fuzz.ts](test/ssv-fuzz-engine/migration-threshold-refund-continuity.fuzz.ts)
   Covers:
   `CAT-1-14`
   Source CTO families:
   `MG-017`, `MG-018`, `MG-020`, `MG-026`, `MG-027`, `MG-050`, `MG-052`, `MG-055`, `MG-058`, `MG-060`.
   Why seventh:
   This is the missing exact economic matrix around migration thresholding, refund math, removed operators, and immediate continuity.
   Reuse:
   `assertLegacyMigrationRefund`, `assertLegacyEnsureETHDefaultsTransition`, `assertRemovedOperatorMigrationSkip`, `assertSSVConservation`, `assertEthConservation`.
   New helpers needed:
   `computeExactMigrationThresholdForSeed()`
   `assertMigrationContinuityPostUpdateClusterBalance()`
   `setupMigrationContinuitySeed()`

### Wave 3: Validator and DAO Guard Matrices

These are high-value for completeness and protocol hardening, but slightly lower than Waves 1 and 2 because they are more matrix-like than emergent-bug-like.

8. Create [test/ssv-fuzz-engine/validator-registration-guards.fuzz.ts](test/ssv-fuzz-engine/validator-registration-guards.fuzz.ts)
   Covers:
   `CAT-2-11`
   Source CTO families:
   validator input-shape, whitelist, funding, and legacy-version guards.
   Why eighth:
   Current fuzz files cover successful lifecycle paths better than the full invalid-input guard matrix.
   Reuse:
   `registerFuzzOperators`, `registerFuzzCluster`.
   New helpers needed:
   `expectRegisterValidatorRevert()`
   `expectBulkRegisterValidatorRevert()`
   `setupWhitelistMatrixSeed()`

9. Create [test/ssv-fuzz-engine/validator-removal-exit-matrix.fuzz.ts](test/ssv-fuzz-engine/validator-removal-exit-matrix.fuzz.ts)
   Covers:
   `CAT-2-12`
   Source CTO families:
   validator removal / bulk removal / exit / liquidated-cluster and removed-operator variants.
   Why ninth:
   It separates validator semantics from the removed-operator regression cluster so failures are easier to localize.
   Reuse:
   current `remove-validators.fuzz.ts` ideas and `removeValidators` step.
   New helpers needed:
   `expectRemoveValidatorRevert()`
   `expectExitValidatorRevert()`
   `assertExitValidatorEventOnlySemantics()`

10. Create [test/ssv-fuzz-engine/dao-precision-admin-guards.fuzz.ts](test/ssv-fuzz-engine/dao-precision-admin-guards.fuzz.ts)
   Covers:
   `CAT-6-10`
   Source CTO families:
   `DA-013`, `DA-037`, `DA-040`, `DA-057`, `DA-059`, `DA-060`, `DA-061`, `DA-070`, `DA-079..DA-097`.
   Why tenth:
   This closes the precision / packing / admin-guard matrix that is mostly absent from current fuzz files.
   Reuse:
   existing governance/oracle files for deployment context and signers.
   New helpers needed:
   `expectDaoUpdateRevert()`
   `assertPrecisionGuardForPackedParam()`
   `assertFeeDomainIsolation(ethVsSsv)`

---

## Second Queue

These should be implemented after the first 10 files, or folded into existing files if the engine stays manageable.

11. Create [test/ssv-fuzz-engine/eb-shared-root-precision.fuzz.ts](test/ssv-fuzz-engine/eb-shared-root-precision.fuzz.ts)
   Covers:
   `CAT-3-12`
   Why later:
   important, but less urgent than the removed-operator and migration-staking gaps.

12. Create [test/ssv-fuzz-engine/legacy-ssv-guards-and-settlement.fuzz.ts](test/ssv-fuzz-engine/legacy-ssv-guards-and-settlement.fuzz.ts)
   Covers:
   `CAT-1-13`
   Why later:
   current migration files plus dual-version coexistence already give partial legacy coverage.

13. Create [test/ssv-fuzz-engine/operator-fee-shared-propagation.fuzz.ts](test/ssv-fuzz-engine/operator-fee-shared-propagation.fuzz.ts)
   Covers:
   `CAT-4-10`
   Why later:
   current operator fee files cover single-cluster lifecycle better than shared-cluster propagation, but this is not as urgent as the removed-operator regressions.

14. Create [test/ssv-fuzz-engine/operator-fee-window-boundaries.fuzz.ts](test/ssv-fuzz-engine/operator-fee-window-boundaries.fuzz.ts)
   Covers:
   `CAT-4-9`
   Why later:
   pieces of this already exist in the current operator-fee files and can be incrementally extended.

15. Extend [test/ssv-fuzz-engine/oracle-replacement.fuzz.ts](test/ssv-fuzz-engine/oracle-replacement.fuzz.ts) and/or [test/ssv-fuzz-engine/chaos.fuzz.ts](test/ssv-fuzz-engine/chaos.fuzz.ts)
   Covers:
   `CAT-6-8`, `CAT-6-9`
   Why extend instead of new file:
   these scenarios are already adjacent to existing live-oracle/governance fuzz files.

16. Create [test/ssv-fuzz-engine/invariant-meta-checkpoints.fuzz.ts](test/ssv-fuzz-engine/invariant-meta-checkpoints.fuzz.ts)
   Covers:
   `CAT-INV-1`, `CAT-INV-2`
   Why later:
   useful as a final hardening pass after the concrete scenario files exist.

---

## Shared Helper Backlog

Implement these first, because they unlock multiple files:

### Setup Helpers

- Add `setupRemovedOperatorExplicitEBSeed(...)` to [test/ssv-fuzz-engine/core/setup.ts](test/ssv-fuzz-engine/core/setup.ts)
  Used by:
  `removed-operator-eb-write-regressions`, `removed-operator-liquidation-divergence`, `removed-operator-last-validator-cleanup`, `removed-operator-reactivation-terminal`.

- Add `setupMigrationStakingSeed(...)` to [test/ssv-fuzz-engine/core/setup.ts](test/ssv-fuzz-engine/core/setup.ts)
  Used by:
  `migration-staking-sequential`, `migration-staking-zero-supply`.
Questionable: This combines migration + staking. Given the existing setupLegacyMigrationSeed is already ~70 lines, composing it with staking setup inline may be cleaner than a new monolithic seed function. Consider a composable approach instead.

- Add `setupValidatorGuardSeed(...)` to [test/ssv-fuzz-engine/core/setup.ts](test/ssv-fuzz-engine/core/setup.ts)
  Used by:
  `validator-registration-guards`, `validator-removal-exit-matrix`.

- Add `setupLegacySSVGuardSeed(...)` to [test/ssv-fuzz-engine/core/setup.ts](test/ssv-fuzz-engine/core/setup.ts)
  Used by:
  `legacy-ssv-guards-and-settlement`, `migration-threshold-refund-continuity`.

### Step Helpers

- Add `commitSharedRootForClusters(...)` to [test/ssv-fuzz-engine/core/steps.ts](test/ssv-fuzz-engine/core/steps.ts)
  Used by:
  `eb-shared-root-precision`, oracle/governance extensions.

- Add `syncFeesAndClaimAll(...)` to [test/ssv-fuzz-engine/core/steps.ts](test/ssv-fuzz-engine/core/steps.ts)
  Used by:
  both migration-staking files.

- Add guarded expectation wrappers:
  `expectRegisterRevert`, `expectBulkRegisterRevert`, `expectRemoveRevert`, `expectExitRevert`, `expectDaoUpdateRevert`.
  Used by:
  validator and DAO guard files.

### Assertion Helpers

- Add `assertRemovedOperatorZeroedState(...)` to [test/ssv-fuzz-engine/core/assertions.ts](test/ssv-fuzz-engine/core/assertions.ts) -> Currently only assertRemovedOperatorEarningsFrozen exists. No assertion checks that ethSnapshot.block == 0, ethFee == 0, ethValidatorCount == 0, and operatorEthVUnits[id] == 0 all hold simultaneously after removal. High value, should be built first.
- Add `assertNoGhostVUnits(...)` to [test/ssv-fuzz-engine/core/assertions.ts](test/ssv-fuzz-engine/core/assertions.ts) -> No equivalent exists. Would check that sum(operatorEthVUnits[active_ops]) matches daoTotalEthVUnits after every EB transition. The existing assertDaoVUnitsMatchCluster only checks per-cluster, not global consistency. High value.
- Add `assertLastValidatorCleanupExact(...)` to [test/ssv-fuzz-engine/core/assertions.ts](test/ssv-fuzz-engine/core/assertions.ts)
- Add `assertNoFreeRewardsAcrossZeroSupplyWindow(...)` to [test/ssv-fuzz-engine/core/assertions.ts](test/ssv-fuzz-engine/core/assertions.ts)
- Add `assertDaoPrecisionGuard(...)` and `assertFeeDomainIsolation(...)` to [test/ssv-fuzz-engine/core/assertions.ts](test/ssv-fuzz-engine/core/assertions.ts)

Prefer building these on top of existing assertions that already exist:

- `assertDaoVUnitsMatchCluster`
- `assertLegacyMigrationRefund`
- `assertRemovedOperatorMigrationSkip`
- `assertEthConservation`
- `assertSSVConservation`
- `assertVersionExclusivity`
- `assertStakingRewards`
- `assertCSSVTotalSupply`

---

## Suggested Implementation Batches

1. Start with the assertion helpers (assertRemovedOperatorZeroedState, assertNoGhostVUnits) before writing any Wave 1 files. These are the highest-leverage pieces since they'll catch bugs across all 4 files.

2. Promote eb-shared-root-precision.fuzz.ts (Second Queue #11) into late Wave 2 or early Wave 3. The EB + validator count interleaving gap is more dangerous than the plan credits.

3. Consider execution time: For Wave 1, investigate whether a single fixture setup can be shared across files 1-4 (all need removed-operator + explicit EB). If each file independently deploys a pre-upgrade → upgrade → migration fixture, Wall clock time will roughly double.

4. For Wave 2 staking helpers: Prefer composing setupLegacyMigrationSeed + inline staking setup over a new monolithic setupMigrationStakingSeed. The migration seed is already complex at ~70 LOC.

5. Batch A and B from the plan are the minimum viable deliverable. If scope needs to be cut, Waves 1-2 (files 1-7) give ~80% of the incremental bug-finding value. The remaining files are hardening, not discovery.

### Batch A

- shared helper pass:
  removed-operator setup + assertions
- new files:
  `removed-operator-eb-write-regressions.fuzz.ts`
  `removed-operator-liquidation-divergence.fuzz.ts`

### Batch B

- shared helper pass:
  last-validator cleanup + reactivation helpers
- new files:
  `removed-operator-last-validator-cleanup.fuzz.ts`
  `removed-operator-reactivation-terminal.fuzz.ts`

### Batch C

- shared helper pass:
  migration-staking setup + staking zero-supply assertions
- new files:
  `migration-staking-sequential.fuzz.ts`
  `migration-staking-zero-supply.fuzz.ts`

### Batch D

- shared helper pass:
  validator guard wrappers + DAO precision assertions
- new files:
  `validator-registration-guards.fuzz.ts`
  `validator-removal-exit-matrix.fuzz.ts`
  `dao-precision-admin-guards.fuzz.ts`

### Batch E

- new file:
  `migration-threshold-refund-continuity.fuzz.ts`
- then decide whether to continue with:
  `eb-shared-root-precision`
  `legacy-ssv-guards-and-settlement`
  `operator-fee-shared-propagation`
  `operator-fee-window-boundaries`
  invariant meta scenarios

---

## Definition Of Done

For each new fuzz file:

- the file maps clearly to one CAT or one tightly related CAT pair
- failure messages include `FUZZ_SEED` reproduction
- all reusable setup logic lives in `core/setup.ts`, not copied inline
- all reusable post-state checks live in `core/assertions.ts`, not copied inline
- if a scenario is mostly a negative/revert matrix, it still verifies that non-targeted state remains unchanged
- if a scenario is a removed-operator path, it checks operator zero-state, DAO vUnits, cluster state, and cross-cluster contamination where applicable

---

## Risks and Concerns

### Test execution time
Each existing fuzz file runs 15 seeds × 100 ticks. Adding 10 files = 150 more test runs. The legacy migration seed (setupLegacyMigrationSeed) deploys a full pre-upgrade fixture + upgrade, which is expensive. Wave 1 files 1-4 all need this if they test post-migration removed-operator behavior. Recommendation: For Wave 1, create a shared before() hook or fixture that Wave 1 files share, rather than each file deploying independently.

### Coverage overlap with chaos.fuzz.ts
The existing chaos.fuzz.ts already does weighted random selection across deposits, withdrawals, fee changes, liquidation, and validator registration/removal using ALL_CHAOS_ACTIONS. Some of Wave 1's scenarios (removed-operator + EB + liquidation chains) are probabilistically reachable through chaos mode. However, the probability of hitting the specific 4-step sequence (remove → EB increase → EB decrease → liquidate → reactivate) is low enough that dedicated files are justified.

### The plan omits one gap
EB + validator registration interleaving (CAT-3-11 in the CTO extension) describes adding/removing validators between explicit EB updates. The existing eb-validator-lifecycle.fuzz.ts covers this partially, but the CTO extension describes a specific scenario where validator removal between EB updates can leave stranded deviation if the new updateClusterBalance doesn't properly recalculate based on current validatorCount. This isn't in the main queue but is in the Second Queue as item 11. I'd promote it to Wave 2 or early Wave 3.
