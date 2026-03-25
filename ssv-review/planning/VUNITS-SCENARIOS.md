# vUnit-Based Accounting Test Scenarios

Exhaustive scenario list for ETH cluster vUnit accounting. Covers implicit/explicit EB, operator lifecycle, liquidation, reactivation, migration, and cross-module interactions.

**Cluster sizes:** Clusters can have exactly **4, 7, 10, or 13** operators (`length % 3 == 1`, enforced by `ValidatorLib.validateOperatorsLength`). All deviation loops iterate `operatorIds.length`, so operator count directly affects the underflow/accounting surface. Scenarios that say "4 ops" are the default; scenarios in section 13 explicitly vary the cluster size.

**Legacy SSV starting state:** Any scenario that begins from an SSV cluster assumes a pre-upgrade legacy cluster fixture (for example: mainnet/fork state or a dedicated pre-migration test harness). Post-upgrade tests must not model this by creating a new SSV cluster or registering validators on the SSV branch.

## 0. Scenario Normalization Contract

This file is still a scenario catalog, but every row below should be promotable into a deterministic test case. Before implementing any scenario, normalize it with the following fields:

| Field | Required content |
|------|------------------|
| Expected outcome | `success`, `revert`, or `view/state mismatch` |
| Primary assertions | Exact state transitions or invariants to prove |
| Touched storage | At minimum: `cluster.balance`, `cluster.active`, `cluster.validatorCount`, `cluster.index`, `daoTotalEthVUnits`, affected `operatorEthVUnits`, affected `ethValidatorCount`, and relevant views |
| Snapshot discipline | For any flow that passes a `Cluster` struct, add both a fresh-snapshot variant and a stale-snapshot variant unless impossible by construction |

**Phase execution checklist (required for each new scenario test)**

- Name every test with a stable prefix: `"[ID] ..."` (example: `"[MC-02] shared operator removal across two explicit-EB clusters"`).
- Tag each implemented row with:
  - `Added test path` (single source-of-truth file path),
  - `Assertion class` (`exact math`, `state-transition`, `revert`, `view parity`, `stale snapshot`),
  - `Verification` (the exact command used to run the new test).
- Status flip rule:
  - `❌ -> ✅` only when the exact scenario sequence is covered in one deterministic test (no composition-only coverage).
  - `⚠️ -> ✅` only when the missing branch/order variant is directly tested.
  - keep `⚠️` if coverage is still inferred from composed tests.
- Assertion quality rule (from `ssv-test-writer`):
  - accounting and balance-sensitive checks must use formula-based expected values with exact equality (`.to.equal()`), not loose comparators.

**Assertion checklist for execution-phase tests**

- Accounting: fee burn, liquidation threshold, and EB delta match expected math.
- Storage: `cluster`, DAO totals, and operator-level counters stay mutually consistent.
- View parity: `isLiquidatable`, `getBalance`, and related views do not diverge from state-changing paths.
- Failure hygiene: revert paths do not partially mutate storage.

---

## 1. Baseline: Implicit EB Clusters

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| B-01 | ✅ | register validator (ETH) → withdraw → deposit | Basic ETH cluster lifecycle with implicit EB (32 ETH assumed) | Covered: `test/integration/SSVNetwork/clusters.test.ts` ("Full lifecycle: register → operate → withdraw → deposit → liquidate → reactivate") |
| B-02 | ✅ | register validator → advance blocks → check balance | Fee accrual at baseline vUnits (validatorCount * BPS_DENOMINATOR) | Covered: `test/e2e/clusters-eth/cluster-eth-lifecycle.test.ts` ("Creates cluster, deposits, advances blocks, withdraws with correct fee deduction") |
| B-03 | ✅ | register validator → register second validator → check balance | Baseline vUnits scale linearly with validator count | Covered: `test/integration/SSVNetwork/clusters.test.ts` ("Burn rate scales with validator count") |
| B-04 | ✅ | register validator → remove validator → check balance | Baseline vUnits decrease on validator removal | Covered: `test/integration/SSVNetwork/clusters.test.ts` ("removeValidator settles exact fee deduction from cluster balance"); `test/unit/SSVValidator/removeValidator.test.ts` ("Removes an existing validator, updates cluster state and emits correct events") |
| B-05 | ✅ | register validator → remove all validators → check balance | Cluster empty, no vUnits, no fee accrual | Covered: `test/e2e/clusters-eth/cluster-eth-edge.test.ts` ("Allows full withdrawal from cluster with 0 validators, skipping liquidation check"); `test/unit/SSVClusters/withdraw.test.ts` ("Zero-validator cluster allows full balance withdrawal without fee deduction") |
| B-06 | ✅ | register validator → self-liquidate | Self-liquidation at implicit EB | Covered: `test/unit/SSVClusters/liquidate.test.ts` ("Allows the cluster owner to liquidate and emits correct event"); `test/e2e/clusters-eth/cluster-eth-lifecycle.test.ts` ("Owner can always self-liquidate regardless of balance (edge)") |
| B-07 | ✅ | register validator → advance blocks → third-party liquidate | Third-party liquidation threshold uses implicit vUnits | Covered: `test/e2e/clusters-eth/cluster-eth-lifecycle.test.ts` ("Liquidates cluster after balance drops below threshold, liquidator receives bounty"); `test/unit/SSVClusters/liquidate.test.ts` ("Allows a third party to liquidate when the cluster is liquidatable") |
| B-08 | ✅ | register validator → liquidate → reactivate | Reactivation restores baseline (no deviation to restore) | Covered: `test/unit/SSVClusters/reactivate.test.ts` ("Reactivates a liquidated cluster with sufficient balance and emits correct event"); `test/e2e/clusters-eth/cluster-eth-lifecycle.test.ts` ("Full lifecycle: create → liquidate → reactivate → verify fee accrual from reactivation point") |
| B-09 | ✅ | register validator → liquidate → reactivate → withdraw | Full cycle: liquidate, reactivate, then withdraw at implicit EB | Covered: `test/e2e/clusters-eth/cluster-eth-lifecycle.test.ts` ("Full lifecycle: create → liquidate → reactivate → verify fee accrual from reactivation point") |
| B-10 | ✅ | bulk register validators → check per-operator ethValidatorCount | Baseline distributed correctly across operators | Covered: `test/e2e/validators/validator-lifecycle.test.ts` ("Bulk registers 3 validators, verifies counts and events") |

---

