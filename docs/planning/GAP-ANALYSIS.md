# Gap Analysis — SSV Network v2.0.0 Exhaustive Scenario Coverage

**Generated:** 2026-03-24
**Source:** 27 scenario files in `docs/planning/` with W4 coverage verification sections
**Scope:** All scenarios across operator lifecycle, fees, earnings, validators, whitelisting, clusters, EB oracle, EB updates, liquidation/reactivation, migration, staking, DAO governance, invariants, cross-module chains, and removed-operator bug class

> **Note:** The W4 coverage verification sections explicitly classified 1,464 of 1,777 total scenarios.
> The remaining 313 scenarios — added by ask-codex reviews, audit gap sections, and late additions
> after the W4 workers completed — were never verified and default to `no` (not tested).

---

## 1. Summary Stats

### Overall Coverage

| Status | Count | Percentage |
|--------|------:|----------:|
| **yes** (tested) | 605 | 34.0% |
| **no** (not tested) | 1,021 | 57.5% |
| **partial:mock** (uses mockRemoveOperator) | 32 | 1.8% |
| **partial:weak** (incomplete assertions) | 119 | 6.7% |
| **Total** | **1,777** | **100%** |

### Per-File Breakdown

The "W4 Verified" column shows scenarios explicitly classified by W4 workers. The "Unverified" column shows additional scenarios (from ask-codex reviews, audit gaps, late additions) that default to `no`.

| File | Total | W4 Verified | Unverified | yes | no | partial:mock | partial:weak | Coverage % |
|------|------:|------------:|-----------:|----:|---:|-------------:|-------------:|-----------:|
| scenarios-op-lifecycle.md | 57 | 42 | 15 | 31 | 22 | 0 | 4 | 54.4% |
| scenarios-op-fees.md | 60 | 48 | 12 | 29 | 26 | 0 | 5 | 48.3% |
| scenarios-op-earnings.md | 48 | 44 | 4 | 31 | 11 | 1 | 5 | 64.6% |
| scenarios-vl-register.md | 76 | 73 | 3 | 37 | 33 | 2 | 4 | 48.7% |
| scenarios-vl-remove-exit.md | 72 | 69 | 3 | 36 | 31 | 1 | 4 | 50.0% |
| scenarios-whitelist.md | 67 | 64 | 3 | 37 | 26 | 0 | 4 | 55.2% |
| scenarios-cl-deposit-withdraw.md | 60 | 57 | 3 | 29 | 26 | 1 | 4 | 48.3% |
| scenarios-eb-oracle.md | 42 | 38 | 4 | 35 | 7 | 0 | 0 | 83.3% |
| scenarios-eb-updates.md | 102 | 89 | 13 | 55 | 41 | 1 | 5 | 53.9% |
| scenarios-lq-reactivation.md | 110 | 83 | 27 | 56 | 44 | 0 | 10 | 50.9% |
| scenarios-migration.md | 70 | 64 | 6 | 44 | 21 | 3 | 2 | 62.9% |
| scenarios-staking.md | 104 | 100 | 4 | 80 | 22 | 1 | 1 | 76.9% |
| scenarios-dao-governance.md | 115 | 111 | 4 | 73 | 42 | 0 | 0 | 63.5% |
| scenarios-invariants.md | 86 | 50 | 36 | 16 | 50 | 2 | 18 | 18.6% |
| scenarios-rm-updateOperatorVUnits.md | 28 | 25 | 3 | 0 | 28 | 0 | 0 | 0.0% |
| scenarios-rm-executeLiquidation.md | 32 | 30 | 2 | 0 | 31 | 0 | 1 | 0.0% |
| scenarios-rm-bulkRemoveValidator.md | 27 | 25 | 2 | 0 | 25 | 2 | 0 | 0.0% |
| scenarios-rm-migrateClusterToETH.md | 27 | 25 | 2 | 0 | 20 | 7 | 0 | 0.0% |
| scenarios-rm-migration-init.md | 21 | 18 | 3 | 1 | 10 | 9 | 1 | 4.8% |
| scenarios-rm-reactivation.md | 35 | 20 | 15 | 0 | 35 | 0 | 0 | 0.0% |
| scenarios-rm-auto-liquidation.md | 53 | 33 | 20 | 0 | 53 | 0 | 0 | 0.0% |
| scenarios-rm-chains.md | 56 | 45 | 11 | 1 | 53 | 1 | 1 | 1.8% |
| scenarios-xm-op-cluster.md | 68 | 69 | 0 | 6 | 51 | 1 | 10 | 8.8% |
| scenarios-xm-vl-eb.md | 90 | 62 | 28 | 6 | 72 | 0 | 12 | 6.7% |
| scenarios-xm-lq-react-chains.md | 102 | 68 | 34 | 0 | 98 | 0 | 4 | 0.0% |
| scenarios-xm-migration-staking.md | 53 | 52 | 1 | 0 | 48 | 0 | 5 | 0.0% |
| scenarios-xm-full-lifecycle.md | 97 | 60 | 37 | 2 | 76 | 0 | 19 | 2.1% |

