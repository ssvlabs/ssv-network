# Scenarios: Removed-Operator × bulkRemoveValidator (RM3-001 — RM3-025)

**Worker:** W3-EB
**Prefix:** RM3
**Source files:**
- `contracts/modules/SSVValidators.sol` — `_bulkRemoveValidator` (lines 153-257), deviation cleanup loop (lines 216-217)
- `contracts/modules/SSVOperators.sol` — `removeOperator` (lines 71-104), `_resetOperatorState` (lines 347-358)
- `contracts/libraries/OperatorLib.sol` — `updateClusterOperators` (lines 233-262), ethSnapshot.block guard (line 247)
- `contracts/test/harness/SSVValidatorsHarness.sol` — `mockRemoveOperator` (lines 244-256) — **missing `delete seb.operatorEthVUnits`**
- `docs/SPEC.md` §2 EB Accounting

**Bug root cause:** `mockRemoveOperator()` resets operator state but does NOT `delete seb.operatorEthVUnits[operatorId]`. The real `removeOperator()` (SSVOperators.sol:93) deletes it. After real `removeOperator()`, `operatorEthVUnits[removedOp] == 0`. The deviation cleanup loop at SSVValidators.sol:216-217 subtracts `remainingVUnits` from ALL operators including the removed one — subtracting from zero causes underflow.

