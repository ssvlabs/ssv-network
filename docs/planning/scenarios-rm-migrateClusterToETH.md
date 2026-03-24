# Removed-Operator Migration Scenarios (RM4-001 to RM4-025)

**Module:** SSVClusters.migrateClusterToETH + OperatorLib.updateClusterOperatorsMigration
**Prefix:** RM4
**Source:** `contracts/modules/SSVClusters.sol:259-343`, `contracts/libraries/OperatorLib.sol:343-384`
**Cross-refs:** MG-008/009/028/029/030/052/063 (migration), EB-* (effective balance updates)

**Bug briefing:** 6 EB bugs traced to `mockRemoveOperator()` not deleting `operatorEthVUnits`. Real `removeOperator()` deletes `operatorEthVUnits[opId]`, zeros `ethSnapshot.block`, zeros `ethValidatorCount`. Safe guard in `updateClusterOperatorsMigration`: `if (operator.snapshot.block == 0 && operator.ethSnapshot.block == 0) continue;` (OperatorLib.sol:363-364).

**Key code paths under test:**
- OperatorLib.sol:363-364 — `continue` guard skipping removed operators
- OperatorLib.sol:366-368 — `ensureETHDefaults` for first-time ETH operators (must NOT fire for removed ops)
- OperatorLib.sol:377-378 — `ethValidatorCount` increment (must NOT apply to removed ops)
- SSVClusters.sol:319-322 — deviation loop writing `operatorEthVUnits[operatorIds[i]]` for ALL operators unconditionally

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| RM4-001 | 4-op cluster, 1 removed, migrate (implicit EB) | Baseline: removed op skipped by `continue` guard, 3 live ops migrated, no ghost data | `entry:migrateClusterToETH; ops:4; removed:1; eb:implicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:363-364, 377-378 |
| RM4-002 | 4-op cluster, 1 removed, migrate (explicit EB, deviation > 0) | Deviation loop writes to ALL operatorIds including removed op — verify stranded vUnits | `entry:migrateClusterToETH; ops:4; removed:1; eb:explicit; cluster:active; revert:no` | ⬜ | SSVClusters.sol:319-322 |
| RM4-003 | 4-op cluster, 2 removed, migrate (implicit EB) | Half the operator set removed; only 2 live ops get ethValidatorCount increment | `entry:migrateClusterToETH; ops:4; removed:2; eb:implicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:363-365, 377-378 |
| RM4-004 | 7-op cluster, 1 removed, migrate | Larger cluster; removed op in middle of sorted array | `entry:migrateClusterToETH; ops:7; removed:1; eb:implicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:363-364 |
| RM4-005 | 7-op cluster, 3 removed, migrate | Nearly half removed; stress on continue guard iteration | `entry:migrateClusterToETH; ops:7; removed:3; eb:implicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:363-365 |
| RM4-006 | 10-op cluster, 1 removed, migrate | Large cluster with single removed op | `entry:migrateClusterToETH; ops:10; removed:1; eb:implicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:363-364 |
| RM4-007 | 10-op cluster, 5 removed, migrate | Half of a large cluster removed; 5 skipped, 5 migrated | `entry:migrateClusterToETH; ops:10; removed:5; eb:implicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:363-365 |
| RM4-008 | 13-op cluster, 1 removed, migrate | Maximum operator count, single removal | `entry:migrateClusterToETH; ops:13; removed:1; eb:implicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:363-364 |
| RM4-009 | 13-op cluster, 6 removed, migrate | Maximum cluster, nearly half removed | `entry:migrateClusterToETH; ops:13; removed:6; eb:implicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:363-365 |
| RM4-010 | Removed op: verify ethSnapshot.block stays 0 after migration | Confirm removed op NOT resurrected — ensureETHDefaults never called | `entry:migrateClusterToETH; ops:4; removed:1; eb:implicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:363-364, 122-133 |
| RM4-011 | Removed op: verify ethValidatorCount stays 0 after migration | Confirm removed op not incremented at line 378 | `entry:migrateClusterToETH; ops:4; removed:1; eb:implicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:377-378 |
| RM4-012 | Removed op: verify ethFee stays 0, not set to default | ensureETHDefaults must not fire; ethFee stays PACKED_ETH_ZERO | `entry:migrateClusterToETH; ops:4; removed:1; eb:implicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:122-133 |
| RM4-013 | Removed op: verify operatorEthVUnits[removedOp] stays 0 (implicit EB) | Implicit EB → vUnitsCluster = 0 → deviation block not entered → no write to removed op | `entry:migrateClusterToETH; ops:4; removed:1; eb:implicit; cluster:active; revert:no` | ⬜ | SSVClusters.sol:309-327 |
| RM4-014 | Removed op: operatorEthVUnits[removedOp] written (explicit EB, deviation > 0) | Deviation loop at 319-322 iterates ALL operatorIds — removed op gets stranded deviation | `entry:migrateClusterToETH; ops:4; removed:1; eb:explicit; cluster:active; revert:no` | ⬜ | SSVClusters.sol:319-322 |
| RM4-015 | Removed op with prior SSV history (snapshot.block was != 0, then zeroed by removal) | Op had SSV validators, was removed (both blocks zeroed); verify continue guard fires | `entry:migrateClusterToETH; ops:4; removed:1; eb:implicit; cluster:active; prior_ssv:yes; revert:no` | ⬜ | OperatorLib.sol:355, 363-364 |
| RM4-016 | Removed op with prior ETH history (ethSnapshot.block was != 0, then zeroed by removal) | Op served ETH cluster, removed (ethSnapshot.block zeroed, operatorEthVUnits deleted); verify clean skip | `entry:migrateClusterToETH; ops:4; removed:1; eb:implicit; cluster:active; prior_eth:yes; revert:no` | ⬜ | OperatorLib.sol:363-364, SSVOperators.sol:91-93 |
| RM4-017 | Removed op: cumulativeFeeETH excludes removed op's fee | burnRateETH only sums live ops' ethFee; removed op contributes 0 | `entry:migrateClusterToETH; ops:4; removed:1; eb:implicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:382 |
| RM4-018 | Removed op: cumulativeIndexSSV includes removed op's preserved SSV index | Removed op still contributes snapshot.index to SSV settlement (line 361) even though ETH skip fires (line 363) | `entry:migrateClusterToETH; ops:4; removed:1; eb:implicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:361, 363 |
| RM4-019 | Migrate with removed op → subsequent EB update → removed op still skipped | Post-migration updateClusterBalance: removed op skipped in updateClusterOperators (ethSnapshot.block == 0) | `entry:migrateClusterToETH+updateClusterBalance; ops:4; removed:1; eb:implicit→explicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:247, SSVClusters.sol:461-492 |
| RM4-020 | Migrate with removed op → subsequent EB update → operatorEthVUnits delta skips removed op? | Verify _updateOperatorVUnits behavior for removed op in post-migration EB update | `entry:migrateClusterToETH+updateClusterBalance; ops:4; removed:1; eb:explicit; cluster:active; revert:no` | ⬜ | SSVClusters.sol:494-509, 319-322 |
| RM4-021 | Liquidated SSV cluster + removed op → migrate | isLiquidated=true: SSV validatorCount decrement skipped for all ops; removed op still skipped by continue guard | `entry:migrateClusterToETH; ops:4; removed:1; eb:implicit; cluster:liquidated; revert:no` | ⬜ | OperatorLib.sol:355-365 |
| RM4-022 | Multiple removed ops (2 of 4) + explicit EB deviation | Both removed ops get stranded deviation via loop 319-322; verify total daoTotalEthVUnits inflation | `entry:migrateClusterToETH; ops:4; removed:2; eb:explicit; cluster:active; revert:no` | ⬜ | SSVClusters.sol:314-322 |
| RM4-023 | Migrate → remove op → migrate second cluster (same ops) → removed op skipped again | Sequential migration; op removed between first and second migration; second migration skips it too | `entry:migrateClusterToETH×2+removeOperator; ops:4; removed:1; eb:implicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:363-364 |
| RM4-024 | Removed op: no OperatorFeeExecuted event emitted for removed op | ensureETHDefaults never called → no default fee event for removed op | `entry:migrateClusterToETH; ops:4; removed:1; eb:implicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:129-130 |
| RM4-025 | Full lifecycle: register ops → create cluster → register validators → remove op → migrate → EB update → verify no ghost data | End-to-end regression test covering the entire bug surface | `entry:full_lifecycle; ops:4; removed:1; eb:implicit→explicit; cluster:active; revert:no` | ⬜ | OperatorLib.sol:343-384, SSVClusters.sol:259-343, SSVOperators.sol:71-104 |

---

## Detailed Scenario Blocks

### RM4-001: 4-op cluster, 1 removed, migrate (implicit EB)

**Category:** Core removed-operator guard (baseline regression test)
**Cross-ref:** MG-008

**Setup:**
1. Register 4 operators (op1, op2, op3, op4), all with SSV fee > 0
2. Create SSV cluster with all 4 operators, register 3 validators
3. Advance blocks so SSV fees accrue
4. Remove op4 via `removeOperator(op4)`:
   - `_resetOperatorState`: `ethSnapshot.block = 0`, `snapshot.block = 0`, `ethFee = 0`, `fee = 0`, `ethValidatorCount = 0`, `validatorCount = 0`
   - `delete seb.operatorEthVUnits[op4]`
   - `delete s.operatorFeeChangeRequests[op4]`
   - `op4.owner` preserved (non-zero — this is NOT deleted)
5. Advance blocks

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior in `updateClusterOperatorsMigration` (OperatorLib.sol:349-384):**

For op1, op2, op3 (live operators):
- Line 355: `operator.snapshot.block != 0` → true → `updateSnapshotStSSV(operator)` called
- Line 357-358: `!isClusterLiquidated` → true → `operator.validatorCount -= 3`
- Line 361: `cumulativeIndexSSV += operator.snapshot.index`
- Line 363: `operator.snapshot.block == 0 && operator.ethSnapshot.block == 0` → false → no skip
- Line 366: `operator.ethSnapshot.block == 0` → true → `ensureETHDefaults(operator, opId)` called
- Line 378: `operator.ethValidatorCount += 3`
- Line 382: `cumulativeFeeETH += operator.ethFee`

For op4 (removed operator):
- Line 355: `operator.snapshot.block != 0` → false → SSV snapshot NOT updated, validatorCount NOT decremented
- Line 361: `cumulativeIndexSSV += operator.snapshot.index` (0, since snapshot was reset)
- Line 363: `operator.snapshot.block == 0 && operator.ethSnapshot.block == 0` → true → **`continue`**
- Lines 366-383 are completely skipped for op4

**Post-migration deviation block (SSVClusters.sol:309-327):**
- `vUnitsCluster = ebSnapshot.vUnits` = 0 (implicit EB, no prior updateClusterBalance)
- `vUnitsCluster > 0` → false → entire deviation block skipped
- No write to `operatorEthVUnits` for any operator

**Critical assertions:**
1. `op4.ethSnapshot.block == 0` — not resurrected
2. `op4.ethValidatorCount == 0` — not incremented
3. `op4.ethFee == 0` — not set to default
4. `seb.operatorEthVUnits[op4] == 0` — no ghost data written
5. `burnRateETH` excludes op4's fee → lower minimum ETH required for liquidation check
6. Cluster is active and functional
7. No `OperatorFeeExecuted` event emitted for op4

---

### RM4-002: 4-op cluster, 1 removed, migrate (explicit EB, deviation > 0)

**Category:** Deviation accounting with removed operator (known stranded-data surface)
**Cross-ref:** MG-052

**Setup:**
1. Register 4 operators, create SSV cluster with 2 validators
2. Call `updateClusterBalance` pre-migration: effectiveBalance = 96 ETH → `vUnits = 30000`
3. Baseline = 2 * 10000 = 20000 → deviation = 10000
4. Remove op4 via `removeOperator(op4)`:
   - `_resetOperatorState`: both blocks zeroed
   - `delete seb.operatorEthVUnits[op4]` → vUnits storage cleaned
5. Advance blocks

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior in `updateClusterOperatorsMigration`:**
- op1, op2, op3: migrated normally, `ethValidatorCount += 2`
- op4: `continue` at line 363 — completely skipped (no ethValidatorCount, no ensureETHDefaults)

**Expected behavior in deviation block (SSVClusters.sol:309-326):**
1. `vUnitsCluster = ebSnapshot.vUnits = 30000` (set pre-migration by updateClusterBalance)
2. `vUnitsCluster > 0` → true → enter block
3. `baseline = 2 * 10000 = 20000`
4. `vUnitsCluster > baseline` → true → `deviation = 10000`
5. `sp.daoTotalEthVUnits += 10000`
6. **Loop at lines 319-322 iterates ALL 4 operatorIds:**
   - `seb.operatorEthVUnits[op1] += 10000`
   - `seb.operatorEthVUnits[op2] += 10000`
   - `seb.operatorEthVUnits[op3] += 10000`
   - `seb.operatorEthVUnits[op4] += 10000` ← **stranded deviation on removed op!**

**Critical assertions:**
1. op4 is skipped in `updateClusterOperatorsMigration` (no ethValidatorCount, no ethSnapshot resurrection)
2. op4 is NOT skipped in the deviation loop — `operatorEthVUnits[op4]` is written with non-zero value
3. `seb.operatorEthVUnits[op4] == 10000` (stranded — this operator is removed, cannot serve validators)
4. `daoTotalEthVUnits` inflated by 10000 for the removed op's share
5. This stranded deviation does not cause reverts but inflates global accounting
6. If op4 is re-registered (new operator at same ID? — IDs are monotonic, so this cannot happen), the stale vUnits would be present

**Impact assessment:** The deviation loop at 319-322 does not check `ethSnapshot.block`. This is a known design surface (see MG-052). The stranded vUnits on removed ops contribute to `daoTotalEthVUnits` inflation but have no downstream effect on fee accrual because the removed op has `ethFee = 0` and `ethValidatorCount = 0`.

---

### RM4-003: 4-op cluster, 2 removed, migrate (implicit EB)

**Category:** Multiple removed operators

**Setup:**
1. Register 4 operators (op1-op4), all with SSV fee > 0
2. Create SSV cluster with all 4, register 3 validators
3. Advance blocks
4. Remove op3 via `removeOperator(op3)` — full state reset + vUnits deleted
5. Remove op4 via `removeOperator(op4)` — full state reset + vUnits deleted
6. Advance blocks

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior:**
- op1, op2: full migration path — SSV snapshot updated, validatorCount decremented, ensureETHDefaults called, ethValidatorCount += 3, fee added to cumulative
- op3: `continue` at line 363 (both blocks == 0)
- op4: `continue` at line 363 (both blocks == 0)

**Critical assertions:**
1. `op3.ethSnapshot.block == 0` AND `op4.ethSnapshot.block == 0` — neither resurrected
2. `op3.ethValidatorCount == 0` AND `op4.ethValidatorCount == 0`
3. `cumulativeFeeETH` = `op1.ethFee + op2.ethFee` (only 2 live ops)
4. `burnRateETH` based on 2 operators — significantly lower minimum ETH for liquidation check
5. `sp.daoValidatorCount` decremented by `validatorCount` (SSV side, for 2 live ops only in validatorCount terms)
6. `ethDaoValidatorCount` incremented by `validatorCount` (baseline added via updateDAO)
7. Implicit EB → no deviation loop → `operatorEthVUnits` untouched for all ops

---

### RM4-014: Removed op — operatorEthVUnits written (explicit EB, deviation > 0)

**Category:** Stranded deviation deep-dive
**Cross-ref:** RM4-002

**Setup:**
1. Register 4 operators, create SSV cluster with 5 validators
2. Pre-migration `updateClusterBalance`: effectiveBalance = 256 ETH → `vUnits = ceil(256 * 10000 / 32) = 80000`
3. Baseline = 5 * 10000 = 50000 → deviation = 30000
4. Remove op4 → full state reset, `operatorEthVUnits[op4]` deleted

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior:**
1. `updateClusterOperatorsMigration`: op4 skipped at `continue`
2. Deviation block:
   - `vUnitsCluster = 80000`, `baseline = 50000`, `deviation = 30000`
   - `sp.daoTotalEthVUnits += 30000`
   - Per-operator: `seb.operatorEthVUnits[opId] += 30000` for ALL 4 ops
3. op4 receives `30000` stranded deviation units

**Downstream impact verification:**
- `removeOperator` already deleted `operatorEthVUnits[op4]` during removal
- Migration writes `30000` back into `operatorEthVUnits[op4]`
- This is NOT cleaned up by any subsequent operation
- If op4's owner calls `withdrawOperatorEarnings` post-removal → op4 is already removed (checkOwner fails), so stranded value is unreachable
- `daoTotalEthVUnits` includes 30000 for op4 — slight inflation of global baseline

**Critical assertions:**
1. `seb.operatorEthVUnits[op4] == 30000` (written despite removal)
2. `seb.operatorEthVUnits[op1] == seb.operatorEthVUnits[op2] == seb.operatorEthVUnits[op3] == 30000`
3. Total `daoTotalEthVUnits` deviation = 4 * 30000 = 120000 (but only 3 ops are live)
4. Effective inflation = 30000 / total daoTotalEthVUnits (one removed op's share)

---

### RM4-019: Migrate with removed op, then subsequent EB update — removed op still properly skipped

**Category:** Post-migration persistence of removed-operator state
**Cross-ref:** MG-018

**Setup:**
1. Register 4 operators, all ETH-initialized via a prior ETH cluster
2. Create SSV cluster with 3 validators
3. Remove op4 via `removeOperator(op4)` — `ethSnapshot.block = 0`, `operatorEthVUnits` deleted
4. Migrate cluster to ETH with sufficient balance (implicit EB)
5. Advance 100 blocks
6. Oracle commits Merkle root for this cluster: effectiveBalance = 128 ETH

**Action:**
```solidity
updateClusterBalance(blockNum, owner, [op1, op2, op3, op4], cluster, 128, proof)
```

**Expected behavior in `updateClusterOperators` (OperatorLib.sol:233-260):**
1. op1, op2, op3: `ethSnapshot.block != 0` → `updateSnapshotSt` called, fees accrued for 100 blocks
2. op4: `ethSnapshot.block == 0` → **skipped** (line 247 guard: "only update active operators")
3. op4's preserved `ethSnapshot.index` (0, since it was reset) still contributes to `cumulativeIndex`

**Expected behavior in `_updateOperatorVUnits` (SSVClusters.sol vUnit update loop):**
- Loop iterates ALL operatorIds including op4
- `seb.operatorEthVUnits[op4]` receives vUnit delta — **stranded data again**

**Critical assertions:**
1. op4 remains removed: `ethSnapshot.block == 0`, `ethValidatorCount == 0`
2. Fee accrual excludes op4: `burnRate` based on 3 ops only
3. Cluster balance correctly deducted (lower burn rate due to missing op)
4. No revert from processing removed operator in vUnit loop
5. op4 not resurrected by EB update

---

### RM4-021: Liquidated SSV cluster + removed op, then migrate

**Category:** Combined edge case — liquidation + removal
**Cross-ref:** MG-051

**Setup:**
1. Register 4 operators with SSV fees
2. Create SSV cluster with 3 validators
3. Let SSV balance deplete → liquidated via `liquidateSSV`
4. Cluster state: `active = false`, SSV validatorCount already decremented during liquidation
5. Remove op4 via `removeOperator(op4)` — full state reset
6. Advance blocks

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior in `updateClusterOperatorsMigration`:**

For op1, op2, op3:
- Line 355: `operator.snapshot.block != 0` → true → `updateSnapshotStSSV` called
- Line 357: `!isClusterLiquidated` → false → `validatorCount` NOT decremented (already done by liquidation)
- Line 366: `ethSnapshot.block == 0` → `ensureETHDefaults` called
- Line 378: `ethValidatorCount += 3`

For op4:
- Line 355: `operator.snapshot.block != 0` → false (reset by removeOperator)
- Line 363: `operator.snapshot.block == 0 && operator.ethSnapshot.block == 0` → true → `continue`

**Post-migration:**
- `isLiquidated = true` → `updateDAOSSV` NOT called (line 284)
- `updateDAO(true, 3)` called → `ethDaoValidatorCount += 3`
- Events: `ClusterMigratedToETH` + `ClusterReactivated`
- `cluster.active = true`

**Critical assertions:**
1. op4 completely skipped — no resurrection, no ethValidatorCount, no fee contribution
2. SSV `validatorCount` NOT decremented again (already handled by liquidation)
3. ETH `ethValidatorCount` incremented only for op1, op2, op3
4. `sp.daoValidatorCount` unchanged (liquidation already decremented it)
5. `sp.ethDaoValidatorCount` increased by 3
6. Both events emitted
7. No SSV token refund (balance was 0)

---

### RM4-025: Full lifecycle regression — register, create, remove, migrate, EB update, verify no ghost data

**Category:** End-to-end regression test
**Cross-ref:** All RM4-*

**Setup:**
1. Register 4 operators (op1-op4) with SSV fee = 5000
2. Create SSV cluster C1 with all 4 ops, register 3 validators
3. Advance 500 blocks (SSV fees accrue)
4. Record op4 state pre-removal:
   - `op4.snapshot.block > 0`, `op4.validatorCount > 0`
   - `op4.ethSnapshot.block == 0` (never served ETH)
   - `seb.operatorEthVUnits[op4] == 0`
5. Remove op4 via `removeOperator(op4)`
6. Verify op4 post-removal:
   - `op4.snapshot.block == 0`, `op4.ethSnapshot.block == 0`
   - `op4.ethFee == 0`, `op4.fee == 0`
   - `op4.ethValidatorCount == 0`, `op4.validatorCount == 0`
   - `seb.operatorEthVUnits[op4] == 0`
7. Advance 100 blocks

**Phase 1 — Migration:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: 10 ether }
```

