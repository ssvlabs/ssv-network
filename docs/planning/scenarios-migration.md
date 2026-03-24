# Migration Scenarios (MG-001 to MG-060)

**Module:** SSVClusters.migrateClusterToETH
**Prefix:** MG
**Source:** `contracts/modules/SSVClusters.sol:259-343`, `contracts/libraries/OperatorLib.sol:343-384`, `contracts/libraries/ClusterLib.sol:328-330`
**Cross-refs:** RM4-* (removed operator migration), EB-* (effective balance), LQ-* (liquidation)

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| MG-001 | Happy path: migrate active SSV cluster (4 ops) to ETH | Basic migration with 4 operators, implicit EB, sufficient msg.value | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:259-343 |
| MG-002 | Happy path: migrate active SSV cluster (7 ops) to ETH | Larger operator set migration | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:7; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:259-343 |
| MG-003 | Happy path: migrate active SSV cluster (10 ops) to ETH | 10-operator cluster migration | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:10; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:259-343 |
| MG-004 | Happy path: migrate active SSV cluster (13 ops) to ETH | Maximum operator set migration | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:13; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:259-343 |
| MG-005 | Migrate with explicit EB already set (vUnits > baseline) | Pre-migration updateClusterBalance set EB > 32 ETH/validator; deviation accounting must propagate | `entry:migrateClusterToETH; version:ssv→eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:304-327 |
| MG-006 | Migrate with explicit EB equal to baseline (deviation = 0) | vUnits == validatorCount * BPS_DENOMINATOR; no deviation to add | `entry:migrateClusterToETH; version:ssv→eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:314 |
| MG-007 | Migrate with implicit EB (vUnits = 0 in storage) | Default path: no clusterEB stored, uses validatorCount * BPS_DENOMINATOR | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:309, 327 |
| MG-008 | Migrate with one removed operator (THE BUG — ghost data) | Removed op has snapshot.block=0 AND ethSnapshot.block=0; must be skipped by ensureETHDefaults, must NOT get ethValidatorCount incremented, must NOT be resurrected | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | ⬜ | OperatorLib.sol:355-383, OperatorLib.sol:122-133 |
| MG-009 | Migrate with two removed operators (4-op cluster, 2 removed) | Edge case: half the operator set removed; only 2 live ops get validator count increment | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | ⬜ | OperatorLib.sol:362-365 |
| MG-010 | Migrate already-ETH cluster → revert IncorrectClusterVersion | Cluster exists in s.ethClusters (VERSION_ETH); validateClusterVersion(version, VERSION_SSV) reverts | `entry:migrateClusterToETH; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | ⬜ | ClusterLib.sol:328-330 |
| MG-011 | Migrate liquidated SSV cluster to ETH (reactivation path) | cluster.active=false; isLiquidated=true; skips updateDAOSSV; emits ClusterReactivated | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:265, 284-288, 340-342 |
| MG-012 | Migrate liquidated SSV cluster — insufficient ETH → revert | Liquidated cluster migration with too little msg.value; reverts InsufficientBalance | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:yes` | ⬜ | SSVClusters.sol:289-299 |
| MG-013 | Migrate active cluster — insufficient ETH → revert InsufficientBalance | msg.value too low to pass isLiquidatableWithEB check | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | ⬜ | SSVClusters.sol:289-299 |
| MG-014 | Migrate with zero msg.value → revert InsufficientBalance | No ETH deposited; cluster immediately liquidatable (assuming non-zero fees) | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | ⬜ | SSVClusters.sol:279, 289-299 |
| MG-015 | SSV balance refund: non-zero remaining SSV transferred to owner | After SSV balance computation, ssvClusterBalance > 0; transferTokenBalance called | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:276-278, 335-337 |
| MG-016 | SSV balance refund: zero remaining SSV (fully depleted) | SSV balance consumed by fees; no refund transfer | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:335-337 |
| MG-017 | Migrate → immediately updateClusterBalance | Migrate, then call updateClusterBalance with valid Merkle proof; ETH accounting applies | `entry:migrateClusterToETH+updateClusterBalance; version:ssv→eth; eb:implicit→explicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:348-417 |
| MG-018 | Migrate → removeOperator → updateClusterBalance | Migrate, remove one op, then updateClusterBalance; removed op skipped in fee accrual | `entry:migrateClusterToETH+removeOperator+updateClusterBalance; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | ⬜ | SSVClusters.sol:461-492 |
| MG-019 | Double migration prevention: migrate same cluster twice → revert ClusterDoesNotExist | After first migration, s.clusters[key] deleted; second call finds no SSV record | `entry:migrateClusterToETH; version:eth; eb:implicit; cluster:migrated; ops:4; remove_mode:none; revert:yes` | ⬜ | SSVClusters.sol:263, 301-302 |
| MG-020 | Migrate with pending operator fee change (declareOperatorFee not executed) | Operator has pending fee declaration; migration uses current ethFee (not pending) | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | OperatorLib.sol:122-133 |
| MG-021 | Operator initialization: ensureETHDefaults first-time (SSV fee > 0) | ethSnapshot.block==0, fee!=0 → sets ethFee=DEFAULT_OPERATOR_ETH_FEE, emits OperatorFeeExecuted | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | OperatorLib.sol:122-133 |
| MG-022 | Operator initialization: ensureETHDefaults first-time (SSV fee = 0) | ethSnapshot.block==0, fee==0 → ethFee stays 0 (no default assigned) | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | OperatorLib.sol:127-128 |
| MG-023 | Operator initialization: ensureETHDefaults already initialized | ethSnapshot.block > 0 → ensureETHDefaults is a no-op; updateSnapshotSt called instead | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | OperatorLib.sol:366-374 |
| MG-024 | Mixed operators: some first-time ETH, some already ETH-initialized | 4-op cluster: 2 ops never used for ETH, 2 ops already serving ETH clusters | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | OperatorLib.sol:362-383 |
| MG-025 | Migration with mixed ETH/SSV clusters on same operators | Operators serve both an existing ETH cluster and the migrating SSV cluster; ethValidatorCount accumulates both | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | OperatorLib.sol:377-378 |
| MG-026 | Migrate with validators at operator limit | ethValidatorCount + validatorCount == validatorsPerOperatorLimit; succeeds exactly at limit | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | OperatorLib.sol:378-379 |
| MG-027 | Migrate with validators exceeding operator limit → revert ExceedValidatorLimitWithData | ethValidatorCount + validatorCount > validatorsPerOperatorLimit | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | ⬜ | OperatorLib.sol:378-379 |
| MG-028 | Verify only live operators get ethValidatorCount increment | Removed ops (snapshot.block==0 && ethSnapshot.block==0) are skipped by continue statement | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | ⬜ | OperatorLib.sol:362-365, 377-378 |
| MG-029 | Verify removed operator NOT resurrected (ethSnapshot.block stays 0) | After migration, removed op's ethSnapshot.block must still be 0 | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | ⬜ | OperatorLib.sol:362-365 |
| MG-030 | Migrate with op that has ethSnapshot.block=0 (removed) — fee contribution is zero | Removed op contributes no ethFee to cumulativeFeeETH or burnRate | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | ⬜ | OperatorLib.sol:362-365, 382 |
| MG-031 | DAO accounting: SSV daoValidatorCount decremented (active cluster) | sp.updateDAOSSV(false, validatorCount) called when !isLiquidated | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:284-286, ProtocolLib.sol:127-134 |
| MG-032 | DAO accounting: SSV daoValidatorCount NOT decremented (liquidated cluster) | Liquidated cluster already had counts removed; skips updateDAOSSV | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:284-286 |
| MG-033 | DAO accounting: ETH ethDaoValidatorCount incremented + baseline vUnits added | sp.updateDAO(true, validatorCount) always called; daoTotalEthVUnits += validatorCount * BPS_DENOMINATOR | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:287, ProtocolLib.sol:107-119 |
| MG-034 | DAO accounting: deviation added when explicit EB > baseline | vUnitsCluster > baseline → deviation added to daoTotalEthVUnits and each operatorEthVUnits | `entry:migrateClusterToETH; version:ssv→eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:314-326 |
| MG-035 | DAO accounting: no deviation when implicit EB (vUnits=0) | Implicit cluster: no deviation to add beyond baseline | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:327 |
| MG-036 | SSV operator.validatorCount decremented for live SSV ops | Each op with snapshot.block != 0 gets validatorCount -= cluster.validatorCount | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | OperatorLib.sol:355-359 |
| MG-037 | SSV operator.validatorCount NOT decremented for liquidated cluster | isClusterLiquidated=true → skip operator.validatorCount decrement | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | ⬜ | OperatorLib.sol:357-359 |
| MG-038 | SSV snapshot updated before migration (final earnings accumulated) | updateSnapshotStSSV called for each live SSV operator → snapshot.index updated | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | OperatorLib.sol:355-356 |
| MG-039 | SSV cluster balance settled before new ETH balance set | updateBalanceSSV computes final SSV balance using SSV indexes; stored as ssvClusterBalance | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:276-277 |
| MG-040 | Storage: s.clusters[key] deleted after migration | SSV record removed; getClusterData returns only ETH version | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:302 |
| MG-041 | Storage: s.ethClusters[key] created with new cluster data | ETH record created with active=true, balance=msg.value, correct indexes | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:301 |
| MG-042 | Event: ClusterMigratedToETH emitted with correct values | Verify msg.value, ssvClusterBalance, effectiveBalance, cluster struct | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:339 |
| MG-043 | Event: ClusterReactivated emitted for liquidated migration | isLiquidated=true → both ClusterMigratedToETH and ClusterReactivated emitted | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:340-342 |
| MG-044 | Multiple clusters migrate in sequence (shared operators) | Cluster A migrates then Cluster B migrates; ops shared; ethValidatorCount accumulates | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | OperatorLib.sol:377-378 |
| MG-045 | Sequential migration: operator ETH snapshot index accumulates correctly | After first migration, op has ethSnapshot.index > 0; second migration adds to it | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | OperatorLib.sol:372-374 |
| MG-046 | Migrate with 0 SSV balance (fully depleted pre-migration) | SSV fees consumed all balance; ssvClusterBalance=0; no transfer | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:335-337 |
| MG-047 | Migrate cluster with 0 validators | Edge case: validatorCount=0; no operator increments, no DAO updates needed | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | OperatorLib.sol:358, SSVClusters.sol:284-287 |
| MG-048 | Non-owner caller → revert | msg.sender != cluster owner; validateHashedCluster uses msg.sender as owner, hash mismatch | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | ⬜ | SSVClusters.sol:263, ClusterLib.sol:137 |
| MG-049 | Cluster does not exist → revert ClusterDoesNotExist | No SSV or ETH record; getClusterData reverts | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | ⬜ | ClusterLib.sol:358 |
| MG-050 | Incorrect cluster state → revert IncorrectClusterState | Cluster data hash mismatch; stale cluster struct provided | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | ⬜ | ClusterLib.sol:143-144 |
| MG-051 | Migrate liquidated cluster with removed operator | Combined: liquidated + removed op; isLiquidated=true → skip SSV validatorCount decrement; removed op skipped entirely | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | ⬜ | OperatorLib.sol:355-365 |
| MG-052 | Migrate with explicit EB + removed operator + deviation | Explicit EB deviation applied only to live operators (removed op gets operatorEthVUnits too — verify this is or isn't a bug) | `entry:migrateClusterToETH; version:ssv→eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | ⬜ | SSVClusters.sol:319-322 |
| MG-053 | Migrate → deposit ETH → verify cluster accepts ETH path | Post-migration, deposit(clusterOwner, operatorIds, cluster) with VERSION_ETH succeeds | `entry:migrateClusterToETH+deposit; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:186-201 |
| MG-054 | Migrate → withdraw ETH → verify cluster accepts ETH path | Post-migration, withdraw succeeds using ETH path | `entry:migrateClusterToETH+withdraw; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:206-253 |
| MG-055 | Migrate → liquidate → reactivate full lifecycle | Migrate SSV→ETH, let balance drain, liquidate, reactivate with ETH | `entry:migrateClusterToETH+liquidate+reactivate; version:ssv→eth; eb:implicit; cluster:active→liquidated→active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:31-65, 129-181 |
| MG-056 | Double payment prevention: SSV refunded + ETH deposited, no double-billing | Verify no blocks are double-charged in both SSV and ETH accounting during migration block | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:268-282 |
| MG-057 | Migration accounting: SSV→ETH index reconciliation | Verify cluster.index set to cumulativeIndexETH (not SSV); cluster.networkFeeIndex set to ETH network fee index | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:280-282 |
| MG-058 | Migrate with all zero-fee operators | All ops have SSV fee=0 → ethFee stays 0; burnRate=0; only networkFee matters for liquidation check | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | OperatorLib.sol:127-128, SSVClusters.sol:289-299 |
| MG-059 | Migrate with operator that had explicit ethFee=0 (set via reduceOperatorFee) | Op previously initialized ETH, then reduced fee to 0; ensureETHDefaults must NOT overwrite | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | OperatorLib.sol:122-133 |
| MG-060 | Migrate cluster with large validator count and explicit high EB | Stress test: many validators + high EB per validator (e.g. 2048 ETH); verify no overflow in deviation accounting | `entry:migrateClusterToETH; version:ssv→eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | ⬜ | SSVClusters.sol:311-322 |