**Fix:** Guard the deviation cleanup loop: `if (s.operators[operatorIds[i]].ethSnapshot.block == 0) continue;`

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| RM3-001 | Cluster(4 ops) → explicit EB → removeOp1 → bulkRemoveValidator (last validator) | Core bug scenario: last-validator deviation cleanup subtracts remainingVUnits from removed operator's zeroed operatorEthVUnits → underflow without guard | `ops:4; eb:explicit; removed_ops:1; last_validator:yes; guard:needed; revert:yes_without_fix` | [ ] | SSVValidators.sol:215-218, SSVOperators.sol:93 |
| RM3-002 | Cluster(4 ops) → explicit EB → removeOp1 → bulkRemoveValidator (not last validator) | Partial removal from cluster with removed operator; deviation cleanup NOT triggered (validatorCount > 0); verify ebSnapshot.vUnits correctly decremented, no underflow path hit | `ops:4; eb:explicit; removed_ops:1; last_validator:no; guard:not_needed; revert:no` | [ ] | SSVValidators.sol:204-207, 210 |
| RM3-003 | Cluster(4 ops) → explicit EB → removeOp1 → removeValidator (single, last) | Single-remove variant of RM3-001: same underflow risk at same code path (lines 216-217 shared by single and bulk) | `ops:4; eb:explicit; removed_ops:1; last_validator:yes; entry:removeValidator; guard:needed; revert:yes_without_fix` | [ ] | SSVValidators.sol:215-218 |
| RM3-004 | Cluster(4 ops) → explicit EB → removeOp1 → removeValidator (single, not last) | Single-remove partial: deviation cleanup not triggered; verify ethValidatorCount NOT decremented for removed op, accounting correct for 3 live ops | `ops:4; eb:explicit; removed_ops:1; last_validator:no; entry:removeValidator; guard:not_needed; revert:no` | [ ] | OperatorLib.sol:245-261, SSVValidators.sol:204-207 |
| RM3-005 | Cluster(7 ops) → explicit EB → removeOp1 → bulkRemoveValidator (last validator) | 7-operator cluster: same underflow bug applies, deviation cleanup loop iterates 7 operators including removed one | `ops:7; eb:explicit; removed_ops:1; last_validator:yes; guard:needed; revert:yes_without_fix` | [ ] | SSVValidators.sol:215-218 |
| RM3-006 | Cluster(10 ops) → explicit EB → removeOp1 → bulkRemoveValidator (last validator) | 10-operator cluster: scale variant confirming guard needed at all operator counts | `ops:10; eb:explicit; removed_ops:1; last_validator:yes; guard:needed; revert:yes_without_fix` | [ ] | SSVValidators.sol:215-218 |
| RM3-007 | Cluster(13 ops) → explicit EB → removeOp1 → bulkRemoveValidator (last validator) | Max-operator cluster (13): verify guard prevents underflow at maximum scale, all 12 live ops cleaned correctly | `ops:13; eb:explicit; removed_ops:1; last_validator:yes; guard:needed; revert:yes_without_fix` | [ ] | SSVValidators.sol:215-218 |
| RM3-008 | Cluster(7 ops) → explicit EB → removeOp3,Op5 → bulkRemoveValidator (last validator) | Multiple removed operators (2 of 7): deviation cleanup must skip both, only subtract from 5 live ops | `ops:7; eb:explicit; removed_ops:2; last_validator:yes; guard:needed; revert:yes_without_fix` | [ ] | SSVValidators.sol:215-218 |
| RM3-009 | Cluster(4 ops) → explicit EB → removeOp1 → register new validator → bulkRemoveValidator (all) | Validator registered AFTER operator was removed; removed op never had ethValidatorCount incremented for new validator (skipped at registration too); bulk remove all → deviation cleanup must skip removed op | `ops:4; eb:explicit; removed_ops:1; last_validator:yes; post_removal_register:yes; guard:needed` | [ ] | SSVValidators.sol:215-218, OperatorLib.sol:155-230 |
| RM3-010 | Cluster(4 ops) → explicit EB → removeOp1 → bulkRemoveValidator (all N validators at once) | Bulk remove all validators in single call; verify validatorsRemoved == N, fee settlement once, deviation cleanup with guard skipping removed op | `ops:4; eb:explicit; removed_ops:1; last_validator:yes; bulk_all:yes; guard:needed` | [ ] | SSVValidators.sol:153-227 |
| RM3-011 | Cluster(4 ops) → explicit EB → removeOp1 → removeValidator (1 of 2) → removeValidator (last) | Two-step drain: first remove is partial (no cleanup), second remove is last-validator (triggers cleanup). Guard needed only on second call. | `ops:4; eb:explicit; removed_ops:1; last_validator:two_step; guard:needed_on_second` | [ ] | SSVValidators.sol:204-224 |
| RM3-012 | Cluster(4 ops) → implicit EB → removeOp1 → bulkRemoveValidator (last validator) | Implicit EB cluster (ebSnapshot.vUnits == 0): no deviation cleanup triggered; verify the entire EB block at lines 204-224 is skipped, no underflow risk | `ops:4; eb:implicit; removed_ops:1; last_validator:yes; guard:not_needed; revert:no` | [ ] | SSVValidators.sol:204 |
| RM3-013 | Cluster(4 ops) → explicit EB (no deviation) → removeOp1 → bulkRemoveValidator (last validator) | Explicit EB where vUnits == validatorCount * BPS_DENOMINATOR (no deviation): after baseline subtraction remainingVUnits == 0, cleanup loop skipped; no underflow | `ops:4; eb:explicit; removed_ops:1; last_validator:yes; deviation:zero; guard:not_needed; revert:no` | [ ] | SSVValidators.sol:212 |
| RM3-014 | Cluster(4 ops) → explicit EB → removeOp1 → verify ethValidatorCount NOT decremented for removed op | Accounting correctness: on bulkRemoveValidator, updateClusterOperators skips removed operator (ethSnapshot.block == 0); verify removed op's ethValidatorCount remains at stale value (0 from _resetOperatorState) | `ops:4; eb:explicit; removed_ops:1; verify:ethValidatorCount; guard:n/a` | [ ] | OperatorLib.sol:245-261 |
| RM3-015 | Cluster(4 ops) → explicit EB → removeOp1 → bulkRemoveValidator → verify remainingVUnits subtracted from live ops only | With guard fix applied: verify operatorEthVUnits decremented for ops 2,3,4 but NOT for removed op1; daoTotalEthVUnits adjusted by remainingVUnits once | `ops:4; eb:explicit; removed_ops:1; last_validator:yes; verify:operatorEthVUnits; guard:applied` | [ ] | SSVValidators.sol:215-221 |
| RM3-016 | Cluster(4 ops) → explicit EB → removeOp1 → bulkRemoveValidator → verify ebSnapshot cleared | After last-validator removal with removed operator: ebSnapshot.vUnits must be 0 regardless of guard behavior; verify no stale EB snapshot remains | `ops:4; eb:explicit; removed_ops:1; last_validator:yes; verify:ebSnapshot; guard:applied` | [ ] | SSVValidators.sol:222 |
| RM3-017 | Cluster(4 ops) → explicit EB → removeOp1 → liquidate → bulkRemoveValidator (last) | Liquidated cluster with removed operator: deviation cleanup SKIPPED (cluster.active == false at line 212); no underflow regardless of guard. Verify ebSnapshot.vUnits still zeroed at line 222 | `ops:4; eb:explicit; removed_ops:1; last_validator:yes; cluster:liquidated; guard:not_needed` | [ ] | SSVValidators.sol:210-223 |
| RM3-018 | Cluster(4 ops) → explicit EB → removeOp1 → cluster empties → verify all deviation data cleared | End-state correctness: after removing all validators and closing deviation cleanup, verify operatorEthVUnits[op2,3,4] reduced by remainingVUnits, ebSnapshot.vUnits == 0, daoTotalEthVUnits reduced, no orphaned EB state | `ops:4; eb:explicit; removed_ops:1; last_validator:yes; verify:full_cleanup; guard:applied` | [ ] | SSVValidators.sol:204-227 |
| RM3-019 | Cluster(4 ops) → explicit EB → removeOp1 → bulkRemoveValidator → operator earnings for live ops | Fee settlement correctness: live operators' snapshots are updated (balances accrue based on effectiveVUnits), removed operator snapshot NOT updated; verify operator earnings arithmetic | `ops:4; eb:explicit; removed_ops:1; last_validator:yes; verify:operator_earnings` | [ ] | OperatorLib.sol:248, 258 |
| RM3-020 | Cluster(4 ops) → explicit EB → removeOp1 (has other clusters) → bulkRemoveValidator (last) | Removed operator has operatorEthVUnits contributions from OTHER active clusters. Without guard, subtraction would corrupt those other clusters' deviation accounting. With guard, other clusters untouched. | `ops:4; eb:explicit; removed_ops:1; last_validator:yes; multi_cluster:yes; guard:critical` | [ ] | SSVValidators.sol:217, SSVOperators.sol:93 |
| RM3-021 | Cluster(13 ops) → explicit EB → remove 6 ops → bulkRemoveValidator (last) | Extreme: more than half of operators removed. Deviation cleanup must skip 6 and only subtract from 7 live ops. Validates guard at scale. | `ops:13; eb:explicit; removed_ops:6; last_validator:yes; guard:needed` | [ ] | SSVValidators.sol:215-218 |
| RM3-022 | Cluster(4 ops) → explicit EB → removeOp1 → bulkRemoveValidator (2 of 3) → bulkRemoveValidator (last 1) | Two-phase bulk removal: first bulk does not trigger cleanup (validatorCount > 0 after), second bulk triggers cleanup on last validator. Guard needed only on second bulk. | `ops:4; eb:explicit; removed_ops:1; last_validator:two_phase_bulk; guard:needed_on_second` | [ ] | SSVValidators.sol:204-224 |
| RM3-023 | Cluster(4 ops) → explicit EB → removeAllOps → bulkRemoveValidator (last) | ALL operators removed: every operator in cleanup loop must be skipped. updateClusterOperators also skips all (cumulativeFee == 0). Verify no underflow, no DAO adjustment for operators. | `ops:4; eb:explicit; removed_ops:4; last_validator:yes; all_removed:yes; guard:needed` | [ ] | SSVValidators.sol:215-218, OperatorLib.sol:245-261 |
| RM3-024 | Cluster(4 ops) → explicit EB with large deviation → removeOp1 → bulkRemoveValidator (last) | High-deviation cluster (e.g., vUnits = 5 * BPS_DENOMINATOR for 1 validator, deviation = 4 * BPS_DENOMINATOR): large remainingVUnits amplifies underflow magnitude without guard | `ops:4; eb:explicit; removed_ops:1; last_validator:yes; deviation:large; guard:needed` | [ ] | SSVValidators.sol:206-218 |
| RM3-025 | Cluster(4 ops) → explicit EB → removeOp1 → bulkRemoveValidator (last) → verify events | Event correctness: ValidatorRemoved events emitted with correct cluster struct (validatorCount == 0, settled balance) even when guard skips removed operator in deviation loop | `ops:4; eb:explicit; removed_ops:1; last_validator:yes; verify:events; guard:applied` | [ ] | SSVValidators.sol:254-256 |

