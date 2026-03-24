# Scenarios — Remove Operator + Auto-Liquidation Compound Path (RMA-001 to RMA-030)

**Prefix:** RMA
**Worker:** W-RM-AutoLiq
**Source contracts:** `SSVClusters.sol` (updateClusterBalance, _updateClusterBalanceInternal, _applyClusterFeeUpdates, _updateOperatorVUnits, _liquidateAfterEBUpdateIfNeeded, _executeLiquidation, liquidate), `SSVOperators.sol` (removeOperator, _resetOperatorState), `OperatorLib.sol` (updateClusterOperators), `ClusterLib.sol` (isLiquidatableWithEB)
**Spec refs:** SPEC §2 "Effective Balance Accounting" (Operator vUnit Deviation Cleanup on Liquidation), FLOWS §1.9 (Liquidate ETH), §1.13 (Update Cluster Balance)

---

## Bug Context

**Root cause:** `mockRemoveOperator()` in tests does NOT delete `operatorEthVUnits[operatorId]`. Real `removeOperator()` does (`delete seb.operatorEthVUnits[operatorId]`, line 93) and zeros `ethSnapshot.block` (line 348).

**Safe guard:** `if (op.ethSnapshot.block != 0)` at SSVClusters.sol:541 — prevents `ethValidatorCount` decrement for removed operators in the auto-liquidation path.

**Compound path vulnerability:** `updateClusterBalance` triggers TWO functions that iterate operator arrays with a removed operator present:
1. `_updateOperatorVUnits` (lines 494-510) — writes deviation delta to `operatorEthVUnits[operatorId]` for ALL operators, including removed ones (no guard)
2. `_executeLiquidation` (lines 552-612) — subtracts deviation from `operatorEthVUnits[operatorId]` for ALL operators (no guard at line 586-592)