---

## Detailed Scenario Blocks (12 Most Complex)

### MG-008: Migrate with one removed operator (THE BUG — ghost data)

**Category:** Removed operator handling / bug regression
**Cross-ref:** RM4-*

**Setup:**
1. Register 4 operators (op1, op2, op3, op4), all with SSV fee > 0
2. Create SSV cluster with all 4 operators, register 3 validators
3. Advance blocks so SSV fees accrue
4. Remove op4 via `removeOperator(op4)` — this calls `_resetOperatorState`:
   - `op4.ethSnapshot.block = 0`, `op4.snapshot.block = 0`
   - `op4.ethFee = 0`, `op4.fee = 0`
   - `op4.ethValidatorCount = 0`, `op4.validatorCount = 0`
   - `op4.owner` is **preserved** (non-zero)
5. Advance blocks

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior in `updateClusterOperatorsMigration` (OperatorLib.sol:349-384):**

For op1, op2, op3 (live operators):
- `operator.snapshot.block != 0` → true → `updateSnapshotStSSV(operator)` called
- `operator.validatorCount -= 3` (SSV decrement)
- `operator.ethSnapshot.block == 0` → true → `ensureETHDefaults(operator, operatorId)` called
- `operator.ethValidatorCount += 3`
- `cumulativeFeeETH += operator.ethFee`