---

## Detailed Scenario Blocks

### RM3-001: Core Bug — Last-Validator Removal With Removed Operator Underflows

**Entry:** `bulkRemoveValidator`
**Preconditions:**
1. Register 1 validator in 4-op ETH cluster with operators [1,2,3,4]
2. Oracle EB update: `ebSnapshot.vUnits = 1 * BPS_DENOMINATOR + 2000` (deviation = 2000)
3. `operatorEthVUnits[1] += 2000`, `operatorEthVUnits[2] += 2000`, etc.
4. `daoTotalEthVUnits += 2000`
5. Operator 1 owner calls `removeOperator(1)`:
   - `_resetOperatorState`: `ethSnapshot.block = 0`, `ethValidatorCount = 0`, fees zeroed
   - **Line 93**: `delete seb.operatorEthVUnits[1]` → value is now 0
6. Cluster still references operator 1 in its operator set

**Action:** Call `bulkRemoveValidator([pk1], [1,2,3,4], cluster)` from cluster owner

**Expected State Mutations (WITHOUT guard — THE BUG):**
1. `_validateExistingValidator` passes, `validatorPKs[hash]` deleted, `validatorsRemoved = 1`
2. `updateClusterOperators([1,2,3,4], false, 1, s, sp)`:
   - Op1: `ethSnapshot.block == 0` → **SKIPPED** (no snapshot update, no ethValidatorCount decrement)
   - Ops 2,3,4: snapshot updated, `ethValidatorCount -= 1`
