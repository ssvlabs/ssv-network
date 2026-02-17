# Scenario Tests: Clusters + Migration

## Discrepancies (Code vs FLOWS.md)

> **FLAG FOR HUMAN REVIEW** — The following discrepancies were found by tracing the actual Solidity code line by line and comparing against `docs/FLOWS.md`.

### DISC-CM-1: Deposit Does NOT Settle Fees

- **FLOWS.md says (§1.4):** "1. Update operator snapshots. 2. Settle cluster fees. 3. `cluster.balance += msg.value`"
- **Code does (SSVClusters.sol:190-205):** The `deposit()` function does NOT update operator snapshots or settle cluster fees. It only validates the cluster hash, adds `msg.value` to `cluster.balance`, stores the new hash, and emits the event.
- **Likely correct:** Code — deposit is deliberately simple. Fee settlement only happens when the cluster state is read in a context that requires accuracy (withdraw, liquidate, etc.). The balance accrued from deposit just adds to the existing cluster balance and the next fee-relevant operation will settle.
- **Impact:** LOW — economically neutral. But tests should NOT assume fees are settled on deposit. The cluster balance after deposit is `old_cluster_balance + msg.value`, NOT `(old_cluster_balance - accrued_fees) + msg.value`. The hash stored reflects this unsettled state.

### DISC-CM-2: Deposit Does NOT Check `cluster.active`

- **FLOWS.md says (§1.4):** "Cluster must be active" as a precondition.
- **Code does (SSVClusters.sol:190-205):** There is NO `validateClusterIsNotLiquidated()` check. An inactive (liquidated) ETH cluster CAN receive deposits.
- **Likely correct:** Code — depositing into a liquidated cluster makes the balance non-zero, which sets up for reactivation. This is a design choice, not a bug.
- **Impact:** MEDIUM — FLOWS.md should be updated. Tests should verify that depositing into a liquidated cluster succeeds but the cluster remains inactive. The deposited balance is only accessible after reactivation.

### DISC-CM-3: Withdraw Operator Snapshot Update Path Is Inline, Not Via `updateClusterOperators`

- **FLOWS.md says (§1.5):** "1. Update operator snapshots. 2. Settle cluster fees."
- **Code does (SSVClusters.sol:220-234):** The `withdraw()` function does NOT call `OperatorLib.updateClusterOperators()`. Instead, it computes `clusterIndex` inline by iterating over operators and reading their `ethSnapshot.index` values WITHOUT updating the snapshots to storage. The operator snapshots are NOT written back — only the cumulative index is computed for fee settlement.
- **Likely correct:** Code — withdraw is read-only with respect to operator state. It only needs the current cumulative index to settle the cluster's fees. Operator earnings accumulation happens on the next operation that DOES update snapshots (liquidate, register, remove, etc.).
- **Impact:** HIGH for test design — operator earnings are NOT updated during withdraw. If testing operator earnings after a withdraw, they will NOT reflect the blocks since the last snapshot update. The burn rate calculation only reads `ethFee` for each operator.

### DISC-CM-4: Liquidation Does NOT Update Operator Snapshots Before `_executeLiquidation`

- **FLOWS.md says (§1.6):** "1. Update operator snapshots with fee settlement"
- **Code does (SSVClusters.sol:35-69):** `liquidate()` calls `OperatorLib.updateClusterOperators(operatorIds, false, cluster.validatorCount, s, sp)` which DOES update operator snapshots AND decrements `ethValidatorCount`. Then `_executeLiquidation` runs. So the operator snapshot update happens BEFORE the liquidation, but the `ethValidatorCount` decrement ALSO happens in `updateClusterOperators` (not in `_executeLiquidation`).
- **Likely correct:** Code — the flow is: (1) update operator snapshots + decrement validator counts → (2) settle cluster balance → (3) check liquidatability → (4) execute liquidation (DAO update, deviation cleanup, set inactive, transfer bounty).
- **Impact:** LOW — FLOWS.md order is slightly misleading but net effect is correct. Tests should note that operator `ethValidatorCount` is already decremented BEFORE the cluster balance is zeroed.

### DISC-CM-5: Reactivation `cluster.balance += msg.value` Adds To Existing Balance (Not Replace)

- **FLOWS.md says (§1.8):** "`cluster.balance = msg.value`" (implies replacement).
- **Code does (SSVClusters.sol:160):** `cluster.balance += msg.value`. Since the cluster was liquidated, its balance is 0 (set during liquidation). So `0 + msg.value = msg.value`. Net effect is the same, BUT if someone previously deposited into the liquidated cluster (DISC-CM-2), the balance would be `previous_deposit + msg.value`.
- **Likely correct:** Code — the `+=` is intentional to combine with any prior deposits into the liquidated cluster.
- **Impact:** MEDIUM — tests should verify the interaction between deposit-into-liquidated + reactivate. The reactivation balance will be the sum of all deposits plus the reactivation value.

### DISC-CM-6: Migration EB Deviation Only Applied If `vUnitsCluster > baseline`

- **FLOWS.md says (§2.1, step 7):** "If cluster had explicit EB snapshot with vUnits > baseline: Add deviation to `sp.daoTotalEthVUnits` and to each `seb.operatorEthVUnits[operatorId]`"
- **Code does (SSVClusters.sol:315-331):** The code only adds deviation if `vUnitsCluster > baseline`. But the FLOWS.md comment says "If vUnitsCluster == baseline, deviation is 0, nothing to add." The EB floor is 32 ETH so `vUnitsCluster >= baseline` always. What if `vUnitsCluster < baseline` due to a future protocol change? The code silently does nothing.
- **Likely correct:** Code — since EB floor is 32 ETH, deviation can never be negative after migration. But this is a tighter assumption than the liquidation flow's `_executeLiquidation` which handles both `moreThanBaseline` and `lessThanBaseline`.
- **Impact:** LOW — correct under current EB constraints. But the asymmetry between migration (only handles positive deviation) and liquidation (handles both directions) is worth noting.

### DISC-CM-7: Migration `updateClusterOperatorsMigration` Skips cumulativeIndexETH for Fresh ETH Operators

- **FLOWS.md says (§2.1):** Cluster index is set to cumulative ETH operator index.
- **Code does (OperatorLib.sol:392-401):** For operators that are newly initialized for ETH (first time, `ethSnapshot.block == 0`), `ensureETHDefaults` sets `ethSnapshot.block = block.number` but `ethSnapshot.index = 0`. The `cumulativeIndexETH` does NOT include these newly-initialized operators' index (which is 0). For operators that already had ETH snapshots, their updated index IS included.
- **Likely correct:** Code — since the newly initialized operator starts with index 0, not adding 0 to the cumulative total is arithmetically correct.
- **Impact:** LOW — but tests should verify the cluster's initial `cluster.index` is correct when some operators are ETH-new and some are ETH-existing. The cluster index should equal the sum of only the existing operators' indices.

---

## Global Invariants for This Partition

These invariants MUST be checked at the end of every scenario:

1. **INV-1: ETH Conservation**
   `contract.ETH_balance >= Σ(active ETH cluster balances) + Σ(operator ETH earnings unpacked) + staking_pool_ETH`

2. **INV-2: SSV Conservation**
   `contract.SSV_balance >= Σ(active SSV cluster balances) + Σ(operator SSV earnings unpacked) + Σ(staked SSV)`

3. **INV-3: Cluster Hash Integrity**
   For every active cluster: `s.ethClusters[key] == keccak256(abi.encodePacked(vc, nfi, idx, balance, active))`

4. **INV-4: Cluster Version Exclusivity**
   A cluster key exists in EITHER `s.clusters` OR `s.ethClusters`, never both.

5. **INV-5: DAO Validator Count Consistency**
   `ethDaoValidatorCount` is the sum of all active ETH cluster validator counts.

6. **INV-6: vUnit Consistency**
   `daoTotalEthVUnits == ethDaoValidatorCount × VUNITS_PRECISION + Σ(active cluster deviations)`
   Where deviation = `ebSnapshot.vUnits - validatorCount × VUNITS_PRECISION` for explicit EB clusters.

7. **INV-7: Operator Validator Count**
   For each operator: `ethValidatorCount == Σ(validatorCount of active ETH clusters using this operator)`

8. **INV-8: Operator vUnit Deviation**
   `operatorEthVUnits[opId] == Σ(cluster_deviation for each active ETH cluster using opId)`

---

## Scenarios

### CM-1: ETH Cluster Lifecycle — Create, Deposit, Advance, Withdraw, Verify Balance

**Modules Touched:** SSVValidators, SSVClusters, ClusterLib, OperatorLib, ProtocolLib
**Bug Class Covered:** Fee accumulation over time, precision loss in packed ETH calculations, off-by-one in block counting

#### Preconditions
- 4 operators registered, each with `ethFee = 1_000_000_000` (packed raw = 10,000 → unpacked = 1,000,000,000 wei)
- Network fee: `ethNetworkFee = 500_000_000` (packed raw = 5,000)
- `minimumBlocksBeforeLiquidation = 100`
- `minimumLiquidationCollateral = 100_000` (packed raw → unpacked = 100_000 × 100_000 = 10,000,000,000 wei = 10 gwei)
- Block at start: B0

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Register validator with EMPTY_CLUSTER, `msg.value = 10 ETH` | B0 | New ETH cluster: `{vc=1, nfi=currentNFI, idx=cumIdx, active=true, balance=10e18}`. ethDaoValidatorCount++. Each operator ethValidatorCount=1. |
| 2 | Deposit 5 ETH into cluster | B0+50 | `cluster.balance = 10e18 + 5e18 = 15e18` (NO fee settlement per DISC-CM-1). Hash updated. |
| 3 | Withdraw 2 ETH from cluster | B0+100 | Fees settled for 100 blocks. See assertions. |

#### Assertions (exact formulas with numbers)

**Constants:**
- `opFeeRaw = 10_000` per operator → cumBurnRate = 4 × 10_000 = 40_000
- `netFeeRaw = 5_000`
- vUnits = 1 × 10_000 = 10_000 (implicit, 1 validator at 32 ETH)
- ETH_DEDUCTED_DIGITS = 100_000

