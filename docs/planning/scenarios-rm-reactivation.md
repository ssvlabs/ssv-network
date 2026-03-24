# Scenarios — Removed Operator Reactivation Guard (RM5-001 to RM5-020)

**Prefix:** RM5
**Worker:** W5
**Source contracts:** `OperatorLib.sol` (`updateClusterOperatorsOnReactivation` lines 275-330), `SSVClusters.sol` (`reactivate` lines 129-181, `_executeLiquidation` lines 552-612), `SSVOperators.sol` (`removeOperator` lines 71-104, `_resetOperatorState` lines 347-358)
**Spec refs:** SPEC §2 "Effective Balance Accounting", SPEC §1 "Cluster Flows" (Reactivation), FLOWS §1.11 (Reactivate)

**Bug context:** `mockRemoveOperator()` in test harness did not delete `operatorEthVUnits`, leaving stale deviation. Real `removeOperator()` (line 93) deletes `operatorEthVUnits[operatorId]` and `_resetOperatorState` zeros `ethSnapshot.block`. The guard at `OperatorLib.sol:291` (`if (operator.ethSnapshot.block != 0)`) is the gate that skips removed operators during reactivation. These scenarios verify that gate works correctly in all cluster configurations and deviation states.

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| RM5-001 | reactivate | 4-op cluster, explicit EB, liquidate, remove 1 op, reactivate — removed op skipped by line 291 guard, 3 active ops updated | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; guard:line291; revert:no` | [ ] | OperatorLib.sol:291,321-327; SSVClusters.sol:147-154 |
| RM5-002 | reactivate | 4-op cluster, explicit EB, remove 1 op THEN liquidate, reactivate — same outcome regardless of op-removal/liquidation order | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; guard:line291; revert:no` | [ ] | OperatorLib.sol:291; SSVClusters.sol:129-181 |
| RM5-003 | reactivate | 7-op cluster, explicit EB, liquidate, remove 2 ops, reactivate — 5 active ops updated, 2 skipped | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:7; remove_mode:real; guard:line291; revert:no` | [ ] | OperatorLib.sol:287-329 |
| RM5-004 | reactivate | 10-op cluster, explicit EB, liquidate, remove 3 ops, reactivate — 7 active ops updated, 3 skipped | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:10; remove_mode:real; guard:line291; revert:no` | [ ] | OperatorLib.sol:287-329 |
| RM5-005 | reactivate | 13-op cluster (max), explicit EB, liquidate, remove 4 ops, reactivate — 9 active, 4 skipped | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:13; remove_mode:real; guard:line291; revert:no` | [ ] | OperatorLib.sol:287-329 |
| RM5-006 | reactivate | 4-op cluster, ALL 4 operators removed, reactivate — all ops skipped, cumulativeFee=0, cumulativeIndex from preserved indexes only | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real_all; guard:line291; revert:no` | [ ] | OperatorLib.sol:291,326-328 |
| RM5-007 | reactivate | 7-op cluster, ALL 7 operators removed, reactivate — burnRate=0, solvency trivially passes | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:7; remove_mode:real_all; guard:line291; revert:no` | [ ] | OperatorLib.sol:291; SSVClusters.sol:161-171 |
| RM5-008 | reactivate | 4-op cluster, explicit EB with deviation, remove 1 op, reactivate — deviation distributed only to 3 active ops (ethSnapshot.block != 0) | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; guard:line291; deviation:yes; revert:no` | [ ] | OperatorLib.sol:291,312-319 |
| RM5-009 | reactivate | 4-op cluster, explicit EB with deviation, remove 1 op, reactivate — verify daoTotalEthVUnits incremented by full clusterDeviation (not reduced for removed op) | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; guard:line291; deviation:yes; revert:no` | [ ] | SSVClusters.sol:173-176; OperatorLib.sol:312-319 |
| RM5-010 | reactivate | 4-op cluster, implicit EB (no deviation), liquidate, remove 1 op, reactivate — clusterDeviation=0, no operatorEthVUnits written | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; guard:line291; deviation:no; revert:no` | [ ] | OperatorLib.sol:312; SSVClusters.sol:145 |
| RM5-011 | reactivate | Guard verification: removed op has ethSnapshot.block==0, ethFee==0, ethValidatorCount==0 — confirm all three zeroed by _resetOperatorState | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; guard:line291; revert:no` | [ ] | SSVOperators.sol:347-358; OperatorLib.sol:291 |
| RM5-012 | reactivate | Guard verification: active op has ethSnapshot.block != 0 — confirm fee accrual computed, index updated, ethValidatorCount incremented | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; guard:line291; revert:no` | [ ] | OperatorLib.sol:292-310,321-326 |
| RM5-013 | reactivate | Removed op's operatorEthVUnits already deleted by removeOperator — reactivation does NOT write stale deviation back | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; guard:line291; deviation:yes; revert:no` | [ ] | SSVOperators.sol:93; OperatorLib.sol:291,312-319 |
| RM5-014 | reactivate | EB update on inactive (liquidated) cluster, THEN remove op, THEN reactivate — stale EB snapshot, guard still skips removed op | `entry:updateClusterBalance+reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; guard:line291; revert:no` | [ ] | SSVClusters.sol:395-403; OperatorLib.sol:291 |
| RM5-015 | reactivate | Reactivate with hasDeviation=true (global), removed op skipped — effectiveVUnits computation never reached for removed op | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; guard:line291; deviation:global_yes; revert:no` | [ ] | OperatorLib.sol:285,291,298-303 |
| RM5-016 | reactivate | Reactivate with hasDeviation=false (global daoTotalEthVUnits == ethDaoValidatorCount * BPS) — effectiveVUnits uses baseline path for active ops | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; guard:line291; deviation:global_no; revert:no` | [ ] | OperatorLib.sol:285,302 |
| RM5-017 | reactivate | ExceedValidatorLimitWithData on reactivation — active op at limit, reactivation tries to increment ethValidatorCount; must revert | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; guard:line291; revert:yes` | [ ] | OperatorLib.sol:322-324 |
| RM5-018 | reactivate | Removed op at position [0] in operatorIds array — guard triggers on first iteration, rest proceed normally | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; guard:line291; position:first; revert:no` | [ ] | OperatorLib.sol:287-291 |
| RM5-019 | reactivate | Removed op at position [last] in operatorIds array — guard triggers on last iteration | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; guard:line291; position:last; revert:no` | [ ] | OperatorLib.sol:287-291 |
| RM5-020 | reactivate | Two removed ops in 7-op cluster (positions [1] and [5]) — both skipped, 5 active ops get deviation and fee updates | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:7; remove_mode:real; guard:line291; position:mixed; revert:no` | [ ] | OperatorLib.sol:287-329 |