3. `cluster.validatorCount -= 1` → 0
4. EB cleanup (line 204): `ebSnapshot.vUnits -= 1 * BPS_DENOMINATOR` → `remainingVUnits = 2000`
5. Line 212: `remainingVUnits > 0 && cluster.active` → true
6. **Line 217**: `seb.operatorEthVUnits[1] -= 2000` → **0 - 2000 = UNDERFLOW** (uint64 wraps to 2^64 - 2000)
7. Transaction reverts with Solidity 0.8 checked arithmetic (panic code 0x11)

**Expected State Mutations (WITH guard — THE FIX):**
6. Line 216-217 loop: check `s.operators[operatorIds[i]].ethSnapshot.block == 0` for op1 → `continue`
7. Ops 2,3,4: `seb.operatorEthVUnits[opId] -= 2000` → succeeds
8. `sp.updateDAOEthVUnits(2000, 0)` → `daoTotalEthVUnits -= 2000`
9. `ebSnapshot.vUnits = 0`

**Postconditions (with fix):**
- `operatorEthVUnits[1]` untouched (remains 0 — already deleted by removeOperator)
- `operatorEthVUnits[2,3,4]` each reduced by 2000
- `daoTotalEthVUnits` reduced by 2000
- `ebSnapshot.vUnits == 0`
- `ethValidatorCount` for ops 2,3,4 decremented; op1 unchanged (stale 0)
- `ValidatorRemoved` event emitted

**Why this matters:** This is the exact production scenario that causes the underflow revert. The real `removeOperator()` deletes `operatorEthVUnits`, setting it to 0. Any subsequent subtraction from 0 panics under Solidity 0.8. The `mockRemoveOperator()` in tests did NOT delete `operatorEthVUnits`, masking the bug.

**Code path:** SSVValidators.sol lines 153-257, focus lines 215-218. SSVOperators.sol line 93.

---

### RM3-005: 7-Operator Cluster — Removed Operator Underflow at Scale