---

## 2. Priority 0 Gaps: Removed Operator Bug Class

These are the **exact bug class that blocked mainnet deployment**. The removed-operator path causes ghost writes to `operatorEthVUnits`, stale deviation in `daoTotalEthVUnits`, and potential underflow reverts across `_updateOperatorVUnits`, `_executeLiquidation`, `bulkRemoveValidator`, `migrateClusterToETH`, and `reactivate`.

**Total P0 gaps: 216** (197 `no` + 19 `partial:mock`)

> **Critical:** ALL `partial:mock` scenarios use `mockRemoveOperator()` which does NOT call `delete seb.operatorEthVUnits[operatorId]`, masking the exact bug. These MUST be migrated to real `removeOperator()`.

### RM1 — `_updateOperatorVUnits` + removeOperator (25 gaps: 25 no)

The core bug entry point. `_updateOperatorVUnits` writes deviation to `operatorEthVUnits[removedOp]` because it loops over all operators without checking `operator.owner == address(0)`.

| ID | Status | Vulnerable Code Path |
|----|--------|---------------------|
| RM1-001 | no | removeOp + EB increase → ghost write to operatorEthVUnits |
| RM1-002 | no | removeOp + EB decrease → ghost write + potential underflow |
| RM1-003 | no | 7-op EB increase variant |
| RM1-004 | no | 7-op EB decrease variant |
| RM1-005 | no | 10-op EB increase variant |
| RM1-006 | no | 10-op EB decrease variant |
| RM1-007 | no | 13-op EB increase variant |
| RM1-008 | no | 13-op EB decrease variant |
| RM1-009 | no | Per-operator deviation verification (increase) |
| RM1-010 | no | Per-operator deviation verification (decrease) |
| RM1-011 | no | daoTotalEthVUnits verification (increase) |
| RM1-012 | no | daoTotalEthVUnits verification (decrease) |
| RM1-013 | no | Post-EB deposit verification |
| RM1-014 | no | Post-EB withdraw verification |
| RM1-015 | no | First explicit EB with removed op |
| RM1-016 | no | Chained removal + EB updates |
| RM1-017 | no | Ghost deviation verification |
| RM1-018 | no | Bug reproduction: resurrection |
| RM1-019 | no | Bug reproduction: underflow revert |
| RM1-020 | no | Bug reproduction: corrupted state |
| RM1-021 | no | Harness bug scenario (mock, not real path) |
| RM1-022 | no | Harness bug scenario (no EB decrease with mock) |
| RM1-023 | no | Cross-cluster shared operator |
| RM1-024 | no | All operators removed + EB update |
| RM1-025 | no | Zero-delta EB update (no _updateOperatorVUnits call) |

### RM2 — `_executeLiquidation` + removeOperator (29 gaps: 29 no)

Liquidation subtracts deviation from `operatorEthVUnits[removedOp]` — if ghost state was written by RM1, subtraction succeeds but corrupts DAO accounting. If no ghost state, subtraction underflows.

| ID | Status | Vulnerable Code Path |
|----|--------|---------------------|
| RM2-001 | no | removeOp + explicit EB deviation + liquidate |
| RM2-002 | no | explicit EB at baseline + removeOp + liquidate |
| RM2-003..008 | no | 7/10/13-op variants (with and without baseline) |
| RM2-009 | no | Self-liquidation variant |
| RM2-010..012 | no | operatorEthVUnits / daoTotalEthVUnits / ethValidatorCount assertions |
| RM2-013 | no | EB update stale write + liquidation |
| RM2-014 | no | Threshold boundary liquidation |
| RM2-015 | partial:weak | Real removeOp + liquidate, but implicit EB (deviation=0 — bug path not exercised) |
| RM2-016..030 | no | Full lifecycle, live ops verification, large deviation, multiple removed ops, auto-liq comparison, post-liq state, shared operators |

### RM3 — `bulkRemoveValidator` + removeOperator (25 gaps: 23 no, 2 partial:mock)

Last-validator removal cleans up EB deviation per operator. With a removed operator, this reads/writes ghost `operatorEthVUnits`.

| ID | Status | Vulnerable Code Path |
|----|--------|---------------------|
| RM3-001 | no | Core bug: removeOp + explicit EB + bulkRemoveValidator (last validator) |
| RM3-002 | partial:mock | mockRemoveOperator + removeValidator (not last) — mock masks bug |
| RM3-003 | no | Single removeValidator with removed op + explicit EB |
| RM3-004 | partial:mock | mockRemoveOperator + removeValidator (single, not last) — mock masks bug |
| RM3-005..007 | no | 7/10/13-op variants |
| RM3-008 | no | Multiple removed ops in 7-op cluster |
| RM3-009..025 | no | Post-removal registration, bulk drain, implicit EB, zero deviation, ethValidatorCount, operatorEthVUnits, ebSnapshot, liquidated cluster, cross-cluster, large scale |

### RM4 — `migrateClusterToETH` + removeOperator (25 gaps: 18 no, 7 partial:mock)