For op4 (removed operator):
- `operator.snapshot.block != 0` → false → SSV snapshot NOT updated
- `operator.snapshot.block == 0 && operator.ethSnapshot.block == 0` → true → **`continue`** (line 364)
- **op4 is completely skipped** — no ethValidatorCount increment, no ensureETHDefaults, no fee contribution

**Critical assertions:**
1. `op4.ethSnapshot.block == 0` (not resurrected)
2. `op4.ethValidatorCount == 0` (not incremented)
3. `op4.ethFee == 0` (not set to default)
4. `cumulativeFeeETH` only includes fees from op1, op2, op3
5. `burnRateETH` excludes op4's fee → lower minimum ETH required
6. Cluster is active and functional with 3/4 operators

**Why this matters:** If `ensureETHDefaults` were called on op4, it would set `ethSnapshot.block = block.number`, effectively resurrecting the removed operator. The `continue` statement at line 364 prevents this. This is the ghost data bug — without the guard, removed operators would appear live in ETH accounting.

---

### MG-011: Migrate liquidated SSV cluster to ETH (reactivation path)

**Category:** Liquidated cluster migration
**Cross-ref:** LQ-*

**Setup:**
1. Register 4 operators with SSV fees
2. Create SSV cluster with 3 validators
3. Let cluster's SSV balance deplete → liquidated via `liquidateSSV`
4. Cluster state: `active = false`, `balance = 0`, `index = 0`, `networkFeeIndex = 0`
5. SSV operator.validatorCount already decremented by liquidation

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior:**
1. `isLiquidated = !cluster.active` → `true`
2. For each operator:
   - SSV snapshot updated
   - `operator.validatorCount` NOT decremented (line 357-359: `if (!isClusterLiquidated)` guard)
   - `ensureETHDefaults` or `updateSnapshotSt` called
   - `operator.ethValidatorCount += 3`
3. SSV balance settlement: `updateBalanceSSV` on a zero-balance cluster → `ssvClusterBalance = 0`
4. New cluster: `balance = msg.value`, `active = true`
5. DAO: `updateDAOSSV` **NOT called** (line 284: `if (!isLiquidated)`)
6. DAO: `updateDAO(true, 3)` called → `ethDaoValidatorCount += 3`, `daoTotalEthVUnits += 30000`
7. Liquidation check passes
8. Events: `ClusterMigratedToETH` + `ClusterReactivated` (line 340-342)

**Critical assertions:**
1. `sp.daoValidatorCount` unchanged (was already decremented by SSV liquidation)
2. `sp.ethDaoValidatorCount` increased by 3
3. `cluster.active == true`
4. No SSV token transfer (ssvClusterBalance = 0)
5. Both events emitted

---

### MG-005: Migrate with explicit EB already set (vUnits > baseline)

**Category:** EB deviation accounting during migration