**At Step 3 (block B0+100), withdraw triggers fee settlement:**
- `clusterIndex (at B0+100)` = each operator's `ethSnapshot.index` at registration + 100 × opFeeRaw = initial_idx + 100 × 10_000
  - For 4 operators: cumulative clusterIndex = 4 × (100 × 10_000) = 4_000_000 (since initial indices were captured at registration)
  - Actually: clusterIndex delta = cumClusterIndex_now - cluster.index_at_registration
  - Since cluster.index was set at registration to the sum of operator indices at that time, and no other operations changed operator indices, the delta = sum of (100 blocks × feeRaw) = 4 × 100 × 10_000 = 4_000_000
- `networkFeeIndex delta` = 100 × 5_000 = 500_000
- `operatorFeeUnits = (4_000_000 × 10_000) / 10_000 = 4_000_000`
- `networkFeeUnits = (500_000 × 10_000) / 10_000 = 500_000`
- `totalFees = (4_000_000 + 500_000) × 100_000 = 450_000_000_000 = 450 gwei = 0.00000045 ETH`
- `balanceAfterFees = 15e18 - 450_000_000_000 = 14_999_999_550_000_000_000`
- `balanceAfterWithdraw = 14_999_999_550_000_000_000 - 2e18 = 12_999_999_550_000_000_000`

- [ ] `cluster.balance == 12_999_999_550_000_000_000`
- [ ] `contract.ETH_balance == initial - 2 ETH` (only withdrawal causes ETH transfer out)
- [ ] Operator snapshots NOT updated during withdraw (per DISC-CM-3)
- [ ] INV-1 through INV-8 hold

#### Edge Variations
- **Deposit at block 0 (same block as registration):** Balance = initial + deposit, no fee settlement
- **Withdraw entire balance (after fee settlement):** Should succeed if no validators or if remaining >= liquidation threshold
- **Multiple deposits before any withdraw:** All deposits accumulate without fee settlement

---

### CM-2: ETH Cluster — Withdraw Exactly To Liquidation Threshold (Boundary)

**Modules Touched:** SSVClusters, ClusterLib
**Bug Class Covered:** Off-by-one in liquidation threshold, `<` vs `<=` boundary

#### Preconditions
- 4 operators, each `ethFee = 1_000_000_000` (raw = 10_000)
- Network fee: raw = 5_000
- `minimumBlocksBeforeLiquidation = 100`
- `minimumLiquidationCollateral = 100_000` (unpacked = 10,000,000,000 = 10 gwei)
- 1 validator, implicit EB (vUnits = 10_000)
- Cluster created at B0 with 10 ETH

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Register validator, 10 ETH deposit | B0 | Cluster active, balance=10e18 |
| 2 | Withdraw `maxWithdrawable` | B0+10 | Balance = exact liquidation threshold (not liquidatable) |
| 3 | Attempt withdraw 1 more wei | B0+10 | Revert `InsufficientBalance` |

#### Assertions (exact formulas with numbers)

**At B0+10:**
- Fees for 10 blocks:
  - opFeeUnits = (4 × 10 × 10_000 × 10_000) / 10_000 = 400_000
  - netFeeUnits = (10 × 5_000 × 10_000) / 10_000 = 50_000
  - totalFees = (400_000 + 50_000) × 100_000 = 45_000_000_000
- balanceAfterFees = 10e18 - 45_000_000_000 = 9_999_999_955_000_000_000
- Liquidation threshold:
  - `burnRate = 40_000`, `networkFee = 5_000`, `vUnits = 10_000`
  - `thresholdUnits = (100 × (40_000 + 5_000) × 10_000) / 10_000 = 100 × 45_000 = 4_500_000`
  - `liquidationThreshold = 4_500_000 × 100_000 = 450_000_000_000`
  - min collateral = 10_000_000_000
  - effective threshold = max(450_000_000_000, 10_000_000_000) = 450_000_000_000
- maxWithdrawable = 9_999_999_955_000_000_000 - 450_000_000_000 = 9_999_999_505_000_000_000

**Boundary check (isLiquidatableWithEB uses `cluster.balance < liquidationThreshold`):**
- After withdrawing maxWithdrawable: balance = 450_000_000_000
- `450_000_000_000 < 450_000_000_000` → false → NOT liquidatable → withdrawal succeeds