Migration initializes ETH state for operators. With a removed operator, `mockRemoveOperator` does NOT delete `operatorEthVUnits`, hiding the delta between mock and real behavior.

| ID | Status | Vulnerable Code Path |
|----|--------|---------------------|
| RM4-001 | partial:mock | mockRemoveOperator — assertions weak (ethValidatorCount >= 0) |
| RM4-002 | no | Migration with explicit EB + removed op + deviation verification |
| RM4-003 | partial:mock | 2 of 4 ops removed (mock) — weak assertions |
| RM4-004..009 | no | 7/10/13-op variants with various removed op counts |
| RM4-010..012 | partial:mock | Same test as RM4-001 with different assertion focus — all masked by mock |
| RM4-013..017 | no | operatorEthVUnits verification, explicit EB deviation, SSV history, ETH history, cumulativeFeeETH |
| RM4-018 | partial:mock | mockRemoveOperatorAndPayout — SSV side good, ETH side masked |
| RM4-019..020 | no | Post-migration EB update, _updateOperatorVUnits behavior |
| RM4-021 | partial:mock | mockRemoveOperatorAndPayout — good assertions but mock doesn't delete vUnits |
| RM4-022..025 | no | 2 removed ops, sequential migration, event verification, e2e lifecycle |

### RM5 — `reactivate` + removeOperator (20 gaps: 20 no)

**Zero coverage.** Reactivation restores EB deviation to operators and DAO. No test combines `removeOperator` + `reactivate` in any configuration.

| ID | Status | Vulnerable Code Path |
|----|--------|---------------------|
| RM5-001 | no | liquidate + removeOp + reactivate |
| RM5-002 | no | removeOp before liquidate + reactivate |
| RM5-003..005 | no | 7/10/13-op variants |
| RM5-006..007 | no | All operators removed + reactivate |
| RM5-008..009 | no | Deviation distribution / daoTotalEthVUnits on reactivation |
| RM5-010 | no | Implicit EB reactivation with removed op |
| RM5-011..020 | no | _resetOperatorState, fee accrual, operatorEthVUnits cleanup, EB update + remove + reactivate, hasDeviation flag, ExceedValidatorLimitWithData, positional variants |

### RM6 — Migration init guard + removeOperator (16 gaps: 7 no, 9 partial:mock)

The `updateClusterOperatorsMigration` guard at `OperatorLib.sol:363-365` decides whether to skip or initialize operators during migration. All existing tests use mocks.

| ID | Status | Vulnerable Code Path |
|----|--------|---------------------|
| RM6-001 | partial:mock | mockRemoveOperator — weak assertions (ethValidatorCount >= 0) |
| RM6-004 | no | Asymmetric state (snapshot.block==0, ethSnapshot.block>0) |
| RM6-005 | partial:mock | mockRemoveOperatorAndPayout — SSV index frozen but not guard verification |
| RM6-006 | partial:mock | "Prevents silent revival" — mock, no ensureETHDefaults verification |
| RM6-007 | partial:mock | Same as RM6-001 |
| RM6-008 | no | cumulativeFeeETH excludes dead op |
| RM6-009 | partial:mock | cumulativeIndexSSV includes removed op's frozen index (mock) |
| RM6-010 | partial:mock | Covered by mock unit + mock e2e |
| RM6-011 | partial:mock | 2 of 4 removed — weak assertions |
| RM6-012 | no | 3 of 4 operators removed (extreme) |
| RM6-013 | partial:mock | SSV validatorCount decrement with removed ops |
| RM6-014 | partial:mock | Liquidated cluster migration with removed op (mock_payout) |
| RM6-015..018 | no | Explicit EB + removed op, operatorEthVUnits==0 verification, validator limit boundary, ExceedValidatorLimitWithData |

### RMA — Auto-liquidation + removeOperator (33 gaps: 33 no)

**Zero coverage.** The compound path (`updateClusterBalance` → `_updateOperatorVUnits` → `_executeLiquidation`) is never tested with a removed operator.

| ID | Status | Vulnerable Code Path |
|----|--------|---------------------|
| RMA-001 | no | EB increase + removed op + auto-liquidation |
| RMA-002 | no | Ghost write to operatorEthVUnits[removedOp] in _updateOperatorVUnits |
| RMA-003 | no | _executeLiquidation subtraction from ghost operatorEthVUnits |
| RMA-004 | no | ethValidatorCount guard at line 541 for removed op |
| RMA-005..007 | no | 7/10/13-op variants |
| RMA-008..009 | no | 2/3 removed ops |
| RMA-010 | no | Ghost state lifecycle (write then subtract) |
| RMA-011..013 | no | Specific EB values (32→64, massive, decrease) |
| RMA-014..015 | no | Threshold boundary variants |
| RMA-016..019 | no | Post auto-liq state, cleanup, DAO decrement |
| RMA-020..030 | no | Fee change + remove + EB, fee exclusion, manual vs auto comparison, solvent EB update, bounty, events, EB snapshot, delta≠deviation, all-ops-removed, reactivation after auto-liq |
| RMA-054..056 | no | No-delta, exact collateral boundary, already-liquidated short-circuit |

