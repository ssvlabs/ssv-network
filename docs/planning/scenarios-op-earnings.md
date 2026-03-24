# Operator Earnings Scenarios (OE-001 – OE-035)

Exhaustive test coverage for operator earnings: withdrawal mechanics, accrual formulas, EB-weighted vUnits, fee changes mid-accrual, removal settlement, mixed ETH/SSV, precision edges, and concurrent multi-cluster earning.

**Code references:**
- `contracts/modules/SSVOperators.sol` — `withdrawOperatorEarnings`, `withdrawAllOperatorEarnings`, `withdrawAllVersionOperatorEarnings`, `withdrawOperatorEarningsSSV`, `withdrawAllOperatorEarningsSSV`, `removeOperator`, `_withdrawOperatorEarnings`
- `contracts/libraries/OperatorLib.sol` — `updateSnapshotSt` (ETH), `updateSnapshotStSSV` (SSV), `updateSnapshot` (memory), `ensureETHDefaults`
- SPEC §10 — Fee Settlement Rule, ETH Operator Earnings (with EB), Accounting Formulas
- FLOWS §4.7–§4.9 — Withdraw Operator Earnings (ETH, SSV, All-Version)
- FLOWS §4.2 — Remove Operator (final settlement)

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| OE-001 | withdrawOperatorEarnings | Partial ETH withdrawal — deducts exact amount, keeps remainder | `entry:withdrawOperatorEarnings; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | SSVOperators.sol:235-237, OperatorLib.sol:52-72 |
| OE-002 | withdrawAllOperatorEarnings | Full ETH withdrawal — zeroes snapshot balance | `entry:withdrawAllOperatorEarnings; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | SSVOperators.sol:242-244, OperatorLib.sol:52-72 |
| OE-003 | withdrawOperatorEarnings | Withdraw more ETH than earned — reverts InsufficientBalance | `entry:withdrawOperatorEarnings; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | No | SSVOperators.sol:315 |
| OE-004 | withdrawAllOperatorEarnings | Withdraw all when ETH balance is zero — reverts InsufficientBalance | `entry:withdrawAllOperatorEarnings; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | No | SSVOperators.sol:312 |
| OE-005 | withdrawOperatorEarningsSSV | Partial SSV withdrawal — deducts exact amount from SSV snapshot | `entry:withdrawOperatorEarningsSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | SSVOperators.sol:280-282, OperatorLib.sol:39-45 |
| OE-006 | withdrawAllOperatorEarningsSSV | Full SSV withdrawal — zeroes SSV snapshot balance | `entry:withdrawAllOperatorEarningsSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | SSVOperators.sol:287-289, OperatorLib.sol:39-45 |
| OE-007 | withdrawOperatorEarningsSSV | Withdraw more SSV than earned — reverts InsufficientBalance | `entry:withdrawOperatorEarningsSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | No | SSVOperators.sol:335 |
| OE-008 | withdrawAllOperatorEarningsSSV | Withdraw all SSV when balance is zero — reverts InsufficientBalance | `entry:withdrawAllOperatorEarningsSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | No | SSVOperators.sol:333 |
| OE-009 | withdrawAllVersionOperatorEarnings | Withdraw both ETH+SSV in single call — both snapshots zeroed | `entry:withdrawAllVersionOperatorEarnings; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | SSVOperators.sol:249-275 |
| OE-010 | withdrawAllVersionOperatorEarnings | ETH-only operator — only ETH branch runs, SSV snapshot untouched | `entry:withdrawAllVersionOperatorEarnings; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | SSVOperators.sol:257-261 |
| OE-011 | withdrawAllVersionOperatorEarnings | SSV-only (legacy) operator — only SSV branch runs, ethSnapshot.block stays 0 | `entry:withdrawAllVersionOperatorEarnings; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | SSVOperators.sol:263-267 |
| OE-012 | withdrawOperatorEarnings | ETH-only operator calls SSV withdraw — reverts InsufficientBalance (snapshot.block == 0) | `entry:withdrawOperatorEarningsSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | No | SSVOperators.sol:323 |
| OE-013 | withdrawOperatorEarningsSSV | SSV-only operator calls ETH withdraw — reverts InsufficientBalance (ethSnapshot.block == 0) | `entry:withdrawOperatorEarnings; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | No | SSVOperators.sol:303 |
| OE-014 | updateSnapshotSt | Basic accrual: N blocks x M validators x fee_rate (implicit EB, all default) | `entry:updateSnapshotSt; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | OperatorLib.sol:52-72 |
| OE-015 | updateSnapshotSt | Accrual with explicit EB — deviation-weighted vUnits affect earnings proportionally | `entry:updateSnapshotSt; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | OperatorLib.sol:60-69 |
| OE-016 | updateSnapshotSt | Accrual with mixed EB: one cluster EB=32, another EB=64, same operator | `entry:updateSnapshotSt; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | OperatorLib.sol:60-69 |
| OE-017 | updateSnapshotSt | Accrual with zero effectiveVUnits — no balance change even if blocks pass | `entry:updateSnapshotSt; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | OperatorLib.sol:67-70 |
| OE-018 | removeOperator | Final settlement on removal — both ETH+SSV settled and transferred to owner | `entry:removeOperator; version:both; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | No | SSVOperators.sol:71-104, FLOWS §4.2 |
| OE-019 | removeOperator | Removal with no earnings — zero balances, no transfer, no revert | `entry:removeOperator; version:both; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | No | SSVOperators.sol:97-102 |
| OE-020 | removeOperator | Removed operator withdraw — checkOwner reverts OperatorDoesNotExist (both blocks == 0) | `entry:withdrawOperatorEarnings; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:yes` | No | OperatorLib.sol:112-113 |
| OE-021 | executeOperatorFee + withdraw | Fee change mid-accrual — old rate settled before new rate takes effect | `entry:executeOperatorFee; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | SSVOperators.sol:146-173, SPEC §10 Fee Settlement Rule |
| OE-022 | reduceOperatorFee + withdraw | Fee reduction mid-accrual — old rate settled, new lower rate for future blocks | `entry:reduceOperatorFee; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | SSVOperators.sol:192-214 |
| OE-023 | updateSnapshotSt | Multiple fee changes within accrual period — earnings are sum of segments | `entry:executeOperatorFee; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | OperatorLib.sol:52-72, SPEC §10 |
| OE-024 | registerValidator + withdraw | Mixed ETH/SSV clusters on same operator — both snapshots accrue independently | `entry:withdrawAllVersionOperatorEarnings; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | SSVOperators.sol:249-275 |
| OE-025 | updateSnapshotSt | Concurrent earnings from 3 clusters sharing operator — total = sum of per-cluster contributions | `entry:updateSnapshotSt; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | OperatorLib.sol:52-72 |
| OE-026 | updateSnapshotSt | Concurrent earnings with different EB values — weighted accumulation per cluster | `entry:updateSnapshotSt; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | OperatorLib.sol:60-69 |
| OE-027 | withdrawOperatorEarnings | Precision: dust amount (1 wei packed) — survives pack/unpack round-trip | `entry:withdrawOperatorEarnings; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | SSVOperators.sol:306, SSVPackedLib |
| OE-028 | withdrawOperatorEarnings | Precision: large accumulated balance near uint64 max — no overflow in accrual | `entry:withdrawOperatorEarnings; version:eth; eb:implicit; cluster:active; ops:13; remove_mode:none; revert:no` | No | OperatorLib.sol:68, SSVCoreTypes._safeUint64 |
| OE-029 | withdrawOperatorEarnings | Precision: small fee rate x many blocks — verify no truncation to zero | `entry:withdrawOperatorEarnings; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | OperatorLib.sol:58-69 |
| OE-030 | withdrawOperatorEarnings | Non-owner caller — reverts CallerNotOwnerWithData | `entry:withdrawOperatorEarnings; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | No | OperatorLib.sol:115 |
| OE-031 | removeOperator | Removal with explicit EB — operatorEthVUnits deleted, final settlement includes deviation | `entry:removeOperator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | No | SSVOperators.sol:87-93 |
| OE-032 | withdrawOperatorEarnings | Successive partial withdrawals — each deducts correctly from running balance | `entry:withdrawOperatorEarnings; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | No | SSVOperators.sol:319 |
| OE-033 | updateSnapshotSt | Accrual after cluster liquidation — operator stops earning from liquidated cluster's validators | `entry:updateSnapshotSt; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | No | OperatorLib.sol:233-262 |
| OE-034 | updateSnapshotSt | Accrual across cluster migration (SSV->ETH) — operator earns SSV before migration, ETH after | `entry:updateSnapshotSt; version:both; eb:implicit; cluster:migrated; ops:4; remove_mode:none; revert:no` | No | OperatorLib.sol:343-384 |
| OE-035 | withdrawAllVersionOperatorEarnings | Parametric operator count (4/7/10/13) — earnings scale linearly with cluster size | `entry:withdrawAllVersionOperatorEarnings; version:eth; eb:implicit; cluster:active; ops:parametric; remove_mode:none; revert:no` | No | SSVOperators.sol:249-275 |

