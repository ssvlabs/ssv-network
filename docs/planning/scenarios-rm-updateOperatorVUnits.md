# Removed-Operator × `_updateOperatorVUnits` Scenarios (RM1-001 — RM1-025)

**Worker:** W3-RM1
**Scope:** `_updateOperatorVUnits` (SSVClusters.sol:494-510) interaction with removed operators — resurrection of deleted `operatorEthVUnits` slots, uint64 underflow on subtraction, ghost deviation accumulation, and `daoTotalEthVUnits` correctness.

**Bug context:** `mockRemoveOperator()` (SSVClustersHarness.sol:169-181) does NOT `delete seb.operatorEthVUnits[operatorId]` like the real `removeOperator()` (SSVOperators.sol:93). The guard pattern `if (s.operators[operatorId].ethSnapshot.block == 0) continue;` (SSVClustersHarness.sol:230) prevents earnings accumulation on removed operators, but `_updateOperatorVUnits` (SSVClusters.sol:505-509) has NO such guard — it blindly iterates all `operatorIds` in the cluster array, writing `deltaAbs` to every slot including removed operators.

**Root cause:** `_updateOperatorVUnits` at line 505-509 iterates the full `operatorIds` array without checking whether each operator is still alive (`ethSnapshot.block != 0`). After `removeOperator()` deletes `seb.operatorEthVUnits[operatorId]` (line 93) and zeros `ethSnapshot.block` (line 348), a subsequent `updateClusterBalance` call reaches `_updateOperatorVUnits` which:
1. **EB increase (deltaPositive=true):** writes `deltaAbs` to a deleted slot → **resurrection** (slot goes from 0 to deltaAbs)
2. **EB decrease (deltaPositive=false):** subtracts `deltaAbs` from a deleted slot (value 0) → **uint64 underflow revert**

**Safe guard pattern:** `if (s.operators[operatorId].ethSnapshot.block == 0) continue;` — already used in `updateClusterOperators` (OperatorLib.sol:291) and `updateClusterOperatorsOnReactivation` (OperatorLib.sol:291), but MISSING from `_updateOperatorVUnits`.

**Source files:**
- `contracts/modules/SSVClusters.sol` — `_updateOperatorVUnits` (494-510), `_updateClusterBalanceInternal` (368-417), `updateClusterBalance` (348-366)
- `contracts/modules/SSVOperators.sol` — `removeOperator` (71-104), `_resetOperatorState` (347-358)
- `contracts/libraries/OperatorLib.sol` — `updateClusterOperators` (guard at 291), `updateClusterOperatorsOnReactivation` (guard at 291)
- `contracts/libraries/ProtocolLib.sol` — `updateDAOEthVUnits` (142-150), `daoTotalEthVUnits` (SSVStorageProtocol.sol:58)
- `contracts/libraries/storage/SSVStorageEB.sol` — `operatorEthVUnits` mapping
- `contracts/test/harness/SSVClustersHarness.sol` — `mockRemoveOperator` (169-181, MISSING `delete seb.operatorEthVUnits`)

---

## Tag Legend

