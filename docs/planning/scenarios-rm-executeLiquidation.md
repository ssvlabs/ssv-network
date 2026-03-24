# Removed Operator x _executeLiquidation Scenarios (RM2-001 to RM2-030)

Scenarios for `_executeLiquidation` deviation cleanup when one or more operators have been removed. Root cause: `_executeLiquidation` iterates ALL operator IDs at lines 586-591 without checking `ethSnapshot.block`, subtracting deviation from `operatorEthVUnits[removedOp]` which was deleted (zeroed) by `removeOperator`. This causes an arithmetic underflow revert.

**Prefix:** RM2
**Worker:** EB Bug Fix
**Source contracts:** `SSVClusters.sol` (`_executeLiquidation` lines 552-612, `_liquidateAfterEBUpdateIfNeeded` lines 519-550), `SSVOperators.sol` (`removeOperator` lines 71-104, `_resetOperatorState` line 347)
**Spec refs:** SPEC 2 "Operator vUnit Deviation Cleanup on Liquidation"

**Bug briefing:**
- `removeOperator()` deletes `operatorEthVUnits[operatorId]` (SSVOperators.sol:93) and zeros `ethSnapshot.block` via `_resetOperatorState` (SSVOperators.sol:347-348).
- `_executeLiquidation` at lines 586-591 iterates all operator IDs and subtracts deviation from `operatorEthVUnits[operatorIds[i]]` unconditionally.
- For a removed operator, `operatorEthVUnits` is 0 (deleted). Subtracting any positive deviation causes underflow revert.
- **Safe guard:** `if (s.operators[operatorIds[i]].ethSnapshot.block == 0) continue;` must be added to the deviation loop.