Both functions blindly iterate the `operatorIds` array. For a removed operator whose `operatorEthVUnits` was deleted by `removeOperator`, writing to and reading from that storage slot creates ghost state or underflow.

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| RMA-001 | updateClusterBalance → auto-liq | 4-op cluster, explicit EB, 1 op removed, EB increase triggers auto-liquidation — compound path through _updateOperatorVUnits then _executeLiquidation with removed op | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:400-401, 494-510, 519-550, 552-612 |
| RMA-002 | updateClusterBalance → auto-liq | 4-op cluster, explicit EB, 1 op removed, EB increase — verify _updateOperatorVUnits writes to deleted operatorEthVUnits[removedOp] creating ghost state | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:505-509, SSVOperators.sol:93 |
| RMA-003 | updateClusterBalance → auto-liq | 4-op cluster, explicit EB, 1 op removed, EB increase — verify _executeLiquidation subtracts deviation from ghost operatorEthVUnits[removedOp] (net zero or underflow) | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:586-592 |
| RMA-004 | updateClusterBalance → auto-liq | 4-op cluster, explicit EB, 1 op removed, EB increase — verify ethValidatorCount NOT decremented for removed op (guard at line 541) | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:539-544 |
| RMA-005 | updateClusterBalance → auto-liq | 7-op cluster, explicit EB, 1 op removed, EB increase triggers auto-liquidation — same compound path with larger operator set | `entry:updateClusterBalance; ops:7; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:400-401, 494-510, 519-550, 552-612 |
| RMA-006 | updateClusterBalance → auto-liq | 10-op cluster, explicit EB, 1 op removed, EB increase triggers auto-liquidation | `entry:updateClusterBalance; ops:10; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:400-401, 494-510, 519-550, 552-612 |
| RMA-007 | updateClusterBalance → auto-liq | 13-op cluster, explicit EB, 1 op removed, EB increase triggers auto-liquidation | `entry:updateClusterBalance; ops:13; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:400-401, 494-510, 519-550, 552-612 |
| RMA-008 | updateClusterBalance → auto-liq | 4-op cluster, explicit EB, 2 ops removed, EB increase triggers auto-liquidation — multiple ghost writes in both _updateOperatorVUnits and _executeLiquidation | `entry:updateClusterBalance; ops:4; remove_mode:real; removed_count:2; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:505-509, 586-592 |
| RMA-009 | updateClusterBalance → auto-liq | 4-op cluster, explicit EB, 3 ops removed (only 1 active), EB increase triggers auto-liquidation — extreme case with mostly-removed operator set | `entry:updateClusterBalance; ops:4; remove_mode:real; removed_count:3; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:505-509, 539-544, 586-592 |
| RMA-010 | updateClusterBalance → auto-liq | Deviation > 0 for removed op — _updateOperatorVUnits adds deltaAbs to deleted slot, then _executeLiquidation subtracts deviation: verify final operatorEthVUnits[removedOp] == 0 (clean state) or residual ghost | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:507, 588 |
| RMA-011 | updateClusterBalance → auto-liq | EB increase from 32→64 ETH/validator on nearly-drained cluster — storedVUnits=10000, newVUnits=20000, deltaAbs=10000, deviation=10000 after liquidation cleanup | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:500-509, 570-593 |
| RMA-012 | updateClusterBalance → auto-liq | EB increase that STILL triggers auto-liquidation despite large fee debt — cluster has massive accrued fees, EB increase from 32→2048 ETH/validator makes threshold enormous | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:385, 531-537, ClusterLib.sol:78-83 |
| RMA-013 | updateClusterBalance → auto-liq | EB decrease to baseline (64→32 ETH/validator) on drained cluster — newVUnits == baselineVUnits, deviation becomes 0, still triggers auto-liquidation from insufficient balance | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:zero; revert:no` | [ ] | SSVClusters.sol:573-594 |
| RMA-014 | updateClusterBalance → auto-liq | Auto-liquidation at exact threshold boundary — balance equals liquidation threshold to the wei after EB update; verify < comparison in isLiquidatableWithEB means NOT liquidated | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:boundary; deviation:positive; revert:no` | [ ] | ClusterLib.sol:83, SSVClusters.sol:531-537 |
| RMA-015 | updateClusterBalance → auto-liq | Auto-liquidation at 1 wei below threshold — balance == threshold - 1 after EB update; auto-liquidation fires | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | ClusterLib.sol:83, SSVClusters.sol:531-548 |
| RMA-016 | updateClusterBalance → auto-liq | After auto-liquidation with removed op: verify cluster state is clean — active=false, balance=0, index=0, networkFeeIndex=0, hash stored correctly | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:599-605 |
| RMA-017 | updateClusterBalance → auto-liq | After auto-liquidation with removed op: verify operatorEthVUnits for active operators cleaned up (deviation subtracted) and removed op's slot is ghost-free | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:586-592 |
| RMA-018 | updateClusterBalance → auto-liq | After auto-liquidation with removed op: verify daoTotalEthVUnits deviation correctly decremented | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:578 |
| RMA-019 | updateClusterBalance → auto-liq | After auto-liquidation with removed op: verify ethDaoValidatorCount decremented by validatorCount (updateDAO(false, validatorCount)) | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:562 |
| RMA-020 | updateClusterBalance → auto-liq | Fee change then real remove then EB update auto-liquidates — operator declares fee, executes fee, is removed, then EB update on cluster triggers compound path | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; fee_change:yes; revert:no` | [ ] | SSVClusters.sol:461-492, 494-510, 519-550, 552-612, SSVOperators.sol:71-104 |
| RMA-021 | updateClusterBalance → auto-liq | _applyClusterFeeUpdates with removed op — updateClusterOperators skips removed op (ethSnapshot.block==0), burnRate excludes its fee, cumulativeIndex includes preserved index | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:396, OperatorLib.sol:241-261 |
| RMA-022 | liquidate vs auto-liq | Compare: manual liquidate() with removed op vs auto-liquidation with removed op — verify identical final state (cluster state, operator counts, deviation accounting) | `entry:liquidate+updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:compare; deviation:positive; revert:no` | [ ] | SSVClusters.sol:31-65 vs 519-550 |
| RMA-023 | liquidate vs auto-liq | Compare: manual liquidate() skips _updateOperatorVUnits (no vUnit delta); auto-liquidation hits _updateOperatorVUnits THEN _executeLiquidation — verify manual path does NOT create ghost operatorEthVUnits | `entry:liquidate+updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:compare; deviation:positive; revert:no` | [ ] | SSVClusters.sol:41-47, 64 vs 400-401, 546 |
| RMA-024 | updateClusterBalance → no auto-liq | 4-op cluster, explicit EB, 1 op removed, EB increase does NOT trigger auto-liquidation (cluster still solvent) — _updateOperatorVUnits writes ghost state but _executeLiquidation never called to clean it | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:no; deviation:positive; revert:no` | [ ] | SSVClusters.sol:400-401, 406-409 |
| RMA-025 | updateClusterBalance → auto-liq | Auto-liquidation bounty transfer — verify remaining balance sent to msg.sender (oracle/reporter) as liquidator, not cluster owner | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:546, 607-609 |
| RMA-026 | updateClusterBalance → auto-liq | ClusterLiquidated event emitted BEFORE ClusterBalanceUpdated event — verify event ordering in compound path | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:611, 416 |
| RMA-027 | updateClusterBalance → auto-liq | EB snapshot written BEFORE auto-liquidation check — verify _updateEBSnapshot at line 404 persists new vUnits even if auto-liquidation fires at line 406 | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:404, 406 |
| RMA-028 | updateClusterBalance → auto-liq | Double deviation subtraction: _updateOperatorVUnits adds delta to removed op (ghost write), then _executeLiquidation subtracts full deviation — if delta != deviation, residual ghost remains in operatorEthVUnits[removedOp] | `entry:updateClusterBalance; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:507-508, 588 |
| RMA-029 | updateClusterBalance → auto-liq | 4-op cluster with all ops removed, EB increase — _applyClusterFeeUpdates returns burnRate=0, isLiquidatableWithEB checks minimumLiquidationCollateral floor, auto-liquidation may fire from collateral check alone | `entry:updateClusterBalance; ops:4; remove_mode:real; removed_count:4; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | ClusterLib.sol:76, SSVClusters.sol:529 |
| RMA-030 | updateClusterBalance → auto-liq | Reactivation after auto-liquidation from compound path with removed op — verify cluster can be reactivated, EB snapshot persists, deviation re-accounting works for remaining active ops | `entry:updateClusterBalance+reactivate; ops:4; remove_mode:real; eb:explicit; auto_liq:yes; deviation:positive; revert:no` | [ ] | SSVClusters.sol:129-181 |

---

## Detailed Scenario Blocks

### RMA-001: Compound path — 4-op cluster, 1 removed, EB increase triggers auto-liquidation

**Setup:**
1. Register 4 operators [1, 2, 3, 4] with ethFee = 1,770,000,000 packed each.
2. Register cluster with validatorCount = 1, deposit just enough ETH for 32 ETH threshold.
3. Call `updateClusterBalance` with effectiveBalance = 32 (baseline) — creates explicit EB, vUnits = 10000.
4. Remove operator 3 via `removeOperator(3)` — `ethSnapshot.block = 0`, `delete seb.operatorEthVUnits[3]`.
5. Advance blocks until cluster is nearly drained.
6. Commit oracle root with effectiveBalance = 64 (64 ETH/validator).

**Execution:**
- Anyone calls `updateClusterBalance(blockNum, owner, [1,2,3,4], cluster, 64, merkleProof)`.

**Assertions:**
- `_applyClusterFeeUpdates`: `updateClusterOperators` skips operator 3 (block==0). BurnRate excludes op 3 fee. Fee settlement uses storedVUnits = 10000.
- `_updateOperatorVUnits`: storedVUnits=10000, newVUnits=20000, deltaAbs=10000. Writes `operatorEthVUnits[3] += 10000` — **ghost write** to deleted slot (now holds 10000 instead of 0).
- `_updateEBSnapshot`: stores newVUnits=20000.
- `_liquidateAfterEBUpdateIfNeeded`: checks solvency with newVUnits=20000 via `isLiquidatableWithEB`. Threshold doubled. Cluster is liquidatable.
  - Iterates operators: op 3 has `ethSnapshot.block == 0` → **skipped** (guard at line 541). Ops 1, 2, 4 have `ethValidatorCount -= 1`.
  - Calls `_executeLiquidation`.
- `_executeLiquidation`: vUnitsCluster=20000, baselineVUnits=10000, deviation=20000-10000=10000, moreThanBaseline=true.
  - `daoTotalEthVUnits -= 10000`.
  - Loop: `operatorEthVUnits[3] -= 10000` — subtracts from ghost value (10000-10000=0). Ghost cleaned by coincidence.
  - Ops 1, 2, 4: `operatorEthVUnits[opId] -= 10000`.
- Cluster: active=false, balance=0, index=0, networkFeeIndex=0.

**Why critical:** This is the exact compound path where TWO vulnerable functions execute in ONE call. The ghost write from `_updateOperatorVUnits` happens to be cleaned by `_executeLiquidation` when deltaAbs == deviation, but this is coincidental — see RMA-028 for the case where they differ.

---

### RMA-008: Multiple removed operators in compound path

**Setup:**
1. Register 4 operators [1, 2, 3, 4] and cluster with validatorCount = 1, explicit EB = 64 ETH (vUnits=20000).
2. Remove operators 3 AND 4 via `removeOperator` — both have `ethSnapshot.block = 0`, both `operatorEthVUnits` deleted.
3. Drain cluster near threshold.
4. Commit oracle root with effectiveBalance = 128 (128 ETH/validator).

**Execution:**
- `updateClusterBalance(blockNum, owner, [1,2,3,4], cluster, 128, merkleProof)`.

**Assertions:**
- `_updateOperatorVUnits`: storedVUnits=20000, newVUnits=40000, deltaAbs=20000. Ghost writes: `operatorEthVUnits[3] += 20000`, `operatorEthVUnits[4] += 20000`.
- `_liquidateAfterEBUpdateIfNeeded`: ops 3, 4 skipped (guard). Only ops 1, 2 have `ethValidatorCount -= 1`.
- `_executeLiquidation`: deviation = 40000 - 10000 = 30000. `operatorEthVUnits[3] -= 30000` — **underflow**: ghost value is 20000, subtracting 30000. Solidity 0.8 reverts on underflow.
- **Expected result:** Transaction reverts with arithmetic underflow.

**Why critical:** With multiple removed operators and a large EB increase, the deltaAbs written by `_updateOperatorVUnits` does not match the deviation subtracted by `_executeLiquidation`. The ghost slot cannot absorb the subtraction, causing a revert that blocks the EB update for this cluster entirely.

---

### RMA-010: Ghost state lifecycle — write then subtract on removed op's operatorEthVUnits

**Setup:**
1. Register 4 operators [1, 2, 3, 4] and cluster with validatorCount = 1.
2. `updateClusterBalance` with effectiveBalance = 32 → explicit EB, vUnits = 10000.
3. Remove operator 3. `operatorEthVUnits[3]` deleted (was N, now 0 in storage).
4. Drain cluster. Commit root with effectiveBalance = 64.

**Execution:**
- `updateClusterBalance(blockNum, owner, [1,2,3,4], cluster, 64, merkleProof)`.

**Assertions:**
- Phase 1 (`_updateOperatorVUnits`): deltaAbs = 20000 - 10000 = 10000. `operatorEthVUnits[3] = 0 + 10000 = 10000`.
- Phase 2 (`_executeLiquidation`): deviation = 20000 - 10000 = 10000. `operatorEthVUnits[3] = 10000 - 10000 = 0`.
- Net effect for removed op: 0 → 10000 → 0. Clean.
- Net effect for active ops: both phases decrement by 10000 each. Total = -20000 (delta + deviation). Verify no double-counting.

**Why complex:** Traces the full lifecycle of the ghost slot. In this specific case deltaAbs == deviation, so the ghost cancels out. But this is only true when storedVUnits == baselineVUnits (the initial explicit EB equals baseline). For any other starting point, the values diverge — see RMA-028.

---

### RMA-013: EB decrease to baseline triggers auto-liquidation

**Setup:**
1. Register 4 operators and cluster with validatorCount = 1.
2. `updateClusterBalance` with effectiveBalance = 64 → vUnits = 20000. Deviation = 10000 per operator.
3. Remove operator 3.
4. Drain cluster until barely solvent at 20000 vUnits threshold.
5. Commit root with effectiveBalance = 32 (decrease to baseline).

**Execution:**
- `updateClusterBalance(blockNum, owner, [1,2,3,4], cluster, 32, merkleProof)`.

**Assertions:**
- `_updateOperatorVUnits`: storedVUnits=20000, newVUnits=10000 (decrease). deltaPositive=false. `operatorEthVUnits[3] -= 10000` — but slot was deleted! Underflow: 0 - 10000 reverts.
- **Expected result:** Transaction reverts with arithmetic underflow.
- If somehow the slot retained a value (test with mock): `operatorEthVUnits[3]` goes negative conceptually.
- Auto-liquidation never reached because `_updateOperatorVUnits` reverts first.

**Why critical:** EB decreases are also vulnerable. `_updateOperatorVUnits` subtracts from the deleted slot before `_liquidateAfterEBUpdateIfNeeded` is even checked. The guard at line 541 protects `ethValidatorCount` but NOT `operatorEthVUnits`.

---

### RMA-014: Auto-liquidation at exact threshold boundary

**Setup:**
1. Register 4 operators and cluster with validatorCount = 1, explicit EB = 32 (vUnits=10000).
2. Remove operator 3.
3. Compute exact threshold at new vUnits=20000: `threshold = minimumBlocksBeforeLiquidation * (burnRate_3ops + networkFee) * 20000 / 10000 * ETH_DEDUCTED_DIGITS`.
4. Advance blocks until cluster.balance == threshold exactly (after fee settlement).
5. Commit root with effectiveBalance = 64.

**Execution:**
- `updateClusterBalance(blockNum, owner, [1,2,3,4], cluster, 64, merkleProof)`.

**Assertions:**
- `isLiquidatableWithEB` uses `<` comparison (line 83): `cluster.balance < liquidationThreshold`.
- balance == threshold → NOT liquidatable → auto-liquidation does NOT fire.
- `_liquidateAfterEBUpdateIfNeeded` returns false.
- Cluster hash stored normally at line 409.
- `_updateOperatorVUnits` ghost write persists (operatorEthVUnits[3] = 10000) — never cleaned because `_executeLiquidation` was not called.

**Edge detail:** The boundary case reveals that when auto-liquidation does NOT fire, the ghost write from `_updateOperatorVUnits` is permanent. This ghost state accumulates across multiple EB updates.

---

### RMA-022: Manual liquidate() vs auto-liquidation — behavioral comparison

**Setup A (manual):**
1. Register 4 operators and cluster with validatorCount = 1, explicit EB = 64 (vUnits=20000).
2. Remove operator 3.
3. Drain cluster below threshold.

**Execution A:**
- Third-party calls `liquidate(owner, [1,2,3,4], cluster)`.

**Setup B (auto):**
1. Identical initial state: 4 ops, validatorCount=1, explicit EB = 32 (vUnits=10000).
2. Remove operator 3.
3. Drain cluster near threshold.
4. Commit root with effectiveBalance = 64.

**Execution B:**
- Anyone calls `updateClusterBalance(blockNum, owner, [1,2,3,4], cluster, 64, merkleProof)`.

**Comparison:**

| Aspect | Manual `liquidate()` | Auto-liquidation via `updateClusterBalance` |
|--------|---------------------|---------------------------------------------|
| `_updateOperatorVUnits` called | No | Yes — writes ghost to `operatorEthVUnits[3]` |
| `_liquidateAfterEBUpdateIfNeeded` called | No | Yes — guard skips op 3 for ethValidatorCount |
| `_executeLiquidation` called | Yes (directly) | Yes (via auto-liq) |
| `updateClusterOperators` called | Yes (decrements ethValidatorCount) | Yes (in `_applyClusterFeeUpdates`, but with deltaValidatorCount=0) |
| ethValidatorCount decrement for active ops | In `updateClusterOperators` | In `_liquidateAfterEBUpdateIfNeeded` (lines 539-544) |
| Deviation cleanup for removed op | Subtracts from `operatorEthVUnits[3]` (may underflow if deleted) | Adds then subtracts — ghost write then cleanup |
| Events | ClusterLiquidated | ClusterLiquidated + ClusterBalanceUpdated |
| Liquidator (bounty recipient) | msg.sender (third party) | msg.sender (oracle reporter) |

**Key difference:** Manual `liquidate()` hits `_executeLiquidation` directly without prior `_updateOperatorVUnits` call. The ghost-write-then-cleanup dance only exists in the auto-liquidation path. However, manual `liquidate()` with explicit EB still hits the deviation subtraction in `_executeLiquidation` line 588, which can also underflow on the deleted slot.

---

### RMA-024: EB increase without auto-liquidation — persistent ghost state

**Setup:**
1. Register 4 operators and cluster with validatorCount = 1, explicit EB = 32 (vUnits=10000).
2. Remove operator 3.
3. Cluster is well-funded — will remain solvent even at higher threshold.
4. Commit root with effectiveBalance = 64.

**Execution:**
- `updateClusterBalance(blockNum, owner, [1,2,3,4], cluster, 64, merkleProof)`.

**Assertions:**
- `_updateOperatorVUnits`: deltaAbs=10000, writes `operatorEthVUnits[3] = 10000` (ghost).
- `_liquidateAfterEBUpdateIfNeeded`: cluster is solvent → returns false.
- `_executeLiquidation` never called → ghost state persists.
- Cluster hash stored normally at line 409 with updated balance.
- `operatorEthVUnits[3]` = 10000 in storage — orphaned. No cluster references op 3 for this deviation.
- If operator 3 is later re-registered: new operator inherits ghost `operatorEthVUnits` value of 10000. Earnings calculations may be inflated.

**Why critical:** The non-liquidation path is arguably worse than the liquidation path. When auto-liquidation does NOT fire, there is no cleanup phase. The ghost state persists indefinitely and can corrupt future operator re-registrations.

---

### RMA-028: Delta != deviation — residual ghost after compound path

**Setup:**
1. Register 4 operators and cluster with validatorCount = 1.
2. First `updateClusterBalance` with effectiveBalance = 64 → vUnits = 20000 (deviation = 10000).
3. Remove operator 3. `delete operatorEthVUnits[3]` (was 10000, now 0).
4. Second oracle root with effectiveBalance = 96 (96 ETH/validator).
5. Drain cluster to trigger auto-liquidation at new threshold.

**Execution:**
- `updateClusterBalance(blockNum, owner, [1,2,3,4], cluster, 96, merkleProof)`.

**Assertions:**
- `_updateOperatorVUnits`: storedVUnits=20000, newVUnits=30000, deltaAbs=10000. Ghost write: `operatorEthVUnits[3] = 0 + 10000 = 10000`.
- `_executeLiquidation`: vUnitsCluster=30000, baselineVUnits=10000, deviation=20000. Subtract: `operatorEthVUnits[3] -= 20000` → 10000 - 20000 = **underflow, revert**.
- deltaAbs (10000) != deviation (20000) because storedVUnits (20000) != baselineVUnits (10000).
- The ghost slot absorbed the delta but cannot absorb the full deviation.
- **Expected result:** Transaction reverts with arithmetic underflow.

**Why critical:** This proves the ghost cleanup in RMA-001/RMA-010 was coincidental. Whenever storedVUnits != baselineVUnits at the time of the EB update (which is the common case for any cluster with prior explicit EB), deltaAbs != deviation and the underflow occurs. This blocks all EB updates for clusters with removed operators and non-baseline explicit EB.

---

## Coverage Matrix

| Dimension | Scenarios | Coverage |
|-----------|-----------|----------|
| **Operator counts** | | |
| 4 operators | RMA-001 to RMA-004, RMA-008 to RMA-030 | Primary |
| 7 operators | RMA-005 | Scale |
| 10 operators | RMA-006 | Scale |
| 13 operators | RMA-007 | Scale |
| **Removed operator count** | | |
| 1 removed | RMA-001 to RMA-007, RMA-010 to RMA-028, RMA-030 | Primary |
| 2 removed | RMA-008 | Multi-remove |
| 3 removed (1 active) | RMA-009 | Extreme |
| 4 removed (all) | RMA-029 | Degenerate |
| **Auto-liquidation outcome** | | |
| Auto-liq fires | RMA-001 to RMA-013, RMA-015 to RMA-023, RMA-025 to RMA-030 | Primary |
| Auto-liq does NOT fire | RMA-014 (boundary), RMA-024 | Ghost persistence |
| **Deviation direction** | | |
| EB increase (deltaPositive=true) | RMA-001 to RMA-012, RMA-014 to RMA-028, RMA-030 | Primary |
| EB decrease (deltaPositive=false) | RMA-013 | Underflow on subtract |
| Deviation = 0 (at baseline) | RMA-013 (after decrease) | Edge |
| **Ghost state outcomes** | | |
| Ghost write + clean (delta == deviation) | RMA-001, RMA-010 | Coincidental cleanup |
| Ghost write + underflow (delta != deviation) | RMA-008, RMA-013, RMA-028 | Revert path |
| Ghost write + persist (no auto-liq) | RMA-014, RMA-024 | Orphaned state |
| **Comparison paths** | | |
| Manual liquidate() vs auto-liq | RMA-022, RMA-023 | Behavioral diff |
| **Post-liquidation state** | | |
| Cluster state clean | RMA-016, RMA-017, RMA-018, RMA-019 | State verification |
| Reactivation after auto-liq | RMA-030 | Recovery path |
| **Trigger mechanisms** | | |
| Pure EB increase | RMA-001 to RMA-012, RMA-014, RMA-015 | Standard |
| Fee change before remove | RMA-020 | Sequencing |
| Fee settlement in compound path | RMA-021 | Internal accounting |
| Bounty transfer | RMA-025 | ETH flow |
| Event ordering | RMA-026 | Observability |
| Snapshot persistence | RMA-027 | Storage ordering |

---

## Summary

**30 scenarios** covering the compound path where `updateClusterBalance` triggers both `_updateOperatorVUnits` and `_executeLiquidation` in a single transaction, with one or more removed operators in the cluster's operator array.

**Key findings from scenario analysis:**

1. **Ghost write mechanism:** `_updateOperatorVUnits` (line 494-510) has NO guard for removed operators. It writes deviation deltas to `operatorEthVUnits[removedOpId]` even after `removeOperator` deleted that slot. This creates ghost state in storage.

2. **Coincidental cleanup:** When `deltaAbs == deviation` (only true when storedVUnits == baselineVUnits), the ghost write from `_updateOperatorVUnits` is exactly canceled by the subtraction in `_executeLiquidation`. This masks the bug in simple test cases (RMA-001, RMA-010).

3. **Underflow revert:** When `deltaAbs != deviation` (the common case for clusters with prior non-baseline explicit EB), `_executeLiquidation` attempts to subtract a larger value than what was ghost-written, causing an arithmetic underflow revert. This blocks EB updates entirely (RMA-008, RMA-013, RMA-028).

4. **Persistent ghost state:** When auto-liquidation does NOT fire, the ghost write persists indefinitely with no cleanup mechanism. This can corrupt future operator re-registrations (RMA-014, RMA-024).

5. **Guard asymmetry:** The `ethSnapshot.block != 0` guard protects `ethValidatorCount` in `_liquidateAfterEBUpdateIfNeeded` (line 541) but does NOT protect `operatorEthVUnits` in either `_updateOperatorVUnits` or `_executeLiquidation`. Both functions iterate ALL operators unconditionally.

6. **Fix:** Add the same guard to both functions:
   - `_updateOperatorVUnits`: `if (s.operators[operatorId].ethSnapshot.block == 0) continue;`
   - `_executeLiquidation` deviation loop (line 586): `if (s.operators[operatorIds[i]].ethSnapshot.block == 0) continue;`

   Alternatively, since `removeOperator` already deletes `operatorEthVUnits`, skipping removed operators in both loops ensures no ghost writes and no underflow subtractions.