### RMC — Multi-step chains + removeOperator (43 gaps: 42 no, 1 partial:mock)

**Near-zero coverage.** Only RMC-024 (register with dead operator reverts) is tested. One mock test exists (RMC-026).

| ID | Status | Vulnerable Code Path |
|----|--------|---------------------|
| RMC-001..023 | no | Full chains (EB→removeOp→liquidate→reactivate→EB→removeValidator), double removal, validator add/remove, withdraw, implicit-to-explicit, cascading removal, progressive cascade, EB oscillation, all ops removed, batch removal, cross-cluster isolation/drift |
| RMC-026 | partial:mock | Migration with dead operator — ethValidatorCount but not cross-cluster |
| RMC-027..045 | no | Shared op removed + cluster B ops, drift quantification, oscillation chains, mixed chains, precision drift, progressive removal, multi-cluster reactivate, triple liquidation, mixed implicit/explicit, stress variants |

---

## 3. Priority 1 Gaps: Cross-Module Chains

**Total P1 gaps: 246** (all `no`)

### XO — Operator↔Cluster Interactions (52 gaps)

| Gap Category | IDs | Count |
|-------------|-----|------:|
| Fee change + EB interactions | XO-015, XO-017, XO-022, XO-023 | 4 |
| Removed operator + cluster ops | XO-009, XO-016 (mock), XO-018..020, XO-037, XO-041, XO-044..046, XO-052, XO-057..059, XO-061..062, XO-065..068 | 19 |
| Fee change + liquidation/withdraw | XO-012, XO-013, XO-038..040, XO-049, XO-053, XO-060 | 8 |
| Privacy + cluster ops | XO-027..032 | 6 |
| EB + deposit/withdraw | XO-034, XO-035, XO-051 | 3 |
| Operator earnings isolation | XO-024, XO-047, XO-055, XO-056, XO-063, XO-064 | 6 |
| Multi-cluster shared ops | XO-010, XO-019, XO-020, XO-021, XO-044, XO-054 | 6 |

### XV — Validator↔EB Interactions (44 gaps)

| Gap Category | IDs | Count |
|-------------|-----|------:|
| Remove + EB deviation cleanup | XV-004, XV-006, XV-007, XV-011, XV-013, XV-016..019, XV-025, XV-030, XV-039, XV-041, XV-046 | 14 |
| Removed operator + EB + remove (THE BUG) | XV-023..026, XV-049, XV-050 | 6 |
| Register + EB interleaving | XV-009, XV-010, XV-020, XV-029, XV-036, XV-042..045 | 9 |
| Liquidation + EB + validator mgmt | XV-034, XV-035, XV-061, XV-062 | 4 |
| Round-trip/precision | XV-014, XV-015, XV-040, XV-047, XV-048, XV-053..055, XV-057, XV-060 | 10 |
| Scale (50-100 validators) | XV-031 | 1 |

### XL — Liquidation↔Reactivation Chains (64 gaps)

| Gap Category | IDs | Count |
|-------------|-----|------:|
| Full cycle (register→EB→liquidate→reactivate→EB) | XL-001..008 | 8 |
| Auto-liquidation chains | XL-009 (weak), XL-010, XL-013..015, XL-047 | 5 |
| Removed operator + liquidation/reactivation | XL-011 (weak), XL-012, XL-016..024, XL-026, XL-030, XL-046, XL-048, XL-058, XL-065..067 | 18 |
| EB on liquidated cluster | XL-041..045 | 5 |
| Fee change during liquidation | XL-027..029 | 3 |
| Double/triple cycles | XL-031, XL-032 | 2 |
| Validator mgmt + liquidation | XL-033, XL-034, XL-059, XL-060, XL-063, XL-068 | 6 |
| Boundary/precision tests | XL-035..040 | 6 |
| Same-block race conditions | XL-049..055 | 7 |
| Multi-cluster + shared ops | XL-056 (weak), XL-057 | 2 |
| Migration path | XL-064 | 1 |
| Self-liquidation deviation | XL-006 | 1 |

### XG — Migration↔Staking Interactions (47 gaps)

| Gap Category | IDs | Count |
|-------------|-----|------:|
| Core migration + staking flow | XG-001..006 | 6 |
| Migration + liquidation + staking | XG-008, XG-009, XG-015, XG-018, XG-032, XG-049, XG-051 | 7 |
| Removed operator + staking divergence | XG-012, XG-013, XG-035, XG-039, XG-042, XG-052 | 6 |
| Partial unstake / transfer + migration | XG-010, XG-023 (weak) | 1 |
| Multi-cluster / multi-staker | XG-003, XG-014, XG-025, XG-041 | 4 |
| EB interactions + staking | XG-004, XG-005, XG-028, XG-029, XG-047 | 5 |
| Fee/governance + staking | XG-006, XG-026, XG-031 | 3 |
| Zero cSSV supply + migration | XG-011, XG-034, XG-048 | 3 |
| Precision / overflow / atomicity | XG-016, XG-030, XG-033, XG-038, XG-046, XG-050 | 6 |
| Deposit/withdraw + staking | XG-021, XG-022, XG-027, XG-044, XG-045 | 5 |
| SSV cluster isolation | XG-024 | 1 |