**Verify after migration:**
1. `op4.ethSnapshot.block == 0` — not resurrected
2. `op4.ethValidatorCount == 0` — not incremented
3. `op4.ethFee == 0` — not set to default
4. `seb.operatorEthVUnits[op4] == 0` — no ghost data (implicit EB → no deviation loop)
5. op1, op2, op3: `ethSnapshot.block == block.number`, `ethValidatorCount == 3`, `ethFee == DEFAULT_OPERATOR_ETH_FEE`
6. Cluster is in `s.ethClusters`, deleted from `s.clusters`
7. `cluster.active == true`, `cluster.balance == 10 ether`

**Phase 2 — EB Update (200 blocks later):**
```solidity
// Oracle commits root with effectiveBalance = 128 ETH (> baseline of 96 ETH for 3 validators)
updateClusterBalance(blockNum, owner, [op1, op2, op3, op4], cluster, 128, proof)
```

**Verify after EB update:**
1. op4 skipped in `updateClusterOperators` (ethSnapshot.block == 0)
2. Fee accrual for 200 blocks uses 3 operator fees only
3. Cluster balance reduced by 200 blocks worth of 3 ops' fees + network fee
4. vUnits updated: `newVUnits = ebToVUnits(128)` > baseline → deviation distributed
5. Deviation written to `operatorEthVUnits` for ALL 4 operatorIds (including op4 — stranded)
6. op4 still has `ethSnapshot.block == 0`, `ethValidatorCount == 0` — not resurrected
7. `operatorEthVUnits[op4]` may now be non-zero (stranded deviation from vUnit loop)