| Tag Key | Values | Meaning |
|---------|--------|---------|
| `entry` | functionName | Solidity entry point under test |
| `version` | eth / ssv / both / na | Cluster version context |
| `eb` | implicit / explicit | EB mode (implicit = default 32 ETH, explicit = oracle-committed) |
| `cluster` | active / liquidated | Cluster state |
| `ops` | 4 / 7 / 10 / 13 | Operator count in cluster |
| `remove_mode` | real / mock_zero | How operator was removed (real = SSVOperators.removeOperator with delete, mock_zero = harness without delete) |
| `delta` | increase / decrease / zero | EB change direction (maps to deltaPositive in _updateOperatorVUnits) |
| `guard` | present / missing | Whether ethSnapshot.block==0 guard is applied |
| `revert` | yes / no | Whether scenario expects a revert |

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| RM1-001 | Cluster(4 ops) → explicit EB → removeOperator(op1) → updateClusterBalance (EB increase) | With guard: skip removed op1 on EB increase, no resurrection of `operatorEthVUnits[op1]`. Live ops get +deltaAbs each. | `entry:updateClusterBalance,_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:increase; guard:present; revert:no` | No | SSVClusters.sol:494-510, SSVOperators.sol:91-93 |
| RM1-002 | Cluster(4 ops) → explicit EB → removeOperator(op1) → updateClusterBalance (EB decrease) | With guard: skip removed op1 on EB decrease, no uint64 underflow. Live ops get -deltaAbs each. | `entry:updateClusterBalance,_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:decrease; guard:present; revert:no` | No | SSVClusters.sol:494-510, SSVOperators.sol:91-93 |
| RM1-003 | Cluster(7 ops) → explicit EB → removeOperator(op1) → updateClusterBalance (EB increase) | 7-op variant: skip removed op1 on EB increase. 6 live ops get +deltaAbs, op1 stays at 0. | `entry:updateClusterBalance,_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:7; remove_mode:real; delta:increase; guard:present; revert:no` | No | SSVClusters.sol:494-510, SSVOperators.sol:91-93 |
| RM1-004 | Cluster(7 ops) → explicit EB → removeOperator(op1) → updateClusterBalance (EB decrease) | 7-op variant: skip removed op1 on EB decrease. 6 live ops get -deltaAbs, no underflow on op1. | `entry:updateClusterBalance,_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:7; remove_mode:real; delta:decrease; guard:present; revert:no` | No | SSVClusters.sol:494-510, SSVOperators.sol:91-93 |
| RM1-005 | Cluster(10 ops) → explicit EB → removeOperator(op1) → updateClusterBalance (EB increase) | 10-op variant: skip removed op1 on EB increase. 9 live ops get +deltaAbs, op1 stays at 0. | `entry:updateClusterBalance,_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:10; remove_mode:real; delta:increase; guard:present; revert:no` | No | SSVClusters.sol:494-510, SSVOperators.sol:91-93 |
| RM1-006 | Cluster(10 ops) → explicit EB → removeOperator(op1) → updateClusterBalance (EB decrease) | 10-op variant: skip removed op1 on EB decrease. 9 live ops get -deltaAbs, no underflow on op1. | `entry:updateClusterBalance,_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:10; remove_mode:real; delta:decrease; guard:present; revert:no` | No | SSVClusters.sol:494-510, SSVOperators.sol:91-93 |
| RM1-007 | Cluster(13 ops) → explicit EB → removeOperator(op1) → updateClusterBalance (EB increase) | 13-op variant: skip removed op1 on EB increase. 12 live ops get +deltaAbs, op1 stays at 0. | `entry:updateClusterBalance,_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:13; remove_mode:real; delta:increase; guard:present; revert:no` | No | SSVClusters.sol:494-510, SSVOperators.sol:91-93 |
| RM1-008 | Cluster(13 ops) → explicit EB → removeOperator(op1) → updateClusterBalance (EB decrease) | 13-op variant: skip removed op1 on EB decrease. 12 live ops get -deltaAbs, no underflow on op1. | `entry:updateClusterBalance,_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:13; remove_mode:real; delta:decrease; guard:present; revert:no` | No | SSVClusters.sol:494-510, SSVOperators.sol:91-93 |
| RM1-009 | Remove op1 → EB increase → verify per-operator deviation only on live ops | After EB increase with guard: for each operatorId, assert `operatorEthVUnits[op1] == 0` and `operatorEthVUnits[opN] == previousDeviation + deltaAbs` for live ops. | `entry:_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:increase; guard:present; revert:no` | No | SSVClusters.sol:505-509, SSVStorageEB.sol |
| RM1-010 | Remove op1 → EB decrease → verify per-operator deviation only on live ops | After EB decrease with guard: for each operatorId, assert `operatorEthVUnits[op1] == 0` and `operatorEthVUnits[opN] == previousDeviation - deltaAbs` for live ops. | `entry:_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:decrease; guard:present; revert:no` | No | SSVClusters.sol:505-509, SSVStorageEB.sol |
| RM1-011 | Remove op1 → EB update → verify `daoTotalEthVUnits` correct (excludes removed op) | `updateDAOEthVUnits(storedVUnits, newVUnits)` adjusts DAO total by cluster-level delta. Verify DAO total reflects only live operators' contribution. Removed op1's slot stays 0 but DAO total still gets the full cluster delta — verify this is correct because DAO tracks cluster-level, not per-op. | `entry:updateClusterBalance,updateDAOEthVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:increase; guard:present; revert:no` | No | SSVClusters.sol:401-402, ProtocolLib.sol:142-150, SSVStorageProtocol.sol:58 |
| RM1-012 | Remove op1 → EB decrease → verify `daoTotalEthVUnits` correct | Same as RM1-011 but with EB decrease. Verify `daoTotalEthVUnits` decreases by `oldVUnits - newVUnits` regardless of removed operator. | `entry:updateClusterBalance,updateDAOEthVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:decrease; guard:present; revert:no` | No | SSVClusters.sol:401-402, ProtocolLib.sol:142-150 |
| RM1-013 | After EB update with removed op: cluster deposit succeeds | Post-EB-update with removed op: call `deposit()` on the cluster. Verify cluster hash is valid, deposit adds to balance, no revert. Cluster remains functional. | `entry:updateClusterBalance,deposit; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:increase; guard:present; revert:no` | No | SSVClusters.sol:494-510, SSVClusters.sol (deposit) |
| RM1-014 | After EB update with removed op: cluster withdraw succeeds | Post-EB-update with removed op: call `withdraw()` on the cluster. Verify withdrawal works, balance decreases, no revert from stale operator state. | `entry:updateClusterBalance,withdraw; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:decrease; guard:present; revert:no` | No | SSVClusters.sol:494-510, SSVClusters.sol (withdraw) |
| RM1-015 | Remove op BEFORE any EB update → first explicit EB update → guard skips removed op | Operator removed while cluster still has implicit (default) vUnits. First `updateClusterBalance` sets explicit EB. Guard must skip removed op on the very first deviation write. | `entry:updateClusterBalance,_updateOperatorVUnits; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; delta:increase; guard:present; revert:no` | No | SSVClusters.sol:389-391, 400-401, 494-510 |
| RM1-016 | Remove op1 → EB update → remove op2 → EB update again (chained removal) | Two sequential removals with EB updates between: remove op1 → EB increase (skip op1) → remove op2 → EB decrease (skip op1 AND op2). Only ops 3,4 get deviation. | `entry:updateClusterBalance,_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:increase; guard:present; revert:no` | No | SSVClusters.sol:494-510, SSVOperators.sol:71-104 |
| RM1-017 | Remove op1 → EB increase → EB decrease → verify no accumulated ghost deviation | Two-step EB change after removal: increase then decrease back to original. Verify `operatorEthVUnits[op1] == 0` after both operations — no ghost accumulation from increase that wasn't cleaned on decrease. | `entry:_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:increase; guard:present; revert:no` | No | SSVClusters.sol:505-509 |
| RM1-018 | WITHOUT guard: EB increase after removeOperator → resurrection of deleted slot | **Bug reproduction:** Without guard, `_updateOperatorVUnits` writes `+deltaAbs` to `operatorEthVUnits[removedOp]` (slot was 0 after delete). Slot resurrects to `deltaAbs`. Assert `operatorEthVUnits[removedOp] != 0` — proves the bug. | `entry:_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:increase; guard:missing; revert:no` | No | SSVClusters.sol:507 |
| RM1-019 | WITHOUT guard: EB decrease after removeOperator → uint64 underflow revert | **Bug reproduction:** Without guard, `_updateOperatorVUnits` subtracts `deltaAbs` from `operatorEthVUnits[removedOp]` (slot is 0 after delete). `0 - deltaAbs` underflows uint64. Transaction reverts with arithmetic panic. | `entry:_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:decrease; guard:missing; revert:yes` | No | SSVClusters.sol:508 |
| RM1-020 | WITHOUT guard: chained EB increase → EB decrease on resurrected slot → no revert but corrupted state | After resurrection (RM1-018), a subsequent EB decrease subtracts from the resurrected value. If `deltaAbs_decrease <= deltaAbs_increase`, no revert but `operatorEthVUnits[removedOp]` is non-zero garbage. Corrupted operator earnings. | `entry:_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:decrease; guard:missing; revert:no` | No | SSVClusters.sol:507-508 |
| RM1-021 | mockRemoveOperator (no delete) → EB increase → stale operatorEthVUnits polluted | **Harness bug reproduction:** `mockRemoveOperator` zeros operator state but does NOT `delete seb.operatorEthVUnits[operatorId]`. Pre-existing deviation persists. EB increase adds to stale value. Assert mismatch vs real removeOperator behavior. | `entry:_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:mock_zero; delta:increase; guard:missing; revert:no` | No | SSVClustersHarness.sol:169-181, SSVClusters.sol:507 |
| RM1-022 | mockRemoveOperator (no delete) → EB decrease → subtracts from stale value instead of underflow | **Harness bug reproduction:** With `mockRemoveOperator`, `operatorEthVUnits[removedOp]` retains its pre-removal value. EB decrease subtracts from stale value — succeeds but yields wrong result. With real `removeOperator` (slot=0) this would underflow. | `entry:_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:mock_zero; delta:decrease; guard:missing; revert:no` | No | SSVClustersHarness.sol:169-181, SSVClusters.sol:508 |
| RM1-023 | Multiple clusters share op1 → remove op1 → EB update on cluster A → verify cluster B unaffected | Operator shared between two clusters. Remove op1. EB update on cluster A skips op1 (guard). Verify `operatorEthVUnits[op1]` remains 0, cluster B's subsequent EB update also skips op1. No cross-cluster contamination. | `entry:updateClusterBalance,_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:increase; guard:present; revert:no` | No | SSVClusters.sol:494-510, SSVOperators.sol:93 |
| RM1-024 | Remove all 4 ops → EB update → all ops skipped, no state written | Edge case: all operators in the cluster are removed. `_updateOperatorVUnits` guard skips every operator. No `operatorEthVUnits` written. `daoTotalEthVUnits` still updated at cluster level. | `entry:updateClusterBalance,_updateOperatorVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:increase; guard:present; revert:no` | No | SSVClusters.sol:494-510 |
| RM1-025 | EB update where newVUnits == storedVUnits → `_updateOperatorVUnits` not called → removed op irrelevant | Baseline: when EB doesn't change, the `if (cluster.active && newVUnits != storedVUnits)` guard at line 400 prevents `_updateOperatorVUnits` from being called at all. Removed operator is a non-issue. | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; delta:zero; guard:present; revert:no` | No | SSVClusters.sol:400-403 |