### XF — Full Lifecycle Chains (39 gaps)

| Gap Category | IDs | Count |
|-------------|-----|------:|
| Multi-op lifecycle (7/10/13 ops) | XF-002, XF-003, XF-004 | 3 |
| Migration lifecycle | XF-007 | 1 |
| Scale/stress (100 validators, 1M blocks) | XF-010..016, XF-052 | 8 |
| Removed operator lifecycle | XF-023, XF-024, XF-036, XF-037, XF-050 | 5 |
| DAO governance interactions | XF-020, XF-034, XF-044, XF-049, XF-054, XF-055 | 6 |
| Auto-liquidation + deviation | XF-045, XF-048 | 2 |
| Fee settlement ordering | XF-022, XF-041, XF-042 | 3 |
| Multi-cluster interactions | XF-039, XF-046 | 2 |
| Staking lifecycle | XF-056, XF-060 | 2 |
| Oracle governance + EB | XF-033, XF-058 | 2 |
| Whitelist + privacy | XF-035, XF-057 | 2 |
| Contract rejection (ETHTransferFailed) | XF-051 | 1 |
| Views consistency | XF-059 | 1 |
| Protocol bootstrap ordering | XF-060 | 1 |

---

## 4. Priority 2 Gaps: Individual Module Coverage

**Total P2 gaps: 265** (all `no`)

| Module | Prefix | No-Coverage Count | Key Gap Categories |
|--------|--------|------------------:|-------------------|
| DAO Governance | DA | 38 | Precision/packing overflow (DA-079..085, DA-095..097), fee isolation (DA-086..087), downstream interaction (DA-063..067, DA-104..111), missing access control (DA-057, DA-092), module update (DA-060, DA-061, DA-090) |
| Validator Register | VR | 30 | Boundary tests (VR-005..008, VR-031), operator count variations (VR-022, VR-023), whitelist paths (VR-017..019, VR-062, VR-063, VR-071, VR-073), bulk scale (VR-046, VR-047, VR-050, VR-051, VR-056), cluster state (VR-033, VR-038, VR-040, VR-064..067) |
| Validator Remove/Exit | VX | 28 | THE BUG (VX-028, VX-063), removed operator deviation (VX-037, VX-038, VX-060), liquidated cluster removes (VX-015, VX-033, VX-035, VX-069), SSV cluster paths (VX-040, VX-052, VX-065, VX-067), scale (VX-031), re-registration (VX-023), exit edge cases (VX-044, VX-050..052, VX-062) |
| EB Updates | EB | 28 | Removed operator paths (EB-055, EB-057, EB-069, EB-102..104, EB-114, EB-115), operator count variations (EB-032, EB-033, EB-041, EB-073, EB-074), precision (EB-078, EB-090, EB-091), scale (EB-080, EB-081), boundary (EB-106, EB-107, EB-109, EB-116, EB-118, EB-119), multi-cluster (EB-059), cluster state (EB-112, EB-113) |
| Deposit/Withdraw | CL | 23 | Operator count variations (CL-002, CL-003, CL-018, CL-022, CL-023), removed operator (CL-012, CL-042), EB interactions (CL-030, CL-036, CL-041, CL-048, CL-050), version/state (CL-006, CL-007, CL-010, CL-015, CL-017), overflow/edge (CL-049, CL-051, CL-052, CL-054, CL-055, CL-057) |
| Whitelist | WL | 23 | Bitmap boundary/precision (WL-003, WL-004, WL-006, WL-040, WL-051, WL-054, WL-055), idempotent operations (WL-007, WL-018), contract paths (WL-012, WL-030, WL-032, WL-053, WL-059, WL-060), removeOperator interaction (WL-037, WL-038), lifecycle (WL-039, WL-050, WL-063, WL-064), legacy migration (WL-022, WL-020) |
| Staking | ST | 18 | Precision/rounding (ST-062, ST-063, ST-094, ST-096..098), reentrancy (ST-072, ST-082, ST-084), boundary (ST-086..088), ETH transfer failure (ST-080, ST-090, ST-095), concurrent users (ST-078), idempotent (ST-077), overflow (ST-004) |
| Liquidation/Reactivation | LQ | 17 | Reactivation with N ops (LQ-059..061), removed operator (LQ-062, LQ-063, LQ-076), EB stale risk (LQ-074, LQ-075), validatorsPerOperatorLimit (LQ-080), SSV boundary (LQ-047, LQ-048), auto-liq skip (LQ-031), reactivate+deposit (LQ-070), same-block (LQ-105), multi-cluster deviation (LQ-103, LQ-104) |
| Migration | MG | 15 | Operator count variations (MG-002..004), operator limit (MG-026, MG-027), post-migration ops (MG-017, MG-018), explicit EB + removed op (MG-052), lifecycle (MG-055), edge cases (MG-020, MG-047..050, MG-058, MG-060) |
| Invariants | INV | 14 | Removed operator + EB/vUnits (INV-039..045), mixed conservation (INV-049, INV-050), hash/storage (INV-017..020, INV-033, INV-047) |
| Operator Fees | OF | 14 | Boundary (OF-010, OF-032), overwrite (OF-016, OF-053, OF-054), liquidation interaction (OF-034, OF-040), timelocked zero (OF-049), window edge cases (OF-050, OF-051), DAO parameter interaction (OF-055, OF-056), access control (OF-028) |
| Operator Earnings | OE | 7 | Cross-path (OE-012, OE-013), overflow (OE-028, OE-041), migration accrual (OE-034), parametric (OE-035), non-existent op (OE-037) |
| Operator Lifecycle | OP | 7 | Privacy + active cluster (OP-034), empty array (OP-037), liquidated cluster (OP-039), overflow (OP-008, OP-043), removed state (OP-035), SSV snapshot (OP-044) |
| EB Oracle | EB | 3 | Step-function boundary (EB-031e), mid-round replacement (EB-031f) |