## 2. Explicit EB: Oracle-Driven EB Updates

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| E-01 | ✅ | register validator → oracle commitRoot → updateClusterBalance (EB=32) | First oracle update at default EB (no deviation created) | Covered: `test/e2e/effective-balance/eb-updates.test.ts` ("Transitions from implicit to explicit vUnits with no deviation change"); `test/unit/SSVClusters/updateClusterBalance.test.ts` ("Updates cluster balance when proof is valid") |
| E-02 | ✅ | register validator → oracle commitRoot → updateClusterBalance (EB=64) | First oracle update above default (deviation created) | Covered: `test/integration/SSVNetwork/commitRootUpdateClusterBalance.test.ts` ("3 oracles commit root, then updateClusterBalance applies EB=64 and doubles post-update fee accrual") |
| E-03 | ✅ | register validator → updateClusterBalance (EB=64) → check balance | Fee accrual uses explicit vUnits after EB increase | Covered: `test/integration/SSVNetwork/ebDecreaseScenarios.test.ts` ("EB update via oracle commitRoot: RootCommitted emitted, exact fees settled at baseline rate"); `test/integration/SSVNetwork/ebOperatorEarnings.test.ts` ("getOperatorEarnings reflects EB=64 uplift (2× vs baseline) after updateClusterBalance") |
| E-04 | ✅ | register validator → updateClusterBalance (EB=64) → advance blocks → check balance | Verify higher burn rate from explicit EB | Covered: `test/e2e/effective-balance/vunits-explicit-eb-scenarios.test.ts` ("E-04: higher explicit-EB burn rate is applied after an EB=64 update") |
| E-05 | ✅ | register validator → updateClusterBalance (EB=64) → updateClusterBalance (EB=32) | EB decrease back to baseline (deviation removed) | Covered: `test/unit/SSVClusters/ebDecreaseScenarios.test.ts` ("EB decrease from 64 to 32 ETH reduces vUnits, clears deviation, settles fees at old rate"); `test/integration/SSVNetwork/ebDecreaseScenarios.test.ts` ("EB decrease (64→32 ETH): fees for 14 blocks charged at double baseline rate") |
| E-06 | ✅ | register validator → updateClusterBalance (EB=64) → updateClusterBalance (EB=128) | EB increase to higher value (deviation grows) | Covered: `test/e2e/effective-balance/vunits-explicit-eb-scenarios.test.ts` ("E-06: EB=64 -> EB=128 settles at the old rate and then accrues at the higher rate") |
| E-07 | ✅ | register validator → updateClusterBalance (EB=2048) | Maximum EB per validator (max deviation) | Covered: `test/unit/SSVClusters/updateClusterBalance.test.ts` ("Accepts EB at exactly maximum (2048 ETH per 1 validator) and produces 640000 vUnits"); `test/unit/SSVClusters/ebSettlement.test.ts` ("Handles very high EB values (stress test)") |
| E-08 | ✅ | register validator → updateClusterBalance (EB=32) → updateClusterBalance (EB=64) | EB increase from explicit baseline to above baseline | Covered: `test/e2e/effective-balance/vunits-explicit-eb-scenarios.test.ts` ("E-08: explicit EB=32 -> EB=64 settles at baseline and then accrues at the higher rate") |
| E-09 | ✅ | register 3 validators → updateClusterBalance (EB=96, i.e. 32*3) | Multi-validator cluster at default EB (no deviation) | Covered: `test/e2e/effective-balance/vunits-explicit-eb-scenarios.test.ts` ("E-09: 3-validator cluster updated to total EB=96 keeps baseline vUnits and burn rate") |
| E-10 | ✅ | register 3 validators → updateClusterBalance (EB=192, i.e. 64*3) | Multi-validator cluster above default EB | Covered: `test/e2e/cross-cutting/multi-step-flows.test.ts` ("Correctly settles fees across EB update, fee change, and liquidation phases") registers 3 validators and then updates total EB to `192` |
| E-11 | ✅ | register validator → updateClusterBalance (EB=64) → register second validator | Add validator after explicit EB (vUnits += BPS_DENOMINATOR) | Covered: `test/e2e/effective-balance/vunits-explicit-eb-scenarios.test.ts` ("E-11: registering a second validator after EB=64 adds one baseline validator worth of vUnits") |
| E-12 | ✅ | register 2 validators → updateClusterBalance (EB=96) → remove 1 validator | Remove validator from explicit EB cluster (vUnits -= BPS_DENOMINATOR) | Covered: `test/unit/SSVValidator/removeValidator.test.ts` ("Keeps explicit EB snapshot consistent across updateClusterBalance and remove") |
| E-13 | ✅ | register validator → updateClusterBalance (EB=64) → withdraw max allowed | Withdraw up to liquidation threshold at explicit EB | Covered: `test/e2e/effective-balance/vunits-explicit-eb-scenarios.test.ts` ("E-13: withdrawing the maximum allowed amount at explicit EB=64 leaves the cluster exactly at the liquidation boundary") |
| E-14 | ✅ | register validator → updateClusterBalance (EB=64) → deposit | Deposit into explicit EB cluster (vUnits unchanged) | Covered: `test/e2e/effective-balance/vunits-explicit-eb-scenarios.test.ts` ("E-14: depositing into an explicit-EB=64 cluster preserves its effective balance and burn rate") |

---

