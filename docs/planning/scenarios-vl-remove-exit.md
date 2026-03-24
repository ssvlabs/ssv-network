# Scenarios: Validator Removal & Exit (VX-001 — VX-060)

**Worker:** W1-F
**Prefix:** VX
**Source files:**
- `contracts/modules/SSVValidators.sol` — `removeValidator`, `bulkRemoveValidator`, `exitValidator`, `bulkExitValidator`, `_bulkRemoveValidator`
- `contracts/libraries/OperatorLib.sol` — `updateClusterOperators`, `updateClusterOperatorsSSV`
- `contracts/libraries/ClusterLib.sol` — `validateHashedCluster`, `updateClusterData`, `updateBalanceWithEB`, `getVUnits`
- `contracts/libraries/ValidatorLib.sol` — `_validateExistingValidator`, `hashOperatorIds`, `validateCorrectState`
- `docs/SPEC.md` §1 Cluster Lifecycle, §2 EB Accounting
- `docs/FLOWS.md` §1.3–1.6

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| VX-001 | removeValidator (4 ops, ETH, active, implicit EB) | Remove single validator from active 4-op ETH cluster; verify validatorCount--, ethValidatorCount-- per operator, DAO decrement, fee settlement, cluster hash update | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:56-65, OperatorLib.sol:233-262 |
| VX-002 | removeValidator (7 ops, ETH, active, implicit EB) | Same as VX-001 with 7-operator cluster; verify all 7 operators' ethValidatorCount decremented | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:7; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:56-65 |
| VX-003 | removeValidator (10 ops, ETH, active, implicit EB) | Same as VX-001 with 10-operator cluster | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:10; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:56-65 |
| VX-004 | removeValidator (13 ops, ETH, active, implicit EB) | Same as VX-001 with 13-operator cluster (max) | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:13; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:56-65 |
| VX-005 | removeValidator (4 ops, ETH, active, explicit EB) | Remove single validator from cluster with explicit EB tracking; verify ebSnapshot.vUnits -= 1 * BPS_DENOMINATOR | `entry:removeValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:204-207 |
| VX-006 | removeValidator (7 ops, ETH, active, explicit EB) | Same as VX-005 with 7-op cluster; verify vUnits update and balance settlement uses EB-weighted fee | `entry:removeValidator; version:eth; eb:explicit; cluster:active; ops:7; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:204-207, ClusterLib.sol:306-321 |
| VX-007 | removeValidator — last validator (ETH, implicit EB) | Remove the only validator in cluster; verify validatorCount reaches 0, cluster balance preserved (can withdraw later), cluster hash updated; no EB deviation cleanup needed (implicit) | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:210-223 |
| VX-008 | removeValidator — last validator (ETH, explicit EB, no deviation) | Remove last validator with explicit EB but vUnits == validatorCount * BPS_DENOMINATOR (no deviation); verify ebSnapshot.vUnits set to 0, no operatorEthVUnits cleanup needed | `entry:removeValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:210-223 |
| VX-009 | removeValidator — last validator (ETH, explicit EB, with deviation) | Remove last validator with explicit EB where vUnits > validatorCount * BPS_DENOMINATOR (positive deviation); verify remainingVUnits subtracted from each operator's operatorEthVUnits and DAO's daoTotalEthVUnits; ebSnapshot.vUnits zeroed | `entry:removeValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:210-223 |
| VX-010 | removeValidator — non-owner caller (revert) | Attempt to remove validator owned by address A from address B; verify revert with ValidatorDoesNotExist (hashed with wrong owner) | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVValidators.sol:264-273 |
| VX-011 | removeValidator — wrong operatorIds (revert) | Attempt to remove with mismatched operator set; verify revert with IncorrectValidatorStateWithData | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVValidators.sol:270-272 |
| VX-012 | removeValidator — non-existent pubkey (revert) | Attempt to remove a validator that was never registered; verify revert with ValidatorDoesNotExist | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVValidators.sol:267-269 |
| VX-013 | removeValidator — incorrect cluster state (revert) | Provide stale cluster data; verify revert with IncorrectClusterState | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:143-145 |
| VX-014 | removeValidator — cluster does not exist (revert) | Provide operator set with no cluster; verify revert with ClusterDoesNotExist | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:141-142 |
| VX-015 | removeValidator (ETH, liquidated cluster) | Remove validator from liquidated ETH cluster; verify validator deleted, validatorCount decremented, but NO operator/DAO settlement (cluster.active is false, so the if-block at line 179 is skipped) | `entry:removeValidator; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:178-196 |
| VX-016 | removeValidator (ETH, liquidated, explicit EB, last validator) | Remove last validator from liquidated cluster with explicit EB; verify EB deviation cleanup is SKIPPED (line 212 checks cluster.active); ebSnapshot.vUnits set to 0 but operatorEthVUnits NOT touched | `entry:removeValidator; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:210-223 |
| VX-017 | removeValidator (SSV cluster, active) | Remove validator from legacy SSV cluster; verify SSV operator snapshots updated via updateClusterOperatorsSSV, SSV DAO counts decremented, cluster stored in s.clusters, no EB updates | `entry:removeValidator; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:230-249 |
| VX-018 | removeValidator (SSV cluster, liquidated) | Remove validator from liquidated SSV cluster; verify validator deleted and validatorCount decremented, but operator/DAO SSV counts NOT decremented (cluster.active is false) | `entry:removeValidator; version:ssv; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:230-249 |
| VX-019 | removeValidator — verify fee settlement accuracy (ETH) | Register validator, advance N blocks, remove; verify cluster.balance reflects exactly N blocks of operator fees + network fee deducted using EB-weighted formula | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | ClusterLib.sol:306-321, OperatorLib.sol:52-72 |
| VX-020 | removeValidator — verify fee settlement with explicit EB (ETH) | Same as VX-019 but with explicit EB (e.g., vUnits = 0.5 * BPS_DENOMINATOR per validator); verify fee deduction is proportionally lower | `entry:removeValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | ClusterLib.sol:306-321 |
| VX-021 | removeValidator — with removed operator in cluster (ETH) | One of 4 operators was removed (ethSnapshot.block == 0); verify removed operator's ethValidatorCount is NOT decremented (skipped by line 247 guard), but its preserved index still contributes to cumulativeIndex | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:245-261 |
| VX-022 | removeValidator — cluster version mismatch (revert) | Cluster exists in both s.ethClusters and s.clusters simultaneously (should not happen); verify revert with IncorrectClusterState from getClusterData | `entry:removeValidator; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:346-348 |
| VX-023 | removeValidator — then re-register same pubkey | Remove validator, then register same public key in same cluster; verify the re-registration succeeds (validatorPKs cleared on removal) | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:174, ValidatorLib.sol:41-58 |
| VX-024 | removeValidator — IncorrectClusterVersion (revert) | Attempt removal but validateHashedCluster returns unknown version; verify revert with IncorrectClusterVersion | `entry:removeValidator; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVValidators.sol:250-252 |
| VX-025 | bulkRemoveValidator — remove 2 of 5 validators (ETH, implicit) | Bulk remove subset of validators; verify validatorCount -= 2, ethValidatorCount -= 2 per op, DAO -= 2, cluster hash updated, 2 events emitted | `entry:bulkRemoveValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:70-76, 153-257 |
| VX-026 | bulkRemoveValidator — remove all 5 validators (ETH, implicit) | Bulk remove all; verify validatorCount reaches 0, no EB deviation cleanup (implicit), cluster balance preserved | `entry:bulkRemoveValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:153-229 |
| VX-027 | bulkRemoveValidator — remove all (ETH, explicit EB, with deviation) | Bulk remove all validators from cluster with explicit EB (positive deviation); verify deviation cleanup: operatorEthVUnits decremented for each operator, daoTotalEthVUnits adjusted, ebSnapshot.vUnits zeroed | `entry:bulkRemoveValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:204-224 |
| VX-028 | bulkRemoveValidator — remove all (ETH, explicit EB, with removed operator) — THE BUG | Cluster has explicit EB and 1 of 4 operators was removed. Bulk remove all validators. Line 217 subtracts remainingVUnits from operatorEthVUnits[removedOperatorId], but removed operator may have had its deviation already cleared or never set, causing underflow or incorrect accounting. Cross-ref: RM3 scenarios | `entry:bulkRemoveValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:215-218 |
| VX-029 | bulkRemoveValidator — empty pubkeys array (revert) | Call bulkRemoveValidator with empty array; verify revert with ValidatorDoesNotExist | `entry:bulkRemoveValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVValidators.sol:160-163 |
| VX-030 | bulkRemoveValidator — one invalid pubkey in batch (revert, atomicity) | Batch of 3 pubkeys where middle one is invalid; verify entire batch reverts (atomicity), no validators removed | `entry:bulkRemoveValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVValidators.sol:172 |
| VX-031 | bulkRemoveValidator — large batch (ETH, 50 validators, 13 ops) | Stress test: bulk remove 50 validators from 13-op cluster; verify gas and correctness at scale | `entry:bulkRemoveValidator; version:eth; eb:implicit; cluster:active; ops:13; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:153-257 |
| VX-032 | bulkRemoveValidator — SSV cluster, active | Bulk remove N validators from legacy SSV cluster; verify SSV accounting path, no EB updates | `entry:bulkRemoveValidator; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:230-249 |
| VX-033 | bulkRemoveValidator — SSV cluster, liquidated | Bulk remove from liquidated SSV; verify validator keys deleted, counts decremented, but NO SSV operator/DAO settlement | `entry:bulkRemoveValidator; version:ssv; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:230-249 |
| VX-034 | bulkRemoveValidator — partial remove from explicit EB cluster | Remove 2 of 5 validators from cluster with explicit EB; verify ebSnapshot.vUnits -= 2 * BPS_DENOMINATOR, no deviation cleanup (validators remain) | `entry:bulkRemoveValidator; version:eth; eb:explicit; cluster:active; ops:7; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:204-207 |
| VX-035 | bulkRemoveValidator — remove all, liquidated, explicit EB | Bulk remove all from liquidated cluster with explicit EB; verify ebSnapshot.vUnits zeroed but deviation NOT cleaned from operators (cluster.active == false) | `entry:bulkRemoveValidator; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:210-223 |
| VX-036 | bulkRemoveValidator — fee settlement once for batch | Register 5 validators, advance blocks, bulk remove 3; verify fee settlement happens exactly once (not per-validator), cluster balance correctly settled | `entry:bulkRemoveValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:178-196 |
| VX-037 | bulkRemoveValidator — multiple removed operators in cluster | 2 of 7 operators removed; bulk remove all validators; verify ethValidatorCount NOT decremented for removed operators, deviation cleanup loop still iterates all operators | `entry:bulkRemoveValidator; version:eth; eb:explicit; cluster:active; ops:7; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:215-218, OperatorLib.sol:245-261 |
| VX-038 | bulkRemoveValidator — EB deviation underflow guard | Cluster with explicit EB where per-operator deviation was partially cleaned (e.g., by prior EB update); verify removal does not underflow operatorEthVUnits. Cross-ref: RM3 | `entry:bulkRemoveValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:215-218 |
| VX-039 | exitValidator — single (ETH cluster) | Exit a single validator from active ETH cluster; verify ValidatorExited event emitted, NO state changes (validatorCount, balance, operator counts all unchanged) | `entry:exitValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:81-86 |
| VX-040 | exitValidator — single (SSV cluster) | Exit validator from legacy SSV cluster; verify event emitted, no state changes | `entry:exitValidator; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:81-86 |
| VX-041 | exitValidator — non-owner caller (revert) | Attempt exit from wrong address; verify revert with ValidatorDoesNotExist | `entry:exitValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVValidators.sol:83 |
| VX-042 | exitValidator — wrong operatorIds (revert) | Exit with mismatched operator set; verify revert with IncorrectValidatorStateWithData | `entry:exitValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVValidators.sol:83 |
| VX-043 | exitValidator — non-existent pubkey (revert) | Exit a pubkey that was never registered; verify revert with ValidatorDoesNotExist | `entry:exitValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVValidators.sol:83 |
| VX-044 | exitValidator — from liquidated cluster | Exit from liquidated cluster; verify event still emitted (no cluster state check in exitValidator — only validator existence checked) | `entry:exitValidator; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:81-86 |
| VX-045 | exitValidator — validator already exited (idempotent) | Exit same validator twice; verify second exit also succeeds (event-only, no state to block repeat) | `entry:exitValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:81-86 |
| VX-046 | exitValidator — then removeValidator | Exit validator, then remove it; verify exit event was emitted first, then removal succeeds normally and deletes validator record | `entry:exitValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:81-86, 56-65 |
| VX-047 | bulkExitValidator — multiple validators (ETH) | Bulk exit 5 validators; verify 5 ValidatorExited events emitted, no state changes | `entry:bulkExitValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:91-103 |
| VX-048 | bulkExitValidator — empty array (revert) | Call with empty pubkeys array; verify revert with ValidatorDoesNotExist | `entry:bulkExitValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVValidators.sol:92-94 |
| VX-049 | bulkExitValidator — one invalid pubkey in batch (revert) | Batch of 3 where one is invalid; verify entire call reverts (no partial exit) | `entry:bulkExitValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVValidators.sol:99 |
| VX-050 | bulkExitValidator — non-owner caller (revert) | Attempt bulk exit from wrong address; verify revert | `entry:bulkExitValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVValidators.sol:99 |
| VX-051 | bulkExitValidator — from liquidated cluster | Bulk exit from liquidated cluster; verify events emitted (no cluster check) | `entry:bulkExitValidator; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:91-103 |
| VX-052 | bulkExitValidator — SSV cluster | Bulk exit from legacy SSV cluster; verify events, no state changes | `entry:bulkExitValidator; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:91-103 |
| VX-053 | removeValidator — after pending EB update | Update cluster EB via oracle (increasing vUnits), then remove a validator; verify ebSnapshot.vUnits correctly decremented by 1 * BPS_DENOMINATOR from the new (higher) value | `entry:removeValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:204-207 |
| VX-054 | removeValidator — operator at validator limit boundary | Operator has ethValidatorCount == validatorsPerOperatorLimit; remove one validator; verify count decrements to limit-1, no revert | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:254-256 |
| VX-055 | removeValidator — verify ValidatorRemoved event contents | Remove validator and verify event fields: owner, operatorIds, publicKey, updated cluster struct (with new validatorCount, settled balance, updated indices) | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:254-256 |
| VX-056 | bulkRemoveValidator — verify N events emitted | Bulk remove 3; verify exactly 3 ValidatorRemoved events, each with correct pubkey and same final cluster state | `entry:bulkRemoveValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:254-256 |
| VX-057 | removeValidator — cluster with negative EB deviation (vUnits < validatorCount * BPS_DENOMINATOR) | Cluster received EB update that reduced vUnits below baseline; remove validator; verify vUnits subtraction does not underflow | `entry:removeValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:204-207 |
| VX-058 | bulkRemoveValidator — interleaved with deposit | Register 5 validators, deposit more ETH, bulk remove 3; verify fee settlement uses correct balance including deposit | `entry:bulkRemoveValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:153-229, ClusterLib.sol:156-165 |
| VX-059 | removeValidator — removed validator then exit same pubkey (revert) | Remove validator, then attempt to exit it; verify revert with ValidatorDoesNotExist (record deleted) | `entry:exitValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVValidators.sol:81-86, 174 |
| VX-060 | bulkRemoveValidator — 10 ops, explicit EB, all removed, deviation cleanup correctness | 10-op cluster with explicit EB and positive deviation; bulk remove all; verify deviation subtracted from all 10 operatorEthVUnits entries and DAO vUnits updated correctly | `entry:bulkRemoveValidator; version:eth; eb:explicit; cluster:active; ops:10; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:210-223 |

---

## Detailed Scenario Blocks (12 Most Complex)

### VX-009: Remove Last Validator — Explicit EB With Deviation Cleanup

**Entry:** `removeValidator`
**Preconditions:**
1. Register 1 validator in a 4-op ETH cluster (owner A, ops [1,2,3,4])
2. Set explicit EB via oracle update: `ebSnapshot.vUnits = 1.5 * BPS_DENOMINATOR` (48 ETH effective balance vs 32 ETH baseline)
3. This creates a deviation of `0.5 * BPS_DENOMINATOR` stored in each `operatorEthVUnits[opId]` and in `daoTotalEthVUnits`
4. Advance several blocks to accumulate fees

**Action:** Call `removeValidator(pubkey, [1,2,3,4], cluster)` from owner A

**Expected State Mutations:**
1. `_validateExistingValidator` passes, `validatorPKs[hash]` deleted
2. `validateHashedCluster` returns `(hashedCluster, VERSION_ETH)`
3. `updateClusterOperators(ops, false, 1, s, sp)`:
   - For each operator: `updateSnapshotSt` updates ETH snapshot (balance accrues with effectiveVUnits = ethValidatorCount * BPS_DENOMINATOR + operatorEthVUnits[opId])
   - `ethValidatorCount` decremented from 1 to 0
4. `cluster.updateClusterData` settles balance using `updateBalanceWithEB` (fee proportional to 1.5 * BPS_DENOMINATOR)
5. `sp.updateDAO(false, 1)`: `ethDaoValidatorCount--`
6. `cluster.validatorCount` decremented from 1 to 0
7. **EB deviation cleanup** (lines 210-223):
   - `ebSnapshot.vUnits -= 1 * BPS_DENOMINATOR` => `remainingVUnits = 0.5 * BPS_DENOMINATOR`
   - `remainingVUnits > 0 && cluster.active` => true
   - Loop: for each op, `seb.operatorEthVUnits[opId] -= remainingVUnits`
   - `sp.updateDAOEthVUnits(remainingVUnits, 0)` => reduces `daoTotalEthVUnits`
   - `ebSnapshot.vUnits = 0`

**Postconditions:**
- `operator.ethValidatorCount == 0` for all 4 operators
- `operatorEthVUnits[opId] == 0` for all 4 operators (deviation fully cleaned)
- `daoTotalEthVUnits` reduced by `remainingVUnits`
- `ethDaoValidatorCount` decreased by 1
- `ebSnapshot.vUnits == 0`
- Cluster balance reflects EB-weighted fee settlement
- `ValidatorRemoved` event emitted with updated cluster

**Code path:** SSVValidators.sol lines 153-257, focus lines 210-223

---

### VX-016: Remove Last Validator — Liquidated Cluster, Explicit EB, Deviation Skipped

**Entry:** `removeValidator`
**Preconditions:**
1. Register 1 validator in 4-op ETH cluster, set explicit EB with deviation
2. Liquidate the cluster (cluster.active = false; deviation already cleaned by liquidation)
3. The ebSnapshot.vUnits may still be non-zero (liquidation does not always zero it)

**Action:** Call `removeValidator(pubkey, [1,2,3,4], cluster)` from owner A

**Expected State Mutations:**
1. Validator record deleted
2. `cluster.active == false` => skip the entire operator/DAO settlement block (line 179)
3. `cluster.validatorCount` decremented from 1 to 0
4. EB path enters (line 204), `ebSnapshot.vUnits -= 1 * BPS_DENOMINATOR`
5. `cluster.validatorCount == 0` => enters cleanup block (line 210)
6. `cluster.active == false` => **deviation cleanup SKIPPED** (line 212 guard fails)
7. `ebSnapshot.vUnits = 0` (line 222 — this still executes unconditionally)

**Postconditions:**
- Validator record deleted
- `cluster.validatorCount == 0`
- `ebSnapshot.vUnits == 0`
- `operatorEthVUnits` NOT modified (deviation was already cleaned during liquidation)
- No operator snapshot updates (skipped for liquidated cluster)
- `ethDaoValidatorCount` NOT decremented (already done at liquidation)

**Why this matters:** Double-decrement protection. Liquidation already cleaned accounting; remove from liquidated cluster must only delete the validator record and adjust validatorCount, not re-settle.

**Code path:** SSVValidators.sol lines 178-229, focus lines 210-223

---

### VX-021: Remove Validator — Cluster Contains Removed Operator

**Entry:** `removeValidator`
**Preconditions:**
1. Register 1 validator in 4-op ETH cluster with operators [1,2,3,4]
2. Operator 3 is subsequently removed by its owner (`removeOperator(3)`), which sets `operator.ethSnapshot.block = 0`, zeroes fee, but preserves `operator.ethSnapshot.index` and `operator.owner`
3. The cluster still references operator 3 in its operator set

**Action:** Call `removeValidator(pubkey, [1,2,3,4], cluster)` from cluster owner

**Expected State Mutations:**
1. `_validateExistingValidator` passes (validator exists)
2. `validateHashedCluster` passes (cluster exists with these operators)
3. `updateClusterOperators(ops, false, 1, s, sp)`:
   - Operators 1, 2, 4: `ethSnapshot.block != 0` => snapshot updated, `ethValidatorCount--`, fee added to `cumulativeFee`
   - **Operator 3**: `ethSnapshot.block == 0` => **SKIPPED**: no snapshot update, `ethValidatorCount` NOT decremented, `ethFee` NOT added to `cumulativeFee`
   - Operator 3's preserved `ethSnapshot.index` still added to `cumulativeIndex`
4. Fee settlement uses reduced `cumulativeFee` (3 operators' fees, not 4)
5. DAO still decremented by 1 (`updateDAO(false, 1)`)

**Postconditions:**
- Operators 1, 2, 4: `ethValidatorCount` decreased by 1
- Operator 3: `ethValidatorCount` UNCHANGED (stale — still counts a validator that was removed from the cluster)
- Cluster balance settled with only 3 operators' fees
- `ethDaoValidatorCount` decreased by 1

**Why this matters:** The removed operator's `ethValidatorCount` becomes stale. This is by design — removed operators are inert. But it means operator-level validator counting is not perfectly accurate for removed operators. The EB deviation cleanup at line 217 DOES still iterate over removed operators, which can cause issues (see VX-028).

**Code path:** OperatorLib.sol lines 245-261

---

### VX-027: Bulk Remove All — Explicit EB With Deviation Cleanup

**Entry:** `bulkRemoveValidator`
**Preconditions:**
1. Register 5 validators in 4-op ETH cluster
2. Oracle EB update sets cluster vUnits to `5 * BPS_DENOMINATOR + 2500` (i.e., 0.25 * BPS_DENOMINATOR deviation per validator equivalent)
3. Each `operatorEthVUnits[opId]` stores the deviation (2500 total spread across this cluster)
4. Advance blocks for fee accumulation

**Action:** Call `bulkRemoveValidator([pk1,pk2,pk3,pk4,pk5], [1,2,3,4], cluster)` from owner

**Expected State Mutations:**
1. All 5 validator records deleted
2. `validatorsRemoved = 5`
3. `updateClusterOperators`: snapshot updated, `ethValidatorCount -= 5` for each op
4. Fee settlement once for entire batch
5. `sp.updateDAO(false, 5)`: `ethDaoValidatorCount -= 5`
6. `cluster.validatorCount -= 5` => 0
7. EB deviation cleanup:
   - `ebSnapshot.vUnits -= 5 * BPS_DENOMINATOR` => `remainingVUnits = 2500`
   - `cluster.active && remainingVUnits > 0` => true
   - Loop: `operatorEthVUnits[opId] -= 2500` for each of 4 operators
   - `updateDAOEthVUnits(2500, 0)` => `daoTotalEthVUnits -= 2500`
   - `ebSnapshot.vUnits = 0`

**Postconditions:**
- All validator records gone
- `ethValidatorCount == previous - 5` per operator
- `operatorEthVUnits[opId]` reduced by 2500 for each op (may reach 0 if this was the only cluster contributing deviation)
- `daoTotalEthVUnits` reduced by 2500
- `ebSnapshot.vUnits == 0`
- 5 `ValidatorRemoved` events

**Code path:** SSVValidators.sol lines 153-257

---

### VX-028: Bulk Remove All — Explicit EB With Removed Operator (THE BUG)

**Entry:** `bulkRemoveValidator`
**Preconditions:**
1. Register 3 validators in 4-op ETH cluster with operators [1,2,3,4]
2. Oracle EB update: `ebSnapshot.vUnits = 3 * BPS_DENOMINATOR + 3000` (deviation = 3000)
3. Each `operatorEthVUnits[opId]` += 3000 for the cluster's deviation
4. Operator 2 is removed by its owner (ethSnapshot.block set to 0, fields zeroed)
5. Crucially: `operatorEthVUnits[2]` may have been partially or fully cleaned depending on what happens at operator removal time

**Action:** Call `bulkRemoveValidator([pk1,pk2,pk3], [1,2,3,4], cluster)` from owner

**Expected State Mutations (Bug Path):**
1. Validators deleted, `validatorsRemoved = 3`
2. `updateClusterOperators`: Operator 2 skipped (block==0), ops 1,3,4 updated normally
3. `cluster.validatorCount -= 3` => 0
4. EB cleanup enters (line 210):
   - `ebSnapshot.vUnits -= 3 * BPS_DENOMINATOR` => `remainingVUnits = 3000`
   - `cluster.active` => true
   - **Line 217**: `seb.operatorEthVUnits[operatorIds[i]] -= remainingVUnits` for ALL operators including operator 2
   - If operator 2's `operatorEthVUnits` was already reduced (or operator 2 has deviation from other clusters < 3000), this **underflows** or produces incorrect accounting

**Why this is a bug:**
The deviation cleanup loop at lines 216-217 iterates over ALL operatorIds in the cluster, including removed operators. But the `updateClusterOperators` call at line 182 SKIPPED removed operators — it did not update their snapshot or decrement their `ethValidatorCount`. The deviation loop doesn't check `ethSnapshot.block != 0`, so it blindly subtracts from a removed operator's `operatorEthVUnits`.

If the removed operator has other active clusters that contributed to its `operatorEthVUnits`, this over-subtracts. If it only had this cluster, the subtraction may still work numerically but creates an inconsistency with the operator's actual state.

**Cross-reference:** RM3 scenario suite for exhaustive removed-operator-in-removal testing.

**Code path:** SSVValidators.sol lines 215-218

---

### VX-030: Bulk Remove — Atomicity on Partial Invalid Batch

**Entry:** `bulkRemoveValidator`
**Preconditions:**
1. Register 3 validators (pk1, pk2, pk3) in 4-op ETH cluster
2. pk2 was already removed in a prior transaction (or never existed)

**Action:** Call `bulkRemoveValidator([pk1, pk2, pk3], [1,2,3,4], cluster)`

**Expected Behavior:**
1. Iteration processes pk1: `_validateExistingValidator` passes, `validatorPKs[hash1]` deleted, `validatorsRemoved = 1`
2. Iteration processes pk2: `_validateExistingValidator` reverts with `ValidatorDoesNotExist`
3. **Entire transaction reverts** — EVM atomicity means pk1's deletion is also rolled back

**Postconditions:**
- pk1 still exists in storage (deletion rolled back)
- pk3 still exists in storage
- No operator/cluster state changes
- No events emitted
- Transaction reverts with `ValidatorDoesNotExist`

**Why this matters:** Users need to know that bulk remove is all-or-nothing. A stale validator in the batch aborts the entire removal.

**Code path:** SSVValidators.sol line 172, ValidatorLib.sol

---

### VX-037: Bulk Remove All — Multiple Removed Operators, Deviation Cleanup

**Entry:** `bulkRemoveValidator`
**Preconditions:**
1. Register 3 validators in 7-op ETH cluster with operators [1,2,3,4,5,6,7]
2. Oracle EB update creates deviation of 5000 in ebSnapshot.vUnits
3. Operators 3 and 5 are subsequently removed by their owners
4. `operatorEthVUnits[3]` and `operatorEthVUnits[5]` still hold deviation from this cluster

**Action:** Bulk remove all 3 validators

**Expected State Mutations:**
1. `updateClusterOperators`: operators 3, 5 SKIPPED (block==0); ops 1,2,4,6,7 updated
2. `ethValidatorCount` decremented for ops 1,2,4,6,7 only (NOT ops 3,5)
3. `cluster.validatorCount -= 3` => 0
4. Deviation cleanup (line 216 loop): iterates ALL 7 operators
   - `operatorEthVUnits[opId] -= remainingVUnits` for ops 1,2,3,4,5,6,7
   - Ops 3 and 5 still get their deviation subtracted despite being removed operators

**Issue:** The loop doesn't distinguish active from removed operators. For removed operators, their `operatorEthVUnits` is modified even though they'll never accrue earnings again (their `ethSnapshot.block == 0` means `updateSnapshotSt` won't use the value). The subtraction is cosmetically correct IF the deviation was only from this cluster, but incorrect if these operators had deviation from other clusters.

**Code path:** SSVValidators.sol lines 215-218, OperatorLib.sol lines 245-261

---

### VX-038: Bulk Remove — EB Deviation Underflow After Prior EB Update

**Entry:** `bulkRemoveValidator`
**Preconditions:**
1. Register 2 validators in 4-op ETH cluster
2. First oracle EB update: sets `ebSnapshot.vUnits = 2 * BPS_DENOMINATOR + 4000` (deviation = 4000, stored in each `operatorEthVUnits[opId]` as += 4000)
3. Second oracle EB update: reduces `ebSnapshot.vUnits` to `2 * BPS_DENOMINATOR + 1000` (deviation reduced to 1000; each `operatorEthVUnits[opId]` -= 3000 during the update)
4. Now: `operatorEthVUnits[opId]` holds 1000 from this cluster (but may also hold deviation from other clusters)

**Action:** Bulk remove both validators

**Expected State Mutations:**
1. `cluster.validatorCount -= 2` => 0
2. `ebSnapshot.vUnits -= 2 * BPS_DENOMINATOR` => `remainingVUnits = 1000`
3. Deviation cleanup: `operatorEthVUnits[opId] -= 1000` for each operator
4. `updateDAOEthVUnits(1000, 0)`

**Key Verification:**
- The cleanup correctly subtracts the CURRENT deviation (1000), not the historical peak (4000)
- `operatorEthVUnits` does not underflow
- This works because `ebSnapshot.vUnits` tracks the running total, and `remainingVUnits` is computed from the current snapshot minus baseline

**Code path:** SSVValidators.sol lines 204-224

---

### VX-019: Fee Settlement Accuracy on Remove

**Entry:** `removeValidator`
**Preconditions:**
1. Register 1 validator in 4-op ETH cluster at block B0
2. Each operator has ethFee = F (packed)
3. Network fee = NF (packed)
4. Cluster deposited D wei
5. Advance to block B0 + N

**Action:** Remove the validator at block B0 + N

**Expected Fee Settlement:**
1. `updateClusterOperators` computes `clusterIndex`:
   - For each operator: `blockDiffEthFee = N * F`
   - Snapshot index += `N * F`
   - Operator balance += `blockDiffEthFee * effectiveVUnits / BPS_DENOMINATOR`
   - `cumulativeIndex = 4 * (previousIndex + N * F)`
2. `updateClusterData` calls `updateBalanceWithEB`:
   - `vUnits = 1 * BPS_DENOMINATOR` (implicit EB, 1 validator)
   - `idxOp = newClusterIndex - cluster.index`
   - `idxNet = currentNetworkFeeIndex - cluster.networkFeeIndex`
   - `usage = ((idxOp * vUnits / BPS_DENOMINATOR) + (idxNet * vUnits / BPS_DENOMINATOR)) * ETH_DEDUCTED_DIGITS`
   - `cluster.balance = D - usage`
3. `updateDAO(false, 1)`: `ethDaoValidatorCount--`

**Postconditions:**
- `cluster.balance == D - (4 * N * F + N * NF) * ETH_DEDUCTED_DIGITS` (for implicit EB where vUnits/BPS_DENOMINATOR = 1)
- Each operator's `ethSnapshot.balance` increased by `N * F * BPS_DENOMINATOR / BPS_DENOMINATOR = N * F` (packed)

**Code path:** ClusterLib.sol lines 306-321, OperatorLib.sol lines 52-72

---

### VX-023: Remove Then Re-Register Same Pubkey

**Entry:** `removeValidator` then `registerValidator`
**Preconditions:**
1. Register validator with pubkey PK in 4-op ETH cluster
2. Verify `validatorPKs[hash(PK, owner)] != 0`

**Action 1:** Remove validator PK
**Action 2:** Register validator PK again with same operator set

**Expected State Mutations (Remove):**
1. `validatorPKs[hash(PK, owner)]` set to 0 (deleted at line 174)
2. All normal removal accounting

**Expected State Mutations (Re-register):**
1. `registerPublicKey` checks `validatorPKs[hash(PK, owner)] == 0` — passes
2. Sets `validatorPKs[hash(PK, owner)]` to new hashed operator data
3. Cluster validatorCount incremented, operator counts incremented, DAO incremented

**Postconditions:**
- Validator exists again with fresh registration
- `cluster.validatorCount` back to original
- Operator `ethValidatorCount` values back to original
- No leftover state from prior registration
- New `ValidatorAdded` event emitted

**Why this matters:** Validates that removal fully clears state, enabling clean re-registration. No ghost validator state leaks.

**Code path:** SSVValidators.sol line 174, ValidatorLib.sol lines 41-58

---

### VX-053: Remove After Pending EB Update

**Entry:** `removeValidator`
**Preconditions:**
1. Register 3 validators in 4-op ETH cluster
2. Initial: `ebSnapshot.vUnits = 0` (implicit, treated as 3 * BPS_DENOMINATOR)
3. Oracle submits EB update: `ebSnapshot.vUnits = 3 * BPS_DENOMINATOR + 6000` (deviation = 6000)
4. `operatorEthVUnits[opId] += 6000` for each operator
5. `daoTotalEthVUnits += 6000`

**Action:** Remove 1 validator

**Expected State Mutations:**
1. `updateClusterOperators`: `ethValidatorCount--` for each operator; snapshot uses effectiveVUnits = `(ethValidatorCount * BPS_DENOMINATOR) + operatorEthVUnits[opId]`
2. Fee settlement via `updateBalanceWithEB`: uses `getVUnits(clusterId, 3)` which returns `3 * BPS_DENOMINATOR + 6000` (explicit, non-zero)
3. `cluster.validatorCount -= 1` => 2
4. EB path (line 204): `ebSnapshot.vUnits > 0` => true
5. `ebSnapshot.vUnits -= 1 * BPS_DENOMINATOR` => `2 * BPS_DENOMINATOR + 6000`
6. `cluster.validatorCount != 0` => no deviation cleanup

**Postconditions:**
- `ebSnapshot.vUnits == 2 * BPS_DENOMINATOR + 6000` (baseline reduced by 1 validator, deviation preserved)
- Deviation (6000) remains in `operatorEthVUnits` — correct because it represents actual EB deviation, not per-validator count
- Fee settlement was computed with the higher EB weight (pre-removal vUnits)
- Next EB oracle update will adjust vUnits based on actual beacon chain data

**Why this matters:** Tests the interaction between explicit EB tracking and partial removal. The deviation is cluster-wide, not per-validator, so removing a validator only reduces the baseline component.

**Code path:** SSVValidators.sol lines 204-227

---

### VX-046: Exit Then Remove (Two-Step Flow)

**Entry:** `exitValidator` then `removeValidator`
**Preconditions:**
1. Register 1 validator in 4-op ETH cluster
2. Advance blocks for fee accumulation

**Action 1:** `exitValidator(pubkey, [1,2,3,4])` at block B1

**Expected (Exit):**
- `_validateExistingValidator` passes
- `ValidatorExited` event emitted
- NO state changes: validatorCount unchanged, balance unchanged, operator counts unchanged
- Validator record remains in `validatorPKs`
- Cluster continues accruing fees

**Action 2:** Advance to block B2 > B1, then `removeValidator(pubkey, [1,2,3,4], cluster)` at B2

**Expected (Remove):**
- Normal removal path executes
- Fee settlement covers blocks B0 to B2 (entire lifetime, including blocks after exit signal)
- `validatorPKs[hash]` deleted
- `cluster.validatorCount--`, operator/DAO counts decremented

**Postconditions:**
- Validator fully removed
- Fees accrued between exit signal and removal are correctly settled
- `ValidatorExited` event at B1, `ValidatorRemoved` event at B2
- Cluster balance reflects fees for full [B0, B2] period

**Why this matters:** Validates the documented two-step exit flow. The exit is a signal to SSV nodes; fees keep accruing until actual removal. Users must understand they pay fees until `removeValidator` is called.

**Code path:** SSVValidators.sol lines 81-86 (exit), 56-65 (remove)

---

## Audit Gaps (Added post-audit)

> Identified by code-level branch analysis. These scenarios cover branches and edge conditions not addressed by the original VX-001 through VX-060 set.

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| VX-061 | bulkExitValidator | Call with wrong operatorIds (valid pubkeys but mismatched operator set) — revert `IncorrectValidatorStateWithData`. Verifies operator validation in the bulk exit path. | `entry:bulkExitValidator; version:eth; eb:implicit; cluster:active; ops:4; revert:yes` | [ ] | SSVValidators.sol:99 |
| VX-062 | bulkExitValidator | Idempotent: bulk exit same validators twice — second call succeeds (event-only, no state check beyond existence). Verifies exit is repeatable. | `entry:bulkExitValidator; version:eth; eb:implicit; cluster:active; ops:4; revert:no` | [ ] | SSVValidators.sol:91-103 |
| VX-063 | bulkRemoveValidator | **CRITICAL**: Bulk remove all validators from explicit EB cluster where `ebSnapshot.vUnits` underflows during deviation cleanup. If `remainingVUnits > operatorEthVUnits[opId]` due to prior operator removal, the subtraction at line 217 underflows. Verify behavior (revert or silent wrap). | `entry:bulkRemoveValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:yes` | [ ] | SSVValidators.sol:215-218 |
| VX-064 | removeValidator | Remove validator from cluster where ALL operators have been removed (`ethSnapshot.block == 0` for all). Cluster is still active with `validatorCount > 0`. Verify: no operator snapshot updates, no DAO decrement for operators, cluster hash still updated. | `entry:removeValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:245-261, SSVValidators.sol:178-196 |
| VX-065 | removeValidator | Remove validator from SSV cluster where one operator was removed (SSV path). Verify `updateClusterOperatorsSSV` skips removed operator's `validatorCount` decrement. | `entry:removeValidator; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:396-423, SSVValidators.sol:230-249 |
| VX-066 | removeValidator | SSV fee settlement math: remove validator from active SSV cluster, verify `updateBalanceSSV` correctly computes balance using SSV indexes and operator fee indexes (not ETH indexes). | `entry:removeValidator; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | ClusterLib.sol:updateBalanceSSV, SSVValidators.sol:230-249 |
| VX-067 | bulkRemoveValidator | SSV: bulk remove all validators to zero from active SSV cluster. Verify `validatorCount` reaches 0, SSV cluster hash updated, SSV DAO counts decremented correctly. | `entry:bulkRemoveValidator; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:230-249 |
| VX-068 | bulkExitValidator | Call with wrong operatorIds for a valid set of pubkeys — revert `IncorrectValidatorStateWithData`. Distinct from VX-049 which tests invalid pubkeys. | `entry:bulkExitValidator; version:eth; eb:implicit; cluster:active; ops:4; revert:yes` | [ ] | SSVValidators.sol:99 |