---

## 5. Mock Migration Required

**Total: 32 scenarios** currently pass only because `mockRemoveOperator()` masks the bug by NOT deleting `operatorEthVUnits[operatorId]`.

These must be migrated to use real `removeOperator()` through the SSVNetwork proxy.

| ID | File | Current Mock | What's Masked |
|----|------|-------------|--------------|
| CL-031 | scenarios-cl-deposit-withdraw.md | mockRemoveOperator | Fee exclusion with removed operator |
| EB-056 | scenarios-eb-updates.md | mockRemoveOperator | Fee exclusion with removed op + EB update |
| INV-038 | scenarios-invariants.md | mockRemoveOperator | Removed op with active cluster vUnits |
| INV-043 | scenarios-invariants.md | mockRemoveOperator | Migration with removed op (ethValidatorCount not vUnits) |
| MG-008 | scenarios-migration.md | mockRemoveOperator | Skips removed operators during migration |
| MG-009 | scenarios-migration.md | mockRemoveOperator | Operator count integrity with mixed valid/removed |
| MG-028 | scenarios-migration.md | mockRemoveOperator | Migration skip behavior |
| OE-033 | scenarios-op-earnings.md | mockRemoveOperator | Cluster accounting after operator removal |
| RM3-002 | scenarios-rm-bulkRemoveValidator.md | mock_zero | Fee settlement, NOT EB deviation |
| RM3-004 | scenarios-rm-bulkRemoveValidator.md | mock_zero | Single removeValidator mock limitation |
| RMC-026 | scenarios-rm-chains.md | mockRemoveOperator | Migration with dead op (ethValidatorCount only) |
| RM4-001 | scenarios-rm-migrateClusterToETH.md | mock_zero | Weak ethValidatorCount assertion (>= 0) |
| RM4-003 | scenarios-rm-migrateClusterToETH.md | mock_zero | 2 of 4 ops removed — weak assertions |
| RM4-010 | scenarios-rm-migrateClusterToETH.md | mock_zero | ethSnapshot.block not asserted |
| RM4-011 | scenarios-rm-migrateClusterToETH.md | mock_zero | ethValidatorCount >= 0 instead of == 0 |
| RM4-012 | scenarios-rm-migrateClusterToETH.md | mock_zero | ethFeeAfter == ethFeeBefore (both 0 from mock) |
| RM4-018 | scenarios-rm-migrateClusterToETH.md | mock_payout | SSV side good, ETH side masked |
| RM4-021 | scenarios-rm-migrateClusterToETH.md | mock_payout | Good assertions but mock doesn't delete vUnits |
| RM6-001 | scenarios-rm-migration-init.md | mock_zero | continue guard — weak ethValidatorCount assertion |
| RM6-005 | scenarios-rm-migration-init.md | mock_payout | SSV index frozen but not guard verification |
| RM6-006 | scenarios-rm-migration-init.md | mock_zero | "Prevents silent revival" — no ensureETHDefaults check |
| RM6-007 | scenarios-rm-migration-init.md | mock_zero | Same as RM6-001 |
| RM6-009 | scenarios-rm-migration-init.md | mock_payout | cumulativeIndexSSV includes frozen index (mock) |
| RM6-010 | scenarios-rm-migration-init.md | mock_zero+mock_payout | Covered by mock unit + mock e2e |
| RM6-011 | scenarios-rm-migration-init.md | mock_zero | 2 of 4 removed — weak assertions |
| RM6-013 | scenarios-rm-migration-init.md | mock_zero | SSV validatorCount decrement with removed ops |
| RM6-014 | scenarios-rm-migration-init.md | mock_payout | Liquidated cluster migration (mock_payout) |
| ST-009 | scenarios-staking.md | mock | Two independent users (mock, not full e2e) |
| VR-013 | scenarios-vl-register.md | mockRemoveOperator | OperatorDoesNotExist on removed op |
| VR-070 | scenarios-vl-register.md | mockRemoveOperator | Bulk register OperatorDoesNotExist (mock) |
| VX-021 | scenarios-vl-remove-exit.md | mockRemoveOperator | Fee exclusion on remove (mock) |
| XO-016 | scenarios-xm-op-cluster.md | mockRemoveOperator | Bug path not exercised |