---

## Detailed Scenario Blocks (8 Most Complex)

---

### RM1-001: Cluster(4 ops) — EB Increase After removeOperator(op1) — Guard Skips Removed Op

**Purpose:** Validate that after `removeOperator(op1)` deletes `seb.operatorEthVUnits[op1]` and zeros `ethSnapshot.block`, the guarded `_updateOperatorVUnits` skips op1 on EB increase. No resurrection of the deleted slot.

**Preconditions:**
- 4 operators registered (op1=ID 1, op2=ID 2, op3=ID 3, op4=ID 4), each with `ethFee > 0`
- Cluster registered with all 4 operators, `validatorCount = 1`, `active = true`, version = ETH
- Initial explicit EB committed: `effectiveBalance = 32` → `storedVUnits = ebToVUnits(32) = ceil((32 * 10000) / 32) = 10000`
- Each operator's `operatorEthVUnits[opN]` = 0 (no deviation from baseline at this point)
- `daoTotalEthVUnits` = `validatorCount * BPS_DENOMINATOR` = 10000

**Steps:**
1. Owner of op1 calls `removeOperator(1)` (SSVOperators.sol:71)
   - `_resetOperatorState(operator)` zeros: `ethSnapshot.block = 0`, `ethSnapshot.balance = 0`, `ethFee = 0`, `ethValidatorCount = 0` (SSVOperators.sol:347-358)
   - `delete seb.operatorEthVUnits[1]` → slot becomes 0 (SSVOperators.sol:93)