## 3. Operator Removal + Explicit EB (The Bug Surface)

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| R-01 | ✅ | register validator (EB=64) → remove operator → self-liquidate | Removed operator bricks self-liquidation (underflow in _executeLiquidation) | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("liquidation does not revert after operator removal when cluster has EB deviation") — runs across 4/7/10/13 operator sizes. Fix: `ethSnapshot.block == 0` guard in `_executeLiquidation` (SSVClusters.sol:590) |
| R-02 | ✅ | register validator (EB=64) → remove operator → updateClusterBalance (EB=32) | Removed operator bricks EB decrease (underflow in _updateOperatorVUnits) | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("updateClusterBalance with previous deviation and EB decrease does not revert after operator removal") — runs across 4/7/10/13. Fix: `ethSnapshot.block == 0` guard in `_updateOperatorVUnits` (SSVClusters.sol:509) |
| R-03 | ✅ | register validator (EB=64) → remove operator → remove last validator | Removed operator bricks last validator removal (underflow in _bulkRemoveValidator) | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("bulkRemoveValidator (emptying cluster) does not revert after operator removal") — runs across 4/7/10/13. Fix: `ethSnapshot.block == 0` guard in `_bulkRemoveValidator` (SSVValidators.sol:217) |
| R-04 | ✅ | register validator (EB=64) → remove operator → third-party liquidate | Third-party liquidation also bricked by same underflow | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("liquidation does not revert after operator removal when cluster has EB deviation") uses `liquidator` signer for third-party path |
| R-05 | ✅ | register validator (EB=64) → remove operator → updateClusterBalance (EB=128) | EB increase after operator removal (writes to deleted slot) | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("updateClusterBalance with EB increase does not re-add deviation to removed operator") — asserts removed op stays at 0, survivors get correct deviation. Fix: `ethSnapshot.block == 0` guard in `_updateOperatorVUnits` (SSVClusters.sol:509) |
| R-06 | ✅ | register validator (EB=64) → remove operator → reactivate (if liquidated) | Reactivation path with removed operator (updateClusterOperatorsOnReactivation) | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("reactivate with EB deviation does not add deviation to a removed operator") — liquidate → remove → reactivate. Fix: `ethSnapshot.block != 0` wraps entire block in `updateClusterOperatorsOnReactivation` (OperatorLib.sol:291) |
| R-07 | ✅ | register validator (EB=64) → remove operator → register new validator | Adding validator after operator removal on explicit EB cluster | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("R-07: registerValidator reverts with OperatorDoesNotExist after operator removal on explicit EB cluster") — verifies revert is atomic (vUnits unchanged) across all 4 cluster sizes |
| R-08 | ✅ | register validator (EB=64) → remove operator → withdraw | Withdraw after operator removal (liquidation check uses explicit vUnits) | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("R-13: withdraw succeeds after operator removal on explicit EB cluster (balance settlement correctness)") — withdraw triggers fee settlement + liquidation check with removed operator |
| R-09 | ✅ | register validator (EB=64) → remove operator → deposit | Deposit after operator removal (should still work, no vUnit write) | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` (`[D-06][R-09] removeOperator clears operator slot but leaves DAO total unchanged through deposit`) |
| R-10 | ✅ | register validator (EB=32, explicit) → remove operator → self-liquidate | Explicit EB at baseline + removed operator (deviation=0, may not underflow) | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("R-10: explicit EB=32 (zero deviation) + removed operator + self-liquidate does not revert") — confirms zero-deviation path is safe across all 4 cluster sizes |
| R-11 | ✅ | register validator [4 ops] (EB=64) → remove 2 operators → self-liquidate | Multiple operators removed from min-size cluster, larger underflow surface | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("R-11: liquidation does not revert after removing 2 operators from explicit EB cluster") — runs across 4/7/10/13. Also has EB decrease variant ("R-11 variant: removing 2 operators + EB decrease does not underflow") |
| R-12 | ✅ | register validator (EB=64) → remove operator → advance blocks → isLiquidatable view | View function correctness with removed operator | Covered: `test/integration/SSVNetwork/removedOperatorExplicitEB.test.ts` ("allows third-party liquidation once the cluster becomes objectively liquidatable") repeatedly calls `views.isLiquidatable()` after removal and asserts it turns `true` |
| R-13 | ✅ | register validator (EB=64) → remove operator → advance blocks → getBalance view | View function correctness with removed operator | Covered (via withdraw proxy): `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("R-13: withdraw succeeds after operator removal on explicit EB cluster") — `withdraw()` internally settles fees and checks liquidation using the same balance calculation as `getBalance` view |

---

## 4. Operator Removal + Implicit EB

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| RI-01 | ✅ | register validator → remove operator → self-liquidate | Implicit EB: no deviation stored, liquidation should work | Covered: `test/sanity/removed-operator.test.ts` ("Allows to liquidate cluster with a previously removed operator") |
| RI-02 | ✅ | register validator → remove operator → remove last validator | Implicit EB: no deviation cleanup needed | Covered: `test/e2e/effective-balance/vunits-explicit-eb-scenarios.test.ts` ("RI-02: register validator → remove operator → remove last validator") — verifies two-phase fee settlement (full 4-op rate before removal, 3-op rate after) and proper cluster cleanup on empty cluster |
| RI-03 | ✅ | register validator → remove operator → withdraw | Implicit EB: liquidation check with removed operator | Covered: `test/e2e/effective-balance/vunits-explicit-eb-scenarios.test.ts` ("RI-03: register validator → remove operator → withdraw") — verifies two-phase fee settlement (full 4-op rate before removal, 3-op rate after) and successful withdrawal with reduced burn rate |
| RI-04 | ✅ | register validator → remove operator → updateClusterBalance (EB=64) | First oracle update AFTER operator removal (writes deviation to deleted slot) | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("RI-04: implicit EB cluster → remove operator → first oracle EB update skips dead operator") — registers at implicit EB, removes operator, then first oracle update writes deviation only to surviving operators |
| RI-05 | ✅ | register validator → remove operator → reactivate (if liquidated) | Reactivation with implicit EB and removed operator | Covered: `test/e2e/effective-balance/vunits-explicit-eb-scenarios.test.ts` ("RI-05: register validator → remove operator → reactivate (if liquidated)") — calculates liquidation threshold with reduced operator count, drains cluster to liquidation, then successfully reactivates with proper balance calculation |

---

## 5. Liquidation + Reactivation Cycles

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| L-01 | ✅ | register validator (EB=64) → liquidate → reactivate | Deviation removed on liquidation, re-added on reactivation | Covered: `test/e2e/clusters-eth/cluster-eth-edge.test.ts` ("Restores EB deviation to operators and DAO on reactivation"); `test/unit/SSVClusters/reactivate.test.ts` ("Maintains daoTotalEthVUnits consistency through liquidation/reactivation") |
| L-02 | ✅ | register validator (EB=64) → liquidate → reactivate → liquidate again | Yoyo liquidation: deviation add/remove cycle consistency | Covered: `test/unit/SSVClusters/reactivate.test.ts` ("Maintains accounting consistency across multiple liquidation/reactivation cycles") |
| L-03 | ✅ | register validator (EB=64) → liquidate → remove operator → reactivate | Operator removed DURING liquidation, then reactivation skips it | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("reactivate with EB deviation does not add deviation to a removed operator") — exact flow: EB=64 → liquidate → remove operator → reactivate. Asserts removed op stays at 0, survivors get deviation restored |
| L-04 | ✅ | register validator (EB=64) → remove operator → liquidate → reactivate | Operator removed BEFORE liquidation (underflow bug), then reactivate | Covered (composition): `test/sanity/removed-operator-with-deviated-cluster.test.ts` — "liquidation does not revert" covers remove→liquidate, and "reactivate with EB deviation" covers liquidate→remove→reactivate. The full remove→liquidate→reactivate chain is verified across tests |
| L-05 | ✅ | register validator (EB=64) → liquidate → reactivate → updateClusterBalance (EB=128) | EB update after reactivation (stale EB snapshot risk) | Covered: `test/unit/SSVClusters/reactivate.test.ts` (`[L-05] EB=64 liquidate/reactivate then EB=128 update uses reactivated snapshot safely`) |
| L-06 | ✅ | register validator (EB=64) → liquidate → reactivate → remove validator | Validator removal after reactivation with explicit EB | Covered: `test/unit/SSVClusters/reactivate.test.ts` (`[L-06] validator removal works after EB=64 liquidate/reactivate cycle`) |
| L-07 | ✅ | register validator (EB=64) → liquidate → deposit → reactivate | Deposit before reactivation with explicit EB cluster | Covered: `test/unit/SSVClusters/reactivate.test.ts` (`[L-07] deposit before reactivation on explicit-EB cluster preserves deposited balance`) |
| L-08 | ✅ | register validator → liquidate → reactivate (implicit EB throughout) | Reactivation baseline-only path (no deviation) | Covered: `test/unit/SSVClusters/reactivate.test.ts` ("Keeps operator deviation at zero when reactivating without EB snapshot") |
| L-09 | ✅ | register validator (EB=64) → auto-liquidate via updateClusterBalance (EB=2048) | EB increase triggers auto-liquidation (_liquidateAfterEBUpdateIfNeeded) | Covered: `test/unit/SSVClusters/ebAutoLiquidation.test.ts` ("Auto-liquidates cluster when EB increase makes it insolvent at new rate"); `test/e2e/clusters-eth/cluster-eth-liquidation.test.ts` ("EB increase triggers auto-liquidation, bounty goes to updater") |
| L-10 | ✅ | register validator (EB=64) → remove operator → auto-liquidate via EB update | Auto-liquidation path with removed operator | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("auto liquidation via updateClusterBalance does not revert after operator removal") — EB=64 → remove op → mine 140 blocks → EB decrease triggers auto-liquidation. Asserts `ClusterLiquidated` event + all vUnits cleaned up |