---

## 6. Weak Assertion Upgrades

**Total: 119 scenarios** with tests that exist but have incomplete or tangential assertions.

### By Module

| Module | Count | IDs |
|--------|------:|-----|
| Invariants | 18 | INV-006..010, INV-015, INV-016, INV-021..024, INV-030..032, INV-034..036, INV-046 |
| Full Lifecycle (XF) | 19 | XF-001, XF-005..009, XF-017, XF-021, XF-026..032, XF-038, XF-040, XF-043, XF-047, XF-053 |
| Validator↔EB (XV) | 12 | XV-001..003, XV-005, XV-012, XV-028, XV-042, XV-051, XV-052, XV-056, XV-058, XV-059 |
| Operator↔Cluster (XO) | 10 | XO-001..003, XO-011, XO-014, XO-033, XO-036, XO-042, XO-048, XO-050 |
| Liquidation/Reactivation | 10 | LQ-006, LQ-010, LQ-014, LQ-024, LQ-025, LQ-027, LQ-041, LQ-042, LQ-057, LQ-077 |
| EB Updates | 5 | EB-052, EB-067, EB-097..099 |
| Operator Earnings | 5 | OE-004, OE-008, OE-023, OE-026, OE-031 |
| Operator Fees | 5 | OF-009, OF-037, OF-038, OF-039, OF-052 |
| Migration↔Staking (XG) | 5 | XG-007, XG-017, XG-020, XG-023, XG-040 |
| Deposit/Withdraw | 4 | CL-008, CL-029, CL-045, CL-046 |
| Operator Lifecycle | 4 | OP-007, OP-012, OP-032, OP-040 |
| Validator Register | 4 | VR-014, VR-039, VR-055, VR-058 |
| Validator Remove/Exit | 4 | VX-008, VX-027, VX-036, VX-055 |
| Whitelist | 4 | WL-024, WL-031, WL-034, WL-036 |
| Liquidation↔Reactivation Chains (XL) | 4 | XL-009, XL-011, XL-051, XL-056 |
| Migration | 2 | MG-006, MG-022 |
| Removed Op Chains | 2 | RMC-025, RM2-015 |
| Removed Op Migration Init | 1 | RM6-003 |
| Staking | 1 | ST-058 |

### Common Weakness Patterns

1. **Missing per-operator assertions** — tests check aggregate state but not individual `operatorEthVUnits` or `ethValidatorCount` per operator
2. **Implicit hash validation** — cluster state hash is implicitly validated by transaction success, but storage slots not directly read
3. **Incomplete EB deviation checks** — deviation cleanup tested for some ops but not all, or cleanup direction (add vs subtract) not both verified
4. **Conservation formula not asserted** — test checks balances but doesn't verify the full invariant formula (e.g., G2 SSV conservation, G4 vUnit consistency)
5. **Boundary not tightly tested** — test covers the range but not the exact boundary (e.g., exact liquidation threshold, exact approval window boundary)

---

## 7. Heat Map — Coverage by Contract Function

Sorted by coverage percentage (worst first). Functions touching `operatorEthVUnits` are flagged as highest risk.