2. Oracle commits new root with `effectiveBalance = 40` for the cluster
   - `newVUnits = ebToVUnits(40) = ceil((40 * 10000) / 32) = 12500`
   - `storedVUnits = 10000` (from clusterEB snapshot)
3. Anyone calls `updateClusterBalance(blockNum, clusterOwner, [1,2,3,4], cluster, 40, proof)`
   - `_updateClusterBalanceInternal` reached (SSVClusters.sol:368)
   - `newVUnits (12500) != storedVUnits (10000)` → enters `_updateOperatorVUnits` (SSVClusters.sol:400-401)
   - **Inside `_updateOperatorVUnits` (SSVClusters.sol:494-510):**
     - `deltaPositive = true`, `deltaAbs = 12500 - 10000 = 2500`
     - Loop iteration i=0: `operatorId = 1`
       - **Guard check:** `s.operators[1].ethSnapshot.block == 0` → `continue` (SKIP)
     - Loop iteration i=1: `operatorId = 2` → `seb.operatorEthVUnits[2] += 2500`
     - Loop iteration i=2: `operatorId = 3` → `seb.operatorEthVUnits[3] += 2500`
     - Loop iteration i=3: `operatorId = 4` → `seb.operatorEthVUnits[4] += 2500`
   - `sp.updateDAOEthVUnits(10000, 12500)` → `daoTotalEthVUnits += 2500` (SSVClusters.sol:402)
   - `_updateEBSnapshot` stores `vUnits = 12500` (SSVClusters.sol:404)

**Postconditions:**
- `seb.operatorEthVUnits[1] == 0` — NOT resurrected
- `seb.operatorEthVUnits[2] == 2500`
- `seb.operatorEthVUnits[3] == 2500`
- `seb.operatorEthVUnits[4] == 2500`
- `daoTotalEthVUnits == 12500` (10000 + 2500)
- `clusterEB[clusterId].vUnits == 12500`
- Cluster hash updated, cluster remains active

**File References:** SSVClusters.sol:400-401, 494-510; SSVOperators.sol:71-104, 347-358; ProtocolLib.sol:142-150

---

### RM1-002: Cluster(4 ops) — EB Decrease After removeOperator(op1) — Guard Prevents Underflow

**Purpose:** Validate that the guard prevents uint64 underflow when `_updateOperatorVUnits` attempts to subtract `deltaAbs` from a deleted (zero) `operatorEthVUnits` slot.

**Preconditions:**
- Same as RM1-001, but with an initial explicit EB of 40 (`storedVUnits = 12500`)
- Prior EB update applied deviation: `operatorEthVUnits[op1] = 2500`, `operatorEthVUnits[op2..4] = 2500` each
- Op1 removed: `operatorEthVUnits[1]` deleted → 0, `ethSnapshot.block = 0`

**Steps:**
1. Oracle commits new root with `effectiveBalance = 32` → `newVUnits = 10000`
2. `updateClusterBalance(blockNum, clusterOwner, [1,2,3,4], cluster, 32, proof)`
   - `storedVUnits = 12500`, `newVUnits = 10000`
   - `deltaPositive = false`, `deltaAbs = 12500 - 10000 = 2500`
   - Loop i=0: `operatorId = 1`, `ethSnapshot.block == 0` → `continue` (SKIP)
     - **Without guard:** `seb.operatorEthVUnits[1] -= 2500` → `0 - 2500` → **uint64 underflow panic**
   - Loop i=1: `operatorId = 2` → `seb.operatorEthVUnits[2] = 2500 - 2500 = 0`
   - Loop i=2: `operatorId = 3` → `seb.operatorEthVUnits[3] = 2500 - 2500 = 0`
   - Loop i=3: `operatorId = 4` → `seb.operatorEthVUnits[4] = 2500 - 2500 = 0`
   - `sp.updateDAOEthVUnits(12500, 10000)` → `daoTotalEthVUnits -= 2500`

**Postconditions:**
- `seb.operatorEthVUnits[1] == 0` — stays zero, no underflow
- `seb.operatorEthVUnits[2] == 0`, `operatorEthVUnits[3] == 0`, `operatorEthVUnits[4] == 0`
- `daoTotalEthVUnits == 10000`
- Transaction succeeds (no arithmetic panic)

**File References:** SSVClusters.sol:494-510 (line 508 specifically); SSVOperators.sol:93

---

### RM1-016: Chained Removal — Remove op1 → EB Update → Remove op2 → EB Update Again

**Purpose:** Verify that multiple sequential operator removals with interleaved EB updates correctly narrow the set of operators receiving deviation writes, and that all removed operators' `operatorEthVUnits` remain zero throughout.