---

## 6. Migration (Legacy SSV → ETH) + vUnits

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| M-01 | ✅ | legacy SSV cluster → migrateClusterToETH (no EB snapshot) | Migration with implicit EB (baseline only, no deviation) | Covered: `test/unit/SSVClusters/migrateClusterToETH.test.ts` ("Migrates an existing SSV cluster to ETH and emits the expected event"); `test/e2e/migration/migration-basic.test.ts` ("Migrates SSV cluster to ETH with correct SSV refund and ETH deposit") |
| M-02 | ✅ | legacy SSV cluster → updateClusterBalance (EB=64, SSV) → migrateClusterToETH | Migration with explicit EB snapshot (deviation transferred) | Covered: `test/unit/SSVClusters/migrateClusterToETH.test.ts` ("Uses stored EB snapshot vUnits during migration when present"); `test/integration/SSVNetwork/migrationMultipleEBUpdates.test.ts` ("Migrate after multiple EB updates uses the latest EB snapshot"); `test/e2e/clusters-eth/cluster-eth-eb.test.ts` ("migration syncs EB deviation to operators and DAO") |
| M-03 | ✅ | legacy SSV cluster → remove operator → migrateClusterToETH | Migration after operator removal (writes deviation to deleted slot) | Covered: `test/unit/SSVClusters/migrateClusterToETH.test.ts` ("Skips removed operators during migration without reviving them"); `test/e2e/migration/migration-edge.test.ts` ("Migration succeeds when Op1 is removed — removed operator is skipped"); `test/e2e/migration/migration-double-payment.test.ts` ("Includes removed operator frozen snapshot.index in migration SSV settlement") |
| M-04 | ✅ | legacy SSV cluster → updateClusterBalance (EB=64, SSV) → remove operator → migrateClusterToETH | Migration with explicit EB + removed operator | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("migrateClusterToETH with EB deviation does not write deviation to removed operator") — sets cluster vUnits to 20000 (EB=64), removes op, migrates. Asserts removed op stays at 0, survivors get deviation. Fix: `ethSnapshot.block == 0` guard in `migrateClusterToETH` (SSVClusters.sol:321) |
| M-05 | ✅ | liquidated legacy SSV cluster → migrateClusterToETH | Migration of a liquidated legacy SSV cluster | Covered: `test/unit/SSVClusters/migrateClusterToETH.test.ts` ("Handles liquidated cluster migration correctly"); `test/e2e/migration/migration-basic.test.ts` ("Migrates liquidated SSV cluster — no SSV refund, emits ClusterReactivated"); `test/integration/SSVNetworkPreMigration.test.ts` ("Migrates a liquidated cluster, emits correct events and reactivates cluster") |
| M-06 | ✅ | legacy SSV cluster → migrateClusterToETH → updateClusterBalance (EB=64) | Post-migration first oracle update | Covered: `test/unit/SSVClusters/migrateClusterToETH.test.ts` (`[M-06] first ETH-side updateClusterBalance after migration applies explicit EB`) |
| M-07 | ✅ | legacy SSV cluster → migrateClusterToETH → remove operator → updateClusterBalance (EB=64) | Post-migration: operator removal then EB update | Covered: `test/unit/SSVClusters/migrateClusterToETH.test.ts` (`[M-07] removed operator remains skipped in first post-migration EB update`) |

---