| Rank | Prefix | Coverage | Tested/Total | Contract | Function | Risk |
|-----:|--------|:--------:|-----------:|----------|----------|------|
| 1 | RMA | 0.0% | 0/33 | SSVClusters | auto-liquidation + removeOperator | **CRITICAL** |
| 2 | RM3 | 0.0% | 0/25 | SSVValidators | bulkRemoveValidator + removeOperator | **CRITICAL** |
| 3 | RM2 | 0.0% | 0/30 | SSVClusters | _executeLiquidation + removeOperator | **CRITICAL** |
| 4 | RM4 | 0.0% | 0/25 | SSVClusters | migrateClusterToETH + removeOperator | **CRITICAL** |
| 5 | RM5 | 0.0% | 0/20 | SSVClusters | reactivate + removeOperator | **CRITICAL** |
| 6 | RM1 | 0.0% | 0/25 | SSVClusters | _updateOperatorVUnits + removeOperator | **CRITICAL** |
| 7 | XL | 0.0% | 0/68 | SSVClusters | liquidation↔reactivation chains | HIGH |
| 8 | XG | 0.0% | 0/52 | SSVClusters+SSVStaking | migration↔staking interactions | HIGH |
| 9 | RMC | 2.2% | 1/45 | Multiple | multi-step chains + removeOperator | **CRITICAL** |
| 10 | XF | 3.3% | 2/60 | Multiple | full lifecycle chains | HIGH |
| 11 | RM6 | 5.6% | 1/18 | SSVClusters | migration init guard + removeOperator | **CRITICAL** |
| 12 | XO | 8.7% | 6/69 | SSVOperators+SSVClusters | operator↔cluster interactions | HIGH |
| 13 | XV | 9.7% | 6/62 | SSVValidators+SSVClusters | validator↔EB interactions | HIGH |
| 14 | INV | 32.0% | 16/50 | Cross-cutting | System invariants | HIGH |
| 15 | VR | 50.7% | 37/73 | SSVValidators | registerValidator / bulkRegisterValidator | MEDIUM |
| 16 | CL | 50.9% | 29/57 | SSVClusters | deposit / withdraw | MEDIUM |
| 17 | VX | 52.2% | 36/69 | SSVValidators | removeValidator / bulkRemoveValidator | MEDIUM |
| 18 | WL | 57.8% | 37/64 | SSVOperatorsWhitelist | whitelisting | LOW |
| 19 | OF | 60.4% | 29/48 | SSVOperators | operator fee lifecycle | MEDIUM |
| 20 | DA | 65.8% | 73/111 | SSVDAO | governance params | LOW |
| 21 | LQ | 67.5% | 56/83 | SSVClusters | liquidate / reactivate | MEDIUM |
| 22 | MG | 68.8% | 44/64 | SSVClusters | migrateClusterToETH | MEDIUM |
| 23 | OE | 70.5% | 31/44 | SSVOperators | withdrawOperatorEarnings | MEDIUM |
| 24 | EB | 53.9% | 55/102 | SSVClusters | updateClusterBalance (EB updates) | MEDIUM |
| 25 | OP | 73.8% | 31/42 | SSVOperators | registerOperator / removeOperator | LOW |
| 26 | ST | 80.0% | 80/100 | SSVStaking | staking lifecycle | LOW |
| 27 | EB (oracle) | 83.3% | 35/42 | SSVDAO | commitRoot oracle quorum | LOW |

### Highest-Risk Functions (touch operatorEthVUnits)

These functions directly read or write `operatorEthVUnits` and have the lowest coverage:

| Function | Location | Coverage of removed-op path |
|----------|----------|:---------------------------:|
| `_updateOperatorVUnits()` | SSVClusters.sol | **0/25 (0%)** |
| `_executeLiquidation()` | SSVClusters.sol | **0/30 (0%)** |
| `bulkRemoveValidator()` deviation cleanup | SSVValidators.sol:215-218 | **0/25 (0%)** |
| `reactivate()` deviation restore | SSVClusters.sol | **0/20 (0%)** |
| `migrateClusterToETH()` init guard | SSVClusters.sol | **0/25 (0%) + 7 mock** |
| Auto-liquidation compound path | SSVClusters.sol | **0/33 (0%)** |

---

## 8. Implementation Estimate

### New Test Files Needed

| Wave | Scope | New Scenarios | Estimated Test Files |
|------|-------|-------------:|--------------------:|
| **W5: P0 Removed-Operator** | RM1, RM2, RM3, RM4, RM5, RM6, RMA, RMC | 197 | 8 files |
| **W6: P1 Cross-Module** | XO, XV, XL, XG, XF | 246 | 5 files |
| **W7: P2 Individual Module** | OP, OF, OE, VR, VX, WL, CL, EB, LQ, MG, ST, DA, INV | 265 | ~13 files (additions to existing test files) |
| **Unverified (ask-codex / audit gaps)** | Distributed across all waves | 313 | included above |
| **Total new scenarios** | | **1,021** | **~26 files** |

### Existing Tests Needing Migration/Upgrade

| Category | Count | Action Required |
|----------|------:|----------------|
| **Mock → Real migration** | 32 | Replace `mockRemoveOperator` / `mockRemoveOperatorAndPayout` with real `removeOperator()` through SSVNetwork proxy |
| **Weak → Strong assertions** | 119 | Add missing per-operator assertions, storage slot reads, conservation formula checks, boundary precision |
| **Total existing tests to modify** | **151** | |

### Wave Priority Order

1. **W5 (P0)** — 197 new scenarios across 8 test files + 19 mock migrations in RM files. This is the exact bug class that blocked mainnet. Must be complete before deployment.
2. **W5.5 (Mock Migration)** — 13 additional mock migrations in non-RM files (CL, EB, INV, MG, OE, ST, VR, VX, XO). Can run in parallel with W5.
3. **W6 (P1)** — 246 new cross-module scenarios. These exercise multi-step interaction paths that individual module tests miss.
4. **W7 (P2)** — 265 new individual module scenarios + 119 weak assertion upgrades. Lower risk but important for completeness.

### Grand Total

| Metric | Count |
|--------|------:|
| Total scenarios defined | 1,777 |
| Currently tested (yes) | 605 (34.0%) |
| Gaps requiring new tests | 1,021 (57.5%) |
| Mock tests requiring migration | 32 (1.8%) |
| Weak tests requiring upgrade | 119 (6.7%) |
| **Target: 100% coverage** | **1,172 test changes** |