**Setup:**
1. Register 4 operators, create SSV cluster with 2 validators
2. Call `updateClusterBalance` on the SSV cluster with effectiveBalance = 96 (96 ETH total, i.e. 48 ETH/validator instead of default 32)
3. This stores `clusterEB[clusterId].vUnits = ebToVUnits(96)` = ceil(96 * 10000 / 32) = 30000 vUnits
4. Baseline = 2 * 10000 = 20000 vUnits
5. Deviation = 30000 - 20000 = 10000

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior (SSVClusters.sol:304-326):**
1. Operators migrated: `ethValidatorCount += 2` for each (baseline via validator count)
2. `updateDAO(true, 2)` → `daoTotalEthVUnits += 20000` (baseline)
3. EB deviation sync (line 309-326):
   - `vUnitsCluster = 30000` (read from clusterEB)
   - `baseline = 2 * 10000 = 20000`
   - `vUnitsCluster > baseline` → `deviation = 10000`
   - `sp.daoTotalEthVUnits += 10000` (deviation on top of baseline)
   - For each operator: `seb.operatorEthVUnits[opId] += 10000`
4. Effective EB in event = `vUnitsToEB(30000)` = floor(30000 * 32 / 10000) = 96

**Critical assertions:**
1. `sp.daoTotalEthVUnits` increased by baseline (20000) + deviation (10000) = 30000 total
2. Each operator's `operatorEthVUnits` increased by 10000
3. Future ETH fee accrual uses the elevated vUnits (higher fees)
4. `effectiveBalance` in event = 96

---

### MG-052: Migrate with explicit EB + removed operator + deviation

**Category:** Deviation + removed operator interaction (potential bug surface)
**Cross-ref:** RM4-*, MG-008

**Setup:**
1. Register 4 operators, create SSV cluster with 2 validators
2. Set explicit EB via `updateClusterBalance`: effectiveBalance = 96 ETH → vUnits = 30000
3. Remove op4 via `removeOperator`
4. Advance blocks

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior:**
1. `updateClusterOperatorsMigration`:
   - op1, op2, op3: migrated normally, ethValidatorCount += 2
   - op4: `snapshot.block == 0 && ethSnapshot.block == 0` → `continue` (skipped entirely)
2. EB deviation sync (SSVClusters.sol:314-326):
   - `vUnitsCluster = 30000`, `baseline = 20000`, `deviation = 10000`
   - Loop iterates ALL operatorIds including op4: `seb.operatorEthVUnits[operatorIds[i]] += deviation`
   - **op4 gets `operatorEthVUnits[op4] += 10000` even though it's removed!**

**Critical assertion / potential bug:**
- The deviation loop at line 319-322 iterates all operators unconditionally — it does not check if the operator is removed. This means `operatorEthVUnits[op4]` will have a non-zero value for a removed operator.
- Impact: This deviation is "stranded" — it inflates `daoTotalEthVUnits` but the removed operator will never serve it. The DAO's total vUnits accounting may be slightly inflated.
- Verify: Does this stranded deviation cause any downstream issue? (e.g., when another cluster with op4 is liquidated or when operator earnings are calculated)

---

### MG-044: Multiple clusters migrate in sequence (shared operators)

**Category:** Sequential migration with shared state

**Setup:**
1. Register 4 operators (op1-op4)
2. Create SSV Cluster A (owner Alice, [op1, op2, op3, op4], 3 validators)
3. Create SSV Cluster B (owner Bob, [op1, op2, op3, op4], 2 validators)
4. Both clusters are active with SSV balance

**Action:**
```solidity
// Transaction 1 (Alice):
migrateClusterToETH([op1, op2, op3, op4], clusterA) { value: ethA }

// Advance 100 blocks

// Transaction 2 (Bob):
migrateClusterToETH([op1, op2, op3, op4], clusterB) { value: ethB }
```

**Expected behavior — Transaction 1:**
1. For each op: `ensureETHDefaults` called (first ETH interaction) → ethSnapshot.block set, ethFee = DEFAULT
2. `ethValidatorCount: 0 → 3` for each op
3. `cumulativeIndexETH = 0` (just initialized, no ETH accrual yet)
4. DAO: `daoValidatorCount -= 3`, `ethDaoValidatorCount += 3`, `daoTotalEthVUnits += 30000`

**Expected behavior — Transaction 2 (100 blocks later):**
1. For each op: `ethSnapshot.block != 0` → `updateSnapshotSt` called (NOT ensureETHDefaults)
2. ETH snapshot accumulates 100 blocks of earnings from Cluster A's 3 validators
3. `ethValidatorCount: 3 → 5` for each op
4. `cumulativeIndexETH > 0` (includes 100 blocks of accrual)
5. Cluster B's `cluster.index` set to this accumulated `cumulativeIndexETH`
6. DAO: `daoValidatorCount -= 2`, `ethDaoValidatorCount += 2`, `daoTotalEthVUnits += 20000`

**Critical assertions:**
1. After both migrations: `op.ethValidatorCount == 5` for each op
2. After both migrations: `op.validatorCount == 0` for each op (SSV side zeroed)
3. Cluster B's index starts from the accumulated ETH index (not zero)
4. Cluster B does NOT get double-charged for blocks before its migration
5. DAO totals: `ethDaoValidatorCount == 5`, `daoTotalEthVUnits == 50000`

---

### MG-056: Double payment prevention

**Category:** Accounting integrity