**Preconditions:**
- 4 operators (op1-op4), cluster with `validatorCount = 1`, version = ETH
- Initial storedVUnits = 10000 (default 32 ETH EB)
- All `operatorEthVUnits` = 0

**Steps:**
1. `removeOperator(1)` → `delete seb.operatorEthVUnits[1]`, `ethSnapshot.block = 0`
2. Oracle commits EB = 40, `updateClusterBalance` called
   - `newVUnits = 12500`, `deltaAbs = 2500`, `deltaPositive = true`
   - Loop: op1 SKIP (guard), op2 += 2500, op3 += 2500, op4 += 2500
   - **Checkpoint A:** `operatorEthVUnits = [0, 2500, 2500, 2500]`
3. `removeOperator(2)`
   - settles op2 earnings (using `operatorEthVUnits[2] = 2500` for earnings calc)
   - `_resetOperatorState`: `ethSnapshot.block = 0`
   - `delete seb.operatorEthVUnits[2]` → slot = 0
4. Oracle commits EB = 36, `updateClusterBalance` called
   - `storedVUnits = 12500`, `newVUnits = ebToVUnits(36) = ceil((36 * 10000) / 32) = 11250`
   - `deltaPositive = false`, `deltaAbs = 12500 - 11250 = 1250`
   - Loop: op1 SKIP (guard), op2 SKIP (guard), op3 -= 1250 → 1250, op4 -= 1250 → 1250
   - `sp.updateDAOEthVUnits(12500, 11250)` → `daoTotalEthVUnits -= 1250`

**Postconditions:**
- `seb.operatorEthVUnits[1] == 0` — removed in step 1, never written to again
- `seb.operatorEthVUnits[2] == 0` — removed in step 3, never written to again
- `seb.operatorEthVUnits[3] == 1250`
- `seb.operatorEthVUnits[4] == 1250`
- No reverts, no resurrection, no underflow
- Only 2 live operators received deviation adjustments in step 4

**File References:** SSVClusters.sol:494-510; SSVOperators.sol:71-104; ProtocolLib.sol:142-150

---

### RM1-017: Remove op1 → EB Increase → EB Decrease → No Ghost Deviation

**Purpose:** Verify that a removed operator's slot does not accumulate "ghost deviation" across multiple EB changes. After increase+decrease back to original, `operatorEthVUnits[removedOp]` must remain exactly 0.

**Preconditions:**
- 4 operators, cluster active, `storedVUnits = 10000`
- op1 removed: `operatorEthVUnits[1]` deleted, `ethSnapshot.block = 0`

**Steps:**
1. EB increase: `effectiveBalance = 40` → `newVUnits = 12500`
   - `deltaAbs = 2500`, `deltaPositive = true`
   - Guard skips op1 → op2,3,4 each += 2500
   - `storedVUnits` updated to 12500 in EB snapshot
   - **Assert:** `operatorEthVUnits[1] == 0`
2. EB decrease: `effectiveBalance = 32` → `newVUnits = 10000`
   - `deltaAbs = 2500`, `deltaPositive = false`
   - Guard skips op1 → op2,3,4 each -= 2500 (back to 0)
   - **Assert:** `operatorEthVUnits[1] == 0`