- [ ] Withdraw `maxWithdrawable` succeeds
- [ ] `cluster.balance == 450_000_000_000` (exactly at threshold)
- [ ] Withdraw 1 wei more reverts with `InsufficientBalance`
- [ ] Withdraw 0 succeeds (no-op, balance unchanged — verify this works or if there's a zero-check)

#### Edge Variations
- **validatorCount == 0:** Liquidation check is skipped entirely (`cluster.validatorCount != 0` check in withdraw). Can withdraw everything.
- **Cluster at exact minimumLiquidationCollateral:** If `balance == minimumLiquidationCollateral` but `balance >= threshold_from_burn_rate`, NOT liquidatable.

---

### CM-3: ETH Cluster — Third-Party Liquidation With Bounty Verification

**Modules Touched:** SSVClusters, ClusterLib, OperatorLib, ProtocolLib
**Bug Class Covered:** Bounty calculation accuracy, operator count decrements, DAO accounting

#### Preconditions
- 4 operators, each `ethFee = 1_000_000_000` (raw = 10_000)
- Network fee: raw = 5_000
- `minimumBlocksBeforeLiquidation = 100`
- `minimumLiquidationCollateral = 100_000` (unpacked = 10 gwei)
- 1 validator, cluster created at B0 with small balance (just above liquidation threshold)
- Deposit amount chosen so that after enough blocks, the cluster becomes liquidatable

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Register validator, deposit = 0.000001 ETH (1_000_000_000_000 wei) | B0 | Cluster active, balance=1e12 |
| 2 | (advance 20 blocks) | B0+20 | Fee burn reduces cluster balance |
| 3 | Liquidator calls `liquidate()` | B0+20 | Cluster liquidated, bounty transferred |

#### Assertions (exact formulas with numbers)

**At B0+20, liquidation check:**
- Fees for 20 blocks:
  - opFeeUnits = (4 × 20 × 10_000 × 10_000) / 10_000 = 800_000
  - netFeeUnits = (20 × 5_000 × 10_000) / 10_000 = 100_000
  - totalFees = (800_000 + 100_000) × 100_000 = 90_000_000_000
- balanceAfterFees = 1_000_000_000_000 - 90_000_000_000 = 910_000_000_000
- threshold = 450_000_000_000 (same as CM-2)
- 910_000_000_000 >= 450_000_000_000 → NOT liquidatable at block 20

Let's use block B0+22 instead:
- Fees for 22 blocks:
  - totalFees = (22 × 45_000) × 100_000 = 99_000_000_000
  Wait, let me recompute:
  - opFeeUnits = (4 × 22 × 10_000 × 10_000) / 10_000 = 880_000
  - netFeeUnits = (22 × 5_000 × 10_000) / 10_000 = 110_000
  - totalFees = (880_000 + 110_000) × 100_000 = 99_000_000_000
- balanceAfterFees = 1_000_000_000_000 - 99_000_000_000 = 901_000_000_000
- Still > 450_000_000_000.

Actually, the balance needs to burn down past the threshold. With 1e12 starting balance:
- Per-block burn = (4 × 10_000 + 5_000) × 10_000 / 10_000 × 100_000 = 45_000 × 100_000 = 4_500_000_000
- Blocks to drain past threshold: (1e12 - 450e9) / 4.5e9 = 550e9 / 4.5e9 ≈ 122.2 blocks
- At block 123: totalFees = 123 × 4_500_000_000 = 553_500_000_000
- balanceAfterFees = 1e12 - 553_500_000_000 = 446_500_000_000
- 446_500_000_000 < 450_000_000_000 → liquidatable!

Revised action sequence:

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Register validator, deposit = 0.000001 ETH (1e12 wei) | B0 | Cluster active, balance=1e12 |
| 2 | (advance 122 blocks — not yet liquidatable) | B0+122 | Cluster still solvent |
| 3 | (advance 1 more block) | B0+123 | Cluster now liquidatable |
| 4 | Liquidator calls `liquidate()` at B0+123 | B0+123 | Liquidation executes |

**Liquidation flow (at B0+123):**
1. `updateClusterOperators(opIds, false, 1, s, sp)` — updates all 4 operator snapshots, decrements `ethValidatorCount` to 0
2. `updateClusterData` — settles fees:
   - totalFees = 123 × 4_500_000_000 = 553_500_000_000
   - balanceAfterFees = 1e12 - 553_500_000_000 = 446_500_000_000
3. `isLiquidatableWithEB` → true (446.5 gwei < 450 gwei threshold)
4. `_executeLiquidation`:
   - `sp.updateDAO(false, 1)` — ethDaoValidatorCount--, daoTotalEthVUnits -= 10_000
   - bounty = 446_500_000_000
   - cluster = {active=false, balance=0, index=0, nfi=0}
   - Transfer 446_500_000_000 wei to liquidator

- [ ] Liquidator receives exactly 446_500_000_000 wei
- [ ] `cluster.active == false`
- [ ] `cluster.balance == 0`
- [ ] `cluster.index == 0`
- [ ] `cluster.networkFeeIndex == 0`
- [ ] Each operator's `ethValidatorCount == 0` (decremented in updateClusterOperators)
- [ ] `ethDaoValidatorCount` decreased by 1
- [ ] `daoTotalEthVUnits` decreased by 10_000
- [ ] `contract.ETH_balance` decreased by 446_500_000_000 (bounty)
- [ ] At block B0+122: calling `liquidate()` as third party should revert with `ClusterNotLiquidatable`

#### Edge Variations
- **Self-liquidation at B0+1:** Owner can always self-liquidate. Bounty = balance after 1 block of fees = 1e12 - 4_500_000_000 = 995_500_000_000.
- **Liquidation with 0 remaining balance:** If fees exceed balance, `cluster.balance = 0`, bounty = 0, no ETH transfer.
- **Cluster at exact threshold:** `balance == threshold` → `balance < threshold` is false → NOT liquidatable by third party, but CAN self-liquidate.

---

### CM-4: SSV Cluster Self-Liquidation — Verify SSV Balance Return

**Modules Touched:** SSVClusters (liquidateSSV), ClusterLib, OperatorLib
**Bug Class Covered:** SSV fee accrual correctness, SSV token transfer on liquidation

#### Preconditions
- 4 operators, each with `ssvFee = 10_000_000_000` (packed raw = 1 in SSV units, DEDUCTED_DIGITS = 10_000_000)
  - Actually: `fee` packed raw = `10_000_000_000 / 10_000_000 = 1_000`
  - Let's use ssvFee that gives raw = 1000 → unpacked = 10_000_000_000
- SSV network fee: raw = 500 → unpacked = 5_000_000_000
- `minimumBlocksBeforeLiquidationSSV = 100`
- SSV cluster with 2 validators, created at block B0 with balance = 100e18 SSV tokens
- Cluster is ACTIVE

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | (SSV cluster exists from pre-migration) | B0 | Cluster in `s.clusters`, balance=100e18, vc=2, active=true |
| 2 | Owner calls `liquidateSSV()` (self-liquidation) | B0+50 | SSV balance returned to owner |

#### Assertions (exact formulas with numbers)

**SSV fee calculation at B0+50:**
- `clusterIndexSSV delta` = Σ(50 × operator.fee_raw) for active operators
  - Each operator: 50 × 1_000 = 50_000
  - 4 operators: cumulative delta = 200_000
- `networkFeeIndexSSV delta` = 50 × 500 = 25_000
- `usage (packed)` = `(200_000 + 25_000) × 2 = 450_000` (× validatorCount)
  Wait, the SSV formula is:
  ```
  networkFee = (currentNetworkFeeIndex - cluster.networkFeeIndex) * validatorCount
  usage = (newIndex - cluster.index) * validatorCount + networkFee
  ```
  - networkFee_packed = 25_000 × 2 = 50_000
  - operatorFee_packed = 200_000 × 2 = 400_000
  - total usage_packed = 400_000 + 50_000 = 450_000
- `usage unpacked` = 450_000 × 10_000_000 = 4_500_000_000_000
- `balance after fees` = 100e18 - 4_500_000_000_000 = 99_999_995_500_000_000_000

**Liquidation execution:**
- `sp.updateDAOSSV(false, 2)` — daoValidatorCount -= 2
- SSV balance refund = 99_999_995_500_000_000_000
- Cluster set to inactive, balance=0, index=0, nfi=0

- [ ] Owner receives exactly 99_999_995_500_000_000_000 SSV tokens
- [ ] `cluster.active == false`
- [ ] `daoValidatorCount` decreased by 2
- [ ] Operator SSV `validatorCount` NOT changed (only decremented in `updateClusterOperatorsSSV` which is called with `increaseValidatorCount=false`, so it IS decremented)

Wait — re-checking the code: `liquidateSSV` calls `updateClusterOperatorsSSV(operatorIds, false, cluster.validatorCount, s, sp)`. In `updateClusterOperatorsSSV`, when `increaseValidatorCount = false`: `operator.validatorCount -= deltaValidatorCount`. So each operator's SSV validatorCount IS decremented.

- [ ] Each operator's `validatorCount` decreased by 2

#### Edge Variations
- **Third-party liquidation of SSV cluster:** Must pass SSV liquidation check.
- **SSV cluster with 0 balance:** Self-liquidation succeeds, no SSV transfer.
- **SSV cluster that is already liquidated:** Reverts with `ClusterIsLiquidated`.

---

### CM-5: Migration — Basic SSV → ETH With SSV Refund Verification

**Modules Touched:** SSVClusters (migrateClusterToETH), OperatorLib, ProtocolLib, ClusterLib
**Bug Class Covered:** Dual accounting (SSV teardown + ETH setup), SSV refund precision, DAO count transitions

#### Preconditions
- 4 operators, each with:
  - SSV fee: raw = 1_000 → unpacked = 10_000_000_000
  - ETH fee: not yet set (will be set via `ensureETHDefaults`)
- SSV network fee: raw = 500
- ETH network fee: raw = 5_000
- `minimumBlocksBeforeLiquidation (ETH) = 100`
- SSV cluster: 2 validators, balance = 100e18, created at block B0, active=true
- `DEFAULT_OPERATOR_ETH_FEE = 1_770_000_000` → packed raw = 1_770_000_000 / 100_000 = 17_700
- `daoValidatorCount` starts at 2 (for this cluster)
- `ethDaoValidatorCount` starts at 0

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Owner calls `migrateClusterToETH(operatorIds, cluster)` with `msg.value = 10 ETH` | B0+100 | SSV cluster deleted, ETH cluster created, SSV refunded |

#### Assertions (exact formulas with numbers)

**SSV fee settlement (for 100 blocks):**
- Each operator's SSV snapshot updated: `blockDiffFee = 100 × 1_000 = 100_000`
  - `snapshot.index += 100_000`
  - `snapshot.balance += PackedSSV.wrap(100_000 × 2)` = balance + 200_000 packed = + 2_000_000_000_000 unpacked per operator
  - `snapshot.block = B0+100`
- `cumulativeIndexSSV` = sum of all 4 operators' new indices = 4 × (initial_idx + 100_000)
- Cluster balance update:
  - `clusterIndexSSV delta` = 4 × 100_000 = 400_000 (if initial operator indices were 0 at cluster creation)
  - `networkFeeIndexSSV delta` = 100 × 500 = 50_000
  - `usage_packed` = (400_000) × 2 + (50_000 × 2) = 900_000
  - `usage_unpacked` = 900_000 × 10_000_000 = 9_000_000_000_000
  - `ssvClusterBalance` = 100e18 - 9_000_000_000_000 = 99_999_991_000_000_000_000

**Operator SSV→ETH transition:**
- `validatorCount -= 2` for each operator (SSV count)
- `ensureETHDefaults()` called since `ethSnapshot.block == 0`:
  - `ethSnapshot.block = B0+100`
  - `ethFee = defaultOperatorEthFee()` = packed(17_700) since SSV fee ≠ 0
  - `ethSnapshot.balance = 0`
- `ethValidatorCount += 2` for each operator
- `cumulativeIndexETH` = 0 (all operators are ETH-new, so indices not accumulated per DISC-CM-7)
- `cumulativeFeeETH` = 4 × 17_700 = 70_800

**ETH cluster setup:**
- `cluster.balance = 10e18` (msg.value)
- `cluster.active = true`
- `cluster.index = 0` (cumulativeIndexETH = 0)
- `cluster.networkFeeIndex = sp.currentNetworkFeeIndex()` at B0+100

**DAO accounting:**
- `sp.updateDAOSSV(false, 2)` → daoValidatorCount -= 2
- `sp.updateDAO(true, 2)` → ethDaoValidatorCount += 2, daoTotalEthVUnits += 2 × 10_000 = 20_000

**Liquidation check (ETH):**
- vUnits = 2 × 10_000 = 20_000 (implicit, no EB snapshot)
- burnRate = 70_800, networkFee = 5_000
- thresholdUnits = (100 × (70_800 + 5_000) × 20_000) / 10_000 = 100 × 75_800 × 2 = 15_160_000
- liquidationThreshold = 15_160_000 × 100_000 = 1_516_000_000_000 ≈ 1.516 µETH
- 10e18 >> 1.516e12 → NOT liquidatable ✓

**EB deviation (no explicit EB):**
- ebSnapshot.vUnits = 0 → no deviation to add

**SSV refund:**
- 99_999_991_000_000_000_000 SSV tokens transferred to owner

- [ ] `s.clusters[key]` deleted (= bytes32(0))
- [ ] `s.ethClusters[key]` contains hash of new cluster
- [ ] `cluster.balance == 10e18`
- [ ] `cluster.active == true`
- [ ] `cluster.index == 0`
- [ ] Owner receives 99_999_991_000_000_000_000 SSV tokens
- [ ] Each operator: `validatorCount == 0` (SSV), `ethValidatorCount == 2` (ETH)
- [ ] `daoValidatorCount == 0`, `ethDaoValidatorCount == 2`
- [ ] `daoTotalEthVUnits == 20_000`
- [ ] `contract.ETH_balance` increased by 10 ETH
- [ ] Event `ClusterMigratedToETH` emitted with correct params
- [ ] NO `ClusterReactivated` event (cluster was not liquidated)

#### Edge Variations
- **Migration with insufficient ETH:** If msg.value doesn't pass liquidation check → revert `InsufficientBalance`
- **Migration with zero SSV balance:** If SSV fees exceeded SSV balance → ssvClusterBalance = 0, no SSV transfer

---

### CM-6: Migration of Liquidated SSV Cluster

**Modules Touched:** SSVClusters (migrateClusterToETH), OperatorLib
**Bug Class Covered:** Conditional SSV validatorCount skip for liquidated clusters, double-decrement prevention

#### Preconditions
- Same setup as CM-5, but SSV cluster was previously liquidated (at some earlier block)
- Cluster state: `{vc=2, nfi=0, idx=0, active=false, balance=0}`
- Operator SSV validatorCounts already decremented to 0 during liquidation
- `daoValidatorCount` already decremented

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Owner calls `migrateClusterToETH()` with `msg.value = 10 ETH` | B1 | ETH cluster created, SSV cluster deleted, no SSV refund |

#### Assertions

**Key: `isLiquidated = !cluster.active = true`**

**Operator SSV snapshot update:**
- `updateSnapshotStSSV(operator)` called for each operator
- Since cluster is liquidated and operator validatorCount already = 0, the snapshot update computes:
  - `blockDiffFee × validatorCount = blockDiffFee × 0 = 0` added to balance
  - So SSV balance doesn't increase for the liquidated cluster's operators

**Conditional SSV validatorCount skip (OperatorLib.sol:389):**
- `if (!isClusterLiquidated)` → FALSE → skip `operator.validatorCount -= validatorCount`
- This prevents double-decrement (was already decremented during liquidation)

**DAO SSV skip (SSVClusters.sol:289-291):**
- `if (!isLiquidated)` → FALSE → skip `sp.updateDAOSSV(false, cluster.validatorCount)`
- `sp.updateDAO(true, cluster.validatorCount)` always runs → ethDaoValidatorCount += 2

**SSV refund:**
- `cluster.updateBalanceSSV(...)` with liquidated cluster: balance was 0, fees may further "reduce" it but it's already 0
- `ssvClusterBalance = 0` → no SSV transfer

- [ ] Operator SSV `validatorCount` NOT decremented (already 0)
- [ ] `daoValidatorCount` NOT decremented (already decremented)
- [ ] `ethDaoValidatorCount` increased by 2
- [ ] `daoTotalEthVUnits` increased by 20_000
- [ ] ETH cluster created with balance = 10 ETH, active = true
- [ ] No SSV token transfer (balance = 0)
- [ ] Event `ClusterMigratedToETH` emitted
- [ ] Event `ClusterReactivated` emitted (because `isLiquidated` is true — line 345-347)

---

### CM-7: Migration With Mixed Operator ETH State

**Modules Touched:** SSVClusters (migrateClusterToETH), OperatorLib
**Bug Class Covered:** Correct handling when some operators already have ETH clusters and some don't

#### Preconditions
- 4 operators: Op1, Op2, Op3, Op4
- Op1 and Op2 already have ETH validators from another cluster (ethSnapshot.block ≠ 0, ethValidatorCount > 0)
  - Op1: ethFee = 2_000_000_000 (raw = 20_000), ethValidatorCount = 1, ethSnapshot set
  - Op2: ethFee = 3_000_000_000 (raw = 30_000), ethValidatorCount = 2, ethSnapshot set
- Op3 and Op4 are SSV-only (ethSnapshot.block == 0)
  - Op3: ssvFee = 20_000_000_000 (raw = 2_000, non-zero → will get default ETH fee)
  - Op4: ssvFee = 0 (raw = 0 → ETH fee will be set to 0)
- SSV cluster: [Op1, Op2, Op3, Op4], 1 validator, balance = 50e18, at block B0

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Migrate SSV cluster to ETH with msg.value = 5 ETH | B0+200 | Complex operator state transitions |

#### Assertions

**Operator transitions:**

*Op1 (existing ETH):*
- SSV snapshot updated (final SSV earnings accumulated)
- SSV validatorCount -= 1
- ETH snapshot updated (via `updateSnapshotSt`): accumulates 200 blocks × 20_000 × effectiveVUnits/VUNITS_PRECISION earnings
- `cumulativeIndexETH += Op1.ethSnapshot.index` (after update)
- ethValidatorCount += 1 → now 2

*Op2 (existing ETH):*
- Same pattern as Op1
- `cumulativeIndexETH += Op2.ethSnapshot.index` (after update)
- ethValidatorCount += 1 → now 3

*Op3 (new ETH, SSV fee ≠ 0):*
- SSV snapshot updated
- SSV validatorCount -= 1
- `ensureETHDefaults()`: ethSnapshot.block = B0+200, ethFee = DEFAULT (17_700), ethSnapshot.balance = 0
- cumulativeIndexETH does NOT include Op3's index (it's 0, and the code skips adding it — line 401 is inside the `else` block)
- ethValidatorCount += 1 → now 1