**Setup:**
1. Register 4 operators with SSV fee and ETH fee (pre-initialized via another ETH cluster)
2. Create SSV cluster with 3 validators, 10000 SSV balance
3. Advance 1000 blocks (SSV fees accrue)

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], cluster) { value: sufficientETH }
```

**Expected behavior:**
1. SSV settlement (line 276): `updateBalanceSSV(clusterIndexSSV, currentNetworkFeeIndexSSV())` computes SSV fees for blocks 0–1000. Remaining SSV balance saved as `ssvClusterBalance`.
2. ETH setup (line 279-282): `cluster.balance = msg.value`, `cluster.index = clusterIndexETH`, `cluster.networkFeeIndex = currentNetworkFeeIndex()`
3. The ETH cluster starts with current indexes → ETH fees only accrue from the migration block forward.
4. No overlap: SSV fees covered pre-migration blocks; ETH fees cover post-migration blocks.

**Critical assertions:**
1. SSV operators: snapshot.index includes all SSV accrual up to migration block
2. ETH cluster: index and networkFeeIndex set to current values (not zero) → no retroactive ETH charges
3. `op.validatorCount` decremented (SSV stops accruing for this cluster)
4. `op.ethValidatorCount` incremented (ETH starts accruing)
5. Total fees = SSV fees (pre-migration) + ETH fees (post-migration), no overlap

---

### MG-024: Mixed operators — some first-time ETH, some already ETH-initialized

**Category:** Operator initialization paths

**Setup:**
1. Register 4 operators (op1-op4), all with SSV fee = 5000
2. Create ETH cluster X with [op1, op2] → op1, op2 get `ensureETHDefaults` during registration → `ethSnapshot.block > 0`
3. Create SSV cluster Y with [op1, op2, op3, op4] (all 4 ops)
4. op3, op4 have never participated in any ETH cluster → `ethSnapshot.block == 0`
5. Advance 200 blocks

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], clusterY) { value: sufficientETH }
```

**Expected behavior in `updateClusterOperatorsMigration`:**