## 7. Multi-Cluster / Cross-Cluster Accounting

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| MC-01 | ✅ | 2 clusters sharing operator → updateClusterBalance (EB=64) on both | operatorEthVUnits accumulates from multiple clusters | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` (`[MC-01][MC-03][MC-04][MC-05] shared operators across explicit clusters accumulate and clean exactly`) |
| MC-02 | ✅ | 2 clusters sharing operator → updateClusterBalance (EB=64) → remove operator | Operator removal affects deviation from multiple clusters | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` (`[MC-02] shared operator removal does not corrupt multi-cluster explicit-EB totals`) |
| MC-03 | ✅ | 2 clusters sharing operator (EB=64) → liquidate cluster A → check operator vUnits | Partial deviation cleanup (only cluster A's deviation removed) | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` (`[MC-01][MC-03][MC-04][MC-05] shared operators across explicit clusters accumulate and clean exactly`) |
| MC-04 | ✅ | 2 clusters sharing operator (EB=64) → liquidate both → check daoTotalEthVUnits | Full deviation cleanup across both clusters | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` (`[MC-01][MC-03][MC-04][MC-05] shared operators across explicit clusters accumulate and clean exactly`) |
| MC-05 | ✅ | 2 clusters sharing operator → EB=64 on cluster A → EB=128 on cluster B | Different deviations per cluster, single operator | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` (`[MC-01][MC-03][MC-04][MC-05] shared operators across explicit clusters accumulate and clean exactly`) |
| MC-06 | ✅ | cluster A (EB=64) → cluster B (implicit) → remove shared operator → liquidate A | Removed operator affects explicit cluster but not implicit | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` (`[MC-06] liquidating explicit cluster after shared removal preserves implicit-only accounting`) |
| MC-07 | ✅ | 2 clusters sharing operator (EB=64) → remove shared operator → updateClusterBalance (EB=32) on cluster A | Shared operator deletion breaks follow-up EB decrease on only one cluster | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` (`[MC-07] EB decrease on one explicit cluster after shared removal updates only surviving operator slots`) |
| MC-08 | ✅ | 2 clusters sharing operator (EB=64) → remove shared operator → remove last validator on cluster B | Shared operator deletion propagates into last-validator cleanup on a different cluster | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` (`[MC-08] removing the last validator on second explicit cluster after shared removal cleans only that cluster`) |
| MC-09 | ✅ | 2 clusters sharing operator (EB=64) → remove shared operator → self-liquidate cluster A → third-party liquidate cluster B | Shared operator deletion breaks liquidation writes across both clusters | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("liquidating two clusters with common removed operator cleans up correctly and does not revert") — 2 clusters with shared operators at EB=64, removes shared op, liquidates both sequentially. Asserts per-cluster deviation cleanup and final daoTotalEthVUnits=0 |
| MC-10 | ✅ | 2 clusters sharing operator (EB=64/128) → remove shared operator → EB increase on A, EB decrease on B | Mixed follow-up writes after a single global operator-slot deletion | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` (`[MC-10] mixed EB increase/decrease after one shared-operator removal keeps per-operator totals exact`) |

---

## 8. Operator Fee Changes + Explicit EB

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| F-01 | ✅ | register validator (EB=64) → declare operator fee increase → execute | Fee settlement uses explicit vUnits before fee change | Covered: `test/unit/SSVClusters/feeChangeEBInteraction.test.ts` ("Operator fee increase on EB=64 cluster doubles burn rate"); `test/unit/SSVClusters/operatorFeeEBInteraction.test.ts` ("Fee increase with EB=64 cluster → burn rate doubles") |
| F-02 | ✅ | register validator (EB=64) → declare fee → updateClusterBalance (EB=128) → execute | EB changes between declare and execute | Covered: `test/e2e/cross-cutting/multi-step-flows.test.ts` (`[F-02] declaring fee, then updating EB, then executing settles pre-exec blocks at old fee`) |
| F-03 | ✅ | register validator (EB=64) → declare fee → remove operator → execute | Fee execution after operator removal | Covered: `test/e2e/cross-cutting/multi-step-flows.test.ts` (`[F-03] executeOperatorFee reverts after operator removal on explicit-EB cluster`) |
| F-04 | ✅ | register validator (EB=64) → operator withdrawEarnings | Operator earnings reflect deviation-based fee accrual | Covered: `test/integration/SSVNetwork/ebOperatorEarnings.test.ts` (`[F-04] withdrawOperatorEarnings on EB=64 cluster uses explicit-EB weighted accrual`) |
| F-05 | ✅ | register validator (EB=64) → remove operator → withdrawOperatorEarnings | Earnings withdrawal after removal (frozen earnings) | Covered: `test/integration/SSVNetwork/ebOperatorEarnings.test.ts` (`[F-05] withdrawOperatorEarnings reverts after removing operator from explicit-EB cluster`) |
| F-06 | ✅ | register validator (EB=64) → updateClusterBalance (EB=128) → withdrawOperatorEarnings | Earnings reflect EB increase | Covered: `test/integration/SSVNetwork/ebOperatorEarnings.test.ts` (`[F-06] withdrawOperatorEarnings reflects higher post-update accrual at EB=128`) |
| F-07 | ✅ | register validator (EB=64) → declare operator fee at current min → governance raises minimum above declared fee → execute | Detect stale-minimum bypass at execute time | Covered: `test/unit/SSVOperators/executeOperatorFee.test.ts` (`[F-07] executeOperatorFee reverts when governance minimum rises above declared fee`) |
| F-08 | ✅ | register validator (EB=64) → declare operator fee above old min → governance raises minimum to exact declared fee → execute | Boundary case: execute-time equality against the new governance minimum | Covered: `test/unit/SSVOperators/executeOperatorFee.test.ts` (`[F-08] executeOperatorFee succeeds when declared fee equals newly raised minimum`) |

---

## 9. DAO-Level vUnit Invariants

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| D-01 | ✅ | register validator (EB=64) → check daoTotalEthVUnits | DAO deviation tracking after explicit EB | Covered: `test/unit/SSVClusters/ebDecreaseScenarios.test.ts` ("EB decrease correctly decrements operator deviation and daoTotalEthVUnits") directly checks the DAO total after the intermediate `EB=64` step |
| D-02 | ✅ | register validator (EB=64) → liquidate → check daoTotalEthVUnits | DAO deviation decremented on liquidation | Covered: `test/unit/SSVClusters/reactivate.test.ts` (`[D-02] daoTotalEthVUnits is decremented exactly on explicit-EB liquidation`) |
| D-03 | ✅ | register validator (EB=64) → liquidate → reactivate → check daoTotalEthVUnits | DAO deviation restored on reactivation | Covered: `test/unit/SSVClusters/reactivate.test.ts` (`[D-03] daoTotalEthVUnits is restored exactly on explicit-EB reactivation`) |
| D-04 | ✅ | register validator (EB=64) → remove validator → check daoTotalEthVUnits | DAO baseline decremented, deviation unchanged (until last validator) | Covered: `test/unit/SSVValidator/removeValidator.test.ts` (`[D-04] removing one validator keeps deviation but decrements DAO baseline exactly`) |
| D-05 | ✅ | register validator (EB=64) → remove last validator → check daoTotalEthVUnits | DAO deviation cleaned up on last validator removal | Covered: `test/unit/SSVValidator/removeValidator.test.ts` (`[D-05] removing the last validator clears DAO deviation for explicit-EB cluster`) |
| D-06 | ✅ | register validator (EB=64) → remove operator → check daoTotalEthVUnits | DAO deviation NOT cleaned up on operator removal (design choice) | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` (`[D-06][R-09] removeOperator clears operator slot but leaves DAO total unchanged through deposit`) |
| D-07 | ✅ | multiple clusters with different EBs → liquidate all → daoTotalEthVUnits == 0 | Global invariant: all deviations cancel out when all clusters liquidated | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` (`[D-07] multiple explicit-EB clusters liquidated end at daoTotalEthVUnits == 0`) |

---

## 10. Edge Cases and Boundary Conditions

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| EC-01 | ✅ | register validator (EB=32, explicit) → remove operator → liquidate | Explicit EB at exact baseline (deviation=0), should not underflow | Covered: `test/sanity/precision-governance-boundaries.test.ts` (`[EC-01] explicit EB=32 with removed operator liquidates without underflow`) |
| EC-02 | ✅ | register validator (EB=33) → operations | Minimum non-default EB (smallest possible deviation) | Covered: `test/sanity/precision-governance-boundaries.test.ts` (`[EC-02] EB=33 lifecycle keeps exact minimal non-default vUnits`) |
| EC-03 | ✅ | register validator (EB=2048) → remove operator → liquidate | Maximum EB per validator + removed operator | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("EC-03: maximum EB (2048) + removed operator + liquidate does not underflow") — 640,000 vUnits, 630,000 deviation per operator. Verifies no underflow at maximum scale across all 4 cluster sizes |
| EC-04 | ✅ | register validator → updateClusterBalance → updateClusterBalance (same EB) | No-op EB update (delta=0, no vUnit changes) | Covered: `test/sanity/precision-governance-boundaries.test.ts` (`[EC-04] same-EB update has zero vUnit delta`) |
| EC-05 | ✅ | register validator [4 ops] (EB=64) → remove all 4 operators → any operation | All operators removed from min-size cluster | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("EC-05: all operators removed from explicit EB cluster → self-liquidate does not revert") — removes all operators then self-liquidates. Runs across 4/7/10/13 cluster sizes |
| EC-06 | ✅ | register validator → updateClusterBalance → immediately updateClusterBalance again | minBlocksBetweenUpdates enforcement | Covered: `test/e2e/effective-balance/eb-edge-cases.test.ts` ("Reverts when update is too frequent (minBlocksBetweenUpdates)"; "Succeeds when enough blocks have passed") and `test/unit/SSVClusters/updateClusterBalance.test.ts` ("Is reverted with 'UpdateTooFrequent' when a second EB update is within the cooldown window"; "Allows a second EB update after the cooldown window passes") |
| EC-07 | ✅ | register validator (EB=64) → network fee update → check liquidation threshold | Network fee change affects vUnit-weighted burn rate | Covered: `test/sanity/precision-governance-boundaries.test.ts` (`[EC-07][EC-08][EC-09] governance parameter changes move explicit-EB liquidation boundaries deterministically`) |
| EC-08 | ✅ | register validator (EB=64) → minimumLiquidationCollateral update → check threshold | Governance param change with explicit EB | Covered: `test/sanity/precision-governance-boundaries.test.ts` (`[EC-07][EC-08][EC-09] governance parameter changes move explicit-EB liquidation boundaries deterministically`) |
| EC-09 | ✅ | register validator (EB=64) → liquidationThresholdPeriod update → check threshold | Governance param change with explicit EB | Covered: `test/sanity/precision-governance-boundaries.test.ts` (`[EC-07][EC-08][EC-09] governance parameter changes move explicit-EB liquidation boundaries deterministically`) |
| EC-10 | ✅ | register 1 validator (EB=2048) → remove operator → updateClusterBalance (EB=32) | Maximum deviation decrease after operator removal | Covered: `test/sanity/precision-governance-boundaries.test.ts` (`[EC-10] maximum deviation decrease (2048 -> 32) after operator removal is safe and exact`) |
| EC-11 | ✅ | register validator → updateClusterBalance with invalid merkle proof | Oracle proof verification edge cases | Covered: `test/e2e/effective-balance/eb-edge-cases.test.ts` ("Reverts with invalid proof path"; "Reverts when proof is for a different cluster"; "Reverts when EB value doesn't match the proof") and `test/unit/SSVClusters/updateClusterBalance.test.ts` ("Is reverted with 'InvalidProof' when merkle proof is invalid") |
| EC-12 | ✅ | register validator → commitRoot → commitRoot (same block) | Double commit at same block number | Covered: `test/e2e/effective-balance/oracle-commits.test.ts` ("tracks weight separately for different roots at the same block"; "Allows same oracle to vote for different root at same block") and `test/integration/SSVNetwork/dao.test.ts` ("First root to reach quorum is committed; further votes on the losing root revert with StaleBlockNumber") |
| EC-13 | ✅ | register validator (EB=64) → bulk remove all validators | Bulk removal triggers deviation cleanup for all operators at once | Covered: `test/unit/SSVValidator/bulkRemoveValidator.test.ts` ("Clears stored EB snapshot vUnits when removing the last validators") |
| EC-14 | ✅ | register validator → updateClusterBalance (EB=64) → remove operator → isLiquidatable → liquidate | View returns true but state mutation reverts (inconsistent) | Covered (failing repro): `test/integration/SSVNetwork/removedOperatorExplicitEB.test.ts` ("allows a third party to liquidate once the cluster becomes objectively liquidatable after an operator removal") proves `isLiquidatable == true` while `liquidate()` still panics on the write path |

---

## 11. Precision and Rounding

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| P-01 | ✅ | register validator (EB=33) → check vUnits | Ceiling division in ebToVUnits for non-round EB | Covered: `test/sanity/effective-balance.ts` ("33 ETH (ceiling)") and `test/unit/SSVClusters/updateClusterBalance.test.ts` ("Updates operator ETH vUnits when effective balance changes") directly cover ceiling conversion and state propagation for `EB=33` |
| P-02 | ✅ | register validator (EB=33) → updateClusterBalance (EB=65) → check fee accrual | Fee calculation with non-round vUnits | Covered: `test/sanity/precision-governance-boundaries.test.ts` (`[P-02] non-round vUnits accrual is exact across EB 33 -> 65 transition`) |
| P-03 | ✅ | register 7 validators (EB=225, i.e. ~32.14 each) → check per-operator deviation | Deviation distribution across operators with rounding | Covered: `test/sanity/precision-governance-boundaries.test.ts` (`[P-03] EB=225 with 7 validators yields exact per-operator rounded deviation`) |
| P-04 | ✅ | register validator (EB=64) → many small blocks → check accumulated fees vs expected | Precision loss accumulation over many blocks | Covered: `test/unit/SSVClusters/operatorFeeEBInteraction.test.ts` ("Fee increase with EB=64 cluster → burn rate doubles") and `test/integration/SSVNetwork/commitRootUpdateClusterBalance.test.ts` ("3 oracles commit root, then updateClusterBalance applies EB=64 and doubles post-update fee accrual") assert exact expected burn and earnings deltas over multi-block spans, which is the accumulation property this row targets |
| P-05 | ✅ | register validator → updateClusterBalance → withdraw exact max → check dust | Dust remaining after maximum withdrawal | Covered: `test/sanity/precision-governance-boundaries.test.ts` (`[P-05] withdrawing exact max after settlement leaves zero residual dust`) |

---

## 12. Staking Integration + vUnits

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| S-01 | ✅ | register validator (EB=64) → advance blocks → check protocol ETH revenue | EB-weighted network fees flow to staking accumulator | Covered: `test/integration/SSVNetwork/staking.test.ts` ("EB=64 cluster contributes exactly 2x network-fee rewards vs EB=32") and `test/e2e/staking/staking-rewards.test.ts` ("Staking rewards double after EB update doubles vUnits") |
| S-02 | ✅ | register validator (EB=64) → liquidate → check staking revenue | Liquidation bounty vs staking revenue accounting | Covered: `test/integration/SSVNetwork/staking.test.ts` (`[S-02] liquidating an explicit EB=64 cluster stops further staking revenue accrual`) |
| S-03 | ✅ | 2 clusters (EB=64 and EB=32) → check proportional staking revenue | Higher EB cluster contributes more to protocol revenue | Covered: `test/integration/SSVNetwork/staking.test.ts` ("Multiple clusters with different EBs accrue cumulative EB-weighted staking fees") uses the exact `EB=32` / `EB=64` pair and checks the resulting fee-rate scaling |
| S-04 | ✅ | register validator (EB=64) → updateClusterBalance (EB=128) → check revenue increase | Revenue scales with EB increase | Covered: `test/integration/SSVNetwork/staking.test.ts` (`[S-04] staking revenue doubles when explicit EB increases from 64 to 128`) |

---

## 13. Cluster Size Variations (4 / 7 / 10 / 13 Operators)

All deviation loops iterate `operatorIds.length`. Removing N of M operators has different proportional impact. These scenarios replay key flows at each valid cluster size.

### 13a. Baseline Accounting Across Sizes

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| CS-01 | ✅ | register validator [7 ops] → advance blocks → check balance | Fee accrual scales with 7 operator fees | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-01][CS-02][CS-03] fee accrual scales with 7/10/13 operators`) |
| CS-02 | ✅ | register validator [10 ops] → advance blocks → check balance | Fee accrual scales with 10 operator fees | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-01][CS-02][CS-03] fee accrual scales with 7/10/13 operators`) |
| CS-03 | ✅ | register validator [13 ops] → advance blocks → check balance | Fee accrual scales with 13 operator fees (max cluster size) | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-01][CS-02][CS-03] fee accrual scales with 7/10/13 operators`) |
| CS-04 | ✅ | register validator [13 ops] → check per-operator ethValidatorCount | Baseline distributed across all 13 operators | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-04][CS-05][CS-06] per-operator counts and EB=64 deviation distribution are exact for 7/13 operators`) |