*Op4 (new ETH, SSV fee == 0):*
- SSV snapshot updated
- SSV validatorCount -= 1
- `ensureETHDefaults()`: ethSnapshot.block = B0+200, ethFee stays 0 (SSV fee is 0 → no default ETH fee assigned), ethSnapshot.balance = 0
- ethValidatorCount += 1 → now 1

**cumulativeFeeETH = Op1_ethFee + Op2_ethFee + Op3_ethFee + Op4_ethFee = 20_000 + 30_000 + 17_700 + 0 = 67_700**

**cumulativeIndexETH = Op1_updated_index + Op2_updated_index + 0 + 0**

**Cluster index = cumulativeIndexETH** (only Op1 and Op2 contribute)

- [ ] Op3 gets DEFAULT_OPERATOR_ETH_FEE
- [ ] Op4 gets ethFee = 0 (because SSV fee was 0)
- [ ] cluster.index = sum of Op1 and Op2 updated indices only
- [ ] All 4 operators: ethValidatorCount increased by 1
- [ ] All 4 operators: SSV validatorCount decreased by 1

---

### CM-8: Post-Migration — ETH Fee Accrual Verification

**Modules Touched:** SSVClusters (withdraw), ClusterLib, OperatorLib
**Bug Class Covered:** Correct fee model used after migration, no SSV fee leakage

#### Preconditions
- Migration completed as in CM-5: 4 operators, ethFee = 17_700 each, 2 validators, cluster created at block M
- ETH cluster: balance = 10e18, index = 0, networkFeeIndex = NFI_at_M
- ETH network fee: raw = 5_000

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | (Migration completed) | M | ETH cluster active, balance = 10e18 |
| 2 | Register 1 more validator with msg.value = 0 | M+50 | vc=3, fees settled for 50 blocks, then new validator added |
| 3 | Withdraw 1 ETH | M+100 | Fees settled for 50 more blocks (since step 2), then withdraw |

#### Assertions

**At M+50 (register validator):**
- Each operator's ETH snapshot updated:
  - blockDiff = 50, feeRaw = 17_700
  - blockDiffEthFee = 50 × 17_700 = 885_000
  - effectiveVUnits = 0 + 2 × 10_000 = 20_000 (no deviation, 2 validators)
  - delta = (885_000 × 20_000) / 10_000 = 1_770_000
  - Each operator's balance += packed(1_770_000)
- Cluster fee settlement:
  - opIndexDelta = 4 × 885_000 = 3_540_000
  - netIndexDelta = 50 × 5_000 = 250_000
  - vUnits = 20_000
  - opFeeUnits = (3_540_000 × 20_000) / 10_000 = 7_080_000
  - netFeeUnits = (250_000 × 20_000) / 10_000 = 500_000
  - totalFees = (7_080_000 + 500_000) × 100_000 = 758_000_000_000
- balanceAfterFees = 10e18 - 758_000_000_000 + 0 (msg.value = 0)
- New validatorCount = 3
- ethDaoValidatorCount += 1

**At M+100 (withdraw 1 ETH, 50 blocks since step 2):**
- Note: withdraw does NOT update operator snapshots (DISC-CM-3)
- vUnits = 30_000 (3 validators, implicit)
- opIndexDelta = 4 × 50 × 17_700 = 3_540_000 (since operator indices were updated at M+50)
- netIndexDelta = 50 × 5_000 = 250_000
- opFeeUnits = (3_540_000 × 30_000) / 10_000 = 10_620_000
- netFeeUnits = (250_000 × 30_000) / 10_000 = 750_000
- totalFees = (10_620_000 + 750_000) × 100_000 = 1_137_000_000_000
- balanceAfterFees = (10e18 - 758_000_000_000) - 1_137_000_000_000
- balanceAfterWithdraw = balanceAfterFees - 1e18

- [ ] Fee amounts use ETH model (vUnits scaling), NOT SSV model (validatorCount × raw)
- [ ] After 3rd validator added, vUnits is 30_000 (implicit)
- [ ] No SSV fees are deducted from the migrated cluster

---

### CM-9: Reactivation After Liquidation — Full Cycle

**Modules Touched:** SSVClusters (liquidate, reactivate), OperatorLib, ClusterLib
**Bug Class Covered:** State cleanup on liquidation + correct state restoration on reactivation

#### Preconditions
- 4 operators, ethFee = 10_000 each
- Network fee: raw = 5_000
- `minimumBlocksBeforeLiquidation = 100`
- 1 validator, cluster at B0 with 1e12 balance
- Cluster liquidated at B0+123 (same as CM-3)

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Create cluster, 1e12 deposit | B0 | Active, balance=1e12 |
| 2 | Third-party liquidation | B0+123 | Cluster liquidated, bounty transferred |
| 3 | Owner reactivates with 5 ETH | B0+200 | Cluster re-enabled |

#### Assertions for Reactivation (Step 3)

**Reactivation at B0+200:**
- `cluster.active` was `false` → check passes
- Operator snapshot updates (updateClusterOperatorsOnReactivation):
  - Each operator's ethValidatorCount was decremented to 0 at liquidation
  - Now: ethValidatorCount += 1 for each operator
  - Operator earnings accumulated for blocks B0+123 to B0+200 (77 blocks) with ethValidatorCount=0
    - effectiveVUnits = 0 (baseline=0) → no earnings accumulated → delta = 0
    - Operator snapshots just update block number, no balance change
- `cluster.balance = 0 + 5e18 = 5e18` (balance was 0 after liquidation, += msg.value per DISC-CM-5)
- `cluster.active = true`
- `cluster.index = current cumulative operator index`
- `cluster.networkFeeIndex = current ETH network fee index`
- Liquidation check on new balance → must pass
- `sp.updateDAO(true, 1)` → ethDaoValidatorCount += 1, daoTotalEthVUnits += 10_000

**After reactivation, verify fee accrual:**
- At B0+300 (100 blocks after reactivation):
  - Per-block fee = (4×10_000 + 5_000) × 10_000/10_000 × 100_000 = 4_500_000_000
  - Total fees for 100 blocks = 450_000_000_000
  - Expected balance = 5e18 - 450_000_000_000

- [ ] `cluster.active == true`
- [ ] `cluster.balance == 5e18`
- [ ] Operator ethValidatorCount = 1 again
- [ ] ethDaoValidatorCount restored
- [ ] No "phantom fees" from the liquidated period (indices reset at reactivation)
- [ ] Subsequent withdraw shows correct fee deduction from reactivation point only

---

### CM-10: Deposit Into Liquidated Cluster + Reactivation

**Modules Touched:** SSVClusters (deposit, reactivate)
**Bug Class Covered:** Deposit into inactive cluster interaction with reactivation balance

#### Preconditions
- ETH cluster, liquidated, balance = 0
- Cluster state: `{vc=1, nfi=0, idx=0, active=false, balance=0}`

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Cluster is liquidated | B0 | balance=0, active=false |
| 2 | Anyone deposits 3 ETH into liquidated cluster | B0+50 | balance=3e18, active=false (per DISC-CM-2) |
| 3 | Anyone deposits 2 ETH more | B0+60 | balance=5e18, active=false |
| 4 | Owner reactivates with 1 ETH | B0+100 | balance=5e18+1e18=6e18, active=true (per DISC-CM-5) |

#### Assertions

- [ ] Step 2: deposit succeeds despite cluster being inactive
- [ ] Step 2: cluster remains inactive
- [ ] Step 4: `cluster.balance == 6e18` (sum of all deposits + reactivation value)
- [ ] Step 4: cluster becomes active
- [ ] Step 4: indices reset to current values
- [ ] Liquidation check uses total balance of 6 ETH

---

### CM-11: SSV Blocked Operations Verification