**Entry:** `bulkRemoveValidator`
**Preconditions:**
1. Register 2 validators in 7-op ETH cluster with operators [1,2,3,4,5,6,7]
2. Oracle EB update: `ebSnapshot.vUnits = 2 * BPS_DENOMINATOR + 3500` (deviation = 3500)
3. `operatorEthVUnits[opId] += 3500` for all 7 operators
4. Operator 4 removed: `delete seb.operatorEthVUnits[4]` → 0
5. Advance blocks for fee accumulation

**Action:** Call `bulkRemoveValidator([pk1, pk2], [1,2,3,4,5,6,7], cluster)` from owner

**Expected (without fix):** Underflow at `seb.operatorEthVUnits[4] -= 3500` (0 - 3500). Revert with panic 0x11.

**Expected (with fix):**
1. `updateClusterOperators`: op4 skipped, ops 1,2,3,5,6,7 updated (`ethValidatorCount -= 2`)
2. `cluster.validatorCount -= 2` → 0
3. `ebSnapshot.vUnits -= 2 * BPS_DENOMINATOR` → `remainingVUnits = 3500`
4. Loop: op4 skipped (block == 0), ops 1,2,3,5,6,7 each get `operatorEthVUnits -= 3500`
5. `updateDAOEthVUnits(3500, 0)`, `ebSnapshot.vUnits = 0`

**Postconditions:**
- 6 live operators' `operatorEthVUnits` each reduced by 3500
- Op4's `operatorEthVUnits` remains 0
- No revert, all accounting balanced

**Code path:** SSVValidators.sol lines 215-218

---

### RM3-009: Validator Registered After Operator Removal

**Entry:** `bulkRemoveValidator`
**Preconditions:**
1. Register 1 validator (pk1) in 4-op ETH cluster with operators [1,2,3,4]
2. Operator 2 removed: `delete seb.operatorEthVUnits[2]`, `ethSnapshot.block = 0`
3. Register a second validator (pk2) in the same cluster:
   - `updateClusterOperators([1,2,3,4], true, 1, s, sp)`: op2 SKIPPED (block==0), ops 1,3,4 get `ethValidatorCount++`
   - Op2 never gets ethValidatorCount incremented for pk2
4. Oracle EB update (covers both validators): `ebSnapshot.vUnits = 2 * BPS_DENOMINATOR + 1500`
   - Deviation = 1500 distributed to ops 1,3,4 via `operatorEthVUnits`
   - Op2 skipped in EB update (block==0): `operatorEthVUnits[2]` remains 0

**Action:** Call `bulkRemoveValidator([pk1, pk2], [1,2,3,4], cluster)` from owner

**Expected (with fix):**
1. Both validators deleted, `validatorsRemoved = 2`
2. `updateClusterOperators`: op2 skipped, ops 1,3,4 get `ethValidatorCount -= 2`
3. `cluster.validatorCount -= 2` → 0
4. `ebSnapshot.vUnits -= 2 * BPS_DENOMINATOR` → `remainingVUnits = 1500`
5. Loop: op2 skipped (block==0), ops 1,3,4 get `operatorEthVUnits -= 1500`
6. `updateDAOEthVUnits(1500, 0)`, `ebSnapshot.vUnits = 0`

**Key verification:** Even though pk2 was registered after op2's removal, the flow is consistent — op2 was correctly excluded at every step (registration, EB update, removal). No asymmetric state.

**Code path:** SSVValidators.sol lines 153-227, OperatorLib.sol lines 245-261

---

### RM3-011: Two-Step Drain — Partial Then Last Validator

**Entry:** `removeValidator` (called twice)
**Preconditions:**
1. Register 2 validators (pk1, pk2) in 4-op ETH cluster with operators [1,2,3,4]
2. Oracle EB update: `ebSnapshot.vUnits = 2 * BPS_DENOMINATOR + 4000` (deviation = 4000)
3. `operatorEthVUnits[opId] += 4000` for all 4 operators
4. Operator 1 removed: `delete seb.operatorEthVUnits[1]` → 0

**Action 1:** `removeValidator(pk1, [1,2,3,4], cluster)` — NOT last validator