---

## Detailed Scenario Blocks

---

### RM5-001: Liquidate → Remove 1 Op → Reactivate (4-op, explicit EB)

**Goal:** Verify the canonical flow: a cluster with explicit EB is liquidated, one operator is removed, and upon reactivation the removed operator is correctly skipped by the `ethSnapshot.block != 0` guard at line 291.

**Setup:**
1. Register 4 operators (op1-op4) with non-zero ETH fees (e.g., 1,770,000,000 packed each).
2. Create active ETH cluster (4 ops, 2 validators), deposit sufficient ETH.
3. Call `updateClusterBalance` with `effectiveBalance=128` (64 ETH/val), creating explicit EB: `vUnits=40000`, `deviation=20000` per operator.
4. Drain cluster until liquidatable. Third-party calls `liquidate`.
5. Verify post-liquidation: `cluster.active=false`, `cluster.balance=0`, deviation cleaned from operators and DAO by `_executeLiquidation` (lines 567-596).
6. Op2 owner calls `removeOperator(op2)`.

**Post-removal state (verify):**
- `op2.ethSnapshot.block == 0` (line 348).
- `op2.ethFee == 0`, `op2.ethValidatorCount == 0` (lines 350, 354).
- `seb.operatorEthVUnits[op2] == 0` (line 93 delete).
- Op1, op3, op4 retain their `ethSnapshot.block != 0`.

