# Cluster Deposit & Withdraw — Exhaustive Test Scenarios (CL-001 to CL-050)

**Scope:** `SSVClusters.deposit()` and `SSVClusters.withdraw()` for ETH clusters.
**Source files:** `contracts/modules/SSVClusters.sol` (lines 186–253), `contracts/libraries/ClusterLib.sol`
**Spec refs:** SPEC §1 "ETH Payments", §2 "Effective Balance Accounting"; FLOWS §1.7 "Deposit ETH", §1.8 "Withdraw ETH"

---

## Code-Grounding Notes

These observations are derived directly from the contract source and inform every scenario below.

1. **`deposit()` has NO owner check, NO active check, NO nonReentrant.** Any address can deposit into any existing ETH cluster, including liquidated ones. The function only validates the cluster hash and version. (`SSVClusters.sol:186-201`)
2. **`deposit()` does NOT settle fees.** It simply adds `msg.value` to `cluster.balance` and re-hashes. No operator snapshots are updated. (`SSVClusters.sol:196-198`)
3. **`withdraw()` requires `msg.sender == owner`** via `validateHashedCluster(msg.sender, ...)`. (`SSVClusters.sol:209`)
4. **`withdraw()` from inactive cluster skips fee settlement and liquidation check.** The `if (cluster.active)` block (lines 215-230) is skipped; only `cluster.balance < amount` is checked. (`SSVClusters.sol:215,231,235-247`)
5. **`withdraw()` liquidation check uses `isLiquidatableWithEB`** which reads `clusterEB[clusterId].vUnits` from storage. Explicit EB means higher vUnits, which means a higher threshold. (`ClusterLib.sol:67-84`)
6. **`withdraw()` liquidation check is skipped when `validatorCount == 0`** — an active cluster with no validators can withdraw freely. (`SSVClusters.sol:237`)
7. **Removed operators** (`ethSnapshot.block == 0`) contribute their preserved index but zero burn rate. They are skipped in the `withdraw` operator loop but their `ethSnapshot.index` is still accumulated. (`SSVClusters.sol:219-226`, `OperatorLib.sol:246-261`)
8. **`deposit()` with `msg.value == 0` is valid** — no minimum check exists. The balance is unchanged but the event fires and the hash is rewritten.
9. **Liquidation threshold formula:** `threshold = (minimumBlocksBeforeLiquidation * (operatorBurnRate + networkFee) * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS`. The result is compared against `cluster.balance`. (`ClusterLib.sol:79-83`)
10. **`cluster.balance` is a raw `uint256` in wei.** Overflow on deposit is practically impossible but theoretically reachable with crafted values near `type(uint256).max`.

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| CL-001 | Deposit | Deposit into active 4-op cluster, verify balance increase and event | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-201 |
| CL-002 | Deposit | Deposit into active 7-op cluster | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:7; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-201 |
| CL-003 | Deposit | Deposit into active 13-op cluster (max operators) | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:13; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-201 |
| CL-004 | Deposit | Deposit into liquidated cluster (succeeds — no active check) | `entry:deposit; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-201, FLOWS§1.7 |
| CL-005 | Deposit | Deposit by non-cluster-owner into active cluster (succeeds — no owner check) | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-201 |
| CL-006 | Deposit | Deposit by non-cluster-owner into liquidated cluster (succeeds) | `entry:deposit; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-201 |
| CL-007 | Deposit | Deposit 0 ETH (msg.value == 0) — succeeds, event fires, balance unchanged | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:196 |
| CL-008 | Deposit | Deposit exact minimum to keep cluster above liquidation threshold (boundary) | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:67-84 |
| CL-009 | Deposit | Deposit into cluster with explicit EB (vUnits > baseline) — verify balance increase, no fee settlement | `entry:deposit; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-201, ClusterLib.sol:285-297 |
| CL-010 | Deposit | Large deposit near uint256 max on near-zero balance — no overflow | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:196 |
| CL-011 | Deposit | Small deposit (1 wei) into active cluster | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:196 |
| CL-012 | Deposit | Deposit into cluster with one removed operator — succeeds, no operator interaction | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:186-201 |
| CL-013 | Deposit | Deposit with wrong cluster state hash — revert IncorrectClusterState | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:131-148 |
| CL-014 | Deposit | Deposit to non-existent cluster — revert ClusterDoesNotExist | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:141 |
| CL-015 | Deposit | Deposit to SSV-version cluster — revert IncorrectClusterVersion | `entry:deposit; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:328-330 |
| CL-016 | Deposit | Sequential deposits across many blocks — verify each deposit accumulates correctly | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:196 |
| CL-017 | Deposit | Deposit into migrated cluster (SSV->ETH, now VERSION_ETH) | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-201 |
| CL-018 | Deposit | Deposit into active 10-op cluster | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:10; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-201 |
| CL-019 | Deposit | Multiple deposits in same block by different callers — both succeed | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-201 |
| CL-020 | Deposit | Deposit into liquidated cluster then reactivate — verify accumulated balance available | `entry:deposit; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-201, SSVClusters.sol:129-181 |
| CL-021 | Withdraw | Partial withdraw from active 4-op cluster | `entry:withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:206-253 |
| CL-022 | Withdraw | Partial withdraw from active 7-op cluster | `entry:withdraw; version:eth; eb:implicit; cluster:active; ops:7; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:206-253 |
| CL-023 | Withdraw | Partial withdraw from active 13-op cluster | `entry:withdraw; version:eth; eb:implicit; cluster:active; ops:13; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:206-253 |
| CL-024 | Withdraw | Withdraw all balance from active cluster with 0 validators (no liquidation check) | `entry:withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:237 |
| CL-025 | Withdraw | Withdraw that would breach liquidation threshold — revert InsufficientBalance | `entry:withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:235-247 |
| CL-026 | Withdraw | Withdraw more than balance — revert InsufficientBalance | `entry:withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:231 |
| CL-027 | Withdraw | Withdraw from inactive/liquidated cluster (succeeds — no fee settlement) | `entry:withdraw; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:215-231 |
| CL-028 | Withdraw | Withdraw by non-cluster-owner — revert IncorrectClusterState | `entry:withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:209, ClusterLib.sol:131-148 |
| CL-029 | Withdraw | Withdraw with explicit EB — threshold is higher due to vUnits > baseline | `entry:withdraw; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:238-247, ClusterLib.sol:67-84 |
| CL-030 | Withdraw | Withdraw with explicit EB — exact boundary (withdraw leaves balance == threshold) | `entry:withdraw; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:67-84 |
| CL-031 | Withdraw | Withdraw from cluster with one removed operator — reduced burn rate, lower threshold | `entry:withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:219-226, OperatorLib.sol:246 |
| CL-032 | Withdraw | Withdraw 0 amount from active cluster — succeeds (no balance change) | `entry:withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:231-233 |
| CL-033 | Deposit+Withdraw | Deposit then withdraw in same block — net zero, verify fee settlement in withdraw | `entry:deposit,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-253 |
| CL-034 | Deposit+Withdraw | Deposit, advance N blocks (fees accrue), then withdraw — verify fee deduction | `entry:deposit,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-253, ClusterLib.sol:306-321 |
| CL-035 | Deposit+Withdraw | Deposit into liquidated cluster, then withdraw without reactivating — recover funds | `entry:deposit,withdraw; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-201, 206-253 |
| CL-036 | Withdraw | Withdraw from active cluster with explicit EB (vUnits doubled) — threshold 2x higher | `entry:withdraw; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:67-84 |
| CL-037 | Withdraw | Withdraw with wrong cluster state — revert IncorrectClusterState | `entry:withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:131-148 |
| CL-038 | Withdraw | Withdraw from non-existent cluster — revert ClusterDoesNotExist | `entry:withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:141 |
| CL-039 | Withdraw | Withdraw from SSV-version cluster — revert IncorrectClusterVersion | `entry:withdraw; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:328-330 |
| CL-040 | Deposit+Withdraw | Two deposits by different callers, then owner withdraws full sum | `entry:deposit,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-253 |
| CL-041 | Withdraw | Withdraw from active 10-op cluster with explicit EB | `entry:withdraw; version:eth; eb:explicit; cluster:active; ops:10; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:206-253 |
| CL-042 | Deposit+Withdraw | Deposit into cluster with all operators removed — deposit succeeds, withdraw succeeds with zero burn rate | `entry:deposit,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:219-226 |
| CL-043 | Withdraw | Withdraw entire balance from liquidated cluster (balance → 0) | `entry:withdraw; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:215-233 |
| CL-044 | Deposit | Deposit into cluster post-EB-update (explicit EB set by oracle) — no accounting side effects | `entry:deposit; version:eth; eb:explicit; cluster:active; ops:7; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-201 |
| CL-045 | Withdraw | Withdraw that leaves balance exactly at minimumLiquidationCollateral (boundary pass) | `entry:withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:76 |
| CL-046 | Withdraw | Withdraw that leaves balance 1 wei below minimumLiquidationCollateral — revert | `entry:withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:76 |
| CL-047 | Deposit+Withdraw | Non-owner deposits, then owner withdraws — verify owner receives ETH | `entry:deposit,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-253 |
| CL-048 | Deposit+Withdraw | Deposit, EB update increases vUnits, then withdraw — higher threshold applied | `entry:deposit,withdraw; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:206-253, ClusterLib.sol:67-84 |
| CL-049 | Deposit | Deposit overflow edge: cluster.balance near uint256 max, deposit causes overflow — revert | `entry:deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:196 |
| CL-050 | Withdraw | Withdraw from migrated cluster (was SSV, now ETH) with explicit EB — full lifecycle | `entry:withdraw; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:206-253, SSVClusters.sol:259-343 |

---

## Detailed Scenario Blocks (10 Most Complex)

### CL-008: Deposit exact minimum to keep cluster above liquidation threshold

**Context:**
An active 4-op cluster has been running for some blocks. Fees have accrued, and the balance has dropped close to the liquidation threshold. A deposit is made with exactly the amount needed so that the cluster's post-deposit balance equals the liquidation threshold. While `deposit()` itself does not check the liquidation threshold (it has no such logic), this scenario validates that after the deposit, a subsequent `withdraw(0)` or view call confirms the cluster is NOT liquidatable.

**Setup:**
1. Register 4 operators with known `ethFee` values (e.g., `1_000_000_000` packed wei each).
2. Register validator in a new ETH cluster with initial deposit.
3. Advance blocks until cluster balance (after fee settlement) is below the liquidation threshold.
4. Calculate exact minimum deposit: `threshold - settledBalance`, where `threshold = (minimumBlocksBeforeLiquidation * (4 * opFee + networkFee) * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS`.

**Execution:**
1. Call `deposit(owner, operatorIds, cluster)` with `msg.value = exactMinimum`.
2. Verify `ClusterDeposited` event with correct values.
3. Call `getBalance()` view — confirm `balance >= threshold`.
4. Call `withdraw(operatorIds, 1 wei, cluster)` — should revert `InsufficientBalance` (proves we are exactly at boundary).

**Assertions:**
- Deposit succeeds.
- Post-deposit balance equals threshold (within fee-settlement rounding).
- Withdraw of even 1 wei reverts because it breaches the threshold.

**Code path:** `SSVClusters.sol:186-201` (deposit), `ClusterLib.sol:67-84` (threshold formula used by subsequent operations).

---

### CL-025: Withdraw that would breach liquidation threshold — revert InsufficientBalance

**Context:**
The `withdraw` function performs a post-withdrawal liquidation check at line 235-247. The check calls `isLiquidatableWithEB` which reads the cluster's vUnits from `SSVStorageEB`. This scenario proves that withdrawing even 1 wei below the threshold causes a revert.

**Setup:**
1. Register 4 operators with ethFee = `2_000_000_000` packed wei each.
2. Register validator, deposit enough ETH for comfortable runway.
3. Record `minimumBlocksBeforeLiquidation`, `ethNetworkFee`, `minimumLiquidationCollateral`.
4. Compute threshold: `max(minimumLiquidationCollateral, burnRateThreshold)`.
5. Advance blocks so that settled balance is `threshold + safetyMargin`.

**Execution:**
1. Attempt `withdraw(operatorIds, safetyMargin + 1, cluster)` — should revert.
2. Attempt `withdraw(operatorIds, safetyMargin, cluster)` — should succeed (balance == threshold exactly).

**Assertions:**
- First call reverts with `InsufficientBalance`.
- Second call succeeds, emits `ClusterWithdrawn`.
- Post-withdraw balance equals the liquidation threshold.

**Code path:** `SSVClusters.sol:235-247`, `ClusterLib.sol:67-84`.

---

### CL-029: Withdraw with explicit EB — threshold is higher due to vUnits > baseline

**Context:**
When a cluster has explicit EB (e.g., validators with 64 ETH effective balance instead of 32 ETH), the vUnits are doubled. This doubles the liquidation threshold because the formula multiplies `burnRate * vUnits`. A withdrawal amount that would be safe under implicit EB (32 ETH/validator) should revert under explicit EB.

**Setup:**
1. Register 4 operators, register validator, deposit generous amount.
2. Submit oracle root with `updateClusterBalance(effectiveBalance=64)` — sets `vUnits = 20_000` per validator (vs baseline 10_000).
3. Advance blocks to settle fees at the higher burn rate.
4. Compute implicit threshold (at 10_000 vUnits) and explicit threshold (at 20_000 vUnits).
5. Choose withdrawal amount between the two thresholds.

**Execution:**
1. Call `withdraw(operatorIds, amount, cluster)` where `settledBalance - amount` is between implicit and explicit thresholds.
2. Should revert with `InsufficientBalance` because the real threshold uses explicit vUnits.

**Assertions:**
- Revert with `InsufficientBalance`.
- Confirm that the same withdrawal amount would succeed if EB were implicit (counterfactual — test with a separate implicit-EB cluster for comparison).

**Code path:** `SSVClusters.sol:238-247`, `ClusterLib.sol:67-84` (line 78: `getVUnits` returns explicit value), `ClusterLib.sol:79-83`.

---

### CL-031: Withdraw from cluster with one removed operator — reduced burn rate

**Context:**
Removed operators have `ethSnapshot.block == 0`. In the `withdraw` function's burn rate calculation loop (lines 219-226), removed operators are skipped (`if (operator.ethSnapshot.block != 0)`) — they contribute zero to `burnRate` but their preserved `ethSnapshot.index` is still accumulated for balance settlement. This means: (a) the fee settlement accounts for past accrual up to the removal point, and (b) the liquidation threshold is lower because `burnRate` excludes the removed operator's fee.

**Setup:**
1. Register 4 operators with ethFee = `1_000_000_000` each.
2. Register validator, deposit ETH.
3. Advance blocks, remove one operator (operator's `ethSnapshot` is zeroed).
4. Advance more blocks — only 3 operators accrue fees now.
5. Compute threshold with `burnRate = 3 * opFee` (not 4).

**Execution:**
1. Call `withdraw(operatorIds, amount, cluster)` where `amount` is chosen so that remaining balance is above the 3-operator threshold but below the 4-operator threshold.
2. Should succeed because threshold is calculated with only 3 active operators.

**Assertions:**
- Withdraw succeeds.
- If the same withdrawal were attempted with all 4 operators active, it would revert.
- Fee settlement reflects: full 4-operator accrual before removal, 3-operator accrual after.

**Code path:** `SSVClusters.sol:219-226` (loop skips removed operator), `OperatorLib.sol:246-261`.

---

### CL-034: Deposit, advance blocks (fees accrue), then withdraw — verify fee deduction

**Context:**
This scenario validates the full deposit-accrue-withdraw cycle. `deposit()` does NOT settle fees — it simply adds to the raw balance. `withdraw()` DOES settle fees for active clusters by computing the fee delta since last settlement. After N blocks, the settled balance should be: `initial_balance + deposit - accrued_fees`, and the withdrawal must leave enough to stay above the liquidation threshold.

**Setup:**
1. Register 4 operators with ethFee = `1_500_000_000` each. Set networkFee.
2. Register validator with initial deposit D1.
3. Deposit additional D2 ETH.
4. Advance N blocks (e.g., 1000).
5. Calculate expected fees: `fees = ((opIndex_delta + netFeeIndex_delta) * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS`.

**Execution:**
1. Call `withdraw(operatorIds, withdrawAmount, cluster)` where `withdrawAmount = D1 + D2 - expectedFees - threshold`.
2. Verify the post-settlement balance and withdrawn ETH match expectations.

**Assertions:**
- `ClusterWithdrawn` event shows correct `amount`.
- Owner receives `withdrawAmount` ETH.
- Post-withdraw cluster balance equals the liquidation threshold (boundary case).
- Fee calculation matches: `(N * 4 * 1_500_000_000 + N * networkFee) * 10_000 / 10_000 * 100_000`.

**Code path:** `SSVClusters.sol:186-201` (deposit), `SSVClusters.sol:215-253` (withdraw with settlement), `ClusterLib.sol:306-321` (updateBalanceWithEB).

---

### CL-035: Deposit into liquidated cluster, then withdraw without reactivating

**Context:**
A key design feature: liquidated clusters can receive deposits (for pre-funding before reactivation) AND withdraw those deposits (if owner decides not to reactivate). The withdraw from an inactive cluster skips fee settlement entirely — `cluster.active` is false so the fee-settlement block is skipped, and the liquidation check is also skipped (line 235: `cluster.active && ...`).

**Setup:**
1. Register 4 operators, register validator, deposit minimal ETH.
2. Advance blocks until cluster is liquidatable.
3. Liquidate the cluster — balance goes to 0, `active = false`.
4. Deposit D ETH into the liquidated cluster via `deposit()`.

**Execution:**
1. Call `withdraw(operatorIds, D, cluster)` from the cluster owner.
2. Should succeed — no fee settlement, no liquidation check.
3. Verify post-withdraw balance is 0.

**Assertions:**
- Deposit into liquidated cluster succeeds (no active check).
- Withdraw from liquidated cluster succeeds for the owner.
- No fees are deducted (inactive = no accrual).
- Full deposited amount is returned.
- Non-owner attempting the same withdraw reverts (`validateHashedCluster` uses `msg.sender`).

**Code path:** `SSVClusters.sol:186-201` (deposit), `SSVClusters.sol:206-253` (withdraw, line 215: `if (cluster.active)` is false).

---

### CL-042: Deposit into cluster with all operators removed — deposit succeeds, withdraw succeeds with zero burn rate

**Context:**
An edge case where all 4 operators in a cluster have been removed. The cluster is still technically "active" (never liquidated) but has no validators (they were removed along with operators or separately). `deposit()` has no operator interaction so it trivially succeeds. `withdraw()` iterates operators, finds all with `ethSnapshot.block == 0`, accumulates zero burn rate, and the liquidation check passes trivially (if `validatorCount == 0`, the check is skipped entirely per line 237).

**Setup:**
1. Register 4 operators, register validator, deposit ETH.
2. Remove all validators from the cluster.
3. Remove all 4 operators.
4. Cluster state: `active = true`, `validatorCount = 0`.

**Execution:**
1. Deposit 1 ETH via `deposit()`.
2. Call `withdraw(operatorIds, fullBalance, cluster)`.
3. Should succeed — all operators are removed (zero burn rate), `validatorCount == 0` (liquidation check skipped).

**Assertions:**
- Deposit succeeds.
- Withdraw of entire balance succeeds.
- No fees deducted (all operators removed → zero index delta since last settlement; validatorCount = 0 → no network fee).
- `ClusterWithdrawn` event fires with correct amount.

**Code path:** `SSVClusters.sol:219-226` (all operators skipped), `SSVClusters.sol:237` (validatorCount == 0 → skip liquidation check).

---

### CL-048: Deposit, EB update increases vUnits, then withdraw — higher threshold applied

**Context:**
This is a temporal scenario that tests the interaction between `deposit`, `updateClusterBalance` (oracle EB update), and `withdraw`. The key insight is that `deposit()` does not settle fees or interact with EB storage, but `withdraw()` reads the current EB from storage. If an EB update happens between deposit and withdraw, the withdraw uses the NEW (higher) threshold.

**Setup:**
1. Register 4 operators (ethFee = `1_000_000_000` each), register validator, deposit generous amount.
2. Cluster starts with implicit EB (32 ETH, vUnits = 10_000).
3. Calculate threshold_implicit and pick an amount that would leave balance between threshold_implicit and threshold_explicit.

**Execution:**
1. Deposit extra ETH (just enough for comfortable margin under implicit EB).
2. Oracle commits root, call `updateClusterBalance(effectiveBalance=64)` — vUnits becomes 20_000.
3. Advance some blocks for fee accrual at higher EB.
4. Call `withdraw(operatorIds, amount, cluster)` — the amount is chosen so remaining balance > threshold_implicit but < threshold_explicit.
5. Should revert with `InsufficientBalance`.

**Assertions:**
- Deposit succeeds (no EB interaction).
- EB update succeeds.
- Withdraw reverts because `isLiquidatableWithEB` now uses vUnits=20_000.
- Withdrawing a smaller amount (leaving balance above threshold_explicit) succeeds.

**Code path:** `SSVClusters.sol:186-201` (deposit), `SSVClusters.sol:348-417` (updateClusterBalance), `SSVClusters.sol:238-247` (withdraw liquidation check with new EB).

---

### CL-033: Deposit then withdraw in same block — net zero with fee settlement

**Context:**
When deposit and withdraw happen in the same block, the fee settlement in `withdraw` covers fees accrued since the last settlement point (not since the deposit). The deposit added balance, but the withdraw's fee settlement may consume some of the original balance plus the deposit. The net effect depends on how many blocks have passed since the cluster's last settlement.

**Setup:**
1. Register 4 operators, register validator with initial deposit.
2. Advance 500 blocks (fees accrue but are not settled).
3. In the same block: deposit D ETH, then withdraw W ETH.

**Execution:**
1. Call `deposit(owner, operatorIds, cluster)` with `msg.value = D`.
2. Update the cluster struct's balance to reflect the deposit: `cluster.balance += D`.
3. Call `withdraw(operatorIds, W, cluster)` in the same block.
4. The withdraw settles 500 blocks of fees FIRST, then subtracts W.

**Assertions:**
- Both transactions succeed.
- Post-withdraw balance = `(initialBalance + D) - fees_for_500_blocks - W`.
- If `W > (initialBalance + D) - fees_for_500_blocks`, revert `InsufficientBalance`.
- The deposit did NOT trigger any fee settlement (important: `deposit` is "dumb add").

**Code path:** `SSVClusters.sol:196` (deposit: raw add), `SSVClusters.sol:215-230` (withdraw: full settlement), `ClusterLib.sol:306-321` (updateBalanceWithEB).

---

### CL-045 + CL-046: Withdraw boundary at minimumLiquidationCollateral

**Context:**
The liquidation check has TWO thresholds: the burn-rate-based threshold AND `minimumLiquidationCollateral` (an absolute floor). `isLiquidatableWithEB` checks `cluster.balance < minimumLiquidationCollateral` BEFORE computing the burn-rate threshold (ClusterLib.sol:76). This means even if the burn rate is zero (e.g., all operator fees are zero), the absolute collateral floor still applies.

**Setup (CL-045 — boundary pass):**
1. Register 4 operators with ethFee = 0 (free operators).
2. Set networkFee = 0.
3. Register validator, deposit 1 ETH.
4. `minimumLiquidationCollateral` = 940_000_000_000_000 wei (0.00094 ETH per SPEC).
5. `burnRateThreshold = 0` (all fees are zero).
6. Effective threshold = `minimumLiquidationCollateral`.

**Execution (CL-045):**
1. Withdraw `1 ETH - minimumLiquidationCollateral` — leaves balance exactly at the floor.
2. Should succeed.

**Execution (CL-046):**
1. Withdraw `1 ETH - minimumLiquidationCollateral + 1 wei` — leaves balance 1 wei below floor.
2. Should revert `InsufficientBalance`.

**Assertions:**
- CL-045 succeeds; post-withdraw balance == minimumLiquidationCollateral.
- CL-046 reverts with `InsufficientBalance`.
- Proves the `<` comparison (not `<=`) in `ClusterLib.sol:76`.

**Code path:** `ClusterLib.sol:75-76` (collateral floor check), `SSVClusters.sol:235-247` (withdraw liquidation guard).

---

## Audit Gaps (Added post-audit)

> Identified by code-level branch analysis. These scenarios cover branches and edge conditions not addressed by the original CL-001 through CL-050 set.

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| CL-051 | Deposit + Withdraw | Dual-existence revert: attempt deposit/withdraw on a cluster that somehow exists in both `s.ethClusters` and `s.clusters` — revert `IncorrectClusterState` from `getClusterData`. Defensive check for storage corruption. | `entry:deposit; version:both; eb:implicit; cluster:active; ops:4; revert:yes` | [ ] | ClusterLib.sol:346-348 |
| CL-052 | Withdraw | `ETHTransferFailed` on withdraw: cluster owner is a contract that rejects ETH (no `receive`/`fallback`). Verify `CoreLib.transferBalance` reverts with `ETHTransferFailed`. | `entry:withdraw; version:eth; eb:implicit; cluster:active; ops:4; revert:yes` | [ ] | SSVClusters.sol:249-251, CoreLib.sol |
| CL-053 | Withdraw | Fee settlement drives balance to zero: active cluster where accrued fees equal the entire balance. After settlement, `cluster.balance == 0`. Withdraw of any amount reverts `InsufficientBalance`. Verify the zero-balance post-settlement state. | `entry:withdraw; version:eth; eb:implicit; cluster:active; ops:4; revert:yes` | [ ] | SSVClusters.sol:215-231, ClusterLib.sol:306-321 |

---

## ask-codex Review Findings

### Corrections

- The removed-operator explanation in withdraw scenarios is inaccurate. `withdraw()` does NOT branch on `ethSnapshot.block != 0` at SSVClusters.sol:219 — the reduced burn rate comes from `removeOperator()` zeroing `ethFee` at SSVOperators.sol:350.

### Additional Scenarios

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| CL-054 | withdraw | Active cluster: amount <= passed-in balance but > post-settlement balance → revert `InsufficientBalance`. Fee settlement clamps balance before amount check. | `entry:withdraw; revert:yes` | [ ] | SSVClusters.sol:229, 231, ClusterLib.sol:320 |
| CL-055 | withdraw | Active cluster: amount=0 but post-settlement balance is below liquidation floor → revert at liquidation guard. | `entry:withdraw; revert:yes` | [ ] | SSVClusters.sol:235, ClusterLib.sol:76, 81 |
| CL-056 | withdraw | Inactive/liquidated cluster: amount > balance → revert `InsufficientBalance`. Tests inactive-path over-withdraw boundary (no settlement, no liquidation check, only balance check). | `entry:withdraw; revert:yes` | [ ] | SSVClusters.sol:215, 231 |
| CL-057 | deposit/withdraw | Both `ethClusters[hash]` and `clusters[hash]` populated → revert `IncorrectClusterState` from getClusterData before version validation. | `entry:deposit; revert:yes` | [ ] | ClusterLib.sol:346 |
