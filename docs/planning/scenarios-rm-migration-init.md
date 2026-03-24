# Removed Operator × Migration Initialization Scenarios (RM6-001 to RM6-018)

**Module:** OperatorLib.updateClusterOperatorsMigration
**Prefix:** RM6
**Source:** `contracts/libraries/OperatorLib.sol:343-384` (guard at lines 363-365), `contracts/modules/SSVOperators.sol:71-104` (removeOperator), `contracts/modules/SSVOperators.sol:347-358` (_resetOperatorState)
**Cross-refs:** MG-008/009/028/029/030/051/052 (migration with removed ops), EB-* (effective balance), LQ-* (liquidation)

**Bug context:** 6 EB bugs traced to `mockRemoveOperator()` not deleting `operatorEthVUnits`. Real `removeOperator()` calls `_resetOperatorState` (zeros both `snapshot.block` AND `ethSnapshot.block`) and `delete seb.operatorEthVUnits[operatorId]`. Guard at line 363: `if (operator.snapshot.block == 0 && operator.ethSnapshot.block == 0) continue;` skips dead operators. Edge case: operator removed AFTER SSV snapshot was set — `snapshot.block` was non-zero at time of cluster creation but is zero at migration time.

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| RM6-001 | Guard: fully dead operator (both snapshots == 0) gets `continue` | Baseline guard behavior — operator removed before migration, both blocks zeroed by `_resetOperatorState` | `guard:continue; snapshot:0; ethSnapshot:0; remove_timing:before_migration; revert:no` | ⬜ | OperatorLib.sol:363-365 |
| RM6-002 | Guard: live operator (snapshot.block > 0, ethSnapshot.block == 0) passes guard | First-time ETH operator — SSV-active, never ETH-initialized; guard does NOT fire, enters `ensureETHDefaults` | `guard:pass; snapshot:>0; ethSnapshot:0; ensureETHDefaults:yes; revert:no` | ⬜ | OperatorLib.sol:355-368 |
| RM6-003 | Guard: live operator (snapshot.block > 0, ethSnapshot.block > 0) passes guard | Fully initialized operator — both snapshots active; enters `updateSnapshotSt` branch | `guard:pass; snapshot:>0; ethSnapshot:>0; updateSnapshotSt:yes; revert:no` | ⬜ | OperatorLib.sol:355-374 |
| RM6-004 | Guard: operator with snapshot.block == 0 and ethSnapshot.block > 0 passes guard | SSV-only removal scenario — op was SSV-active, SSV snapshot zeroed but ETH snapshot still live; guard does NOT fire | `guard:pass; snapshot:0; ethSnapshot:>0; updateSnapshotSt:yes; revert:no` | ⬜ | OperatorLib.sol:363-374 |
| RM6-005 | Edge: operator removed AFTER SSV snapshot set but BEFORE migration | Op had snapshot.block > 0 from cluster creation, then `removeOperator` zeros both; at migration time both == 0 → `continue` | `guard:continue; remove_timing:after_ssv_snapshot; snapshot:0; ethSnapshot:0; revert:no` | ⬜ | OperatorLib.sol:363-365, SSVOperators.sol:71-91 |
| RM6-006 | ensureETHDefaults NOT called for removed operator (guarded out) | Dead op (both == 0) hits `continue` at line 364 → never reaches `ensureETHDefaults` at line 368; ethSnapshot.block stays 0, no resurrection | `guard:continue; ensureETHDefaults:skipped; resurrection:no; revert:no` | ⬜ | OperatorLib.sol:363-368 |
| RM6-007 | ethValidatorCount NOT incremented for removed operator | Dead op hits `continue` before reaching line 378; `ethValidatorCount` stays 0 | `guard:continue; ethValidatorCount:unchanged; revert:no` | ⬜ | OperatorLib.sol:363-365, 377-378 |
| RM6-008 | cumulativeFeeETH excludes removed operator's fee | Dead op hits `continue` before line 382; removed op contributes 0 to `cumulativeFeeETH` (ethFee already zeroed by `_resetOperatorState`) | `guard:continue; cumulativeFeeETH:excludes_dead; revert:no` | ⬜ | OperatorLib.sol:363-365, 382 |
| RM6-009 | cumulativeIndexSSV includes removed op's snapshot.index (== 0) | Dead op: `snapshot.block == 0` → SSV snapshot NOT updated (line 355 skipped); but `cumulativeIndexSSV += operator.snapshot.index` at line 361 still executes (value is 0 after reset, so no impact) | `cumulativeIndexSSV:includes_zero; snapshot:0; revert:no` | ⬜ | OperatorLib.sol:355-361 |
| RM6-010 | Migration with mixed live and removed operators — 4 ops, 1 removed | 3 live ops get full migration path (SSV decrement + ETH init + ethValidatorCount); 1 removed op skipped entirely. Verify final state of all 4. | `guard:mixed; ops:4; removed:1; revert:no` | ⬜ | OperatorLib.sol:349-384 |
| RM6-011 | Migration with mixed live and removed operators — 4 ops, 2 removed | Half the set removed. Only 2 ops get ethValidatorCount increment. BurnRate uses only 2 operator fees. | `guard:mixed; ops:4; removed:2; revert:no` | ⬜ | OperatorLib.sol:349-384 |
| RM6-012 | Migration with mixed live and removed operators — 4 ops, 3 removed | Extreme: 3 removed, only 1 live. Single op bears full ethValidatorCount. Verify validator limit check uses only that op. | `guard:mixed; ops:4; removed:3; revert:no` | ⬜ | OperatorLib.sol:349-384, 377-379 |
| RM6-013 | Active SSV cluster migration with removed operator — SSV validatorCount decrement skips dead op | Live ops: `snapshot.block != 0` → `validatorCount -= validatorCount`. Dead op: `snapshot.block == 0` → SSV update block skipped. Verify no underflow. | `cluster:active; remove_mode:real; ssv_decrement:live_only; revert:no` | ⬜ | OperatorLib.sol:355-359 |
| RM6-014 | Liquidated SSV cluster migration with removed operator | `isClusterLiquidated=true` → SSV validatorCount NOT decremented for ANY op (line 357-359 guard). Dead op still skipped by line 363-365. ETH init only for live ops. | `cluster:liquidated; remove_mode:real; ssv_decrement:none; revert:no` | ⬜ | OperatorLib.sol:355-365 |
| RM6-015 | SSV cluster with explicit EB → migrate with removed op — deviation applied to all ops including dead | Deviation loop in SSVClusters.sol:319-322 iterates ALL operatorIds unconditionally. Removed op gets `operatorEthVUnits += deviation` despite being dead. Stranded deviation inflates `daoTotalEthVUnits`. | `eb:explicit; deviation:stranded; remove_mode:real; revert:no` | ⬜ | SSVClusters.sol:314-326, OperatorLib.sol:363-365 |
| RM6-016 | Removed op's operatorEthVUnits was deleted by removeOperator — verify 0 at migration | `removeOperator` calls `delete seb.operatorEthVUnits[operatorId]` (line 93). At migration time, value must be 0 for dead op — no stale deviation leaking. | `operatorEthVUnits:deleted; remove_timing:before_migration; revert:no` | ⬜ | SSVOperators.sol:93, OperatorLib.sol:363-365 |
| RM6-017 | Validator limit check: removed op excluded — live ops hit limit without removed op counting | 4-op cluster, 1 removed. `validatorsPerOperatorLimit=10`. Live ops at 8 ethValidatorCount, cluster has 2 validators. 8+2=10 → at limit. Dead op stays at 0. No revert. | `guard:continue; validatorLimit:boundary; removed:1; revert:no` | ⬜ | OperatorLib.sol:363-365, 377-379 |
| RM6-018 | Validator limit check: removed op excluded — would have reverted if counted | Same as RM6-017 but live ops at 9. 9+2=11 > 10 → revert ExceedValidatorLimitWithData for first live op. Dead op irrelevant. Confirm revert identifies correct operatorId. | `guard:continue; validatorLimit:exceed; removed:1; revert:yes` | ⬜ | OperatorLib.sol:377-379 |