**Execution:**
1. Owner calls `reactivate(operatorIds, cluster)` with sufficient `msg.value`.

**Assertions:**
- `updateClusterOperatorsOnReactivation` iterates 4 operators.
- **op2:** `operator.ethSnapshot.block == 0` → guard at line 291 is false → entire block (lines 292-327) skipped.
- **op2:** `cumulativeFee` NOT incremented for op2 (line 326 inside guard).
- **op2:** `cumulativeIndex += operator.ethSnapshot.index` at line 328 is reached (OUTSIDE guard) — but `op2.ethSnapshot.index == 0` (reset), so adds 0.
- **op1, op3, op4:** Guard passes → `ethSnapshot.index` updated with accrued fee, `ethValidatorCount` incremented by `cluster.validatorCount`, fee added to `cumulativeFee`.
- `clusterDeviation` (from line 145: `vUnitsCluster - baselineVUnits`) added to `operatorEthVUnits` for op1, op3, op4 ONLY (inside guard, lines 312-319).
- `daoTotalEthVUnits` incremented by full `clusterDeviation` (line 175) — DAO accounting is per-cluster, not per-operator.
- `burnRate` (returned `cumulativeFee`) reflects only 3 operators' fees.
- Solvency check at line 161-171 uses `effectiveVUnits` and `burnRate` from 3 ops → msg.value must cover 3-op burn rate, not 4.
- `ClusterReactivated` event emitted.

**Code path:** `SSVClusters.sol:142-145` (vUnits + deviation) → `OperatorLib.sol:287` (loop) → `291` (guard: op2 skipped) → `312-319` (deviation for op1,3,4) → `321` (ethValidatorCount for op1,3,4) → `326` (cumulativeFee for op1,3,4) → `328` (cumulativeIndex for all) → `SSVClusters.sol:161-171` (solvency) → `173-176` (DAO update).

---

### RM5-002: Remove 1 Op THEN Liquidate → Reactivate (order invariance)

**Goal:** Verify that removing an operator BEFORE liquidation produces identical reactivation behavior as removing AFTER liquidation (RM5-001). The guard at line 291 is state-based, not order-based.

**Setup:**
1. Same as RM5-001 steps 1-3 (4 ops, explicit EB, deviation=20000).
2. **Different order:** Op2 owner calls `removeOperator(op2)` while cluster is still active.
3. `removeOperator` settles op2 earnings, zeros state, deletes `operatorEthVUnits[op2]`.
4. Third-party calls `liquidate`. During `_executeLiquidation` deviation cleanup (line 586-591), the loop writes to `operatorEthVUnits[op2]` with subtraction — but `operatorEthVUnits[op2]` is already 0 (deleted). This means: `0 - deviation` would underflow if deviation > 0.

**Critical observation:** The `_executeLiquidation` deviation cleanup loop at line 585-592 iterates ALL operatorIds unconditionally — no `ethSnapshot.block != 0` guard. If op2 was removed (operatorEthVUnits[op2] deleted = 0) and the cluster had deviation, the subtraction `seb.operatorEthVUnits[operatorIds[i]] -= deviation` will underflow. This is a potential secondary bug in the liquidation path when an op is removed before liquidation.

**Execution:**
1. If the underflow does NOT occur (deviation was already cleaned during removeOperator): liquidation succeeds, then owner reactivates.
2. Reactivation: same assertions as RM5-001 — op2 skipped at line 291.

**Assertions (reactivation phase):**
- Identical to RM5-001: op2 skipped, 3 active ops updated, burnRate from 3 ops.
- **Additional:** Confirm that total `daoTotalEthVUnits` is consistent regardless of remove-then-liquidate vs liquidate-then-remove ordering.

**Risk flag:** The liquidation deviation cleanup path may need the same `ethSnapshot.block != 0` guard as reactivation. Cross-ref with RM1-* scenarios.