---

## ask-codex Review Findings

### Corrections

- **VX-024**: Documents a defensive `IncorrectClusterVersion` branch that is unreachable — `validateHashedCluster` only returns ETH or SSV. Mark as defensive/unreachable.
- **VX-057**: Unreachable under current EB rules — below-baseline EB reverts at SSVClusters.sol:456.
- **VX-028/VX-037**: Should state that `removeOperator` deletes `operatorEthVUnits` at SSVOperators.sol:93 — current wording is looser.

### Additional Scenarios

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| VX-069 | bulkRemoveValidator | ETH cluster, liquidated, explicit EB, partial removal (NOT last validator). Skip active-cluster block at SSVValidators.sol:179, decrement ebSnapshot.vUnits at :204, but don't enter last-validator cleanup. | `entry:bulkRemoveValidator; version:eth; revert:no` | [ ] | SSVValidators.sol:179, 204, 210 |

---

## Coverage Verification (W4)

| ID | Tested | remove_mode | Test File | Notes |
|----|--------|-------------|-----------|-------|
| VX-001 | yes | none | unit/SSVValidator/removeValidator.test.ts | "Removes an existing validator, updates cluster state and emits correct events" — 4 ops, verifies validatorCount==0, active==true, event emitted |
| VX-002 | yes | none | unit/SSVValidator/removeValidator.test.ts | "Removes a validator with 7 operators" — gas tracked |
| VX-003 | yes | none | unit/SSVValidator/removeValidator.test.ts | "Removes a validator with 10 operators" — gas tracked |
| VX-004 | yes | none | unit/SSVValidator/removeValidator.test.ts | "Removes a validator with 13 operators" — gas tracked |
| VX-005 | yes | none | unit/SSVValidator/removeValidator.test.ts | "Keeps explicit EB snapshot consistent across updateClusterBalance and remove" — explicit EB, partial remove, verifies vUnits -= BPS_DENOMINATOR |
| VX-006 | no | none | — | No 7-op explicit EB remove test |
| VX-007 | yes | none | unit/SSVValidator/removeValidator.test.ts | "Removes an existing validator" covers last-validator with implicit EB (validatorCount reaches 0) |
| VX-008 | partial:weak | none | unit/SSVValidator/removeValidator.test.ts | "Updates operatorEthVUnits on register/remove even when cluster EB snapshot is not set" — removes last validator, checks operatorEthVUnits==0 but no deviation to clean |
| VX-009 | yes | none | unit/SSVValidator/removeValidator.test.ts | "Clears remaining explicit EB vUnits when removing the last validator" — explicit EB (96 ETH), verifies clusterVUnits==0 and operatorEthVUnits==0 for all ops |
| VX-010 | yes | none | e2e/validators/validator-edge-cases.test.ts | "Reverts with IncorrectValidatorStateWithData when wrong owner removes" — otherAccount tries to remove, gets ClusterDoesNotExist (hash includes owner) |
| VX-011 | yes | none | unit/SSVValidator/exitValidator.test.ts | "Is reverted with 'IncorrectValidatorStateWithData' when operator ids do not match" — verified via exitValidator; removeValidator path uses same _validateExistingValidator |
| VX-012 | yes | none | unit/SSVValidator/removeValidator.test.ts | "Is reverted with 'ValidatorDoesNotExist' when validator was not registered" |
| VX-013 | yes | none | unit/SSVValidator/removeValidator.test.ts | "Is reverted with 'IncorrectClusterState' when provided cluster data is stale or mismatched" |
| VX-014 | yes | none | unit/SSVValidator/removeValidator.test.ts | "Is reverted with 'ClusterDoesNotExists' when attempting to remove from a missing cluster" |
| VX-015 | no | none | — | No test for removing from a liquidated ETH cluster (VX-016 covers last validator + EB, but no simple implicit EB liquidated remove) |
| VX-016 | yes | none | unit/SSVValidator/bug4-double-deviation-liquidated.test.ts | "should not double-subtract deviation when removing all validators from a liquidated cluster with explicit EB" — verifies operatorEthVUnits unchanged, clusterVUnits zeroed |
| VX-017 | yes | none | unit/SSVValidator/removeValidator.test.ts | "Removes validator from active legacy SSV cluster" — verifies operator counts, cluster hash, SSV path |
| VX-018 | yes | none | unit/SSVValidator/removeValidator.test.ts | "Removes validator from liquidated legacy SSV cluster" — verifies counts NOT decremented after liquidation |
| VX-019 | yes | none | unit/SSVValidator/feeSettlement.test.ts | "removeValidator settles accumulated fees and operator snapshot balance matches expected earnings" — exact fee math with block counting |
| VX-020 | no | none | — | No test for fee settlement with explicit EB (proportionally lower deduction) |
| VX-021 | partial:mock | mock_zero | unit/SSVClusters/removedOperatorImpact.test.ts | "excludes removed operator fees from ETH cluster settlement" — uses mockRemoveOperator, verifies removed op snapshot frozen, active ops earn correctly |
| VX-022 | no | none | — | No test for cluster version mismatch (defensive/unreachable branch) |
| VX-023 | no | none | — | No test for remove then re-register same pubkey flow |
| VX-024 | no | none | — | Unreachable branch (documented as defensive in ask-codex review) |
| VX-025 | yes | none | unit/SSVValidator/bulkRemoveValidator.test.ts | "Removes multiple validators, updates cluster state" — 2 of 2 removed; also e2e "Bulk remove 3 of 5 validators" |
| VX-026 | yes | none | unit/SSVValidator/bulkRemoveValidator.test.ts | "Removes multiple validators" — bulk removes all, validatorCount==0 |
| VX-027 | partial:weak | none | unit/SSVValidator/bulkRemoveValidator.test.ts | "Clears stored EB snapshot vUnits when removing the last validators" — removes all with explicit EB, verifies vUnits==0 and operatorEthVUnits==0; but no positive deviation test |
| VX-028 | no | none | — | THE BUG: No test for bulk remove all with explicit EB + removed operator — deviation cleanup on removed operator |
| VX-029 | yes | none | unit/SSVValidator/bulkRemoveValidator.test.ts | "Is reverted with 'ValidatorDoesNotExist' when no public keys are provided" |
| VX-030 | yes | none | unit/SSVValidator/bulkRemoveValidator.test.ts | "Reverts bulk removal atomically when one validator in batch is invalid" — verifies atomicity, no state changes |
| VX-031 | no | none | — | No stress test for 50 validators with 13 ops |
| VX-032 | yes | none | unit/SSVValidator/bulkRemoveValidator.test.ts | "Bulk removes multiple validators from active legacy SSV cluster" — verifies counts, events, SSV path |
| VX-033 | no | none | — | No test for bulk remove from liquidated SSV cluster |
| VX-034 | yes | none | unit/SSVValidator/bulkRemoveValidator.test.ts | "Decrements stored EB snapshot vUnits when set and removing a subset" — removes 2 of 3, verifies vUnits correctly decremented |
| VX-035 | no | none | — | No test for bulk remove all from liquidated cluster with explicit EB |
| VX-036 | partial:weak | none | unit/SSVValidator/feeSettlement.test.ts | "bulkRegisterValidator deducts fees proportional to bulk validator count" — tests fee settlement on register (once for batch), but no remove-specific single-settlement test |
| VX-037 | no | none | — | No test for multiple removed operators in cluster during deviation cleanup |
| VX-038 | no | none | — | No test for EB deviation underflow guard after prior EB update |
| VX-039 | yes | none | unit/SSVValidator/exitValidator.test.ts | "Exits an existing validator and emits the correct event" — verifies event, no state changes |
| VX-040 | no | none | — | No test for exitValidator on SSV cluster (only ETH cluster tested) |
| VX-041 | yes | none | unit/SSVValidator/exitValidator.test.ts | "Is reverted with 'IncorrectValidatorStateWithData' when validator was not registered" — non-existent pubkey (hashed with wrong owner yields same effect) |
| VX-042 | yes | none | unit/SSVValidator/exitValidator.test.ts | "Is reverted with 'IncorrectValidatorStateWithData' when operator ids do not match the validator" |
| VX-043 | yes | none | unit/SSVValidator/exitValidator.test.ts | Same test as VX-041 — covers non-existent pubkey |
| VX-044 | no | none | — | No test for exitValidator from liquidated cluster |
| VX-045 | yes | none | unit/SSVValidator/exitValidator.test.ts | "Calling exitValidator twice on the same validator succeeds both times" — idempotent |
| VX-046 | yes | none | e2e/validators/validator-edge-cases.test.ts | "exitValidator emits event but makes no state change" — exits then removes, verifies both events and state |
| VX-047 | yes | none | unit/SSVValidator/bulkExitValidator.test.ts | "Exits multiple validators and emits events" — 2 validators, both events verified |
| VX-048 | yes | none | unit/SSVValidator/bulkExitValidator.test.ts | "Is reverted with 'ValidatorDoesNotExist' when no public keys are provided" |
| VX-049 | yes | none | unit/SSVValidator/bulkExitValidator.test.ts | "Is reverted with 'ValidatorDoesNotExist' when any validator is not registered" — batch of 2 where second is invalid |
| VX-050 | no | none | — | No test for bulkExitValidator from wrong address (non-owner) |
| VX-051 | no | none | — | No test for bulkExitValidator from liquidated cluster |
| VX-052 | no | none | — | No test for bulkExitValidator on SSV cluster |
| VX-053 | yes | none | unit/SSVValidator/removeValidator.test.ts | "Keeps explicit EB snapshot consistent across updateClusterBalance and remove" — oracle update then remove, verifies vUnits correctly decremented |
| VX-054 | no | none | — | No test for operator at validatorsPerOperatorLimit boundary on remove |
| VX-055 | partial:weak | none | unit/SSVValidator/removeValidator.test.ts | First test verifies ValidatorRemoved event emitted and validatorCount, but does not check full event field contents |
| VX-056 | yes | none | e2e/validators/validator-edge-cases.test.ts | "Bulk remove 3 of 5 validators" — verifies exactly 3 ValidatorRemoved events |
| VX-057 | no | none | — | Unreachable under current EB rules (documented in ask-codex review) |
| VX-058 | no | none | — | No test for interleaved deposit + bulk remove fee settlement |
| VX-059 | no | none | — | No test for remove then exit same pubkey revert |
| VX-060 | no | none | — | No test for 10-op cluster explicit EB deviation cleanup on bulk remove all |
| VX-061 | yes | none | unit/SSVValidator/bulkExitValidator.test.ts | "Is reverted with 'IncorrectValidatorStateWithData' when operator ids do not match stored validators" |
| VX-062 | no | none | — | No test for idempotent bulk exit (second call with same validators) |
| VX-063 | no | none | — | No test for EB deviation underflow on bulk remove with removed operator (the critical bug scenario) |
| VX-064 | no | none | — | No test for remove from cluster where ALL operators removed |
| VX-065 | no | none | — | No test for SSV remove with removed operator skipping validatorCount decrement |
| VX-066 | yes | none | unit/SSVValidator/removeValidator.test.ts | "Removes validator from SSV cluster with non-zero fees and verifies balance deduction" — exact SSV fee math |
| VX-067 | no | none | — | No test for SSV bulk remove all to zero |
| VX-068 | yes | none | unit/SSVValidator/bulkExitValidator.test.ts | Same as VX-061 — wrong operatorIds revert |
| VX-069 | no | none | — | No test for liquidated cluster partial removal with explicit EB |