---

## Detailed Scenario Blocks

### RM6-001: Guard baseline — fully dead operator gets `continue`

**Category:** Guard correctness / regression
**Cross-ref:** MG-008, MG-029

**Setup:**
1. Register 4 operators (op1-op4), all with SSV fee > 0
2. Create SSV cluster with all 4 operators, register 2 validators
3. Advance blocks so SSV fees accrue
4. Remove op4 via `removeOperator(op4)`:
   - `_resetOperatorState` zeros: `ethSnapshot.block=0`, `snapshot.block=0`, `ethFee=0`, `fee=0`, `ethValidatorCount=0`, `validatorCount=0`
   - `delete seb.operatorEthVUnits[op4]`
   - `op4.owner` preserved (non-zero — this is important, owner survives removal)
   - `op4.snapshot.index` zeroed via balance reset
5. Advance blocks

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior in `updateClusterOperatorsMigration` for op4:**
1. Line 355: `operator.snapshot.block != 0` → false → SSV snapshot update skipped
2. Line 361: `cumulativeIndexSSV += operator.snapshot.index` → adds 0 (index was zeroed)
3. Line 363: `operator.snapshot.block == 0 && operator.ethSnapshot.block == 0` → true → **`continue`**
4. Lines 366-382 never reached for op4