**Modules Touched:** SSVValidators, SSVClusters
**Bug Class Covered:** Correct enforcement of SSV cluster restrictions

#### Preconditions
- SSV cluster exists in `s.clusters`, active, with 1 validator

#### Action Sequence — All Should REVERT

| Step | Action | Expected Error |
|------|--------|---------------|
| 1 | `registerValidator()` on SSV cluster | `IncorrectClusterVersion` (validateClusterOnRegistration checks ethClusters first, sees SSV cluster exists → reverts) |
| 2 | `deposit()` on SSV cluster | `IncorrectClusterVersion` (deposit calls validateHashedCluster → version=SSV, then validateClusterVersion(VERSION_SSV, VERSION_ETH) fails) |
| 3 | `reactivate()` on SSV cluster | `IncorrectClusterVersion` |
| 4 | `withdraw()` from SSV cluster | `IncorrectClusterVersion` |
| 5 | `liquidate()` (ETH) on SSV cluster | `IncorrectClusterVersion` |
| 6 | `removeValidator()` from SSV cluster | `IncorrectClusterVersion` (removeValidator validates VERSION_ETH) |

#### Allowed SSV Operations

| Step | Action | Expected Result |
|------|--------|----------------|
| 7 | `liquidateSSV()` on SSV cluster | Succeeds (self-liquidation) |
| 8 | `exitValidator()` from SSV cluster | Succeeds (event only, no state change) |
| 9 | `migrateClusterToETH()` on SSV cluster | Succeeds |

- [ ] Steps 1-6 all revert with `IncorrectClusterVersion`
- [ ] Steps 7-9 succeed
- [ ] Step 1: specifically, `validateClusterOnRegistration` checks `ethClusters` first; if it's bytes32(0) but `clusters` has data → reverts `IncorrectClusterVersion`

---

### CM-12: ETH Cluster With Explicit EB — Fee Scaling Verification

**Modules Touched:** SSVClusters (updateClusterBalance, withdraw), ClusterLib
**Bug Class Covered:** vUnit-scaled fees after EB update, operator deviation accounting

#### Preconditions
- 4 operators, ethFee = 10_000 each
- Network fee: raw = 5_000
- 2 validators at 32 ETH each (implicit vUnits = 20_000)
- ETH cluster created at B0 with 10 ETH
- Oracle root committed for block B0+50 with effectiveBalance = 96 ETH (3 × 32 ETH / 2 validators → 48 ETH each)
  - Actually: 96 ETH for 2 validators → 48 ETH/validator
  - vUnits = ceil(96 × 10_000 / 32) = ceil(30_000) = 30_000

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Create cluster, 2 validators, 10 ETH | B0 | vUnits=20_000 (implicit) |
| 2 | `updateClusterBalance(B0+50, ..., 96, proof)` | B0+100 | Fees settled with OLD vUnits (20_000) for blocks B0→B0+100, then vUnits changed to 30_000 |
| 3 | Withdraw 1 ETH | B0+200 | Fees settled with NEW vUnits (30_000) for blocks B0+100→B0+200 |

#### Assertions

**Step 2 — updateClusterBalance at block B0+100:**

Fee settlement using OLD vUnits (20_000) for 100 blocks:
- `_applyClusterFeeUpdates` is called (because cluster.active = true)
- `updateClusterOperators(opIds, false, 0, s, sp)` — updates operator snapshots with deltaValidatorCount=0 (no change)
- opIndexDelta = 4 × 100 × 10_000 = 4_000_000
- netIndexDelta = 100 × 5_000 = 500_000
- opFeeUnits = (4_000_000 × 20_000) / 10_000 = 8_000_000
- netFeeUnits = (500_000 × 20_000) / 10_000 = 1_000_000
- totalFees = (8_000_000 + 1_000_000) × 100_000 = 900_000_000_000
- balanceAfterFees = 10e18 - 900_000_000_000

Then vUnit update:
- effectiveOldVUnits = 20_000 (was implicit, so validatorCount × VUNITS_PRECISION)
- newVUnits = 30_000
- deviation = 30_000 - 20_000 = 10_000
- For each operator: operatorEthVUnits[opId] += 10_000
- daoTotalEthVUnits += 10_000

EB snapshot stored: {vUnits: 30_000, lastRootBlockNum: B0+50, lastUpdateBlock: B0+100}

**Step 3 — Withdraw at B0+200:**

Fee settlement using NEW vUnits (30_000) for 100 blocks:
- Operator indices: read inline, NOT updated to storage (DISC-CM-3)
- opIndexDelta (since step 2 updated operator snapshots): 4 × 100 × 10_000 = 4_000_000
- netIndexDelta = 100 × 5_000 = 500_000
- `getVUnits` returns 30_000 (explicit from EB snapshot)
- opFeeUnits = (4_000_000 × 30_000) / 10_000 = 12_000_000
- netFeeUnits = (500_000 × 30_000) / 10_000 = 1_500_000
- totalFees = (12_000_000 + 1_500_000) × 100_000 = 1_350_000_000_000
- balanceAfterFees = (10e18 - 900_000_000_000) - 1_350_000_000_000
- balanceAfterWithdraw = balanceAfterFees - 1e18

- [ ] Fees at step 2 use vUnits=20_000 (old)
- [ ] Fees at step 3 use vUnits=30_000 (new)
- [ ] EB increase → 50% more fees per block (30_000/20_000 = 1.5x)
- [ ] operatorEthVUnits[each] == 10_000 (deviation)
- [ ] daoTotalEthVUnits = ethDaoValidatorCount × 10_000 + 10_000 (deviation)
- [ ] ebSnapshot.vUnits == 30_000

---

### CM-13: Migration With Explicit EB Deviation Sync

**Modules Touched:** SSVClusters (migrateClusterToETH), OperatorLib, SSVStorageEB
**Bug Class Covered:** EB deviation propagation during migration

#### Preconditions
- SSV cluster with 2 validators
- Cluster had explicit EB set (via updateClusterBalance on the SSV cluster): effectiveBalance = 128 ETH
  - vUnits = ceil(128 × 10_000 / 32) = 40_000
  - baseline = 2 × 10_000 = 20_000
  - deviation = 40_000 - 20_000 = 20_000
- 4 operators, all SSV-only (no prior ETH interaction)

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | SSV cluster has explicit EB set | B0 | ebSnapshot.vUnits = 40_000 |
| 2 | Migrate to ETH with 10 ETH | B0+100 | Deviation synced to operators and DAO |

#### Assertions

**Migration deviation sync (SSVClusters.sol:314-331):**
- `vUnitsCluster = 40_000` (from ebSnapshot)
- `vUnitsCluster > 0` → enter deviation block
- `baseline = 2 × 10_000 = 20_000`
- `vUnitsCluster (40_000) > baseline (20_000)` → deviation = 20_000
- `sp.daoTotalEthVUnits += 20_000`
- For each of 4 operators: `seb.operatorEthVUnits[opId] += 20_000`

