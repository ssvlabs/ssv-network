# SSV Network v2.0.0 — Mainnet Readiness Checklist

**Generated:** 2026-02-17
**Updated:** 2026-03-16
**Sources:** Verified bug report, verified test coverage gap analysis, verified scripts & ops audit, DIP-X vs implementation review reports (ETH Payments, Effective Balance, SSV Staking)
**Branch:** `ssv-staking` (base for all feature branches)

---

## Priority Summary

| ID | Task | Type | Priority | Effort |
|----|------|------|----------|--------|
| BUG-1 | ~~`ensureETHDefaults` overwritten by stale memory copy~~ | Critical Bug Fix | P0 | ✅ Fixed |
| BUG-2 | ~~`_resetOperatorState` doesn't clear `operator.owner`~~ | ~~Critical Bug Fix~~ Won't Fix | ~~P0~~ | ✅ By design |
| BUG-3 | ~~`ensureETHDefaults` resurrects removed operators~~ | Critical Bug Fix | P0 | ✅ Mitigated |
| BUG-4 | ~~Double deviation cleanup on liquidated cluster validator removal~~ | Critical Bug Fix | P0 | ✅ Fixed ([PR #429](https://github.com/ssvlabs/ssv-network/pull/429)) |
| BUG-5 | ~~`_liquidateAfterEBUpdateIfNeeded` condition too strict for ETH-only operators~~ | Critical Bug Fix | P1 | ✅ Fixed |
| BUG-6 | ~~Rewards lost when `totalStaked == 0` in staking `_syncFees`~~ | Critical Bug Fix | P1 | ✅ Mitigated (deployment) |
| BUG-7 | ~~`DEFAULT_OPERATOR_ETH_FEE` value deviates from DIP-X spec~~ | ~~Critical Bug Fix~~ | ~~P1~~ | ✅ Closed (negligible) |
| BUG-8 | ~~Cooldown duration uses `block.timestamp` but DIP specifies blocks~~ | ~~Critical Bug Fix~~ | ~~P1~~ | ✅ Closed (not a bug, added NatSpec) |
| BUG-9 | ~~`uint64(delta)` silent truncation in operator earnings accumulation~~ | ~~Critical Bug Fix~~ | ~~P1~~ | ✅ Closed (not realistic) |
| BUG-10 | ~~Remove liquidation check in `withdraw` function~~ | Critical Bug Fix | P2 | ✅ Fixed |
| BUG-12 | ~~`removeValidator` / `bulkRemoveValidator` blocked for legacy SSV clusters~~ | Critical Bug Fix | P1 | ✅ Done (Product approved) |
| BUG-13 | ~~Silent default ETH fee assignment for legacy operators during migration~~ | Observability Fix | P2 | ✅ Fixed (PR #502) |
| BUG-14 | ~~Removed operator SSV fees skipped during `migrateClusterToETH` fee settlement (double-payment)~~ | Critical Bug Fix | P1 | ✅ Fixed |
| BUG-14b | ~~`reduceOperatorFee` / `declareOperatorFee` overwrite explicit zero ETH fees for legacy SSV operators~~ | Critical Bug Fix | P1 | ✅ Fixed (ensureETHDefaults marker pattern) |
| BUG-15 | ~~`withdrawAllVersionOperatorEarnings` initializes ETH snapshot for legacy SSV-only operators~~ | Critical Bug Fix | P1 | ✅ Fixed |
| BUG-16 | ~~SSVNetworkViews enforce cluster version checks and unify isActive logic~~ | Critical Bug Fix | P1 | ✅ Fixed |
| BUG-17 | ~~`commitRoot` quorum can become unreachable due to truncation in per-oracle weight math~~ | Critical Bug Fix | P0 | ✅ Fixed |
| BUG-18 | ~~Staking Rewards Accumulator Precision Loss~~ | High Bug Fix | P1 | ✅ Closed (accepted as part of the accumulator model) |
| BUG-19 | ~~Aggregate vs per-cluster rounding causes conservation law violation~~ | Medium Bug Fix | P1 | ✅ Closed (accepted as a known precision limitation) |
| BUG-20 | Dust permanently trapped on reward claim with zero cSSV balance | Low Bug Fix | P1 | ✅ Closed (Fixed on SEC-16b) |
| SEC-1 | ~~`updateQuorumBps(0)` allows zero-threshold oracle commits~~ | Security Hardening | P2 | ✅ Mitigated (owner-only) |
| SEC-2 | ~~`quorumBps` not initialized during upgrade — zero by default~~ | Security Hardening | P0 | ✅ Fixed — `initializeSSVStaking` now takes `quorumBps` param and validates `!= 0 && <= 10_000` |
| SEC-3 | ~~`replaceOracle` doesn't invalidate pending votes~~ | Security Hardening | ~~P1~~ P2 | ✅ Mitigated (owner-only + coordinated oracles) |
| SEC-4 | ~~`updateUnstakeCooldownDuration` allows zero cooldown~~ | Security Hardening | ~~P1~~ P2 | ✅ Mitigated (owner-only, no accounting risk) |
| SEC-5 | ~~`totalStaked` changes between oracle votes (front-running)~~ | Security Hardening | ~~P1~~ P2 | ✅ Mitigated (impractical) |
| SEC-6 | ~~Add `nonReentrant` to `migrateClusterToETH`~~ | Security Hardening | P2 | ✅ Closed (no callback risk) |
| SEC-7 | ~~Add `nonReentrant` to `onCSSVTransfer`~~ | Security Hardening | P2 | ✅ Closed (trusted cSSV contract) |
| SEC-8 | ~~`reactivate` not emitting warning for removed operators~~ | Security Hardening | P2 | ✅ Closed (visible off-chain) |
| SEC-9 | ~~`operatorMaxFee` function signature differs from DIP-X spec~~ | Security Hardening | P2 | ✅ Closed (by design, PR #390) |
| SEC-10 | ~~cSSV token lacks governance/voting extensions (ERC20Votes)~~ | Security Hardening | P2 | ✅ Closed (Snapshot-based governance, same as SSV) |
| SEC-11 | ~~`hasDeviation` reactivation optimization uses global counter for per-operator decision~~ | Security Hardening | ~~P1~~ P3 | ✅ Closed (BUG-4 fix resolves root cause) |
| SEC-12 | ~~`deposit()` accepts deposits to liquidated ETH clusters without fee settlement~~ | Security Hardening | P2 | ✅ Closed (by design — document in FLOWS.md) |
| SEC-13 | ~~`OperatorWithdrawn` event doesn't distinguish ETH vs SSV withdrawals~~ | Security Hardening | P2 | ✅ Fixed — `OperatorWithdrawnSSV` added to `ISSVOperators.sol`; SSV path emits it, ETH path unchanged |
| SEC-14 | ~~`commitRoot` accepts `bytes32(0)` as merkleRoot — permanently wastes block slot~~ | Security Hardening | P2 | ✅ Closed (coordinated oracles) |
| SEC-15 | ~~Min/max operator fee can be set to contradictory values~~ | Security Hardening | P2 | ✅ Closed (owner-only setters) |
| SEC-16 | ~~Missing zero-value/zero-address guards on deposit and withdraw~~ | Security Hardening | P2 | ✅ Closed |
| SEC-16b | ~~Dust ETH stranded in `accrued` after full cSSV transfer + claim~~ | Security Hardening | P1 | ✅ Fixed |
| SEC-17 | DAO governance functions lack input guardrails (min/max/non-zero) | Security Hardening | P1 | M |
| SEC-18 | ETH-only operators can call `withdrawOperatorEarningsSSV` (no-op but wastes gas) | Security Hardening | P3 | S |
| SEC-19 | ~~`minBlocksBetweenUpdates` never initialized — EB update rate limit silently disabled~~ | Security Hardening | P1 | ✅ Fixed |
| SEC-20 | ~~Oracle Quorum Can Be Set to Zero~~ | Security Hardening | P2 | ✅ Fixed |
| TEST-1 | ~~Validator register/remove with non-zero operator fees~~ | Unit Test Completeness | P0 | ✅ Closed (Addressed in PR #443) |
| TEST-2 | ~~EB-weighted operator earnings accumulation~~ | Unit Test Completeness | P0 | ✅ Closed (Addressed in PR #444) |
| TEST-3 | ~~Balance delta assertions in liquidation paths~~ | Unit Test Completeness | P0 | ✅ Closed (PR #445) |
| TEST-4 | ~~`updateClusterBalance` on liquidated clusters~~ | Unit Test Completeness | P0 | ✅ Closed (PR #447 + enhanced with 3 edge cases) |
| TEST-5 | ~~Oracle quorum edge cases~~ | Unit Test Completeness | P0 | ✅ Closed (Addressed in PR #449) |
| TEST-6 | ~~EB decrease scenarios~~ | Unit Test Completeness | P0 | ✅ Closed (Addressed in PR #451) |
| TEST-7 | ~~Reentrancy in staking functions~~ | Unit Test Completeness | P0 | ✅ Closed (Addressed in PR #452) |
| TEST-8 | ~~Forbid creating clusters with removed operators~~ | Unit Test Completeness | P0 | ✅ Closed (Addressed in PR #453) |
| TEST-9 | ~~Migration balance accounting verification~~ | Unit Test Completeness | P1 | ✅ Done |
| TEST-10 | ~~Operator fee change + EB burn rate interaction~~ | Unit Test Completeness | P1 | ✅ Done |
| TEST-11 | ~~Network fee update impact on active clusters~~ | Unit Test Completeness | P1 | ✅ Done |
| TEST-12 | ~~Multi-staker reward fairness~~ | Unit Test Completeness | P1 | ✅ Done |
| TEST-13 | ~~Liquidation + reactivation multi-cycle accounting~~ | Unit Test Completeness | P1 | ✅ Done |
| TEST-14 | ~~Reactivation with EB deviation solvency check~~ | Unit Test Completeness | P1 | ✅ Done |
| TEST-15 | SSV cluster operations completeness | Unit Test Completeness | P1 | M |
| TEST-16 | ~~View function coverage (SSVViews)~~ | Unit Test Completeness | P1 | ✅ Fixed |
| TEST-17 | ~~Staking rewards from EB-weighted cluster fees~~ | Unit Test Completeness | P1 | ✅ Closed (Covered in `test/integration/SSVNetwork/staking.test.ts`) |
| TEST-18 | `withdrawNetworkETHEarnings` (DAO ETH withdrawal) | Unit Test Completeness | P1 | S |
| TEST-19 | ~~Operator removal impact on active ETH clusters~~ | Unit Test Completeness | P1 | ✅ Closed (covered by unit tests) |
| TEST-19a | Operator removal impact on active ETH clusters (edge cases) | Unit Test Completeness | P1 | S |
| TEST-20 | ~~Cooldown duration changes affecting pending requests~~ | Unit Test Completeness | P1 | ✅ Closed (covered by unit tests) |
| TEST-21 | ~~EB boundary values (min/max per validator)~~ | Unit Test Completeness | P2 | ✅ Closed |
| TEST-22 | ~~Dust/precision edge cases~~ | Unit Test Completeness | P2 | ✅ Closed |
| TEST-23 | ~~Max operator count (13) with EB~~ | Unit Test Completeness | P2 | ✅ Closed |
| TEST-24 | ~~Idempotency and double-operation checks~~ | Unit Test Completeness | P2 | ✅ Closed |
| TEST-25 | ~~Upgrade path (reinitializer) tests~~ | Unit Test Completeness | P2 | ✅ Closed |
| TEST-26 | ~~Zero-validator cluster operations~~ | Unit Test Completeness | P2 | ✅ Closed |
| TEST-27 | ~~Operator at max validator limit~~ | Unit Test Completeness | P2 | ✅ Closed |
| TEST-28 | ~~Uncomment SSV reentrancy test assertions~~ | Unit Test Completeness | P0 | ✅ Closed (Addressed in PR #454) |
| TEST-29 | ~~Add contract ETH balance delta assertions to deposit tests~~ | Unit Test Completeness | P1 | ✅ Done |
| TEST-30 | ~~Resolve TODO comments with deferred assertions~~ | Unit Test Completeness~~ | P1 | ✅ Done |
| TEST-31 | Expand onCSSVTransfer test coverage | Unit Test Completeness | P1 | S |
| TEST-32 | ~~Add access control tests for DAO governance functions~~ | Unit Test Completeness | P1 | ✅ Closed (covered by unit tests) |
| TEST-33 | Mainnet governance config validation & edge-case tests | Unit Test Completeness | P1 | M |
| TEST-34 | ~~Staking solvency invariant: cSSV supply must not exceed SSV held by staking contract~~ | Unit Test Completeness | P1 | ✅ Done |
| ITEST-1 | ~~`commitRoot` → `updateClusterBalance` E2E flow~~ | Integration / E2E Tests | P1 | ✅ Closed |
| ITEST-2 | Migration with multiple EB updates E2E | Integration / E2E Tests | P1 | M |
| DEPLOY-1 | ~~Fix `deploy-all.ts` broken signature and constructor args~~ | Deployment & Scripts | P0 | ✅ Fixed — `deploy-all.ts` replaced by `deploy-fresh.ts` + `upgrade.ts` with correct `initializeSSVStaking(uint64,uint32[4],uint16)` signature |
| DEPLOY-2 | Verify `liquidationThresholdPeriod` config vs spec mismatch | Deployment & Scripts | P1 | S |
| DEPLOY-3 | ~~Verify `ethNetworkFee` rounding in config~~ | Deployment & Scripts | P2 | ✅ Closed (negligible) |
| DEPLOY-4 | ~~Remove unused error declarations in `ISSVNetworkCore.sol`~~ | Deployment & Scripts | P2 | ✅ Fixed |
| DEPLOY-5 | ~~Document `operatorMinFee` governance parameter in DIP-X~~ | Deployment & Scripts | P2 | ✅ Fixed |
| DEPLOY-6 | ~~DIP-X unstaking description doesn't match implementation~~ | Deployment & Scripts | P2 | ✅ Closed (already correct in SPEC.md and FLOWS.md) |
| DEPLOY-7 | ~~Deploy scripts import from test files~~ | Deployment & Scripts | P2 | ✅ Fixed — `upgrade.ts` and `deploy-fresh.ts` import from `scripts/common/config.ts`, no test file imports |
| QUALITY-1 | ~~`operatorFeeChangeRequests` not cleared on operator removal~~ | Code Quality | P2 | ✅ Closed (dead storage, off-chain sees OperatorRemoved) |
| QUALITY-2 | ~~Redundant `SSVStorage.load()` calls in view function loops~~ | Code Quality | P2 | ✅ Fixed |
| QUALITY-3 | ~~`withdraw` in SSVClusters duplicates operator loop inline~~ | Code Quality | P2 | ✅ Fixed |
| QUALITY-4 | ~~`_resetOperatorState` returns unused `Operator memory`~~ | Code Quality | P3 | ✅ Closed (cosmetic) |
| QUALITY-5 | ~~Remove duplicate `MaxValueExceeded` error declaration~~ | Code Quality | P3 | ✅ Fixed |
| QUALITY-6 | Multiple fixture patterns across tests (E2E/unit/integration) | Code Quality | P1 | ⚠️ High Priority — standardize after PR #435 |
| QUALITY-7 | Harness contracts vs. real contracts in tests | Code Quality | P2 | ⚠️ Medium Priority — migrate E2E to real contracts (PR #435) |
| QUALITY-8 | Helper function duplication across test types | Code Quality | P3 | ℹ️ Low Priority — merge helpers after PR #435 |
| QUALITY-9 | ~~`removeOperator` should clear fee change requests~~ | Code Quality | P2 | ✅ Closed (cleanup added + unit test) |
| QUALITY-10 | ~~`removeOperator` does not clear `operatorEthVUnits` — orphaned deviation~~ | Code Quality | P1 | ✅ Fixed |
| QUALITY-11 | ~~`commitRoot` skips `WeightedRootProposed` on quorum-reaching vote~~ | Code Quality | P2 | ✅ Fixed |
| QUALITY-12 | ~~Unsafe `uint128 → uint64` casts in operator/DAO earnings accumulation~~ | Code Quality | P2 | ✅ Fixed |
| OPS-1 | Create mainnet deployment runbook | Operational Readiness | P1 | M |
| OPS-2 | Create emergency rollback procedure | Operational Readiness | P1 | M |
| OPS-3 | Update `.env.example` for v2.0.0 | Operational Readiness | P2 | 🧹 Cleanup PR candidate |
| FUZZ-1 | ~~Strengthen 5 partially-covered echidna invariants~~ | Echidna Invariant Suite | P1 | ✅ Done |
| FUZZ-2 | Add 16 high-priority new echidna invariants (oracle/EB/fees/liquidation/staking) | Echidna Invariant Suite | P1 | L |
| FUZZ-3 | Add 8 medium-priority echidna invariants (Merkle proof, operator fee gov, legacy SSV) | Echidna Invariant Suite | P2 | L |
| FUZZ-4 | Add 6 lower-priority echidna invariants (vUnit aggregation, migration, overflow) | Echidna Invariant Suite | P2 | XL |
| FUZZ-5 | ETH contract balance accounting invariant: `address(this).balance == Σ cluster.balance + Σ operator.ethEarnings + ethDaoBalance + stakingEthPoolBalance` | Echidna Invariant Suite | P1 | M |
| MAINNET-READINESS-1 | Mainnet playbook ready and send to m-sig | Mainnet Readiness | P0 | M |
| MAINNET-READINESS-2 | Full mainnet -> staking upgrade flow | Mainnet Readiness | P0 | M |
| MAINNET-READINESS-3 | Deep testing on staking | Mainnet Readiness | P0 | M |
| MAINNET-READINESS-4 | Audit complete | Mainnet Readiness | P2 | M |
| MAINNET-READINESS-5 | Cssv token outside of the ssv protocol | Mainnet Readiness | P1 | M |
| MAINNET-READINESS-6 | PR merging (Marco) | Mainnet Readiness | P1 | M |






---

## Critical Bug Fix

### [BUG-1] `ensureETHDefaults` overwritten by stale memory copy
- **Type:** Critical Bug Fix
- **Priority:** P0
- **Status:** Fixed (verified on `ssv-staking`)
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** (empty)

**Requirement:**
Fix `updateClusterOperatorsOnRegistration` so that the memory copy of an operator is taken AFTER `ensureETHDefaults` writes to storage, not before. The stale memory copy currently overwrites the ETH defaults that were just set.

**Context:**
In `OperatorLib.sol:185`, the operator is loaded into memory. At line 201, `ensureETHDefaults` correctly writes to storage. But at line 239, `s.operators[operatorId] = operator` overwrites storage with the stale memory copy where `ethFee == 0` and `ethSnapshot.block == 0`. For pre-v2 operators that never had ETH fields initialized, this means they silently get zero ETH fees and cluster liquidation thresholds use an incorrect burn rate. This is the highest-severity bug in the codebase.

**Resolution:**
Code refactored on `ssv-staking` — the function now uses a storage reference (`operatorSt`), calls `ensureOperatorExist` and `ensureETHDefaults` on it, and only then copies to memory. See `OperatorLib.sol:197-201`.

**Acceptance Criteria:**
- [x] Operator loaded into memory AFTER `ensureETHDefaults` is called, or `ensureETHDefaults` is called on the memory copy and then written back
- [x] Pre-v2 operators get correct `ethFee` (default ETH fee) after first validator registration
- [x] Pre-v2 operators get correct `ethSnapshot.block` (current block) after first registration
- [x] `cumulativeFee` accumulates correctly (not zero) for clusters with pre-v2 operators
- [ ] Existing unit tests still pass
- [ ] New unit test covers registering a validator with a pre-v2 operator and verifying `ethFee != 0`

**Agent Instructions:**
1. Read `contracts/libraries/OperatorLib.sol` fully, focusing on `updateClusterOperatorsOnRegistration` (line 162).
2. The fix: Move the memory copy (`Operator memory operator = s.operators[operatorId]` at line 185) to AFTER the `ensureETHDefaults(s.operators[operatorId])` call at line 201. Alternatively, call `ensureETHDefaults` on the storage reference first, then load into memory.
3. Ensure the loop structure still works — `ensureETHDefaults` must be called on the storage reference, and then the memory copy should reflect the updated storage.
4. Do NOT change the `ensureETHDefaults` function itself.
5. Do NOT change `updateClusterOperators` or `updateClusterOperatorsOnReactivation` — they are separate code paths.
6. Add a unit test in `test/unit/SSVValidator/` that registers a validator using operators whose `ethFee` and `ethSnapshot.block` are both zero (simulating pre-v2 state), then verifies:
   - `operator.ethFee` is set to the default ETH fee after registration
   - `operator.ethSnapshot.block` is the current block
   - The cluster's cumulative fee correctly includes the operator's ETH fee
7. Run `npm run test:unit` to verify all tests pass.

#### Sub-items:
- [ ] Sub-task 1: Reorder memory load to after `ensureETHDefaults` in `updateClusterOperatorsOnRegistration`
- [ ] Sub-task 2: Write unit test for pre-v2 operator ETH fee initialization during validator registration
- [ ] Sub-task 3: Run full unit test suite and verify no regressions

---

### [BUG-2] `_resetOperatorState` doesn't clear `operator.owner`
- **Type:** ~~Critical Bug Fix~~ Informational — Won't Fix
- **Priority:** ~~P0~~ N/A
- **Status:** Closed (by design)
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** (empty)

**Original Requirement:**
When an operator is removed via `removeOperator`, the `_resetOperatorState` function must also clear `operator.owner` to ensure removed operators are consistently detectable across all code paths.

**Resolution — Intentional Design:**
Preserving `operator.owner` after removal is intentional behavior, consistent since v1 (`main` branch). Reasons:

1. **Off-chain queryability:** `getOperatorById` (SSVViews.sol:89) returns the preserved owner so explorers/UIs can display who owned a removed operator. Clearing it would lose this information on-chain.
2. **All on-chain guards are already safe:**
   - `checkOwner` (OperatorLib.sol:131): catches removed operators via `snapshot.block == 0 && ethSnapshot.block == 0` — never reaches the owner check
   - `ensureOperatorExist` (OperatorLib.sol:159): catches via `(ethSnapshot.block == 0 && snapshot.block == 0)` — second condition fires even though `owner != address(0)`
   - `getSSVBurnRate` (SSVViews.sol:356): removed operators pass `owner != address(0)` but contribute zero fee (fee is already zeroed) — no impact
3. **No exploit path:** there is no code path where a non-zero owner on a removed operator leads to incorrect state mutation or access control bypass.

Updated documentation in `docs/FLOWS.md` section 4.2 to reflect this design with a full detection-method table.

#### Sub-items:
- [ ] Sub-task 1: Add `operator.owner = address(0)` to `_resetOperatorState`
- [ ] Sub-task 2: Audit all `operator.owner` references for compatibility
- [ ] Sub-task 3: Add unit test verifying owner is cleared after removal
- [ ] Sub-task 4: Run full test suite

---

### [BUG-3] `ensureETHDefaults` resurrects removed operators
- **Type:** ~~Critical Bug Fix~~ Mitigated
- **Priority:** ~~P0~~ N/A
- **Status:** Closed (mitigated by upstream guards on `ssv-staking`)
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** (empty)

**Original Requirement:**
`ensureETHDefaults` must not set `ethSnapshot.block` on removed operators. Add a guard to skip operators that have been removed.

**Resolution — All call sites are already guarded:**
While `ensureETHDefaults` itself has no removed-operator guard, no code path can reach it with a removed operator:

1. **`updateClusterOperatorsOnRegistration` (line 200):** `ensureOperatorExist` (line 198) reverts first for removed operators (both snapshot blocks are 0).
2. **`declareOperatorFee` (SSVOperators.sol:107):** `checkOwner` (line 100) reverts first for removed operators (both snapshot blocks are 0).
3. **`updateClusterOperatorsMigration` (line 395):** Explicit `continue` at line 380 skips removed operators (`snapshot.block == 0 && ethSnapshot.block == 0`). Only operators with at least one non-zero snapshot block reach `ensureETHDefaults`.

**Acceptance Criteria:**
- [x] `ensureETHDefaults` does not modify removed operators (unreachable via all call sites)
- [x] Removed operators keep `ethSnapshot.block == 0` after any call path
- [x] New validators cannot be registered to clusters containing removed operators (enforced by `ensureOperatorExist`, PR #410)
- [x] Existing migration and registration tests still pass

---

### [BUG-4] ~~Double deviation cleanup on liquidated cluster validator removal~~
- **Type:** Critical Bug Fix
- **Priority:** P0
- **Status:** ✅ Fixed
- **Owner:** N/A
- **Timeline:** Merged 2026-02-17
- **Github Link:** [PR #429](https://github.com/ssvlabs/ssv-network/pull/429) (merged)

**Requirement:**
Fix `_bulkRemoveValidator` so that when removing the last validators from a liquidated cluster with explicit EB tracking, deviation is not double-subtracted from `operatorEthVUnits` and `daoTotalEthVUnits`.

**Context:**
In `SSVValidators.sol:164-247`, when a cluster is liquidated (`!cluster.active`), the `if (cluster.active)` guard at line 194 skips the operator update. However, the EB deviation cleanup block at lines 211-240 still runs. If the cluster had explicit EB tracking and was liquidated, the deviation was already cleaned up during `_executeLiquidation` (`SSVClusters.sol:554-614`). When `_bulkRemoveValidator` subtracts deviation again at lines 230 and 233, this double-subtracts from `operatorEthVUnits` and `daoTotalEthVUnits`, potentially causing underflow and reverting — which blocks validator removal entirely.

**Acceptance Criteria:**
- [ ] Removing validators from a liquidated cluster with explicit EB tracking does NOT double-subtract deviation
- [ ] `operatorEthVUnits` and `daoTotalEthVUnits` are correct after removing validators from a liquidated cluster
- [ ] Removing validators from a liquidated cluster without explicit EB tracking still works
- [ ] Removing validators from an active cluster is unchanged
- [ ] New test: liquidate a cluster with explicit EB → remove validators → verify no revert and correct deviation values

**Agent Instructions:**
1. Read `contracts/modules/SSVValidators.sol`, focus on `_bulkRemoveValidator` (line 164), particularly the EB deviation cleanup block at lines 211-240.
2. Read `contracts/modules/SSVClusters.sol`, focus on `_executeLiquidation` (line 554) to understand what deviation cleanup liquidation already performs.
3. The fix: Add a guard in the deviation cleanup block (around line 218-237) that skips the `operatorEthVUnits` and `daoTotalEthVUnits` subtraction when `!cluster.active`. The `ebSnapshot.vUnits` zeroing can remain (it's per-cluster and not double-counted).
4. Alternatively, wrap the deviation cleanup in `if (cluster.active || ...)` to only clean up deviation for active clusters.
5. Follow the existing pattern in the codebase where `cluster.active` guards are used.
6. Add a test in `test/unit/SSVValidator/` that: creates a cluster with EB tracking → liquidates it → removes validators → verifies `operatorEthVUnits` and `daoTotalEthVUnits` are correct (not underflowed).
7. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: Add `cluster.active` guard around deviation cleanup in `_bulkRemoveValidator`
- [x] Sub-task 2: Write test for validator removal from liquidated cluster with explicit EB (`test/unit/SSVValidator/bug4-double-deviation-liquidated.test.ts`)
- [ ] Sub-task 3: Run full test suite

---

### [BUG-5] `_liquidateAfterEBUpdateIfNeeded` condition too strict for ETH-only operators
- **Type:** Critical Bug Fix
- **Priority:** P1
- **Status:** Fixed
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** (empty)

**Requirement:**
Fix the condition at `SSVClusters.sol:543` so that `ethValidatorCount` is decremented for ETH-only operators (those with `ethSnapshot.block != 0` but `snapshot.block == 0`).

**Context:**
In `_liquidateAfterEBUpdateIfNeeded` at `SSVClusters.sol:521-552`, line 543 checks `op.ethSnapshot.block != 0 && op.snapshot.block != 0` before decrementing `ethValidatorCount`. Operators registered after the v2.0.0 migration may have `snapshot.block == 0` (never had SSV activity), so the decrement is skipped — leaving `ethValidatorCount` inflated.

**Acceptance Criteria:**
- [ ] `ethValidatorCount` is decremented for operators with `ethSnapshot.block != 0` regardless of `snapshot.block`
- [ ] Operators with `ethSnapshot.block == 0` (removed) are still skipped
- [ ] No change to the `_executeLiquidation` call

**Agent Instructions:**
1. Read `contracts/modules/SSVClusters.sol`, focus on `_liquidateAfterEBUpdateIfNeeded` (line 521).
2. Change the condition at line 543 from `op.ethSnapshot.block != 0 && op.snapshot.block != 0` to just `op.ethSnapshot.block != 0`.
3. Verify this doesn't break the removed-operator skip (removed operators have `ethSnapshot.block == 0` after `_resetOperatorState`).
4. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Fix condition in `_liquidateAfterEBUpdateIfNeeded`
- [ ] Sub-task 2: Add test for EB auto-liquidation with ETH-only operators
- [ ] Sub-task 3: Run full test suite

---

### [BUG-6] Rewards lost when `totalStaked == 0` in staking `_syncFees`
- **Type:** Critical Bug Fix
- **Priority:** P1
- **Status:** ✅ Mitigated (deployment)
- **Owner:** (deployment team)
- **Timeline:** At upgrade
- **Github Link:** Mitigated via [PR #431](https://github.com/ssvlabs/ssv-network/pull/431) (upgrade batch includes initial DAO stake)
- **DIP-X Review Source:** SSV Staking review findings DIP-18, DIP-19

**Requirement:**
When `totalStaked == 0` in `_syncFees`, ETH rewards must not be silently lost. Either accumulate them for the next sync when stakers exist, or redirect them to the DAO.

**Context:**
`SSVStaking.sol:179-203`: When `totalStaked == 0`, line 196 skips the `accEthPerShare` increment but line 201 still advances `stakingEthPoolBalance`. The fees earned during the zero-staked period are permanently locked in the contract — they can never be distributed to future stakers.

**Additional context from DIP-X review (DIP-19):** The `_syncFees` function also has a related edge case when `current <= previous` (DAO earnings decrease). At `SSVStaking.sol:187-190`, if `current.lte(previous)`, the function silently updates `stakingEthPoolBalance` to the lower value and returns without distributing. This can happen after reward claims reduce `sp.ethDaoBalance`. While `claimEthRewards` reduces both `stakingEthPoolBalance` and `sp.ethDaoBalance` by the same packed amount (so `current == previous` after normal claims), this edge case acts as a safety valve. The fix for BUG-6 should also consider this interaction to ensure no fees are lost in either direction.

**Mitigation:**
This is mitigated by deployment procedure rather than a code fix. The DAO multisig (Safe) upgrade batch transaction includes an SSV `approve` + `stake(1 SSV)` call immediately after `upgradeToAndCall`. This ensures `totalStaked > 0` before any network fees can accrue, making the zero-staked window impossible in practice. The 1 SSV stake goes to the DAO address, so the tokens are not lost. The full upgrade batch is:
1. `upgradeToAndCall` (proxy upgrade + `initializeSSVStaking` with quorumBps=7500)
2. `updateModule` × 7 (all module addresses)
3. SSV token `approve` (SSVNetwork contract as spender)
4. `stake(1_000_000_000)` (1 SSV minimum stake from DAO)
5. Governance parameter updates (`updateNetworkFee`, `updateLiquidationThresholdPeriod`, etc.)

All executed atomically in a single Safe multisig batch transaction.

**Acceptance Criteria:**
- [x] Deployment runbook includes DAO stake as part of upgrade batch
- [x] `initializeSSVStaking` now validates `quorumBps` (PR #431)
- [ ] Verify Safe batch transaction encoding before mainnet execution
- [ ] Post-upgrade: confirm `totalStaked > 0` on-chain

#### Sub-items:
- [x] Sub-task 1: Document deployment mitigation in MAINNET-READINESS.md
- [x] Sub-task 2: Add quorumBps to initializer (PR #431)
- [ ] Sub-task 3: Encode and test Safe batch transaction before mainnet

---

### [BUG-7] ~~`DEFAULT_OPERATOR_ETH_FEE` value deviates from DIP-X spec~~
- **Type:** ~~Critical Bug Fix~~
- **Priority:** ~~P1~~ Closed
- **Status:** ✅ Closed (negligible)
- **Owner:** N/A
- **Timeline:** N/A
- **Github Link:** N/A

**Resolution:** Difference is ~0.31% (~0.0000143 ETH/year per validator). Negligible. Mainnet config uses the DIP-X intended value adjusted for packability.
- **DIP-X Review Source:** ETH Payments review findings ETH-7, ETH-14

**Requirement:**
The `DEFAULT_OPERATOR_ETH_FEE` constant is set to `1,770,000,000` wei (1.77 gwei) but the DIP-X specifies `0.000000001775464912 ETH` (1,775,464,912 wei = 1.775464912 gwei). The DIP value is not packable (not divisible by `ETH_DEDUCTED_DIGITS = 100,000`), so a rounded value must be used. The implementation chose `1,770,000,000` which is further from the spec than necessary. The closest packable value rounding up is `1,775,500,000`.

**Context:**
`SSVCoreTypes.sol:14`: `DEFAULT_OPERATOR_ETH_FEE = 1770_000_000`. The DIP value `1,775,464,912 % 100,000 = 64,912` (not divisible), so it would revert with `MaxPrecisionExceeded`. The closest valid values are `1,775,400,000` (rounding down) or `1,775,500,000` (rounding up). The current value under-delivers by ~0.31% on the stated fee. Per-block difference: 5,464,912 wei. Annual impact per validator: ~0.0000143 ETH less than DIP target.

**Acceptance Criteria:**
- [ ] `DEFAULT_OPERATOR_ETH_FEE` updated to `1_775_500_000` (closest packable value rounding up) or team explicitly documents acceptance of the current rounded value
- [ ] Value is verified to be divisible by `ETH_DEDUCTED_DIGITS` (100,000)
- [ ] DIP-X document updated to note the rounding constraint if current value is kept
- [ ] Existing unit tests still pass with updated constant

**Agent Instructions:**
1. Read `contracts/libraries/SSVCoreTypes.sol`, find the `DEFAULT_OPERATOR_ETH_FEE` constant.
2. Verify `1_775_500_000 % 100_000 == 0` (it is).
3. Change `DEFAULT_OPERATOR_ETH_FEE = 1770_000_000` to `DEFAULT_OPERATOR_ETH_FEE = 1_775_500_000`.
4. Run `npx hardhat compile` to verify compilation.
5. Run `npm run test:unit` to verify no regressions.
6. If tests fail due to hardcoded expectations, update test constants to match.

#### Sub-items:
- [ ] Sub-task 1: Update `DEFAULT_OPERATOR_ETH_FEE` constant or document acceptance of current value
- [ ] Sub-task 2: Verify packability and run tests
- [ ] Sub-task 3: Update DIP-X if needed

---

### [BUG-8] ~~Cooldown duration uses `block.timestamp` but DIP specifies blocks~~
- **Type:** ~~Critical Bug Fix~~
- **Priority:** ~~P1~~ Closed
- **Status:** ✅ Closed (not a bug)
- **Owner:** N/A
- **Timeline:** N/A
- **Github Link:** N/A
- **DIP-X Review Source:** SSV Staking review finding DIP-8

**Resolution:** Implementation correctly uses `block.timestamp` (seconds). The deployment config (`deployments/hoodi-prod/config.json`) already has `cooldownDuration: 604800` (7 days in seconds). The DIP spec wording saying "blocks" was imprecise — team confirmed (Yurii) it's seconds. The spreadsheet value `50120` was a blocks-equivalent reference, not the actual config value.

**Requirement:**
The DIP-X governance table explicitly states `cooldownDuration` is "in blocks" with initial value "50120 (7 days)" and setter `updateUnstakeCooldownDuration(uint64 blocks)`. However, the implementation uses `block.timestamp` (seconds-based), not `block.number`. This creates a critical configuration risk: if `cooldownDuration` is initialized to 50120 thinking it's blocks, the actual cooldown would be ~13.9 hours instead of 7 days.

**Context:**
`SSVStaking.sol:88`: `uint64 unlockTime = uint64(block.timestamp + s.cooldownDuration)`. The `UnstakeRequest` struct field is named `unlockTime` (timestamp-like), and `SSVStaking.sol:232` checks `requests[i].unlockTime <= block.timestamp`. Using `block.timestamp` is actually more reliable for user-facing cooldowns (block times can vary), so the implementation choice is reasonable — but the DIP/spec and the initial value must align. If using seconds, the correct 7-day value is 604,800, not 50,120.

**Acceptance Criteria:**
- [ ] Either: DIP-X updated to say "in seconds" and initial value changed to `604800` (7 days in seconds)
- [ ] Or: implementation changed to use `block.number` instead of `block.timestamp` to match DIP
- [ ] The upgrade initializer sets the correct value for whichever unit is chosen
- [ ] `updateUnstakeCooldownDuration` parameter is documented with correct units
- [ ] Existing tests verified to use the correct unit

**Agent Instructions:**
1. Read `contracts/modules/SSVStaking.sol`, focus on `requestUnstake` (line 66) and `calculateTotalUnfrozenBalance` (line 226).
2. Read `contracts/modules/SSVDAO.sol`, focus on `updateUnstakeCooldownDuration` (line 245).
3. Read `contracts/upgrades/stage/hoodi/SSVNetworkSSVStakingUpgrade.sol` for the initial value set during upgrade.
4. Recommended fix (simpler): Keep `block.timestamp` usage (it's better UX), but:
   a. Update the DIP-X governance table to say "in seconds" instead of "in blocks"
   b. Ensure the upgrade initializer sets `cooldownDuration = 604800` (7 days in seconds)
   c. Update `updateUnstakeCooldownDuration` parameter name from `blocks` to `duration` in the interface
5. Check deployment configs (`deployments/hoodi-prod/config.json`, `deployments/hoodi-stage/config.json`) for the cooldown value and verify it matches the chosen unit.
6. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Decide on units (seconds vs blocks) and align implementation + DIP
- [ ] Sub-task 2: Verify upgrade initializer sets correct value for chosen unit
- [ ] Sub-task 3: Update interface parameter name if needed
- [ ] Sub-task 4: Run full test suite

---

### [BUG-9] ~~`uint64(delta)` silent truncation in operator earnings accumulation~~
- **Type:** ~~Critical Bug Fix~~
- **Priority:** ~~P1~~ Closed
- **Status:** ✅ Closed (not realistic)
- **Owner:** N/A
- **Timeline:** N/A
- **Github Link:** N/A

**Resolution:** Overflow is not realistic under DAO-enforced fee caps. Worst case with `maxOperatorEthFee = 5,326,300,000` wei/block (DAO cap), 500 validators at max EB (2048 ETH), and 1 year without any snapshot update: `delta ≈ 4.48e15`, which is **4,100x below** `uint64.max` (1.845e19). Even at 10 years with zero snapshot updates (impossible in practice — every cluster operation triggers a snapshot), delta would still be 400x below the threshold. The original audit example used an unrestricted fee value not bounded by the DAO's `maxOperatorEthFee`.

**Original context (for reference):**
In `OperatorLib.sol:68-69` (also lines 93-94, 326-327), `PackedETH.wrap(uint64(delta))` silently truncates when delta exceeds `uint64.max` (1.845e19). With 500 validators at max EB (2048 ETH), 2.7 years between snapshots: `delta = 4.078e21`, which is 221x larger than `uint64.max`. The operator loses ~99.5% of accumulated earnings.

**Concrete example:** Operator with `effectiveVUnits=320,000,000`, `ethFee=17,700` packed, `7,200,000` block gap → `delta = 320_000_000 * 17_700 * 7_200_000 = 4.078e16 * 100_000 = 4.078e21`, which overflows `uint64.max` and silently truncates.

**Acceptance Criteria:**
- [ ] `delta` exceeding `uint64.max` either reverts with a clear error or is safely handled
- [ ] Use `SafeCast.toUint64(delta)` or add `require(delta <= type(uint64).max)` at all three locations
- [ ] Existing tests pass
- [ ] New test: operator with high vUnits and long gap → verify no silent truncation

**Agent Instructions:**
1. Read `contracts/libraries/OperatorLib.sol`, focus on lines 68-69, 93-94, and 326-327.
2. Import OpenZeppelin's `SafeCast` or add manual bounds checks.
3. Replace `uint64(delta)` with `SafeCast.toUint64(delta)` at all three locations.
4. Add a unit test with high vUnits and long block gap to verify the fix catches overflow.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Replace `uint64(delta)` with SafeCast at all three locations in OperatorLib.sol
- [ ] Sub-task 2: Add unit test for operator earnings overflow scenario
- [ ] Sub-task 3: Run full test suite

---

### [BUG-17] `commitRoot` quorum can become unreachable due to truncation in per-oracle weight math
- **Type:** Critical Bug Fix
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** Before mainnet launch
- **Github Link:** (empty)

**Requirement:**
Fix `commitRoot` so that the configured oracle quorum remains reachable even when the frozen cSSV supply for a voting round is not divisible by the oracle count.

**Context:**
`commitRoot` freezes `cSSV.totalSupply()` on the first vote of a `(blockNum, merkleRoot)` round to prevent inter-vote supply drift. That mitigation is correct and must remain in place. However, the function then computes:
- `weight = totalStaked / defaultOracleIds.length`
- `threshold = (totalStaked * quorumBps) / 10_000`

This mixes two separately-truncated quantities. With 4 oracle slots and 75% quorum, if the frozen supply is `4q + 2` or `4q + 3`, three votes accumulate only `3q` weight while the threshold becomes `3q + 1`, so 3-of-4 consensus is mathematically unreachable. At 100% quorum, even 4 votes fail whenever the frozen supply is not divisible by 4.

This is distinct from the already-mitigated front-running issue tracked in SEC-5. Freezing supply removes the moving-target quorum problem between votes; it does not remove truncation mismatch inside the fixed round arithmetic.

**Vulnerability Details:**
- The bug is present in `contracts/modules/SSVDAO.sol` where vote weight and threshold are derived from the same frozen supply but rounded in different ways.
- The current specs mirror the same arithmetic, so documentation does not currently protect against the edge case.
- A minimal regression test now demonstrates the issue in `test/unit/SSVDAO/commitRoot.test.ts`: with `totalSupply = 1_000_000_002` and `quorumBps = 7500`, the third oracle vote should commit under intended 3-of-4 semantics, but does not.

**Proposed Fix:**
Do not add new storage. Keep `roundFrozenSupply` and `rootCommitments` unchanged, and compute the quorum threshold in oracle-vote space instead of raw token space:

```solidity
uint256 oracleCount = s.defaultOracleIds.length;
uint256 weight = totalStaked / oracleCount;

seb.rootCommitments[commitmentKey] += weight;
uint256 accumulatedWeight = seb.rootCommitments[commitmentKey];

uint256 votesNeeded = (oracleCount * s.quorumBps + BPS_DENOMINATOR - 1) / BPS_DENOMINATOR;
uint256 threshold = votesNeeded * weight;
```

This preserves:
- frozen per-round supply
- current storage layout
- current `WeightedRootProposed` event shape
- current behavior where quorum updates between votes affect the next vote

It also restores the intended semantics:
- 75% quorum with 4 oracles requires 3 votes
- 100% quorum with 4 oracles requires 4 votes

**Acceptance Criteria:**
- [ ] With 4 oracles and `quorumBps = 7500`, the third vote commits even when frozen supply is not divisible by 4
- [ ] With 4 oracles and `quorumBps = 10000`, the fourth vote commits even when frozen supply is not divisible by 4
- [ ] `roundFrozenSupply` logic remains unchanged and still fixes inter-vote supply drift
- [ ] No storage layout changes are introduced
- [ ] Existing quorum behavior for low thresholds (for example `quorumBps = 1`) remains intact
- [ ] Unit test coverage includes at least one truncation regression case

**Agent Instructions:**
1. Read `contracts/modules/SSVDAO.sol`, focusing on `commitRoot`.
2. Keep the existing frozen-supply logic (`roundFrozenSupply`) exactly as-is.
3. Do not add a new storage mapping such as `rootVotes`.
4. Change quorum threshold computation to use `ceil(oracleCount * quorumBps / 10_000)` votes, then compare in the same truncated weight domain already used by `rootCommitments`.
5. Update or extend unit tests in `test/unit/SSVDAO/commitRoot.test.ts` to cover:
   - 75% quorum with non-divisible frozen supply
   - 100% quorum with non-divisible frozen supply
6. Update `docs/SPEC.md` and `docs/FLOWS.md` to describe vote-based quorum thresholding over equal oracle slots while still noting that supply is frozen per round.

#### Sub-items:
- [x] Add failing regression test demonstrating unreachable 3-of-4 quorum with non-divisible supply
- [ ] Patch `commitRoot` threshold math without storage-layout changes
- [ ] Add regression test for 100% quorum with non-divisible supply
- [ ] Update SPEC/FLOWS to reflect corrected quorum calculation
- [ ] Run targeted DAO/oracle tests and verify no regressions

---

### [BUG-18] Staking Rewards Accumulator Precision Loss

**File:** `contracts/modules/SSVStaking.sol` L202
**Severity:** Low

**Description:** The `accEthPerShare` accumulator increment can round to zero when `newFeesWei * PRECISION < totalStaked`. Those fees are absorbed into `stakingEthPoolBalance` but never distributed to stakers. With the minimum packed fee increment of 100,000 wei (`ETH_DEDUCTED_DIGITS`) and PRECISION of 1e18, any `totalStaked > 1e23` (100,000 SSV tokens at 18 decimals) causes the smallest fee increment to round to zero.

**Code:**
```solidity
s.accEthPerShare += uint128((newFeesWei * PRECISION) / totalStaked);
// When newFeesWei * 1e18 < totalStaked, this adds 0
```

**Recommendation:** This is inherent to the accumulator pattern. The dust loss per sync is bounded by `totalStaked / PRECISION` wei (~0.0001 ETH for 100k SSV staked). For production parameters this is negligible, but consider documenting this as a known limitation. Alternatively, accumulate un-distributed remainders:
```solidity
uint256 scaledFees = newFeesWei * PRECISION;
uint256 distributed = (scaledFees / totalStaked) * totalStaked;
s.accEthPerShare += uint128(scaledFees / totalStaked);
s.undistributedDust += scaledFees - distributed; // carry forward
```
**Resolution:**
BUG-18 is a standard accumulator dust issue. SSV supply is mintable, so we should not frame this as mathematically impossible forever. But under the current fee path, full zero-rounding only becomes reachable in the absolute smallest live case above 3.55B SSV staked, which is more than 200x current supply scale, and realistic operating conditions push the threshold far higher. Even with substantial token growth, the worst-case annual dust remains negligible and in the safe direction as tiny contract surplus.

---

### [BUG-19] Aggregate vs per-cluster rounding causes conservation law violation

**Severity:** MEDIUM
**Functions:** `OperatorLib.updateSnapshotSt()` at [`OperatorLib.sol:52-72`](contracts/libraries/OperatorLib.sol#L52-L72), `ProtocolLib.networkTotalEarnings()` at [`ProtocolLib.sol:84-90`](contracts/libraries/ProtocolLib.sol#L84-L90), `ClusterLib.updateBalanceWithEB()` at [`ClusterLib.sol:306-321`](contracts/libraries/ClusterLib.sol#L306-L321)
**Invariant:** `Σ(operator_earnings) + DAO_earnings == Σ(cluster_fees_paid)` (ETH Conservation)

**Mechanism:**

Each cluster pays fees proportional to its own `vUnits`:
```solidity
// Per-cluster payment (ClusterLib.updateBalanceWithEB)
networkFeeUnits = (idxNet * units_cluster) / BPS_DENOMINATOR;  // floor division
operatorFeeUnits = (idxOp * units_cluster) / BPS_DENOMINATOR;  // floor division
```

But operators earn proportional to their **aggregate** `effectiveVUnits` across ALL clusters:
```solidity
// Per-operator earnings (OperatorLib.updateSnapshotSt)
delta = (blockDiffEthFee * effectiveVUnits_total) / BPS_DENOMINATOR;  // floor division
```

And the DAO earns proportional to aggregate `daoTotalEthVUnits`:
```solidity
// DAO earnings (ProtocolLib.networkTotalEarnings)
earningsUnits = (idx * ethNetworkFee * daoTotalEthVUnits) / BPS_DENOMINATOR;
```

Due to the mathematical property `floor(a×x/n) + floor(a×y/n) ≤ floor(a×(x+y)/n)`:

```
Σ(cluster_i_payment) ≤ operator_aggregate_earnings
Σ(cluster_i_network_fee) ≤ DAO_aggregate_earnings
```

**Impact:**

Operators and the DAO **virtually earn slightly more** than clusters collectively pay. This creates a slow insolvency drift where the sum of all claimable balances (operator earnings + DAO rewards) exceeds the ETH actually deposited by cluster owners.

**Bounded magnitude:**
- Per settlement: at most `(numClusters - 1) × ETH_DEDUCTED_DIGITS` wei = `(N-1) × 100,000 wei`
- Per year (2.5M blocks): with 1,000 clusters = ~0.00025 ETH/year

**Recommendation:**
This is a known DeFi pattern and the drift is negligible in practice. For completeness, consider documenting this as an accepted known issue. No code change required unless operating at extreme scale (>100K clusters sustained for years).

**Resolution:**
BUG-19 is a real but negligible rounding issue. It is completely inactive while clusters remain at default `32 ETH` effective balance, and only activates once post-Pectra effective-balance diversity appears. In a contract-faithful mainnet-scale simulation (`150,000` validators, `1,100` clusters, `1,900` operators), the yearly net drift stays on the order of tens of nano-ETH, and even under doubled growth scenarios remains operationally irrelevant. The practical recommendation is to treat BUG-19 as a known precision limitation, not a meaningful mainnet risk or a blocker to launch.

---

### [BUG-20]: ~~Dust permanently trapped on reward claim with zero cSSV balance~~

**Severity:** LOW
**Function:** `SSVStaking.claimEthRewards()` at [`SSVStaking.sol:109-139`](contracts/modules/SSVStaking.sol#L109-L139)
**Invariant:** `Σ(user.accrued) + Σ(claimed) = total distributed via accEthPerShare`

**Mechanism:**

```solidity
uint256 payout = claimable - (claimable % ETH_DEDUCTED_DIGITS);
// ...
uint256 remainder = claimable - payout;
s.accrued[msg.sender] = (remainder != 0 && userBalance == 0) ? 0 : remainder;
//                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                       Dust zeroed without returning to pool
```

When a user has zero cSSV and a sub-precision remainder (`< ETH_DEDUCTED_DIGITS = 100,000 wei`), the remainder is deleted from `accrued` but NOT returned to `stakingEthPoolBalance` or `ethDaoBalance`. The dust remains in both virtual accounting variables and in the contract's actual ETH balance, permanently locked.

**Impact:**
- Maximum dust per user: 99,999 wei (~0.0000001 ETH)
- Cumulative impact over thousands of users: could reach a few cents to a few dollars total
- The contract slowly accumulates a tiny amount of unclaimable ETH

**Recommendation:**
Accept as known behavior (trivial magnitude) or return dust to the pool:
```solidity
if (remainder != 0 && userBalance == 0) {
    s.accrued[msg.sender] = 0;
    // Optionally: redistribute dust back to pool for other stakers
}
```

**Resolution:** ✅ Closed — The SEC-16b fix covers this exact code path. Maximum dust per user (99,999 wei) is accepted as negligible. Cross-referenced in CONSOLIDATED-AUDIT-FINDINGS CA-17.

---

## Security Hardening

### [SEC-1] `updateQuorumBps(0)` allows zero-threshold oracle commits
- **Type:** Security Hardening
- **Priority:** P2 (downgraded from P0)
- **Status:** ✅ Mitigated (owner-only)
- **Owner:** N/A
- **Timeline:** N/A
- **Github Link:** N/A

**Requirement:**
Add a minimum quorum validation to `updateQuorumBps`. A quorum of 0 allows a single oracle vote to commit any root.

**Context:**
`SSVDAO.sol:234-239`: The function only checks `quorum > BPS_DENOMINATOR` (max bound). Setting `quorumBps = 0` makes the threshold in `commitRoot` (line 186) equal to 0, meaning any single oracle can unilaterally commit roots. Combined with SEC-2 (quorum defaults to 0 after upgrade), this is an immediate post-upgrade vulnerability.

**Mitigation:** Downgraded to P2. `updateQuorumBps` is owner-only (DAO multisig). A compromised or negligent owner can already upgrade the entire contract, so zero-quorum via the setter is not an independent attack vector. The critical path (SEC-2: quorum defaulting to 0 after upgrade) is already fixed in PR #431 by validating quorumBps in the initializer.

**Acceptance Criteria:**
- [ ] `updateQuorumBps(0)` reverts with `InvalidQuorum()`
- [ ] A reasonable minimum is enforced (e.g., `quorum >= 2500` for 25%, or at minimum `quorum > 0`)
- [ ] Existing tests for `updateQuorumBps` updated to reflect new validation
- [ ] New test: call `updateQuorumBps(0)` → expect revert

**Agent Instructions:**
1. Read `contracts/modules/SSVDAO.sol`, focus on `updateQuorumBps` (line 234).
2. Add `if (quorum == 0) revert InvalidQuorum();` before the existing check. Consider also adding a minimum like `if (quorum < 2500)` for stronger safety.
3. Read `test/unit/SSVDAO/updateQuorumBps.test.ts` for existing test patterns.
4. Add a test case for `updateQuorumBps(0)` expecting `InvalidQuorum` revert.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Add minimum quorum validation to `updateQuorumBps`
- [ ] Sub-task 2: Update/add unit tests for quorum boundary
- [ ] Sub-task 3: Run full test suite

---

### [SEC-2] ~~`quorumBps` not initialized during upgrade — zero by default~~
- **Type:** Security Hardening
- **Priority:** P0
- **Status:** ✅ Fixed
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** [PR #431](https://github.com/ssvlabs/ssv-network/pull/431)

**Requirement:**
Set `quorumBps` during the upgrade initializer (`reinitializer(3)`) to prevent a window where any oracle can unilaterally commit roots.

**Context:**
`SSVNetworkSSVStakingUpgrade.sol` (line 8) initialized `cooldownDuration` and `defaultOracleIds` but NOT `quorumBps`. After upgrade, `quorumBps` was 0 in storage until the DAO manually called `updateQuorumBps()`. During this window, combined with SEC-1, a single oracle could commit arbitrary Merkle roots. Now fixed — see Resolution below.

**Resolution:**
`initializeSSVStaking` now accepts `quorumBps` as a third parameter (`uint16`) and validates `if (quorumBps == 0 || quorumBps > 10_000) revert InvalidQuorum()` before writing to storage. Both `upgrade.ts` and `generate-safe-batch.ts` pass `quorumBps` from the deployment config. This closes the initialization window entirely.

**Acceptance Criteria:**
- [x] `quorumBps` is set during the upgrade initializer to a safe default (7500 = 75% per DIP-X spec)
- [x] Initializer validates `quorumBps != 0` (rejects zero with `InvalidQuorum`)
- [x] Post-upgrade verification confirms `quorumBps != 0`

**Agent Instructions:**
1. Read `contracts/upgrades/stage/hoodi/SSVNetworkSSVStakingUpgrade.sol` (line 8).
2. Option A (preferred): Add `SSVStorageStaking.load().quorumBps = 7500;` to the `initializeSSVStaking` function. Also add `quorumBps` as a parameter: `initializeSSVStaking(uint64 cooldownDuration, uint32[4] memory defaultOracleIds, uint16 quorumBps)`. Update the function signature in `scripts/upgrade.ts` and `scripts/generate-safe-batch.ts` accordingly.
3. Option B (simpler): Add a hardcoded `SSVStorageStaking.load().quorumBps = 7500;` directly in the initializer without adding a parameter.
4. Emit `QuorumUpdated(7500)` event after setting.
5. Update the initializer ABI references in deploy scripts.
6. Run `npm run test:unit` and `npm run test:integration`.

#### Sub-items:
- [x] Sub-task 1: Add `quorumBps` initialization to upgrade initializer
- [x] Sub-task 2: Update deploy scripts to match new signature
- [ ] Sub-task 3: Add test verifying `quorumBps` is set after upgrade
- [ ] Sub-task 4: Run full test suite

---

### [SEC-3] ~~`replaceOracle` doesn't invalidate pending votes~~
- **Type:** Security Hardening
- **Priority:** ~~P1~~ P2 (downgraded)
- **Status:** ✅ Mitigated (owner-only + coordinated oracles)
- **Owner:** N/A
- **Timeline:** N/A
- **Github Link:** N/A

**Resolution:** `replaceOracle` is owner-only (DAO multisig), and the oracle set is a small coordinated group working with the DAO. If an oracle is compromised and replaced mid-vote, the remaining honest oracles can simply propose and vote on a correct root — the compromised oracle's stale vote alone cannot reach quorum (needs 3-of-4). Any edge case is resolvable operationally by the DAO + oracle operators.

**Original context (for reference):**
`SSVDAO.sol:205-229`: When `replaceOracle` is called, the old oracle's address is removed from `oracleIdOf` but the `oracleId` stays the same. The `hasVoted` mapping uses `oracleId`, so: (1) the old oracle's votes persist and count toward quorum, (2) the new oracle cannot re-vote on pending commitments since `hasVoted[commitmentKey][oracleId]` is already true. A compromised oracle replaced mid-vote still influences quorum.

**Acceptance Criteria:**
- [ ] Either: pending votes for the replaced oracleId are reset when `replaceOracle` is called
- [ ] Or: this behavior is explicitly documented with risk analysis, and a mechanism exists to clear stale votes if needed
- [ ] Test: replace oracle mid-vote → verify new oracle can vote on pending commitments

**Agent Instructions:**
1. Read `contracts/modules/SSVDAO.sol`, focus on `replaceOracle` (line 205) and `commitRoot` (line 155).
2. Read the `SSVStorageEB` storage struct to understand the `hasVoted` and `commitmentWeight` mappings.
3. To reset pending votes: after replacing the oracle, iterate over pending commitments and clear `hasVoted[commitmentKey][oracleId]` and subtract the old oracle's weight from `commitmentWeight[commitmentKey]`. However, this requires tracking pending commitments, which may not be stored.
4. Simpler alternative: add a `voteNonce` per oracleId. Increment it on replacement. Use `keccak256(commitmentKey, oracleId, voteNonce)` for the hasVoted key. This invalidates all old votes automatically.
5. Ensure the fix doesn't break the quorum mechanism for non-replaced oracles.
6. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Design vote invalidation mechanism
- [ ] Sub-task 2: Implement in `replaceOracle` and `commitRoot`
- [ ] Sub-task 3: Write tests for oracle replacement mid-vote
- [ ] Sub-task 4: Run full test suite

---

### [SEC-4] ~~`updateUnstakeCooldownDuration` allows zero cooldown~~
- **Type:** Security Hardening
- **Priority:** ~~P1~~ P2 (downgraded)
- **Status:** ✅ Mitigated (owner-only, no accounting risk)
- **Owner:** N/A
- **Timeline:** N/A
- **Github Link:** N/A

**Resolution:** `updateUnstakeCooldownDuration` is owner-only (DAO multisig). Zero cooldown allows instant unstaking but causes no accounting issues — `requestUnstake` still goes through `_syncFees`, `_settleWithBalance`, cSSV burn, and proper reward settlement. The "stake/vote/unstake" attack described below isn't viable because oracle voting is based on oracle addresses (not staking), and staking weight only affects quorum threshold which is DAO-controlled. Same owner-trust argument as SEC-1/SEC-3.

**Original context (for reference):**
`SSVDAO.sol:245-248`: No minimum check. Zero cooldown allows stake/vote/unstake in one block, defeating the economic security mechanism. An attacker could stake, earn oracle voting rights, manipulate a vote, and immediately unstake.

**Acceptance Criteria:**
- [ ] `updateUnstakeCooldownDuration(0)` reverts
- [ ] A reasonable minimum is enforced (e.g., 1 day = 86400 seconds)
- [ ] Existing tests updated

**Agent Instructions:**
1. Read `contracts/modules/SSVDAO.sol`, focus on `updateUnstakeCooldownDuration` (line 245).
2. Add `if (duration == 0) revert InvalidCooldownDuration();` (define new error in `ISSVNetworkCore.sol` if needed, or reuse an existing generic error).
3. Consider adding a minimum like `if (duration < 86400) revert ...;` for 1-day minimum.
4. Update `test/unit/SSVDAO/updateUnstakeCooldownDuration.test.ts`.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Add minimum cooldown validation
- [ ] Sub-task 2: Update/add unit tests
- [ ] Sub-task 3: Run full test suite

---

### [SEC-5] ~~`totalStaked` changes between oracle votes (front-running risk)~~
- **Type:** Security Hardening
- **Priority:** ~~P1~~ P2 (downgraded)
- **Status:** ✅ Mitigated (impractical)

**Resolution:** Oracles vote 3 times per day across separate blocks. To block quorum, an attacker would need to stake exponentially increasing amounts of SSV between each vote (e.g., 9K → 90K → 900K). This is economically impractical — the attacker's SSV is locked in cooldown, and the capital requirement grows exponentially per blocked commitment. Even if one commitment is blocked, oracles simply propose a new one. Pure liveness attack with no safety impact (can't force bad roots).
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Snapshot `totalStaked` at the start of a voting round (first proposal) and use the snapshotted value for all subsequent votes in that round, preventing front-running via stake/unstake between votes.

**Context:**
`SSVDAO.sol:155-200` (`commitRoot`): Each oracle vote reads `totalStaked` fresh (line 172). Between votes, `totalStaked` can change via stake/unstake. This makes the quorum threshold inconsistent within a single voting round — someone could front-run oracle votes with large stake/unstake operations to either block legitimate quorum or force premature quorum.

**Acceptance Criteria:**
- [ ] `totalStaked` is captured once per voting round and used for all votes in that round
- [ ] Weight calculation and threshold calculation use the same snapshotted value
- [ ] Test: oracle A votes, large stake change, oracle B votes → quorum uses consistent weight

**Agent Instructions:**
1. Read `contracts/modules/SSVDAO.sol`, focus on `commitRoot` (line 155).
2. Read `contracts/libraries/storage/SSVStorageEB.sol` to understand what state is tracked per commitment.
3. Design: Add a `snapshotTotalStaked` field to the commitment state. On first vote for a new commitmentKey, snapshot `totalStaked`. On subsequent votes, use the snapshot instead of re-reading.
4. Store the snapshot in `SSVStorageEB` alongside `commitmentWeight`.
5. When a commitment is finalized (root committed), clean up the snapshot.
6. This is a more involved change — be careful not to break existing oracle voting logic.
7. Run `npm run test:unit` and `npm run test:integration`.

#### Sub-items:
- [ ] Sub-task 1: Add `snapshotTotalStaked` to commitment state in SSVStorageEB
- [ ] Sub-task 2: Snapshot on first vote, use snapshot for subsequent votes
- [ ] Sub-task 3: Clean up snapshot on commitment finalization
- [ ] Sub-task 4: Write tests for consistent weight across votes
- [ ] Sub-task 5: Run full test suite

---

### [SEC-6] Add `nonReentrant` to `migrateClusterToETH`
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add the `nonReentrant` modifier to `migrateClusterToETH` for defense-in-depth. The function calls `CoreLib.transferTokenBalance` (SSV ERC20 transfer) at line 341.

**Context:**
`SSVClusters.sol:264`: While the SSV token is a standard ERC20 without transfer hooks (so reentrancy via token callback is unlikely), adding `nonReentrant` follows the codebase's established pattern for functions that make external calls. State changes happen before the transfer (checks-effects-interactions), but the modifier provides an additional safety layer.

**Acceptance Criteria:**
- [ ] `migrateClusterToETH` has the `nonReentrant` modifier
- [ ] Existing migration tests still pass

**Agent Instructions:**
1. Read `contracts/modules/SSVClusters.sol`, focus on `migrateClusterToETH` (line 264).
2. Add `nonReentrant` modifier to the function signature, following the pattern used by `liquidate`, `withdraw`, etc.
3. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Add `nonReentrant` modifier to `migrateClusterToETH`
- [ ] Sub-task 2: Run full test suite

---

### [SEC-7] Add `nonReentrant` to `onCSSVTransfer`
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add `nonReentrant` modifier to `onCSSVTransfer` for defense-in-depth consistency.

**Context:**
`SSVStaking.sol:169`: The function makes external calls to `ICSSVToken.totalSupply()` and `ICSSVToken.balanceOf()`. While the cSSV token is trusted (deployed by the protocol), the modifier provides protection if cSSV is ever upgraded or replaced. All other staking functions already have `nonReentrant`.

**Acceptance Criteria:**
- [ ] `onCSSVTransfer` has the `nonReentrant` modifier
- [ ] Existing staking tests still pass

**Agent Instructions:**
1. Read `contracts/modules/SSVStaking.sol`, focus on `onCSSVTransfer` (line 169).
2. Add `nonReentrant` modifier. Import `SSVReentrancyGuard` if not already imported.
3. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Add `nonReentrant` modifier to `onCSSVTransfer`
- [ ] Sub-task 2: Run full test suite

---

### [SEC-8] `reactivate` not emitting warning for removed operators
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
When a cluster is reactivated and one or more of its operators have been removed, emit an event indicating which operators are inactive so users and off-chain systems are aware.

**Context:**
`SSVClusters.sol:133-185`: `reactivate` calls `updateClusterOperatorsOnReactivation` (line 151), which skips removed operators at `OperatorLib.sol:311`. The cluster is reactivated with fewer active operators, but no event signals this. Users may not realize their cluster is running with reduced operator coverage.

**Acceptance Criteria:**
- [ ] A new event (e.g., `InactiveOperatorInCluster(uint64 operatorId)`) is emitted for each removed operator during reactivation
- [ ] OR: existing `ClusterReactivated` event includes information about skipped operators
- [ ] Test: reactivate a cluster with a removed operator → verify event emission

**Agent Instructions:**
1. Read `contracts/modules/SSVClusters.sol`, focus on `reactivate` (line 133).
2. Read `contracts/libraries/OperatorLib.sol`, focus on `updateClusterOperatorsOnReactivation` (line 295), particularly the `ethSnapshot.block != 0` check at line 311.
3. Add return data from `updateClusterOperatorsOnReactivation` that indicates which operators were skipped, or emit events directly from the library function.
4. Define the new event in `ISSVClusters.sol`.
5. Add test in `test/unit/SSVClusters/reactivate.test.ts`.
6. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Define and emit inactive operator event
- [ ] Sub-task 2: Write test for reactivation with removed operator event
- [ ] Sub-task 3: Run full test suite

---

### [SEC-9] `operatorMaxFee` function signature differs from DIP-X spec
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)
- **DIP-X Review Source:** ETH Payments review finding ETH-13

**Requirement:**
The DIP-X governance table specifies `updateMaximumOperatorFee(uint64 maxFee)` but the implementation uses `updateMaximumOperatorFee(uint256 maxFee)`. While the `uint256` parameter is more user-friendly (users pass the full wei value, packing handles conversion), the DIP and implementation should be aligned.

**Context:**
`SSVDAO.sol:138`: `function updateMaximumOperatorFee(uint256 maxFee)`. The `uint256` value is packed into `PackedETH` (uint64) internally via `PackedETHLib.pack(maxFee)`. This is a cosmetic interface difference, not a functional issue. The `uint256` parameter prevents users from needing to pre-pack their values. However, ABIs and documentation should be consistent.

**Acceptance Criteria:**
- [ ] Either: DIP-X updated to document `uint256` parameter type (recommended — matches implementation's user-friendly design)
- [ ] Or: implementation changed to `uint64` to match DIP (not recommended — less user-friendly)
- [ ] ABI documentation updated to match

**Agent Instructions:**
1. This is primarily a documentation alignment task.
2. Read `contracts/modules/SSVDAO.sol`, focus on `updateMaximumOperatorFee` (line 138).
3. Read `contracts/interfaces/ISSVDAO.sol` for the interface declaration.
4. Update the DIP-X governance table to specify `uint256` instead of `uint64`.
5. No code change needed if DIP is updated.

#### Sub-items:
- [ ] Sub-task 1: Align DIP-X and implementation on parameter type
- [ ] Sub-task 2: Update ABI documentation

---

### [SEC-10] cSSV token lacks governance/voting extensions (ERC20Votes)
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)
- **DIP-X Review Source:** SSV Staking review finding DIP-10

**Requirement:**
The DIP-X states: "Staked SSV, represented by cSSV, retains full governance and voting power. Holding cSSV does not reduce a user's ability to participate in DAO governance compared to holding unstaked SSV." However, `CSSVToken.sol` is a plain `ERC20` with no `ERC20Votes` or delegation mechanism. Whether governance rights are preserved depends entirely on off-chain configuration (e.g., Snapshot strategy).

**Context:**
`CSSVToken.sol:10`: `contract CSSVToken is ERC20`. No `ERC20Votes`, no `ERC20VotesComp`, no delegation mechanism. The SSV DAO uses Snapshot (off-chain governance), which can be configured to count cSSV balances. If the Snapshot strategy includes cSSV, the DIP claim holds. If on-chain governance is ever needed, cSSV holders would lose voting power compared to SSV holders.

**Acceptance Criteria:**
- [ ] Decision documented: is off-chain governance (Snapshot) the permanent governance mechanism?
- [ ] If yes: verify the Snapshot strategy is updated to include cSSV balances before mainnet launch
- [ ] If on-chain governance is planned: add `ERC20Votes` extension to `CSSVToken`
- [ ] DIP-X updated to clarify governance mechanism (on-chain vs off-chain)

**Agent Instructions:**
1. Read `contracts/token/CSSVToken.sol` fully.
2. This is primarily a governance/product decision, not a pure code fix.
3. If the team confirms Snapshot is the permanent mechanism:
   a. Ensure the Snapshot space strategy counts cSSV
   b. Document this in the DIP and deployment runbook
4. If on-chain governance is needed:
   a. Add `ERC20Votes` to `CSSVToken` inheritance
   b. Override `_afterTokenTransfer` (or `_update` in OZ v5) to call `_transferVotingUnits`
   c. Add `clock()` and `CLOCK_MODE()` overrides
   d. This requires careful upgrade planning since `CSSVToken` is not upgradeable
5. Flag this for team decision before proceeding.

#### Sub-items:
- [ ] Sub-task 1: Get team decision on governance mechanism
- [ ] Sub-task 2: Implement chosen approach (Snapshot config update or ERC20Votes addition)
- [ ] Sub-task 3: Update DIP-X governance section

---

### [SEC-11] ~~`hasDeviation` reactivation optimization uses global counter for per-operator decision~~
- **Type:** Security Hardening
- **Priority:** ~~P1~~ P3 (downgraded)
- **Status:** ✅ Closed (BUG-4 fix resolves root cause)
- **Owner:** N/A
- **Timeline:** N/A
- **Github Link:** N/A

**Resolution:** The only known path to make `daoTotalEthVUnits` wrong was BUG-4 (double-subtraction on liquidated cluster validator removal), which is fixed in PR #429. The optimization is valid when the global counter is accurate. Removing it wouldn't provide a real safeguard — per-operator `operatorEthVUnits` values are updated by the same code paths as the global counter, so if a bug corrupts one, it likely corrupts both.

**Original requirement:**
Replace the global `daoTotalEthVUnits` optimization in `updateClusterOperatorsOnReactivation` with per-operator `operatorEthVUnits` reads.

**Context:**
In `OperatorLib.sol:305`, `bool hasDeviation = sp.daoTotalEthVUnits != uint64(sp.ethDaoValidatorCount) * BPS_DENOMINATOR` uses a global signal for per-operator decisions. While deviations are always non-negative (EB floor=32), this couples correctness to BUG-4's accounting accuracy. If `daoTotalEthVUnits` is ever incorrect (from BUG-4's double-subtraction), reactivation could skip reading actual per-operator deviation, leading to incorrect vUnit accounting.

**Acceptance Criteria:**
- [ ] Reactivation always reads `seb.operatorEthVUnits[operatorId]` instead of relying on the global optimization
- [ ] No behavior change when global and per-operator values are consistent
- [ ] Correct behavior even when BUG-4 causes `daoTotalEthVUnits` to be incorrect
- [ ] Existing reactivation tests pass

**Agent Instructions:**
1. Read `contracts/libraries/OperatorLib.sol`, focus on `updateClusterOperatorsOnReactivation` (line 295), particularly the `hasDeviation` check at line 305.
2. Remove the `hasDeviation` optimization and always read `seb.operatorEthVUnits[operatorId]` for each operator.
3. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Remove global `hasDeviation` optimization, use per-operator reads
- [ ] Sub-task 2: Run full test suite

---

### [SEC-12] `deposit()` accepts deposits to liquidated ETH clusters without fee settlement
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add `validateClusterIsNotLiquidated()` to the ETH `deposit()` function, or document the current behavior as intentional.

**Context:**
In `SSVClusters.sol:190-205`, `deposit()` has no `validateClusterIsNotLiquidated()` check and no fee settlement. Compare with `withdraw()` at line 210 which does both. A user can deposit ETH into a liquidated cluster, but the deposit does not settle fees or reactivate the cluster. The event shows a misleading balance. The user must call `reactivate()` separately to resume the cluster.

**Concrete example:** Cluster liquidated with `balance=0`, user deposits 1 ETH. No fee settlement occurs. Event shows misleading balance. User must call `reactivate()` separately.

**Acceptance Criteria:**
- [ ] Either: `deposit()` reverts on liquidated clusters with `ClusterIsLiquidated()`
- [ ] Or: behavior is explicitly documented as intentional with rationale
- [ ] Test: deposit to liquidated cluster → verify defined behavior

**Agent Instructions:**
1. Read `contracts/modules/SSVClusters.sol`, focus on `deposit` (line 190).
2. Compare with `withdraw()` at line 210 which validates cluster is not liquidated.
3. Add `cluster.validateClusterIsNotLiquidated()` before the balance update.
4. Add a test in `test/unit/SSVClusters/deposit.test.ts` for deposit to liquidated cluster.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Add liquidation check to `deposit()` or document as intentional
- [ ] Sub-task 2: Add test for deposit to liquidated cluster
- [ ] Sub-task 3: Run full test suite

---

### [SEC-13] ~~`OperatorWithdrawn` event doesn't distinguish ETH vs SSV withdrawals~~
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** ✅ Fixed
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** (empty)

**Requirement:**
Keep `OperatorWithdrawn` for ETH withdrawals and introduce a new `OperatorWithdrawnSSV` event for SSV withdrawal earnings. This ensures 3rd-party SDKs and off-chain indexers can correctly track operator earnings by denomination without breaking existing integrations that already listen to `OperatorWithdrawn`.

**Context:**
In `SSVOperators.sol:337-344`, both `_transferOperatorBalanceUnsafe` (ETH) and `_transferOperatorTokenBalanceUnsafe` (SSV) emit the same `OperatorWithdrawn` event. Off-chain indexers (SDK, oracle, dashboard) cannot distinguish between ETH and SSV withdrawal events, making it impossible to correctly calculate total accumulated operator earnings per denomination.

**Decision:**
- `OperatorWithdrawn(operatorId, owner, value)` — **kept as-is**, emitted only by `_transferOperatorBalanceUnsafe` (ETH withdrawals)
- `OperatorWithdrawnSSV(operatorId, owner, value)` — **new event**, emitted only by `_transferOperatorTokenBalanceUnsafe` (SSV withdrawals)

**Resolution:**
`OperatorWithdrawnSSV` event added to `contracts/interfaces/ISSVOperators.sol` with identical signature to `OperatorWithdrawn`. `_transferOperatorTokenBalanceUnsafe` now emits `OperatorWithdrawnSSV`; `_transferOperatorBalanceUnsafe` (ETH) is unchanged. Tests in `withdrawOperatorEarningsSSV.test.ts` updated to assert `OperatorWithdrawnSSV`. `OPERATOR_WITHDRAWN_SSV` constant added to `test/common/events.ts`. All 413 unit tests passing.

**Acceptance Criteria:**
- [x] `OperatorWithdrawnSSV` event defined in `contracts/interfaces/ISSVOperators.sol`
- [x] `_transferOperatorBalanceUnsafe` emits `OperatorWithdrawn` (ETH) — no change
- [x] `_transferOperatorTokenBalanceUnsafe` emits `OperatorWithdrawnSSV` instead of `OperatorWithdrawn`
- [ ] Off-chain indexers and SDK updated to listen to `OperatorWithdrawnSSV` for SSV earnings
- [ ] ABI change impact documented for oracle and SDK clients

#### Sub-items:
- [x] Sub-task 1: Define `OperatorWithdrawnSSV` event in `ISSVOperators.sol`
- [x] Sub-task 2: Update `_transferOperatorTokenBalanceUnsafe` to emit `OperatorWithdrawnSSV`
- [x] Sub-task 3: Update tests for new event signature
- [x] Sub-task 4: Run full test suite

---

### [SEC-14] `commitRoot` accepts `bytes32(0)` as merkleRoot — permanently wastes block slot
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add a zero-root check to `commitRoot` to prevent permanently wasting a block slot with an unusable root.

**Context:**
In `SSVDAO.sol:155`, `commitRoot` accepts `bytes32(0)` as a valid merkle root. The zero root is stored but unusable — `SSVClusters.sol:426` reverts on zero root during `updateClusterBalance`. Meanwhile, `latestCommittedBlock` advances, so the block slot is permanently consumed and cannot be reused.

**Acceptance Criteria:**
- [ ] `commitRoot` reverts with `InvalidRoot()` when `merkleRoot == bytes32(0)`
- [ ] Define `InvalidRoot` error if it doesn't exist
- [ ] Test: commit zero root → expect revert

**Agent Instructions:**
1. Read `contracts/modules/SSVDAO.sol`, focus on `commitRoot` (line 155).
2. Add `if (merkleRoot == bytes32(0)) revert InvalidRoot();` near the top of the function.
3. Define `InvalidRoot` error in `contracts/interfaces/ISSVNetworkCore.sol` if not already defined.
4. Add test in `test/unit/SSVDAO/commitRoot.test.ts`.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Add zero-root validation to `commitRoot`
- [ ] Sub-task 2: Add test for zero-root revert
- [ ] Sub-task 3: Run full test suite

---

### [SEC-15] Min/max operator fee can be set to contradictory values
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add cross-validation between `updateMinimumOperatorEthFee` and `updateMaximumOperatorFee` to prevent contradictory values where `minFee > maxFee`.

**Context:**
In `SSVDAO.sol:138-149`, neither setter cross-validates against the other. If `minFee > maxFee`, no valid non-zero fee exists for operator registration, effectively blocking all new operator registrations and fee changes. While both are owner-only functions, a configuration mistake could cause unexpected operational impact.

**Acceptance Criteria:**
- [ ] `updateMinimumOperatorEthFee` reverts if the new min would exceed current max
- [ ] `updateMaximumOperatorFee` reverts if the new max would be below current min
- [ ] Test: set contradictory min/max → expect revert

**Agent Instructions:**
1. Read `contracts/modules/SSVDAO.sol`, focus on `updateMinimumOperatorEthFee` (line 147) and `updateMaximumOperatorFee` (line 138).
2. In `updateMinimumOperatorEthFee`: add check `if (packed > sp.operatorMaxFeeETH) revert ...;`.
3. In `updateMaximumOperatorFee`: add check `if (packed < sp.operatorMinFeeETH) revert ...;`.
4. Add tests for both cross-validation directions.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Add cross-validation to both fee setters
- [ ] Sub-task 2: Add tests for contradictory fee values
- [ ] Sub-task 3: Run full test suite

---

### [SEC-16] Missing zero-value/zero-address guards on deposit and withdraw
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add zero-value and zero-address guards to deposit and withdraw functions to prevent meaningless transactions.

**Context:**
- `SSVClusters.sol:190` (`deposit`): no zero-address check for `clusterOwner`, no `msg.value > 0` check.
- `SSVClusters.sol:210` (`withdraw`): no zero-amount check.
- `SSVDAO.sol:52` (`withdrawNetworkSSVEarnings`): no zero-amount check.
These allow gas-wasting no-op transactions that emit misleading events with zero values.

**Acceptance Criteria:**
- [ ] `deposit()` reverts when `msg.value == 0`
- [ ] `withdraw()` reverts when `amount == 0`
- [ ] `withdrawNetworkSSVEarnings()` reverts when `amount == 0`
- [ ] Tests added for each zero-value guard

**Agent Instructions:**
1. Read `contracts/modules/SSVClusters.sol`, focus on `deposit` (line 190) and `withdraw` (line 210).
2. Read `contracts/modules/SSVDAO.sol`, focus on `withdrawNetworkSSVEarnings` (line 52).
3. Add `require(msg.value > 0)` to deposit, `require(amount > 0)` to withdraw functions.
4. Add tests for each guard.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Add zero-value guards to deposit and withdraw
- [ ] Sub-task 2: Add tests for zero-value reverts
- [ ] Sub-task 3: Run full test suite

---

### [SEC-16b] ~~Dust ETH stranded in `accrued` after full cSSV transfer + claim~~
- **Type:** Security Hardening
- **Priority:** P1
- **Status:** ✅ Fixed
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
When a user transfers all their cSSV tokens and then calls `claimEthRewards`, a sub-`ETH_DEDUCTED_DIGITS` dust remainder is left in `s.accrued[msg.sender]`. Because the user holds no cSSV, `_settle` will never add to it again, so the dust is permanently unclaimable (any future `claimEthRewards` call hits the `payout == 0` revert). From the user's perspective the UI shows a non-zero claimable balance that can never be withdrawn.

**Context:**
- `SSVStaking.sol:123`: `payout = claimable - (claimable % ETH_DEDUCTED_DIGITS)` — the remainder stays in `accrued`.
- `SSVStaking.sol:139` (original): `s.accrued[msg.sender] = claimable - payout` — remainder is preserved even when the user holds 0 cSSV.
- Reproduction: stake → transfer all cSSV to another address → call `claimEthRewards` → `accrued` contains dust that can never be claimed or grown.

**Fix applied in `SSVStaking.sol:139-140`:**
```solidity
uint256 remainder = claimable - payout;
s.accrued[msg.sender] = (remainder != 0 && ICSSVToken(CSSV_ADDRESS).balanceOf(msg.sender) == 0) ? 0 : remainder;
```
When `balanceOf == 0` and there is dust remainder, it is zeroed rather than preserved. The zeroed wei remains in `stakingEthPoolBalance` and `ethDaoBalance` — it is never deducted from the pool — so it is effectively redistributed to remaining stakers via future `accEthPerShare` increments in `_syncFees`.

**Acceptance Criteria:**
- [x] `claimEthRewards` zeros `accrued` when caller holds 0 cSSV
- [x] After a full transfer + claim, `accrued[user] == 0`
- [x] Test: stake → transfer all cSSV → claim → assert `accrued == 0`
- [x] Test: user with cSSV still keeps remainder (no false positive)

#### Sub-items:
- [x] Sub-task 1: Apply fix in `SSVStaking.sol`
- [x] Sub-task 2: Add regression tests (2 tests in `claimEthRewards.test.ts`)
- [x] Sub-task 3: Run full staking test suite — 64/64 passing

---

### [SEC-17] DAO governance functions lack input guardrails (min/max/non-zero)
- **Type:** Security Hardening
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add input validation guardrails (non-zero, min/max bounds) to all DAO-governed setter functions in `SSVDAO.sol`. Currently most functions accept any value including `0`, which can be harmful to the protocol. While the DAO multisig (5/7) mitigates the risk of accidental misconfiguration, defense-in-depth requires on-chain guardrails.

**⚠️ Action required:** Consult Product/governance team to define the concrete min/max bounds for each parameter before implementation. The table below uses `TBD` placeholders.

**Context:**
`SSVDAO.sol` contains 12 setter functions. Only 2 have any input validation today:
- `updateLiquidationThresholdPeriod` / `updateLiquidationThresholdPeriodSSV`: enforce `>= MINIMAL_LIQUIDATION_THRESHOLD` (21,480 blocks)
- `updateQuorumBps`: enforces `<= BPS_DENOMINATOR` (10,000) — but allows 0 (see SEC-1)

All other setters accept any value, including 0 and extreme values that could break protocol invariants.

**Affected functions and proposed guardrails:**

| # | Function | Parameter | Current guard | Proposed guardrail | Risk if unguarded |
|---|---|---|---|---|---|
| 1 | `updateNetworkFee` | `fee` (wei/block) | None | `fee <= TBD_MAX_NETWORK_FEE` | Extreme fee drains all clusters rapidly |
| 2 | `updateNetworkFeeSSV` | `fee` (SSV/block) | None | `fee <= TBD_MAX_NETWORK_FEE_SSV` | Same as above for SSV clusters |
| 3 | `updateOperatorFeeIncreaseLimit` | `percentage` | None | `percentage > 0 && percentage <= TBD_MAX_INCREASE_LIMIT` | `0` blocks all operator fee increases forever; extreme value allows unlimited fee jumps |
| 4 | `updateDeclareOperatorFeePeriod` | `timeInSeconds` | None | `timeInSeconds >= TBD_MIN_DECLARE_PERIOD && timeInSeconds <= TBD_MAX_DECLARE_PERIOD` | `0` allows instant fee declarations (no review window); extreme value blocks fee changes |
| 5 | `updateExecuteOperatorFeePeriod` | `timeInSeconds` | None | `timeInSeconds >= TBD_MIN_EXECUTE_PERIOD && timeInSeconds <= TBD_MAX_EXECUTE_PERIOD` | `0` allows instant fee execution (no user reaction window); extreme value blocks fee changes |
| 6 | `updateLiquidationThresholdPeriod` | `blocks` | `>= 21,480` ✅ | Add max: `blocks <= TBD_MAX_LIQUIDATION_THRESHOLD` | ✅ Min exists. Extreme max could make liquidation economically unviable |
| 7 | `updateLiquidationThresholdPeriodSSV` | `blocks` | `>= 21,480` ✅ | Add max: `blocks <= TBD_MAX_LIQUIDATION_THRESHOLD_SSV` | Same as above for SSV |
| 8 | `updateMinimumLiquidationCollateral` | `amount` (wei) | None | `amount > 0 && amount <= TBD_MAX_MIN_COLLATERAL` | `0` allows clusters with no safety margin; extreme value blocks cluster creation |
| 9 | `updateMinimumLiquidationCollateralSSV` | `amount` (SSV) | None | `amount > 0 && amount <= TBD_MAX_MIN_COLLATERAL_SSV` | Same as above for SSV |
| 10 | `updateMaximumOperatorFee` | `maxFee` (wei) | None | `maxFee > 0 && maxFee >= sp.minimumOperatorEthFee` | `0` blocks all operator registrations; see also SEC-15 for cross-validation |
| 11 | `updateMinimumOperatorEthFee` | `minFee` (wei) | None | `minFee <= sp.operatorMaxFee` | Extreme value blocks operator registrations; see also SEC-15 for cross-validation |
| 12 | `updateQuorumBps` | `quorum` | `<= 10,000` | Add min: `quorum >= TBD_MIN_QUORUM_BPS` | `0` allows single-oracle root commits; see SEC-1 |
| 13 | `updateUnstakeCooldownDuration` | `duration` | None | `duration >= TBD_MIN_COOLDOWN && duration <= TBD_MAX_COOLDOWN` | `0` allows instant unstaking (no cooldown); see SEC-4 |

**Note:** Items 10-11 overlap with SEC-15, and items 12-13 overlap with SEC-1/SEC-4. Those items can be closed as sub-items of this one, or this item can reference them as "already covered" — team's choice.

**Acceptance Criteria:**
- [ ] Product/governance team provides concrete min/max values for all `TBD` placeholders
- [ ] Each function in the table above has the agreed guardrail implemented
- [ ] Existing guardrails (liquidation threshold min) are preserved
- [ ] Cross-validation between related parameters (min/max operator fee) is enforced
- [ ] All new guards revert with descriptive custom errors
- [ ] Unit tests cover each boundary: at min, at max, below min (revert), above max (revert)
- [ ] Existing tests updated where they set extreme/zero values that now revert
- [ ] No behavioral change for values within the accepted range

**Agent Instructions:**
1. Read `contracts/modules/SSVDAO.sol` fully — all setter functions.
2. Read `contracts/libraries/ProtocolLib.sol` — `updateNetworkFee` and `updateNetworkFeeSSV` delegate here.
3. Read `contracts/libraries/storage/SSVStorageProtocol.sol` for the `StorageProtocol` struct fields.
4. Read `contracts/libraries/storage/SSVStorageStaking.sol` for the `StorageStaking` struct fields.
5. **Wait for Product to fill in `TBD` values before implementing.** If values are not yet defined, implement only the non-zero guards (where `0` is clearly harmful) and add `// TODO: add max bound per SEC-17` comments.
6. Define new custom errors in `contracts/interfaces/ISSVNetworkCore.sol` as needed (e.g., `InvalidParameter()`, `ValueOutOfRange()`).
7. For each function, add the guard at the top before any state changes.
8. Update tests in `test/unit/SSVDAO/` for each modified function.
9. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Get Product sign-off on min/max bounds for all parameters
- [ ] Sub-task 2: Implement non-zero guards for all unguarded setters
- [ ] Sub-task 3: Implement min/max bounds once Product provides values
- [ ] Sub-task 4: Add unit tests for each boundary (at min, at max, below min, above max)
- [ ] Sub-task 5: Reconcile with SEC-1, SEC-4, SEC-15 (close or cross-reference)
- [ ] Sub-task 6: Run full test suite

---

### [SEC-18] ETH-only operators can call `withdrawOperatorEarningsSSV` (no-op but wastes gas)
- **Type:** Security Hardening
- **Priority:** P3
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add an early-exit guard in `withdrawOperatorEarningsSSV` (or its underlying helper) that reverts when called by the owner of an ETH-only operator, preventing a pointless transaction that wastes gas.

**Context:**
Operators registered after the v2.0.0 migration may be ETH-only (`snapshot.block == 0`, `ethSnapshot.block != 0`). New validator registrations for these operators use the ETH payment path exclusively, so they can never accumulate SSV earnings. Despite this, nothing prevents their owner from calling `withdrawOperatorEarningsSSV`. The call will succeed (the SSV balance is 0, so no tokens move), but the user pays gas for a no-op. Echidna invariants already confirm that the accounting system cannot credit SSV earnings to ETH-only operators, so there is no risk of fund loss — this is purely a UX/gas waste issue.

**Acceptance Criteria:**
- [ ] `withdrawOperatorEarningsSSV` reverts with a descriptive error (e.g., `NoSSVEarnings()`) when the operator has `snapshot.block == 0` (ETH-only)
- [ ] ETH-capable operators (both `snapshot.block != 0` and `ethSnapshot.block != 0`) are unaffected
- [ ] Confirm via Echidna that SSV balance of ETH-only operators cannot be artificially inflated

**Agent Instructions:**
1. Read `contracts/modules/SSVOperators.sol`, focus on `withdrawOperatorEarningsSSV` and its internal helper.
2. After the `checkOwner` call, add: `if (operator.snapshot.block == 0) revert NoSSVEarnings();`
3. Define `NoSSVEarnings` error in `contracts/interfaces/ISSVNetworkCore.sol` if not already present.
4. Add a unit test: register an ETH-only operator → call `withdrawOperatorEarningsSSV` → expect revert with `NoSSVEarnings`.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Add ETH-only operator guard to `withdrawOperatorEarningsSSV`
- [ ] Sub-task 2: Define `NoSSVEarnings` custom error
- [ ] Sub-task 3: Add unit test for ETH-only operator calling SSV withdrawal
- [ ] Sub-task 4: Run full test suite

---

### [SEC-19] `minBlocksBetweenUpdates` never initialized — EB update rate limit silently disabled
- **Type:** Security Hardening
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Initialize `minBlocksBetweenUpdates` to a non-zero value during the upgrade, and add a governance setter so it can be adjusted post-deployment.

**Context:**
`StorageEB.minBlocksBetweenUpdates` is a `uint32` in diamond storage. It is read by `_verifyEBUpdateFrequency` to rate-limit how often a cluster's EB can be updated:

```solidity
if (ebSnapshot.lastUpdateBlock != 0 && block.number < ebSnapshot.lastUpdateBlock + seb.minBlocksBetweenUpdates) {
    revert UpdateTooFrequent();
}
```

Because the field is never set — neither in the upgrade initializer nor via any governance function — it defaults to `0`. The condition `block.number < lastUpdateBlock + 0` is always `false`, so the rate limit is **completely inoperative**. Any caller can submit a valid `updateClusterBalance` proof every block for every cluster.

The threat model (`docs/audit/07-trust-boundaries-integrations.md`) explicitly lists this rate limit as a mitigation against forced EB update spam and auto-liquidation attacks. With it disabled, an attacker holding a valid oracle proof of a cluster's reduced EB can trigger auto-liquidation in the same block as a root commitment, with no cooldown.

**Acceptance Criteria:**
- [ ] `minBlocksBetweenUpdates` initialized to a non-zero value in the upgrade reinitializer (suggested: `7200` blocks ≈ 1 day, matching oracle sweep frequency)
- [ ] Governance setter added (e.g. `setMinBlocksBetweenUpdates(uint32)`, owner-only)
- [ ] Setter emits an event (e.g. `MinBlocksBetweenUpdatesUpdated(uint32)`)
- [ ] Unit test: second `updateClusterBalance` within the cooldown window reverts with `UpdateTooFrequent`
- [ ] Unit test: `updateClusterBalance` succeeds after cooldown window passes
- [ ] Governance parameter documented in SPEC.md §11 and FLOWS.md

**Agent Instructions:**
1. In the upgrade reinitializer, add: `SSVStorageEB.load().minBlocksBetweenUpdates = 7200;`
2. Add a governance setter in `SSVDAO.sol` (or equivalent): `function setMinBlocksBetweenUpdates(uint32 blocks) external onlyOwner`.
3. Emit `MinBlocksBetweenUpdatesUpdated(blocks)` from the setter.
4. Add the event to `ISSVNetworkCore.sol` or the DAO interface.
5. Add unit tests covering both the cooldown revert and the post-cooldown success path.
6. Update SPEC.md §11 governance parameters table and FLOWS.md §3.3 preconditions.
7. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Initialize `minBlocksBetweenUpdates` in upgrade reinitializer
- [ ] Sub-task 2: Add governance setter and event
- [ ] Sub-task 3: Unit tests for rate-limit enforcement
- [ ] Sub-task 4: Update SPEC.md and FLOWS.md

---

### [SEC-20] ~~Oracle Quorum Can Be Set to Zero~~
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** ✅ Fixed
- **Owner:** (resolved)
- **Timeline:** 2026-03-16
- **Github Link:** (empty)

**Resolution:**
`updateQuorumBps` now rejects zero quorum: `if (quorum == 0 || quorum > BPS_DENOMINATOR) revert InvalidQuorum()`. This prevents the owner from accidentally disabling the multi-oracle quorum threshold. Updated unit tests to expect revert on `updateQuorumBps(0)` and added a test for the minimum valid quorum of 1 bps.

**Acceptance Criteria:**
- [x] `updateQuorumBps(0)` reverts with `InvalidQuorum()`
- [x] `updateQuorumBps(1)` succeeds (minimum valid quorum)
- [x] Existing tests for `updateQuorumBps` updated to reflect new validation
---

## Unit Test Completeness

### [TEST-1] Validator register/remove with non-zero operator fees
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add unit tests for validator registration and removal with operators that have non-zero ETH fees. Currently ALL SSVValidator tests use operators with `fee=0` (the default), leaving the entire fee settlement mechanism untested.

**Context:**
This is the #1 systemic test gap. The fee settlement mechanism (`updateClusterOperators` / `settleClusterBalance`) during register/remove has zero real coverage with actual fee deductions. If fee settlement is wrong, clusters are overcharged or undercharged on every register/remove. The EB-weighted fee model (`vUnits`) makes this even more critical.

**Acceptance Criteria:**
- [ ] Test: Register validator with 4 operators each charging different ETH fees → verify cluster balance deduction = `blocksDelta * sum(operatorFees) * vUnits / BPS_DENOMINATOR * ETH_DEDUCTED_DIGITS`
- [ ] Test: Register second validator after N blocks → verify fees from first validator settled correctly before adding second
- [ ] Test: Remove validator with non-zero fees → verify operator earnings accumulated match expected
- [ ] Test: Bulk register 10 validators with non-zero fees → verify total deduction
- [ ] All new tests pass

**Agent Instructions:**
1. Read `test/unit/SSVValidator/registerValidator.test.ts` to understand existing patterns and test helpers.
2. Read `test/helpers/contract-helpers.ts` to understand how operators are registered and fees are set. Look for `registerOperator` helper and how `declareOperatorFee` / `executeOperatorFee` work.
3. Read `test/common/constants.ts` for fee-related constants.
4. Create a new test file or add a describe block to existing files. Use the existing `CONFIG` fixture pattern.
5. For each test:
   - Register operators with non-zero ETH fees (use `declareOperatorFee` → advance blocks → `executeOperatorFee`)
   - Register validators
   - Advance blocks with `mine(N)`
   - Perform the operation (register/remove)
   - Calculate expected fees independently: `blocksDelta * sum(PackedETH.unwrap(fee)) * vUnits / BPS_DENOMINATOR * ETH_DEDUCTED_DIGITS`
   - Assert cluster balance = initial deposit - expected fees
   - Assert operator earnings match expected accumulation
6. Use `ethers.provider.getBalance` for ETH balance checks and the SSVViews contract for cluster/operator balance queries.
7. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Register validator with non-zero operator fees — verify cluster balance deduction
- [ ] Sub-task 2: Sequential validator registration with fee settlement verification
- [ ] Sub-task 3: Remove validator with non-zero fees — verify operator earnings
- [ ] Sub-task 4: Bulk register with non-zero fees — verify total deduction

---

### [TEST-2] ~~EB-weighted operator earnings accumulation~~
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** ✅ Closed
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add unit tests verifying that operators earn proportionally more when serving clusters with higher effective balance. The EB settlement tests check fee deductions from the cluster side but don't verify operator earnings.

**Context:**
The vUnit model is the core economic change in v2.0.0. If operator earnings don't scale with EB, the entire incentive model is broken. No unit test currently verifies the operator earnings side of EB-weighted accounting.

**Acceptance Criteria:**
- [ ] Test: Operator serves two clusters, EB=32 and EB=64 → after N blocks, verify operator earnings = `(blocks * fee * 10000 + blocks * fee * 20000) / BPS_DENOMINATOR * ETH_DEDUCTED_DIGITS`
- [ ] Test: Operator fee change after EB update → verify earnings split correctly at boundary
- [ ] Test: `withdrawOperatorEarnings` after EB-weighted accrual → verify exact ETH withdrawn matches expected

**Agent Instructions:**
1. Read `test/unit/SSVClusters/ebSettlement.test.ts` to understand EB test patterns.
2. Read `test/unit/SSVOperators/withdrawOperatorEarnings.test.ts` for withdrawal test patterns.
3. Read `contracts/libraries/OperatorLib.sol`, focus on `updateSnapshot` to understand how operator earnings accumulate with vUnits.
4. Create tests that:
   - Register an operator
   - Create two clusters with different EBs (use `updateClusterBalance` with Merkle proofs to set EB)
   - Advance blocks
   - Verify operator earnings via `SSVViews.getOperatorEarnings(operatorId)`
   - Withdraw and verify exact ETH amount
5. Use the Merkle proof helpers in `test/helpers/` to create valid proofs for EB updates.
6. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Operator earning from two clusters with different EBs
- [ ] Sub-task 2: Operator fee change boundary with EB-weighted clusters
- [ ] Sub-task 3: Withdraw operator earnings after EB-weighted accrual

---

### [TEST-3] Balance delta assertions in liquidation paths
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add balance delta assertions to liquidation tests. Current tests check events and state transitions but do not assert actual ETH/SSV token transfer amounts.

**Context:**
A liquidation could emit the correct event but transfer the wrong amount (or nothing). Without balance delta assertions, incorrect transfer logic is invisible to the test suite.

**Acceptance Criteria:**
- [ ] Test: Liquidate ETH cluster → assert `liquidator.balance.after - liquidator.balance.before == cluster.remainingBalance` (accounting for gas)
- [ ] Test: Liquidate SSV cluster → assert `SSVToken.balanceOf(liquidator).after - before == cluster.remainingSSVBalance`
- [ ] Test: Liquidate cluster with 0 remaining balance → assert no ETH transferred
- [ ] Test: Self-liquidation → assert owner receives remaining balance

**Agent Instructions:**
1. Read `test/unit/SSVClusters/liquidate.test.ts` and `test/unit/SSVClusters/liquidateSSV.test.ts`.
2. Add balance capture before/after each liquidation call:
   ```typescript
   const balanceBefore = await ethers.provider.getBalance(liquidator.address);
   const tx = await ssvNetwork.connect(liquidator).liquidate(...);
   const receipt = await tx.wait();
   const gasCost = receipt.gasUsed * receipt.gasPrice;
   const balanceAfter = await ethers.provider.getBalance(liquidator.address);
   expect(balanceAfter - balanceBefore + gasCost).to.equal(expectedReward);
   ```
3. For SSV token liquidations, use `SSVToken.balanceOf()` instead of native balance.
4. Calculate expected remaining balance independently using the cluster balance formula.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: ETH liquidation balance delta assertions
- [ ] Sub-task 2: SSV liquidation balance delta assertions
- [ ] Sub-task 3: Zero-balance liquidation
- [ ] Sub-task 4: Self-liquidation balance check

---

### [TEST-4] ~~`updateClusterBalance` on liquidated clusters~~
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** ✅ **CLOSED**
- **Owner:** PR #447 + enhancements
- **Timeline:** Completed 2026-02-25
- **Github Link:** [test/unit/SSVClusters/updateClusterBalance.test.ts](../test/unit/SSVClusters/updateClusterBalance.test.ts) (lines 293-653), [test/integration/SSVNetwork/clusters.test.ts](../test/integration/SSVNetwork/clusters.test.ts) (lines 753-817)

**Requirement:**
Add tests for calling `updateClusterBalance` (EB oracle update) on an already-liquidated cluster.

**Context:**
No test exists for this path. If the contract doesn't handle it, oracle updates on liquidated clusters could corrupt accounting or revert unexpectedly.

**Acceptance Criteria:**
- [x] Test: Call `updateClusterBalance` with valid proof on a liquidated cluster → verify defined behavior (revert or update EB without settling fees)
- [x] Test: EB update that makes a liquidated cluster even more insolvent → verify no state corruption
- [x] **BONUS**: Multi-validator liquidated cluster EB update
- [x] **BONUS**: EB decrease on liquidated cluster (penalty scenario)
- [x] **BONUS**: Liquidated cluster with implicit EB → first EB update transitions to explicit tracking

**Implementation Summary:**
1. **Unit tests** ([updateClusterBalance.test.ts](../test/unit/SSVClusters/updateClusterBalance.test.ts)):
   - Line 293-337: Basic liquidated cluster EB update — verifies EB snapshot updated, cluster stays inactive, no fee settlement
   - Line 339-416: EB increase on insolvent liquidated cluster — verifies no operator/DAO vUnit corruption
   - Line 463-527: **NEW** Multi-validator liquidated cluster EB update
   - Line 529-602: **NEW** EB decrease on liquidated cluster (penalty scenario)
   - Line 604-653: **NEW** Implicit→explicit EB transition on liquidated cluster

2. **Integration test** ([clusters.test.ts](../test/integration/SSVNetwork/clusters.test.ts)):
   - Line 753-817: E2E flow with oracle quorum setup and multiple EB updates on liquidated cluster

3. **Additional improvements**:
   - Fixed loose comparators in integration tests — now uses exact formula-based assertions per SSV standards
   - Added block number tracking for precise fee calculations
   - All tests passing with 100% exact `.to.equal()` assertions

#### Sub-items:
- [x] Sub-task 1: `updateClusterBalance` on liquidated cluster — basic behavior
- [x] Sub-task 2: EB increase on already-insolvent liquidated cluster
- [x] Sub-task 3: Multi-validator liquidated cluster EB update
- [x] Sub-task 4: EB decrease on liquidated cluster
- [x] Sub-task 5: Implicit→explicit EB transition

---

### [TEST-5] Oracle quorum edge cases
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add comprehensive edge case tests for the oracle quorum mechanism in `commitRoot`.

**Context:**
Only basic quorum tests exist. Missing: boundary conditions, weight manipulation, oracle replacement during voting, quorum parameter changes mid-vote.

**Acceptance Criteria:**
- [ ] Test: Quorum at exactly 100% — all 4 oracles must vote
- [ ] Test: Quorum at 1 bps — single oracle vote commits
- [ ] Test: Oracle replaced between proposing and committing — verify vote behavior
- [ ] Test: Quorum changed between votes — verify consistent threshold
- [ ] Test: Oracles propose different roots for same block number — verify correct root wins

**Agent Instructions:**
1. Read `test/unit/SSVDAO/commitRoot.test.ts` for existing patterns.
2. Read `contracts/modules/SSVDAO.sol`, focus on `commitRoot` (line 155) for the voting/quorum logic.
3. Add tests for each scenario. For oracle replacement mid-vote, call `replaceOracle` between two `commitRoot` calls for the same block number.
4. Use `updateQuorumBps` to set boundary values before testing.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: 100% quorum boundary test
- [ ] Sub-task 2: Minimal quorum (1 bps) test
- [ ] Sub-task 3: Oracle replacement mid-vote
- [ ] Sub-task 4: Quorum change mid-vote
- [ ] Sub-task 5: Conflicting root proposals

---

### [TEST-6] EB decrease scenarios
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add unit tests for effective balance decreases. All current EB tests only cover increases (32→higher). Validators can have EB decrease due to penalties.

**Context:**
If EB decreases aren't handled correctly, vUnits could be wrong, operators could be overpaid, or liquidation thresholds could be miscalculated. EB decrease is a completely untested code path.

**Acceptance Criteria:**
- [ ] Test: EB decrease from 64 ETH to 32 ETH → verify vUnits decrease, operator fees decrease, liquidation threshold recalculated
- [ ] Test: EB decrease below 32 ETH → should revert with `EBBelowMinimum`
- [ ] Test: EB decrease while cluster is near liquidation threshold → verify decrease triggers liquidation if below threshold
- [ ] Test: Operator deviation negative after EB decrease → verify `daoTotalEthVUnits` updated correctly

**Agent Instructions:**
1. Read `test/unit/SSVClusters/ebSettlement.test.ts` and `test/unit/SSVClusters/updateClusterBalance.test.ts`.
2. Create test scenarios where EB starts high and is updated to a lower value via `updateClusterBalance` with a Merkle proof for the lower EB.
3. Use the Merkle tree helpers to generate proofs for decreased EB values.
4. Verify vUnits, deviation, burn rate, and liquidation threshold after decrease.
5. For the below-32-ETH case, verify the contract reverts with the correct error.
6. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: EB decrease from 64→32 ETH — vUnits and fee verification
- [ ] Sub-task 2: EB below minimum (< 32 ETH) — revert test
- [ ] Sub-task 3: EB decrease triggering liquidation
- [ ] Sub-task 4: Negative deviation after EB decrease

---

### [TEST-7] Reentrancy in staking functions
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** ✅ Complete
- **Owner:** Claude
- **Timeline:** 2026-02-26
- **Github Link:** PR #452

**Requirement:**
Add reentrancy tests for SSVStaking functions that transfer ETH or tokens. These functions are marked `nonReentrant` but no test verifies the protection works.

**Context:**
`claimEthRewards`, `withdrawUnlocked`, `stake`, `requestUnstake` all handle ETH or SSV token transfers. Reentrancy via a `receive()` hook could theoretically drain rewards. The `nonReentrant` modifier should prevent this, but it's untested. The existing SSVOperators reentrancy test (`test/unit/SSVOperators/reentrancy.test.ts`) can serve as a pattern.

**Acceptance Criteria:**
- [x] Test: Attacker contract with `receive()` hook calls `claimEthRewards` reentrantly → verify reverts
- [x] ~~Test: Attacker calls `withdrawUnlocked` reentrantly during SSV token transfer~~ → **NOT NEEDED** (see resolution)
- [x] All reentrancy tests use a custom attacker contract deployed in the test

**Resolution:**
✅ **`claimEthRewards` reentrancy test implemented:**
- Unit test: `test/unit/SSVStaking/reentrancy.test.ts`
- Integration test: `test/integration/SSVNetwork.test.ts` (line 3414-3447)
- Attacker contract: `contracts/test/mocks/MaliciousClaimEthRewards.sol`
- **This is a valid attack vector** because `claimEthRewards()` sends ETH which triggers `receive()` hooks

❌ **`withdrawUnlocked`, `stake`, `requestUnstake` reentrancy tests NOT needed:**
- **Reason:** SSVToken (`contracts/token/SSVToken.sol`) is a standard ERC20 with **no callbacks**
- Standard ERC20 `transfer()` and `transferFrom()` do **not** call back to the recipient
- **No `receive()` hook is triggered** during token transfers
- **Reentrancy is impossible** during these operations in production
- The `nonReentrant` modifiers on these functions are **defensive programming** but protect against **no real attack vector**
- A reentrancy test would require a malicious token contract, which doesn't match the production SSVToken implementation

**Conclusion:**
Only `claimEthRewards()` has a real reentrancy attack surface (ETH transfers trigger `receive()` hooks). The function is properly protected and tested. Other staking functions interact only with standard ERC20 tokens (SSV, cSSV) which have no callback mechanisms.

#### Sub-items:
- [x] Sub-task 1: `claimEthRewards` reentrancy test ✅
- [x] Sub-task 2: `withdrawUnlocked` reentrancy test → **Not needed** (no attack vector)

---

### [TEST-8] Forbid creating clusters with removed operators
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add explicit tests for PR #410 (forbid creating clusters with removed operators). Verify both `registerValidator` and `bulkRegisterValidator` revert when given a removed operator ID.

**Context:**
PR #410 added a fix but no explicit test exists for this scenario. Creating clusters with removed operators would result in stuck funds with no one to service the validator.

**Acceptance Criteria:**
- [ ] Test: Register validator using operatorIds where one operator was previously removed → should revert
- [ ] Test: Bulk register where one of the operator IDs belongs to a removed operator → should revert

**Agent Instructions:**
1. Read `test/unit/SSVValidator/registerValidator.test.ts` and `test/unit/SSVValidator/bulkRegisterValidator.test.ts`.
2. Add a test that: registers 4 operators, removes one, then tries to register a validator with all 4 operator IDs → expect revert.
3. Add the same for bulk registration.
4. Identify the specific error that the contract reverts with (likely `OperatorDoesNotExist` — check `contracts/libraries/OperatorLib.sol`).
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: `registerValidator` with removed operator → revert test
- [ ] Sub-task 2: `bulkRegisterValidator` with removed operator → revert test

---

### [TEST-9] ~~Migration balance accounting verification~~
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** ✅ Done
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests that verify exact SSV refund amounts and ETH deposit amounts during migration, calculated independently from contract logic.

**Context:**
Migration tests verify events and state but don't verify exact token transfer amounts against independently calculated values.

**Acceptance Criteria:**
- [x] Test: Migrate after 1000 blocks → verify SSV refund = `initial_deposit - (blocks * sum(ssv_fees) * validatorCount) * DEDUCTED_DIGITS`
- [x] Test: Migrate with partial SSV balance remaining → verify exact token transfer amount
- [x] Test: Migrate cluster where operators have both SSV and ETH fees set → verify ETH side correctly initialized

**Agent Instructions:**
1. Read `test/unit/SSVClusters/migrateClusterToETH.test.ts` for existing patterns.
2. Add independent balance calculations using JavaScript BigInt arithmetic matching the contract's formula.
3. Assert `SSVToken.balanceOf(owner).after - SSVToken.balanceOf(owner).before == expectedRefund`.
4. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: Exact SSV refund after N blocks
- [x] Sub-task 2: Migration with partial balance
- [x] Sub-task 3: Migration with dual SSV/ETH fees

---

### [TEST-10] ~~Operator fee change + EB burn rate interaction~~
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** ✅ Done
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests combining operator fee changes (declare/execute/reduce) with EB-weighted clusters.

**Context:**
No tests combine operator fee changes with EB-weighted clusters. The burn rate depends on both operator fee and vUnits, and fee changes must properly settle the old rate before applying the new one.

**Acceptance Criteria:**
- [x] Test: Operator increases fee while serving EB=64 cluster → verify burn rate doubles
- [x] Test: Operator reduces fee with EB-weighted cluster → verify savings reflected
- [x] Test: Fee execution changes mid-block for EB-weighted cluster → verify boundary accounting

**Agent Instructions:**
1. Read `test/unit/SSVOperators/declareOperatorFee.test.ts` and `test/unit/SSVOperators/executeOperatorFee.test.ts`.
2. Read `test/unit/SSVClusters/ebSettlement.test.ts`.
3. Create combined tests: register operator with fee, create cluster with EB, change fee, verify cluster balance reflects correct burn rate split.
4. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: Fee increase with EB-weighted cluster
- [x] Sub-task 2: Fee reduction with EB-weighted cluster
- [x] Sub-task 3: Fee change boundary accounting

---

### [TEST-11] Network fee update impact on active clusters
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** ✅ Done
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests verifying that `updateNetworkFee` changes the actual burn rate for existing active clusters.

**Context:**
DAO parameter tests verify storage changes but not enforcement on active clusters.

**Acceptance Criteria:**
- [x] Test: Increase ETH network fee with active ETH cluster → verify cluster burns faster
- [x] Test: Decrease ETH network fee → verify cluster burn rate decreases
- [x] Test: Update network fee with EB-weighted cluster → verify vUnit scaling applied

**Agent Instructions:**
1. Read `test/unit/SSVDAO/updateNetworkFee.test.ts`.
2. Create cluster, advance blocks, check balance, then update network fee, advance more blocks, check balance again.
3. Verify the balance difference in each period matches the respective fee rates.
4. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: Network fee increase enforcement
- [x] Sub-task 2: Network fee decrease enforcement
- [x] Sub-task 3: Network fee with EB scaling

---

### [TEST-12] Multi-staker reward fairness
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** ✅ Done
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add comprehensive multi-staker scenarios testing proportional reward distribution and cSSV transfer settlement.

**Context:**
`onCSSVTransfer` has only 2 tests. Staking integration tests have basic proportional distribution but don't test complex scenarios with multiple stakers entering/exiting at different times or transferring cSSV.

**Acceptance Criteria:**
- [x] Test: 3 stakers with different amounts → each receives exactly proportional rewards
- [x] Test: Staker A stakes, rewards accrue, staker B stakes → A gets both periods, B gets only second
- [x] Test: cSSV transfer from A to B → verify reward settlement for both, B earns at higher rate
- [x] Test: Sequential cSSV transfers A→B→C → verify accumulated rewards at each step

**Agent Instructions:**
1. Read `test/unit/SSVStaking/claimEthRewards.test.ts` and `test/unit/SSVStaking/onCSSVTransfer.test.ts`.
2. Read `test/integration/SSVNetwork/staking.test.ts` for integration patterns.
3. Use the `accEthPerShare` formula: `pendingReward = cSSVBalance * (accEthPerShare - userIndex) / 1e18`.
4. Calculate expected rewards independently and assert exact values (accounting for precision loss).
5. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: Three-staker proportional distribution
- [x] Sub-task 2: Time-weighted staking (A early, B late)
- [x] Sub-task 3: cSSV transfer settlement
- [x] Sub-task 4: Sequential cSSV transfer chain

---

### [TEST-13] Liquidation + reactivation multi-cycle accounting
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** ✅ Done
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests for multiple liquidation/reactivation cycles to verify no accounting drift accumulates.

**Context:**
Only single liquidation/reactivation cycles are tested. Over multiple cycles, rounding errors or state leakage could accumulate.

**Acceptance Criteria:**
- [x] Test: Liquidate → reactivate → operate → liquidate → reactivate → verify cumulative balances, no drift
- [x] Test: Operator earnings across multiple liquidation cycles → verify no double-counting

**Agent Instructions:**
1. Read `test/unit/SSVClusters/liquidate.test.ts` and `test/unit/SSVClusters/reactivate.test.ts`.
2. Create a test that performs 3+ full cycles: deposit → advance blocks → liquidate → reactivate with deposit → repeat.
3. Track operator earnings and cluster balance at each step, verify consistency.
4. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: Multi-cycle liquidation/reactivation accounting
- [x] Sub-task 2: Operator earnings across cycles

---

### [TEST-14] Reactivation with EB deviation solvency check
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** ✅ Done
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Test that reactivation solvency checks account for EB-weighted burn rate.

**Context:**
Reactivate tests don't verify that the minimum deposit scales with vUnits. A cluster with EB=2048 has 64x the burn rate and should require a proportionally higher deposit.

**Acceptance Criteria:**
- [x] Test: Reactivate cluster with EB=64 → verify minimum deposit requirement scales with 2x vUnits
- [x] Test: Reactivate with EB=2048 → verify high deposit requirement enforced

**Agent Instructions:**
1. Read `test/unit/SSVClusters/reactivate.test.ts`.
2. Create clusters with different EBs, liquidate them, then try to reactivate with minimal deposits.
3. Verify that insufficient deposits for high-EB clusters revert.
4. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: Reactivation solvency with EB=64
- [x] Sub-task 2: Reactivation solvency with EB=2048

---

### [TEST-15] SSV cluster operations completeness
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add comprehensive tests for SSV-denominated cluster operations. Most tests focus on ETH clusters, leaving SSV cluster paths undertested.

**Context:**
The dual cluster system maintains parallel SSV and ETH records. SSV cluster operations should still work correctly during the transition period.

**Acceptance Criteria:**
- [ ] Test: Register/remove validators in SSV cluster with non-zero SSV fees → verify fee deductions
- [ ] Test: SSV cluster with non-zero network fee → verify fee deductions
- [ ] Test: Withdraw from SSV cluster → verify balance and token transfer

**Agent Instructions:**
1. Read existing SSV-related tests: `test/unit/SSVClusters/liquidateSSV.test.ts`, `test/integration/SSVNetwork/legacy-ssv.test.ts`.
2. Create tests that operate entirely in the SSV version (VERSION_SSV = 0).
3. Set non-zero SSV fees on operators before creating clusters.
4. Verify SSV token balance changes match expected fee deductions.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: SSV validator registration with fees
- [ ] Sub-task 2: SSV cluster network fee deductions
- [ ] Sub-task 3: SSV cluster withdrawal

---

### [TEST-16] View function coverage (SSVViews)
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** ✅ Fixed
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add dedicated unit tests for SSVViews functions. Currently view functions are tested only indirectly.

**Context:**
No dedicated unit test file exists for SSVViews. Functions like `getBalance`, `isLiquidatable`, `getBurnRate`, `getOperatorEarnings` are used as helpers in other tests but their correctness is never directly asserted.

**Acceptance Criteria:**
- [x] Test: `getBalance` / `getEffectiveBalance` return correct values for active ETH clusters
- [x] Test: liquidated cluster view behavior is validated (`isLiquidated` true; `getBalance` / `getEffectiveBalance` revert)
- [x] Test: `isLiquidatable` at exact boundary returns correct boolean
- [x] Test: `getBurnRate` with EB-weighted cluster scales with vUnits
- [x] Test: `getOperatorEarnings` dual-version behavior is validated in ETH-only state (`ETH > 0`, `SSV == 0`)
- [x] Test: ETH-only (migration-equivalent) views return expected split (`SSV` views return 0, `ETH` views return correct values)

**Agent Instructions:**
1. Read `contracts/modules/SSVViews.sol` to understand all view functions.
2. Create `test/unit/SSVViews/views.test.ts` (or similar) following existing test patterns.
3. Set up various cluster states (active, liquidated, migrated) and verify view function return values.
4. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: `getBalance` basic and edge cases
- [x] Sub-task 2: `isLiquidatable` boundary tests
- [x] Sub-task 3: `getBurnRate` with EB
- [x] Sub-task 4: `getOperatorEarnings` dual-version
- [x] Sub-task 5: View functions after migration

---

### [TEST-17] Staking rewards from EB-weighted cluster fees
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Closed
- **Owner:** (unassigned)
- **Timeline:** 2026-03-02
- **Github Link:** (empty)

**Requirement:**
Test that EB-weighted clusters produce proportionally more staking rewards via the network fee.

**Context:**
Staking integration tests use basic network fees but don't verify that higher-EB clusters contribute proportionally more to the staking pool.

**Acceptance Criteria:**
- [x] Test: Cluster with EB=64 generates 2x network fees vs EB=32 → verify staking pool receives 2x rewards
- [x] Test: Multiple clusters with different EBs → verify cumulative staking rewards match sum of EB-weighted network fees

**Agent Instructions:**
1. Read `test/integration/SSVNetwork/staking.test.ts`.
2. Create two clusters with different EBs, advance blocks, sync fees, verify `accEthPerShare` increment matches EB-weighted expectation.
3. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: EB=64 vs EB=32 staking reward comparison
- [x] Sub-task 2: Multi-cluster cumulative staking rewards

---

### [TEST-18] `withdrawNetworkETHEarnings` (DAO ETH withdrawal)
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add unit tests for DAO ETH earnings withdrawal. Only SSV DAO withdrawal (`withdrawNetworkSSVEarnings`) is currently tested.

**Context:**
There is no test for `withdrawNetworkETHEarnings`. The function should exist for withdrawing accumulated ETH network fees.

**Acceptance Criteria:**
- [ ] Test: Withdraw ETH network earnings → verify balance, event, access control
- [ ] Test: Withdraw more than available → verify revert
- [ ] Test: Withdraw after multiple clusters accrue fees → verify cumulative amount

**Agent Instructions:**
1. Read `test/unit/SSVDAO/withdrawNetworkSSVEarnings.test.ts` for the SSV withdrawal pattern.
2. Search for `withdrawNetworkETHEarnings` or similar function in `contracts/modules/SSVDAO.sol`.
3. Create equivalent tests for the ETH version.
4. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Basic ETH withdrawal test
- [ ] Sub-task 2: Over-withdrawal revert test
- [ ] Sub-task 3: Cumulative multi-cluster accrual test

---

### [TEST-19] Operator removal impact on active ETH clusters
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** ✅ Complete
- **Owner:** (unassigned)
- **Timeline:** 2026-02-26
- **Github Link:** (empty)

**Requirement:**
Test the impact of operator removal on active ETH clusters' fee calculations.

**Context:**
`removeOperator` tests don't test the downstream effect on active ETH clusters' fee calculations.

**Acceptance Criteria:**
- [x] Test: Remove operator from set of 4 while cluster has active validators → verify fee calculation excludes removed operator
- [x] Test: Verify removed operator stops earning from both ETH and SSV clusters

**Resolution:**
- Added `/Users/venimir/Desktop/ssv/contracts-latest/ssv-network/test/unit/SSVClusters/removedOperatorImpact.test.ts` with coverage for:
  - ETH cluster settlement after removed-operator simulation (fee deduction excludes removed operator; removed operator ETH earnings frozen)
  - SSV cluster settlement via `liquidateSSV` (removed operator SSV earnings frozen while active operators continue earning)
- Aligned `/Users/venimir/Desktop/ssv/contracts-latest/ssv-network/contracts/test/harness/SSVClustersHarness.sol` `mockRemoveOperator()` with real `removeOperator` reset semantics (preserve snapshot indices, clear blocks/balances/fees/counts) so downstream accounting tests model production behavior.
- Verified with `npx hardhat test test/unit/SSVClusters/removedOperatorImpact.test.ts` and `npm run test:unit` (`405 passing`).

**Agent Instructions:**
1. Read `test/unit/SSVOperators/removeOperator.test.ts`.
2. Read `test/sanity/removed-operator.test.ts` for the existing removed operator scenario.
3. Create a cluster with 4 operators, remove one, advance blocks, verify cluster balance only decreases by 3 operators' fees.
4. Verify the removed operator's earnings are frozen (no new earnings after removal).
5. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: Fee calculation after operator removal
- [x] Sub-task 2: Removed operator earnings freeze

---

### [TEST-19a] Operator removal impact on active ETH clusters
1. Multiple Removed Operators
// Missing test:
it("handles multiple removed operators (2 of 4) correctly", async () => {
  // Remove operators[1] and operators[3]
  // Verify only operators[0] and operators[2] accrue earnings
  // Verify cluster balance reflects 2 operators only
});
2. EB-Weighted Cluster with Removed Operator
// Missing test:
it("excludes removed operator vUnits from EB-weighted fee calculation", async () => {
  // Set cluster EB to 64 ETH (2x vUnits)
  // Remove one operator
  // Verify active operators earn fees scaled by 2x vUnits
  // Verify removed operator's vUnits are excluded
});
3. Reactivation with Removed Operator
// Missing test:
it("reactivation excludes removed operator from fee calculation", async () => {
  // Create cluster with 4 operators
  // Remove operator[2]
  // Liquidate cluster
  // Reactivate cluster (FLOWS.md notes this skips removed operators)
  // Verify reactivation fee calculation uses 3 operators only
});
4. Operator Removal During Validator Lifecycle
// Missing test:
it("handles operator removal between register and remove validator", async () => {
  // Register 2 validators with 4 operators
  // Advance 100 blocks
  // Remove operator[1]
  // Advance 100 blocks
  // Remove 1 validator
  // Verify fees split correctly across 2 periods
});
5. All Operators Removed
// Missing test:
it("handles cluster with all operators removed", async () => {
  // Remove all 4 operators one by one
  // Attempt cluster operations
  // Verify correct reverts or handling
});
6. Network Fee Impact
// Missing test:
it("network fees continue accruing after operator removal", async () => {
  // Don't zero network fee
  // Remove operator
  // Verify cluster balance includes network fees + (3 operator fees)
  // Verify DAO balance increases correctly
});
7. Removed Operator Fee Withdrawal
// Missing test:
it("removed operator can withdraw frozen earnings", async () => {
  // Accrue earnings for operator
  // Remove operator
  // Verify operator can still withdraw frozen balance
  // Verify no new earnings after withdrawal
});

---


### [TEST-20] ~~Cooldown duration changes affecting pending requests~~
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** ✅ Closed
- **Owner:** (resolved)
- **Timeline:** 2026-03-03
- **Github Link:** (empty)

**Requirement:**
Test how changes to `cooldownDuration` affect pending unstake withdrawal requests.

**Context:**
`updateUnstakeCooldownDuration` is tested for storage but not for impact on existing pending requests.

**Resolution:**
Added direct coverage for cooldown-change behavior on existing pending unstake requests in staking unit tests:
- cooldown reduction after request creation does not unlock existing request early
- cooldown increase after request creation preserves original unlock time

This matches the `test(staking): cover cooldown updates on pending unstake requests` change and validates that `unlockTime` is fixed at request creation.

**Acceptance Criteria:**
- [x] Test: User requests unstake, DAO reduces cooldown → can user withdraw earlier?
- [x] Test: User requests unstake, DAO increases cooldown → does user's original unlock time hold?

**Agent Instructions:**
1. Read `test/unit/SSVStaking/requestUnstake.test.ts` and `test/unit/SSVStaking/withdrawUnlocked.test.ts`.
2. Read `contracts/modules/SSVStaking.sol` to understand how `unlockTime` is stored (is it absolute timestamp or relative?).
3. Create tests: stake → request unstake → change cooldown → attempt withdraw → verify behavior.
4. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: Cooldown reduction — earlier withdrawal test
- [x] Sub-task 2: Cooldown increase — original unlock time test

---

### [TEST-21] ~~EB boundary values (min/max per validator)~~
- **Type:** Unit Test Completeness
- **Priority:** P2
- **Status:** ✅ Closed
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** (empty)

**Requirement:**
Add boundary tests for EB values at minimum (32 ETH) and maximum (2048 ETH) per validator.

**Context:**
Limited boundary testing exists. The sanity tests cover conversions but not the full cluster accounting at boundaries.

**Resolution:**
All three boundary cases are covered in `test/unit/SSVClusters/updateClusterBalance.test.ts`:
- EB=32 baseline (10000 vUnits): pre-existing test "Updates cluster balance when proof is valid"
- EB=2049 revert: pre-existing test "Is reverted with 'EBExceedsMaximum' when effective balance exceeds 2048 ETH per validator"
- EB=2048 max (640000 vUnits): new test with full vUnit/deviation/DAO accounting assertions
- EB=4096 max for 2-validator cluster (1,280,000 vUnits): new test with per-operator deviation assertions
- EB=4097 revert for 2-validator cluster: new multi-validator max-exceeded test

**Acceptance Criteria:**
- [x] Test: EB exactly 32 ETH per validator (10000 vUnits) — baseline behavior
- [x] Test: EB exactly 2048 ETH per validator (640000 vUnits) — max behavior
- [x] Test: EB at 2049 per validator — verify revert

#### Sub-items:
- [x] Sub-task 1: EB=32 baseline test
- [x] Sub-task 2: EB=2048 maximum test
- [x] Sub-task 3: EB>2048 revert test

---

### [TEST-22] ~~Dust/precision edge cases~~
- **Type:** Unit Test Completeness
- **Priority:** P2
- **Status:** ✅ Closed
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add precision edge case tests for packed type boundaries and tiny values.

**Acceptance Criteria:**
- [x] Test: Withdraw amount of exactly 1 * ETH_DEDUCTED_DIGITS (minimum non-zero)
- [x] Test: Cluster balance that rounds to 0 after fee deduction
- [x] Test: Operator earnings of exactly 1 packed unit — verify withdrawable
- [x] Test: accEthPerShare with tiny fee and large totalStaked — verify no rounding to zero

**Resolution:**
4 tests added across 3 files (416 total, all passing):
- `test/unit/SSVOperators/withdrawOperatorEarnings.test.ts` — "Withdraws exactly 1 * ETH_DEDUCTED_DIGITS (minimum non-zero precision unit) and zeroes balance" (covers criteria 1 & 3)
- `test/unit/SSVClusters/withdraw.test.ts` — "Cluster balance becomes 0 when accumulated fees exceed the remaining balance (no underflow)" (criteria 2)
- `test/unit/SSVStaking/syncFees.test.ts` — "Produces non-zero accEthPerShare update with minimum possible fee (1 packed unit) and standard stake" (criteria 4; verifies `accDelta = 10_000 > 0` for `newFees = 1` packed unit with `STAKE_AMOUNT = 10 ETH`)

**Agent Instructions:**
1. Read `test/unit/packedLib.test.ts` for packed type patterns.
2. Create edge case tests using minimum possible values.
3. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: Minimum withdrawal amount
- [x] Sub-task 2: Zero-rounding cluster balance
- [x] Sub-task 3: Minimum operator earnings
- [x] Sub-task 4: Precision in accEthPerShare

---

### [TEST-23] Max operator count (13) with EB
- **Type:** Unit Test Completeness
- **Priority:** P2
- **Status:** ✅ Closed
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests for 13-operator clusters with high EB values to verify no overflow.

**Acceptance Criteria:**
- [x] Test: 13 operators with EB=2048 — verify no overflow, correct accounting
- [x] Test: Liquidation with 13 operators and high EB — verify threshold calculation

**Agent Instructions:**
1. Read existing gas tests for 13 operators in `test/unit/SSVValidator/`.
2. Create tests combining 13 operators with maximum EB.
3. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: 13 operators + EB=2048 accounting
- [x] Sub-task 2: 13 operators + high EB liquidation

**Resolution:**
Two tests added to `test/unit/SSVClusters/updateClusterBalance.test.ts`:
1. **"Updates vUnit accounting correctly for 13 operators at maximum EB (2048 ETH per validator)"** — registers a cluster with 13 operators, updates EB to 2048, verifies: clusterVUnits = 640,000; daoTotalEthVUnits = 640,000; each operator deviation = 630,000; each operator effective vUnits = 640,000. No overflow.
2. **"Auto-liquidates cluster with 13 operators when EB increase to maximum makes it insolvent"** — verifies that the liquidation threshold calculation with 13 operators at EB=2048 (vUnits=640,000) correctly triggers auto-liquidation inside `updateClusterBalance`. Deposit is solvent at EB=32 (threshold ≈ 0.000014 ETH) but insolvent at EB=2048 (threshold ≈ 0.000896 ETH). After auto-liquidation, all 13 operator vUnit deviations are cleaned up to 0.

---

### [TEST-24] Idempotency and double-operation checks
- **Type:** Unit Test Completeness
- **Priority:** P2
- **Status:** ✅ Closed
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests verifying that double-calling operations either reverts or is safely idempotent.

**Acceptance Criteria:**
- [x] Test: `exitValidator` twice on same validator → verify second succeeds
- [x] Test: `syncFees` twice in same block → verify no double-counting
- [x] Test: `updateClusterBalance` with same proof twice → verify stale block revert

**Agent Instructions:**
1. Read relevant test files for each operation.
2. Call each operation twice and verify the second call either reverts with the correct error or is safely no-op.
3. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: Double `exitValidator`
- [x] Sub-task 2: Double `syncFees` in same block
- [x] Sub-task 3: Double `updateClusterBalance` with same proof

**Resolution:**
- **`exitValidator` twice** (`test/unit/SSVValidator/exitValidator.test.ts`): `exitValidator` does not mutate validator state (only emits an event after validating the stored operator hash), so calling it twice is safely idempotent — both calls succeed and emit `ValidatorExited`. Test added: "Calling exitValidator twice on the same validator succeeds both times without reverting".
- **`syncFees` twice** (`test/unit/SSVStaking/syncFees.test.ts`): After the first call, the staking pool balance is updated to match the DAO balance. The second call sees no delta (current == previous), emits no `FeesSynced` event, and leaves `accEthPerShare` unchanged. Test added: "Calling syncFees twice does not double-count fees — second call is a no-op".
- **`updateClusterBalance` same proof** (`test/unit/SSVClusters/updateClusterBalance.test.ts`): Already covered by the existing test "Is reverted with 'StaleUpdate' when blockNum is not increasing" — calling with the same (or lower) `blockNum` reverts with `StaleUpdate`. No new test needed.

---

### [TEST-25] Upgrade path (reinitializer) tests
- **Type:** Unit Test Completeness
- **Priority:** P2
- **Status:** ✅ Closed
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests for the upgrade initializer (`reinitializer(3)`) behavior.

**Acceptance Criteria:**
- [x] Test: Call initializer with `reinitializer(3)` → verify new state set correctly
- [x] Test: Call initializer again → verify reverts (already initialized)
- [x] Test: Verify `UPGRADE_TIMESTAMP` immutable prevents pre-migration fee declarations

**Agent Instructions:**
1. Read `contracts/upgrades/stage/hoodi/SSVNetworkSSVStakingUpgrade.sol`.
2. Read `test/setup/` for how upgrades are performed in tests.
3. Create tests that upgrade the proxy and verify the initializer runs correctly, then fails on re-call.
4. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: Successful reinitializer(3) execution
- [x] Sub-task 2: Re-initialization revert
- [x] Sub-task 3: UPGRADE_TIMESTAMP fee declaration guard

**Resolution:**
- **Sub-task 1 (state set correctly):** Already covered by `test/integration/SSVNetwork.test.ts` — "Configures SSVNetwork correctly" verifies `cooldownDuration`, `defaultOracleIds`, `quorumBps`, and all governance params post-upgrade.
- **Sub-task 2 (re-initialization revert):** Added to `test/integration/SSVNetwork.test.ts` under "Constructor, initializer and upgrades": "Calling initializeSSVStaking again reverts with already-initialized error". Attaches `SSVNetworkSSVStakingUpgrade` factory to the already-upgraded proxy and calls `initializeSSVStaking` again — reverts with OZ v4 string error `"Initializable: contract is already initialized"`.
- **Sub-task 3 (UPGRADE_TIMESTAMP guard):** Already covered by `test/unit/SSVOperators/executeOperatorFee.test.ts` — "Is reverted with 'LegacyOperatorFeeDeclarationInvalid' when executing a pre-upgrade fee declaration". Deploys SSVOperators with a future `upgradeTimestamp`, mocks a fee declaration with `approvalBeginTime <= upgradeTimestamp`, verifies `executeOperatorFee` reverts.

---

### [TEST-26] Zero-validator cluster operations
- **Type:** Unit Test Completeness
- **Priority:** P2
- **Status:** ✅ Closed
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests for clusters with 0 validators.

**Acceptance Criteria:**
- [x] Test: Deposit into cluster with 0 validators → verify no fees accrue
- [x] Test: Withdraw from cluster with 0 validators → verify full balance withdrawable
- [x] Test: EB update on cluster with 0 validators → verify no vUnits change
- [x] Test: Oracle EB report (`effectiveBalance = 0`) on active cluster with `validatorCount == 0` (all validators removed, cluster not deleted) → verify: (a) `_verifyEBLimits` passes (`0 >= 0 * 32`), (b) `ebToVUnits(0)` returns `0`, (c) `clusterEB.vUnits` written as `0` (resets any prior explicit EB back to implicit-EB sentinel), (d) no `operatorEthVUnits` or `daoTotalEthVUnits` changes, (e) no auto-liquidation triggered, (f) `ClusterBalanceUpdated` emitted with `effectiveBalance = 0`

**Agent Instructions:**
1. Read `test/unit/SSVClusters/deposit.test.ts` and `test/unit/SSVClusters/withdraw.test.ts`.
2. Create a cluster, remove all validators, then perform operations.
3. For sub-task 4: register a cluster with explicit EB (run one `updateClusterBalance` with non-zero EB first), then remove all validators, then submit a valid oracle proof with `effectiveBalance = 0`. Assert all storage fields and events per acceptance criteria above.
4. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: Deposit with 0 validators
- [x] Sub-task 2: Withdrawal with 0 validators
- [x] Sub-task 3: EB update with 0 validators (generic)
- [x] Sub-task 4: Oracle EB report with `effectiveBalance = 0` on active zero-validator cluster — full state assertion (see DISC.md §2.2)

**Resolution:**
- **Sub-task 1** (`test/unit/SSVClusters/deposit.test.ts`): "Deposit into zero-validator cluster accrues no fees over elapsed blocks" — uses non-zero operator fee fixture, registers then removes the only validator, mines 100 blocks, deposits, verifies balance = removal_balance + deposit_amount exactly (no fee deduction since vUnits = 0).
- **Sub-task 2** (`test/unit/SSVClusters/withdraw.test.ts`): "Zero-validator cluster allows full balance withdrawal without fee deduction" — non-zero fee + network fee, removes last validator, mines 100 blocks, withdraws full balance, verifies cluster balance = 0 and cluster still active.
- **Sub-task 3** (`test/unit/SSVClusters/updateClusterBalance.test.ts`): "EB update with effectiveBalance = 0 on zero-validator cluster succeeds without modifying vUnit state" — basic case (no prior explicit EB), verifies ClusterBalanceUpdated emitted with effectiveBalance = 0, clusterVUnits = 0, no vUnit changes.
- **Sub-task 4** (`test/unit/SSVClusters/updateClusterBalance.test.ts`): "Oracle EB report effectiveBalance = 0 on active zero-validator cluster resets explicit EB to implicit-EB sentinel" — full state assertion: first sets EB = 64 ETH (explicit vUnits = 20000), removes last validator (vUnits cleared to 0), then submits effectiveBalance = 0 via updateClusterBalance; verifies all (a)-(f): limits pass, vUnits = 0, operatorEthVUnits = 0, daoTotalEthVUnits unchanged, no auto-liquidation, ClusterBalanceUpdated emitted with effectiveBalance = 0, cluster still active.

---

### [TEST-27] Operator at max validator limit
- **Type:** Unit Test Completeness
- **Priority:** P2
- **Status:** ✅ Closed
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Test `VALIDATORS_PER_OPERATOR_LIMIT` (3000) boundary.

**Acceptance Criteria:**
- [x] Test: Register validator pushing operator to limit+1 → verify revert
- [x] Test: Remove validator then re-register at limit → verify succeeds

**Resolution:**
Added two tests to `test/unit/SSVValidator/registerValidator.test.ts`:
- Used `mockValidatorsPerOperatorLimit(5)` to avoid bulk-registering 3000 validators
- Used `bulkRegisterValidator` to fill all operators to the limit (5 validators)
- Sub-task 1: 6th `registerValidator` call reverts with `ExceedValidatorLimitWithData(operatorIds[0])`
- Sub-task 2: After removing one validator (back to 4), re-register succeeds and emits `ValidatorAdded`

#### Sub-items:
- [x] Sub-task 1: Exceed operator validator limit — revert
- [x] Sub-task 2: Re-register at limit after removal

---

### [TEST-28] Uncomment SSV reentrancy test assertions
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Uncomment the three commented-out assertions in the SSV operator reentrancy test and verify they pass.

**Context:**
In `test/unit/SSVOperators/reentrancy.test.ts:101-107`, three assertions are commented out inside `/* */`. The SSV token reentrancy guard is effectively untested. The ETH reentrancy test in the same file IS properly asserted. This means the SSV withdrawal path has no verified reentrancy protection.

**Acceptance Criteria:**
- [ ] Lines 101-107 uncommented
- [ ] All three assertions pass
- [ ] If assertions fail, fix the mock contract or reentrancy guard to make them pass

**Agent Instructions:**
1. Read `test/unit/SSVOperators/reentrancy.test.ts`, focus on lines 95-110.
2. Uncomment the three assertions at lines 101-107.
3. Run `npm run test:unit` to verify they pass.
4. If they fail, investigate whether the mock reentrancy contract or the reentrancy guard needs fixing.

#### Sub-items:
- [ ] Sub-task 1: Uncomment SSV reentrancy assertions
- [ ] Sub-task 2: Verify test passes (fix if needed)

---

### [TEST-29] ~~Add contract ETH balance delta assertions to deposit tests~~
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** ✅ Done
- **Owner:** (unassigned)
- **Timeline:** 2026-02-26
- **Github Link:** (empty)

**Requirement:**
Add `address(contract).balance` before/after assertions to ETH deposit tests. Currently tests verify cluster balance in events but never check the actual contract ETH balance change.

**Context:**
In `test/unit/SSVClusters/deposit.test.ts`, tests verify cluster balance in events but never check `address(contract).balance` before and after the deposit. This means the contract could emit the correct event but not actually receive the ETH.

**Concrete test:** Register with 10 ETH, deposit 5 ETH, assert `contractBalance_after - contractBalance_before == 5 ETH`.

**Resolution:**
Added explicit `address(clusters).balance` delta assertions in `test/unit/SSVClusters/deposit.test.ts` for a single deposit and for a multi-deposit ("bulk" sequential deposits) scenario. The multi-deposit test asserts per-deposit deltas and cumulative ETH balance growth across two deposits (owner + third-party depositor). Validation run: `npx hardhat test test/unit/SSVClusters/deposit.test.ts` (6 passing) and `npm run test:unit` (414 passing).

**Acceptance Criteria:**
- [x] At least one deposit test captures contract ETH balance before and after
- [x] Asserts `balanceAfter - balanceBefore == msg.value`
- [x] Both single and bulk deposit scenarios covered

**Agent Instructions:**
1. Read `test/unit/SSVClusters/deposit.test.ts` for existing patterns.
2. Add balance capture: `const before = await ethers.provider.getBalance(ssvNetwork.address)`.
3. After deposit: `const after = await ethers.provider.getBalance(ssvNetwork.address)`.
4. Assert: `expect(after - before).to.equal(depositAmount)`.
5. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: Add ETH balance delta assertion to deposit test
- [x] Sub-task 2: Run full test suite

---

### [TEST-30] Resolve TODO comments with deferred assertions
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Resolve the 12 TODO comments across test files that indicate event args not verified against computed expected values.

**Context:**
In `test/unit/SSVValidator/registerValidator.test.ts:56`, `bulkRegisterValidator.test.ts:58`, and 10 other locations, TODO comments indicate that event arguments are not being verified against independently computed expected values. These represent deferred test assertions that should be completed.

**Acceptance Criteria:**
- [ ] All 12 TODO comments identified and resolved
- [ ] Each TODO replaced with actual assertion or removed with justification
- [ ] No new test failures introduced

**Agent Instructions:**
1. Grep for `TODO` across all test files to identify the 12 locations.
2. For each TODO: read the surrounding test context, compute the expected value, add the assertion.
3. Run `npm run test:unit` after each batch of changes.

#### Sub-items:
- [ ] Sub-task 1: Identify all 12 TODO locations
- [ ] Sub-task 2: Resolve each TODO with actual assertions
- [ ] Sub-task 3: Run full test suite

---

### [TEST-31] Expand onCSSVTransfer test coverage
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Expand `onCSSVTransfer` tests from the current 2 tests to cover multi-transfer sequences, transfers after fee accruals, and transfers between users with pending rewards.

**Context:**
In `test/unit/SSVStaking/onCSSVTransfer.test.ts`, only 2 tests exist. Missing scenarios: multi-transfer sequences, transfer after fee accruals, transfer between users with pending rewards. The `onCSSVTransfer` hook is critical for correct reward settlement during cSSV transfers.

**Concrete test:** User A (100 cSSV) transfers 50 to User B (200 cSSV) after fee sync. Verify both parties' rewards settled correctly using `pendingReward = cSSVBalance * (accEthPerShare - userIndex) / 1e18`.

**Acceptance Criteria:**
- [ ] Test: multi-transfer sequence (A→B→C) with reward verification at each step
- [ ] Test: transfer after fee accruals — verify accumulated rewards settled before transfer
- [ ] Test: transfer between users with pending rewards — verify both rewards correct
- [ ] At least 5 total test cases for `onCSSVTransfer`

**Agent Instructions:**
1. Read `test/unit/SSVStaking/onCSSVTransfer.test.ts` for existing patterns.
2. Read `contracts/modules/SSVStaking.sol`, focus on `onCSSVTransfer` (line 169).
3. Add multi-transfer, fee-accrual, and pending-reward test scenarios.
4. Calculate expected rewards independently using the accumulator formula.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Multi-transfer sequence test
- [ ] Sub-task 2: Transfer after fee accrual test
- [ ] Sub-task 3: Transfer with pending rewards test

---

### [TEST-32] Add access control tests for DAO governance functions
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** ✅ Complete
- **Owner:** (unassigned)
- **Timeline:** 2026-02-26
- **Github Link:** (empty)

**Requirement:**
Add non-owner revert tests for all DAO governance functions. Currently all SSVDAO test files only test happy path from owner.

**Context:**
All 11+ governance functions (`updateNetworkFee`, `updateLiquidationThresholdPeriod`, `replaceOracle`, `updateQuorumBps`, `updateUnstakeCooldownDuration`, `updateMaximumOperatorFee`, `updateMinimumOperatorEthFee`, etc.) are tested only from the owner account. No test verifies that non-owner calls are rejected.

**Acceptance Criteria:**
- [x] Each governance function has a test calling from non-owner that expects revert
- [x] Revert reason matches expected access control error (legacy branch behavior: `Ownable: caller is not the owner`)
- [x] All 11+ functions covered

**Resolution:**
- Added `/Users/venimir/Desktop/ssv/contracts-latest/ssv-network/test/unit/SSVDAO/accessControl.test.ts` with non-owner access-control tests for 15 owner-only DAO governance wrappers on `SSVNetwork`:
  - `updateNetworkFee`, `updateNetworkFeeSSV`, `withdrawNetworkSSVEarnings`
  - `updateOperatorFeeIncreaseLimit`, `updateDeclareOperatorFeePeriod`, `updateExecuteOperatorFeePeriod`
  - `updateLiquidationThresholdPeriod`, `updateLiquidationThresholdPeriodSSV`
  - `updateMinimumLiquidationCollateral`, `updateMinimumLiquidationCollateralSSV`
  - `updateMaximumOperatorFee`, `updateMinimumOperatorEthFee`
  - `updateUnstakeCooldownDuration`, `replaceOracle`, `updateQuorumBps`
- Verified non-owner calls revert with the legacy Ownable string on this branch (`Ownable: caller is not the owner`), rather than OZ's newer `OwnableUnauthorizedAccount` custom error.
- Verified with `npx hardhat test test/unit/SSVDAO/accessControl.test.ts` and `npm run test:unit` (`428 passing`).

**Agent Instructions:**
1. Read `test/unit/SSVDAO/` directory for all existing DAO test files.
2. For each governance function, add a test that calls from a non-owner signer.
3. Assert revert with the expected access control error.
4. Run `npm run test:unit`.

#### Sub-items:
- [x] Sub-task 1: Identify all governance functions requiring access control tests
- [x] Sub-task 2: Add non-owner revert test for each function
- [x] Sub-task 3: Run full test suite

---

### [TEST-33] Mainnet governance config validation & edge-case tests
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add a dedicated test suite that uses the exact mainnet governance parameters and validates system behavior at the boundaries implied by those values. This ensures the production config is safe before deployment.

**Mainnet Config (from deployment spreadsheet):**
| Param | Value | Wei/Raw |
|-------|-------|---------|
| ethNetworkFee | 0.000000003550929823 ETH/block | 3,550,929,823 |
| minimumLiquidationCollateral | 0.00094 ETH | 940,000,000,000 |
| minimumBlocksBeforeLiquidation | ~5 days | 35,800 |
| operatorMinFee | 0.000000001065278947 ETH/block | 1,065,278,947 |
| operatorMaxFee | 0.000000005326394735 ETH/block | 5,326,394,735 |
| defaultOperatorETHFee | 0.000000001775464912 ETH/block | 1,775,464,912 |
| quorumBps | 75% | 7,500 |
| cooldownDuration | 7 days | 50,120 |

**Test scenarios:**
1. **Packability** — verify all fee values survive pack/unpack round-trip without precision loss (divisible by `ETH_DEDUCTED_DIGITS`). If a value isn't packable, document the closest packable equivalent.
2. **Liquidation threshold math** — with 4 operators at defaultOperatorETHFee + ethNetworkFee, calculate exactly how many blocks / how much balance keeps a cluster solvent vs liquidatable. Verify `isLiquidatable` agrees.
3. **Operator fee boundaries** — declare fees at operatorMinFee and operatorMaxFee, verify both accepted. Declare fee at operatorMinFee-1 and operatorMaxFee+1, verify both rejected.
4. **Cluster burn rate** — with mainnet fees and varying validator counts (1, 4, 13), compute expected burn rate per block. Verify `getBalance` returns correct remaining balance after N blocks.
5. **Cooldown duration** — set cooldownDuration to 50,120. Request unstake, verify cannot claim before 50,120 blocks/seconds elapse, can claim after. (Also clarifies the blocks-vs-seconds question from BUG-8.)
6. **Quorum** — with 4 oracles and quorumBps=7500, verify exactly 3 votes are needed to commit a root. 2 votes should fail, 3 should succeed.
7. **Liquidation collateral** — deposit exactly minimumLiquidationCollateral, verify cluster is NOT liquidatable at block 0. Verify it IS liquidatable after enough blocks to exhaust balance below threshold.
8. **Long-running clusters** — with mainnet fees, simulate a cluster running for 1 year (~2,628,000 blocks). Verify no overflow in fee index calculations and balance accounting remains correct.

**Acceptance Criteria:**
- [ ] Test file `test/unit/mainnet-config-validation.test.ts` (or similar) created
- [ ] All 8 test scenarios above implemented with exact mainnet values
- [ ] Each test includes numeric assertions (expected vs actual) with comments showing the math
- [ ] All tests pass
- [ ] Any packability issues documented (values that need rounding for on-chain use)

**Agent Instructions:**
1. Read `test/setup/fixtures.ts` and `test/common/` for test patterns and constants.
2. Create a new test file for mainnet config validation.
3. Use the exact wei values from the table above as test constants.
4. For each scenario, include a comment with the expected math (e.g., "4 operators × 1,775,464,912 wei/block × 35,800 blocks = X wei burn").
5. For packability tests, use `SSVPackedLib` to pack/unpack each value and assert round-trip equality.
6. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Create test file with mainnet config constants
- [ ] Sub-task 2: Implement packability round-trip tests
- [ ] Sub-task 3: Implement liquidation/solvency boundary tests
- [ ] Sub-task 4: Implement operator fee boundary tests
- [ ] Sub-task 5: Implement burn rate and long-running cluster tests
- [ ] Sub-task 6: Implement cooldown and quorum tests
- [ ] Sub-task 7: Run full test suite

---

### [TEST-34] ~~Staking solvency invariant: cSSV supply must not exceed SSV held by staking contract~~
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** ✅ Done
- **Owner:** (unassigned)
- **Timeline:** 2026-02-26
- **Github Link:** (empty)

**Requirement:**
Add invariant coverage for staking solvency: `cSSV.totalSupply() <= SSV.balanceOf(SSVStaking)` at all times.

**Product concern:**
Product asked for explicit safety validation to ensure cSSV issuance cannot exceed backing SSV even if future changes introduce bugs. Current implementation is by-construction (SSV transfer happens before cSSV mint), but the invariant should be continuously enforced by tests.

**Context:**
`SSVStaking.stake()` transfers SSV to staking contract before minting cSSV, and `requestUnstake()` burns cSSV before eventual SSV withdrawal. This implies the solvency relationship should always hold, but there is no explicit invariant test guarding against regressions.

**Invariant to test:**
`cSSV.totalSupply() <= SSV.balanceOf(address(SSVStaking))`

**Resolution:**
Added explicit Echidna invariant `echidna_cssv_supply_lte_ssv_backing()` in `test/echidna/SSVStakingEchidna.sol` and deterministic regression coverage in `test/unit/SSVStaking/solvencyInvariant.test.ts` for single-user ordering, multi-user partial unstake requests, and full unstake/withdraw flows. Also aligned the Echidna harness `MAX_PENDING_REQUESTS` constant with `SSVStaking` (`2000`) to avoid a harness-only false failure in `echidna_pending_requests_bounded`. Validation run: `npx hardhat test test/unit/SSVStaking/solvencyInvariant.test.ts` (3 passing) and `echidna ... SSVStakingEchidna ...` (12/12 invariants passing, including solvency invariant).

**Acceptance Criteria:**
- [x] Add an Echidna invariant test that continuously asserts `cSSV.totalSupply() <= SSV.balanceOf(address(staking))` across stake/unstake/transfer/withdraw flows
- [x] Add at least one deterministic unit regression test for the invariant around `stake` and `requestUnstake` ordering
- [x] Include edge scenarios: multiple users, partial unstake requests, full unstake + withdraw cycle
- [x] No invariant violations in fuzz runs

**Agent Instructions:**
1. Read `contracts/modules/SSVStaking.sol` and `contracts/token/CSSVToken.sol` for mint/burn ordering.
2. Extend the Echidna suite under `test/echidna/` with a dedicated solvency invariant check.
3. Add a deterministic unit test in `test/unit/SSVStaking/` asserting the invariant before/after `stake`, `requestUnstake`, and `withdrawUnlocked`.
4. Run the relevant unit tests and Echidna target.

#### Sub-items:
- [x] Sub-task 1: Add Echidna solvency invariant
- [x] Sub-task 2: Add deterministic unit regression tests
- [x] Sub-task 3: Cover multi-user + partial/full unstake scenarios
- [x] Sub-task 4: Run unit + Echidna checks

---

## Integration / E2E Tests

### [ITEST-1] ~~`commitRoot` → `updateClusterBalance` E2E flow~~
- **Type:** Integration / E2E Tests
- **Priority:** P1
- **Status:** ✅ **CLOSED**
- **Owner:** Test coverage update
- **Timeline:** Completed 2026-03-03
- **Github Link:** [test/integration/SSVNetwork/commitRootUpdateClusterBalance.test.ts](../test/integration/SSVNetwork/commitRootUpdateClusterBalance.test.ts)

**Requirement:**
Create an end-to-end test connecting oracle voting → root commitment → cluster EB update → fee recalculation.

**Context:**
Unit tests for `commitRoot` and `updateClusterBalance` exist separately but no test connects the full flow. This is the core oracle→cluster pipeline.

**Acceptance Criteria:**
- [x] Test: 3 oracles propose same root → root committed → cluster calls `updateClusterBalance` with proof from committed root → verify fees recalculated with new EB
- [x] Test: Multiple clusters update EB from same root → verify independent accounting

**Implementation Summary:**
1. Added a dedicated integration suite: [commitRootUpdateClusterBalance.test.ts](../test/integration/SSVNetwork/commitRootUpdateClusterBalance.test.ts).
2. Added E2E test for quorum flow (`3/4` oracle votes) that commits root and executes `updateClusterBalance` with valid Merkle proof.
3. Added exact-value assertion that EB update to `64` doubles post-update operator earnings accrual vs baseline.
4. Added multi-cluster scenario from one committed root and verified independent accounting with exact formula-based balance deltas per cluster.

**Agent Instructions:**
1. Read `test/unit/SSVDAO/commitRoot.test.ts` and `test/unit/SSVClusters/updateClusterBalance.test.ts`.
2. Read `test/integration/SSVNetwork.test.ts` for integration test patterns.
3. Create a new integration test file or add to existing.
4. Build the full flow: deploy, create cluster, stake SSV for oracle weight, commit oracle root with Merkle tree, then call `updateClusterBalance` with proof from the committed root.
5. Verify the cluster's EB is updated and fee calculations reflect the new EB.
6. Run `npm run test:integration`.

#### Sub-items:
- [x] Sub-task 1: Full oracle → cluster EB update flow
- [x] Sub-task 2: Multiple clusters from same root

---

### [ITEST-2] Migration with multiple EB updates E2E
- **Type:** Integration / E2E Tests
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Test migration of a cluster that has had multiple EB updates, verifying the latest snapshot is used.

**Context:**
Migration with EB snapshot is tested but edge cases with multiple prior EB updates are not.

**Acceptance Criteria:**
- [ ] Test: Migrate cluster that has had multiple EB updates → verify latest snapshot used
- [ ] Test: Migrate cluster where EB was set and then validators were added → verify vUnits calculated correctly

**Agent Instructions:**
1. Read `test/unit/SSVClusters/migrateClusterToETH.test.ts`.
2. Create a cluster, update EB multiple times via `updateClusterBalance`, then migrate to ETH.
3. Verify the migrated cluster uses the latest EB values.
4. Run `npm run test:integration`.

#### Sub-items:
- [ ] Sub-task 1: Migration after multiple EB updates
- [ ] Sub-task 2: Migration after EB set + validators added

---

## Deployment & Scripts

### [DEPLOY-1] ~~Fix `deploy-all.ts` broken signature and constructor args~~
- **Type:** Deployment & Scripts
- **Priority:** P0
- **Status:** ✅ Fixed
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** [PR #431](https://github.com/ssvlabs/ssv-network/pull/431)

**Requirement:**
Fix deployment scripts so that fresh deployments work. `deploy-all.ts` had wrong `initializeSSVStaking` signature and missing constructor args for 3 modules.

**Context:**
`scripts/deploy-all.ts` (now deleted) used `"initializeSSVStaking(address,uint64)"` with `[cssvTokenAddr, cooldown]`. Actual contract signature is `initializeSSVStaking(uint64,uint32[4],uint16)`. Also, `SSVDAO`, `SSVViews`, `SSVStaking` all require `_cssv` address as constructor arg but were deployed without args.

**Resolution:**
`deploy-all.ts` replaced by `deploy-fresh.ts` (fresh deployments) and `upgrade.ts` (upgrades). Both use the correct `initializeSSVStaking(uint64,uint32[4],uint16)` three-parameter signature and pass `quorumBps` from config. `CSSVToken` deployed before modules and its address passed as constructor arg. `generate-safe-batch.ts` handles Safe multisig batch encoding.

**Acceptance Criteria:**
- [x] `initializeSSVStaking` signature is `"initializeSSVStaking(uint64,uint32[4],uint16)"`
- [x] `quorumBps` passed as third argument from deployment config
- [x] `CSSVToken` deployed before modules that need its address
- [x] `SSVDAO`, `SSVViews`, `SSVStaking` deployed with `cssvTokenAddr` as constructor arg

**Agent Instructions:**
~~Obsolete — resolved by replacing `deploy-all.ts` with `deploy-fresh.ts` and `upgrade.ts`. See Resolution above.~~

#### Sub-items:
- [ ] Sub-task 1: Fix `initializeSSVStaking` call signature and params
- [ ] Sub-task 2: Fix constructor args for SSVDAO, SSVViews, SSVStaking
- [ ] Sub-task 3: Reorder CSSVToken deployment before modules
- [ ] Sub-task 4: Verify script runs against local Hardhat

---

### [DEPLOY-2] Verify `liquidationThresholdPeriod` config vs spec mismatch
- **Type:** Deployment & Scripts
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Resolve the mismatch between `liquidationThresholdPeriod` in `deployments/hoodi-stage/config.json` (35,800) and the DIP-X spec (50,190 blocks).

**Context:**
`deployments/hoodi-stage/config.json` sets `liquidationThresholdPeriod: 35800` but the DIP-X spec proposes 50,190 blocks (~7 days). This is a significant difference — 35,800 blocks is ~5 days. If this is intentional for the testnet, it should be documented. The mainnet config (`deployments/mainnet/config.json`) must use the correct value.

**Acceptance Criteria:**
- [ ] Decision documented: is 35,800 intentional for Hoodi testnet?
- [ ] Mainnet config (when created) uses 50,190 or the final DIP-X approved value
- [ ] Comment added to config explaining the discrepancy if intentional

**Agent Instructions:**
1. Read `deployments/hoodi-stage/config.json` and `deployments/mainnet/config.json`.
2. Read `docs/SPEC.md` section 11 for the governance parameters.
3. If this is a testnet-specific value, add a comment. If it's a bug, update to 50,190.
4. This is primarily a decision item — flag it for team review if uncertain.

#### Sub-items:
- [ ] Sub-task 1: Verify intended value with team
- [ ] Sub-task 2: Update config or add documentation

---

### [DEPLOY-3] Verify `ethNetworkFee` rounding in config
- **Type:** Deployment & Scripts
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)
- **DIP-X Review Source:** ETH Payments review finding ETH-10

**Requirement:**
Verify whether the rounding of `ethNetworkFee` (config: 3,550,900,000 vs spec: 3,550,929,823) is acceptable or needs correction.

**Context:**
The config rounds to 3,550,900,000 while the spec says 3,550,929,823. The difference is ~30k wei, which over millions of blocks could accumulate to meaningful amounts.

**Additional context from DIP-X review (ETH-10):** The DIP-specified value `3,550,929,823 % 100,000 = 29,823` — it is NOT divisible by `ETH_DEDUCTED_DIGITS (100,000)`, so the exact DIP value cannot be stored in `PackedETH`. The closest packable values are `3,550,900,000` (rounding down) or `3,551,000,000` (rounding up). The DIP should be updated to note this packing constraint. The initial value is set at deployment/upgrade time (not hardcoded), so the contract itself has no validation that a specific initial value is used — this is a governance responsibility.

**Acceptance Criteria:**
- [ ] Decision documented: acceptable rounding or needs exact value
- [ ] If exact value needed, verify it passes `MaxPrecisionExceeded` check (divisible by ETH_DEDUCTED_DIGITS = 100,000)

**Agent Instructions:**
1. Check if 3,550,929,823 is divisible by 100,000 (ETH_DEDUCTED_DIGITS). It's not (remainder = 29,823), so it may need rounding.
2. Verify what the contract's precision check allows.
3. The closest valid value is either 3,550,900,000 or 3,551,000,000.
4. Document the decision.

#### Sub-items:
- [ ] Sub-task 1: Verify precision constraints
- [ ] Sub-task 2: Document accepted rounding

---

### [DEPLOY-4] ~~Remove unused error declarations~~
- **Type:** Deployment & Scripts
- **Priority:** P2
- **Status:** ✅ Fixed
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** (empty)

**Resolution:**
Removed `NotAuthorized()` and `InvalidContractAddress()` from `contracts/interfaces/ISSVNetworkCore.sol`. Both were declared but never referenced anywhere in the codebase. Compilation verified clean.

**Acceptance Criteria:**
- [x] Both unused errors removed from `ISSVNetworkCore.sol`
- [x] No references to these errors exist in any contract
- [x] Compilation succeeds

#### Sub-items:
- [x] Sub-task 1: Verify errors are unused
- [x] Sub-task 2: Remove declarations
- [x] Sub-task 3: Verify compilation

---

### [DEPLOY-5] ~~Document `operatorMinFee` governance parameter in DIP-X~~
- **Type:** Deployment & Scripts
- **Priority:** P2
- **Status:** ✅ Fixed
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** (empty)
- **DIP-X Review Source:** ETH Payments review finding ETH-20

**Resolution:**
Updated `docs/SPEC.md` governance parameter table with initial values sourced from `deployments/hoodi-prod/config.json`:
- `minimumOperatorEthFee`: 0.000000001065200000 ETH/block (~0.0028 ETH/year), setter `updateMinimumOperatorEthFee(uint256)`
- `operatorMaxFee` (also TBD): 0.000000005326300000 ETH/block (~0.0140 ETH/year), setter `updateMaximumOperatorFee(uint256)`

**Acceptance Criteria:**
- [x] DIP-X governance table updated with: update function = `updateMinimumOperatorEthFee(uint256 minFee)`, initial value from config
- [x] Deployment config (`deployments/hoodi-prod/config.json`) verified to include a reasonable initial value

#### Sub-items:
- [x] Sub-task 1: Document `operatorMinFee` in DIP-X governance table
- [x] Sub-task 2: Verify deployment config includes the parameter

---

### [DEPLOY-6] ~~DIP-X unstaking description doesn't match implementation~~
- **Type:** Deployment & Scripts
- **Priority:** P2
- **Status:** ✅ Closed (already correct in SPEC.md and FLOWS.md)
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** (empty)
- **DIP-X Review Source:** SSV Staking review finding DIP-7

**Resolution:**
Verified `docs/SPEC.md` and `docs/FLOWS.md` already correctly describe the burn-first mechanism. `SPEC.md §3 "Unstaking (Two-Step)"` states: *"`requestUnstake(amount)`: Burns cSSV, creates `UnstakeRequest{amount, unlockTime}`"* — no "lock cSSV → burn later" language exists. `FLOWS.md §5.2` likewise lists burn as step 4 within the same transaction. The original concern about the DIP wording was addressed when these spec documents were authored. No code or doc change needed.

**Acceptance Criteria:**
- [x] DIP-X unstaking section updated to describe the actual burn-first mechanism
- [x] No code change needed — the implementation is correct and simpler

#### Sub-items:
- [x] Sub-task 1: Verify SPEC.md and FLOWS.md describe correct burn-first flow
- [x] Sub-task 2: No user-facing doc change needed — spec is authoritative

---

### [DEPLOY-7] ~~Deploy scripts import from test files~~
- **Type:** Deployment & Scripts
- **Priority:** P2
- **Status:** ✅ Fixed
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** (empty)

**Requirement:**
Move shared constants out of test files so deploy scripts don't import from test directories.

**Context:**
`scripts/deploy-all.ts`, `scripts/staking-upgrade.ts`, and `scripts/upgrade-fork.ts` (all now deleted/replaced) imported `DEFAULT_UNSTAKE_COOLDOWN` from `"../test/common/constants.ts"`. Deploy scripts should not depend on test files — this creates a fragile dependency where test refactors can break deployment.

**Resolution:**
`upgrade.ts` and `deploy-fresh.ts` import all shared config from `scripts/common/config.ts` (new in this merge). No deploy script imports from `test/common/` any longer. The only remaining reference is `scripts/common/fork-test.ts` which uses a local env-var constant — not a cross-boundary import.

**Acceptance Criteria:**
- [x] Shared constants in `scripts/common/config.ts`
- [x] Deploy scripts import from the new location
- [x] No deploy script imports from `test/common/`

**Agent Instructions:**
~~Obsolete — resolved. `upgrade.ts` and `deploy-fresh.ts` import from `scripts/common/config.ts`. See Resolution above.~~

#### Sub-items:
- [ ] Sub-task 1: Create shared constants file
- [ ] Sub-task 2: Update deploy script imports
- [ ] Sub-task 3: Verify scripts still work

---

## Operational Readiness

### [OPS-1] Create mainnet deployment runbook
- **Type:** Operational Readiness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Create a step-by-step runbook for the v2.0.0 mainnet upgrade, including pre-flight checks, deployment steps, post-deployment verification, and rollback triggers.

**Context:**
No mainnet deployment checklist exists. The upgrade involves UUPS proxy upgrades, new module deployments, CSSVToken deployment, initializer execution, and governance parameter setup. The existing `scripts/deployment.md` covers generic deployment but not the v2.0.0-specific flow.

**Acceptance Criteria:**
- [ ] Document includes pre-flight checks (contract sizes, gas estimates, parameter verification)
- [ ] Step-by-step deployment sequence matching `upgrade.ts` / `generate-safe-batch.ts` flow
- [ ] Post-deployment verification checklist (all parameters set, quorumBps != 0, oracle addresses correct)
- [ ] Rollback triggers and procedure for each step
- [ ] Links to relevant scripts for each step

**Agent Instructions:**
1. Read `scripts/upgrade.ts` for the upgrade flow reference.
2. Read `scripts/generate-safe-batch.ts` for the mainnet Safe batch encoding flow.
3. Read `scripts/deployment.md` for existing documentation patterns.
4. Create `docs/MAINNET-UPGRADE-RUNBOOK.md` with:
   - Pre-flight checklist
   - Deployment sequence (numbered steps with exact commands)
   - Post-deployment verification queries (using SSVViews)
   - Rollback procedures
   - Emergency contacts / escalation paths (placeholder)
5. Ensure the runbook explicitly states: "Call `updateQuorumBps(7500)` immediately after upgrade" (see SEC-2).

#### Sub-items:
- [ ] Sub-task 1: Write pre-flight checks section
- [ ] Sub-task 2: Write deployment sequence
- [ ] Sub-task 3: Write post-deployment verification
- [ ] Sub-task 4: Write rollback procedures

---

### [OPS-2] Create emergency rollback procedure
- **Type:** Operational Readiness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Document how to downgrade/rollback modules if critical issues are found post-deployment.

**Context:**
The UUPS proxy pattern allows module replacement. If a bug is found in a deployed module, the DAO owner can replace it with a patched version. But there's no documented procedure for this.

**Acceptance Criteria:**
- [ ] Document covers: how to replace a module with a patched version
- [ ] Covers: how to pause operations if needed (does a pause mechanism exist?)
- [ ] Covers: which state is recoverable and which is not
- [ ] Covers: communication plan for operators/users

**Agent Instructions:**
1. Read `contracts/SSVNetwork.sol` to understand `updateModule` function.
2. Read `scripts/upgrade.ts` for the module replacement / `updateModule` call pattern.
3. Document the rollback procedure for each module type.
4. Identify what state changes are irreversible (e.g., token transfers, oracle commits).

#### Sub-items:
- [ ] Sub-task 1: Document module replacement procedure
- [ ] Sub-task 2: Document irrecoverable state changes
- [ ] Sub-task 3: Document communication plan template

---

### [OPS-3] Update `.env.example` for v2.0.0
- **Type:** Operational Readiness
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Update `.env.example` with v2.0.0 parameter names and values.

**Context:**
`.env.example` still contains v1 values: `MINIMUM_BLOCKS_BEFORE_LIQUIDATION=100800`, `MINIMUM_LIQUIDATION_COLLATERAL=200000000` (SSV-denominated), `OPERATOR_MAX_FEE_INCREASE=3`, `QUORUM_BPS=6700`. Missing all ETH-specific params.

**Acceptance Criteria:**
- [ ] All v1-only params removed or updated
- [ ] ETH-specific params added: `NETWORK_FEE_ETH`, `MIN_OPERATOR_ETH_FEE`, `MAX_OPERATOR_ETH_FEE`, `DEFAULT_OPERATOR_ETH_FEE`
- [ ] Values match DIP-X spec defaults
- [ ] Comments explain each parameter

**Agent Instructions:**
1. Read `.env.example`.
2. Read `deployments/hoodi-prod/config.json` for reference values.
3. Update the file with v2.0.0 parameters and inline comments.

#### Sub-items:
- [ ] Sub-task 1: Update existing params
- [ ] Sub-task 2: Add ETH-specific params
- [ ] Sub-task 3: Add inline comments

---

## Echidna Invariant Suite

**Current state:** 73 invariants across 9 test contracts (see `test/echidna/README.md` for full master list).
**Source:** Evaluated from `ssv-review/planning/SSVNetwork — Enrich Invariant Suite.md` — cross-referenced all 50 proposed invariants against existing 73, identified 30 new + 5 strengthening items.

### [FUZZ-1] ~~Strengthen 5 partially-covered echidna invariants~~
- **Type:** Echidna Invariant Suite
- **Priority:** P1
- **Status:** ✅ Done
- **Owner:** (unassigned)
- **Timeline:** 2026-03-03
- **Github Link:** (empty)

**Requirement:**
Upgrade 5 existing invariants from partial to full coverage:
1. `echidna_network_fee_matches_expected` → add explicit monotonicity tracking (ref A8)
2. `echidna_cssv_supply_matches_users` → add per-operation mint/burn delta assertions (ref A11)
3. `echidna_user_index_leq_acc` → strengthen to exact equality after `_settle` (ref A14)
4. `echidna_pool_matches_dao_balance` → add per-claim delta tracking (ref A16)
5. `echidna_accrued_within_pool` → add cumulative payout tracking (ref C2)

**Resolution:**
Completed in the Echidna harnesses:
- `test/echidna/SSVDAOEchidna.sol`: strengthened network-fee invariants with explicit monotonicity bookkeeping (`prevEthFeeCurrentIndex`, `prevSsvFeeCurrentIndex`) and mutation-time checkpoints.
- `test/echidna/SSVStakingEchidna.sol`: added per-operation cSSV mint/burn delta checks, post-settle exact `userIndex == accEthPerShare` checks, per-claim pool/DAO delta validation, and cumulative ETH credited/paid-out tracking for payout safety.

Validation run:
- `echidna test/echidna/SSVStakingEchidna.sol --contract SSVStakingEchidna --config test/echidna/echidna.yaml` (12/12 passing)
- `echidna test/echidna/SSVDAOEchidna.sol --contract SSVDAOEchidna --config test/echidna/echidna.yaml` (13/13 passing)

**Acceptance Criteria:**
- [x] Each upgraded invariant catches the class of bugs described in the ref
- [x] All echidna tests still pass after modifications
- [x] Harness bookkeeping added (prev-value tracking, per-claim deltas, cumulative payout counter)

---

### [FUZZ-2] Add 16 high-priority new echidna invariants
- **Type:** Echidna Invariant Suite
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add 16 new invariants covering critical gaps. Full list with descriptions in `test/echidna/README.md` under "High Priority — New Invariants". Summary:

**Oracle / EB Governance (3):** Finalized weight cleared (A4), commitment weight ≤ supply (A5), finalization implies quorum (B1)

**DAO Accounting (2):** DAO earnings monotonicity (A9), DAO index block ≤ current (A10)

**Staking Rewards Precision (3):** cSSV transfer settles both (A15), claim payout precision (A17), no free rewards on transfer (C3)

**EB Snapshot Safety (2):** Snapshot block ≤ current (A18), snapshot root monotonic per cluster (A19)

**EB Update Correctness (3):** Update requires root (B3), frequency enforced (B4), staleness enforced (B5)

**Fee Settlement (2):** Fee index current after settle (B9), fee uses old vUnits on EB change (B11)

**Liquidation Completeness (2):** Liquidation clears EB snapshot (B13), liquidation pays exact balance (B14)

**Acceptance Criteria:**
- [ ] All 16 invariants implemented and passing
- [ ] Harness features added: prev-value tracking, touched-key arrays, 2-actor reward tracking
- [ ] Each invariant documented in `test/echidna/README.md`

---

### [FUZZ-3] Add 8 medium-priority echidna invariants
- **Type:** Echidna Invariant Suite
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add 8 medium-priority invariants requiring more harness setup. Full list in `test/echidna/README.md` under "Medium Priority". Summary:

**EB Proof (3):** Merkle proof verified (B6), EB bounds enforced (B7), snapshot fields exact (B8)

**Operator Fee Gov (2):** Declare fee from zero reverts (B17), execute rejects legacy declarations (B19)

**Legacy SSV (1):** SSV liquidation resets and pays (B15)

**DAO Formula (1):** DAO earnings matches formula exactly (C4)

**Acceptance Criteria:**
- [ ] All 8 invariants implemented and passing
- [ ] Merkle tree builder added to harness for valid proof happy paths
- [ ] Each invariant documented in `test/echidna/README.md`

---

### [FUZZ-4] Add 6 lower-priority echidna invariants (heavy harness)
- **Type:** Echidna Invariant Suite
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add 6 lower-priority invariants requiring significant harness work. Full list in `test/echidna/README.md` under "Lower Priority". Summary:

**vUnit Aggregation (2):** DAO vUnits = sum of clusters (C5), operator vUnits matches clusters (C6)

**Migration (1):** Migration one-way and returns SSV (C7)

**Overflow/Extreme (3):** ETH accrual no overflow (X4), SSV accrual no overflow (X5), intermediate mul no overflow (X6), pack reverts on overflow (X7)

**Acceptance Criteria:**
- [ ] All invariants implemented and passing
- [ ] Delta-block simulator added for overflow testing
- [ ] Max-parameter configurator added
- [ ] Per-cluster EB tracking arrays added
- [ ] Each invariant documented in `test/echidna/README.md`

---

### [FUZZ-5] ETH contract balance accounting invariant
- **Type:** Echidna Invariant Suite
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add an Echidna invariant that continuously asserts the ETH accounting identity:

```
address(this).balance == Σ(cluster.balance) + Σ(operator.ethEarnings) + ethDaoBalance + stakingEthPoolBalance
```

**Context:**
Product raised the question of whether `withdraw` needs an explicit `amount <= address(this).balance` guard. The answer is: not as a runtime check — if accounting is correct, `cluster.balance` is always ≤ `address(this).balance` by construction. However, this invariant should be continuously enforced by fuzzing to catch any accounting divergence (rounding errors, missed fee settlement paths, ETH drain via another function). A violation means a protocol bug, not a user error. See FLOWS.md §1.8 for the full rationale.

**Acceptance Criteria:**
- [ ] Echidna invariant `echidna_eth_balance_accounting` implemented in the staking/cluster harness
- [ ] Invariant asserts `address(this).balance >= sum_of_all_cluster_balances + sum_of_operator_eth_earnings + ethDaoBalance + stakingEthPoolBalance` after every operation
- [ ] Harness tracks all cluster balances and operator earnings across stake/unstake/deposit/withdraw/liquidate/reactivate flows
- [ ] No invariant violations in fuzz runs

**Agent Instructions:**
1. Read `test/echidna/` for existing harness patterns and how cluster/operator state is tracked.
2. Add a new invariant function that sums all tracked cluster balances and operator ETH earnings and compares to `address(this).balance`.
3. Ensure the harness exercises all ETH-moving operations: `deposit`, `withdraw`, `liquidate`, `reactivate`, `claimEthRewards`, `withdrawNetworkETHEarnings`, `withdrawOperatorEarnings`.
4. Run Echidna and confirm no violations.

#### Sub-items:
- [ ] Sub-task 1: Implement `echidna_eth_balance_accounting` invariant
- [ ] Sub-task 2: Extend harness to track all ETH-moving operations
- [ ] Sub-task 3: Run Echidna and confirm no violations

---

## Code Quality

### [QUALITY-1] `operatorFeeChangeRequests` not cleared on operator removal
- **Type:** Code Quality
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Clear `operatorFeeChangeRequests[operatorId]` in `_resetOperatorState` when an operator is removed.

**Context:**
In `SSVOperators.sol:324-335`, `_resetOperatorState` doesn't delete stale fee change requests for the removed operator. No functional impact since `declareOperatorFee` and `executeOperatorFee` both check `checkOwner()` first (which reverts for removed operators), but the stale data wastes storage and could confuse off-chain readers querying operator fee change requests.

**Acceptance Criteria:**
- [ ] `delete s.operatorFeeChangeRequests[operatorId]` added to `_resetOperatorState`
- [ ] Existing removal tests pass
- [ ] New test: declare fee change, remove operator, verify fee change request is cleared

#### Sub-items:
- [ ] Sub-task 1: Add fee change request cleanup to `_resetOperatorState`
- [ ] Sub-task 2: Add test verifying cleanup
- [ ] Sub-task 3: Run full test suite

---

### [QUALITY-2] ~~Redundant `SSVStorage.load()` calls in view function loops~~
- **Type:** Code Quality
- **Priority:** P2
- **Status:** ✅ Fixed
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** (empty)

**Resolution:**
Hoisted `SSVStorage.load()` to a single pre-loop `StorageData storage s` in all affected functions in `SSVViews.sol`: `isLiquidatable`, `isLiquidatableSSV`, `getBurnRate`, `getBurnRateSSV`, `getBalance`, `getBalanceSSV` (redundant in-loop calls), and `getOperatorById`, `getOperatorByIdSSV` (redundant double-load for whitelist access). Also fixed `getOperatorFeePeriods` which called `SSVStorageProtocol.load()` twice. All 516 unit tests pass.

**Acceptance Criteria:**
- [x] `SSVStorage.load()` called once before each loop, stored in a local variable
- [x] Same pattern applied to `SSVStorageProtocol.load()` where it had the same issue
- [x] Existing view tests pass with identical return values

#### Sub-items:
- [x] Sub-task 1: Identify all redundant `load()` calls in loops
- [x] Sub-task 2: Hoist to pre-loop variables
- [x] Sub-task 3: Run full test suite

---

### [QUALITY-3] ~~`withdraw` in SSVClusters duplicates operator loop inline~~
- **Type:** Code Quality
- **Priority:** P2
- **Status:** ✅ Fixed
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** (empty)

**Resolution:**
Fixed the immediate issue: `SSVClusters.withdraw()` was calling `SSVStorage.load()` on every loop iteration despite `s` already being loaded at the top of the function. Changed `SSVStorage.load().operators[operatorIds[i]]` to `s.operators[operatorIds[i]]`. The larger refactor (extracting the loop into a shared `OperatorLib` helper) was scoped out as it would require a more invasive interface change across multiple callers; the redundant-load bug is the actionable fix. All 516 unit tests pass.

**Acceptance Criteria:**
- [x] Redundant `SSVStorage.load()` inside loop eliminated — uses already-loaded `s`
- [x] Behavior is identical before and after
- [x] All withdrawal tests pass

#### Sub-items:
- [x] Sub-task 1: Replace `SSVStorage.load()` in loop with already-loaded `s`
- [x] Sub-task 2: Run full test suite

---

### [QUALITY-4] `_resetOperatorState` returns unused `Operator memory`
- **Type:** Code Quality
- **Priority:** P3
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Remove the unused return value from `_resetOperatorState` to save gas.

**Context:**
In `SSVOperators.sol:324`, `_resetOperatorState` returns `Operator memory` but the caller at line 82 discards the return value. The unnecessary SLOAD to populate the return struct wastes ~2100 gas per operator removal.

**Acceptance Criteria:**
- [ ] `_resetOperatorState` changed to return `void` (no return value)
- [ ] Caller at line 82 updated to not expect a return value
- [ ] Existing operator removal tests pass

#### Sub-items:
- [ ] Sub-task 1: Remove return value from `_resetOperatorState`
- [ ] Sub-task 2: Update caller
- [ ] Sub-task 3: Run full test suite

---

### [QUALITY-5] ~~Remove duplicate `MaxValueExceeded` error declaration~~
- **Type:** Code Quality
- **Priority:** P3
- **Status:** ✅ Fixed
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** (empty)

**Requirement:**
Remove the duplicate `MaxValueExceeded` error declaration that appears in both `ISSVNetworkCore.sol` and `SSVPackedLib.sol`, causing duplication in the generated ABI.

**Context:**
The `MaxValueExceeded` error is declared in two places:
1. `ISSVNetworkCore.sol:205` - `error MaxValueExceeded(); // 0x91aa3017`
2. `SSVPackedLib.sol:10` - `error MaxValueExceeded();`

This duplication results in the same error appearing twice in the generated ABI (`SSVNetwork.json:229-238`), which can cause confusion for tooling and integrations that expect unique error signatures.

**Resolution:**
Removed the duplicate `error MaxValueExceeded()` from `PackingLib` in `SSVPackedLib.sol`. Added `import {ISSVNetworkCore} from "../interfaces/ISSVNetworkCore.sol"` and changed the revert to `revert ISSVNetworkCore.MaxValueExceeded()`. The canonical declaration remains in `ISSVNetworkCore.sol` where `ProtocolLib.sol` already references it. Both had identical selector `0x91aa3017`, so no ABI change. All 1188 tests pass.

**Acceptance Criteria:**
- [x] Remove duplicate `MaxValueExceeded` declaration from `SSVPackedLib.sol`
- [x] Keep the declaration in `ISSVNetworkCore.sol` (canonical location for all protocol errors)
- [x] Verify the generated ABI no longer has duplicate entries
- [x] Ensure all existing tests still pass
- [x] Confirm no contracts rely on the specific error signature from the removed location

#### Sub-items:
- [x] Sub-task 1: Determine which file should keep the `MaxValueExceeded` declaration — `ISSVNetworkCore.sol`
- [x] Sub-task 2: Remove the duplicate declaration from `SSVPackedLib.sol`, import interface, update revert
- [x] Sub-task 3: Verify compilation and ABI
- [x] Sub-task 4: Run full test suite to ensure no regressions

---

### [BUG-10] Stale Merkle root vulnerability in `updateClusterBalance`
- **Type:** Critical Bug Fix
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Fix the vulnerability where `updateClusterBalance` can accept stale Merkle roots when `minBlocksBetweenUpdates != 0`, allowing malicious actors to delay effective balance updates.

**Context:**
In `SSVClusters.sol:353-371`, the `updateClusterBalance` function validates Merkle proofs against the current oracle root. However, if a cluster's effective balance hasn't changed for a long time, there's no incentive to call `updateClusterBalance` for that cluster. A malicious actor could intentionally use an old Merkle root to delay updating to the most recent effective balance when `minBlocksBetweenUpdates != 0`.

**Vulnerability Details:**
1. The function validates the Merkle proof against the current oracle root
2. If `minBlocksBetweenUpdates > 0`, updates are rate-limited
3. For clusters with unchanged effective balances, no one calls `updateClusterBalance`
4. An attacker can submit stale proofs using old roots to prevent EB updates
5. This allows manipulation of when effective balance changes take effect

**Current Mitigation:**
The issue is currently mitigated because `minBlocksBetweenUpdates` is always set to 0, meaning there's no rate limiting on updates. However, if the protocol intends to enable rate limiting in the future, this vulnerability becomes active.

**Acceptance Criteria:**
- [ ] Product team confirms whether `minBlocksBetweenUpdates` will be enabled in future
- [ ] If yes: Implement validation to prevent stale Merkle root usage
- [ ] Consider adding a timestamp/block number check to ensure proofs use recent roots
- [ ] Add test coverage for this scenario
- [ ] Document the expected behavior when `minBlocksBetweenUpdates > 0`

#### Sub-items:
- [ ] Sub-task 1: Confirm product requirements for `minBlocksBetweenUpdates`
- [ ] Sub-task 2: Design solution to prevent stale Merkle root usage
- [ ] Sub-task 3: Implement the fix
- [ ] Sub-task 4: Add comprehensive test coverage
- [ ] Sub-task 5: Update documentation

---

### [BUG-11] Remove liquidation check in `withdraw` function
- **Type:** Code Quality
- **Priority:** P2
- **Status:** ✅ Fixed
- **Owner:** (unassigned)
- **Timeline:** (complete)
- **Github Link:** (empty)

**Requirement:**
Remove the `cluster.validateClusterIsNotLiquidated()` check from the `withdraw` function in `SSVClusters.sol`.

**Context:**
In `SSVClusters.sol:215`, the `withdraw` function prevents withdrawals from liquidated clusters. This restriction is unnecessarily restrictive: users may deposit funds to prepare a liquidated cluster for reactivation but later decide not to reactivate. In this scenario, they should be able to withdraw their deposited funds without being forced to complete the reactivation. The liquidation check should be removed to allow this flexibility.

**Rationale:**
- Users can deposit to liquidated clusters (allowed by design, see SEC-12)
- If users change their mind about reactivation, they should be able to retrieve their deposits
- The balance accounting is correct whether the cluster is liquidated or not
- **IMPORTANT:** Double-check this change with Product team before implementation to ensure it aligns with intended UX

**Acceptance Criteria:**
- [x] Product team approval obtained for this change
- [x] Remove `cluster.validateClusterIsNotLiquidated()` from `withdraw` function (line 215)
- [x] Add test: deposit to liquidated cluster, then withdraw without reactivating
- [x] Verify existing withdrawal tests still pass
- [x] Update FLOWS.md to document that withdrawals are allowed on liquidated clusters

#### Sub-items:
- [x] Sub-task 1: Get Product team approval
- [x] Sub-task 2: Remove `cluster.validateClusterIsNotLiquidated()` from `SSVClusters.sol:withdraw` (was line 215)
- [x] Sub-task 3: Added tests: `withdraw.test.ts` — "Withdraws deposited funds from a liquidated cluster without reactivating" and "Withdraws full balance from a liquidated cluster that received multiple deposits"
- [x] Sub-task 4: Updated `docs/FLOWS.md` §1.8 preconditions to explicitly allow liquidated clusters

---

### [BUG-12] `removeValidator` / `bulkRemoveValidator` blocked for legacy SSV clusters
- **Type:** Critical Bug Fix
- **Priority:** P1
- **Status:** ✅ Done (Product approved)
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** (empty)

**Requirement:**
Allow `removeValidator` and `bulkRemoveValidator` to operate on legacy SSV clusters, not just ETH clusters.

**Context:**
`_bulkRemoveValidator` in `SSVValidators.sol:177` calls `ClusterLib.validateClusterVersion(version, VERSION_ETH)`, which reverts with `IncorrectClusterVersion` for any SSV cluster. This means owners of legacy SSV clusters cannot remove individual validators — they can only exit (signal off-chain) or migrate the entire cluster to ETH. This is a UX regression from v1.x where `removeValidator` worked on all clusters.

The SSV cluster removal path is distinct from the ETH path in two ways:
1. It uses `s.clusters` (SSV storage) instead of `s.ethClusters`
2. It does not involve ETH snapshot updates or EB deviation cleanup

The fix requires branching `_bulkRemoveValidator` on `version`: for `VERSION_SSV`, use the legacy SSV cluster removal path (update SSV operator snapshots, decrement `operator.validatorCount`, update SSV cluster hash in `s.clusters`); for `VERSION_ETH`, keep the existing ETH path.

**Rationale:**
- SSV cluster owners may want to remove specific validators without migrating the entire cluster
- Without this, the only way to reduce validator count in a legacy cluster is full migration
- The FLOWS.md and SPEC.md already document SSV cluster operations as including `removeValidator` (see FLOWS §1.10, SPEC §1 "Existing Clusters")
- **IMPORTANT:** Confirm with Product team whether this is intentionally blocked or an oversight

**Acceptance Criteria:**
- [x] Product team approval obtained
- [x] `_bulkRemoveValidator` branches on `version`: `VERSION_SSV` uses SSV cluster path, `VERSION_ETH` uses ETH cluster path
- [x] SSV path: updates SSV operator snapshots (`operator.snapshot`), decrements `operator.validatorCount`, updates `s.clusters[hashedCluster]`
- [x] SSV path: does NOT touch ETH snapshots, `ethValidatorCount`, `ethClusters`, or EB storage
- [x] Add test: remove validator from active SSV cluster, verify SSV cluster hash updated and operator count decremented
- [x] Add test: remove validator from liquidated SSV cluster (should be allowed — no active-cluster check in current code)
- [x] Existing ETH removal tests still pass
- [x] Update FLOWS §1.3 and §1.4 to document SSV cluster support

#### Sub-items:
- [x] Sub-task 1: Get Product team approval
- [x] Sub-task 2: Branch `_bulkRemoveValidator` on cluster version
- [x] Sub-task 3: Implement SSV cluster removal path
- [x] Sub-task 4: Add unit tests
- [x] Sub-task 5: Update FLOWS.md §1.3 and §1.4

---

### [BUG-13] Silent default ETH fee assignment for legacy operators during migration
- **Type:** Observability Fix
- **Priority:** P2
- **Status:** ✅ Fixed
- **Owner:** Claude Code
- **Timeline:** 2026-03-04
- **Github Link:** [PR #502](https://github.com/ssvlabs/ssv-network/pull/502)

**Requirement:**
Emit `OperatorFeeExecuted` event when legacy SSV operators receive the default ETH fee (1_770_000_000 wei/vUnit/block) during migration to ETH operations.

**Context:**
When legacy SSV operators (operators with `operator.ethSnapshot.block == 0` and `operator.fee != 0`) first interact with ETH clusters (via `registerValidator`, `migrateClusterToETH`, or `declareOperatorFee`), the `ensureETHDefaults` function in `OperatorLib.sol` automatically assigns `DEFAULT_OPERATOR_ETH_FEE` to `operator.ethFee`. Previously, this assignment was silent — no event was emitted.

This created an observability gap for indexers and offchain services:
- No way to track when operators receive default ETH fees
- Difficult to distinguish between default fee assignment and explicit fee declarations
- Indexers had to infer fee values from storage rather than events

**Solution (PR #502):**
Modified `ensureETHDefaults` to:
1. Accept `operatorId` as a parameter (previously had no params)
2. Emit `OperatorFeeExecuted(operator.owner, operatorId, block.number, DEFAULT_OPERATOR_ETH_FEE)` when assigning default fee
3. Updated all callsites to pass `operatorId`:
   - `OperatorLib.updateClusterOperatorsOnRegistration` (line 201)
   - `OperatorLib.updateClusterOperatorsMigration` (line 396)
   - `SSVOperators.declareOperatorFee` (line 107)

**Code Changes:**
- `contracts/libraries/OperatorLib.sol:143`: Modified function signature and added event emission
- `contracts/libraries/OperatorLib.sol:201,396`: Updated callsites
- `contracts/modules/SSVOperators.sol:107`: Updated callsite

**Benefits:**
- ✅ Indexers can track all operator fee changes via events (consistent observability)
- ✅ Backward compatible (reuses existing `OperatorFeeExecuted` event signature)
- ✅ Idempotent (event emitted only once per operator due to `ethSnapshot.block` guard)
- ✅ Bug fix bonus: Removed duplicate `if (operator.ethSnapshot.block == 0)` check

**Security Analysis:**
- ✅ No vulnerabilities (LOW risk)
- ✅ Idempotency guaranteed (guard prevents re-execution)
- ✅ State consistency (event emitted after state changes)
- ✅ No reentrancy risk (internal function, no external calls)
- ✅ Event parameters trustworthy (`operator.owner`, `operatorId`, `block.number`, constant)

**Test Coverage:**
- ✅ Migration path: [migrateClusterToETH.test.ts:101-132](test/unit/SSVClusters/migrateClusterToETH.test.ts#L101-L132)
- ✅ Register validator path: [registerValidator.test.ts:65-81](test/unit/SSVValidator/registerValidator.test.ts#L65-L81)
- ✅ Declare fee path: [declareOperatorFee.test.ts:140-158](test/unit/SSVOperators/declareOperatorFee.test.ts#L140-L158)
- ✅ Idempotency: [migrateClusterToETH.test.ts:134-197](test/unit/SSVClusters/migrateClusterToETH.test.ts#L134-L197) — NEW TEST

**Acceptance Criteria:**
- [x] `ensureETHDefaults` emits `OperatorFeeExecuted` when assigning default ETH fee to legacy operators
- [x] Event parameters correct: `(operator.owner, operatorId, block.number, DEFAULT_OPERATOR_ETH_FEE)`
- [x] Event emitted only once per operator (idempotent)
- [x] All three call paths tested (migration, register, declare)
- [x] Idempotency test added
- [x] Security analysis confirms LOW risk
- [x] Backward compatible (no event signature changes)
- [x] Gas impact acceptable (~1500 gas per operator, one-time)

#### Sub-items:
- [x] Modify `ensureETHDefaults` to accept `operatorId` and emit event
- [x] Update all callsites (3 locations)
- [x] Add idempotency test
- [x] Security review (ssv-bug-fixer)
- [x] Test coverage review (ssv-test-writer)

---

### [BUG-14] Removed operator SSV fees skipped during `migrateClusterToETH` fee settlement (double-payment)
- **Type:** Critical Bug Fix
- **Priority:** P1
- **Status:** ⚠️ Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
When migrating an SSV cluster to ETH, SSV fee settlement must include fee debt already accrued by operators that were removed before migration.

**Context:**
`migrateClusterToETH` settles SSV balance using `cluster.updateBalanceSSV(clusterIndexSSV, sp.currentNetworkFeeIndexSSV())`, where `clusterIndexSSV` is returned by `OperatorLib.updateClusterOperatorsMigration`.

In `updateClusterOperatorsMigration`, removed operators are skipped entirely:
- `if (operator.snapshot.block == 0 && operator.ethSnapshot.block == 0) continue;`

If operator A is removed after accruing SSV fees:
1. `removeOperator` settles and pays A's SSV snapshot to A's owner.
2. Migration later skips A, so A's accrued index contribution is not included in `clusterIndexSSV`.
3. Cluster SSV usage is under-counted during migration.
4. Cluster owner receives inflated SSV refund.

This creates an economic double-payment pattern: once to the removed operator owner, and again via inflated migration refund.

**Reproduction (implemented):**
- `test/e2e/migration/migration-double-payment.test.ts`
  - Test: `"Demonstrates double-payment with exact accounting: remove payout + inflated migration refund"`
  - Uses exact formula assertions for expected correct refund vs actual buggy refund.

**Acceptance Criteria:**
- [ ] Migration SSV settlement includes fee debt from removed operators that were part of the SSV cluster history
- [ ] Cluster owner migration refund equals exact expected amount from SPEC/FLOWS formulas (no under-deduction)
- [ ] No operator can be paid twice for the same SSV fee accrual window (direct earnings + inflated cluster refund)
- [ ] Regression test remains green and fails on old behavior:
  - `test/e2e/migration/migration-double-payment.test.ts`

**Agent Instructions:**
1. Read `contracts/libraries/OperatorLib.sol:updateClusterOperatorsMigration`.
2. Read `contracts/modules/SSVClusters.sol:migrateClusterToETH` SSV settlement path.
3. Ensure migration SSV settlement accounts for removed-operator historical debt correctly.
4. Keep existing valid behavior where removed operators do not receive new post-removal accrual.
5. Run targeted tests and `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Fix migration SSV fee-settlement accounting for removed operators
- [ ] Sub-task 2: Keep/extend exact-formula reproduction test
- [ ] Sub-task 3: Run unit + e2e migration suites

---

### [BUG-14b] `reduceOperatorFee` / `declareOperatorFee` overwrite explicit zero ETH fees for legacy SSV operators
- **Type:** Critical Bug Fix
- **Priority:** P1
- **Status:** ✅ Fixed
- **Owner:** Claude Code
- **Timeline:** 2026-03-06
- **Github Link:** (embedded in `ssv-staking` branch, commit `8185b1c`)

**Requirement:**
Allow legacy SSV operators (SSV fee > 0) to explicitly set ETH fee = 0 and preserve this choice during cluster migration and fee operations.

**Context:**
When a legacy SSV operator (registered pre-v2.0.0) with SSV fee > 0 calls `reduceOperatorFee` or `declareOperatorFee` to set `ethFee = 0`, the system should remember this explicit choice. Previously, `ensureETHDefaults` could not distinguish between:

1. **"Never set ETH fee"** (should get `DEFAULT_OPERATOR_ETH_FEE`)
2. **"Explicitly set ETH fee to zero"** (should keep zero)

Both states resulted in `ethFee == 0 && ethSnapshot.block == 0`, causing `ensureETHDefaults` to overwrite explicit zero fees with `DEFAULT_OPERATOR_ETH_FEE` during subsequent operations (like cluster migration).

**Root Cause:**
`reduceOperatorFee` and `declareOperatorFee` did not initialize `ethSnapshot.block` before updating fees, leaving the operator in an "uninitialized" state even after explicit fee changes.

**Solution (ethSnapshot.block marker pattern):**

1. **Marker Logic:** Use `ethSnapshot.block > 0` as a marker indicating "operator has explicitly interacted with ETH fee system"

2. **Code Changes:**
   - `SSVOperators.reduceOperatorFee` (line 187-189): Added `ensureETHDefaults` call if `ethSnapshot.block == 0`
   - `SSVOperators.declareOperatorFee` (line 106-108): Already had `ensureETHDefaults` call
   - `OperatorLib.ensureETHDefaults` (line 144-152): Only assigns default if `ethSnapshot.block == 0 && ethFee == 0 && SSV fee > 0`

3. **Flow:**
   - **First ETH interaction** (ethSnapshot.block == 0):
     - Call `ensureETHDefaults`
     - If SSV fee > 0: assigns `ethFee = DEFAULT_OPERATOR_ETH_FEE`
     - Sets `ethSnapshot.block = block.number` (marker)
     - Operator can then reduce to any value (including 0)

   - **Subsequent operations** (ethSnapshot.block > 0):
     - `ensureETHDefaults` sees marker and **skips** (no overwrite)
     - Explicit zero fees preserved during migration

**Acceptance Criteria:**
- [x] `reduceOperatorFee` calls `ensureETHDefaults` before updating fee
- [x] `declareOperatorFee` calls `ensureETHDefaults` before declaring new fee
- [x] `ethSnapshot.block > 0` prevents `ensureETHDefaults` from overwriting explicit fees
- [x] Legacy SSV operator can set `ethFee = 0` via `reduceOperatorFee(operatorId, 0)`
- [x] Migration respects explicit zero fees (no overwrite to default)
- [x] Comprehensive test suite (15 unit tests + 3 E2E tests)
- [x] Documentation updated (SPEC.md §1, FLOWS.md §4.3 & §4.5)

**Code Changes:**
- `contracts/modules/SSVOperators.sol:187-189` — Added `ensureETHDefaults` call in `reduceOperatorFee`
- `contracts/test/harness/SSVOperatorsHarness.sol:103-123` — Added mock functions for testing
- `test/unit/SSVOperators/reduceOperatorFee-ethSnapshot-init.test.ts` — **15 comprehensive tests (ALL PASSING)**
- `test/e2e/operators/operator-lifecycle.test.ts:582-699` — **3 integration tests**
- `docs/SPEC.md:257-279` — Documented `ensureETHDefaults` behavior
- `docs/FLOWS.md:631-704` — Updated operator fee flows

**Test Coverage:**
- ✅ ethSnapshot initialization on first `reduceOperatorFee`
- ✅ Legacy SSV operator gets default fee before reduction
- ✅ Legacy SSV operator can reduce to zero (explicit zero fee)
- ✅ Zero-fee operator (SSV fee = 0) stays at zero
- ✅ `ethSnapshot.block > 0` prevents overwrite during migration
- ✅ Fee validation (too low, too high, same value)
- ✅ Event emission (dual events when default assigned)
- ✅ E2E: explicit zero fee preserved across operations

**Benefits:**
- ✅ **Operator autonomy:** Operators can offer free ETH service while maintaining SSV presence
- ✅ **Predictable fees:** Cluster owners know exact fees during migration
- ✅ **Backward compatible:** No storage changes, uses existing field as marker
- ✅ **No gas overhead:** Initialization happens once per operator
- ✅ **Consistent behavior:** Same pattern across all fee operations

**Security Analysis:**
- ✅ No vulnerabilities (LOW risk)
- ✅ Idempotency guaranteed (`ethSnapshot.block` guard)
- ✅ State consistency (marker set atomically with default assignment)
- ✅ No reentrancy risk (internal function, state writes before external calls)
- ✅ Marker cannot be manipulated (contract-controlled)

**Documentation:**
- ✅ SPEC.md §1 "Operator Fee Transition" — Complete `ensureETHDefaults` behavior
- ✅ FLOWS.md §4.3 "Declare Operator Fee" — State mutations and events
- ✅ FLOWS.md §4.5 "Reduce Operator Fee" — Special cases and postconditions

**Related Issues:**
- BUG-13: Event emission for default fee assignment (PR #502) — Complementary fix
- SEC-16b: Similar pattern (using storage field as marker for explicit behavior)

#### Sub-items:
- [x] Add `ensureETHDefaults` call to `reduceOperatorFee`
- [x] Create comprehensive test suite (15 unit tests)
- [x] Add E2E integration tests (3 tests)
- [x] Update SPEC.md and FLOWS.md documentation
- [x] Verify all tests passing (18/18 tests ✅)
- [x] Document marker pattern and behavior

---

### [BUG-15] `withdrawAllVersionOperatorEarnings` initializes ETH snapshot for legacy SSV-only operators
- **Type:** Critical Bug Fix
- **Priority:** P1
- **Status:** ✅ Fixed
- **Owner:** Claude Code
- **Timeline:** 2026-03-12
- **Github Link:** (embedded in `ssv-staking` branch)

**Requirement:**
Fix `withdrawAllVersionOperatorEarnings` so it settles SSV and ETH earnings independently and never initializes ETH state for a legacy SSV-only operator.

**Context:**
The previous implementation loaded the operator into memory, called `updateSnapshots(operatorId)`, then wrote the full struct back to storage. That helper always advanced `ethSnapshot.block`, even when the operator was legacy SSV-only with:
- `fee != 0`
- `ethFee == 0`
- `snapshot.block != 0`
- `ethSnapshot.block == 0`

This created the inconsistent state `ethSnapshot.block != 0 && ethFee == 0` without any ETH-specific operator action. Once created, later migration logic treated the operator as already ETH-initialized and preserved the zero ETH fee.

**Vulnerability Details:**
When `withdrawAllVersionOperatorEarnings` is called, the function should behave like `_withdrawOperatorEarnings` for each version separately, but without checking a requested `amount`:

- If the operator has `snapshot.block != 0`:
  - `OperatorLib.updateSnapshotStSSV(operator);`
  - `PackedSSV ssvBalance = operator.snapshot.balance;`
  - `operator.snapshot.balance = PACKED_SSV_ZERO;`
- If the operator has `ethSnapshot.block != 0`:
  - `OperatorLib.updateSnapshotSt(operator, operatorId);`
  - `PackedETH ethBalance = operator.ethSnapshot.balance;`
  - `operator.ethSnapshot.balance = PACKED_ETH_ZERO;`

The bug was that the combined `updateSnapshots` helper ignored version separation and unconditionally wrote a fresh ETH snapshot block into legacy SSV-only operator state.

**Resolution:**
- `SSVOperators.withdrawAllVersionOperatorEarnings` now uses a storage reference and settles the SSV and ETH branches independently.
- `OperatorLib.updateSnapshots` was removed because this mixed-version memory helper was only used by the buggy path.
- `OperatorLib.updateSnapshotsSt` was kept unchanged pending broader review of its remaining call sites.

**Acceptance Criteria:**
- [x] `withdrawAllVersionOperatorEarnings` only updates SSV snapshot when `snapshot.block != 0`
- [x] `withdrawAllVersionOperatorEarnings` only updates ETH snapshot when `ethSnapshot.block != 0`
- [x] Legacy SSV-only operators keep `ethSnapshot.block == 0` after `withdrawAllVersionOperatorEarnings`
- [x] ETH and SSV balances still withdraw correctly for operators with initialized state
- [x] Unit test added for the legacy SSV-only path

**Code Changes:**
- `contracts/modules/SSVOperators.sol` — Inlined per-version settlement logic in `withdrawAllVersionOperatorEarnings`
- `contracts/libraries/OperatorLib.sol` — Removed obsolete `updateSnapshots` helper
- `test/unit/SSVOperators/withdrawAllVersionOperatorEarnings.test.ts` — Added legacy SSV-only regression coverage

#### Sub-items:
- [x] Inline per-version settlement logic in `withdrawAllVersionOperatorEarnings`
- [x] Remove obsolete `OperatorLib.updateSnapshots`
- [x] Add unit test for legacy SSV-only withdrawal behavior
- [ ] Run broader suite if needed

---

### [BUG-17] `commitRoot` quorum can become unreachable due to truncation in per-oracle weight math
- **Type:** Critical Bug Fix
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** Before mainnet launch
- **Github Link:** (empty)

**Requirement:**
Fix `commitRoot` so that the configured oracle quorum remains reachable even when the frozen cSSV supply for a voting round is not divisible by the oracle count.

**Context:**
`commitRoot` freezes `cSSV.totalSupply()` on the first vote of a `(blockNum, merkleRoot)` round to prevent inter-vote supply drift. That mitigation is correct and must remain in place. However, the function then computes:
- `weight = totalStaked / defaultOracleIds.length`
- `threshold = (totalStaked * quorumBps) / 10_000`

This mixes two separately-truncated quantities. With 4 oracle slots and 75% quorum, if the frozen supply is `4q + 2` or `4q + 3`, three votes accumulate only `3q` weight while the threshold becomes `3q + 1`, so 3-of-4 consensus is mathematically unreachable. At 100% quorum, even 4 votes fail whenever the frozen supply is not divisible by 4.

This is distinct from the already-mitigated front-running issue tracked in SEC-5. Freezing supply removes the moving-target quorum problem between votes; it does not remove truncation mismatch inside the fixed round arithmetic.

**Vulnerability Details:**
- The bug is present in `contracts/modules/SSVDAO.sol` where vote weight and threshold are derived from the same frozen supply but rounded in different ways.
- The current specs mirror the same arithmetic, so documentation does not currently protect against the edge case.
- A minimal regression test now demonstrates the issue in `test/unit/SSVDAO/commitRoot.test.ts`: with `totalSupply = 1_000_000_002` and `quorumBps = 7500`, the third oracle vote should commit under intended 3-of-4 semantics, but does not.

**Proposed Fix:**
Keep the `token weight` model, but normalize the frozen supply once on the first vote of the round and store the truncated voting supply in `roundFrozenSupply`:

```solidity
uint256 oracleCount = s.defaultOracleIds.length;
uint256 rawSupply = ICSSVToken(CSSV_ADDRESS).totalSupply();
if (rawSupply == 0) revert ZeroCSSVSupply();

uint256 totalStaked = rawSupply - (rawSupply % oracleCount);
if (totalStaked == 0) revert InsufficientCSSVSupply();

seb.roundFrozenSupply[commitmentKey] = totalStaked;

uint256 weight = totalStaked / oracleCount;
seb.rootCommitments[commitmentKey] += weight;
uint256 threshold = (totalStaked * s.quorumBps) / BPS_DENOMINATOR;
```

This preserves:
- `token weight`-based quorum math
- current storage layout and event shape
- frozen per-round vote math using one stored value for all later votes
- current behavior where quorum updates between votes affect the next vote

It also removes the truncation mismatch by ensuring both `weight` and `threshold` use the same stored voting supply, while treating `rawSupply % oracleCount` as non-voting dust.

**Acceptance Criteria:**
- [ ] With 4 oracles and `quorumBps = 7500`, the third vote commits even when frozen supply is not divisible by 4
- [ ] With 4 oracles and `quorumBps = 10000`, the fourth vote commits even when frozen supply is not divisible by 4
- [ ] With 4 oracles and `quorumBps = 8000`, 3 votes do not commit and the fourth vote does
- [ ] `roundFrozenSupply` stores the truncated frozen voting supply and still fixes inter-vote supply drift
- [ ] No storage layout changes are introduced
- [ ] Rounds with `totalSupply == 0` revert with `ZeroCSSVSupply`
- [ ] Rounds with `0 < totalSupply < oracleCount` revert with `InsufficientCSSVSupply`
- [ ] Existing quorum behavior for low thresholds (for example `quorumBps = 1`) remains intact
- [ ] Unit test coverage includes truncation regression cases for 75%, 80%, and 100% quorum

**Agent Instructions:**
1. Read `contracts/modules/SSVDAO.sol`, focusing on `commitRoot`.
2. Keep the current storage layout and do not add a new storage mapping such as `rootVotes`.
3. On the first vote of a round, read raw `cSSV.totalSupply()`, truncate it by `defaultOracleIds.length`, and store that truncated value in `roundFrozenSupply`.
4. Compute both `weight` and `threshold` from the stored truncated supply.
5. Update or extend unit tests in `test/unit/SSVDAO/commitRoot.test.ts` to cover:
   - 75% quorum with non-divisible frozen supply
   - 100% quorum with non-divisible frozen supply
   - 80% quorum with non-divisible frozen supply
   - `totalSupply < oracleCount`
   - truncated value persisted in `roundFrozenSupply`
6. Update `docs/SPEC.md` and `docs/FLOWS.md` to describe truncated frozen voting supply in token-weight space while still noting that supply is frozen per round.

#### Sub-items:
- [x] Add failing regression test demonstrating unreachable 3-of-4 quorum with non-divisible supply
- [ ] Patch `commitRoot` threshold math without storage-layout changes
- [ ] Add regression test for 100% quorum with non-divisible supply
- [ ] Update SPEC/FLOWS to reflect corrected quorum calculation
- [ ] Run targeted DAO/oracle tests and verify no regressions

---

## Changes from DIP-X Review

**Date:** 2026-02-17
**Sources:** `ssv-review/planning/verified/dip-review-eth-payments.md`, `ssv-review/planning/verified/dip-review-effective-balance.md`, `ssv-review/planning/verified/dip-review-ssv-staking.md`

### New Items Added (6)

| ID | Title | Source Finding | Rationale |
|----|-------|---------------|-----------|
| BUG-7 | `DEFAULT_OPERATOR_ETH_FEE` value deviates from DIP-X spec | ETH-7, ETH-14 | Implementation uses 1,770,000,000 wei but closest packable value to DIP spec is 1,775,500,000 wei (~0.31% deviation) |
| BUG-8 | Cooldown duration uses `block.timestamp` but DIP specifies blocks | DIP-8 | HIGH risk: if initial value set as 50120 (blocks), actual cooldown would be ~13.9 hours instead of 7 days |
| SEC-9 | `operatorMaxFee` function signature differs from DIP-X spec | ETH-13 | DIP says `uint64`, implementation uses `uint256`; cosmetic but should be aligned |
| SEC-10 | cSSV token lacks governance/voting extensions | DIP-10 | DIP claims cSSV retains governance power, but `CSSVToken` has no `ERC20Votes`; depends on off-chain Snapshot config |
| DEPLOY-5 | Document `operatorMinFee` governance parameter in DIP-X | ETH-20 | DIP leaves update function and initial value blank; implementation has `updateMinimumOperatorEthFee(uint256)` |
| DEPLOY-6 | DIP-X unstaking description doesn't match implementation | DIP-7 | DIP says "lock cSSV → burn later"; code does "burn immediately → return SSV later"; same economics, different UX |

### Existing Items Updated (2)

| ID | Change | Source Finding |
|----|--------|---------------|
| BUG-6 | Added DIP-X review source tag; added context about `_syncFees` behavior when DAO earnings decrease (`current <= previous` edge case) | DIP-18, DIP-19 |
| DEPLOY-3 | Added DIP-X review source tag; added context explaining why DIP value is not packable (`3,550,929,823 % 100,000 = 29,823`) and noting this is a governance responsibility | ETH-10 |

### DIP-X Findings Already Covered by Existing Items (4)

| DIP Finding | Already Covered By | Notes |
|---|---|---|
| EB-OBS-1 (auto-liquidation operator decrement condition) | BUG-5 | Same issue: `_liquidateAfterEBUpdateIfNeeded` condition `op.ethSnapshot.block != 0 && op.snapshot.block != 0` is too strict vs `updateClusterOperators` which only checks `ethSnapshot.block != 0` |
| ETH-19 (migrateClusterToETH lacks nonReentrant) | SEC-6 | Exact same recommendation |
| DIP-18 (zero totalStaked fee loss) | BUG-6 | Exact same issue and recommended fix |
| DIP-23/DIP-24 (no bounds on cooldown/quorum) | SEC-4, SEC-1 | Already covered with same recommendations |

### DIP-X Findings Not Requiring Action (informational only)

| DIP Finding | Verdict | Reason No Action Needed |
|---|---|---|
| ETH-1 through ETH-6 | MATCH | Implementation matches DIP specification |
| ETH-8, ETH-9, ETH-11, ETH-12 | MATCH | Implementation matches DIP specification |
| ETH-15, ETH-16, ETH-21, ETH-22 | MATCH | Implementation matches DIP specification |
| ETH-17, ETH-18, ETH-23 | EXTRA | Implementation adds beneficial features beyond DIP |
| ETH-24 | MATCH | Liquidation check correctly uses vUnit model |
| ETH-25 (no SSV cluster withdrawal) | GAP (minor) | More restrictive than DIP but aligns with migration intent; users can migrate or self-liquidate to recover SSV |
| EB-01 through EB-25 (excl. OBS-1) | MATCH | All core EB accounting claims implemented correctly |
| DIP-1, DIP-2, DIP-4–6 | MATCH | Staking core mechanics implemented correctly |
| DIP-3 (auto-delegation) | PARTIAL | By-design for initial phase; future per-user delegation requires upgrade |
| DIP-9 (min staking amount) | GAP | Implementation adds reasonable dust-prevention constraint not in DIP |
| DIP-11–13, DIP-15–17 | MATCH | Oracle and reward mechanics correct |
| DIP-14 (uint128 overflow) | PARTIAL | Theoretically possible but practically impossible for realistic scenarios |
| DIP-20 (flash-loan prevention) | MATCH | Not vulnerable in current permissioned oracle model |
| DIP-25–28 | MATCH | Revenue source, views, ordering, minting ratio all correct |

---

## Changes from New Audit Findings

**Date:** 2026-02-17
**Sources:** Research-driven gap analysis audit

### Status Updates (4)

| ID | Previous Status | New Status | Rationale |
|----|----------------|------------|-----------|
| BUG-1 | Fixed (verified on `ssv-staking`) | ✅ Fixed | Confirmed fixed in Monday.com |
| BUG-2 | Closed (by design) | Won't Fix (By Design) | Confirmed by-design in Monday.com |
| BUG-3 | Closed (mitigated) | ✅ Mitigated | Confirmed mitigated in Monday.com |
| BUG-5 | Open | ✅ Fixed | Confirmed fixed in Monday.com |

### New Items Added (16)

| ID | Title | Type | Priority |
|----|-------|------|----------|
| BUG-9 | `uint64(delta)` silent truncation in operator earnings accumulation | Critical Bug Fix | P1 |
| SEC-11 | `hasDeviation` reactivation optimization uses global counter for per-operator decision | Security Hardening | P1 |
| SEC-12 | `deposit()` accepts deposits to liquidated ETH clusters without fee settlement | Security Hardening | P2 |
| SEC-13 | `OperatorWithdrawn` event doesn't distinguish ETH vs SSV withdrawals | Security Hardening | P2 |
| SEC-14 | `commitRoot` accepts `bytes32(0)` as merkleRoot — permanently wastes block slot | Security Hardening | P2 |
| SEC-15 | Min/max operator fee can be set to contradictory values | Security Hardening | P2 |
| SEC-16 | Missing zero-value/zero-address guards on deposit and withdraw | Security Hardening | P2 |
| TEST-28 | Uncomment SSV reentrancy test assertions | Unit Test Completeness | P0 |
| TEST-29 | Add contract ETH balance delta assertions to deposit tests | Unit Test Completeness | P1 |
| TEST-30 | Resolve TODO comments with deferred assertions | Unit Test Completeness | P1 |
| TEST-31 | Expand onCSSVTransfer test coverage | Unit Test Completeness | P1 |
| TEST-32 | Add access control tests for DAO governance functions | Unit Test Completeness | P1 |
| DEPLOY-7 | Deploy scripts import from test files | Deployment & Scripts | P2 |
| QUALITY-1 | `operatorFeeChangeRequests` not cleared on operator removal | Code Quality | P2 |
| QUALITY-2 | Redundant `SSVStorage.load()` calls in view function loops | Code Quality | P2 |
| QUALITY-3 | `withdraw` in SSVClusters duplicates operator loop inline | Code Quality | P2 |
| QUALITY-4 | `_resetOperatorState` returns unused `Operator memory` | Code Quality | P3 |

---

## Code Quality — New Tasks

### [QUALITY-6] Multiple Fixture Patterns Across Tests
- **Type:** Code Quality
- **Priority:** P1 (High)
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** After PR #435
- **Github Link:** (empty)

**Issue:**
Tests use different fixture approaches:
1. E2E tests: `ssvNetworkFullFixture(connection)` from `test/e2e/setup/fixtures.ts`
2. Unit tests: `ssvNetwork()` from `test/helpers/contract-helpers.ts`
3. Integration tests: mixed usage

**Impact:**
- Harder to maintain
- Potential inconsistencies in setup state
- Confusing for new contributors

**Recommendation:**
After PR #435 merges, standardize on a single fixture pattern.

**Acceptance Criteria:**
- [ ] One fixture entrypoint used across E2E/unit/integration tests
- [ ] Old fixture helpers removed or thinly re-export the canonical fixture
- [ ] Documentation in `test/` updated to point to the single fixture

---

### [QUALITY-7] Harness Contracts vs. Real Contracts in Tests
- **Type:** Code Quality
- **Priority:** P2 (Medium)
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** After PR #435
- **Github Link:** (empty)

**Issue:**
Some tests use harness contracts (mocks for SSV clusters), while others use real deployments.

**Impact:**
- Harness contracts may not catch production bugs
- Tests with real contracts are more trustworthy

**Recommendation:**
Migrate all E2E tests to use real contracts (per PR #435).

**Acceptance Criteria:**
- [ ] E2E tests run exclusively against real contract deployments
- [ ] Harness usage limited to unit tests where mocking is intentional and documented
- [ ] Any remaining harness usage in E2E is justified in test docs

---

### [QUALITY-8] Helper Function Duplication Across Test Types
- **Type:** Code Quality
- **Priority:** P3 (Low)
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** After PR #435
- **Github Link:** (empty)

**Issue:**
`test/e2e/helpers/` and `test/helpers/contract-helpers.ts` overlap in functionality.

**Impact:**
- Minor maintenance burden
- Low risk of divergence

**Recommendation:**
Merge helper utilities after PR #435.

**Acceptance Criteria:**
- [ ] Single helper module owns shared test utilities
- [ ] Duplicates removed or consolidated
- [ ] Imports updated across test suites

---

### [QUALITY-9] ~~Clear Operator Fee Change Requests on Removal~~
- **Type:** Code Quality
- **Priority:** P2 (Medium)
- **Status:** ✅ Closed
- **Owner:** (resolved)
- **Timeline:** 2026-03-12
- **Github Link:** (empty)

**Resolution:**
`SSVOperators.removeOperator` now deletes `operatorFeeChangeRequests[operatorId]` before balances are withdrawn, so removal no longer leaves stale fee-change state behind.

Added a unit test in `test/unit/SSVOperators/removeOperator.test.ts` that:
- creates a real pending fee declaration via `declareOperatorFee`
- verifies the exact stored request fields before removal
- removes the operator
- verifies `fee`, `approvalBeginTime`, and `approvalEndTime` are all exactly `0`

**Acceptance Criteria:**
- [x] `removeOperator` clears `operatorFeeChangeRequests[operatorId]`
- [x] Unit test covers removal with an active fee change request

--- 

### [QUALITY-10] ~~`removeOperator` does not clear `operatorEthVUnits` — orphaned deviation~~
- **Type:** Code Quality
- **Priority:** P1
- **Status:** ✅ Fixed
- **Owner:** (resolved)
- **Timeline:** 2026-03-16
- **Github Link:** (empty)

**Resolution:**
`removeOperator` now deletes `SSVStorageEB.load().operatorEthVUnits[operatorId]` alongside the existing `_resetOperatorState` call, ensuring no orphaned deviation remains for removed operators.

Added a unit test in `test/unit/SSVOperators/removeOperator.test.ts` that:
- Registers an operator and sets `operatorEthVUnits` to a non-zero value via harness
- Removes the operator
- Verifies `operatorEthVUnits` is cleared to 0

**Acceptance Criteria:**
- [x] `removeOperator` clears `operatorEthVUnits[operatorId]`
- [x] Unit test covers removal with non-zero `operatorEthVUnits`

---

### [QUALITY-11] ~~`commitRoot` skips `WeightedRootProposed` on quorum-reaching vote~~
- **Type:** Code Quality
- **Priority:** P2
- **Status:** ✅ Fixed
- **Owner:** (resolved)
- **Timeline:** 2026-03-16
- **Github Link:** (empty)

**Problem:**
When the final oracle vote reached quorum in `commitRoot`, the function emitted `RootCommitted` and returned early, skipping the `WeightedRootProposed` event. Off-chain consumers (oracle client, monitoring) that track per-vote weight progression would miss the final vote's weight data.

**Resolution:**
Moved `emit WeightedRootProposed(...)` before the quorum threshold check in `SSVDAO.sol`, so every vote — including the one that triggers consensus — emits `WeightedRootProposed`. The quorum-reaching vote now emits both `WeightedRootProposed` and `RootCommitted`.

Updated all tests that assert on quorum-reaching transactions:
- `test/unit/SSVDAO/commitRoot.test.ts` — 9 tests updated to expect both events
- `test/e2e/effective-balance/oracle-commits.test.ts` — 2 tests updated (lines 97 and 141 changed from `not.emit` to `emit`)

**Acceptance Criteria:**
- [x] Every `commitRoot` call emits `WeightedRootProposed`, including the quorum-reaching vote
- [x] Quorum-reaching vote emits both `WeightedRootProposed` and `RootCommitted`
- [x] All unit and E2E tests pass with updated assertions

---

### [QUALITY-12] ~~Unsafe `uint128 → uint64` casts in operator/DAO earnings accumulation~~
- **Type:** Code Quality
- **Priority:** P2
- **Status:** ✅ Fixed
- **Owner:** (resolved)
- **Timeline:** 2026-03-17
- **Github Link:** (empty)

**Problem:**
Operator earnings deltas and DAO earnings are computed as `uint128` but silently truncated to `uint64` via `PackedETH.wrap(uint64(delta))` in three locations in `OperatorLib.sol` (lines 69, 94, 307) and one in `ProtocolLib.sol` (line 89). If `delta` exceeds `type(uint64).max`, earnings silently vanish with no revert. While not reachable under current realistic parameters, the absence of a bounds check means pathological conditions (snapshot not updated for decades, extreme fee/validator values) would cause permanent fund loss.

**Resolution:**
Added a lightweight `_safeUint64(uint128)` free function in `SSVCoreTypes.sol` with a custom `SafeCastOverflow` error — avoids importing OpenZeppelin's SafeCast to save gas and contract size. Replaced all 4 unsafe `uint64(delta)` / `uint64(earningsUnits)` casts with `_safeUint64(delta)` / `_safeUint64(earningsUnits)`.

Files changed:
- `contracts/libraries/SSVCoreTypes.sol` — Added `_safeUint64` helper and `SafeCastOverflow` error
- `contracts/libraries/OperatorLib.sol` — 3 casts replaced (lines 69, 94, 307)
- `contracts/libraries/ProtocolLib.sol` — 1 cast replaced (line 89)
- `contracts/test/harness/PackedLibHarness.sol` — Harness wrapper for testing
- `test/unit/packedLib.test.ts` — 6 new tests (zero, in-range, boundary, overflow scenarios)

**Acceptance Criteria:**
- [x] All `uint128 → uint64` casts in state-modifying earnings functions use `_safeUint64`
- [x] Overflow reverts with `SafeCastOverflow` instead of silent truncation
- [x] 6 unit tests verify correct behavior at zero, in-range, boundary, and overflow values
- [x] All 1209 existing tests pass with zero regressions

---

## Mainnet Readiness

### [MAINNET-READINESS-1] Mainnet playbook ready and sent to m-sig
- **Type:** Mainnet Readiness
- **Priority:** P0
- **Status:** In Progress
- **Owner:** Marco
- **Related:** OPS-1, PR [#523](https://github.com/ssvlabs/ssv-network/pull/523)

**Description:**
Finalize and deliver the mainnet upgrade playbook to the multisig. This involves incorporating the latest protocol parameters (network fee, liquidation collateral, liquidation threshold, oracle set, cooldown duration, quorum BPS) that will be used for the mainnet deployment into the upgrade scripts. Once the scripts are ready, Yurii will validate them locally. After the mainnet contracts are fully populated on Hoodi testnet, the upgrade should be executed following the playbook strictly, using a SAFE wallet on Hoodi to validate the end-to-end flow before mainnet.

**Actions:**
- [ ] Incorporate final mainnet protocol parameters into upgrade scripts (based on DIP-X proposed values)
- [ ] Yurii to validate scripts locally against Hoodi state
- [ ] Execute full upgrade flow on Hoodi using a SAFE wallet, following the playbook step-by-step
- [ ] Deliver signed-off playbook to the multisig

**Acceptance Criteria:**
- [ ] All protocol parameters in scripts match the DIP-X approved governance values
- [ ] Hoodi upgrade completes without errors via SAFE wallet
- [ ] Playbook document sent and acknowledged by m-sig signers

---

### [MAINNET-READINESS-2] Full mainnet → staking upgrade flow validated on Hoodi
- **Type:** Mainnet Readiness
- **Priority:** P0
- **Status:** Blocked (waiting on MAINNET-READINESS-1)
- **Owner:** Marco

**Description:**
Validate the complete end-to-end upgrade flow from the current mainnet state v1.2.0 to v2.0.0 (SSV Staking) on the Hoodi testnet. This task is blocked until the mainnet contracts are fully populated on Hoodi (i.e., MAINNET-READINESS-1 is complete and the Hoodi environment reflects a realistic mainnet state). The validation must cover the full upgrade sequence: deploying new module implementations, running the reinitializer, verifying post-upgrade state consistency, and confirming all cluster/operator/staking flows work correctly.

**Actions:**
- [ ] Wait for Hoodi environment to be populated with mainnet-like contract state (dependency: MAINNET-READINESS-1)
- [ ] Deploy all v2.0.0 module implementations to Hoodi
- [ ] Execute `reinitializer(3)` upgrade via SAFE wallet following the playbook
- [ ] Verify post-upgrade state: operator ETH fees, cluster balances, staking module initialization
- [ ] Smoke-test key flows: validator registration, cluster deposit/withdraw, staking/unstaking, oracle EB update

**Acceptance Criteria:**
- [ ] Full upgrade completes without revert on Hoodi
- [ ] Post-upgrade state matches expected initial values (network fee, liquidation params, oracle set)
- [ ] All core user flows succeed on Hoodi post-upgrade
- [ ] No unexpected state drift detected between pre- and post-upgrade snapshots

---

### [MAINNET-READINESS-3] Deep testing on staking module
- **Type:** Mainnet Readiness
- **Priority:** P0
- **Status:** In Progress
- **Owner:** Andrew
- **Collaborators:** Venimir, Yurii
- **Related:** Gabriel to share list of new staking test cases

**Description:**
Expand the staking module test coverage with a deep, targeted test pass focused on the SSV Staking and cSSV token flows. Gabriel will provide a list of specific scenarios to cover. The test suite should cover the full staking lifecycle — stake, requestUnstake, claimUnstake, claimEthRewards — as well as edge cases around the accumulator math, cSSV transfer reward settlement hooks, concurrent multi-user reward accumulation, and the unstake cooldown mechanism.

**Actions:**
- [ ] Gabriel to share the list of new staking test scenarios
- [ ] Contracts team implement new tests if needed
- [ ] Venimir and Yurii to review and validate test coverage
- [ ] Run full test suite and confirm no regressions

**Acceptance Criteria:**
- [ ] All scenarios from Gabriel's list are covered by tests
- [ ] Accumulator math (`accEthPerShare`, `userIndex`) verified with multi-user scenarios
- [ ] `onCSSVTransfer` hook reward settlement tested for stake, unstake, and direct cSSV transfers
- [ ] All tests pass with no regressions

---

### [MAINNET-READINESS-4] External audit complete
- **Type:** Mainnet Readiness
- **Priority:** P2
- **Status:** In Progress (awaiting final report)
- **Owner:** Marco
- **Note:** Ping Massimo — some partners require the audit report for their internal security evaluations.

**Description:**
Receive and review the final audit report from QuantStamp covering the v2.0.0 SSV Staking release. The audit is a dependency for several ecosystem partners who need it for their own internal security sign-off processes before integrating with the new staking module. Once the report is received, any critical or high findings must be addressed before mainnet deployment. Marco to coordinate with Massimo on report delivery timeline and partner communication.

**Actions:**
- [ ] Follow up with Massimo on QuantStamp report delivery ETA
- [ ] Share draft/final report with partners who requested it for internal security evaluations
- [ ] Triage all findings and create tracking items for any critical/high severity issues
- [ ] Confirm all critical/high findings are resolved before mainnet go/no-go decision

**Acceptance Criteria:**
- [ ] Final QuantStamp audit report received
- [ ] All critical and high severity findings resolved or formally accepted with justification
- [ ] Report shared with requesting ecosystem partners
- [ ] Go/no-go sign-off includes audit clearance confirmation

---

### [MAINNET-READINESS-5] cSSV token behavior outside the SSV protocol
- **Type:** Mainnet Readiness
- **Priority:** P1
- **Status:** In Progress
- **Owner:** Andrew (implementation), Gabriel (execution)

**Description:**
Validate cSSV token behavior in contexts outside the core SSV protocol — primarily ERC-20 standard compliance and the reward settlement hook when cSSV is transferred between arbitrary addresses. The `onCSSVTransfer` hook in `SSVStaking.sol` must correctly settle pending ETH rewards for both sender and receiver on every transfer. Tests should cover direct transfers (wallet-to-wallet), transfers via ERC-20 `approve`/`transferFrom`, integration with external contracts (e.g., DEX/AMM mock), and edge cases like transferring to/from the zero address and self-transfers.

**Actions:**
- [ ] Andrew to define test scope for cSSV token external behavior
- [ ] Gabriel to execute the test suite
- [ ] Cover: direct transfer reward settlement, approve/transferFrom, zero-address edge cases, self-transfer
- [ ] Cover: cSSV used in a mock external contract (e.g., staking aggregator) — verify reward hooks fire correctly

**Acceptance Criteria:**
- [ ] `onCSSVTransfer` settles rewards correctly for sender and receiver on every ERC-20 transfer
- [ ] ERC-20 standard compliance verified (transfer, transferFrom, approve, allowance)
- [ ] No reward leakage or double-claim possible via transfer manipulation
- [ ] All tests pass

---

### [MAINNET-READINESS-6] Merge all pending testing-related PRs
- **Type:** Mainnet Readiness
- **Priority:** P1
- **Status:** In Progress
- **Owner:** Marco

**Description:**
Consolidate the repository state by merging all outstanding testing-related pull requests into the `ssv-staking` branch. This is a prerequisite for accurate final coverage reporting and ensures that the mainnet go/no-go decision is based on a clean, up-to-date codebase. Marco to identify all open testing PRs, verify they are ready to merge (CI passing, reviewed), and merge them in dependency order.

**Actions:**
- [ ] Enumerate all open PRs with testing changes targeting `ssv-staking`
- [ ] Verify CI passes and reviews are complete for each PR
- [ ] Merge in dependency order (no conflicts)
- [ ] Confirm final test run passes on the merged branch

**Acceptance Criteria:**
- [ ] All pending testing PRs merged into `ssv-staking`
- [ ] No merge conflicts remaining
- [ ] Full test suite passes on the consolidated branch
- [ ] Coverage report reflects all merged test additions

---