**Critical assertions:**
1. `op4.ethSnapshot.block == 0` after migration (not resurrected)
2. `op4.ethValidatorCount == 0` (not incremented)
3. `op4.ethFee == 0` (ensureETHDefaults never called)
4. `op4.snapshot.block == 0` (SSV side unchanged)
5. `op4.owner != address(0)` (owner survives — verify guard doesn't depend on owner)

---

### RM6-005: Operator removed AFTER SSV snapshot set but BEFORE migration

**Category:** Timing edge case / the subtle gap
**Cross-ref:** MG-008

**Setup:**
1. Register 4 operators (op1-op4) with SSV fee > 0
2. Create SSV cluster with all 4 ops, 3 validators at block 100
   - All 4 ops now have `snapshot.block = 100`, `validatorCount = 3`
3. Advance to block 200
4. Remove op4 via `removeOperator(op4)` at block 200:
   - `updateSnapshotStSSV(op4)` called first → `op4.snapshot.index` accumulates 100 blocks of SSV earnings, `snapshot.block = 200`
   - Operator earnings for blocks 100-200 withdrawn to op4.owner
   - Then `_resetOperatorState`: zeros `snapshot.block=0`, `ethSnapshot.block=0`, etc.
   - Net effect: op4 earned its SSV fees, then got fully zeroed
5. Advance to block 300

**Key insight:** At block 100 (cluster creation), op4's `snapshot.block` was set to 100. At block 200, it was still non-zero. But by block 300 (migration time), `_resetOperatorState` has already zeroed it. The guard at line 363 sees both == 0 and correctly fires `continue`.

**Action:**
```solidity
// Block 300
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior:**
1. op1, op2, op3: `snapshot.block != 0` (still 100 or updated) → SSV update + ETH init
2. op4: `snapshot.block == 0` (zeroed at block 200) → SSV update skipped
3. op4: `snapshot.block == 0 && ethSnapshot.block == 0` → `continue`
4. Only 3 ops get `ethValidatorCount += 3`

**Critical assertions:**
1. Guard fires despite op4 having been SSV-active when cluster was created
2. op4 earned SSV fees for blocks 100-200 (withdrawn during `removeOperator`) — no loss
3. SSV cluster's `cumulativeIndexSSV` at block 300 includes only op1-op3 contributions
4. op4 is fully dead in both SSV and ETH accounting post-migration
5. The timing gap (SSV snapshot was set → then zeroed → then migration) is handled correctly

---

### RM6-004: Operator with snapshot.block == 0 but ethSnapshot.block > 0

**Category:** Asymmetric snapshot state / guard boundary
**Cross-ref:** None (novel edge case)

**Setup:**
This scenario requires an operator that is ETH-active but SSV-inactive. This can happen if:
1. Register operator op1
2. Operator serves an ETH cluster → `ethSnapshot.block > 0`
3. Operator has no SSV clusters, or its only SSV cluster was liquidated and the SSV snapshot was zeroed
4. Create a new SSV cluster using op1 (SSV cluster creation sets `snapshot.block` for the op)
5. Liquidate the SSV cluster → SSV liquidation decrements `validatorCount` but does NOT zero `snapshot.block`

Alternative path (more realistic):
1. Register operator op1 with SSV fee > 0 → `snapshot.block = block.number`
2. Op1 serves ETH cluster → `ethSnapshot.block > 0`
3. Op1 serves SSV cluster, then SSV cluster liquidated
4. Separately, another SSV cluster is created with op1, to be migrated
5. Between creation and migration, op1's SSV snapshot.block could be non-zero (from step 1)

**Simpler construction for testing:**
1. Register op1 → `snapshot.block > 0`
2. Op1 joins ETH cluster → `ethSnapshot.block > 0`
3. Create SSV cluster with op1 + 3 other ops
4. Remove op1 → `_resetOperatorState` zeros BOTH `snapshot.block` AND `ethSnapshot.block`

**Conclusion:** Under normal `removeOperator`, both snapshots are always zeroed together. The state `(snapshot.block == 0, ethSnapshot.block > 0)` cannot be reached through `removeOperator`. However, the guard at line 363 is written as `&&` (both must be 0), so if this state ever occurs (e.g., through a future code path or upgrade), the operator would NOT be skipped — it would fall through to `updateSnapshotSt` at line 372. This test verifies the guard logic handles this asymmetric state correctly even if it's currently unreachable.

**Action:**
```solidity
// Manually set operator state to (snapshot.block=0, ethSnapshot.block=500) via test helper
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior:**
1. Line 355: `snapshot.block != 0` → false → SSV snapshot NOT updated, validatorCount NOT decremented
2. Line 361: `cumulativeIndexSSV += 0`
3. Line 363: `snapshot.block == 0 && ethSnapshot.block == 0` → false (ethSnapshot.block == 500) → guard does NOT fire
4. Line 366: `ethSnapshot.block == 0` → false → enters `updateSnapshotSt` branch
5. `ethSnapshot.index` updated, `cumulativeIndexETH` incremented
6. Line 378: `ethValidatorCount += validatorCount` — operator gets validators added

**Critical assertions:**
1. Operator is NOT skipped despite `snapshot.block == 0`
2. ETH accounting proceeds normally
3. SSV `validatorCount` is NOT decremented (SSV snapshot update block at line 355-359 was skipped)
4. This is a defensive test — the state may not be reachable today but the guard behavior should be documented

---

### RM6-010: Mixed live and removed operators — 4 ops, 1 removed

**Category:** Integration / mixed operator set
**Cross-ref:** MG-008, MG-028

**Setup:**
1. Register 4 operators (op1-op4), SSV fee = 5000 each
2. Create SSV cluster with all 4 ops, 3 validators at block 100
3. Advance to block 200
4. Remove op3 via `removeOperator(op3)` at block 200
5. Advance to block 300

**Action:**
```solidity
// Block 300
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior per operator:**

| Operator | snapshot.block | ethSnapshot.block | SSV update | Guard | ETH init | ethValidatorCount | Fee contribution |
|----------|---------------|-------------------|------------|-------|----------|-------------------|------------------|
| op1 | > 0 | 0 | Yes, decrement validatorCount | Pass | ensureETHDefaults | += 3 | ethFee (default) |
| op2 | > 0 | 0 | Yes, decrement validatorCount | Pass | ensureETHDefaults | += 3 | ethFee (default) |
| op3 | 0 | 0 | No | **continue** | Skipped | unchanged (0) | 0 |
| op4 | > 0 | 0 | Yes, decrement validatorCount | Pass | ensureETHDefaults | += 3 | ethFee (default) |

**Critical assertions:**
1. `cumulativeFeeETH` = 3 * defaultEthFee (not 4)
2. `cumulativeIndexSSV` = sum of op1+op2+op4 snapshot.index values (op3 contributes 0)
3. `cumulativeIndexETH` = 0 (all live ops are first-time ETH, via ensureETHDefaults)
4. op3.ethSnapshot.block == 0 (not resurrected)
5. op3.ethValidatorCount == 0
6. Cluster functional with 3/4 operators
7. BurnRate for liquidation check uses 3 operator fees, not 4

---

### RM6-014: Liquidated SSV cluster migration with removed operator

**Category:** Dual condition — liquidated + removed
**Cross-ref:** MG-051

**Setup:**
1. Register 4 operators (op1-op4), SSV fee > 0
2. Create SSV cluster with all 4 ops, 2 validators
3. Let cluster SSV balance deplete → liquidated via `liquidateSSV`
   - `cluster.active = false`
   - Liquidation decrements `operator.validatorCount` for each op
4. Remove op4 via `removeOperator(op4)` — zeros both snapshots
5. Advance blocks

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior:**
1. `isClusterLiquidated = !cluster.active` → `true`
2. For op1, op2, op3 (live):
   - `snapshot.block != 0` → `updateSnapshotStSSV` called
   - `!isClusterLiquidated` → false → `validatorCount` NOT decremented (already decremented by liquidation)
   - `ethSnapshot.block == 0` → `ensureETHDefaults` called
   - `ethValidatorCount += 2`
3. For op4 (removed):
   - `snapshot.block == 0` → SSV update skipped
   - Guard: `snapshot.block == 0 && ethSnapshot.block == 0` → `continue`
   - Entirely skipped
4. DAO: `updateDAOSSV` NOT called (line 284: `!isLiquidated` is false)
5. DAO: `updateDAO(true, 2)` called → only counts live ops
6. Events: `ClusterMigratedToETH` + `ClusterReactivated`

**Critical assertions:**
1. No double-decrement: SSV validatorCount was already decremented by liquidation, and the `!isClusterLiquidated` guard prevents re-decrement
2. op4 fully skipped — no ETH resurrection of a removed operator in a liquidated cluster
3. `sp.daoValidatorCount` unchanged (was already decremented by liquidation)
4. `sp.ethDaoValidatorCount` increased by 2
5. `ssvClusterBalance = 0` (liquidated cluster had zero balance)
6. No SSV token transfer

---

### RM6-015: Explicit EB + removed op — stranded deviation

**Category:** Deviation accounting with dead operator (potential bug surface)
**Cross-ref:** MG-052

**Setup:**
1. Register 4 operators (op1-op4), SSV fee > 0
2. Create SSV cluster with all 4 ops, 2 validators
3. Set explicit EB via `updateClusterBalance`: effectiveBalance = 96 ETH → `vUnits = ceil(96 * 10000 / 32) = 30000`
4. Baseline = 2 * 10000 = 20000, deviation = 10000
5. Remove op4 via `removeOperator(op4)`:
   - Both snapshots zeroed
   - `delete seb.operatorEthVUnits[op4]` → op4's vUnits = 0
6. Advance blocks

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior:**
1. `updateClusterOperatorsMigration`:
   - op1, op2, op3: migrated normally, `ethValidatorCount += 2`
   - op4: guard fires → `continue` (skipped entirely from OperatorLib perspective)
2. EB deviation sync (SSVClusters.sol:314-326):
   - `vUnitsCluster = 30000`, `baseline = 20000`, `deviation = 10000`
   - Loop at line 319-322 iterates ALL operatorIds including op4:
     ```solidity
     for (uint256 i; i < operatorsLength; ++i) {
         seb.operatorEthVUnits[operatorIds[i]] += deviation;
     }
     ```
   - **op4 gets `operatorEthVUnits[op4] += 10000` even though it's dead**
3. `sp.daoTotalEthVUnits += deviation` (10000) — this includes the portion "assigned" to dead op4

**Critical assertions / findings:**
1. op4's `operatorEthVUnits` = 10000 despite being removed (stranded deviation)
2. `daoTotalEthVUnits` is inflated by the stranded deviation
3. op4 will never serve these vUnits (no ethValidatorCount, no ethSnapshot.block)
4. The stranded value is inert in `updateSnapshotSt` (line 63-64): if op4 is never called again, effectiveVUnits is never computed
5. However: if op4 is re-registered and joins a new cluster, the stale `operatorEthVUnits[op4] = 10000` would persist and inflate its earnings until corrected
6. **Impact assessment:** Minor DAO accounting inflation. The deviation loop in SSVClusters.sol does not check operator liveness. Consider adding a guard: skip deviation for operators where both snapshots == 0.

---

### RM6-016: operatorEthVUnits deleted by removeOperator — verify clean state

**Category:** State hygiene / deletion verification
**Cross-ref:** RM6-015

**Setup:**
1. Register 4 operators (op1-op4)
2. Create ETH cluster with all 4 ops → ops get `ethSnapshot.block > 0`, `operatorEthVUnits` may be set
3. Set explicit EB → each op gets `operatorEthVUnits[opId] = someDeviation`
4. Remove op4 via `removeOperator(op4)`:
   - Line 93: `delete seb.operatorEthVUnits[operatorId]` — explicitly deletes stored deviation
   - `_resetOperatorState` zeros both snapshots
5. Create SSV cluster with op1-op4 (including removed op4)
6. Advance blocks

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior:**
1. At migration time, `seb.operatorEthVUnits[op4] == 0` (deleted by `removeOperator`)
2. op4 hits guard → `continue`
3. No stale deviation from op4's previous ETH life leaks into migration

**Critical assertions:**
1. `seb.operatorEthVUnits[op4] == 0` before migration (verify deletion worked)
2. If RM6-015's deviation loop runs and assigns new deviation to op4, the starting point is 0 (not stale)
3. `removeOperator` is thorough: `_resetOperatorState` + `delete operatorEthVUnits` + `delete operatorFeeChangeRequests` + `delete operatorsWhitelist`

**Why this matters:** The original 6 EB bugs came from `mockRemoveOperator()` NOT deleting `operatorEthVUnits`. This test confirms the real `removeOperator` does delete it, and validates that the guard sees a truly clean state.

---

### RM6-017: Validator limit — removed op excluded from limit check

**Category:** Boundary condition with removed operator
**Cross-ref:** MG-026, MG-027

**Setup:**
1. Set `validatorsPerOperatorLimit = 10`
2. Register 4 operators (op1-op4)
3. Create ETH cluster A with op1-op4, 8 validators → each op has `ethValidatorCount = 8`
4. Remove op3 via `removeOperator(op3)` — `ethValidatorCount` zeroed
5. Create SSV cluster B with op1-op4, 2 validators

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], clusterB) { value: sufficientETH }
```

**Expected behavior:**
1. op1, op2, op4 (live): `ethValidatorCount += 2` → `8 + 2 = 10 == validatorsPerOperatorLimit` → no revert (condition is `>` not `>=`)
2. op3 (removed): guard fires → `continue` → `ethValidatorCount` stays 0 → limit check never reached

**Critical assertions:**
1. Migration succeeds — limit is met but not exceeded for live ops
2. op3's zero `ethValidatorCount` does NOT factor into any limit check
3. If op3 were NOT removed, it would also hit `8 + 2 = 10` → still pass
4. The removed op is irrelevant to the limit check because the `continue` prevents reaching line 378

---

## Coverage Matrix

| Dimension | Scenarios |
|-----------|-----------|
| **Guard: both snapshots == 0 → continue** | RM6-001, RM6-005, RM6-006, RM6-007, RM6-008, RM6-009 |
| **Guard: pass (snapshot.block > 0, ethSnapshot == 0)** | RM6-002, RM6-010, RM6-011, RM6-012, RM6-013 |
| **Guard: pass (both > 0)** | RM6-003 |
| **Guard: asymmetric (snapshot == 0, ethSnapshot > 0)** | RM6-004 |
| **Removal timing: before migration** | RM6-001, RM6-006-RM6-012, RM6-014-RM6-018 |
| **Removal timing: after SSV snapshot set** | RM6-005 |
| **ensureETHDefaults: called for live ops** | RM6-002, RM6-010, RM6-011, RM6-013, RM6-014 |
| **ensureETHDefaults: NOT called for dead ops** | RM6-001, RM6-006 |
| **ethValidatorCount: incremented for live only** | RM6-007, RM6-010, RM6-011, RM6-012, RM6-017 |
| **cumulativeFeeETH: excludes dead ops** | RM6-008, RM6-010 |
| **cumulativeIndexSSV: includes dead op's 0** | RM6-009 |
| **Mixed live + removed operators** | RM6-010 (1 removed), RM6-011 (2 removed), RM6-012 (3 removed) |
| **Active SSV cluster + removed op** | RM6-010, RM6-011, RM6-012, RM6-013 |
| **Liquidated SSV cluster + removed op** | RM6-014 |
| **Explicit EB + removed op (deviation)** | RM6-015 |
| **operatorEthVUnits deletion verification** | RM6-016 |
| **Validator limit boundary** | RM6-017 (at limit), RM6-018 (exceed) |
| **Revert scenarios** | RM6-018 |

---

## Summary

**18 scenarios** covering `updateClusterOperatorsMigration` guard behavior (lines 363-365) and its interaction with removed operators.

**Core guard logic verified:**
- The `if (snapshot.block == 0 && ethSnapshot.block == 0) continue;` guard correctly skips fully dead operators (RM6-001, RM6-005, RM6-006, RM6-007, RM6-008)
- Live operators (any snapshot > 0) pass the guard and proceed through the appropriate initialization path (RM6-002, RM6-003, RM6-004)
- The asymmetric state `(snapshot.block == 0, ethSnapshot.block > 0)` is handled defensively — operator is NOT skipped (RM6-004)

**Bug regression coverage:**
- `_resetOperatorState` zeros both snapshot blocks — confirmed guard fires post-removal (RM6-001, RM6-005)
- `delete seb.operatorEthVUnits[operatorId]` cleans up stored deviation — no stale data (RM6-016)
- The difference between `mockRemoveOperator` (bug source) and real `removeOperator` (complete cleanup) is validated

**Known limitation identified:**
- RM6-015 documents that the EB deviation loop in `SSVClusters.sol:319-322` does NOT check operator liveness — deviation is applied to ALL operatorIds including dead ones. This creates stranded `operatorEthVUnits` entries and minor `daoTotalEthVUnits` inflation. The impact is low (stranded values are inert unless the operator is re-registered) but the behavior should be evaluated for a follow-up fix.