For op1, op2 (already ETH-initialized):
- `operator.ethSnapshot.block == 0` → false (they're initialized)
- `updateSnapshotSt(operator, operatorId)` called → ETH earnings from cluster X accrue for 200 blocks
- `cumulativeIndexETH += operator.ethSnapshot.index` (includes accumulated index)

For op3, op4 (first-time ETH):
- `operator.ethSnapshot.block == 0` → true
- `ensureETHDefaults(operator, operatorId)` called:
  - `ethSnapshot.block = block.number`
  - `ethFee = DEFAULT_OPERATOR_ETH_FEE` (since SSV fee > 0)
  - `OperatorFeeExecuted` event emitted
- `cumulativeIndexETH` does NOT include op3/op4's index (their ethSnapshot.index is 0)

**Critical assertions:**
1. Cluster Y's `cluster.index` = sum of op1.ethSnapshot.index + op2.ethSnapshot.index (op3/op4 contribute 0)
2. op3, op4 now have `ethSnapshot.block == block.number` (initialized)
3. op3, op4 `ethFee == DEFAULT_OPERATOR_ETH_FEE`
4. op1, op2 `ethFee` unchanged (whatever it was before)
5. All 4 ops: `ethValidatorCount` incremented by cluster Y's validator count
6. `OperatorFeeExecuted` emitted exactly twice (for op3 and op4)

---

### MG-021: Operator initialization — ensureETHDefaults first-time (SSV fee > 0)

**Category:** Operator ETH initialization

**Setup:**
1. Register operator with SSV fee = 5000 (non-zero)
2. Create SSV cluster using this operator
3. Operator state: `ethSnapshot.block == 0`, `ethFee == 0`, `fee == 5000`

**Action:**
```solidity
migrateClusterToETH(operatorIds, cluster) { value: sufficientETH }
```

**Expected behavior in `ensureETHDefaults` (OperatorLib.sol:122-133):**
1. `operator.ethSnapshot.block == 0` → enter if block
2. `operator.ethSnapshot.block = uint32(block.number)` — initialize ETH block
3. `operator.ethSnapshot.balance = PACKED_ETH_ZERO` — initialize balance
4. `operator.ethFee.eq(PACKED_ETH_ZERO)` → true (ethFee not set)
5. `operator.fee.neq(PACKED_SSV_ZERO)` → true (SSV fee > 0)
6. `operator.ethFee = defaultOperatorEthFee()` = PackedETHLib.pack(1_778_800_000)
7. Emit `OperatorFeeExecuted(operator.owner, operatorId, block.number, DEFAULT_OPERATOR_ETH_FEE)`

**Critical assertions:**
1. `operator.ethSnapshot.block == block.number`
2. `operator.ethFee == PackedETHLib.pack(1_778_800_000)`
3. `OperatorFeeExecuted` event emitted with correct default fee
4. `operator.fee` (SSV fee) unchanged
5. Subsequent calls to `ensureETHDefaults` are no-ops (ethSnapshot.block != 0)

---

### MG-026: Migrate with validators at operator limit

**Category:** Boundary condition

**Setup:**
1. Set `validatorsPerOperatorLimit = 500`
2. Register 4 operators
3. Create ETH cluster using all 4 ops with 497 validators → `ethValidatorCount = 497` per op
4. Create SSV cluster using all 4 ops with 3 validators
5. After step 3: `ethValidatorCount = 497`, limit = 500

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], ssvCluster) { value: sufficientETH }
```

**Expected behavior:**
- `ethValidatorCount += 3` → `497 + 3 = 500 == validatorsPerOperatorLimit`
- No revert: condition is `>` not `>=` (OperatorLib.sol:378: `if ((operator.ethValidatorCount += validatorCount) > sp.validatorsPerOperatorLimit)`)
- Migration succeeds

**Critical assertions:**
1. `op.ethValidatorCount == 500` (exactly at limit)
2. No `ExceedValidatorLimitWithData` revert
3. Subsequent migration of another cluster to same ops with any validators → reverts

---

### MG-027: Migrate with validators exceeding operator limit → revert

**Category:** Boundary condition (revert path)

**Setup:**
1. Set `validatorsPerOperatorLimit = 500`
2. Register 4 operators
3. Create ETH cluster using all 4 ops with 499 validators → `ethValidatorCount = 499`
4. Create SSV cluster using all 4 ops with 2 validators

**Action:**
```solidity
migrateClusterToETH([op1, op2, op3, op4], ssvCluster) { value: sufficientETH }
```

**Expected behavior:**
- `ethValidatorCount += 2` → `499 + 2 = 501 > 500`
- Revert: `ExceedValidatorLimitWithData(operatorId)` thrown at OperatorLib.sol:379

**Critical assertions:**
1. Transaction reverts with `ExceedValidatorLimitWithData`
2. Error data includes the operatorId that exceeded the limit
3. No state changes (reverted)
4. SSV cluster still exists in `s.clusters` (unchanged)

---

### MG-018: Migrate → removeOperator → updateClusterBalance

**Category:** Post-migration interaction chain
**Cross-ref:** RM4-*

**Setup:**
1. Register 4 operators, all ETH-initialized
2. Create SSV cluster with 3 validators
3. Migrate cluster to ETH with sufficient balance
4. Advance 50 blocks
5. Remove op4 via `removeOperator(op4)` — zeros ethSnapshot.block, ethFee, ethValidatorCount
6. Advance 50 blocks
7. Oracle commits new Merkle root with this cluster's effectiveBalance = 96 ETH

**Action:**
```solidity
updateClusterBalance(blockNum, owner, [op1, op2, op3, op4], cluster, 96, proof)
```

**Expected behavior in `_applyClusterFeeUpdates` (SSVClusters.sol:461-492):**
1. For op1, op2, op3: `ethSnapshot.block != 0` → `updateSnapshotSt` called, fees accrued
2. For op4: `ethSnapshot.block == 0` → skipped in `updateClusterOperators` (OperatorLib.sol:247)
3. `cumulativeIndex` includes op4's preserved `ethSnapshot.index` (from before removal)
4. `cumulativeFee` (burnRate) excludes op4 (fee is 0 after removal)

**Expected behavior in `_updateOperatorVUnits` (SSVClusters.sol:494-509):**
- Loop iterates all operatorIds including op4
- `seb.operatorEthVUnits[op4]` gets updated — **stranded deviation** (similar to MG-052)

**Critical assertions:**
1. Fee accrual for blocks 0-50 uses 4 operators; blocks 50-100 uses 3 operators (op4 removed)
2. BurnRate for liquidation check uses only 3 operator fees
3. Cluster balance correctly deducted
4. No revert from updating removed operator's vUnits

---

### MG-017: Migrate → immediately updateClusterBalance

**Category:** Post-migration EB update

**Setup:**
1. Register 4 operators, create SSV cluster with 2 validators
2. Cluster has implicit EB (no updateClusterBalance done pre-migration)
3. Migrate cluster to ETH
4. Oracle commits root for this cluster with effectiveBalance = 64 (32 ETH/validator, matching implicit)

**Action (same block as migration):**
```solidity
updateClusterBalance(blockNum, owner, operatorIds, migratedCluster, 64, proof)
```

**Expected behavior:**
1. `validateHashedCluster` finds cluster in `s.ethClusters` → `version == VERSION_ETH`
2. `storedVUnits = seb.clusterEB[clusterId].vUnits`
   - If migration set vUnits: use that
   - If migration left vUnits=0: `storedVUnits = 2 * 10000 = 20000`
3. `newVUnits = ebToVUnits(64)` = ceil(64 * 10000 / 32) = 20000
4. `newVUnits == storedVUnits` → no vUnit update needed
5. EB snapshot updated: `{vUnits: 20000, lastRootBlockNum: blockNum, lastUpdateBlock: block.number}`
6. Same-block: `_verifyEBUpdateFrequency` passes because `lastUpdateBlock` was 0 (first update post-migration)

**Critical assertions:**
1. No revert from frequency or staleness checks (first update)
2. If vUnits unchanged: no operator or DAO vUnit updates
3. EB snapshot stored correctly for future reference
4. Cluster balance unchanged (no fees in zero blocks)

---

## Audit Gaps (Added post-audit)

> Identified by code-level branch analysis. These scenarios cover branches and edge conditions not addressed by the original MG-001 through MG-060 set.

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| MG-061 | migrateClusterToETH | Dual-existence: cluster that somehow has entries in both `s.ethClusters` and `s.clusters` — revert `IncorrectClusterState` from `getClusterData`. Defensive storage corruption check. | `entry:migrateClusterToETH; version:both; eb:implicit; cluster:active; ops:4; revert:yes` | [ ] | ClusterLib.sol:346-348 |
| MG-062 | migrateClusterToETH | Missing `nonReentrant`: `migrateClusterToETH` does NOT have `nonReentrant` modifier. Verify a reentrant call during the SSV refund transfer (`transferTokenBalance`) could re-enter migration. Document whether this is exploitable. | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; revert:no` | [ ] | SSVClusters.sol:259, 335-337 |
| MG-063 | migrateClusterToETH | SSV-removed operator with ETH snapshot: operator was removed (both blocks = 0), but had previously served an ETH cluster (so `operatorEthVUnits` might have stale data). Verify migration does not resurrect the operator or write to stale vUnits. | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:362-365, SSVClusters.sol:319-322 |
| MG-064 | migrateClusterToETH | `ensureETHDefaults` pre-set ethFee: operator already had `ethFee` set from a prior ETH cluster, but `ethSnapshot.block > 0`. Verify `ensureETHDefaults` is a no-op and the existing ethFee is preserved (not overwritten with `DEFAULT_OPERATOR_ETH_FEE`). | `entry:migrateClusterToETH; version:ssv→eth; eb:implicit; cluster:active; ops:4; revert:no` | [ ] | OperatorLib.sol:122-133, 366-374 |
| MG-065 | migrateClusterToETH | `vUnitsCluster < baseline` invariant: if an explicit EB update reduced vUnits below `validatorCount * BPS_DENOMINATOR` (theoretically prevented by the 32 ETH floor), the deviation calculation at line 314 would be negative. Verify the floor guarantee makes this unreachable. | `entry:migrateClusterToETH; version:ssv→eth; eb:explicit; cluster:active; ops:4; revert:no` | [ ] | SSVClusters.sol:311-322 |

---

## ask-codex Review Findings

### Corrections

- **MG-008**: Doc says removed operator is "completely skipped" — **INACCURATE**. At OperatorLib.sol:361, a removed operator still contributes its preserved `snapshot.index` to `cumulativeIndexSSV` before the `continue` at :363. Fix description.