---

## Detailed Scenarios

### OE-009: Withdraw All Version Operator Earnings (ETH + SSV)

**Purpose:** Verify `withdrawAllVersionOperatorEarnings` correctly settles and transfers both ETH and SSV earnings in a single call, zeroing both snapshot balances.

**Preconditions:**
1. Register operator with ETH fee (creates ethSnapshot.block != 0)
2. Operator has active SSV-version cluster (legacy) — sets snapshot.block != 0, validatorCount > 0
3. Operator has active ETH-version cluster — ethValidatorCount > 0
4. Mine N blocks so both SSV and ETH earnings accrue
5. Operator owner is msg.sender

**Steps:**
1. Record `owner.balance` (ETH) and `owner.ssvBalance` (SSV token) before call
2. Record `contract.balance` (ETH) and contract SSV balance before call
3. Call `withdrawAllVersionOperatorEarnings(operatorId)` from operator owner
4. Capture emitted events

**Expected Results:**
- SSV branch: `updateSnapshotStSSV` called, `snapshot.balance` captured, then set to `PACKED_SSV_ZERO`
- ETH branch: `updateSnapshotSt` called, `ethSnapshot.balance` captured, then set to `PACKED_ETH_ZERO`
- `OperatorWithdrawnSSV(owner, operatorId, ssvAmount)` emitted with correct SSV amount
- `OperatorWithdrawn(owner, operatorId, ethAmount)` emitted with correct ETH amount
- `owner.balance == previous + ethAmount`
- `owner.ssvBalance == previous + ssvAmount`
- `contract.balance == previous - ethAmount`
- Post-call: `operator.ethSnapshot.balance == 0`, `operator.snapshot.balance == 0`
- Post-call: `operator.ethSnapshot.block != 0`, `operator.snapshot.block != 0` (blocks preserved)