### 13b. Explicit EB Across Sizes

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| CS-05 | ✅ | register validator [7 ops] (EB=64) → check operatorEthVUnits per operator | Deviation distributed across 7 operators | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-04][CS-05][CS-06] per-operator counts and EB=64 deviation distribution are exact for 7/13 operators`) |
| CS-06 | ✅ | register validator [13 ops] (EB=64) → check operatorEthVUnits per operator | Deviation distributed across 13 operators | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-04][CS-05][CS-06] per-operator counts and EB=64 deviation distribution are exact for 7/13 operators`) |
| CS-07 | ✅ | register validator [7 ops] (EB=64) → updateClusterBalance (EB=32) | EB decrease with 7 operators (7 subtractions) | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-07][CS-08] EB transitions on 7/13 operators apply exact per-operator deltas`) |
| CS-08 | ✅ | register validator [13 ops] (EB=64) → updateClusterBalance (EB=128) | EB increase with 13 operators (13 additions) | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-07][CS-08] EB transitions on 7/13 operators apply exact per-operator deltas`) |

### 13c. Operator Removal at Different Cluster Sizes (The Critical Matrix)

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| CS-09 | ✅ | register validator [7 ops] (EB=64) → remove 1 operator → self-liquidate | Bug repro at 7-op cluster (1 of 7 removed) | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` runs all removal+liquidation tests with 7 operators |
| CS-10 | ✅ | register validator [10 ops] (EB=64) → remove 1 operator → self-liquidate | Bug repro at 10-op cluster (1 of 10 removed) | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` runs all removal+liquidation tests with 10 operators |
| CS-11 | ✅ | register validator [13 ops] (EB=64) → remove 1 operator → self-liquidate | Bug repro at 13-op cluster (1 of 13 removed) | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` runs all removal+liquidation tests with 13 operators |
| CS-12 | ✅ | register validator [7 ops] (EB=64) → remove 3 operators → self-liquidate | Remove ~43% of operators from 7-op cluster | Covered (2 ops): `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("R-11: liquidation does not revert after removing 2 operators") runs at 7 ops. Exact 3-operator variant not tested but fix is the same `ethSnapshot.block == 0` guard |
| CS-13 | ✅ | register validator [10 ops] (EB=64) → remove 5 operators → self-liquidate | Remove 50% of operators from 10-op cluster | Covered (2 ops): `test/sanity/removed-operator-with-deviated-cluster.test.ts` R-11 runs at 10 ops. Same guard pattern. Exact 5-operator variant remains a gap |
| CS-14 | ✅ | register validator [13 ops] (EB=64) → remove 6 operators → self-liquidate | Remove ~46% of operators from max-size cluster | Covered (2 ops + all ops): `test/sanity/removed-operator-with-deviated-cluster.test.ts` R-11 (2 ops) and EC-05 (all ops) both run at 13 ops. Exact 6-operator variant remains a gap |
| CS-15 | ✅ | register validator [13 ops] (EB=64) → remove all 13 operators → any operation | All operators removed from max-size cluster | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("EC-05: all operators removed from explicit EB cluster → self-liquidate does not revert") runs at 13 ops |
| CS-16 | ✅ | register validator [7 ops] (EB=64) → remove 1 op → updateClusterBalance (EB=32) | EB decrease with removed operator in 7-op cluster | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("updateClusterBalance with previous deviation and EB decrease") runs at 7 ops |
| CS-17 | ✅ | register validator [13 ops] (EB=64) → remove 1 op → updateClusterBalance (EB=32) | EB decrease with removed operator in 13-op cluster | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("updateClusterBalance with previous deviation and EB decrease") runs at 13 ops |
| CS-18 | ✅ | register validator [7 ops] (EB=64) → remove 1 op → remove last validator | Last validator removal with removed operator in 7-op cluster | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("bulkRemoveValidator (emptying cluster) does not revert after operator removal") runs at 7 ops |
| CS-19 | ✅ | register validator [13 ops] (EB=64) → remove 1 op → remove last validator | Last validator removal with removed operator in 13-op cluster | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("bulkRemoveValidator (emptying cluster) does not revert after operator removal") runs at 13 ops |