**Code path:** `SSVOperators.sol:91-93` (reset + delete) → `SSVClusters.sol:585-592` (liquidation cleanup, **no guard**) → `OperatorLib.sol:291` (reactivation guard).

---

### RM5-006: ALL Operators Removed → Reactivate (edge case)

**Goal:** Verify behavior when ALL operators in a cluster have been removed before reactivation. Every iteration of the loop hits the `ethSnapshot.block == 0` guard and skips.

**Setup:**
1. Register 4 operators, create active ETH cluster (4 ops, 1 validator), implicit EB.
2. Liquidate the cluster.
3. Remove all 4 operators (op1, op2, op3, op4).

**Post-removal state:**
- All 4 operators: `ethSnapshot.block == 0`, `ethFee == 0`, `ethValidatorCount == 0`.
- All 4: `operatorEthVUnits` deleted.

**Execution:**
1. Owner calls `reactivate(operatorIds, cluster)` with `msg.value > 0`.

**Assertions:**
- Loop iterates 4 times, each hits `ethSnapshot.block == 0` → skips.
- `cumulativeFee = 0` (no operator contributed fee).
- `cumulativeIndex = 0` (all indexes reset to 0).
- `burnRate = 0` (returned as cumulativeFee).
- `cluster.index = 0`, `cluster.networkFeeIndex = current`.
- Solvency check: `isLiquidatableWithVUnits(effectiveVUnits=10000, burnRate=0, networkFee, ...)` — with burnRate=0, the only cost is network fee. If msg.value covers `minimumBlocksBeforeLiquidation * networkFee + minimumLiquidationCollateral`, reactivation succeeds.
- `cluster.active = true`.
- DAO updated: `ethDaoValidatorCount += validatorCount` (line 173).
- No deviation accounting (implicit EB, clusterDeviation=0).
- **Net effect:** Cluster is active with all removed operators. Validators are "orphaned" — they have no active operators serving them. This is a valid but degenerate state.

**Code path:** `OperatorLib.sol:291` (guard false, all 4 iterations) → `328` (cumulativeIndex += 0, all 4) → `SSVClusters.sol:161-171` (solvency with burnRate=0).

---

### RM5-008: Deviation Distributed Only to Active Ops on Reactivation

**Goal:** Verify that when reactivating a cluster with explicit EB deviation, the `clusterDeviation` is written to `operatorEthVUnits` only for operators that pass the `ethSnapshot.block != 0` guard.

**Setup:**
1. Register 4 operators, create ETH cluster (4 ops, 2 validators).
2. Call `updateClusterBalance` with effectiveBalance=128 (64 ETH/val): `vUnits=40000`, `baseline=20000`, `deviation=20000`.
3. Liquidate: `_executeLiquidation` cleans up deviation from all 4 operators (lines 586-591).
4. Remove op3: `operatorEthVUnits[op3]` deleted, `ethSnapshot.block = 0`.

**Pre-reactivation state:**
- `seb.clusterEB[clusterId].vUnits = 40000` (snapshot persists through liquidation).
- `clusterDeviation = 40000 - 20000 = 20000` (computed at line 145).
- op3: `ethSnapshot.block == 0`, `operatorEthVUnits[op3] == 0`.
- op1, op2, op4: `ethSnapshot.block != 0`, `operatorEthVUnits` = 0 (cleaned by liquidation).

**Execution:**
1. Owner calls `reactivate(operatorIds, cluster)` with sufficient msg.value.

**Assertions:**
- Inside the reactivation loop:
  - op1, op2, op4: guard passes → `clusterDeviation != 0` (line 312) → `hasDeviation` checked (line 313).
  - If `hasDeviation == true` (global: `daoTotalEthVUnits != ethDaoValidatorCount * BPS`): `operatorEthVUnits[opX] = storedDeviation + clusterDeviation` → `0 + 20000 = 20000` for each.
  - If `hasDeviation == false`: `operatorEthVUnits[opX] = clusterDeviation` → `20000` for each.
  - op3: guard fails → `operatorEthVUnits[op3]` NOT written. Remains 0.