**Tags:** `entry:withdrawAllVersionOperatorEarnings; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no`

**References:** SSVOperators.sol:249-275, FLOWS §4.9

---

### OE-015: Accrual with Explicit EB — Deviation-Weighted vUnits

**Purpose:** Verify that when clusters have explicit effective balances (non-default), operator earnings accrue proportionally to the deviation-weighted `effectiveVUnits` rather than raw `ethValidatorCount`.

**Preconditions:**
1. Register operator with fee `F`
2. Register 1 ETH cluster with 1 validator on this operator
3. Call `updateClusterBalance` with `effectiveBalance = 48` (1.5x the default 32)
   - This sets `clusterEB.vUnits = 15000` (48/32 * BPS_DENOMINATOR)
   - Deviation from default: `15000 - 10000 = 5000` stored in `seb.operatorEthVUnits[operatorId]`
   - `effectiveVUnits = 5000 + (1 * 10000) = 15000`
4. Mine 100 blocks

**Steps:**
1. Read operator ETH snapshot balance before mining
2. Mine 100 blocks
3. Trigger snapshot update (via withdraw or another cluster operation)
4. Read operator ETH snapshot balance after

**Expected Results:**
- `blockDiffEthFee = 100 * packedFee`
- `effectiveVUnits = storedDeviation + (ethValidatorCount * BPS_DENOMINATOR) = 5000 + 10000 = 15000`
- `delta = (blockDiffEthFee * 15000) / 10000 = blockDiffEthFee * 1.5`
- Compare to implicit EB baseline: `blockDiffEthFee * 10000 / 10000 = blockDiffEthFee * 1.0`
- Earnings are exactly 1.5x what they would be with default EB=32

**Verification formula:**
```
earned = (blocks * packedFee * effectiveVUnits) / BPS_DENOMINATOR
       = (100 * packedFee * 15000) / 10000
```

**Tags:** `entry:updateSnapshotSt; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no`

**References:** OperatorLib.sol:52-72, SPEC §10 "ETH Operator Earnings (with EB)"

---

### OE-018: Final Settlement on Operator Removal

**Purpose:** Verify `removeOperator` performs final snapshot settlement for both ETH and SSV, transfers all accrued earnings to the owner, then resets all operator state while preserving `operator.owner` and snapshot indices.

**Preconditions:**
1. Register operator with ETH fee
2. Operator serves both SSV-legacy and ETH clusters (both snapshot.block and ethSnapshot.block are non-zero)
3. Mine N blocks to accumulate meaningful earnings in both versions
4. `seb.operatorEthVUnits[operatorId]` may or may not have deviation

**Steps:**
1. Record owner ETH balance and SSV token balance
2. Call `removeOperator(operatorId)` from operator owner
3. Capture all emitted events

**Expected Results:**
- SSV snapshot updated: `updateSnapshotStSSV` called, `currentBalanceSSV` captured
- ETH snapshot updated: `updateSnapshotSt` called, `currentBalanceETH` captured
- `_resetOperatorState` called:
  - `ethSnapshot.block = 0`, `ethSnapshot.balance = 0`
  - `snapshot.block = 0`, `snapshot.balance = 0`
  - `ethFee = 0`, `fee = 0`
  - `ethValidatorCount = 0`, `validatorCount = 0`
- `seb.operatorEthVUnits[operatorId]` deleted
- `operatorFeeChangeRequests[operatorId]` deleted
- `operatorsWhitelist[operatorId]` deleted
- If `currentBalanceETH > 0`: `_transferOperatorBalanceUnsafe` called, `OperatorWithdrawn` emitted
- If `currentBalanceSSV > 0`: `_transferOperatorTokenBalanceUnsafe` called, `OperatorWithdrawnSSV` emitted
- `OperatorRemoved(operatorId)` emitted
- `operator.owner` is preserved (non-zero) after removal
- `ethSnapshot.index` and `snapshot.index` are preserved (for cluster index continuity)
- Post-removal: `checkOwner` reverts `OperatorDoesNotExist` (both blocks == 0)
- Post-removal: `withdrawOperatorEarnings` reverts (operator effectively does not exist)

**Tags:** `entry:removeOperator; version:both; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no`

**References:** SSVOperators.sol:71-104, FLOWS §4.2

---

### OE-021: Fee Change Mid-Accrual Period