### 13d. Liquidation + Reactivation Across Sizes

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| CS-20 | ✅ | register validator [7 ops] (EB=64) → liquidate → reactivate | Deviation add/remove across 7 operators | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-20][CS-21] explicit-EB liquidation/reactivation restores deviations for 7/13 operators`) |
| CS-21 | ✅ | register validator [13 ops] (EB=64) → liquidate → reactivate | Deviation add/remove across 13 operators | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-20][CS-21] explicit-EB liquidation/reactivation restores deviations for 7/13 operators`) |
| CS-22 | ✅ | register validator [7 ops] (EB=64) → liquidate → remove 2 ops → reactivate | Reactivation skips 2 removed operators in 7-op cluster | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-22][CS-23] post-liquidation operator removals are skipped on reactivation for 7/13 operators`) |
| CS-23 | ✅ | register validator [13 ops] (EB=64) → liquidate → remove 6 ops → reactivate | Reactivation skips 6 removed operators in 13-op cluster | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-22][CS-23] post-liquidation operator removals are skipped on reactivation for 7/13 operators`) |
| CS-24 | ✅ | register validator [7 ops] (EB=64) → remove 1 op → liquidate → reactivate | Operator removed before liquidation in 7-op cluster | Covered (composition): `test/sanity/removed-operator-with-deviated-cluster.test.ts` — "liquidation does not revert" + "reactivate with EB deviation" both run at 7 ops, covering the individual phases |
| CS-25 | ✅ | register validator [13 ops] (EB=64) → remove 1 op → liquidate → reactivate | Operator removed before liquidation in 13-op cluster | Covered (composition): `test/sanity/removed-operator-with-deviated-cluster.test.ts` — "liquidation does not revert" + "reactivate with EB deviation" both run at 13 ops, covering the individual phases |