- **3 active ops** each get `operatorEthVUnits = 20000`.
- **op3** stays at 0 — no stale deviation written.
- `daoTotalEthVUnits += 20000` (line 175) — full cluster deviation, counted once.
- **Invariant check:** sum of `operatorEthVUnits` across op1+op2+op4 = 60000, but `daoTotalEthVUnits` only increased by 20000. This is expected because `operatorEthVUnits` tracks per-operator deviation (each gets the full cluster deviation), while DAO tracks the aggregate per-cluster contribution.

**Code path:** `SSVClusters.sol:145` (clusterDeviation=20000) → `OperatorLib.sol:291` (op3 skipped) → `312-319` (deviation written to op1,2,4 only) → `SSVClusters.sol:174-176` (DAO += 20000).

---

### RM5-009: daoTotalEthVUnits Correct Despite Removed Ops

**Goal:** Verify that `daoTotalEthVUnits` is incremented by the full `clusterDeviation` on reactivation, regardless of how many operators are removed. DAO accounting is cluster-scoped, not operator-scoped.

**Setup:**
1. Same as RM5-008 setup (4 ops, 2 validators, explicit EB vUnits=40000, deviation=20000).
2. Liquidate. Remove op2 AND op3 (2 of 4 removed).

**Pre-reactivation state:**
- `clusterDeviation = 20000`.
- 2 active ops (op1, op4), 2 removed (op2, op3).

**Execution:**
1. Owner calls `reactivate`.

**Assertions:**
- `updateClusterOperatorsOnReactivation` processes: op1 (active), op2 (skip), op3 (skip), op4 (active).
- `operatorEthVUnits[op1] += 20000`, `operatorEthVUnits[op4] += 20000`.
- `operatorEthVUnits[op2] == 0`, `operatorEthVUnits[op3] == 0`.
- `daoTotalEthVUnits += 20000` (line 175) — NOT reduced to account for removed ops.
- **Potential concern:** With only 2 active ops holding deviation, the operator-level vUnits sum (2 * 20000 = 40000) may diverge from the expected "4 * 20000 = 80000" if all ops were active. This is correct behavior: the cluster's contribution to the global EB accounting via DAO is still 20000 (cluster-level), and each active operator individually reflects the full cluster deviation for fee computation purposes.
- `burnRate` = op1.ethFee + op4.ethFee (2 operators).
- Solvency threshold uses `effectiveVUnits = 40000` and 2-op burn rate.

**Code path:** `SSVClusters.sol:174-176` (DAO increment, unconditional) → `OperatorLib.sol:312-319` (per-op, guarded).

---

### RM5-011: Guard Prerequisite — _resetOperatorState Zeros All Fields

**Goal:** Verify that `_resetOperatorState` (called by `removeOperator`) zeros all fields that the line 291 guard and subsequent logic depend on, ensuring the guard correctly identifies removed operators.

**Setup:**
1. Register operator op1 with ethFee=1,770,000,000.
2. Create cluster using op1, register validators so `ethValidatorCount > 0`.
3. Settle fees so `ethSnapshot.index > 0`, `ethSnapshot.balance > 0`.
4. Advance blocks so `ethSnapshot.block` has a meaningful value.
5. Verify pre-removal: `op1.ethSnapshot.block != 0`, `op1.ethFee != 0`, `op1.ethValidatorCount != 0`.

**Execution:**
1. Op1 owner calls `removeOperator(op1)`.

**Assertions (field-by-field from _resetOperatorState):**
- `op1.ethSnapshot.block == 0` (line 348) — **this is the guard field**.
- `op1.ethSnapshot.balance == PACKED_ETH_ZERO` (line 349).
- `op1.ethFee == PACKED_ETH_ZERO` (line 350).
- `op1.ethValidatorCount == 0` (line 354).
- `seb.operatorEthVUnits[op1] == 0` (line 93, separate delete).