**Purpose:** Verify that when `executeOperatorFee` is called, the ETH snapshot is settled at the old fee rate before the new fee is stored, and subsequent accrual uses the new rate. No earnings are lost or double-counted.

**Preconditions:**
1. Register operator with initial fee `F1`
2. Register cluster with 1 validator
3. Mine `B1` blocks (accrual at rate F1)
4. `declareOperatorFee` with new fee `F2` (within increase limit)
5. Advance time past `declareOperatorFeePeriod` but within `executeOperatorFeePeriod`

**Steps:**
1. Record operator ETH snapshot balance and block after initial accrual period
2. Call `executeOperatorFee(operatorId)` — this calls `updateSnapshotSt` internally
3. Mine `B2` additional blocks (accrual at rate F2)
4. Call `withdrawAllOperatorEarnings(operatorId)`
5. Verify total withdrawn

**Expected Results:**
- On `executeOperatorFee`:
  - `updateSnapshotSt` settles earnings: `balance += (currentBlock - ethSnapshot.block) * packedF1 * effectiveVUnits / BPS`
  - `ethSnapshot.block` updated to current block
  - `operator.ethFee = packedF2` stored AFTER settlement
- After mining B2 more blocks and withdrawing:
  - Total earnings = segment1 + segment2
  - `segment1 = B1_effective * packedF1 * effectiveVUnits / BPS`
  - `segment2 = B2 * packedF2 * effectiveVUnits / BPS`
- No gap blocks (settlement block == fee change block)
- No double-counted blocks

**Verification:**
```
totalEarned = (blocksFee1 * packedFee1 * vUnits / BPS) + (blocksFee2 * packedFee2 * vUnits / BPS)
```

**Tags:** `entry:executeOperatorFee; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no`

**References:** SSVOperators.sol:146-173, OperatorLib.sol:52-72, SPEC §10 "Fee Settlement Rule"

---

### OE-025: Concurrent Earnings from Multiple Clusters Sharing Operator

**Purpose:** Verify that an operator serving 3 independent clusters (all implicit EB) accumulates earnings as `blocks * fee * totalValidatorCount` — each cluster's validator count is additive.

**Preconditions:**
1. Register operator with fee `F`
2. Register cluster A (owner1) with 1 validator on this operator (4-op set)
3. Register cluster B (owner2) with 2 validators on this operator (same 4-op set)
4. Register cluster C (owner3) with 1 validator on this operator (same 4-op set)
5. All clusters use implicit EB (default 32 ETH)
6. After all registrations: `operator.ethValidatorCount = 4`

**Steps:**
1. Record operator ETH snapshot balance and block
2. Mine 50 blocks
3. Trigger snapshot update (via any cluster operation or direct withdraw)
4. Compute expected earnings

**Expected Results:**
- All validators contribute at default vUnits (BPS_DENOMINATOR each)
- `effectiveVUnits = 0 + (4 * 10000) = 40000` (storedDeviation=0, implicit EB)
- `blockDiffEthFee = 50 * packedFee`
- `delta = (blockDiffEthFee * 40000) / 10000 = blockDiffEthFee * 4`
- This equals `50 * packedFee * 4` in packed units — confirming linear scaling with validator count
- Withdrawing full balance: amount = `unpack(delta)`
- ETH conservation: `contract.balance` decreased by exactly `unpack(delta)`

**Edge checks:**
- Add a 4th cluster mid-way through the period — verify segmented accrual (first half with 4 validators, second half with 5)
- Remove cluster B's validators mid-way — verify accrual drops from 4 to 2

**Tags:** `entry:updateSnapshotSt; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no`

**References:** OperatorLib.sol:52-72, OperatorLib.sol:233-262

---

### OE-026: Concurrent Earnings with Different EB Values

**Purpose:** Verify that an operator serving multiple clusters with different explicit effective balances accumulates earnings weighted by the sum of per-cluster deviation-adjusted vUnits.

**Preconditions:**
1. Register operator with fee `F`
2. Register cluster A (1 validator, EB=32 default) — no deviation contribution
3. Register cluster B (1 validator, EB=64 → vUnits=20000) — deviation = +10000
4. Register cluster C (1 validator, EB=16 → vUnits=5000) — deviation = -5000
5. After all EB updates: `seb.operatorEthVUnits[operatorId] = 10000 + (-5000) = 5000`
6. `effectiveVUnits = 5000 + (3 * 10000) = 35000`

**Steps:**
1. Mine 100 blocks
2. Trigger snapshot update
3. Compute earned amount

**Expected Results:**
- `blockDiffEthFee = 100 * packedFee`
- `delta = (blockDiffEthFee * 35000) / 10000 = blockDiffEthFee * 3.5`
- Compare to all-default baseline: `blockDiffEthFee * 3.0` (3 validators * 10000 / 10000)
- The EB=64 cluster contributed 2x weight; the EB=16 cluster contributed 0.5x weight; the EB=32 cluster contributed 1x weight. Sum = 3.5x.
- Earnings exactly match the formula: `(blocks * fee * effectiveVUnits) / BPS_DENOMINATOR`