**Expected (Action 1):**
1. `updateClusterOperators`: op1 skipped, ops 2,3,4 get `ethValidatorCount -= 1`
2. `cluster.validatorCount -= 1` → 1
3. `ebSnapshot.vUnits -= 1 * BPS_DENOMINATOR` → `1 * BPS_DENOMINATOR + 4000`
4. `cluster.validatorCount != 0` → **NO deviation cleanup** → no underflow risk

**Action 2:** `removeValidator(pk2, [1,2,3,4], cluster)` — LAST validator

**Expected (Action 2, without fix):**
1. `updateClusterOperators`: op1 skipped, ops 2,3,4 get `ethValidatorCount -= 1`
2. `cluster.validatorCount -= 1` → 0
3. `ebSnapshot.vUnits -= 1 * BPS_DENOMINATOR` → `remainingVUnits = 4000`
4. **Line 217**: `seb.operatorEthVUnits[1] -= 4000` → **UNDERFLOW**

**Expected (Action 2, with fix):**
4. Loop: op1 skipped (block==0), ops 2,3,4 get `operatorEthVUnits -= 4000`
5. All cleanup completes successfully

**Why this matters:** The bug only manifests on the final removal. Intermediate removals are safe because `validatorCount > 0` prevents entering the deviation cleanup block. This two-step pattern demonstrates the deferred nature of the underflow.

**Code path:** SSVValidators.sol lines 204-224

---

### RM3-012: Implicit EB — No Underflow Risk (Negative Test)

**Entry:** `bulkRemoveValidator`
**Preconditions:**
1. Register 1 validator in 4-op ETH cluster (implicit EB — no oracle EB update ever applied)
2. `ebSnapshot.vUnits == 0` (no explicit EB tracking)
3. Operator 1 removed: `ethSnapshot.block = 0`, `delete seb.operatorEthVUnits[1]`

**Action:** Call `bulkRemoveValidator([pk1], [1,2,3,4], cluster)` from owner

**Expected State Mutations:**
1. Validator deleted, `validatorsRemoved = 1`
2. `updateClusterOperators`: op1 skipped, ops 2,3,4 updated
3. `cluster.validatorCount -= 1` → 0
4. EB path (line 204): `ebSnapshot.vUnits > 0` → **FALSE** → entire EB block skipped
5. No deviation cleanup, no operatorEthVUnits access, no underflow possibility

**Postconditions:**
- Removal succeeds without any EB-related computation
- Baseline accounting handled entirely via `ethValidatorCount` in `updateClusterOperators`

**Why this matters:** Confirms the bug is exclusively an explicit-EB-with-deviation issue. Implicit clusters are immune because `ebSnapshot.vUnits == 0` gates the entire cleanup path.

**Code path:** SSVValidators.sol line 204

---

### RM3-020: Removed Operator Has Cross-Cluster Deviation (Guard Critical for Data Integrity)

**Entry:** `bulkRemoveValidator`
**Preconditions:**
1. Operator 1 participates in TWO clusters: ClusterA (ops [1,2,3,4]) and ClusterB (ops [1,5,6,7])
2. ClusterA: 1 validator, oracle EB update → `ebSnapshot.vUnits = 1 * BPS_DENOMINATOR + 3000` (deviation = 3000)
3. ClusterB: 1 validator, oracle EB update → `ebSnapshot.vUnits = 1 * BPS_DENOMINATOR + 2000` (deviation = 2000)
4. `operatorEthVUnits[1] = 3000 + 2000 = 5000` (combined deviation from both clusters)
5. Operator 1 removed: `delete seb.operatorEthVUnits[1]` → 0
6. Note: `removeOperator()` deletes operatorEthVUnits entirely, regardless of multi-cluster contributions

**Action:** Call `bulkRemoveValidator([pk_A], [1,2,3,4], clusterA)` — remove last validator from ClusterA

**Expected (without fix):**
- `remainingVUnits = 3000`
- `seb.operatorEthVUnits[1] -= 3000` → 0 - 3000 → **UNDERFLOW**

**Expected (with fix):**
- Op1 skipped in deviation cleanup loop
- Ops 2,3,4 get `operatorEthVUnits -= 3000`
- ClusterB's deviation in ops 5,6,7 is untouched (separate cluster, separate removal)
- Op1's operatorEthVUnits remains 0 (correctly — operator is removed, will never earn again)