### Additional Scenarios

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| MG-066 | migrateClusterToETH | Migrate cluster with removed operator: verify removed op's preserved SSV index IS included in settlement (OperatorLib.sol:361) even though ETH migration skips it (OperatorLib.sol:363). Documents the asymmetry. | `entry:migrateClusterToETH; revert:no` | [ ] | OperatorLib.sol:361, 363 |
| MG-067 | migrateClusterToETH | Double-payment boundary: removed op excluded from ETH migration (OperatorLib.sol:363) but preserved SSV index included (OperatorLib.sol:361). Verify no double-billing across versions. | `entry:migrateClusterToETH; revert:no` | [ ] | OperatorLib.sol:361, 363 |

---

## Coverage Verification (W4)

| ID | Tested | remove_mode | Test File | Notes |
|----|--------|-------------|-----------|-------|
| MG-001 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts, test/e2e/migration/migration-basic.test.ts | "Migrates an existing SSV cluster to ETH and emits the expected event" (unit, 4 ops) + e2e "Migrates SSV cluster to ETH with correct SSV refund and ETH deposit". Full assertion set: event, active, balance, validatorCount, operator ethValidatorCount, operatorEthVUnits. |
| MG-002 | no | none | — | No migration test with 7 operators. |
| MG-003 | no | none | — | No migration test with 10 operators. |
| MG-004 | no | none | — | No migration test with 13 operators. |
| MG-005 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | "Uses stored EB snapshot vUnits during migration when present" — vUnits=12000 (deviation=2000), asserts operatorEthVUnits=2000 and effectiveOperatorVUnits=12000 for each op. |
| MG-006 | partial:weak | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | Implicit baseline test covers vUnits == validatorCount * BPS case (MG-001 test: effectiveBalance=32, deviation=0). No explicit test of explicit EB set exactly at baseline. |
| MG-007 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | MG-001 test uses implicit EB (vUnits=0 in storage), verifies effectiveBalance=32, operatorEthVUnits=0. |
| MG-008 | partial:mock | mock_zero | test/unit/SSVClusters/migrateClusterToETH.test.ts | "Skips removed operators during migration without reviving them" — uses mockRemoveOperator (zeros fields but does NOT delete operatorEthVUnits). Assertions check ethValidatorCount >= 0 (weak). |
| MG-008 | yes | real | test/e2e/migration/migration-edge.test.ts | "Migration succeeds when Op1 is removed — removed operator is skipped" — uses real removeOperator(). Removed op validatorCount=0, live ops validatorCount=1. |
| MG-009 | partial:mock | mock_zero | test/unit/SSVClusters/migrateClusterToETH.test.ts | "Maintains operator count integrity with mixed valid/removed operators" — removes 2 of 4 ops via mockRemoveOperator. Live ops get validatorCount, removed get >= 0 (weak assertion). |
| MG-010 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | "IncorrectClusterVersion" revert when migrating an already-ETH cluster. Tested at end of MG-001 test. |
| MG-011 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts, test/unit/SSVClusters/reactivate.test.ts, test/e2e/migration/migration-basic.test.ts | "Handles liquidated cluster migration correctly" (unit) + "Migrates a liquidated SSV cluster to ETH without requiring an EB snapshot" (reactivate.test) + "Migrates liquidated SSV cluster — no SSV refund, emits ClusterReactivated" (e2e). SSV counts preserved, ETH counts incremented, ClusterReactivated emitted. |
| MG-012 | yes | none | test/e2e/migration/migration-basic.test.ts | "Migration with insufficient ETH reverts (edge)" — value: 0n, reverts InsufficientBalance. |
| MG-013 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts, test/e2e/migration/migration-edge.test.ts | "InsufficientBalance" revert (unit: mockMinimumLiquidationCollateral) + e2e "Reverts when ETH deposit is 1 wei below threshold". |
| MG-014 | yes | none | test/e2e/migration/migration-edge.test.ts | "Reverts when ETH deposit is 0" — explicitly tests zero msg.value. |
| MG-015 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | "Refunds SSV token balance to the owner when migrating an active SSV cluster" — verifies token transfer equals ssvBalance, event.ssvRefunded matches. |
| MG-016 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | MG-001 test: ssvCluster.balance=0, event.ssvRefunded=0. Also "Migrates a liquidated SSV cluster to ETH" has ssvRefunded=0. |
| MG-017 | no | none | — | No test of migrate then immediately updateClusterBalance. |
| MG-018 | no | real | — | No test of migrate then removeOperator then updateClusterBalance. |
| MG-019 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | Tested at end of MG-001 test: second migrateClusterToETH on same cluster reverts IncorrectClusterVersion (s.clusters[key] deleted). |
| MG-020 | no | none | — | No test verifying pending fee declaration is ignored during migration. |
| MG-021 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | "Emits OperatorFeeExecuted for each legacy SSV operator when migrating to ETH" — ensureETHDefaults sets ethFee=DEFAULT_OPERATOR_ETH_FEE, emits event per op. |
| MG-022 | partial:weak | none | test/e2e/migration/migration-double-payment.test.ts | "Assigns default ETH fee on migration when legacy operator had ethFee explicitly reset to zero" — tests that default IS assigned when fee=0 + legacy SSV. Does not test the case where SSV fee=0 means ethFee stays 0 (the scenario's actual intent). |
| MG-023 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | "Does not emit duplicate OperatorFeeExecuted when operator already initialized with ETH defaults" — first ETH op triggers ensureETHDefaults, second does not. |
| MG-024 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | "Correctly handles mixed operator states during migration" — 2 ops already ETH-initialized (via prior registerValidator), 2 first-time; all get correct ethValidatorCount. |
| MG-025 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | Same as MG-024 — operators serve both ETH and SSV clusters; ethValidatorCount accumulates. |
| MG-026 | no | none | — | No test at exact validatorsPerOperatorLimit boundary. |
| MG-027 | no | none | — | No test exceeding validatorsPerOperatorLimit with ExceedValidatorLimitWithData revert. |
| MG-028 | partial:mock | mock_zero | test/unit/SSVClusters/migrateClusterToETH.test.ts | "Skips removed operators during migration" — mockRemoveOperator, live ops get ethValidatorCount, removed get >=0 (weak). Real removeOperator tested in e2e/migration-edge. |
| MG-028 | yes | real | test/e2e/migration/migration-edge.test.ts | "Migration succeeds when Op1 is removed" — real removeOperator, removed op validatorCount=0, live ops=1. |
| MG-029 | yes | real | test/e2e/migration/migration-double-payment.test.ts | "Includes removed operator frozen snapshot.index in migration SSV settlement" — verifies removed op ethSnapshot.blockNumber=0 after migration. |
| MG-030 | yes | mock_payout | test/e2e/migration/migration-double-payment.test.ts | "Includes removed operator frozen snapshot.index" — verifies removed op contributes no ethFee to ETH side but preserved SSV index IS included. mockRemoveOperatorAndPayout used. |
| MG-031 | yes | none | test/e2e/migration/migration-basic.test.ts, test/e2e/migration/migration-edge.test.ts | SSV operator validatorCount decremented to 0 after migration (active cluster). DAO SSV accounting implicit. |
| MG-032 | yes | none | test/e2e/migration/migration-double-payment.test.ts | "Liquidated cluster migration with removed operator preserves SSV counts" — isLiquidated=true, SSV validatorCount NOT decremented (already done by liquidation). |
| MG-033 | yes | none | test/e2e/migration/migration-basic.test.ts | NetworkValidatorsCount increases after migration. ETH ethDaoValidatorCount incremented. |
| MG-034 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | "Uses stored EB snapshot vUnits during migration when present" — deviation=2000 added to each op's operatorEthVUnits. |
| MG-035 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | MG-001 test: implicit EB, no deviation. operatorEthVUnits=0 for all ops. |
| MG-036 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | "Preserves SSV snapshot state before validator count reduction" — SSV validatorCount decremented by cluster.validatorCount for each op. |
| MG-037 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts, test/e2e/migration/migration-double-payment.test.ts | "Handles liquidated cluster migration correctly" — SSV validatorCount NOT decremented (already done). |
| MG-038 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | "Preserves SSV snapshot state before validator count reduction" — snapshot.index updated before migration. |
| MG-039 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts, test/e2e/migration/migration-full-lifecycle.test.ts | "Validates full migration accounting correctness" — SSV balance settled, refund matches independent calculation. |
| MG-040 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | MG-001 test + MG-019: after migration, second migration reverts (SSV record deleted). |
| MG-041 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | MG-001 test: ETH cluster hash != ZeroHash after migration. Active, balance, validatorCount verified. |
| MG-042 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | MG-001 test: ClusterMigratedToETH event verified with ethDeposited, ssvRefunded, effectiveBalance. |
| MG-043 | yes | none | test/e2e/migration/migration-basic.test.ts | "Migrates liquidated SSV cluster — emits ClusterReactivated" — both events verified. |
| MG-044 | yes | none | test/e2e/migration/migration-edge.test.ts | "Two clusters with same operators migrate correctly without index corruption" — sequential migration, ethValidatorCount accumulates to 3. |
| MG-045 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | "Correctly handles mixed operator states during migration" — second migration's ops have ethSnapshot.index > 0 from first ETH interaction. |
| MG-046 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | MG-001 test: ssvCluster.balance=0. No SSV transfer. |
| MG-047 | no | none | — | No test with validatorCount=0 cluster migration. |
| MG-048 | no | none | — | No test for non-owner caller revert on migration. Hash mismatch with msg.sender as owner. |
| MG-049 | yes | none | test/unit/SSVClusters/migrateClusterToETH.test.ts | "ClusterDoesNotExists" when migrating a missing cluster. |
| MG-050 | no | none | — | No explicit IncorrectClusterState test for migration (stale cluster struct). |
| MG-051 | yes | mock_payout | test/e2e/migration/migration-double-payment.test.ts | "Liquidated cluster migration with removed operator preserves SSV counts and skips removed ETH setup" — mockRemoveOperatorAndPayout used. SSV counts preserved, removed op ETH snapshot stays 0. |
| MG-052 | no | real | — | No test combining explicit EB deviation + removed operator during migration. Scenario notes potential bug with stranded deviation. |
| MG-053 | yes | none | test/e2e/migration/migration-full-lifecycle.test.ts, test/e2e/migration/migration-basic.test.ts | Post-migration registerValidator (adding validators to migrated cluster) tested in "ETH fees accrue correctly after migration". Deposit tested via balance checks. |
| MG-054 | yes | none | test/e2e/migration/migration-full-lifecycle.test.ts | Withdraw tested after migration — "Verifies complete economic correctness across full lifecycle". |
| MG-055 | no | none | — | No test for full migrate -> liquidate -> reactivate lifecycle. |
| MG-056 | yes | none | test/e2e/migration/migration-double-payment.test.ts | "Baseline: all operators active uses exact SSV refund formula" — SSV settlement covers pre-migration blocks only; ETH starts from migration block. No double-billing verified. |
| MG-057 | yes | none | test/e2e/migration/migration-basic.test.ts | "Migrates SSV cluster to ETH with correct SSV refund" — cluster.index set to 0 (ETH cumulative index at migration point), not SSV index. |
| MG-058 | no | none | — | No test with all zero-fee operators during migration. |
| MG-059 | yes | none | test/e2e/migration/migration-double-payment.test.ts | "Assigns default ETH fee on migration when legacy operator had ethFee explicitly reset to zero" — verifies ensureETHDefaults assigns DEFAULT_OPERATOR_ETH_FEE, does NOT overwrite if already initialized. |
| MG-060 | no | none | — | No stress test with large validator count + high EB. |
| MG-066 | yes | mock_payout | test/e2e/migration/migration-double-payment.test.ts | "Includes removed operator frozen snapshot.index in migration SSV settlement" — explicitly verifies preserved SSV index IS included, ETH setup is NOT called. |
| MG-067 | yes | mock_payout | test/e2e/migration/migration-double-payment.test.ts | Same test — verifies correctRefund != buggyRefund (which would exclude removed op's index), proving no double-billing. |