**Verification:**
```
effectiveVUnits = storedDeviation + (ethValidatorCount * BPS_DENOMINATOR)
                = 5000 + (3 * 10000) = 35000
earned = (100 * packedFee * 35000) / 10000
```

**Tags:** `entry:updateSnapshotSt; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no`

**References:** OperatorLib.sol:52-72, SPEC §10 "ETH Operator Earnings (with EB)"

---

### OE-031: Operator Removal with Explicit EB — vUnits Cleanup

**Purpose:** Verify that removing an operator with non-zero `operatorEthVUnits` (deviation from explicit EB clusters) correctly settles final earnings using the full `effectiveVUnits` and then deletes the deviation storage.

**Preconditions:**
1. Register operator with fee `F`
2. Register cluster with 1 validator on this operator
3. Set explicit EB=64 via `updateClusterBalance` → `seb.operatorEthVUnits[operatorId] = 10000` (deviation)
4. Mine N blocks
5. `effectiveVUnits = 10000 + (1 * 10000) = 20000` at time of removal

**Steps:**
1. Record owner ETH balance
2. Call `removeOperator(operatorId)`
3. Check `seb.operatorEthVUnits[operatorId]` after removal

**Expected Results:**
- `updateSnapshotSt` is called with the current `operatorEthVUnits[operatorId] = 10000`
- Final earnings: `(blockDiff * packedFee * 20000) / 10000 = blockDiff * packedFee * 2.0`
- The deviation-weighted earnings are correctly included in the final settlement
- `currentBalanceETH` includes all accumulated earnings (including the final segment)
- `seb.operatorEthVUnits[operatorId]` is deleted (set to 0) via `delete seb.operatorEthVUnits[operatorId]`
- `OperatorWithdrawn` emitted with the full settlement amount
- Owner receives the correct ETH amount
- After removal: re-registering the same operator ID would start with clean vUnits

**Tags:** `entry:removeOperator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no`

**References:** SSVOperators.sol:71-104 (line 93: `delete seb.operatorEthVUnits[operatorId]`), OperatorLib.sol:52-72

---

### OE-033: Accrual Stops After Cluster Liquidation

**Purpose:** Verify that after a cluster is liquidated, the operator stops earning from that cluster's validators. The liquidation decrements `ethValidatorCount`, so future snapshot updates do not include the liquidated cluster's contribution.

**Preconditions:**
1. Register operator with fee `F`
2. Register cluster A (1 validator, implicit EB) — `ethValidatorCount = 1`
3. Register cluster B (1 validator, implicit EB) — `ethValidatorCount = 2`
4. Mine blocks, verify combined accrual
5. Cluster A gets liquidated — `updateClusterOperators` is called with `increaseValidatorCount=false`, decrements `ethValidatorCount` to 1

**Steps:**
1. Record operator snapshot after cluster A liquidation
2. Mine 100 more blocks
3. Trigger snapshot update (via cluster B operation or withdrawal)
4. Compute earnings for the post-liquidation period

**Expected Results:**
- Pre-liquidation: `effectiveVUnits = 0 + (2 * 10000) = 20000`
- Liquidation triggers `updateClusterOperators(operatorIds, false, 1, ...)`:
  - `updateSnapshotSt` called — settles earnings at 2-validator rate up to liquidation block
  - `ethValidatorCount` decremented from 2 to 1
- Post-liquidation: `effectiveVUnits = 0 + (1 * 10000) = 10000`
- Post-liquidation earnings: `100 * packedFee * 10000 / 10000 = 100 * packedFee` (half of pre-liquidation rate)
- Total earnings = pre-liquidation segment + post-liquidation segment
- Cluster A's validators no longer contribute to operator earnings after liquidation
- If cluster A is reactivated later, `ethValidatorCount` increments back — accrual rate increases again

**Tags:** `entry:updateSnapshotSt; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no`

**References:** OperatorLib.sol:233-262 (updateClusterOperators), SPEC §10

---

## Coverage Matrix

| Dimension | Scenarios Covering |
|-----------|-------------------|
| **Withdraw partial ETH** | OE-001, OE-027, OE-028, OE-029, OE-032 |
| **Withdraw all ETH** | OE-002, OE-004 |
| **Withdraw partial SSV** | OE-005, OE-007 |
| **Withdraw all SSV** | OE-006, OE-008 |
| **Withdraw all-version (both)** | OE-009, OE-010, OE-011, OE-024, OE-035 |
| **Revert: InsufficientBalance** | OE-003, OE-004, OE-007, OE-008, OE-012, OE-013 |
| **Revert: access control** | OE-020, OE-030 |
| **Accrual formula (implicit EB)** | OE-014, OE-025, OE-029 |
| **Accrual formula (explicit EB)** | OE-015, OE-016, OE-017, OE-026 |
| **Fee change mid-accrual** | OE-021, OE-022, OE-023 |
| **Operator removal settlement** | OE-018, OE-019, OE-020, OE-031 |
| **Mixed ETH/SSV** | OE-009, OE-024, OE-034 |
| **Precision (dust/large/truncation)** | OE-027, OE-028, OE-029 |
| **Concurrent multi-cluster** | OE-025, OE-026, OE-033 |
| **Liquidated cluster** | OE-033 |
| **Migrated cluster** | OE-034 |
| **Parametric ops count** | OE-035 |