**Why this matters:** Even if operatorEthVUnits[1] were not deleted (hypothetical scenario), subtracting ClusterA's deviation from an aggregated value that includes ClusterB's deviation would be incorrect for a removed operator. The guard is the correct solution: removed operators should be fully excluded from deviation cleanup because they are already settled and inert.

**Code path:** SSVValidators.sol lines 215-218, SSVOperators.sol line 93

---

### RM3-021: Extreme Scale — 6 of 13 Operators Removed

**Entry:** `bulkRemoveValidator`
**Preconditions:**
1. Register 3 validators in 13-op ETH cluster with operators [1..13]
2. Oracle EB update: `ebSnapshot.vUnits = 3 * BPS_DENOMINATOR + 5000` (deviation = 5000)
3. Operators 2, 4, 6, 8, 10, 12 removed (6 of 13): each has `operatorEthVUnits` deleted
4. Remaining live operators: 1, 3, 5, 7, 9, 11, 13 (7 operators)

**Action:** Call `bulkRemoveValidator([pk1, pk2, pk3], [1..13], cluster)` from owner

**Expected (with fix):**
1. `updateClusterOperators`: 6 removed ops skipped, 7 live ops get `ethValidatorCount -= 3`
2. `cluster.validatorCount -= 3` → 0
3. `ebSnapshot.vUnits -= 3 * BPS_DENOMINATOR` → `remainingVUnits = 5000`
4. Deviation cleanup loop iterates all 13 operators:
   - Ops 2,4,6,8,10,12: `ethSnapshot.block == 0` → `continue` (6 skips)
   - Ops 1,3,5,7,9,11,13: `operatorEthVUnits -= 5000` (7 subtractions)
5. `updateDAOEthVUnits(5000, 0)`, `ebSnapshot.vUnits = 0`

**Key verification:**
- Loop executed 13 iterations total, 6 skipped, 7 subtracted — correct
- No underflow on any removed operator
- daoTotalEthVUnits reduced by 5000 (single call, not per-operator)
- Gas remains reasonable (13 SLOAD for ethSnapshot.block checks + 7 SSTORE for operatorEthVUnits)

**Code path:** SSVValidators.sol lines 215-221

---

### RM3-023: ALL Operators Removed — Edge Case

**Entry:** `bulkRemoveValidator`
**Preconditions:**
1. Register 1 validator in 4-op ETH cluster with operators [1,2,3,4]
2. Oracle EB update: `ebSnapshot.vUnits = 1 * BPS_DENOMINATOR + 1000` (deviation = 1000)
3. ALL 4 operators removed: each has `operatorEthVUnits` deleted, `ethSnapshot.block = 0`
4. Cluster is still "active" with `validatorCount == 1` (validators persist when operators are removed)

**Action:** Call `bulkRemoveValidator([pk1], [1,2,3,4], cluster)` from owner

**Expected (with fix):**
1. `updateClusterOperators([1,2,3,4], false, 1, s, sp)`:
   - ALL operators skipped (all have `ethSnapshot.block == 0`)
   - `cumulativeIndex` = sum of preserved indices only
   - `cumulativeFee` = 0 (no active operators contributing fees)
2. Fee settlement with `cumulativeFee == 0`: minimal deduction (only network fee component)
3. `cluster.validatorCount -= 1` → 0
4. `ebSnapshot.vUnits -= 1 * BPS_DENOMINATOR` → `remainingVUnits = 1000`
5. `cluster.active` check — **debatable**: cluster may still be technically active
6. Deviation cleanup loop: ALL 4 operators skipped by guard → **no operatorEthVUnits modified**
7. `updateDAOEthVUnits(1000, 0)` → daoTotalEthVUnits reduced
8. `ebSnapshot.vUnits = 0`

**Key verification:**
- No underflow on any operator
- daoTotalEthVUnits still adjusted (DAO tracks global state, not per-operator)
- Deviation "leaks" in the sense that no operator absorbs the subtraction, but this is correct — the deviation was already zeroed from operator perspective when operators were removed