**Final state assertions:**
1. No ghost data in `ethSnapshot` or `ethValidatorCount` for op4 at any phase
2. `operatorEthVUnits[op4]` is zero after migration (implicit EB), but may become non-zero after explicit EB update (stranded deviation — known surface)
3. Cluster remains functional with 3 effective operators
4. Fee accounting consistent: only 3 ops contribute to burn rate
5. op4 cannot be accessed (checkOwner uses block == 0 check)

---

### RM4-023: Sequential migration — op removed between two migrations

**Category:** Multi-cluster removal interaction
**Cross-ref:** MG-044

**Setup:**
1. Register 4 operators (op1-op4)
2. Create SSV Cluster A (Alice, [op1-op4], 2 validators)
3. Create SSV Cluster B (Bob, [op1-op4], 3 validators)
4. Migrate Cluster A to ETH → all 4 ops get `ensureETHDefaults`, `ethValidatorCount = 2`
5. Advance 100 blocks
6. Remove op4 via `removeOperator(op4)`:
   - `ethSnapshot.block = 0`, `ethValidatorCount = 0`
   - `delete seb.operatorEthVUnits[op4]`
   - Earnings from Cluster A's 100 blocks withdrawn
7. Advance 50 blocks

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], clusterB) { value: sufficientETH }
```

**Expected behavior:**
- op1, op2, op3:
  - `snapshot.block != 0` → SSV snapshot updated, `validatorCount -= 3`
  - `ethSnapshot.block != 0` (set during Cluster A migration) → `updateSnapshotSt` called (ETH accrual from Cluster A)
  - `ethValidatorCount: 2 → 5`
- op4:
  - `snapshot.block != 0` (still has SSV snapshot from Cluster B registration) → `updateSnapshotStSSV` called
  - Wait — was snapshot.block zeroed by `removeOperator`? Yes: `_resetOperatorState` zeros `snapshot.block`
  - But op4 was part of Cluster B which was registered AFTER removal... this depends on timing
  - If op4 was removed AFTER Cluster B was created: Cluster B's `registerValidator` would have checked `ensureOperatorExist` which requires `snapshot.block != 0 || ethSnapshot.block != 0` — removal would make op4 fail this check
  - **Correction:** If op4 is removed before Cluster B validators are registered, Cluster B cannot use op4. The cluster must have been created with op4 before removal. After removal, op4's snapshot.block is 0 → `continue` fires

**Critical assertions:**
1. op4 skipped by `continue` in second migration (both blocks == 0)
2. op4 `ethValidatorCount` stays 0 (was 2, reset to 0 by removal)
3. op1-op3 `ethValidatorCount = 5` after second migration
4. ETH accrual from Cluster A's 150 blocks properly accumulated for op1-op3
5. No ghost data for op4 in second migration

---

## Coverage Matrix

| Code Path | Scenarios | Guard Mechanism |
|-----------|-----------|-----------------|
| **OperatorLib.sol:363-364** — `continue` guard (both blocks == 0) | RM4-001, 003, 004, 005, 006, 007, 008, 009, 010, 015, 016, 021, 023, 025 | `if (operator.snapshot.block == 0 && operator.ethSnapshot.block == 0) continue` |
| **OperatorLib.sol:366-368** — `ensureETHDefaults` NOT called for removed op | RM4-010, 012, 024 | Guarded by `continue` above; removed op never reaches this line |
| **OperatorLib.sol:377-378** — `ethValidatorCount` NOT incremented for removed op | RM4-001, 003, 011, 021, 025 | Guarded by `continue` above; removed op never reaches this line |
| **OperatorLib.sol:382** — `cumulativeFeeETH` excludes removed op | RM4-001, 003, 017 | Guarded by `continue`; removed op's ethFee (0) never added |
| **OperatorLib.sol:361** — `cumulativeIndexSSV` includes removed op's preserved index | RM4-018 | This line executes BEFORE the `continue` guard; documents the SSV/ETH asymmetry |
| **SSVClusters.sol:309-327** — Implicit EB: deviation block not entered | RM4-001, 003, 004-009, 013, 015, 016, 021, 025 (phase 1) | `vUnitsCluster = 0` → `vUnitsCluster > 0` is false |
| **SSVClusters.sol:319-322** — Explicit EB: deviation loop writes ALL operators unconditionally | RM4-002, 014, 022, 025 (phase 2) | NO guard — removed ops receive stranded deviation (known surface) |
| **Cluster sizes: 4/7/10/13 operators** | RM4-001/003 (4), RM4-004/005 (7), RM4-006/007 (10), RM4-008/009 (13) | Validates guard across all supported cluster sizes |
| **Multiple removed ops (2+)** | RM4-003, 005, 007, 009, 022 | Ensures `continue` fires for each removed op independently |
| **Liquidated cluster + removed op** | RM4-021 | Combined edge case: liquidation + removal interaction |
| **Post-migration EB update** | RM4-019, 020, 025 (phase 2) | Removed op stays skipped in subsequent `updateClusterOperators` |
| **Sequential migration (multi-cluster)** | RM4-023 | Removed op skipped across multiple migration calls |
| **Prior SSV/ETH history before removal** | RM4-015 (SSV history), RM4-016 (ETH history) | Both blocks zeroed by `_resetOperatorState`; `continue` fires regardless of prior history |
| **Event verification** | RM4-024 | No `OperatorFeeExecuted` for removed op; no spurious events |
| **End-to-end lifecycle** | RM4-025 | Full register→create→remove→migrate→EB update flow |

---

## Summary

**25 scenarios** covering the interaction between removed operators and `migrateClusterToETH`.

**Primary guard:** The `continue` statement at OperatorLib.sol:363-364 prevents removed operators from being resurrected during migration. This guard checks `operator.snapshot.block == 0 && operator.ethSnapshot.block == 0` — both conditions are satisfied after `_resetOperatorState` (called by `removeOperator`). The guard fires before `ensureETHDefaults`, `ethValidatorCount` increment, or fee contribution, ensuring complete isolation of removed operators from ETH migration state.

**Known surface — stranded deviation (SSVClusters.sol:319-322):** The deviation loop during explicit EB migration iterates ALL `operatorIds` without checking operator liveness. Removed operators receive `operatorEthVUnits` writes despite being removed. This inflates `daoTotalEthVUnits` by the removed operator's share of deviation. Impact is limited: the stranded vUnits cannot affect fee accrual (removed op has `ethFee = 0`, `ethValidatorCount = 0`) and the removed operator cannot withdraw (checkOwner fails). Scenarios RM4-002, RM4-014, RM4-022, and RM4-025 explicitly document and test this surface.

**Not covered here (handled by MG-* scenarios):** Happy-path migrations without removed operators, SSV balance refunds, DAO accounting for non-removal cases, operator limit boundary conditions, non-owner caller reverts, double-migration prevention.

---

## Coverage Verification (W4)

**Verified:** 2026-03-24
**Method:** Cross-referenced each scenario against test files using actual file reads. Classified `remove_mode` by inspecting which mock/real function is called for operator removal.

**Critical finding:** `mockRemoveOperator()` in `SSVClustersHarness.sol:169-181` does NOT call `delete seb.operatorEthVUnits[operatorId]`. Neither does `mockRemoveOperatorAndPayout()` (lines 185-219). Both are missing the `operatorEthVUnits` deletion that real `removeOperator()` performs at `SSVOperators.sol:93`. This means all tests using these mocks may mask the 6 EB bugs that were the root cause of this scenario set.

| ID | Tested | remove_mode | Test File | Notes |
|----|--------|-------------|-----------|-------|
| RM4-001 | partial:mock | mock_zero | `test/unit/SSVClusters/migrateClusterToETH.test.ts:1247` ("Skips removed operators during migration") | Uses `mockRemoveOperator`. Asserts `ethValidatorCount >= 0` for removed op (weak — should assert `== 0`). Does NOT verify `ethSnapshot.block`, `ethFee`, or `operatorEthVUnits`. Closest real-removeOperator test: `test/e2e/migration/migration-edge.test.ts:163` but that only checks `validatorCount`, not ETH snapshot fields. |
| RM4-002 | no | none | — | No test covers migration with explicit EB + removed op + deviation verification on removed op's `operatorEthVUnits`. |
| RM4-003 | partial:mock | mock_zero | `test/unit/SSVClusters/migrateClusterToETH.test.ts:1344` ("Maintains operator count integrity with mixed valid/removed operators") | Uses `mockRemoveOperator` on alternating ops (2 of 4 removed). Asserts `ethValidatorCount >= 0` for removed ops (weak). |
| RM4-004 | no | none | — | No 7-operator cluster migration test with removed op exists. |
| RM4-005 | no | none | — | No 7-operator cluster with 3 removed ops test exists. |
| RM4-006 | no | none | — | No 10-operator cluster migration test with removed op exists. |
| RM4-007 | no | none | — | No 10-operator cluster with 5 removed ops test exists. |
| RM4-008 | no | none | — | No 13-operator cluster migration test with removed op exists. |
| RM4-009 | no | none | — | No 13-operator cluster with 6 removed ops test exists. |
| RM4-010 | partial:mock | mock_zero | `test/unit/SSVClusters/migrateClusterToETH.test.ts:1247` | Same test as RM4-001. Does NOT assert `ethSnapshot.block == 0` for removed op. |
| RM4-011 | partial:mock | mock_zero | `test/unit/SSVClusters/migrateClusterToETH.test.ts:1247` | Same test as RM4-001. Asserts `ethValidatorCount >= 0` instead of `== 0`. |
| RM4-012 | partial:mock | mock_zero | `test/unit/SSVClusters/migrateClusterToETH.test.ts:1315` ("Prevents silent revival of removed operators with zero fees") | Uses `mockRemoveOperator`. Asserts `ethFeeAfter == ethFeeBefore`, but `ethFeeBefore` is already 0 from mock. Does NOT verify `ensureETHDefaults` was not called. |
| RM4-013 | no | none | — | No test verifies `operatorEthVUnits[removedOp] == 0` after implicit EB migration. |
| RM4-014 | no | none | — | No test covers explicit EB deviation + removed op `operatorEthVUnits` write. |
| RM4-015 | no | none | — | No test covers removed op with prior SSV history + migration guard behavior. |
| RM4-016 | no | none | — | No test covers removed op with prior ETH history + migration guard behavior. |
| RM4-017 | no | none | — | No test verifies `cumulativeFeeETH` excludes removed op's fee specifically. |
| RM4-018 | partial:mock | mock_payout | `test/e2e/migration/migration-double-payment.test.ts:142` ("Includes removed operator frozen snapshot.index in migration SSV settlement") | Uses `mockRemoveOperatorAndPayout`. Verifies SSV `cumulativeIndex` includes removed op's preserved `snapshot.index`. Good assertion coverage for SSV side, but `mockRemoveOperatorAndPayout` does not delete `operatorEthVUnits`. |
| RM4-019 | no | none | — | No test covers migrate + subsequent EB update with removed op. |
| RM4-020 | no | none | — | No test covers post-migration `_updateOperatorVUnits` behavior for removed op. |
| RM4-021 | partial:mock | mock_payout | `test/e2e/migration/migration-double-payment.test.ts:234` ("Liquidated cluster migration with removed operator preserves SSV counts and skips removed ETH setup") | Uses `mockRemoveOperatorAndPayout`. Verifies `ethValidatorCount` stays 0 for removed op and `ethSnapshot.block == 0`. Good assertions but mock does not delete `operatorEthVUnits`. |
| RM4-022 | no | none | — | No test covers 2 removed ops + explicit EB deviation. |
| RM4-023 | no | none | — | No sequential migration test with op removed between migrations. |
| RM4-024 | no | none | — | No test verifies absence of `OperatorFeeExecuted` event for removed op. |
| RM4-025 | no | none | — | No end-to-end lifecycle test with real `removeOperator` + migration + EB update. |

**Summary:** 6/25 scenarios have partial test coverage (all using mock removal, not real `removeOperator()`). 1 e2e test (`migration-edge.test.ts:163`) uses real `removeOperator()` but only checks `validatorCount`, not the critical ETH snapshot/fee/vUnits assertions. 19/25 scenarios have no test coverage at all. The existing tests are systematically weakened by: (a) using `mockRemoveOperator` which skips `operatorEthVUnits` deletion, and (b) using `>= 0` assertions instead of strict `== 0` for removed operator state.