---

## Audit Gaps (Added post-audit)

> Identified by code-level branch analysis. These scenarios cover branches and edge conditions not addressed by the original OE-001 through OE-035 set.

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| OE-036 | withdrawAllVersionOperatorEarnings | Call by non-owner — revert `CallerNotOwnerWithData`. Verifies access control on the combined withdraw path. | `entry:withdrawAllVersionOperatorEarnings; revert:yes` | [ ] | SSVOperators.sol:249-275, OperatorLib.sol:115 |
| OE-037 | withdrawAllVersionOperatorEarnings | Call on non-existent operator (never registered or removed) — revert `OperatorDoesNotExist` via `checkOwner` | `entry:withdrawAllVersionOperatorEarnings; revert:yes` | [ ] | SSVOperators.sol:249, OperatorLib.sol:111-116 |
| OE-038 | withdrawAllVersionOperatorEarnings | Call when both ETH and SSV balances are zero — silent no-op (no revert, unlike individual `withdrawOperatorEarnings`/`withdrawAllOperatorEarnings` which revert `InsufficientBalance`). Documents asymmetry. | `entry:withdrawAllVersionOperatorEarnings; revert:no` | [ ] | SSVOperators.sol:257-267 |
| OE-039 | removeOperator | Remove SSV-only legacy operator where `ethSnapshot.block==0` and `snapshot.block!=0` — only SSV settlement branch executes. Verify ETH branch is skipped entirely, no ETH transfer. | `entry:removeOperator; version:ssv; revert:no` | [ ] | SSVOperators.sol:81-84, 86-89, 97-102 |
| OE-040 | updateSnapshotSt | Call `updateSnapshotSt` in same block as last snapshot update (`blockDiffEthFee==0`) — no accrual, balance unchanged. Verify zero-block-diff path. | `entry:withdrawOperatorEarnings; revert:no` | [ ] | OperatorLib.sol:55-58 |
| OE-041 | updateSnapshotSt | Large accrual where `_safeUint64(delta)` overflows — revert from SafeCast. Verifies overflow protection in the accrual math. | `entry:withdrawOperatorEarnings; revert:yes` | [ ] | OperatorLib.sol:68, SSVCoreTypes._safeUint64 |

---

## ask-codex Review Findings

### Corrections

- **OE-026**: UNREACHABLE as written — assumes EB=16 and negative deviation, but SSVClusters.sol:453-458 reject any EB below 32 ETH/validator. The valid space is baseline-only or baseline-plus-positive-deviation. Mark as unreachable.

### Additional Scenarios

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| OE-042 | withdrawOperatorEarnings | Withdraw with amount not divisible by 100,000 → revert `MaxPrecisionExceeded` from SSVPackedLib.sol:11. Tests packing-validation branch on ETH withdrawal. | `entry:withdrawOperatorEarnings; revert:yes` | [ ] | SSVOperators.sol:306, SSVPackedLib.sol:9-13 |
| OE-043 | withdrawAllOperatorEarningsSSV | Withdraw SSV with amount not divisible by 100,000 → revert `MaxPrecisionExceeded`. Tests packing-validation on SSV withdrawal. | `entry:withdrawAllOperatorEarningsSSV; revert:yes` | [ ] | SSVOperators.sol:326, SSVPackedLib.sol:9-13 |
| OE-044 | withdrawAllVersionOperatorEarnings | Call when both ETH and SSV snapshots exist but both settled balances are zero → silent no-op (no revert, no transfer). Documents asymmetry with individual withdraw-all. | `entry:withdrawAllVersionOperatorEarnings; revert:no` | [ ] | SSVOperators.sol:269, 272 |

---

## Coverage Verification (W4)