**Key insight:** Without the guard, step 1 would resurrect `operatorEthVUnits[1]` to 2500. Step 2 would then subtract 2500, returning it to 0 — appearing correct but having corrupted earnings calculations between steps 1 and 2 (any `updateClusterOperators` call between steps would use the resurrected deviation for earnings, paying the removed operator's slot).

**Postconditions:**
- `seb.operatorEthVUnits[1] == 0` after both operations — truly zero, not "returned to zero"
- `seb.operatorEthVUnits[2] == 0`, `[3] == 0`, `[4] == 0`
- No earnings calculated for op1 between the two EB updates

**File References:** SSVClusters.sol:505-509; OperatorLib.sol:291-309 (earnings calc using operatorEthVUnits)

---

### RM1-018: BUG REPRODUCTION — No Guard → EB Increase Resurrects Deleted Slot

**Purpose:** Reproduce the resurrection bug. Without the `ethSnapshot.block == 0` guard, `_updateOperatorVUnits` writes `+deltaAbs` to a deleted `operatorEthVUnits` slot, bringing it back from the dead.

**Preconditions:**
- 4 operators, cluster active, `storedVUnits = 10000`
- op1 removed via real `removeOperator`: `delete seb.operatorEthVUnits[1]` (slot = 0), `ethSnapshot.block = 0`
- `_updateOperatorVUnits` at SSVClusters.sol:494-510 **without** the guard (original unpatched code)

**Steps:**
1. Oracle commits EB = 40, `updateClusterBalance` called
   - `newVUnits = 12500`, `storedVUnits = 10000`
   - `deltaPositive = true`, `deltaAbs = 2500`
   - **Unguarded loop at line 505-509:**
     - i=0: `operatorId = 1` → `seb.operatorEthVUnits[1] += 2500` → **slot goes from 0 to 2500**
     - i=1-3: ops 2,3,4 each += 2500

**Bug impact:**
- `operatorEthVUnits[1] == 2500` — **RESURRECTED**. The slot that `removeOperator` explicitly deleted is now non-zero.
- Next `updateClusterOperators` call (e.g., during validator registration or another EB update) will read this value at OperatorLib.sol:299: `uint64 storedDeviation = seb.operatorEthVUnits[operatorId]`. But `operator.ethSnapshot.block == 0` → the guard at OperatorLib.sol:291 skips earnings accrual for op1. The deviation exists in storage but is unused — a storage leak.
- If op1's ID is ever re-registered to a new operator, it inherits the stale 2500 deviation — **cross-operator contamination**.

**Postconditions (demonstrating the bug):**
- `seb.operatorEthVUnits[1] == 2500` (should be 0)
- `seb.operatorEthVUnits[2] == 2500` (correct)
- Storage pollution: 2500 deviation sitting in a dead operator's slot

**File References:** SSVClusters.sol:505-509 (line 507: the write that resurrects); SSVOperators.sol:93 (the delete that is undone)

---

### RM1-019: BUG REPRODUCTION — No Guard → EB Decrease After removeOperator → Underflow Revert

**Purpose:** Reproduce the underflow bug. Without the guard, subtracting `deltaAbs` from a deleted (zero) `operatorEthVUnits` slot causes a uint64 arithmetic underflow, reverting the entire `updateClusterBalance` transaction.

**Preconditions:**
- 4 operators, cluster active, `storedVUnits = 12500` (EB was 40)
- op1 removed via real `removeOperator`: `delete seb.operatorEthVUnits[1]` (slot = 0)
- `_updateOperatorVUnits` **without** the guard

**Steps:**
1. Oracle commits EB = 32, `updateClusterBalance` called
   - `newVUnits = 10000`, `storedVUnits = 12500`
   - `deltaPositive = false`, `deltaAbs = 2500`
   - **Unguarded loop at line 505-509:**
     - i=0: `operatorId = 1` → `seb.operatorEthVUnits[1] -= 2500` → **0 - 2500 = UNDERFLOW**
     - Solidity 0.8.24 checked arithmetic → **revert with Panic(0x11)**

**Bug impact:**
- The entire `updateClusterBalance` transaction reverts. The cluster cannot process ANY EB update, even though the EB change is valid for the 3 live operators.
- The cluster is effectively **stuck** — no further EB updates can be applied until the removed operator's ID is somehow resolved.
- This blocks the EB oracle pipeline for this cluster indefinitely.

**Postconditions:**
- Transaction reverted — no state changes
- Cluster's EB snapshot remains stale at 12500
- All 3 live operators miss their deviation update
- `daoTotalEthVUnits` not adjusted — protocol-level accounting frozen for this cluster

**File References:** SSVClusters.sol:508 (the subtraction that underflows); Solidity 0.8.24 checked arithmetic

---

### RM1-023: Shared Operator Across Clusters — Remove → EB Update on Cluster A → Verify Cluster B Isolation

**Purpose:** When an operator belongs to multiple clusters and is removed, verify that EB updates on one cluster do not contaminate the shared operator's slot, which would affect the other cluster's accounting.

**Preconditions:**
- op1 (ID 1) belongs to both Cluster A (ops [1,2,3,4]) and Cluster B (ops [1,5,6,7])
- Both clusters have `storedVUnits = 10000` (EB = 32)
- `operatorEthVUnits[1] = 0` initially
- op1 removed: `delete seb.operatorEthVUnits[1]`, `ethSnapshot.block = 0`

**Steps:**
1. Oracle commits EB = 40 for Cluster A
2. `updateClusterBalance` on Cluster A with `operatorIds = [1,2,3,4]`
   - Guard skips op1 → ops 2,3,4 each += 2500
   - **Assert:** `operatorEthVUnits[1] == 0`
3. Oracle commits EB = 48 for Cluster B
4. `updateClusterBalance` on Cluster B with `operatorIds = [1,5,6,7]`
   - Guard skips op1 → ops 5,6,7 each += `deltaAbs`
   - **Assert:** `operatorEthVUnits[1] == 0` — still zero after both cluster updates

**Key insight:** Without the guard, Cluster A's EB update would write `+2500` to `operatorEthVUnits[1]`. Then Cluster B's EB update would add its own delta on top, compounding the corruption. The `operatorEthVUnits` mapping is per-operator (not per-cluster), so cross-cluster contamination through a shared removed operator is a real risk.

**Postconditions:**
- `seb.operatorEthVUnits[1] == 0` — untouched by either cluster's EB update
- Cluster A and Cluster B each have correct deviation on their live operators
- No cross-cluster leakage through the shared operator

**File References:** SSVClusters.sol:494-510; SSVStorageEB.sol (operatorEthVUnits is a flat mapping, not cluster-scoped)

---

### RM1-015: Remove Op Before Any Explicit EB → First EB Update → Guard Skips on Initial Deviation Write

**Purpose:** Edge case where the operator is removed while the cluster still has implicit (default) vUnits — no explicit EB has ever been committed. The first `updateClusterBalance` call creates the initial deviation. The guard must work even when there's no prior deviation history.

**Preconditions:**
- 4 operators, cluster registered with `validatorCount = 1`, version = ETH
- No explicit EB committed yet → `clusterEB[clusterId].vUnits = 0`
- Fallback at SSVClusters.sol:390-392: `if (storedVUnits == 0) storedVUnits = validatorCount * BPS_DENOMINATOR = 10000`
- `operatorEthVUnits` = 0 for all operators (no deviation ever written)
- op1 removed: `ethSnapshot.block = 0`, `delete seb.operatorEthVUnits[1]` (already 0, delete is no-op)

**Steps:**
1. Oracle commits EB = 40, `updateClusterBalance` called
   - `storedVUnits = 0` → fallback to `1 * 10000 = 10000`
   - `newVUnits = 12500`
   - `deltaPositive = true`, `deltaAbs = 2500`
   - Guard: op1 has `ethSnapshot.block == 0` → SKIP
   - ops 2,3,4 each get `operatorEthVUnits[opN] = 0 + 2500 = 2500`

**Key subtlety:** This is the first time `operatorEthVUnits` is written for these operators. The guard must correctly distinguish between "operator never had deviation written" (ops 2,3,4: `ethSnapshot.block != 0`, deviation = 0 is fine to write to) and "operator was removed" (op1: `ethSnapshot.block == 0`, must skip). Both have `operatorEthVUnits == 0` but require different handling.

**Postconditions:**
- `seb.operatorEthVUnits[1] == 0` — correctly skipped despite being indistinguishable from "never written" by value alone
- `seb.operatorEthVUnits[2] == 2500`, `[3] == 2500`, `[4] == 2500`
- `clusterEB[clusterId].vUnits == 12500` (first explicit EB recorded)

**File References:** SSVClusters.sol:389-392 (storedVUnits fallback), 400-401, 494-510; SSVOperators.sol:347-348

---

## Coverage Matrix

| Dimension | Values Covered | Scenarios |
|-----------|---------------|-----------|
| **Operator count** | 4, 7, 10, 13 | RM1-001/002 (4), RM1-003/004 (7), RM1-005/006 (10), RM1-007/008 (13) |
| **Delta direction** | increase, decrease, zero | increase: RM1-001,003,005,007,009,015,016,017,018; decrease: RM1-002,004,006,008,010,016,017,019,020; zero: RM1-025 |
| **Guard present vs missing** | present, missing | present: RM1-001 through RM1-017, RM1-023-025; missing: RM1-018,019,020,021,022 |
| **Remove mode** | real, mock_zero | real: RM1-001 through RM1-020, RM1-023-025; mock_zero: RM1-021,022 |
| **Single vs chained removal** | single, chained | single: RM1-001 through RM1-015, RM1-017-025; chained: RM1-016 |
| **Per-operator vs DAO-level accounting** | per-op deviation, daoTotalEthVUnits | per-op: RM1-009,010; DAO: RM1-011,012 |
| **Cluster functionality post-update** | deposit, withdraw | RM1-013 (deposit), RM1-014 (withdraw) |
| **First EB vs subsequent EB** | first explicit, subsequent | first: RM1-015; subsequent: all others |
| **Cross-cluster operator** | shared operator removed | RM1-023 |
| **All operators removed** | edge case | RM1-024 |
| **Bug reproduction** | resurrection, underflow, harness mismatch | resurrection: RM1-018,020; underflow: RM1-019; harness: RM1-021,022 |

---

## Invariants (Must Hold Across ALL Scenarios)

1. **`operatorEthVUnits[removedOp] == 0` after every operation** — the single most important assertion. Must be checked after every `updateClusterBalance`, `deposit`, `withdraw`, and any operation that touches the cluster.

2. **No uint64 underflow on subtraction** — `_updateOperatorVUnits` must never subtract from a zero slot. The guard `ethSnapshot.block == 0 → continue` prevents this.

3. **`daoTotalEthVUnits` tracks cluster-level delta, not per-operator sum** — `updateDAOEthVUnits(storedVUnits, newVUnits)` uses cluster-level vUnits. The DAO total is correct regardless of how many operators are removed, because it operates on the aggregate.

4. **No cross-operator contamination** — a removed operator's ID, if re-registered, must start with `operatorEthVUnits == 0`. The `delete` in `removeOperator` (SSVOperators.sol:93) ensures this.

5. **Earnings guard consistency** — `_updateOperatorVUnits` guard (`ethSnapshot.block == 0`) must use the same signal as the earnings guard in `updateClusterOperators` (OperatorLib.sol:291) and `updateClusterOperatorsOnReactivation` (OperatorLib.sol:291).

---

## Summary

This scenario file covers the interaction between `_updateOperatorVUnits` (SSVClusters.sol:494-510) and removed operators. The core bug is that the function iterates the full `operatorIds` array without checking operator liveness, leading to two failure modes:

1. **Resurrection (EB increase):** `+= deltaAbs` on a deleted slot brings `operatorEthVUnits[removedOp]` back from 0 to `deltaAbs` (RM1-018)
2. **Underflow (EB decrease):** `-= deltaAbs` on a deleted slot (value 0) causes Solidity 0.8 checked arithmetic panic (RM1-019)

The fix is a one-line guard: `if (s.operators[operatorId].ethSnapshot.block == 0) continue;` at SSVClusters.sol:506, matching the pattern already used in `updateClusterOperators` (OperatorLib.sol:291) and `updateClusterOperatorsOnReactivation` (OperatorLib.sol:291).

25 scenarios across 4 operator counts (4/7/10/13), 3 delta directions (increase/decrease/zero), 2 guard states (present/missing), 2 remove modes (real/mock), and edge cases (chained removal, first-ever EB, shared operators, all-ops-removed). 5 scenarios reproduce the bugs. All scenarios assert `operatorEthVUnits[removedOp] == 0` as the primary invariant.

---

## ask-codex Review Findings

### Clarifications

1. **Guard pattern description precision:** The existing guard in libraries uses a positive check `ethSnapshot.block != 0` (not a literal `continue` statement). The removed operator's stored `ethSnapshot.index` is preserved at 0 by `_resetOperatorState`. Scenarios correctly describe the *absence* of this guard in `_updateOperatorVUnits` — the fix should match the positive-check pattern already used in `updateClusterOperators` (OperatorLib.sol:247) and `updateClusterOperatorsOnReactivation` (OperatorLib.sol:291).

No impossible or unreachable scenarios found. Code references verified accurate.

---

## Coverage Verification (W4)

**Verified:** 2026-03-24
**Method:** Cross-referenced all test files in `test/` for `mockRemoveOperator`, `mockRemoveOperatorAndPayout`, and real `removeOperator()` calls combined with `updateClusterBalance` / `_updateOperatorVUnits` paths.

**Critical finding:** No test in the entire codebase combines a removed operator (real or mock) with an explicit EB update via `updateClusterBalance`. The `_updateOperatorVUnits` function is never tested with a removed operator in any existing test. All 25 RM1 scenarios are untested.

**Mock analysis:**
- `SSVClustersHarness.sol:mockRemoveOperator` (lines 169-181): Zeros operator state but does NOT `delete seb.operatorEthVUnits[operatorId]`. Missing the critical line present in real `removeOperator()` at SSVOperators.sol:93.
- `SSVValidatorsHarness.sol:mockRemoveOperator` (lines 244-256): Same deficiency.
- `SSVClustersHarness.sol:mockRemoveOperatorAndPayout` (lines 185-219): Settles + pays out but also does NOT `delete seb.operatorEthVUnits[operatorId]`.
- Real `removeOperator()` (SSVOperators.sol:93): `delete seb.operatorEthVUnits[operatorId]` — sets slot to 0.

**Closest existing tests (none match RM1 scenarios):**
- `test/unit/SSVClusters/operatorFeeEBInteraction.test.ts` line 252: "Fee change with removed operators" uses `mockRemoveOperator` + EB + withdraw. Tests fee settlement, NOT `_updateOperatorVUnits` deviation. `remove_mode: mock_zero`.
- `test/unit/SSVClusters/removedOperatorImpact.test.ts`: Uses `mockRemoveOperator` + removeValidator/liquidateSSV. No `updateClusterBalance` call. No EB deviation testing.

| ID | Tested | remove_mode | Test File | Notes |
|----|--------|-------------|-----------|-------|
| RM1-001 | no | none | — | No test combines removeOperator + updateClusterBalance (EB increase) |
| RM1-002 | no | none | — | No test combines removeOperator + updateClusterBalance (EB decrease) |
| RM1-003 | no | none | — | 7-op variant, no test exists |
| RM1-004 | no | none | — | 7-op variant, no test exists |
| RM1-005 | no | none | — | 10-op variant, no test exists |
| RM1-006 | no | none | — | 10-op variant, no test exists |
| RM1-007 | no | none | — | 13-op variant, no test exists |
| RM1-008 | no | none | — | 13-op variant, no test exists |
| RM1-009 | no | none | — | Per-operator deviation verification, no test exists |
| RM1-010 | no | none | — | Per-operator deviation verification (decrease), no test exists |
| RM1-011 | no | none | — | daoTotalEthVUnits verification, no test exists |
| RM1-012 | no | none | — | daoTotalEthVUnits verification (decrease), no test exists |
| RM1-013 | no | none | — | Post-EB deposit verification, no test exists |
| RM1-014 | no | none | — | Post-EB withdraw verification, no test exists |
| RM1-015 | no | none | — | First explicit EB with removed op, no test exists |
| RM1-016 | no | none | — | Chained removal + EB updates, no test exists |
| RM1-017 | no | none | — | Ghost deviation verification, no test exists |
| RM1-018 | no | none | — | Bug reproduction (resurrection), no test exists |
| RM1-019 | no | none | — | Bug reproduction (underflow revert), no test exists |
| RM1-020 | no | none | — | Bug reproduction (corrupted state), no test exists |
| RM1-021 | no | mock_zero | — | Harness bug scenario; mockRemoveOperator used in operatorFeeEBInteraction.test.ts but NOT with updateClusterBalance path |
| RM1-022 | no | mock_zero | — | Harness bug scenario; same — no EB decrease test with mock removal |
| RM1-023 | no | none | — | Cross-cluster shared operator, no test exists |
| RM1-024 | no | none | — | All operators removed + EB update, no test exists |
| RM1-025 | no | none | — | Zero-delta EB update (no _updateOperatorVUnits call), no test exists |

**Summary:** 0/25 tested. The `_updateOperatorVUnits` function has zero test coverage for removed-operator interactions. This is the highest-priority gap — the resurrection bug (RM1-018) and underflow bug (RM1-019) are completely undetected by existing tests.