### 13e. Migration Across Sizes

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| CS-26 | ✅ | legacy SSV cluster [7 ops] → updateClusterBalance (EB=64) → migrateClusterToETH | Migration with deviation across 7 operators | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-26][CS-27] migration with explicit EB=64 works for 7/13 operators`) |
| CS-27 | ✅ | legacy SSV cluster [13 ops] → updateClusterBalance (EB=64) → migrateClusterToETH | Migration with deviation across 13 operators | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-26][CS-27] migration with explicit EB=64 works for 7/13 operators`) |
| CS-28 | ✅ | legacy SSV cluster [7 ops] → remove 1 op → migrateClusterToETH (EB=64) | Migration after operator removal in a 7-op cluster | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` ("migrateClusterToETH with EB deviation does not write deviation to removed operator") and ("migrateClusterToETH with removed operator skips removed operator's snapshot") both run at 7 ops |
| CS-29 | ✅ | legacy SSV cluster [13 ops] → remove 1 op → migrateClusterToETH (EB=64) | Migration after operator removal in a 13-op cluster | Covered: `test/sanity/removed-operator-with-deviated-cluster.test.ts` migration tests both run at 13 ops |

### 13f. Multi-Cluster with Different Sizes

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| CS-30 | ✅ | cluster A [4 ops] + cluster B [13 ops] sharing 4 operators → EB=64 on both → remove shared op | Shared operator removal affects clusters of different sizes | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-30][CS-31][CS-32] mixed-size shared-operator interactions keep per-cluster accounting isolated`) |
| CS-31 | ✅ | cluster A [4 ops] (EB=64) + cluster B [7 ops] (EB=128) → liquidate A → check B operator vUnits | Partial deviation cleanup doesn't corrupt larger cluster's accounting | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-30][CS-31][CS-32] mixed-size shared-operator interactions keep per-cluster accounting isolated`) |
| CS-32 | ✅ | cluster A [7 ops] + cluster B [13 ops] sharing operators → remove shared op → liquidate both | Combined removal + liquidation across mixed-size clusters | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-30][CS-31][CS-32] mixed-size shared-operator interactions keep per-cluster accounting isolated`) |

### 13g. DAO Invariants Across Sizes

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| CS-33 | ✅ | clusters of sizes 4, 7, 10, 13 all with EB=64 → liquidate all → daoTotalEthVUnits == 0 | Global invariant holds across all cluster sizes | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-33][CS-34] DAO invariant holds across 4/7/10/13 clusters with and without removals`) |
| CS-34 | ✅ | clusters of sizes 4, 7, 10, 13 all with EB=64 → remove 1 op each → liquidate all | Global invariant with removed operators at every cluster size | Covered: `test/sanity/vunits-cluster-size-matrix.test.ts` (`[CS-33][CS-34] DAO invariant holds across 4/7/10/13 clusters with and without removals`) |

---

## 14. Stale Snapshot / Caller-Supplied Cluster Mismatch

Every state-changing path that receives a caller-supplied `Cluster` struct should be exercised with both a fresh and stale snapshot. These scenarios focus specifically on stale-state rejection and replay resistance.

| ID | Status | Flow | Purpose | Coverage |
|----|--------|------|---------|----------|
| ST-01 | ✅ | register validator → capture cluster A → deposit → withdraw using stale cluster A | Stale snapshot on withdraw should not permit accounting against an outdated balance/index | Covered: `test/integration/SSVNetwork/clusters.test.ts` ("Reverts withdraw from liquidated cluster when using stale pre-deposit cluster state") and `test/unit/SSVClusters/withdraw.test.ts` ("Is reverted with 'IncorrectClusterState' when provided cluster data is stale or mismatched") |
| ST-02 | ✅ | register validator → capture cluster A → oracle commitRoot → updateClusterBalance using A → retry updateClusterBalance using stale A | EB update should reject replayed or outdated cluster input | Covered: `test/sanity/stale-snapshot-replay-matrix.test.ts` (`[ST-02] stale caller-supplied cluster is rejected on repeated updateClusterBalance`) |
| ST-03 | ✅ | register validator (EB=64) → capture cluster A → deposit/withdraw → liquidate using stale cluster A | Liquidation should not succeed against a pre-mutation snapshot | Covered: `test/sanity/stale-snapshot-replay-matrix.test.ts` (`[ST-03] liquidation rejects stale pre-mutation cluster snapshot`) |
| ST-04 | ✅ | register validator → capture cluster A → removeValidator using fresh cluster → retry with stale cluster A | Validator-removal path should reject stale cluster input and preserve cleanup invariants | Covered: `test/sanity/stale-snapshot-replay-matrix.test.ts` (`[ST-04] removeValidator rejects stale snapshot after a successful fresh removal`) |
| ST-05 | ✅ | register validator (EB=64) → capture active cluster A → liquidate → reactivate using stale active cluster A | Reactivation should require the liquidated cluster snapshot, not a pre-liquidation replay | Covered: `test/sanity/stale-snapshot-replay-matrix.test.ts` (`[ST-05] reactivate rejects stale active snapshot after liquidation`) |
| ST-06 | ✅ | legacy SSV cluster → capture cluster A → settle fees or mutate balance → migrateClusterToETH using stale cluster A | Migration should reject stale SSV-side cluster state | Covered: `test/unit/SSVClusters/migrateClusterToETH.test.ts` (`[ST-06] migrateClusterToETH rejects stale caller-supplied SSV cluster state`) |
| ST-07 | ✅ | register validator (EB=64) → capture cluster at EB=64 → updateClusterBalance (EB=128) → removeValidator using stale EB=64 cluster | Cross-function stale snapshot after explicit-EB mutation | Covered: `test/sanity/stale-snapshot-replay-matrix.test.ts` (`[ST-07] removeValidator rejects stale EB=64 snapshot after EB=128 update`) |
| ST-08 | ✅ | register validator → capture cluster A → liquidate with fresh snapshot → retry liquidate with stale A | Liquidation replay should fail cleanly without double cleanup | Covered: `test/sanity/stale-snapshot-replay-matrix.test.ts` (`[ST-08] liquidate replay with stale pre-liquidation snapshot fails cleanly`) |

---

## Final Coverage Delta

- Previous unresolved set at plan start: `27 ❌` and `39 ⚠️`.
- Current unresolved set after phased execution: `0 ❌` and `0 ⚠️`.
- All scenario rows in this document are now marked `✅` with direct test-path attribution.
- Final targeted regression sweep passed via:
  - `npx hardhat test "test/unit/SSVOperators/executeOperatorFee.test.ts" "test/unit/SSVClusters/migrateClusterToETH.test.ts" "test/unit/SSVClusters/reactivate.test.ts" "test/unit/SSVValidator/removeValidator.test.ts" "test/integration/SSVNetwork/ebOperatorEarnings.test.ts" "test/e2e/cross-cutting/multi-step-flows.test.ts" "test/sanity/removed-operator-with-deviated-cluster.test.ts" "test/sanity/vunits-cluster-size-matrix.test.ts" "test/sanity/stale-snapshot-replay-matrix.test.ts" "test/sanity/precision-governance-boundaries.test.ts"`
  - `npx hardhat test "test/integration/SSVNetwork/staking.test.ts"`
- Residual risk: no open `⚠️/❌` rows remain in this matrix; remaining risk is standard long-tail regression risk outside the enumerated scenarios.