**Code-grounding rules:**
- Below-baseline deviation is unreachable (32 ETH floor enforced by `_verifyEBLimits`). Deviation is always >= 0.
- `_liquidateAfterEBUpdateIfNeeded` (lines 539-544) already guards `ethValidatorCount` decrement with `if (op.ethSnapshot.block != 0)`.
- The `liquidate()` entry point at lines 31-65 also guards `ethValidatorCount` decrement with the same check.
- `_executeLiquidation` handles DAO deviation (line 578) and operator deviation (lines 586-591) separately. The DAO path is unaffected by removed operators.

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| RM2-001 | removeOp + liquidate | 4-op cluster, explicit EB (48 ETH, deviation>0), remove op1, third-party liquidation — deviation subtracted from live ops only, removed op skipped | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:586-591, SSVOperators.sol:93 |
| RM2-002 | removeOp + liquidate | 4-op cluster, explicit EB at baseline (32 ETH, deviation=0), remove op1, liquidation — clean path, no deviation to subtract | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:573-594 |
| RM2-003 | removeOp + liquidate | 7-op cluster, explicit EB (48 ETH, deviation>0), remove op1, liquidation — deviation subtracted from 6 live ops only | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:7; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:586-591 |
| RM2-004 | removeOp + liquidate | 7-op cluster, explicit EB at baseline (deviation=0), remove op1, liquidation — no deviation cleanup needed | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:7; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:573-594 |
| RM2-005 | removeOp + liquidate | 10-op cluster, explicit EB (64 ETH, deviation>0), remove op1, liquidation — deviation subtracted from 9 live ops | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:10; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:586-591 |
| RM2-006 | removeOp + liquidate | 10-op cluster, explicit EB at baseline (deviation=0), remove op1, liquidation — clean path | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:10; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:573-594 |
| RM2-007 | removeOp + liquidate | 13-op cluster, explicit EB (48 ETH, deviation>0), remove op1, liquidation — deviation subtracted from 12 live ops | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:13; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:586-591 |
| RM2-008 | removeOp + liquidate | 13-op cluster, explicit EB at baseline (deviation=0), remove op1, liquidation — no deviation cleanup | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:13; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:573-594 |
| RM2-009 | removeOp + liquidate | 4-op cluster, explicit EB (48 ETH, deviation>0), remove op1, self-liquidation by owner — deviation cleanup same as third-party | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:52, 586-591 |
| RM2-010 | removeOp + liquidate | 4-op cluster, explicit EB (48 ETH, deviation>0), remove op1, third-party liquidation — verify `operatorEthVUnits[removedOp] == 0` post-liquidation | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:586-591, SSVOperators.sol:93 |
| RM2-011 | removeOp + liquidate | 4-op cluster, explicit EB (48 ETH, deviation>0), remove op1, liquidation — verify `daoTotalEthVUnits` decremented by full deviation (not reduced for removed op) | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:578 |
| RM2-012 | removeOp + liquidate | 4-op cluster, explicit EB (48 ETH, deviation>0), remove op1, liquidation — verify `ethValidatorCount` NOT decremented for removed op (already 0 from removeOperator) | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:541-543, SSVOperators.sol:354 |
| RM2-013 | removeOp + updateEB + liquidate | 4-op cluster, EB update (32->48) included removed op1's deviation, then liquidation — deviation cleanup must skip removed op despite stale write from EB update | `entry:updateClusterBalance,liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:494-510, 586-591 |
| RM2-014 | removeOp + liquidate | 4-op cluster, explicit EB (48 ETH), remove op1, liquidation at exact threshold boundary — balance equals burn-rate threshold (3-op rate), should succeed | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:531-537, ClusterLib.sol:67-84 |
| RM2-015 | removeOp + liquidate | 4-op cluster, implicit EB (vUnitsCluster=0), remove op1, liquidation — no deviation to clean, `_executeLiquidation` skips entire deviation block | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:569, 597 |
| RM2-016 | removeOp + updateEB + drain + liquidate | 4-op cluster, remove op1, then EB update (32->48) writes stale deviation to removed op, balance drains, liquidation — verify no underflow | `entry:removeOperator,updateClusterBalance,liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:494-510, 586-591 |
| RM2-017 | removeOp + liquidate | 4-op cluster, explicit EB (48 ETH, deviation>0), remove op1, liquidation — verify remaining 3 operators' `operatorEthVUnits` each decremented by deviation | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:586-591 |
| RM2-018 | removeOp + liquidate | 4-op cluster, explicit EB high (2048 ETH, large deviation=630000), remove op1, liquidation — large deviation arithmetic, verify no overflow/underflow | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:586-591, ClusterLib.sol:366-371 |
| RM2-019 | remove2Ops + liquidate | 4-op cluster, explicit EB (48 ETH, deviation>0), remove op1 AND op2, liquidation — deviation subtracted from 2 live ops, 2 removed ops skipped | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:586-591 |
| RM2-020 | remove3Ops + liquidate | 4-op cluster, explicit EB (48 ETH, deviation>0), remove op1, op2, AND op3, liquidation — deviation subtracted from 1 live op only | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:586-591 |
| RM2-021 | removeAllOps + liquidate | 4-op cluster, explicit EB (48 ETH, deviation>0), remove ALL 4 ops, self-liquidation — all ops skipped in deviation loop, DAO deviation still subtracted | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:578, 586-591 |
| RM2-022 | removeOp + autoLiquidation | 4-op cluster, remove op1, EB update (32->128) triggers auto-liquidation via `_liquidateAfterEBUpdateIfNeeded` — same `_executeLiquidation` path, deviation cleanup must skip removed op | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:519-550, 586-591 |
| RM2-023 | removeOp + autoLiquidation | 7-op cluster, remove op1, EB update triggers auto-liquidation — verify `ethValidatorCount` NOT decremented for removed op AND deviation skipped | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:7; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:539-544, 586-591 |
| RM2-024 | removeOp + liquidate | 4-op cluster, explicit EB (48 ETH), remove op1, liquidation — verify `daoTotalEthVUnits` correct for N-1 active operators: DAO gets full deviation decrement (not per-op) | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:562, 578 |
| RM2-025 | removeOp + liquidate | 4-op cluster, explicit EB (48 ETH), remove op1, liquidation — verify bounty (remaining balance) transferred correctly; burn rate reflects 3-op rate | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:599-609 |
| RM2-026 | removeOp + updateEB + updateEB + liquidate | 4-op cluster, remove op1, EB update 32->48 (stale write to removed op), then EB update 48->64 (second stale write), then liquidation — double-stale deviation, verify no underflow | `entry:removeOperator,updateClusterBalance,liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:494-510, 586-591 |
| RM2-027 | removeOp + liquidate + reactivate | 4-op cluster, explicit EB, remove op1, liquidate (deviation cleaned for live ops), reactivate — deviation restored to live ops only, removed op still has `operatorEthVUnits == 0` | `entry:liquidate,reactivate; version:eth; eb:explicit; cluster:active->liquidated; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:586-591, OperatorLib.sol:312-319 |
| RM2-028 | removeOp + liquidate | 4-op cluster, explicit EB (48 ETH), remove op1, liquidation — verify `cluster.active == false`, `cluster.balance == 0`, `cluster.index == 0`, `cluster.networkFeeIndex == 0` | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:600-603 |
| RM2-029 | removeOp + liquidate | 4-op cluster, explicit EB (48 ETH), remove op1, liquidation — verify `ClusterLiquidated` event emitted with correct owner, operatorIds (all 4 including removed), zeroed cluster | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:611 |
| RM2-030 | removeOp + sharedOps + liquidate | 2 clusters share op1 and op2, cluster A has explicit EB (48 ETH, deviation=5000), remove op1, liquidate cluster A — op1 skipped in deviation cleanup, op2 deviation decremented only by cluster A's deviation (cluster B's contribution preserved) | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:586-591 |

---

## Detailed Scenario Blocks

### RM2-001: 4-op Cluster, Explicit EB With Deviation, Remove Op, Liquidate

**Goal:** Verify that `_executeLiquidation` skips the removed operator when subtracting deviation from `operatorEthVUnits`, preventing an underflow revert.

**Setup:**
1. Register 4 operators (op1, op2, op3, op4) with non-zero ETH fees.
2. Create active ETH cluster (4 ops, 1 validator), deposit sufficient ETH.
3. Call `updateClusterBalance` with `effectiveBalance=48` (vUnits=15000, deviation=5000).
4. Verify each operator's `operatorEthVUnits` includes +5000 deviation.
5. Remove op1 via `removeOperator(op1)` — `operatorEthVUnits[op1]` deleted (0), `ethSnapshot.block` zeroed.
6. Drain cluster balance until liquidatable (3-op burn rate, since removed op contributes 0 fee).

**Execution:**
- Third-party calls `liquidate(owner, operatorIds, cluster)`.

**Assertions:**
- `updateClusterOperators` skips op1 (`ethSnapshot.block == 0`): `ethValidatorCount` NOT decremented for op1.
- `_executeLiquidation` enters deviation block: `vUnitsCluster = 15000 > 0`, `baseline = 10000`, `deviation = 5000`.
- `daoTotalEthVUnits -= 5000` (line 578) — full deviation, unaffected by removed op.
- Deviation loop (lines 586-591): op1 skipped (guard checks `ethSnapshot.block == 0`), ops 2/3/4 each get `operatorEthVUnits -= 5000`.
- `operatorEthVUnits[op1] == 0` post-liquidation (was already 0, stays 0).
- `operatorEthVUnits[op2]`, `operatorEthVUnits[op3]`, `operatorEthVUnits[op4]` each decreased by 5000.
- `cluster.active == false`, `cluster.balance == 0`.
- No arithmetic underflow revert.

**Code path:** `SSVClusters.sol:539-544` (ethValidatorCount guard) -> `562` (updateDAO) -> `569-596` (deviation cleanup with guard) -> `599-611` (state reset + transfer).

---

### RM2-002: Explicit EB at Baseline, Remove Op, Liquidate — Clean Path

**Goal:** Verify that when explicit EB equals the baseline (deviation=0), `_executeLiquidation` enters the `vUnitsCluster > 0` block but finds deviation=0 and skips all operator updates. Removed operator is irrelevant.

**Setup:**
1. Register 4 operators and cluster (1 validator).
2. Call `updateClusterBalance` with `effectiveBalance=32` (vUnits=10000, baseline=10000, deviation=0).
3. Remove op1.
4. Drain cluster balance until liquidatable.

**Execution:**
- Third-party calls `liquidate(owner, operatorIds, cluster)`.

**Assertions:**
- `vUnitsCluster = 10000 > 0`, enters deviation block.
- `baselineVUnits = 1 * 10000 = 10000`.
- `vUnitsCluster == baselineVUnits`: condition at line 573 (`vUnitsCluster != baselineVUnits`) is false.
- Entire deviation subtraction (lines 577-592) skipped.
- No `operatorEthVUnits` modifications. `operatorEthVUnits[op1] == 0` (deleted, stays 0).
- `daoTotalEthVUnits` NOT modified for deviation (only baseline via `updateDAO` at line 562).
- Transaction succeeds cleanly.

**Code path:** `SSVClusters.sol:569` (vUnitsCluster > 0) -> `573` (deviation == 0, skip) -> `599-611`.

---

### RM2-013: EB Update Writes Stale Deviation to Removed Op, Then Liquidation

**Goal:** Verify the compound path where `_updateOperatorVUnits` (THE BUG from RM1) writes deviation to the removed operator's `operatorEthVUnits` slot, and the subsequent `_executeLiquidation` deviation cleanup handles this stale value correctly.

**Setup:**
1. Register 4 operators and cluster (1 validator), deposit sufficient ETH.
2. Remove op1 — `operatorEthVUnits[op1]` deleted to 0.
3. Call `updateClusterBalance` with `effectiveBalance=48` (vUnits=15000). THE BUG: `_updateOperatorVUnits` writes deviation=5000 to `operatorEthVUnits[op1]` (revived from 0 to 5000, stale).
4. Drain cluster balance until liquidatable.

**Execution:**
- Third-party calls `liquidate(owner, operatorIds, cluster)`.

**Assertions:**
- Pre-liquidation state: `operatorEthVUnits[op1] = 5000` (stale, written by bug).
- `_executeLiquidation`: deviation=5000, `moreThanBaseline=true`.
- With guard fix: op1 skipped (`ethSnapshot.block == 0`), `operatorEthVUnits[op1]` remains 5000 (stale leak, but safe — no underflow). Ops 2/3/4 decremented by 5000.
- Without guard fix: op1 subtraction `0 - 5000` would underflow. But with stale write, `operatorEthVUnits[op1] = 5000`, so `5000 - 5000 = 0` — happens to work by accident in this specific sequence.
- **Key insight:** The guard fix is still necessary because the stale write from EB update is not guaranteed to match the deviation at liquidation time (e.g., if multiple EB updates occurred).
- `operatorEthVUnits[op1] == 0` or `5000` depending on guard behavior — assert the expected post-fix value.
- `daoTotalEthVUnits` decremented by 5000.

**Code path:** `SSVClusters.sol:494-510` (stale write) -> `586-591` (deviation cleanup with/without guard).

---

### RM2-016: Remove Op, EB Update, Balance Drains, Liquidation — Full Lifecycle

**Goal:** End-to-end test of the most common real-world bug path: operator removed, EB update occurs (stale write), time passes as balance drains, liquidation triggered.

**Setup:**
1. Register 4 operators (op1-op4), each with ethFee = 1_000_000_000 wei/block packed.
2. Create active ETH cluster (1 validator), deposit 10 ETH.
3. Remove op1 — `operatorEthVUnits[op1]` deleted, `ethSnapshot.block = 0`.
4. Commit oracle root with `effectiveBalance=48`. Call `updateClusterBalance`.
5. EB update writes deviation=5000 to all 4 operators including removed op1 (bug).
6. Advance blocks until cluster is undercollateralized at 3-op burn rate.

**Execution:**
- Third-party calls `liquidate(owner, operatorIds, cluster)`.

**Assertions:**
- `updateClusterOperators`: op1 skipped for `ethValidatorCount` decrement and fee accumulation.
- `isLiquidatableWithEB` threshold uses vUnits=15000 but burn rate is 3-op (op1's fee is 0).
- `_executeLiquidation`: deviation=5000 subtracted from live ops (2, 3, 4). Op1 skipped by guard.
- `operatorEthVUnits[op1] == 0` (or stale 5000 if guard doesn't clean it — acceptable leak).
- `daoTotalEthVUnits -= 5000`.
- `updateDAO(false, 1)`: `ethDaoValidatorCount -= 1`, baseline removed.
- Bounty transferred to liquidator.
- No revert.

**Code path:** Full flow through `SSVClusters.sol:31-65` -> `OperatorLib.sol:233-262` -> `SSVClusters.sol:552-612`.

---

### RM2-021: Remove ALL 4 Operators, Self-Liquidate — All Ops Skipped

**Goal:** Verify the extreme case where all operators in the cluster have been removed. Deviation loop iterates all 4, skips all 4. DAO deviation is still subtracted.

**Setup:**
1. Register 4 operators and cluster (1 validator).
2. Call `updateClusterBalance` with `effectiveBalance=48` (deviation=5000).
3. Remove all 4 operators — all `operatorEthVUnits` deleted, all `ethSnapshot.block = 0`.
4. Cluster still active (removal doesn't deactivate clusters).

**Execution:**
- Owner calls `liquidate(owner, operatorIds, cluster)` (self-liquidation, bypasses solvency check).

**Assertions:**
- `updateClusterOperators`: all 4 ops skipped. No `ethValidatorCount` decrements. `cumulativeFee = 0`. `burnRate = 0`.
- Self-liquidation check at line 52: `clusterOwner == msg.sender`, so solvency check skipped.
- `_executeLiquidation`: `updateDAO(false, 1)` decrements `ethDaoValidatorCount`.
- Deviation block: `vUnitsCluster = 15000`, `baseline = 10000`, `deviation = 5000`.
- `daoTotalEthVUnits -= 5000` (line 578) — DAO accounting correct regardless of operator state.
- Deviation loop: all 4 ops skipped (guard). No `operatorEthVUnits` modifications.
- All `operatorEthVUnits[opX] == 0` post-liquidation.
- `cluster.active = false`, remaining balance transferred to owner.

**Code path:** `SSVClusters.sol:52` (self-liquidation bypass) -> `562` (updateDAO) -> `586-591` (all skipped by guard) -> `607-609`.

---

### RM2-022: Remove Op, EB Update Triggers Auto-Liquidation

**Goal:** Verify that when an EB update makes the cluster undercollateralized and triggers auto-liquidation via `_liquidateAfterEBUpdateIfNeeded`, the `_executeLiquidation` deviation cleanup correctly skips the removed operator.

**Setup:**
1. Register 4 operators and cluster (1 validator).
2. Cluster balance set marginally above liquidation threshold at 32 ETH EB.
3. Remove op1.
4. Commit oracle root with `effectiveBalance=128` (vUnits=40000). Massive EB increase.

**Execution:**
- Non-owner calls `updateClusterBalance(blockNum, owner, operatorIds, cluster, 128, proof)`.

**Assertions:**
- `_updateOperatorVUnits`: delta=30000 applied to all 4 ops including removed op1 (bug writes stale deviation).
- Fees settled with old vUnits. New vUnits=40000 stored.
- `_liquidateAfterEBUpdateIfNeeded`: `isLiquidatableWithEB` uses new vUnits=40000 → threshold quadrupled. Balance insufficient.
- ethValidatorCount decrement loop (lines 539-544): op1 skipped (`ethSnapshot.block == 0`).
- `_executeLiquidation`: deviation = 40000 - 10000 = 30000.
- `daoTotalEthVUnits -= 30000`.
- Deviation loop: op1 skipped by guard. Ops 2/3/4 each get `operatorEthVUnits -= 30000`.
- `operatorEthVUnits[op1] == 0` (guard ensures no underflow from stale value).
- Bounty transferred to msg.sender (the EB update caller acts as liquidator).
- `ClusterLiquidated` event emitted.

**Code path:** `SSVClusters.sol:494-510` (stale write) -> `519-550` (auto-liquidation trigger) -> `539-544` (ethValidatorCount guard) -> `552-612` (deviation cleanup with guard).

---

### RM2-026: Remove Op, Double EB Update, Then Liquidation — Double-Stale Deviation

**Goal:** Verify that two sequential EB updates after operator removal create a double-stale deviation on the removed operator, and the liquidation deviation cleanup handles this correctly.

**Setup:**
1. Register 4 operators and cluster (1 validator), deposit generous ETH.
2. Remove op1 — `operatorEthVUnits[op1]` deleted to 0.
3. Commit root A with `effectiveBalance=48` (vUnits=15000). Call `updateClusterBalance`. Bug writes +5000 to op1.
4. Commit root B with `effectiveBalance=64` (vUnits=20000). Call `updateClusterBalance`. Bug writes additional +5000 to op1 (total stale = 10000).
5. Drain cluster balance until liquidatable.

**Execution:**
- Third-party calls `liquidate(owner, operatorIds, cluster)`.

**Assertions:**
- Pre-liquidation: `operatorEthVUnits[op1] = 10000` (double stale from two EB updates).
- `_executeLiquidation`: `vUnitsCluster = 20000`, `baseline = 10000`, `deviation = 10000`.
- With guard fix: op1 skipped, `operatorEthVUnits[op1]` remains 10000 (stale leak). Ops 2/3/4 each decremented by 10000.
- Without guard fix: `10000 - 10000 = 0` — happens to work in this case. But if a third EB *decrease* had occurred (48->32, shrinking deviation to 0 while op1 still has 10000 stale), the math breaks.
- `operatorEthVUnits[op1] == 0` post-fix (guard skips, stale value is orphaned but harmless since operator is deleted).
- `daoTotalEthVUnits -= 10000`.
- No underflow revert.

**Code path:** Two calls to `SSVClusters.sol:494-510` -> `586-591` (guard skips removed op).

---

### RM2-030: Shared Operators Across Clusters, Remove Op, Liquidate One Cluster

**Goal:** Verify that when two clusters share operators and one is removed, liquidating one cluster correctly subtracts only that cluster's deviation from the shared live operators, preserving the other cluster's contribution.

**Setup:**
1. Register 6 operators (op1-op6).
2. Cluster A: ops [op1, op2, op3, op4], 1 validator. EB update to 48 ETH (deviation_A = 5000).
3. Cluster B: ops [op3, op4, op5, op6], 1 validator. EB update to 64 ETH (deviation_B = 10000).
4. op3 and op4 are shared. `operatorEthVUnits[op3] = 5000 + 10000 = 15000`. `operatorEthVUnits[op4] = 15000`.
5. Remove op1 — `operatorEthVUnits[op1]` deleted to 0. Op1 is only in cluster A.
6. Drain cluster A balance until liquidatable.

**Execution:**
- Third-party calls `liquidate(owner, operatorIdsA, clusterA)`.

**Assertions:**
- `_executeLiquidation` for cluster A: deviation = 5000.
- Op1 skipped by guard (removed). `operatorEthVUnits[op1] == 0`.
- `operatorEthVUnits[op2] -= 5000` (was 5000, becomes 0 — only had cluster A's deviation).
- `operatorEthVUnits[op3] -= 5000` (was 15000, becomes 10000 — cluster B's contribution preserved).
- `operatorEthVUnits[op4] -= 5000` (was 15000, becomes 10000 — cluster B's contribution preserved).
- `daoTotalEthVUnits -= 5000` (cluster A's deviation only).
- Cluster B unaffected. If cluster B is later liquidated, op3/op4 lose their remaining 10000.

**Code path:** `SSVClusters.sol:586-591` (per-cluster deviation subtraction on shared operators).

---

## Coverage Matrix

| Dimension | Scenarios |
|-----------|-----------|
| **Operator count: 4 ops** | RM2-001, RM2-002, RM2-009, RM2-010, RM2-011, RM2-012, RM2-013, RM2-014, RM2-015, RM2-016, RM2-017, RM2-018, RM2-019, RM2-020, RM2-021, RM2-022, RM2-025, RM2-026, RM2-027, RM2-028, RM2-029 |
| **Operator count: 7 ops** | RM2-003, RM2-004, RM2-023 |
| **Operator count: 10 ops** | RM2-005, RM2-006 |
| **Operator count: 13 ops** | RM2-007, RM2-008 |
| **Explicit EB, deviation > 0** | RM2-001, RM2-003, RM2-005, RM2-007, RM2-009, RM2-010, RM2-011, RM2-012, RM2-013, RM2-016, RM2-017, RM2-018, RM2-019, RM2-020, RM2-021, RM2-022, RM2-023, RM2-024, RM2-025, RM2-026, RM2-027, RM2-028, RM2-029, RM2-030 |
| **Explicit EB, deviation = 0** | RM2-002, RM2-004, RM2-006, RM2-008 |
| **Implicit EB (vUnits=0)** | RM2-015 |
| **Third-party liquidation** | RM2-001, RM2-003, RM2-005, RM2-007, RM2-010, RM2-011, RM2-013, RM2-014, RM2-016, RM2-017, RM2-018, RM2-019, RM2-022, RM2-023, RM2-024, RM2-025, RM2-026, RM2-030 |
| **Self-liquidation** | RM2-009, RM2-021 |
| **Auto-liquidation (via EB update)** | RM2-022, RM2-023 |
| **1 op removed** | RM2-001, RM2-002, RM2-003, RM2-004, RM2-005, RM2-006, RM2-007, RM2-008, RM2-009, RM2-010, RM2-011, RM2-012, RM2-013, RM2-014, RM2-015, RM2-016, RM2-017, RM2-018, RM2-022, RM2-023, RM2-024, RM2-025, RM2-026, RM2-027, RM2-028, RM2-029, RM2-030 |
| **2 ops removed** | RM2-019 |
| **3 ops removed** | RM2-020 |
| **All ops removed** | RM2-021 |
| **EB update before liquidation (stale write)** | RM2-013, RM2-016, RM2-022, RM2-023, RM2-026 |
| **operatorEthVUnits[removedOp]==0 assertion** | RM2-001, RM2-002, RM2-010, RM2-012, RM2-013, RM2-015, RM2-016, RM2-017, RM2-019, RM2-020, RM2-021, RM2-022, RM2-023, RM2-026, RM2-027, RM2-030 |
| **daoTotalEthVUnits correctness** | RM2-011, RM2-021, RM2-024, RM2-030 |
| **ethValidatorCount NOT decremented for removed op** | RM2-012, RM2-023 |
| **Shared operators across clusters** | RM2-030 |
| **Liquidate -> reactivate round-trip** | RM2-027 |
| **Large deviation (2048 ETH)** | RM2-018 |
| **Threshold boundary** | RM2-014 |

---

## Summary

**30 scenarios** covering `_executeLiquidation` deviation cleanup behavior when operators have been removed from a cluster.

**Core bug:** Lines 586-591 of `SSVClusters.sol` subtract deviation from `operatorEthVUnits[operatorIds[i]]` for every operator in the cluster without checking if the operator has been removed. Since `removeOperator()` deletes `operatorEthVUnits` (sets to 0) and zeros `ethSnapshot.block`, subtracting a positive deviation from 0 causes an arithmetic underflow revert. The fix is a guard: `if (s.operators[operatorIds[i]].ethSnapshot.block == 0) continue;` — consistent with the guard already present at lines 541-543 for `ethValidatorCount` decrement.

**Key findings from scenario analysis:**
1. The deviation loop at 586-591 needs the same `ethSnapshot.block == 0` guard that protects `ethValidatorCount` at 541-543.
2. DAO deviation accounting (line 578) is unaffected by removed operators — it uses `daoTotalEthVUnits` which tracks cluster-level deviation, not per-operator.
3. When `_updateOperatorVUnits` (RM1 bug) has written stale deviation to a removed operator before liquidation, the guard ensures no underflow regardless of the stale value.
4. The `deviation = 0` path (explicit EB at baseline) is inherently safe — the outer `if (deviation != 0)` check at line 577 skips the loop entirely.
5. The implicit EB path (`vUnitsCluster == 0`) is inherently safe — the outer `if (vUnitsCluster > 0)` check at line 569 skips the entire deviation block.
6. Even with all operators removed (RM2-021), the DAO deviation is correctly subtracted while all operator updates are safely skipped.

**Cross-references:** RM1-* (removed operator vUnits bug in `_updateOperatorVUnits`), LQ-019/LQ-020 (liquidation with removed operator in LQ scenarios), EB-055/EB-057 (EB update with removed operator), XO-008/XO-018 (cross-module removed op + liquidation).

---

## Coverage Verification (W4)

**Verified:** 2026-03-24
**Method:** Cross-referenced all test files in `test/` for `mockRemoveOperator`, `mockRemoveOperatorAndPayout`, and real `removeOperator()` calls combined with `liquidate` / `_executeLiquidation` paths, focusing on explicit EB deviation cleanup.

**Critical finding:** Only one test exists that combines a removed operator with liquidation: `test/sanity/removed-operator.test.ts`. It uses real `removeOperator()` but with IMPLICIT EB (no `updateClusterBalance` call), meaning deviation is 0 and the deviation cleanup loop at lines 586-591 is never reached. No test exercises the deviation cleanup path with a removed operator.

**Mock analysis:**
- `SSVClustersHarness.sol:mockRemoveOperator` (lines 169-181): Does NOT `delete seb.operatorEthVUnits[operatorId]`. Tests using this mock cannot detect the underflow bug.
- `SSVClustersHarness.sol:mockRemoveOperatorAndPayout` (lines 185-219): Also does NOT `delete seb.operatorEthVUnits[operatorId]`.
- Real `removeOperator()` (SSVOperators.sol:93): `delete seb.operatorEthVUnits[operatorId]`.

**Relevant existing tests:**
- `test/sanity/removed-operator.test.ts`: Real `removeOperator()` + `liquidate`. But no explicit EB, no deviation, no `operatorEthVUnits` assertions. Covers only the fee settlement path (RM2-015 implicit EB analog) — but does not assert `operatorEthVUnits` or DAO totals.
- `test/unit/SSVClusters/removedOperatorImpact.test.ts`: `mockRemoveOperator` + `liquidateSSV` (SSV liquidation, not ETH). Not relevant to RM2 scenarios.
- `test/unit/SSVClusters/ebAutoLiquidation.test.ts`: Tests auto-liquidation via EB update but without any removed operators.

| ID | Tested | remove_mode | Test File | Notes |
|----|--------|-------------|-----------|-------|
| RM2-001 | no | none | — | No test: removeOp + explicit EB deviation + liquidate |
| RM2-002 | no | none | — | No test: explicit EB at baseline + removeOp + liquidate |
| RM2-003 | no | none | — | 7-op variant, no test exists |
| RM2-004 | no | none | — | 7-op baseline variant, no test exists |
| RM2-005 | no | none | — | 10-op variant, no test exists |
| RM2-006 | no | none | — | 10-op baseline variant, no test exists |
| RM2-007 | no | none | — | 13-op variant, no test exists |
| RM2-008 | no | none | — | 13-op baseline variant, no test exists |
| RM2-009 | no | none | — | Self-liquidation variant, no test exists |
| RM2-010 | no | none | — | operatorEthVUnits assertion variant, no test exists |
| RM2-011 | no | none | — | daoTotalEthVUnits verification, no test exists |
| RM2-012 | no | none | — | ethValidatorCount verification, no test exists |
| RM2-013 | no | none | — | EB update stale write + liquidation, no test exists |
| RM2-014 | no | none | — | Threshold boundary liquidation, no test exists |
| RM2-015 | partial:weak | real | test/sanity/removed-operator.test.ts | Real removeOperator + liquidate, but implicit EB (deviation=0). Deviation loop never entered. No operatorEthVUnits/DAO assertions. Only checks ClusterLiquidated event emitted. |
| RM2-016 | no | none | — | Full lifecycle (removeOp + EB + drain + liquidate), no test exists |
| RM2-017 | no | none | — | Live ops operatorEthVUnits verification, no test exists |
| RM2-018 | no | none | — | Large deviation (2048 ETH) arithmetic, no test exists |
| RM2-019 | no | none | — | 2 ops removed + liquidate, no test exists |
| RM2-020 | no | none | — | 3 ops removed + liquidate, no test exists |
| RM2-021 | no | none | — | All ops removed + self-liquidate, no test exists |
| RM2-022 | no | none | — | Auto-liquidation via EB update with removed op, no test exists |
| RM2-023 | no | none | — | 7-op auto-liquidation with removed op, no test exists |
| RM2-024 | no | none | — | daoTotalEthVUnits for N-1 ops, no test exists |
| RM2-025 | no | none | — | Bounty/burn-rate verification, no test exists |
| RM2-026 | no | none | — | Double-stale deviation + liquidation, no test exists |
| RM2-027 | no | none | — | Liquidate + reactivate round-trip, no test exists |
| RM2-028 | no | none | — | Post-liquidation cluster state verification, no test exists |
| RM2-029 | no | none | — | ClusterLiquidated event verification, no test exists |
| RM2-030 | no | none | — | Shared operators across clusters + liquidate, no test exists |

**Summary:** 1/30 partially tested (RM2-015 analog only). The `_executeLiquidation` deviation cleanup loop (lines 586-591) has zero test coverage with a removed operator. The sanity test proves liquidation succeeds with a removed operator at implicit EB (deviation=0), but the bug manifests only when explicit EB deviation > 0.