| ID | Tested | remove_mode | Test File | Notes |
|----|--------|-------------|-----------|-------|
| OE-001 | yes | none | `test/unit/SSVOperators/withdrawOperatorEarnings.test.ts` ("withdrawOperatorEarnings withdraws specific amount and emits event"), `test/e2e/operators/operator-economics.test.ts` ("Verifies exact earnings math with partial and full withdrawal"), `test/e2e/operators/operator-lifecycle.test.ts` ("Accumulates earnings and supports partial + full withdrawal") | Partial withdrawal, balance check after deduction, event emitted |
| OE-002 | yes | none | `test/unit/SSVOperators/withdrawOperatorEarnings.test.ts` ("withdrawAllOperatorEarnings withdraws full balance and resets snapshot"), `test/integration/SSVNetwork/operators.test.ts` ("withdrawAllOperatorEarnings: verifies complete balance drain") | Full withdrawal zeros balance, exact ETH transfer verified |
| OE-003 | yes | none | `test/unit/SSVOperators/withdrawOperatorEarnings.test.ts` ("Is reverted with 'InsufficientBalance'"), `test/integration/SSVNetwork/operators.test.ts` ("Cannot withdraw more than available earnings") | Withdraw more than earned -> InsufficientBalance |
| OE-004 | partial:weak | none | `test/unit/SSVOperators/withdrawOperatorEarnings.test.ts` ("Is reverted with 'InsufficientBalance'") | Tests withdrawal with zero balance, but uses withdrawOperatorEarnings (partial) not withdrawAllOperatorEarnings. withdrawAll with 0 is not tested for revert — it may succeed as no-op |
| OE-005 | yes | none | `test/unit/SSVOperators/withdrawOperatorEarningsSSV.test.ts` ("withdrawOperatorEarningsSSV withdraws specific amount and emits event") | Partial SSV withdrawal, balance verified |
| OE-006 | yes | none | `test/unit/SSVOperators/withdrawOperatorEarningsSSV.test.ts` ("withdrawAllOperatorEarningsSSV withdraws full balance and resets snapshot") | Full SSV withdrawal zeros snapshot balance |
| OE-007 | yes | none | `test/unit/SSVOperators/withdrawOperatorEarningsSSV.test.ts` ("Is reverted with 'InsufficientBalance'") | Withdraw more SSV than earned -> InsufficientBalance |
| OE-008 | partial:weak | none | — | No explicit test for withdrawAllOperatorEarningsSSV with zero balance; OE-007 tests partial withdrawal overflow, not withdrawAll zero |
| OE-009 | yes | none | `test/unit/SSVOperators/withdrawAllVersionOperatorEarnings.test.ts` ("Withdraws both ETH and SSV earnings when both have balances"), `test/e2e/operators/operator-economics.test.ts` ("Withdraws both ETH and SSV earnings in single call") | Both ETH+SSV zeroed, events emitted, owner receives both |
| OE-010 | yes | none | `test/e2e/operators/operator-economics.test.ts` ("Only ETH earnings, no SSV — SSV transfer skipped"), `test/unit/SSVOperators/withdrawAllVersionOperatorEarnings.test.ts` ("Withdraws both ETH and SSV earnings and resets balances") | ETH-only path verified |
| OE-011 | yes | none | `test/unit/SSVOperators/withdrawAllVersionOperatorEarnings.test.ts` ("Does not initialize ETH snapshot for a legacy SSV-only operator", "Pays out SSV balance for a legacy SSV-only operator") | SSV-only operator: ethSnapshot stays block=0, ethFee stays 0 |
| OE-012 | no | none | — | No test for ETH-only operator calling SSV withdraw to verify InsufficientBalance |
| OE-013 | no | none | — | No test for SSV-only operator calling ETH withdraw to verify InsufficientBalance |
| OE-014 | yes | none | `test/integration/SSVNetwork/operators.test.ts` ("Operator earnings accrue correctly over multiple block periods", "All 4 operators earn equally"), `test/e2e/operators/operator-edge-cases.test.ts` ("Operator earnings are exact with standard vUnits") | Basic accrual formula verified with exact math: blocks * packedFee * vUnits / BPS |
| OE-015 | yes | none | `test/unit/SSVClusters/ebWeightedOperatorEarnings.test.ts` ("operator earns proportionally from two clusters with EB=32 and EB=64") | EB=64 cluster produces 2x vUnits; earnings verified proportional to effectiveVUnits |
| OE-016 | yes | none | `test/unit/SSVClusters/ebWeightedOperatorEarnings.test.ts` ("operator earns from mixed implicit and explicit EB clusters correctly") | Mixed EB clusters (implicit 32 + explicit 64 + explicit 32); exact vUnits sum verified |
| OE-017 | yes | none | `test/unit/SSVClusters/ebWeightedOperatorEarnings.test.ts` ("operator with zero fee earns nothing despite EB > 32") | Zero fee + EB=64 -> zero earnings |
| OE-018 | yes | real | `test/e2e/operators/operator-lifecycle.test.ts` ("Removes operator with earnings, transfers funds, and cleans up state"), `test/e2e/operators/operator-economics.test.ts` ("Removes validators then operator, verifies final earnings withdrawal") | Final ETH settlement on removal, exact balance delta verified |
| OE-019 | yes | real | `test/e2e/operators/operator-lifecycle.test.ts` ("Remove operator with 0 earnings in both versions") | Removal with zero earnings: no OperatorWithdrawn event check, OperatorRemoved emitted |
| OE-020 | yes | real | `test/integration/SSVNetwork/operators.test.ts` ("Removed operator cannot have earnings withdrawn"), `test/e2e/operators/operator-economics.test.ts` ("double removal reverts OperatorDoesNotExist") | Withdraw after removal -> OperatorDoesNotExist |
| OE-021 | yes | none | `test/e2e/operators/operator-economics.test.ts` ("Verifies continuous fee accrual across fee change boundary"), `test/e2e/operators/operator-lifecycle.test.ts` ("Reduces fee immediately, preserving earnings at old fee") | Old rate settled before new rate applied; segmented earnings verified |
| OE-022 | yes | none | `test/e2e/operators/operator-lifecycle.test.ts` ("Reduces fee immediately, preserving earnings at old fee") | Reduce settles at old rate, new lower rate for future blocks, exact math |
| OE-023 | partial:weak | none | `test/unit/SSVClusters/ebWeightedOperatorEarnings.test.ts` ("earnings split correctly at fee change boundary with EB-weighted vUnits") | Tests one fee change with EB, verifies segmented earnings. Does not test multiple sequential fee changes |
| OE-024 | yes | none | `test/unit/SSVOperators/withdrawAllVersionOperatorEarnings.test.ts` ("Withdraws both ETH and SSV earnings when both have balances") | Both ETH+SSV snapshots zeroed in single call |
| OE-025 | yes | none | `test/e2e/operators/operator-economics.test.ts` ("Operator earns from two clusters, correct accounting on partial removal"), `test/integration/SSVNetwork/operators.test.ts` ("Operator earnings scale with validator count") | Multiple clusters sharing operator; earnings scale linearly with validator count |
| OE-026 | partial:weak | none | `test/unit/SSVClusters/ebWeightedOperatorEarnings.test.ts` ("operator earns from mixed implicit and explicit EB clusters correctly") | Tests mixed EB but with EB=32 (baseline) and EB=64, not EB=16 (which is unreachable per ask-codex finding). Scenario marked UNREACHABLE as written |
| OE-027 | yes | none | `test/unit/SSVOperators/withdrawOperatorEarnings.test.ts` ("Withdraws exactly 1 * ETH_DEDUCTED_DIGITS") | Dust amount (1 packed unit = 100,000 wei) survives pack/unpack |
| OE-028 | no | none | — | No test with large accumulated balance near uint64 max |
| OE-029 | yes | none | `test/e2e/operators/operator-edge-cases.test.ts` ("Precision is exact with standard vUnits regardless of fee magnitude") | Small and normal fee rates with multiple blocks; no truncation verified |
| OE-030 | yes | none | `test/unit/SSVOperators/withdrawOperatorEarnings.test.ts` ("Is reverted with 'CallerNotOwnerWithData' when non-owner tries to withdraw ETH earnings", "...withdraw all ETH earnings") | Non-owner -> CallerNotOwnerWithData for both partial and full |
| OE-031 | partial:weak | real | `test/unit/SSVOperators/removeOperator.test.ts` ("Clears operatorEthVUnits when removing an operator") | Tests operatorEthVUnits deleted after removal. Uses mock vUnits, does not verify final settlement includes deviation-weighted earnings |
| OE-032 | yes | none | `test/unit/SSVOperators/withdrawOperatorEarnings.test.ts` ("withdrawOperatorEarnings withdraws specific amount") | Withdraws 2 packed units from 5 packed balance, verifies remainder = 3 |
| OE-033 | partial:mock | mock_zero | `test/unit/SSVClusters/removedOperatorImpact.test.ts` | Uses mockRemoveOperator (zeros fields but does NOT delete operatorEthVUnits). Tests cluster accounting after operator removal, but removal itself is mocked |
| OE-034 | no | none | — | No test for accrual across SSV->ETH cluster migration |
| OE-035 | no | none | — | No parametric test varying operator count (4/7/10/13) with earnings scaling |
| OE-036 | yes | none | `test/unit/SSVOperators/withdrawAllVersionOperatorEarnings.test.ts` ("Is reverted with 'CallerNotOwnerWithData'") | Non-owner withdrawAllVersion -> CallerNotOwnerWithData |
| OE-037 | no | none | — | No test for withdrawAllVersionOperatorEarnings on non-existent operator |
| OE-038 | yes | none | `test/unit/SSVOperators/withdrawAllVersionOperatorEarnings.test.ts` ("Succeeds when withdrawing with zero balances (no-op)"), `test/e2e/operators/operator-economics.test.ts` ("Zero earnings in both versions — no reverts, no transfers") | Both zero -> no revert, silent no-op |
| OE-039 | yes | real | `test/unit/SSVOperators/removeOperator.test.ts` ("Removes a legacy SSV-only operator without initializing ETH state") | SSV-only operator (ethSnapshot.block==0): only SSV settlement, no ETH transfer |
| OE-040 | yes | none | `test/unit/SSVOperators/withdrawOperatorEarnings.test.ts` ("Succeeds when withdrawing zero amount") | Same-block withdraw (0 amount) succeeds; zero blockDiff path exercised |
| OE-041 | no | none | — | No test for large accrual overflow via _safeUint64 |
| OE-042 | yes | none | `test/unit/SSVOperators/withdrawOperatorEarnings.test.ts` ("Is reverted with 'MaxPrecisionExceeded'") | ETH withdrawal with non-aligned amount -> MaxPrecisionExceeded |
| OE-043 | yes | none | `test/unit/SSVOperators/withdrawOperatorEarningsSSV.test.ts` ("Is reverted with 'MaxPrecisionExceeded'") | SSV withdrawal with non-aligned amount -> MaxPrecisionExceeded |
| OE-044 | yes | none | `test/unit/SSVOperators/withdrawAllVersionOperatorEarnings.test.ts` ("Succeeds when withdrawing with zero balances (no-op)") | Both snapshots exist, both balances zero -> no-op, no revert |