**Combined with updateDAO(true, 2):**
- daoTotalEthVUnits starts at 0
- After updateDAO: += 2 × 10_000 = 20_000 (baseline)
- After deviation sync: += 20_000
- Total: daoTotalEthVUnits = 40_000 ✓ (matches the cluster's 40_000 vUnits)

**Event emission:**
- effectiveVUnits = 40_000 (from ebSnapshot)
- effectiveBalance = vUnitsToEB(40_000) = (40_000 × 32) / 10_000 = 128
- Event: `ClusterMigratedToETH(owner, opIds, 10e18, ssvRefund, 128, cluster)`

- [ ] daoTotalEthVUnits = 40_000 after migration
- [ ] Each operator: operatorEthVUnits = 20_000
- [ ] Future fee accrual uses 40_000 vUnits for this cluster
- [ ] Event effectiveBalance = 128

---

### CM-14: Liquidation With Explicit EB — Deviation Cleanup

**Modules Touched:** SSVClusters (liquidate, _executeLiquidation)
**Bug Class Covered:** Deviation reversal on liquidation, both positive and negative cases

#### Preconditions
- ETH cluster with 2 validators, explicit EB = 96 ETH (vUnits = 30_000)
- baseline = 20_000, deviation = 10_000
- operatorEthVUnits[each] = 10_000
- daoTotalEthVUnits includes the 10_000 deviation

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Cluster runs out of balance, gets liquidated | B_L | Deviation reversed |

#### Assertions

**_executeLiquidation deviation cleanup (SSVClusters.sol:567-601):**
- `vUnitsCluster = 30_000` (from ebSnapshot)
- `baselineVUnits = 2 × 10_000 = 20_000`
- `vUnitsCluster != baselineVUnits` → enter deviation block
- `moreThanBaseline = true` (30_000 > 20_000)
- `deviation = 10_000`
- `sp.daoTotalEthVUnits -= 10_000` (deviation removed)
- For each operator: `seb.operatorEthVUnits[opId] -= 10_000`

**Combined with updateDAO(false, 2):**
- daoTotalEthVUnits -= 2 × 10_000 (baseline removal)
- daoTotalEthVUnits -= 10_000 (deviation removal)
- Net: daoTotalEthVUnits -= 30_000 (full vUnits of cluster removed)

- [ ] daoTotalEthVUnits decreased by 30_000 (baseline + deviation)
- [ ] Each operatorEthVUnits decreased by 10_000 (deviation only — baseline removed via ethValidatorCount)
- [ ] ethDaoValidatorCount decreased by 2

---

### CM-15: Auto-Liquidation via updateClusterBalance

**Modules Touched:** SSVClusters (updateClusterBalance, _liquidateAfterEBUpdateIfNeeded)
**Bug Class Covered:** EB increase causing auto-liquidation, bounty to updater

#### Preconditions
- ETH cluster with 1 validator, balance just above threshold at implicit vUnits
- Cluster balance: 500_000_000_000 (500 gwei)
- Operators: 4 × ethFee = 10_000
- Network fee: 5_000
- minimumBlocksBeforeLiquidation = 100
- At implicit vUnits (10_000), threshold = (100 × 45_000 × 10_000) / 10_000 × 100_000 = 450_000_000_000
- 500 gwei > 450 gwei → NOT liquidatable

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | updateClusterBalance with EB = 64 ETH (1 validator) | B0 | vUnits changes from 10_000 to 20_000, threshold doubles, auto-liquidation triggers |

#### Assertions

**After EB update:**
- New vUnits = ceil(64 × 10_000 / 32) = 20_000
- Fees settled with old vUnits (10_000) first
- New threshold = (100 × 45_000 × 20_000) / 10_000 × 100_000 = 900_000_000_000
- 500 gwei (approx, after fee settlement) < 900 gwei → liquidatable!

**_liquidateAfterEBUpdateIfNeeded:**
- operator ethValidatorCount decremented (line 547)
- `_executeLiquidation` called
- Bounty transferred to `msg.sender` (the updater)

**Key: vUnits are updated BEFORE liquidation check (line 406-409).**
This means the liquidation check uses the NEW vUnits for threshold calculation.

- [ ] Auto-liquidation triggered by EB increase
- [ ] Bounty goes to the person who called updateClusterBalance (not the cluster owner)
- [ ] Both ClusterBalanceUpdated and ClusterLiquidated events emitted
- [ ] Operator vUnit deviations are added (newVUnits > old) then removed in liquidation

**Note on double operator ethValidatorCount decrement:**
In `_liquidateAfterEBUpdateIfNeeded` (line 544-549), the code explicitly decrements `op.ethValidatorCount -= cluster.validatorCount` BEFORE calling `_executeLiquidation`. But `_executeLiquidation` does NOT decrement ethValidatorCount (that's done in `updateClusterOperators` for normal liquidation). In this auto-liquidation path, the `_applyClusterFeeUpdates` called `updateClusterOperators(opIds, false, 0, s, sp)` with deltaValidatorCount=0, so no decrement there. The decrement happens only in `_liquidateAfterEBUpdateIfNeeded`. This is correct — single decrement.

---

### CM-16: Conservation Law — Multi-Cluster ETH Balance Tracking

**Modules Touched:** All cluster-related modules
**Bug Class Covered:** System-wide ETH conservation, no value creation/destruction

#### Preconditions
- 4 operators
- 3 ETH clusters:
  - Cluster A: 2 validators, 5 ETH balance
  - Cluster B: 1 validator, 3 ETH balance
  - Cluster C: 3 validators, 8 ETH balance
- Staking pool has some balance
- Operators have accumulated some ETH earnings

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Create all 3 clusters | B0 | Total contract ETH = 16 ETH |
| 2 | Advance 1000 blocks | B0+1000 | Fees accrue internally |
| 3 | Liquidate Cluster B | B0+1000 | Bounty transferred out |
| 4 | Withdraw 1 ETH from Cluster A | B0+1000 | 1 ETH transferred out |
| 5 | Deposit 2 ETH to Cluster C | B0+1000 | 2 ETH transferred in |
| 6 | Operator withdraws ETH earnings | B0+1000 | ETH transferred out |

#### Assertions

At each step, verify:
- [ ] `contract.ETH_balance = Σ(active cluster balances) + Σ(operator ETH earnings) + DAO ETH balance`

Note: The balances used here must be the "settled" balances (fees deducted up to current block). Since deposit doesn't settle (DISC-CM-1), unsettled cluster balances include pending fee deductions. The conservation holds because those pending fees are also pending in operator earnings and DAO earnings.

For exact conservation:
- `contract.ETH = Σ(stored_cluster_balance for active clusters) + Σ(operator.ethSnapshot.balance unpacked) + sp.ethDaoBalance unpacked + staking_pool`

This doesn't directly work because stored cluster balances are NOT settled. The correct invariant is:
- `contract.ETH = Σ(cluster.balance_as_stored) - Σ(pending_fees_for_all_active_clusters) + Σ(operator.ethSnapshot.balance + pending_operator_earnings) + (sp.ethDaoBalance + pending_dao_earnings) + staking_pool`

Which simplifies to (because pending fees = pending operator earnings + pending DAO earnings):
- `contract.ETH = Σ(cluster.balance_as_stored) + Σ(operator.ethSnapshot.balance) + sp.ethDaoBalance + staking_pool`

Wait, that's not right either. Let me think carefully:

At any point in time:
- Total ETH in system = contract.balance
- Decomposition: cluster balances (if all settled now) + operator earned (if all settled now) + DAO earned (if all settled now) + staking pool
- Cluster balance after settlement = stored_balance - fees_since_last_settlement
- Operator earnings after settlement = stored_earnings + new_fees_since_last_settlement (per operator)
- DAO earnings after settlement = stored_earnings + new_fees_since_last_settlement

The fees leaving clusters equal fees arriving at operators + DAO. So:
- `Σ(settled_cluster_balance) + Σ(settled_operator_earnings) + settled_DAO_earnings = Σ(stored_cluster_balance) + Σ(stored_operator_earnings) + stored_DAO_earnings`

Therefore the invariant is just:
- [ ] `contract.balance == Σ(stored_cluster_balance) + Σ(stored_operator_earnings_unpacked) + stored_DAO_earnings_unpacked + staking_pool_balance_unpacked`

But: precision loss from packing! The packed/unpacked conversions lose sub-precision-unit amounts. So the real invariant is `>=`:
- [ ] `contract.balance >= Σ(stored_cluster_balance) + Σ(stored_operator_earnings_unpacked) + stored_DAO_balance_unpacked + staking_pool_unpacked`

---

### CM-17: SSV Fee Accrual — Verify Exact SSV Deduction Over N Blocks

**Modules Touched:** ClusterLib (updateBalanceSSV), OperatorLib (updateSnapshotStSSV)
**Bug Class Covered:** SSV precision, packed arithmetic correctness

#### Preconditions
- SSV cluster: 3 validators, balance = 1000e18 SSV, created at B0
- 4 operators, each ssvFee raw = 2_000 → unpacked = 20_000_000_000
- SSV network fee raw = 1_000 → unpacked = 10_000_000_000
- Cluster index at creation = Σ(operator indices) = I0
- Cluster networkFeeIndex at creation = NFI0

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Self-liquidate SSV cluster | B0+500 | SSV balance returned |

#### Assertions

- operatorIndexDelta = Σ(500 × 2_000) for 4 operators = 4 × 1_000_000 = 4_000_000
- networkFeeIndexDelta = 500 × 1_000 = 500_000
- networkFee (in ClusterLib.updateBalanceSSV) = (currentNetworkFeeIndex - cluster.networkFeeIndex) × validatorCount
  = 500_000 × 3 = 1_500_000
- usage packed = (newIndex - cluster.index) × validatorCount + networkFee
  = 4_000_000 × 3 + 1_500_000 = 13_500_000
- usage unpacked = 13_500_000 × 10_000_000 = 135_000_000_000_000_000
- balance after = 1000e18 - 135_000_000_000_000_000 = 999_865_000_000_000_000_000

- [ ] SSV refund = 999_865_000_000_000_000_000 = 999.865 SSV

---

### CM-18: Migration — SSV Refund Is Exactly Correct After Extended Fee Accrual

**Modules Touched:** SSVClusters (migrateClusterToETH), ClusterLib
**Bug Class Covered:** SSV refund computation matches independent fee calculation

#### Preconditions
- SSV cluster: 2 validators, balance = 500e18, created at B0
- 4 operators, ssvFee raw = 1_500 each
- SSV network fee raw = 800
- Migration at B0+1000

#### Assertions

- operatorIndexDelta = 4 × 1000 × 1_500 = 6_000_000
- networkFeeIndexDelta = 1000 × 800 = 800_000
- networkFee = 800_000 × 2 = 1_600_000
- usage packed = 6_000_000 × 2 + 1_600_000 = 13_600_000
- usage unpacked = 13_600_000 × 10_000_000 = 136_000_000_000_000_000 = 0.136 SSV
- ssvClusterBalance = 500e18 - 136_000_000_000_000_000 = 499_864_000_000_000_000_000

- [ ] SSV refund = 499_864_000_000_000_000_000
- [ ] This matches: `initialBalance - Σ(blockDiff × operator_fee_raw × validatorCount + blockDiff × networkFeeRaw × validatorCount) × DEDUCTED_DIGITS`
  = 500e18 - (1000 × (4 × 1_500 + 800) × 2 × 10_000_000)
  = 500e18 - (1000 × 6_800 × 2 × 10_000_000)
  = 500e18 - 136_000_000_000_000_000 ✓

---

### CM-19: Withdraw From Empty Cluster (validatorCount == 0)

**Modules Touched:** SSVClusters (withdraw)
**Bug Class Covered:** Edge case — withdraw skipping liquidation check when no validators

#### Preconditions
- ETH cluster: 1 validator, 5 ETH balance
- Remove the validator (validatorCount → 0)
- Balance remains after fee settlement

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Create cluster, 1 validator, 5 ETH | B0 | active, vc=1, balance=5e18 |
| 2 | Remove validator | B0+10 | active, vc=0, balance=5e18-fees |
| 3 | Withdraw entire remaining balance | B0+10 | balance=0 |

#### Assertions

**Key behavior in withdraw (SSVClusters.sol:240-252):**
- When `cluster.validatorCount == 0`, the liquidation check is SKIPPED
- User can withdraw entire balance regardless

- [ ] Withdraw succeeds even though it would fail liquidation check
- [ ] `cluster.balance == 0` after withdrawal
- [ ] Cluster remains active with 0 validators and 0 balance
- [ ] No fees accrue (no operators to charge for) — well, the withdraw function reads operator indices inline, but with 0 validators the per-block fee deduction is 0 anyway since vUnits = 0

Actually wait — if validatorCount = 0, `getVUnits` returns `0 × VUNITS_PRECISION = 0`. So opFeeUnits = 0, netFeeUnits = 0, totalFees = 0. Balance unchanged. Good.

But the inline operator loop in withdraw still runs and reads current indices. The index delta × 0 vUnits = 0 fees. Correct.

---

### CM-20: Reactivation With Explicit EB — Deviation Properly Restored

**Modules Touched:** SSVClusters (reactivate), OperatorLib
**Bug Class Covered:** EB deviation not lost during liquidation/reactivation cycle

#### Preconditions
- ETH cluster had explicit EB (vUnits = 30_000 for 2 validators, deviation = 10_000)
- Cluster gets liquidated → deviation cleaned up (per CM-14)
- EB snapshot persists in storage (vUnits = 30_000 still stored, not deleted on liquidation)

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Cluster is liquidated | B0 | Deviation removed from operators/DAO |
| 2 | Reactivate with 10 ETH | B0+100 | Deviation restored |

#### Assertions

**Reactivation code (SSVClusters.sol:146-184):**
- `vUnitsCluster = seb.clusterEB[hashedCluster].vUnits` → 30_000 (persisted!)
- `baselineVUnits = 2 × 10_000 = 20_000`
- `effectiveVUnits = 30_000` (vUnitsCluster > 0)
- `clusterDeviation = 30_000 - 20_000 = 10_000`

**In `updateClusterOperatorsOnReactivation`:**
- Each operator: `seb.operatorEthVUnits[operatorId] += 10_000` (deviation restored)
- `ethValidatorCount += 2`

**After reactivation:**
- `sp.updateDAO(true, 2)` → ethDaoValidatorCount += 2, daoTotalEthVUnits += 20_000 (baseline)
- `sp.daoTotalEthVUnits += 10_000` (clusterDeviation > 0, line 179)

- [ ] daoTotalEthVUnits increases by 30_000 total (20_000 baseline + 10_000 deviation)
- [ ] operatorEthVUnits[each] = 10_000 (deviation restored)
- [ ] Liquidation check uses effectiveVUnits = 30_000 (correct)
- [ ] Future fees use 30_000 vUnits

---

### CM-21: Revert — Liquidate Cluster At Exact Threshold

**Modules Touched:** SSVClusters (liquidate), ClusterLib
**Bug Class Covered:** Boundary condition — `<` vs `<=` in isLiquidatableWithEB

#### Preconditions
- ETH cluster with balance exactly at liquidation threshold after fee settlement

#### Assertions

From ClusterLib.sol:83:
```solidity
return cluster.balance < liquidationThreshold;
```

This is STRICT less-than. So `balance == threshold` → NOT liquidatable.

- [ ] Third-party liquidation at exact threshold reverts with `ClusterNotLiquidatable`
- [ ] Self-liquidation at exact threshold SUCCEEDS (owner bypass)
- [ ] Third-party liquidation at threshold - 1 wei SUCCEEDS

---

### CM-22: Migration of Cluster Where Some Operators Were Removed

**Modules Touched:** SSVClusters (migrateClusterToETH), OperatorLib
**Bug Class Covered:** Removed operator handling during migration

#### Preconditions
- SSV cluster with 4 operators, 1 validator
- Op1 has been removed (owner preserved, but snapshot.block == 0, ethSnapshot.block == 0)
- Other 3 operators are active

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Migrate to ETH | B0 | Removed operator skipped |

#### Assertions

**In `updateClusterOperatorsMigration` (OperatorLib.sol:380-382):**
- For Op1: `operator.snapshot.block == 0 && operator.ethSnapshot.block == 0` → `continue` (skip)
- Op1 does NOT contribute to cumulativeIndexSSV, cumulativeIndexETH, or cumulativeFeeETH
- Op1's validatorCount is NOT decremented (skipped entirely)
- Op1's ethValidatorCount is NOT incremented

**Result:**
- Only 3 operators are active in the migrated cluster
- The cluster still has 4 operatorIds in its key, but one is a dead operator
- Fees only accrue for 3 operators
- Op1 contributes 0 fee forever

- [ ] Removed operator is skipped (no revert)
- [ ] cumulativeFeeETH = sum of 3 active operators' fees
- [ ] Cluster index = sum of 3 active operators' ETH indices
- [ ] Migration succeeds despite removed operator

---

### CM-23: Withdraw — Operator Snapshots NOT Updated

**Modules Touched:** SSVClusters (withdraw)
**Bug Class Covered:** Ensuring operator earnings are NOT double-counted

#### Preconditions
- ETH cluster with 4 operators, 1 validator, balance = 10 ETH
- Created at B0

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Withdraw 1 ETH | B0+100 | Cluster fees settled, operator snapshots NOT updated |
| 2 | Withdraw 1 more ETH | B0+200 | Correct fee settlement for blocks B0+100 to B0+200 |

#### Assertions

**Critical: The withdraw inline loop (SSVClusters.sol:223-231) reads but does NOT write operator state.**

At Step 1 (B0+100):
- Reads each operator's `ethSnapshot.index` and computes current index
- Current operator index = `ethSnapshot.index + (block.number - ethSnapshot.block) × ethFee`
- This is a VIEW computation, not stored
- Cluster fees settled using these computed indices

At Step 2 (B0+200):
- Reads SAME stored `ethSnapshot` (unchanged since creation/last real update)
- Current operator index = `ethSnapshot.index + (200 blocks from B0) × ethFee`
- This is 200 blocks of index delta, not just 100
- BUT: cluster.index was updated at step 1 to the computed index at B0+100
- So: effective delta for cluster = currentComputedIndex - cluster.index_from_step1
  = `(ethSnapshot.index + 200 × feeRaw) - (ethSnapshot.index + 100 × feeRaw)`
  = `100 × feeRaw`
  → Correct! Only 100 blocks of fees deducted.

- [ ] Step 1 fees = 100 blocks worth
- [ ] Step 2 fees = 100 blocks worth (not 200)
- [ ] Total fees over both steps = 200 blocks worth = same as if only step 2 happened at B0+200

---

### CM-24: Packing Precision — ETH Values That Aren't Divisible By 100_000

**Modules Touched:** SSVPackedLib
**Bug Class Covered:** Precision enforcement, MaxPrecisionExceeded revert

#### Action Sequence

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Set operator ETH fee = 99_999 wei | Revert `MaxPrecisionExceeded` |
| 2 | Set operator ETH fee = 100_000 wei | Succeeds (packed raw = 1) |
| 3 | Set operator ETH fee = 100_001 wei | Revert `MaxPrecisionExceeded` |
| 4 | Set network fee = 200_000 wei | Succeeds (packed raw = 2) |
| 5 | Deposit 99_999 wei into cluster | Succeeds — deposit is in raw wei, NOT packed |
| 6 | Withdraw 99_999 wei from cluster | Succeeds — withdraw amount is raw wei |

- [ ] Fee values must be divisible by ETH_DEDUCTED_DIGITS (100_000)
- [ ] Deposit/withdraw amounts do NOT need to be divisible (they're stored as raw uint256)
- [ ] Cluster balance is raw wei, never packed

---

### CM-25: updateClusterBalance on SSV Cluster — EB Snapshot Only

**Modules Touched:** SSVClusters (updateClusterBalance)
**Bug Class Covered:** Correct SSV cluster path — no fee settlement, only EB snapshot stored

#### Preconditions
- SSV cluster with 2 validators
- Oracle root committed
- Valid Merkle proof for effectiveBalance = 64 ETH

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Call `updateClusterBalance` on SSV cluster | B0 | Only EB snapshot updated |

#### Assertions

**From SSVClusters.sol:417-420 (version == VERSION_SSV path):**
- Only `_updateEBSnapshot` called
- No fee settlement (`_applyClusterFeeUpdates` NOT called)
- No operator vUnit updates
- No DAO vUnit updates
- No liquidation check
- Cluster hash NOT updated (no `s.clusters[key] = ...`)

- [ ] ebSnapshot.vUnits = ebToVUnits(64) = ceil(64 × 10_000 / 32) = 20_000
- [ ] ebSnapshot.lastRootBlockNum = blockNum
- [ ] ebSnapshot.lastUpdateBlock = block.number
- [ ] SSV cluster balance unchanged
- [ ] SSV cluster hash unchanged (NOT re-stored)
- [ ] Event `ClusterBalanceUpdated` emitted
- [ ] No `ClusterLiquidated` event

---

### CM-26: Liquidation Bounty Exactly Equals Post-Settlement Balance

**Modules Touched:** SSVClusters (_executeLiquidation)
**Bug Class Covered:** Bounty = remaining balance after fees, not before

#### Preconditions
- ETH cluster: 1 validator, balance = 1e15 (1 finney), created at B0
- 4 operators, ethFee = 10_000 each, networkFee = 5_000
- Cluster becomes liquidatable after enough blocks

#### Assertions

The bounty is `cluster.balance` AFTER fee settlement (line 604), which is the value after `updateClusterData` has been called. This is the correct behavior — the liquidator gets whatever is left in the cluster after all accrued fees are settled.

- [ ] `bounty = balanceAfterFees`, NOT `originalBalance`
- [ ] If `balanceAfterFees = 0`, no ETH transfer happens (line 612: `if (balanceLiquidatable > 0)`)

---

### CM-27: DAO Earnings Settlement During Migration

**Modules Touched:** SSVClusters (migrateClusterToETH), ProtocolLib
**Bug Class Covered:** DAO earnings correctly settled for both SSV and ETH sides during migration

#### Preconditions
- SSV cluster being migrated
- ethDaoValidatorCount = 5 (from other ETH clusters)
- daoValidatorCount = 3 (from SSV clusters, including this one with 2 validators)

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Migrate 2-validator SSV cluster | B0 | Both SSV and ETH DAO earnings settled |

#### Assertions

**SSV DAO update (`updateDAOSSV(false, 2)`):**
- `updateDAOEarningsSSV(sp)` called first — settles SSV DAO earnings to current block
  - `sp.daoBalance = networkTotalEarningsSSV(sp)` — computed up to current block
  - `sp.daoIndexBlockNumber = block.number`
- Then: `sp.daoValidatorCount -= 2` → now 1

**ETH DAO update (`updateDAO(true, 2)`):**
- `updateDAOEarnings(sp)` called first — settles ETH DAO earnings to current block
  - `sp.ethDaoBalance = networkTotalEarnings(sp)` — computed up to current block
  - `sp.ethDaoIndexBlockNumber = block.number`
- Then: `sp.ethDaoValidatorCount += 2` → now 7
- `sp.daoTotalEthVUnits += 2 × 10_000` → baseline added

- [ ] SSV DAO earnings settled BEFORE validator count change
- [ ] ETH DAO earnings settled BEFORE validator count change
- [ ] No earnings gap or double-counting during migration

---

### CM-28: Multiple Migrations — Same Operators, Different Clusters

**Modules Touched:** SSVClusters (migrateClusterToETH), OperatorLib
**Bug Class Covered:** Operator ETH state correctly accumulated across multiple migrations

#### Preconditions
- 4 shared operators (Op1-Op4)
- SSV Cluster A: [Op1, Op2, Op3, Op4], 2 validators
- SSV Cluster B: [Op1, Op2, Op3, Op4], 1 validator
- Both created at B0

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Migrate Cluster A to ETH with 5 ETH | B0+100 | Operators get ensureETHDefaults (first ETH interaction) |
| 2 | Migrate Cluster B to ETH with 3 ETH | B0+200 | Operators already have ETH state, normal ETH snapshot update |

#### Assertions

**Step 1 (Migrate A):**
- All 4 operators: `ensureETHDefaults()` called
- ethValidatorCount = 0 → 2 for each
- ethSnapshot.block = B0+100, ethFee = DEFAULT (17_700 if SSV fee ≠ 0)
- cumulativeIndexETH = 0 (all fresh)

**Step 2 (Migrate B at B0+200):**
- All 4 operators: `ethSnapshot.block != 0` → take `else` branch (updateSnapshotSt)
- ETH snapshot updated: 100 blocks of earnings with ethValidatorCount=2
  - blockDiffEthFee = 100 × 17_700 = 1_770_000
  - effectiveVUnits = 0 + 2 × 10_000 = 20_000
  - delta = (1_770_000 × 20_000) / 10_000 = 3_540_000
  - Each operator ethSnapshot.balance += packed(3_540_000)
- ethValidatorCount = 2 → 3 for each
- cumulativeIndexETH = sum of 4 operators' updated ethSnapshot.index

**Cluster B setup:**
- cluster.index = cumulativeIndexETH (non-zero this time!)
- cluster.networkFeeIndex = current ETH network fee index at B0+200

- [ ] Step 1: operators initialized to ETH defaults
- [ ] Step 2: operators' ETH earnings accumulated for 100 blocks before adding more validators
- [ ] Step 2: cluster.index is non-zero (captures existing operator indices)
- [ ] Both clusters coexist in ethClusters
- [ ] Total ethValidatorCount per operator = 3

---

### CM-29: Revert — Migrate With Insufficient ETH For Liquidation Check

**Modules Touched:** SSVClusters (migrateClusterToETH)
**Bug Class Covered:** Post-migration liquidation check enforcement

#### Preconditions
- SSV cluster: 2 validators
- 4 operators, expected default ETH fee = 17_700
- minimumBlocksBeforeLiquidation = 100
- Compute minimum ETH needed:
  - burnRate = 4 × 17_700 = 70_800
  - networkFee = 5_000
  - vUnits = 2 × 10_000 = 20_000
  - thresholdUnits = (100 × (70_800 + 5_000) × 20_000) / 10_000 = 100 × 75_800 × 2 = 15_160_000
  - liquidationThreshold = 15_160_000 × 100_000 = 1_516_000_000_000
  - minimumLiquidationCollateral = 10_000_000_000 (10 gwei)
  - effective minimum = 1_516_000_000_000

#### Action Sequence

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Migrate with msg.value = 1_516_000_000_000 wei (exact threshold) | Succeeds (balance >= threshold → NOT liquidatable, `<` is strict) |
| 2 | Migrate with msg.value = 1_515_999_999_999 wei | Reverts `InsufficientBalance` |
| 3 | Migrate with msg.value = 0 | Reverts `InsufficientBalance` (0 < threshold) |

- [ ] Exact threshold value passes
- [ ] 1 wei below threshold reverts

---

### CM-30: Full End-to-End — SSV Cluster Creation → Fee Accrual → Migration → ETH Fee Accrual → Withdraw → Verify All Balances

**Modules Touched:** All cluster/migration modules
**Bug Class Covered:** Complete economic correctness across the full lifecycle

#### Preconditions
- 4 operators: ssvFee raw = 1_000 each, all SSV-only initially
- SSV network fee: raw = 500
- ETH network fee: raw = 5_000
- minimumBlocksBeforeLiquidation = 100
- DEFAULT_OPERATOR_ETH_FEE = 1_770_000_000 → raw = 17_700

#### Action Sequence

| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | SSV cluster created: 2 validators, 100 SSV | B0 | SSV cluster active |
| 2 | (advance 500 blocks) | B0+500 | SSV fees accrue |
| 3 | Migrate to ETH with 10 ETH | B0+500 | SSV refund, ETH cluster created |
| 4 | (advance 200 blocks) | B0+700 | ETH fees accrue |
| 5 | Withdraw 1 ETH | B0+700 | ETH fees settled, 1 ETH transferred |

#### Final Balance Assertions

**SSV refund (at B0+500):**
- operatorIndexDelta = 4 × 500 × 1_000 = 2_000_000
- networkFeeIndexDelta = 500 × 500 = 250_000
- networkFee = 250_000 × 2 = 500_000
- usage_packed = 2_000_000 × 2 + 500_000 = 4_500_000
- usage_unpacked = 4_500_000 × 10_000_000 = 45_000_000_000_000
- ssvRefund = 100e18 - 45_000_000_000_000 = 99_999_955_000_000_000_000

**ETH cluster after migration:**
- balance = 10e18
- cluster.index = 0 (operators newly ETH-initialized)
- cluster.networkFeeIndex = NFI at B0+500

**ETH fee settlement at B0+700 (200 blocks post-migration):**
- Note: withdraw doesn't update operator snapshots. Operator ethSnapshot.block = B0+500.
- Current operator index (computed inline) = 0 + 200 × 17_700 = 3_540_000
- cumulative clusterIndex = 4 × 3_540_000 = 14_160_000
- opIndexDelta = 14_160_000 - 0 = 14_160_000
- netIndexDelta = 200 × 5_000 = 1_000_000
- vUnits = 20_000 (implicit, 2 validators)
- opFeeUnits = (14_160_000 × 20_000) / 10_000 = 28_320_000
- netFeeUnits = (1_000_000 × 20_000) / 10_000 = 2_000_000
- totalFees = (28_320_000 + 2_000_000) × 100_000 = 3_032_000_000_000
- balanceAfterFees = 10e18 - 3_032_000_000_000
- balanceAfterWithdraw = 10e18 - 3_032_000_000_000 - 1e18 = 8_999_996_968_000_000_000

- [ ] SSV refund = 99_999_955_000_000_000_000 (99.99995500 SSV)
- [ ] ETH cluster balance after withdraw = 8_999_996_968_000_000_000
- [ ] contract.ETH = initial + 10 ETH - 1 ETH = 9 ETH (approx, but including operator earnings in contract)
- [ ] Operator SSV earnings = 4 × (500 × 1_000 × 2) × 10_000_000 = 4 × 10_000_000_000_000 = 40_000_000_000_000 per operator × 4 = 160_000_000_000_000 total
  Wait, per operator: blockDiffFee × validatorCount = (500 × 1_000) × 2 = 1_000_000 packed. Unpacked = 10_000_000_000_000.
  Total 4 operators: 40_000_000_000_000 SSV.
- [ ] Operator ETH earnings = 0 at migration time (fresh). After 200 blocks but NOT settled (withdraw doesn't settle operators).
- [ ] ssv refund + operator SSV earnings + DAO SSV earnings = 100 SSV total deposited

Verify total SSV conservation:
- ssvRefund = 99_999_955_000_000_000_000
- operator SSV earnings total = 4 × 10_000_000_000_000 = 40_000_000_000_000
- DAO SSV earnings = daoBalance at migration = networkTotalEarningsSSV at B0+500
  = initial_daoBalance + 500 × 500 (networkFee raw) × 2 (daoValidatorCount) × 10_000_000
  = 0 + 500_000 × 10_000_000 = 5_000_000_000_000
- Total = 99_999_955_000_000_000_000 + 40_000_000_000_000 + 5_000_000_000_000 = 99_999_955_000_000_000_000 + 45_000_000_000_000 = 100_000_000_000_000_000_000 = 100e18 ✓

- [ ] SSV conservation: ssvRefund + operatorSSVEarnings + daoSSVEarnings = 100e18 ✓

---

## Summary

| Scenario | Focus | Key Assertion |
|----------|-------|---------------|
| CM-1 | Basic lifecycle: create → deposit → withdraw | Exact fee deduction with numbers |
| CM-2 | Withdraw boundary at liquidation threshold | `<` not `<=`, boundary precision |
| CM-3 | Third-party liquidation bounty | Bounty = post-settlement balance |
| CM-4 | SSV self-liquidation | SSV token refund exact amount |
| CM-5 | Basic migration SSV→ETH | SSV refund + ETH setup + DAO transitions |
| CM-6 | Migration of liquidated SSV cluster | Skip SSV validator decrement |
| CM-7 | Migration with mixed operator states | ensureETHDefaults vs existing ETH |
| CM-8 | Post-migration ETH fee accrual | Correct fee model after migration |
| CM-9 | Liquidation → reactivation cycle | State cleanup + restoration |
| CM-10 | Deposit into liquidated cluster + reactivate | Balance accumulation across states |
| CM-11 | SSV blocked operations | Version enforcement |
| CM-12 | Explicit EB fee scaling | vUnit-proportional fee deduction |
| CM-13 | Migration with EB deviation | Deviation sync to operators/DAO |
| CM-14 | Liquidation with EB deviation | Deviation cleanup |
| CM-15 | Auto-liquidation via EB update | EB increase triggers liquidation |
| CM-16 | Conservation law | System-wide ETH balance tracking |
| CM-17 | SSV fee accrual precision | Exact SSV deduction |
| CM-18 | SSV refund precision | Refund = balance - exact fees |
| CM-19 | Withdraw from empty cluster | Liquidation check skip |
| CM-20 | Reactivation with EB deviation | Deviation restoration |
| CM-21 | Liquidation boundary (`<` vs `<=`) | Strict inequality |
| CM-22 | Migration with removed operator | Skip removed operators |
| CM-23 | Withdraw doesn't update operator snapshots | No double-counting |
| CM-24 | Packing precision enforcement | ETH_DEDUCTED_DIGITS boundary |
| CM-25 | updateClusterBalance on SSV cluster | EB snapshot only, no accounting |
| CM-26 | Liquidation bounty computation | Post-settlement balance |
| CM-27 | DAO earnings during migration | Both SSV and ETH settled |
| CM-28 | Multiple migrations, same operators | Cumulative ETH state |
| CM-29 | Migration with insufficient ETH | Revert at threshold boundary |
| CM-30 | Full end-to-end lifecycle | Complete economic conservation |