**Why this matters:** Edge case where the guard skips EVERY operator. The deviation subtraction goes only to DAO. Validates that the guard doesn't break DAO accounting.

**Code path:** SSVValidators.sol lines 153-227, OperatorLib.sol lines 245-261

---

## Coverage Matrix

| Dimension | Values | Scenarios |
|-----------|--------|-----------|
| **Operator count** | 4 ops | RM3-001, 002, 003, 004, 010, 011, 012, 013, 014, 015, 016, 017, 018, 019, 020, 022, 023, 024, 025 |
| | 7 ops | RM3-005, 008 |
| | 10 ops | RM3-006 |
| | 13 ops | RM3-007, 021 |
| **Removed ops count** | 1 removed | RM3-001, 002, 003, 004, 005, 006, 007, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018, 019, 020, 022, 024, 025 |
| | 2 removed | RM3-008 |
| | 6 removed | RM3-021 |
| | All removed | RM3-023 |
| **EB type** | Explicit (with deviation) | RM3-001, 003, 005, 006, 007, 008, 009, 010, 011, 014, 015, 016, 017, 018, 019, 020, 021, 022, 023, 024, 025 |
| | Explicit (no deviation) | RM3-013 |
| | Implicit | RM3-012 |
| **Last validator?** | Yes (cleanup triggered) | RM3-001, 003, 005, 006, 007, 008, 009, 010, 012, 013, 015, 016, 017, 018, 019, 020, 021, 023, 024, 025 |
| | No (cleanup skipped) | RM3-002, 004, 014 |
| | Two-step (partial then last) | RM3-011, 022 |
| **Entry point** | bulkRemoveValidator | RM3-001, 002, 005, 006, 007, 008, 009, 010, 012, 013, 014, 015, 016, 017, 018, 020, 021, 022, 023, 024, 025 |
| | removeValidator (single) | RM3-003, 004, 011 |
| | Mixed (two calls) | RM3-011, 019 |
| **Cluster state** | Active | RM3-001 through 016, 018 through 025 |
| | Liquidated | RM3-017 |
| **Guard needed?** | Yes (underflow without fix) | RM3-001, 003, 005, 006, 007, 008, 009, 010, 011, 020, 021, 022, 023, 024 |
| | No (path not reached) | RM3-002, 004, 012, 013, 014, 017 |
| | Verification only | RM3-015, 016, 018, 019, 025 |

---

## Summary

**25 scenarios** covering the intersection of removed-operator state with `_bulkRemoveValidator`'s deviation cleanup loop (SSVValidators.sol lines 216-217).

**The core bug:** When `removeOperator()` is called, it `delete`s `seb.operatorEthVUnits[operatorId]` (setting it to 0) and zeros `ethSnapshot.block`. The deviation cleanup loop in `_bulkRemoveValidator` (triggered when removing the last validator from an explicit-EB cluster) iterates ALL operators in the cluster and subtracts `remainingVUnits` from each `operatorEthVUnits[opId]`. For a removed operator, this is `0 - remainingVUnits` = underflow, causing a revert under Solidity 0.8 checked arithmetic.

**The fix:** Add `if (s.operators[operatorIds[i]].ethSnapshot.block == 0) continue;` inside the loop at line 216, matching the same guard pattern used in `updateClusterOperators` (OperatorLib.sol:247).

**Why `mockRemoveOperator()` masked this:** The test harness resets operator fields but never calls `delete seb.operatorEthVUnits[operatorId]`. With mock removal, `operatorEthVUnits` retains its pre-removal value, so the subtraction succeeds — hiding the production underflow.

**Scenario distribution:**
- 14 scenarios exercise the guard-needed path (underflow without fix)
- 5 scenarios verify correct post-fix accounting (operatorEthVUnits, ebSnapshot, events)
- 3 scenarios are negative tests confirming no underflow risk when the cleanup path is not reached (implicit EB, no deviation, partial removal)
- 2 scenarios cover two-step drain patterns
- 1 scenario covers liquidated cluster interaction

**Cross-references:** VX-028, VX-037, VX-038, VX-063 in `scenarios-vl-remove-exit.md`