**Why this matters for reactivation:**
- Line 291 guard: `ethSnapshot.block == 0` → skip entire block.
- Line 292: `blockDiffEthFee` would be `(currentBlock - 0) * 0 = 0` even if guard was absent (ethFee=0), but the guard prevents this computation entirely.
- Line 321: `ethValidatorCount += deltaValidatorCount` — without the guard, this would increment a removed operator's count from 0, creating phantom validators. The guard prevents this.
- Line 326: `cumulativeFee += ethFee` — without the guard, adds 0 (ethFee reset), so no burn rate impact, but the guard still correctly excludes it.

**Code path:** `SSVOperators.sol:347-358` (_resetOperatorState) → `SSVOperators.sol:93` (delete operatorEthVUnits) → verified at `OperatorLib.sol:291`.

---

### RM5-014: EB Update on Liquidated Cluster → Remove Op → Reactivate

**Goal:** Verify that if an EB update occurs while the cluster is liquidated (changing the stored vUnits), and then an operator is removed, the reactivation still correctly skips the removed operator and uses the updated vUnits for deviation.

**Setup:**
1. Register 4 operators, create ETH cluster (4 ops, 1 validator), explicit EB with vUnits=15000 (48 ETH/val).
2. Liquidate: deviation cleaned (15000 - 10000 = 5000 removed from each op's operatorEthVUnits and from DAO).
3. Call `updateClusterBalance` on the liquidated cluster with effectiveBalance=64: `newVUnits=20000`.
4. Per `SSVClusters.sol:395-403`: liquidated cluster only updates snapshot, skips fee settlement and operator deviation updates.
5. `seb.clusterEB[clusterId].vUnits = 20000` (updated).
6. Remove op4.

**Pre-reactivation state:**
- `vUnitsCluster = 20000` (updated while liquidated).
- `baselineVUnits = 1 * 10000 = 10000`.
- `clusterDeviation = 20000 - 10000 = 10000`.
- op4: removed (ethSnapshot.block == 0).

**Execution:**
1. Owner calls `reactivate`.

**Assertions:**
- `clusterDeviation = 10000` (computed from updated vUnits).
- op4 skipped at line 291.
- op1, op2, op3: `operatorEthVUnits[opX] += 10000`.
- `daoTotalEthVUnits += 10000`.
- Solvency uses `effectiveVUnits = 20000` and 3-op burn rate.
- **Key insight:** The EB snapshot update while liquidated changes what deviation is applied on reactivation. This is by design — the oracle captures the real effective balance even if the cluster is inactive.

**Code path:** `SSVClusters.sol:395-403` (liquidated update, snapshot only) → `SSVClusters.sol:142-145` (reactivation reads updated vUnits) → `OperatorLib.sol:291` (guard).

---

### RM5-017: Reactivation Reverts ExceedValidatorLimitWithData (Active Op at Limit)

**Goal:** Verify that even with removed operators skipped, the `validatorsPerOperatorLimit` check (line 322-324) still triggers for active operators that would exceed the limit.

**Setup:**
1. Register 4 operators. Set `validatorsPerOperatorLimit = 100`.
2. Register clusters until op1's `ethValidatorCount = 100`.
3. Create a NEW cluster with op1-op4, 1 validator. Liquidate it.
4. Remove op2.
5. At this point: op1 has `ethValidatorCount = 100` (from other clusters), op3 and op4 have capacity.

**Execution:**
1. Owner calls `reactivate(operatorIds, cluster)` with sufficient msg.value.

**Assertions:**
- Loop reaches op1: guard passes (`ethSnapshot.block != 0`).
- Line 321: `op1.ethValidatorCount += 1` → `101`.
- Line 322: `101 > 100` → revert `ExceedValidatorLimitWithData(op1Id)`.
- Reactivation fails even though op2 was correctly skipped.
- **Note:** The revert occurs mid-loop, so no state changes are persisted (all-or-nothing transaction).

**Code path:** `OperatorLib.sol:291` (op2 skipped) → `321-324` (op1 exceeds limit, revert).

---

## Coverage Matrix

| Dimension | Scenarios | Coverage |
|-----------|-----------|----------|
| **Cluster size** | | |
| 4 operators | RM5-001, 002, 006, 008, 009, 010, 011, 012, 013, 014, 017, 018, 019 | Primary |
| 7 operators | RM5-003, 007, 020 | Scale |
| 10 operators | RM5-004 | Scale |
| 13 operators (max) | RM5-005 | Boundary |
| **Removal count** | | |
| 1 op removed | RM5-001, 002, 008, 010, 012, 013, 014, 018, 019 | Primary |
| 2 ops removed | RM5-009, 020 | Multi-removal |
| 3 ops removed | RM5-004 | Scale |
| 4 ops removed | RM5-005 | Scale |
| ALL ops removed | RM5-006, 007 | Edge case |
| **EB state** | | |
| Implicit (no deviation) | RM5-006, 007, 010, 011, 012, 016, 017 | Baseline |
| Explicit (with deviation) | RM5-001, 002, 003, 004, 005, 008, 009, 013, 014, 015, 018, 019, 020 | Deviation |
| **Operation order** | | |
| Liquidate → remove → reactivate | RM5-001, 003-009, 010-020 | Primary |
| Remove → liquidate → reactivate | RM5-002 | Order invariance |
| EB update (liq'd) → remove → reactivate | RM5-014 | Stale EB |
| **Guard (line 291) verification** | | |
| Removed op skipped | RM5-001-020 (all) | Core |
| Removed op at first position | RM5-018 | Position |
| Removed op at last position | RM5-019 | Position |
| Removed ops at mixed positions | RM5-020 | Position |
| **Deviation distribution** | | |
| Deviation to active ops only | RM5-008, 009, 013, 015 | Correctness |
| No deviation (implicit EB) | RM5-010, 016 | Baseline |
| hasDeviation=true (global) | RM5-015 | Global flag |
| hasDeviation=false (global) | RM5-016 | Global flag |
| **DAO accounting** | | |
| daoTotalEthVUnits correct | RM5-009 | Invariant |
| ethDaoValidatorCount updated | RM5-006, 007 | Invariant |
| **Error paths** | | |
| ExceedValidatorLimitWithData | RM5-017 | Revert |

---

## Summary

**20 scenarios** covering `updateClusterOperatorsOnReactivation` (OperatorLib.sol:275-330) with focus on the `ethSnapshot.block != 0` guard at line 291.

**Core finding:** The guard at line 291 is the sole mechanism that prevents removed operators from being updated during reactivation. When `removeOperator()` is called, `_resetOperatorState` zeros `ethSnapshot.block` (line 348), and `operatorEthVUnits` is deleted (line 93). The guard cleanly prevents:
- Fee accrual computation for removed ops (line 292-309)
- Deviation writes to removed ops' `operatorEthVUnits` (lines 312-319)
- `ethValidatorCount` increment for removed ops (line 321)
- Removed op fee inclusion in burn rate (line 326)

**Note on line 328:** `cumulativeIndex += operator.ethSnapshot.index` is OUTSIDE the guard (executed for all operators including removed). This is safe because removed operators have `ethSnapshot.index == 0` (reset by `_resetOperatorState`), so they add 0 to the cumulative index.

**Cross-reference risk (RM5-002):** The `_executeLiquidation` deviation cleanup loop (SSVClusters.sol:585-592) does NOT have an equivalent `ethSnapshot.block != 0` guard. If an operator is removed BEFORE liquidation and the cluster had explicit EB deviation, the subtraction `operatorEthVUnits[removedOp] -= deviation` operates on a deleted (zero) mapping entry, risking underflow. This should be cross-referenced with RM1-* scenarios.

**DAO accounting invariant:** `daoTotalEthVUnits` is incremented by the full `clusterDeviation` on reactivation (line 175), regardless of how many operators are removed. This is correct because DAO accounting is cluster-scoped. The per-operator `operatorEthVUnits` only reflects active operators, creating a divergence that is by design.
