# Scenario Tests: Operators + Validators

## Discrepancies (Code vs FLOWS.md)

### DISC-OV-1: `registerOperator` always emits `OperatorPrivacyStatusUpdated` even when public

- **FLOWS.md says:** (Section 4.1) `if (setPrivate) emit OperatorPrivacyStatusUpdated([operatorId], true);` — only emit when private
- **Code does:** `SSVOperators.sol:65` — always emits `OperatorPrivacyStatusUpdated(operatorIds, setPrivate)` regardless of `setPrivate` value
- **Likely correct:** Code (emitting for both true/false is more complete for tracking state)
- **Impact:** Low — informational event difference. External consumers will see extra events for public operators. Tests should expect the event in both cases.

### DISC-OV-2: `registerOperator` does NOT validate fee against `operatorMaxFee` when fee is 0

- **FLOWS.md says:** (Section 4.1) "Fee must be within `[minimumOperatorEthFee, operatorMaxFee]`" — implies all fees are range-checked
- **Code does:** `SSVOperators.sol:38-43` — the minimum check is `if (fee != 0 && fee < ...)`, skipping minimum validation when fee=0. The maximum check `if (fee > unpack(sp.operatorMaxFee))` applies to all fees, but fee=0 will always pass since `operatorMaxFee > 0`.
- **Likely correct:** Code — zero-fee (free) operators are a valid use case and should not be subject to minimum fee. FLOWS.md should clarify: "Fee must be 0 (free) OR within `[minimumOperatorEthFee, operatorMaxFee]`"
- **Impact:** Medium — documentation clarity. No bug, but the fee validation rule is more nuanced than documented.

### DISC-OV-3: `removeOperator` does NOT explicitly check `validatorCount == 0 && ethValidatorCount == 0`

- **FLOWS.md says:** (Section 4.2) "Operator must have 0 validators in BOTH SSV and ETH counts" — explicit precondition check
- **Code does:** `SSVOperators.sol:71-93` — calls `checkOwner()`, `updateSnapshotsSt()`, then `_resetOperatorState()` which zeroes `ethValidatorCount` and `validatorCount` unconditionally. There is NO explicit check that counts are 0 before removal.
- **Likely correct:** FLOWS.md — this is a **potential bug or missing guard**. An operator with active validators could be removed, zeroing their validator counts without decrementing `ethDaoValidatorCount` or updating cluster state. However, the `updateSnapshotsSt` call would settle any final earnings, and the operator's fee/snapshot are zeroed, meaning clusters using this operator would see its index frozen at the last value. Clusters would stop accruing fees to this operator but the cluster's index delta would still reference the frozen index.
- **Impact:** HIGH — If an operator with active validators can be removed, it creates a state inconsistency where `ethDaoValidatorCount > Σ(operator.ethValidatorCount)`. The operator's frozen index means cluster balance calculations still work (they reference the last snapshot index), but operator earnings for this operator are lost. **FLAG FOR HUMAN REVIEW: Verify if this is intentional or a missing guard.**

### DISC-OV-4: `removeOperator` snapshot index is NOT zeroed by `_resetOperatorState`

- **FLOWS.md says:** (Section 4.2) "Reset operator state via `_resetOperatorState`: zeros `ethSnapshot`, `snapshot`, `ethFee`, `fee`, `ethValidatorCount`, `validatorCount`" — implies ALL snapshot fields zeroed
- **Code does:** `SSVOperators.sol:324-335` — `_resetOperatorState` sets: `ethSnapshot.block = 0`, `ethSnapshot.balance = PACKED_ETH_ZERO`, `snapshot.block = 0`, `snapshot.balance = PACKED_SSV_ZERO`, `ethFee = PACKED_ETH_ZERO`, `fee = PACKED_SSV_ZERO`, `ethValidatorCount = 0`, `validatorCount = 0`. **Notice: `ethSnapshot.index` and `snapshot.index` are NOT zeroed.**
- **Likely correct:** Code — the indices are intentionally preserved. When clusters reference this operator later (e.g., during `removeValidator` or `liquidate`), they use `operator.ethSnapshot.index` as the frozen cumulative index. If zeroed, the cluster balance calculation `(newIndex - cluster.index)` would give a wrong delta. This is the "removed operators have block == 0 and contribute their preserved index" pattern documented in `OperatorLib.sol:266-267`.
- **Impact:** Medium — FLOWS.md should be updated to clarify that indices are preserved. Tests must verify the preserved index behavior.

### DISC-OV-5: `declareOperatorFee` calls `ensureETHDefaults` but `reduceOperatorFee` does not

- **FLOWS.md says:** No mention of `ensureETHDefaults` in either 4.3 (declare) or 4.5 (reduce)
- **Code does:** `SSVOperators.sol:106-108` — `declareOperatorFee` checks `if (ethSnapshot.block == 0)` and calls `ensureETHDefaults`. `reduceOperatorFee` at line 181-198 does NOT call `ensureETHDefaults`.
- **Likely correct:** Code for declare (initializes defaults if needed). For reduce: an operator that has never had ETH interactions would have `ethFee == 0`, and reducing below 0 is impossible, so `reduceOperatorFee` would revert at the `shrunkAmount.gte(operator.ethFee)` check since any fee >= 0 fee. So the lack of `ensureETHDefaults` in `reduceOperatorFee` is safe — you can't reduce a zero fee.
- **Impact:** Low — edge case is self-protecting. However, if an operator registered with SSV fee > 0 but never had ETH interaction, calling `reduceOperatorFee` would try to reduce ethFee=0, which would fail since any positive fee >= 0. This is correct behavior.

### DISC-OV-6: `reduceOperatorFee` uses memory copy pattern, `executeOperatorFee` uses storage directly

- **FLOWS.md says:** Both 4.4 and 4.5 describe "Update ETH snapshot" then "Set `operator.ethFee`"
- **Code does:** `executeOperatorFee` (line 155-157) uses `s.operators[operatorId]` as storage reference and calls `updateSnapshotSt` (storage version). `reduceOperatorFee` (line 187-194) reads into memory `Operator memory operator = s.operators[operatorId]`, calls `updateSnapshot` (memory version), then writes back `s.operators[operatorId] = operator`.
- **Likely correct:** Both approaches are valid but have different gas profiles. The memory copy approach in `reduceOperatorFee` is actually less safe if there are concurrent storage reads — but in Solidity single-threaded execution, it's fine.
- **Impact:** Low — functionally equivalent. No discrepancy in behavior.

### DISC-OV-7: `_bulkRemoveValidator` does NOT call `ensureETHDefaults` for operators

- **FLOWS.md says:** (Section 1.3) "Update operator ETH snapshots" — implies snapshot update only
- **Code does:** `SSVValidators.sol:196` calls `OperatorLib.updateClusterOperators(operatorIds, false, validatorsRemoved, s, sp)` which at `OperatorLib.sol:267` checks `if (operator.ethSnapshot.block != 0)` before updating. If block is 0 (operator never had ETH interaction), the operator is SKIPPED — its `ethValidatorCount` is NOT decremented.
- **Likely correct:** Code — remove only works on ETH clusters (validated at line 177 `validateClusterVersion(version, VERSION_ETH)`). For an operator to be in an ETH cluster, it must have had `ensureETHDefaults` called during registration, so `ethSnapshot.block != 0`. But if the operator was removed (block=0), the skip is intentional — removed operators contribute their frozen index. The `ethValidatorCount` was already zeroed during operator removal.
- **Impact:** Low — the skip is safe because the `cumulativeIndex` still accumulates `operator.ethSnapshot.index` at line 280.

### DISC-OV-8: `deposit` does NOT update operator snapshots or settle cluster fees

- **FLOWS.md says:** (Section 1.4) "1. Update operator snapshots, 2. Settle cluster fees, 3. `cluster.balance += msg.value`, 4. Update stored cluster hash"
- **Code does:** `SSVClusters.sol:190-205` — validates cluster hash, version, then directly `cluster.balance += msg.value` and stores hash. NO operator snapshot update, NO fee settlement.
- **Likely correct:** Code — deposit is a pure balance addition. The cluster struct passed in by the caller represents the current on-chain state (validated by hash check). Fees will be settled on next state-changing operation (withdraw, register, remove). NOT settling fees on deposit is gas-efficient and mathematically safe because the deposited ETH just adds to the balance that will be consumed by future fees.
- **Impact:** Medium — FLOWS.md is misleading. Tests written against FLOWS.md would expect operator snapshot updates during deposit, which don't happen. However, the cluster balance is still correct because fee settlement is deferred.

### DISC-OV-9: `deposit` does NOT check `cluster.active`

- **FLOWS.md says:** (Section 1.4) "Cluster must be active" — explicit precondition
- **Code does:** `SSVClusters.sol:190-205` — validates cluster hash and version but does NOT call `validateClusterIsNotLiquidated`. A liquidated cluster can receive deposits.
- **Likely correct:** Code — allowing deposit to a liquidated cluster is permissive but not harmful. The deposited ETH just increases balance of an inactive cluster. The owner would need to call `reactivate` to use it.
- **Impact:** Low — edge case. Depositing to a liquidated cluster wastes ETH (can't be used without reactivation).

---

## Global Invariants for This Partition

1. **Operator-DAO validator count consistency:**
   `sp.ethDaoValidatorCount == Σ(operator.ethValidatorCount)` across all active operators
   *(Note: removed operators have ethValidatorCount=0, so they don't contribute)*

2. **Operator earnings formula (ETH):**
   ```
   effectiveVUnits = seb.operatorEthVUnits[operatorId] + operator.ethValidatorCount * VUNITS_PRECISION
   ethSnapshot.balance += (blockDiff * PackedETH.unwrap(ethFee) * effectiveVUnits) / VUNITS_PRECISION
   ```
   Actual wei earned = `PackedETHLib.unpack(ethSnapshot.balance)` = `raw_balance * 100_000`

3. **Cluster balance conservation:**
   After any operation: `cluster.balance = initialBalance + deposits - withdrawals - Σ(fees_accrued)`
   Where fees_accrued = `(operatorIndexDelta * vUnits / VUNITS_PRECISION + networkFeeIndexDelta * vUnits / VUNITS_PRECISION) * ETH_DEDUCTED_DIGITS`

4. **DAO vUnit tracking:**
   `sp.daoTotalEthVUnits == sp.ethDaoValidatorCount * VUNITS_PRECISION + Σ(cluster_deviations)`
   Where deviation = `clusterEB.vUnits - validatorCount * VUNITS_PRECISION` for clusters with explicit EB

5. **Operator index monotonicity:**
   `operator.ethSnapshot.index` only increases (never decreases) — each update adds `blockDiff * fee`

6. **Removed operator detection:**
   `ethSnapshot.block == 0 && snapshot.block == 0` → operator is removed
   `owner` is preserved (non-zero) after removal

7. **Cluster hash integrity:**
   After every mutation: `s.ethClusters[hashedCluster] == keccak256(abi.encodePacked(validatorCount, networkFeeIndex, index, balance, active))`

8. **Validator uniqueness:**
   `validatorPKs[keccak256(pubkey, owner)] != bytes32(0)` iff validator is registered
   LSB of stored value indicates active state

---

## Scenarios

### OV-1: Register Operator (Public, Non-Zero Fee) — Initial State Verification

**Modules Touched:** SSVOperators
**Bug Class Covered:** Incorrect initialization, missing field defaults

#### Preconditions
- No operators registered
- `sp.minimumOperatorEthFee` = 100_000 (packed: 1)
- `sp.operatorMaxFee` = packed value allowing up to 10 ETH/block

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `registerOperator(pubkey, 1_770_000_000, false)` | 100 | Creates operator ID 1 |

#### Assertions (with exact formulas and numbers)
- [ ] `operator[1].owner == msg.sender`
- [ ] `operator[1].ethFee == PackedETH.wrap(1_770_000_000 / 100_000)` = `PackedETH.wrap(17_700)`
- [ ] `operator[1].ethSnapshot.block == 100`
- [ ] `operator[1].ethSnapshot.index == 0`
- [ ] `operator[1].ethSnapshot.balance == PackedETH.wrap(0)`
- [ ] `operator[1].validatorCount == 0`
- [ ] `operator[1].ethValidatorCount == 0`
- [ ] `operator[1].fee == PackedSSV.wrap(0)` (no SSV fee for new operators)
- [ ] `operator[1].snapshot.block == 0` (SSV snapshot NOT initialized for new operators)
- [ ] `operator[1].whitelisted == false`
- [ ] `s.operatorsPKs[keccak256(pubkey)] == 1`
- [ ] `s.lastOperatorId.current() == 1`
- [ ] Event emitted: `OperatorAdded(1, msg.sender, pubkey, 1_770_000_000)`
- [ ] Event emitted: `OperatorPrivacyStatusUpdated([1], false)`

#### Edge Variations
- Register with `fee = 0`: should succeed, `ethFee == PackedETH.wrap(0)`. This operator can NEVER increase fee (FeeIncreaseNotAllowed).
- Register with `setPrivate = true`: `whitelisted == true`, same event with `true`.
- Register with same pubkey again: should revert `OperatorAlreadyExists`.
- Register with fee not divisible by 100_000: should revert `MaxPrecisionExceeded`.

---

### OV-2: Register Operator (Private, Zero Fee) — Free Operator Constraints

**Modules Touched:** SSVOperators
**Bug Class Covered:** Fee immutability for zero-fee operators, whitelist semantics

#### Preconditions
- No operators registered

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `registerOperator(pubkey, 0, true)` | 100 | Creates private operator ID 1 with fee=0 |
| 2 | `declareOperatorFee(1, 500_000)` | 200 | Should revert `FeeIncreaseNotAllowed` |

#### Assertions
- [ ] Step 1: `operator[1].ethFee == PackedETH.wrap(0)`
- [ ] Step 1: `operator[1].whitelisted == true`
- [ ] Step 2: Reverts because `shrunkFee.raw() != 0 && operatorFee.raw() == 0 && operatorSSVFee.raw() == 0` is true at `SSVOperators.sol:115`
- [ ] Fee can never be increased from 0 for this operator

#### Edge Variations
- Zero-fee operator that had a previous SSV fee > 0 (legacy): `operatorSSVFee.raw() != 0`, so the FeeIncreaseNotAllowed check would NOT trigger. This operator CAN declare an ETH fee increase. Verify this path with a migrated operator.

---

### OV-3: ensureETHDefaults — Critical Default Fee Assignment

**Modules Touched:** OperatorLib
**Bug Class Covered:** Missing default fee, zero earnings on active validators

#### Preconditions
- Legacy operator registered pre-v2 with SSV fee = 500_000_000_000 (arbitrary non-zero SSV fee)
- `operator.snapshot.block != 0`, `operator.ethSnapshot.block == 0`
- `operator.ethFee == PackedETH.wrap(0)` (no ETH fee set)

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | First ETH cluster interaction triggers `ensureETHDefaults()` | 200 | Sets ethFee and ethSnapshot |

#### Assertions
- [ ] After `ensureETHDefaults()`: `operator.ethSnapshot.block == 200` (set to current block)
- [ ] After `ensureETHDefaults()`: `operator.ethSnapshot.balance == PackedETH.wrap(0)` (zeroed)
- [ ] After `ensureETHDefaults()`: `operator.ethFee == PackedETH.wrap(17_700)` (= DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS = 1_770_000_000 / 100_000)
  - Because `ethFee.eq(PACKED_ETH_ZERO)` is true AND `fee.neq(PACKED_SSV_ZERO)` is true (SSV fee > 0)

#### Edge Variations
- **Legacy operator with SSV fee = 0:** `ensureETHDefaults` sets `ethSnapshot.block` but does NOT set `ethFee` because `operator.fee.neq(PACKED_SSV_ZERO)` is false. So `ethFee` stays at 0. This means a legacy free operator remains free in ETH.
- **Operator already ETH-initialized** (`ethSnapshot.block != 0`): outer guard `if(operator.ethSnapshot.block == 0)` prevents any changes. Safe no-op.
- **Double call to ensureETHDefaults**: second call is a no-op due to outer guard.

---

### OV-4: Register Validator — New Cluster with 4 Public Operators (Never Used in ETH)

**Modules Touched:** SSVValidators, SSVOperators (via OperatorLib)
**Bug Class Covered:** Default fee not applied, zero fee accrual, incorrect cluster initialization

#### Preconditions
- 4 legacy operators (IDs 1-4) registered pre-v2:
  - Each has SSV fee > 0 (e.g., `fee = PackedSSV.wrap(100)` = 1_000_000_000 wei SSV)
  - `ethSnapshot.block == 0`, `ethFee == PackedETH.wrap(0)` (not yet ETH-initialized)
  - `ethValidatorCount == 0`
- `sp.ethNetworkFee` = PackedETH.wrap(35_509) (= 3_550_900_000 / 100_000, approximately)
  - Actually: `3_550_929_823` is not divisible by 100_000. Let's use 3_550_900_000 for test → packed = 35_509
- `sp.minimumBlocksBeforeLiquidation` = 50_190
- `sp.minimumLiquidationCollateral` = PackedETH.wrap(9) (= 940_000 / 100_000 ≈ 0.00094 ETH, packed 9 → 900_000 wei)
  - Note: 0.00094 ETH = 940_000_000_000_000 wei. Packed = 940_000_000_000_000 / 100_000 = 9_400_000_000. This won't fit in uint64.
  - Correction: PackedETH stores the value divided by 100_000 (ETH_DEDUCTED_DIGITS). 0.00094 ETH = 940_000_000_000_000 wei. 940_000_000_000_000 / 100_000 = 9_400_000_000. This fits in uint64.
  - Packed: `PackedETH.wrap(9_400_000_000)`
- `sp.ethNetworkFeeIndex == 0`, `sp.ethNetworkFeeIndexBlockNumber == 0` (or some known initial value)

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `registerValidator{value: 10 ETH}(pubkey, [1,2,3,4], shares, emptyCluster)` | 200 | New cluster created with balance = 10 ETH |
| 2 | Advance 100 blocks (mine to block 300) | 300 | Fees accruing |
| 3 | Call a view function or trigger state update to verify balances | 300 | Verify operator earnings and cluster balance |

#### Detailed Trace of Step 1 (block 200):

1. `_bulkRegisterValidator` called with `validatorsLength = 1`
2. `ValidatorLib.validateOperatorsLength([1,2,3,4])` — passes (length 4, 4 % 3 == 1)
3. `ValidatorLib.registerPublicKey(pubkey, [1,2,3,4], owner, s)` — stores validator
4. `cluster.validateClusterOnRegistration(owner, [1,2,3,4], s)`:
   - `hashedCluster = keccak256(abi.encodePacked(owner, [1,2,3,4]))`
   - `s.ethClusters[hashedCluster] == bytes32(0)` AND `s.clusters[hashedCluster] == bytes32(0)` → new cluster
   - Validates: `validatorCount == 0 && networkFeeIndex == 0 && index == 0 && balance == 0 && active == true`
5. `cluster.balance += msg.value` → `cluster.balance = 10 ETH = 10_000_000_000_000_000_000`
6. `cluster.updateClusterOnRegistration(...)`:
   - Calls `OperatorLib.updateClusterOperatorsOnRegistration([1,2,3,4], 1, s, sp)`
   - For each operator (IDs 1-4):
     - `ensureOperatorExist` — passes (owner != 0, snapshot.block != 0 for SSV)
     - `ensureETHDefaults(operator)`:
       - `ethSnapshot.block == 0` → enters guard
       - Sets `ethSnapshot.block = 200`, `ethSnapshot.balance = PACKED_ETH_ZERO`
       - `ethFee.eq(PACKED_ETH_ZERO)` (true) AND `fee.neq(PACKED_SSV_ZERO)` (true, SSV fee > 0)
       - Sets `ethFee = defaultOperatorEthFee() = PackedETH.wrap(17_700)`
     - `updateSnapshot(operator, id)`:
       - `blockDiffEthFee = (200 - 200) * 17_700 = 0` (just initialized)
       - No balance change, index += 0
       - `ethSnapshot.block = 200` (already set)
     - `ethValidatorCount += 1` → `ethValidatorCount = 1`
     - `cumulativeFee += 17_700` (4 operators → cumulativeFee = 70_800)
     - `cumulativeIndex += 0` (all zero)
   - Returns `(cumulativeIndex=0, cumulativeFee=70_800)`
   - Calls `updateClusterData(cluster, hashedCluster, 0, sp.currentNetworkFeeIndex())`
     - `currentNetworkFeeIndex() = sp.ethNetworkFeeIndex + (200 - sp.ethNetworkFeeIndexBlockNumber) * PackedETH.unwrap(sp.ethNetworkFee)`
     - Let's say initial `ethNetworkFeeIndex=0, ethNetworkFeeIndexBlockNumber=100`:
     - `= 0 + (200 - 100) * 35_509 = 3_550_900`
     - `updateBalanceWithEB`: vUnits = getVUnits(hashedCluster, 0) → `validatorCount=0` at this point (not yet incremented!) → `0 * 10_000 = 0`
     - Wait — `cluster.validatorCount` is still 0 here. So `vUnits = 0`, meaning `usage = 0`. Balance unchanged.
     - `cluster.index = 0`, `cluster.networkFeeIndex = 3_550_900`
   - Calls `sp.updateDAO(true, 1)`:
     - `updateDAOEarnings(sp)` — settles DAO earnings
     - `ethDaoValidatorCount += 1`
     - `daoTotalEthVUnits += 10_000`
   - `cluster.validatorCount += 1` → `cluster.validatorCount = 1`
   - Liquidation check with: burnRate=70_800, networkFee=35_509, minimumBlocksBeforeLiquidation=50_190, minimumLiquidationCollateral=PackedETH.wrap(9_400_000_000)
     - vUnits = getVUnits(hashedCluster, 1) = 1 * 10_000 = 10_000
     - `thresholdUnits = (50_190 * (70_800 + 35_509) * 10_000) / 10_000 = 50_190 * 106_309 = 5_335_664_710`
     - `liquidationThreshold = 5_335_664_710 * 100_000 = 533_566_471_000_000`
     - `cluster.balance (10 ETH = 10e18) > 533_566_471_000_000` → NOT liquidatable ✓
   - Stores `s.ethClusters[hashedCluster] = cluster.hashClusterData()`

#### Assertions After Step 1 (block 200)
- [ ] Each `operator[1..4].ethFee == PackedETH.wrap(17_700)` (DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS = 1_770_000_000 / 100_000)
- [ ] Each `operator[1..4].ethValidatorCount == 1`
- [ ] Each `operator[1..4].ethSnapshot.block == 200`
- [ ] Each `operator[1..4].ethSnapshot.index == 0`
- [ ] Each `operator[1..4].ethSnapshot.balance == PackedETH.wrap(0)`
- [ ] `sp.ethDaoValidatorCount == 1`
- [ ] `sp.daoTotalEthVUnits == 10_000`
- [ ] `cluster.validatorCount == 1`
- [ ] `cluster.balance == 10_000_000_000_000_000_000` (10 ETH)
- [ ] `cluster.index == 0`
- [ ] `cluster.networkFeeIndex == 3_550_900` (or whatever the current network fee index is)
- [ ] `cluster.active == true`

#### Assertions After Step 2 (advance to block 300, then trigger snapshot update)

After 100 blocks, each operator should have accumulated earnings:

For each operator:
- `blockDiff = 300 - 200 = 100`
- `blockDiffEthFee = 100 * 17_700 = 1_770_000`
- `effectiveVUnits = 0 + 1 * 10_000 = 10_000` (no deviation, 1 validator)
- `delta = (1_770_000 * 10_000) / 10_000 = 1_770_000`
- `ethSnapshot.balance += PackedETH.wrap(1_770_000)`
- Actual wei: `1_770_000 * 100_000 = 177_000_000_000` (0.000000177 ETH per operator)

- [ ] Each `operator[1..4].ethSnapshot.balance == PackedETH.wrap(1_770_000)` (after snapshot update)
- [ ] Each operator's withdrawable ETH = `1_770_000 * 100_000 = 177_000_000_000 wei`

Cluster balance after 100 blocks:
- `newOperatorIndex = 0 + 100 * 17_700 = 1_770_000` (per operator)
- `clusterIndex = Σ(operator.ethSnapshot.index) = 4 * 1_770_000 = 7_080_000`
- `indexDelta = 7_080_000 - 0 = 7_080_000` (cluster.index was 0)
- `currentNetworkFeeIndex = 3_550_900 + 100 * 35_509 = 3_550_900 + 3_550_900 = 7_101_800`
- `networkFeeIndexDelta = 7_101_800 - 3_550_900 = 3_550_900`
- `vUnits = 10_000`
- `operatorFeeUnits = (7_080_000 * 10_000) / 10_000 = 7_080_000`
- `networkFeeUnits = (3_550_900 * 10_000) / 10_000 = 3_550_900`
- `totalUsageUnits = 7_080_000 + 3_550_900 = 10_630_900`
- `totalUsageWei = 10_630_900 * 100_000 = 1_063_090_000_000`
- [ ] `cluster.balance == 10_000_000_000_000_000_000 - 1_063_090_000_000 = 9_999_998_936_910_000_000`

---

### OV-5: Register Validator — Existing Cluster with Fee Settlement

**Modules Touched:** SSVValidators, ClusterLib, OperatorLib
**Bug Class Covered:** Missing fee settlement before adding validator, double-counting

#### Preconditions
- 4 operators (IDs 1-4), all ETH-initialized with `ethFee = PackedETH.wrap(17_700)`
- Cluster exists with 1 validator, created at block 200
- `cluster.validatorCount == 1`, `cluster.balance == 10 ETH`
- `cluster.index == 0`, `cluster.networkFeeIndex == networkFeeIndex_at_200`
- `sp.ethNetworkFeeIndexBlockNumber = 200`
- Current block = 250 (50 blocks have passed)

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `registerValidator{value: 5 ETH}(pubkey2, [1,2,3,4], shares, cluster)` | 250 | Settle 50 blocks of fees, add validator, add 5 ETH |
| 2 | Advance 100 blocks to block 350 | 350 | New burn rate with 2 validators |

#### Detailed Trace of Step 1 (block 250):

During `updateClusterOperatorsOnRegistration`:
- For each operator:
  - `ensureETHDefaults` — no-op (already initialized)
  - `updateSnapshot(operator, id)`:
    - `blockDiffEthFee = (250 - 200) * 17_700 = 885_000`
    - `effectiveVUnits = 0 + 1 * 10_000 = 10_000`
    - `delta = (885_000 * 10_000) / 10_000 = 885_000`
    - `ethSnapshot.balance += PackedETH.wrap(885_000)`
    - `ethSnapshot.index += 885_000` → `ethSnapshot.index = 885_000`
    - `ethSnapshot.block = 250`
  - `ethValidatorCount += 1` → `ethValidatorCount = 2`
  - `cumulativeIndex = 4 * 885_000 = 3_540_000`
  - `cumulativeFee = 4 * 17_700 = 70_800`

During `updateClusterData`:
- `currentNetworkFeeIndex = networkFeeIndex_at_200 + (250 - 200) * 35_509 = networkFeeIndex_at_200 + 1_775_450`
- `updateBalanceWithEB`:
  - `vUnits = getVUnits(hashedCluster, 1) = 10_000` (1 validator, no explicit EB)
  - `idxOp = 3_540_000 - 0 = 3_540_000`
  - `idxNet = 1_775_450` (delta from cluster's stored networkFeeIndex)
  - `operatorFeeUnits = (3_540_000 * 10_000) / 10_000 = 3_540_000`
  - `networkFeeUnits = (1_775_450 * 10_000) / 10_000 = 1_775_450`
  - `usageUnits = 3_540_000 + 1_775_450 = 5_315_450`
  - `usage = 5_315_450 * 100_000 = 531_545_000_000`
- `cluster.balance = 10 ETH + 5 ETH - 531_545_000_000 = 15_000_000_000_000_000_000 - 531_545_000_000 = 14_999_999_468_455_000_000`
  Wait — the `cluster.balance += msg.value` happens BEFORE `updateClusterOnRegistration`. So:
  - `cluster.balance = 10 ETH + 5 ETH = 15 ETH` (at line 138 in SSVValidators.sol)
  - Then `updateBalanceWithEB` deducts usage from 15 ETH
  - `cluster.balance = 15_000_000_000_000_000_000 - 531_545_000_000 = 14_999_999_468_455_000_000`
- `cluster.index = 3_540_000`
- `cluster.networkFeeIndex = updated value`

Then `sp.updateDAO(true, 1)`:
- `ethDaoValidatorCount += 1` → `ethDaoValidatorCount = 2`
- `daoTotalEthVUnits += 10_000` → `daoTotalEthVUnits = 20_000`

Then `cluster.validatorCount += 1` → `cluster.validatorCount = 2`

#### Assertions After Step 1 (block 250)
- [ ] `cluster.validatorCount == 2`
- [ ] `cluster.balance == 14_999_999_468_455_000_000` (15 ETH minus 50 blocks of 1-validator fees)
- [ ] Each `operator[1..4].ethValidatorCount == 2`
- [ ] Each `operator[1..4].ethSnapshot.balance == PackedETH.wrap(885_000)`
- [ ] `sp.ethDaoValidatorCount == 2`

#### Assertions After Step 2 (block 350, after another 100 blocks)

New burn rate: 2 validators, 4 operators at fee 17_700 each
- Each operator's earnings in this 100-block period:
  - `blockDiffEthFee = 100 * 17_700 = 1_770_000`
  - `effectiveVUnits = 0 + 2 * 10_000 = 20_000`
  - `delta = (1_770_000 * 20_000) / 10_000 = 3_540_000`
  - `ethSnapshot.balance = 885_000 + 3_540_000 = 4_425_000` (packed)
  - Actual = `4_425_000 * 100_000 = 442_500_000_000 wei`

- [ ] Each `operator[1..4].ethSnapshot.balance == PackedETH.wrap(4_425_000)`

Cluster balance deduction over 100 blocks with 2 validators:
- New operator index for each operator: `885_000 + 1_770_000 = 2_655_000`
- Cluster cumulative index delta = `(4 * 2_655_000) - 3_540_000 = 10_620_000 - 3_540_000 = 7_080_000`
- Network fee index delta = `100 * 35_509 = 3_550_900`
- vUnits = 20_000 (2 validators, implicit EB)
- operatorFeeUnits = `(7_080_000 * 20_000) / 10_000 = 14_160_000`
- networkFeeUnits = `(3_550_900 * 20_000) / 10_000 = 7_101_800`
- totalUsageUnits = `14_160_000 + 7_101_800 = 21_261_800`
- totalUsageWei = `21_261_800 * 100_000 = 2_126_180_000_000`
- [ ] `cluster.balance == 14_999_999_468_455_000_000 - 2_126_180_000_000 = 14_999_997_342_275_000_000`

---

### OV-6: Register Validator on Private Operators — Whitelist Enforcement

**Modules Touched:** SSVValidators, OperatorLib (whitelist checks)
**Bug Class Covered:** Whitelist bypass, incorrect declared fee usage

#### Preconditions
- 4 operators (IDs 1-4), all private (`whitelisted == true`)
- Operators registered with custom ethFee = 5_000_000_000 (5 gwei/block)
  - Packed: `5_000_000_000 / 100_000 = 50_000` → `PackedETH.wrap(50_000)`
- Cluster owner (caller) is NOT whitelisted for any operator

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `registerValidator{value: 10 ETH}(pubkey, [1,2,3,4], shares, emptyCluster)` | 200 | Should revert `CallerNotWhitelistedWithData` |
| 2 | Whitelist caller for all 4 operators via bitmap | 201 | Caller now whitelisted |
| 3 | `registerValidator{value: 10 ETH}(pubkey, [1,2,3,4], shares, emptyCluster)` | 202 | Succeeds with declared fee, NOT default fee |

#### Assertions
- [ ] Step 1: Reverts with `CallerNotWhitelistedWithData(operatorId)` for first non-whitelisted operator
- [ ] Step 3: `operator[1].ethFee == PackedETH.wrap(50_000)` (custom fee preserved, NOT overwritten by ensureETHDefaults since operators were registered with v2 and already have ethSnapshot.block > 0)
- [ ] Step 3: Cluster uses fee 50_000 per operator → cumulativeFee = 200_000
- [ ] Operator earnings use 50_000 fee, not DEFAULT_OPERATOR_ETH_FEE

#### Edge Variations
- Whitelist via contract (ISSVWhitelistingContract): contract implements `isWhitelisted(address, uint64)` → dynamic whitelist
- Whitelist via legacy address (`operatorsWhitelist[operatorId]`): exact match or whitelisting contract fallback
- Mix of public and private operators in same cluster: private operators checked, public ones skipped

---

### OV-7: Bulk Register Validators (3 validators at once)

**Modules Touched:** SSVValidators
**Bug Class Covered:** Incorrect validator count increment, single vs bulk ETH deposit

#### Preconditions
- 4 operators (IDs 1-4), public, ETH-initialized at block 100
  - `ethFee = PackedETH.wrap(17_700)`, `ethValidatorCount = 0`
- No existing cluster

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `bulkRegisterValidator{value: 30 ETH}([pk1,pk2,pk3], [1,2,3,4], [s1,s2,s3], emptyCluster)` | 200 | Create cluster with 3 validators, single ETH deposit |

#### Assertions
- [ ] `cluster.validatorCount == 3`
- [ ] `cluster.balance == 30_000_000_000_000_000_000` (30 ETH)
- [ ] Each `operator[1..4].ethValidatorCount == 3` (incremented by 3 in single call: `ethValidatorCount += deltaValidatorCount` where deltaValidatorCount=3)
- [ ] `sp.ethDaoValidatorCount == 3`
- [ ] `sp.daoTotalEthVUnits == 30_000` (3 * 10_000)
- [ ] 3 separate `ValidatorAdded` events emitted (one per validator)
- [ ] `contract.balance` increased by exactly 30 ETH (single deposit)
- [ ] Each validator PKs stored: `validatorPKs[keccak256(pk_i, owner)] != bytes32(0)`

#### Edge Variations
- Bulk register with 0 public keys: revert `EmptyPublicKeysList`
- Bulk register with mismatched lengths: revert `PublicKeysSharesLengthMismatch`
- Bulk register with duplicate public key in array: revert `ValidatorAlreadyExistsWithData` on second occurrence

---

### OV-8: Remove Validator — Fee Settlement and Count Adjustment

**Modules Touched:** SSVValidators, ClusterLib, OperatorLib
**Bug Class Covered:** Missing fee settlement on removal, incorrect validator count decrement

#### Preconditions
- 4 operators (IDs 1-4), `ethFee = PackedETH.wrap(17_700)`, `ethValidatorCount = 2` each
- Cluster with 2 validators, created at block 200
  - `cluster.balance = 10 ETH`, `cluster.index = I_200`, `cluster.networkFeeIndex = N_200`
- Block 300 (100 blocks of fees accrued)

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `removeValidator(pk1, [1,2,3,4], cluster)` | 300 | Settle fees, remove 1 validator, update cluster |

#### Detailed Trace:
1. `_bulkRemoveValidator` called
2. `cluster.validateHashedCluster(owner, [1,2,3,4], s)` — validates cluster hash matches
3. `ClusterLib.validateClusterVersion(version, VERSION_ETH)` — confirms ETH cluster
4. `ValidatorLib.validateCorrectState(validatorData, hashedOperatorIds)` — validator exists
5. `delete s.validatorPKs[hashedValidator]` — removes validator
6. `cluster.active == true`:
   - `OperatorLib.updateClusterOperators([1,2,3,4], false, 1, s, sp)`:
     - For each operator:
       - `ethSnapshot.block != 0` → update snapshot:
         - `blockDiffEthFee = (300 - 200) * 17_700 = 1_770_000`
         - `effectiveVUnits = 0 + 2 * 10_000 = 20_000`
         - `delta = (1_770_000 * 20_000) / 10_000 = 3_540_000`
         - `ethSnapshot.balance += PackedETH.wrap(3_540_000)`
         - `ethSnapshot.index += 1_770_000`
         - `ethSnapshot.block = 300`
       - `ethValidatorCount -= 1` → `ethValidatorCount = 1`
       - `cumulativeFee += 17_700` → total = 70_800
     - `cumulativeIndex = Σ(I_200 + 1_770_000)` = 4 * (I_200_per_op + 1_770_000)
   - `cluster.updateClusterData(hashedCluster, clusterIndex, sp.currentNetworkFeeIndex())`:
     - Settles balance using OLD vUnits (2 validators → 20_000 vUnits)
     - Deducts 100 blocks of fees at 2-validator rate
   - `sp.updateDAO(false, 1)`:
     - `ethDaoValidatorCount -= 1`
     - `daoTotalEthVUnits -= 10_000`

7. `cluster.validatorCount -= 1` → `cluster.validatorCount = 1`
8. EB snapshot: `ebSnapshot.vUnits == 0` → implicit, nothing to do
9. Store updated cluster hash

#### Assertions
- [ ] `cluster.validatorCount == 1`
- [ ] Each `operator[1..4].ethValidatorCount == 1`
- [ ] `sp.ethDaoValidatorCount` decreased by 1
- [ ] `sp.daoTotalEthVUnits` decreased by 10_000
- [ ] Cluster balance reflects 100 blocks of 2-validator fee deduction:
  - operatorFeeUnits = `((4 * 1_770_000) * 20_000) / 10_000 = 14_160_000`
  - networkFeeUnits = `((100 * 35_509) * 20_000) / 10_000 = 7_101_800`
  - totalUsage = `(14_160_000 + 7_101_800) * 100_000 = 2_126_180_000_000`
  - `cluster.balance == 10_000_000_000_000_000_000 - 2_126_180_000_000`
- [ ] Validator pk1 no longer retrievable: `validatorPKs[keccak256(pk1, owner)] == bytes32(0)`
- [ ] Validator pk2 still exists

#### Edge Variations
- Remove last validator from cluster: `cluster.validatorCount → 0`, cluster still exists with remaining balance. Owner can withdraw.
- Remove validator that doesn't exist: revert `IncorrectValidatorStateWithData`
- Remove from wrong operator set: revert `IncorrectValidatorStateWithData` (operator IDs hash mismatch)

---

### OV-9: Remove Last Validator — Cluster Balance Preservation

**Modules Touched:** SSVValidators
**Bug Class Covered:** Cluster balance lost on last validator removal, incorrect EB cleanup

#### Preconditions
- Cluster with 1 validator (operator IDs [1,2,3,4])
- `cluster.balance = 5 ETH`, `cluster.validatorCount = 1`
- Created at block 200, removing at block 250

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `removeValidator(pk1, [1,2,3,4], cluster)` | 250 | Remove last validator, cluster persists with balance |
| 2 | `withdraw([1,2,3,4], remainingBalance, cluster)` | 260 | Withdraw remaining balance |

#### Assertions
- [ ] After Step 1: `cluster.validatorCount == 0`
- [ ] After Step 1: `cluster.active == true` (cluster not deactivated)
- [ ] After Step 1: `cluster.balance > 0` (remaining after fee settlement)
- [ ] After Step 1: Cluster hash stored in `s.ethClusters[hashedCluster]` (NOT deleted)
- [ ] After Step 1: Each `operator[1..4].ethValidatorCount == 0`
- [ ] After Step 1: `sp.ethDaoValidatorCount` decreased by 1
- [ ] After Step 2: cluster.balance == 0, ETH transferred to owner

#### Edge Variations
- Remove last validator when cluster has explicit EB: verify EB cleanup — `ebSnapshot.vUnits` zeroed, `operatorEthVUnits` decremented by remaining deviation, `daoTotalEthVUnits` decremented

---

### OV-10: Full Validator Lifecycle — Register, Advance, Remove, Advance, Verify

**Modules Touched:** SSVValidators, SSVOperators, ClusterLib, OperatorLib, ProtocolLib
**Bug Class Covered:** End-to-end economics correctness, fee gap/overlap

#### Preconditions
- 4 operators (IDs 1-4), public, freshly registered at block 100 with fee = 2_000_000_000 (2 gwei)
  - Packed: `2_000_000_000 / 100_000 = 20_000` → `PackedETH.wrap(20_000)`
- `sp.ethNetworkFee = PackedETH.wrap(35_509)` (≈ 3.5509 gwei)
- `sp.ethNetworkFeeIndexBlockNumber = 100`
- `sp.ethNetworkFeeIndex = 0`

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `registerValidator{value: 20 ETH}(pk1, [1,2,3,4], shares, emptyCluster)` | 200 | Create cluster |
| 2 | Advance 100 blocks | 300 | Fees accruing at 1-validator rate |
| 3 | `removeValidator(pk1, [1,2,3,4], cluster)` | 300 | Remove validator, settle fees |
| 4 | Advance 50 blocks | 350 | No validators, no new fees |
| 5 | `withdrawAllOperatorEarnings(1)` | 350 | Withdraw operator 1 earnings |

#### Phase 1: Registration (block 200)
- `ensureETHDefaults` — operators already have ethSnapshot.block != 0, no-op
- Each operator: `ethValidatorCount = 1`, `ethSnapshot.block = 200`
- Cluster: `balance = 20 ETH, validatorCount = 1, index = cumIdx_200, networkFeeIndex = nfi_200`

#### Phase 2: Fee Accrual (blocks 200-300)
Per operator earnings over 100 blocks:
- `blockDiffEthFee = 100 * 20_000 = 2_000_000`
- `effectiveVUnits = 1 * 10_000 = 10_000`
- `delta = (2_000_000 * 10_000) / 10_000 = 2_000_000`
- `ethSnapshot.balance = PackedETH.wrap(2_000_000)` = `200_000_000_000 wei` = `0.0000002 ETH`

#### Phase 3: Remove Validator (block 300)
Cluster fee settlement for 100 blocks:
- Operator index delta (cumulative): `4 * 2_000_000 = 8_000_000`
- Network fee index delta: `100 * 35_509 = 3_550_900`
- vUnits = 10_000
- operatorFeeUnits = `(8_000_000 * 10_000) / 10_000 = 8_000_000`
- networkFeeUnits = `(3_550_900 * 10_000) / 10_000 = 3_550_900`
- totalUsage = `(8_000_000 + 3_550_900) * 100_000 = 1_155_090_000_000`
- `cluster.balance = 20 ETH - 1_155_090_000_000 = 19_999_998_844_910_000_000`

After removal: `cluster.validatorCount = 0`, operators `ethValidatorCount = 0`

#### Phase 4: No Accrual (blocks 300-350)
- Each operator has `ethValidatorCount = 0` → `effectiveVUnits = 0`
- Even though `blockDiffEthFee != 0`, the `if (effectiveVUnits != 0 && blockDiffEthFee != 0)` guard prevents balance accumulation
- Operator earnings remain at `PackedETH.wrap(2_000_000)`

#### Phase 5: Withdraw (block 350)
- `withdrawAllOperatorEarnings(1)`:
  - `updateSnapshotSt(operator, 1)`:
    - `blockDiffEthFee = (350 - 300) * 20_000 = 1_000_000`
    - `effectiveVUnits = 0 + 0 * 10_000 = 0` → no balance change
    - `ethSnapshot.index += 1_000_000`
    - `ethSnapshot.block = 350`
  - `ethBalance = operator.ethSnapshot.balance` = `PackedETH.wrap(2_000_000)`
  - Transfer `2_000_000 * 100_000 = 200_000_000_000 wei`
  - `ethSnapshot.balance = PackedETH.wrap(0)`

#### Assertions
- [ ] Operator 1 withdraws exactly `200_000_000_000 wei` = `0.0000002 ETH`
- [ ] After step 5, operator 1's `ethSnapshot.balance == PackedETH.wrap(0)`
- [ ] Cluster balance at step 3 = `19_999_998_844_910_000_000`
- [ ] No additional fees accrued during blocks 300-350 (0 validators)
- [ ] Total system conservation: `cluster.balance + Σ(operator_earnings) + dao_earnings == 20 ETH` (initial deposit)
  - Cluster: `19_999_998_844_910_000_000`
  - 4 operators: `4 * 200_000_000_000 = 800_000_000_000`
  - DAO (network fee): `3_550_900 * 100_000 = 355_090_000_000` (network fee units * ETH_DEDUCTED_DIGITS)
  - Total: `19_999_998_844_910_000_000 + 800_000_000_000 + 355_090_000_000 = 20_000_000_000_000_000_000` ✓

---

### OV-11: Operator Fee Declaration → Wait → Execution

**Modules Touched:** SSVOperators
**Bug Class Covered:** Timelock bypass, fee applied at wrong block, earnings gap during fee change

#### Preconditions
- Operator 1: `ethFee = PackedETH.wrap(17_700)`, `ethValidatorCount = 2`, block 200
- `sp.declareOperatorFeePeriod = 100` (100 seconds)
- `sp.executeOperatorFeePeriod = 200` (200 seconds)
- `sp.operatorMaxFeeIncrease = 1000` (10%)
- `UPGRADE_TIMESTAMP = 1000` (migration timestamp in the past)

#### Action Sequence
| Step | Action | Block/Time | Expected State Change |
|------|--------|------------|----------------------|
| 1 | `declareOperatorFee(1, 1_900_000_000)` | block 300, time=2000 | Store fee change request |
| 2 | `executeOperatorFee(1)` at time=2050 | block 320 | Revert: too early |
| 3 | `executeOperatorFee(1)` at time=2100 | block 340 | Success: within window |
| 4 | Advance 50 blocks | block 390 | Verify new fee used |

#### Assertions

Step 1 (declare):
- [ ] New fee = 1_900_000_000, packed = `1_900_000_000 / 100_000 = 19_000`
- [ ] `maxAllowedFee = (17_700 * (10_000 + 1000) + 10_000 - 1) / 10_000 = (17_700 * 11_000 + 9_999) / 10_000 = (194_700_000 + 9_999) / 10_000 = 19_470` → `19_000 <= 19_470` ✓
- [ ] `feeChangeRequest = {fee: 19_000, approvalBeginTime: 2100, approvalEndTime: 2300}`
- [ ] `ensureETHDefaults` called if ethSnapshot.block == 0 (line 106-108)

Step 2 (too early):
- [ ] `block.timestamp (2050) < approvalBeginTime (2100)` → revert `ApprovalNotWithinTimeframe`

Step 3 (execute within window):
- [ ] `approvalBeginTime (2100) > UPGRADE_TIMESTAMP (1000)` ✓
- [ ] `block.timestamp (2100) >= approvalBeginTime (2100) && <= approvalEndTime (2300)` ✓
- [ ] `updateSnapshotSt(operator, 1)` called — settles earnings at OLD fee up to block 340
- [ ] `operator.ethFee = PackedETH.wrap(19_000)` (new fee)
- [ ] Fee change request deleted

Step 3 snapshot settlement (blocks 200-340):
- `blockDiff = 340 - 200 = 140`
- `blockDiffEthFee = 140 * 17_700 = 2_478_000`
- `effectiveVUnits = 2 * 10_000 = 20_000`
- `delta = (2_478_000 * 20_000) / 10_000 = 4_956_000`
- [ ] `ethSnapshot.balance == PackedETH.wrap(4_956_000)` (pre-fee-change earnings)
- [ ] `ethSnapshot.block = 340`

Step 4 (50 blocks at new fee, blocks 340-390):
- `blockDiffEthFee = 50 * 19_000 = 950_000`
- `effectiveVUnits = 20_000`
- `delta = (950_000 * 20_000) / 10_000 = 1_900_000`
- [ ] `ethSnapshot.balance == PackedETH.wrap(4_956_000 + 1_900_000) = PackedETH.wrap(6_856_000)`

#### Edge Variations
- Attempt execute after window: `block.timestamp > approvalEndTime` → revert `ApprovalNotWithinTimeframe`
- Declare then cancel: `cancelDeclaredOperatorFee` deletes request
- Declare then reduce: `reduceOperatorFee` also deletes pending fee change request
- Fee increase > 10%: revert `FeeExceedsIncreaseLimit`
- Fee increase when SSV fee = 0 AND ETH fee = 0: revert `FeeIncreaseNotAllowed`

---

### OV-12: Operator Fee Reduction (Immediate, No Timelock)

**Modules Touched:** SSVOperators
**Bug Class Covered:** Snapshot not updated before fee change, old earnings lost

#### Preconditions
- Operator 1: `ethFee = PackedETH.wrap(20_000)`, `ethValidatorCount = 3`, block 200
- Pending fee change request exists (from previous declare)

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `reduceOperatorFee(1, 1_000_000_000)` | 300 | Immediate fee reduction |

#### Detailed Trace:
- `checkOwner` — caller is owner
- `fee = 1_000_000_000`, `shrunkAmount = PackedETH.wrap(10_000)`
- `shrunkAmount.gte(operator.ethFee)` → `10_000 >= 20_000` → false → passes
- `operator.updateSnapshot(operatorId)`:
  - Read as memory: `Operator memory operator = s.operators[operatorId]`
  - `blockDiffEthFee = (300 - 200) * 20_000 = 2_000_000`
  - `effectiveVUnits = 3 * 10_000 = 30_000`
  - `delta = (2_000_000 * 30_000) / 10_000 = 6_000_000`
  - `ethSnapshot.balance += PackedETH.wrap(6_000_000)`
  - `ethSnapshot.index += 2_000_000`
  - `ethSnapshot.block = 300`
- `operator.ethFee = PackedETH.wrap(10_000)`
- `s.operators[operatorId] = operator` (write back to storage)
- `delete s.operatorFeeChangeRequests[operatorId]` (clears pending declaration)

#### Assertions
- [ ] `operator.ethFee == PackedETH.wrap(10_000)` (immediately reduced)
- [ ] `operator.ethSnapshot.balance == PackedETH.wrap(6_000_000)` (earnings at old fee preserved)
- [ ] `operator.ethSnapshot.block == 300`
- [ ] Pending fee change request deleted
- [ ] Event: `OperatorFeeExecuted(owner, 1, 300, 1_000_000_000)`
- [ ] Minimum fee check: if `minimumOperatorEthFee > 0`, fee must be >= minimum or revert `FeeTooLow` (unless fee==0)
  - NOTE: Code at line 185 checks `if (fee != 0 && fee < unpack(sp.minimumOperatorEthFee))` — so reducing to 0 skips the minimum check

#### Edge Variations
- Reduce to exactly current fee: `shrunkAmount.gte(operator.ethFee)` → true → revert `FeeIncreaseNotAllowed` (since gte, not gt)
- Reduce to higher fee: same revert
- Reduce to 0: allowed (skips minimum fee check) — **IMPORTANT**: once fee is 0, operator can NEVER increase again

---

### OV-13: Operator Earnings Accumulation and Withdrawal

**Modules Touched:** SSVOperators, OperatorLib
**Bug Class Covered:** Incorrect earnings calculation, snapshot balance not reset properly

#### Preconditions
- Operator 1: `ethFee = PackedETH.wrap(17_700)`, `ethValidatorCount = 5`
- `ethSnapshot = {block: 100, index: 0, balance: PackedETH.wrap(0)}`
- `seb.operatorEthVUnits[1] = 5_000` (deviation: 0.5 extra vUnits per validator on average)

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Advance to block 200 | 200 | 100 blocks of earnings |
| 2 | `withdrawOperatorEarnings(1, amount)` | 200 | Partial withdrawal |
| 3 | Advance to block 300 | 300 | 100 more blocks |
| 4 | `withdrawAllOperatorEarnings(1)` | 300 | Full withdrawal |

#### Phase 1: Earnings at block 200
- `blockDiffEthFee = (200 - 100) * 17_700 = 1_770_000`
- `effectiveVUnits = 5_000 + 5 * 10_000 = 55_000`
- `delta = (1_770_000 * 55_000) / 10_000 = 9_735_000`
- `ethSnapshot.balance = PackedETH.wrap(9_735_000)`
- Actual wei: `9_735_000 * 100_000 = 973_500_000_000`

#### Phase 2: Partial withdrawal
- Withdraw `500_000_000_000` wei (0.0000005 ETH)
- Packed: `500_000_000_000 / 100_000 = 5_000_000` → `PackedETH.wrap(5_000_000)`
- `balance < shrunkAmount` → `9_735_000 < 5_000_000` → false → sufficient
- `ethSnapshot.balance = 9_735_000 - 5_000_000 = PackedETH.wrap(4_735_000)`
- Transfer `500_000_000_000 wei` to owner

#### Phase 3: Earnings blocks 200-300
- `blockDiffEthFee = (300 - 200) * 17_700 = 1_770_000`
- Same effectiveVUnits = 55_000
- `delta = 9_735_000`
- `ethSnapshot.balance = 4_735_000 + 9_735_000 = PackedETH.wrap(14_470_000)`

#### Phase 4: Full withdrawal
- `amount == 0` → withdraw all
- Transfer `14_470_000 * 100_000 = 1_447_000_000_000 wei`
- `ethSnapshot.balance = PackedETH.wrap(0)`

#### Assertions
- [ ] Step 2: Owner receives exactly `500_000_000_000 wei`
- [ ] Step 2: `ethSnapshot.balance == PackedETH.wrap(4_735_000)`
- [ ] Step 4: Owner receives exactly `1_447_000_000_000 wei`
- [ ] Step 4: `ethSnapshot.balance == PackedETH.wrap(0)`
- [ ] Total withdrawn: `500_000_000_000 + 1_447_000_000_000 = 1_947_000_000_000`
- [ ] Expected total (200 blocks): `2 * 9_735_000 * 100_000 = 1_947_000_000_000` ✓

---

### OV-14: Remove Operator — Full Cleanup and Final Withdrawal

**Modules Touched:** SSVOperators
**Bug Class Covered:** Earnings lost on removal, state not fully cleaned up

#### Preconditions
- Operator 1: `ethFee = PackedETH.wrap(17_700)`, `ethValidatorCount = 0`, `validatorCount = 0`
- `ethSnapshot = {block: 200, index: 500_000, balance: PackedETH.wrap(1_000_000)}`
- `snapshot = {block: 200, index: 100, balance: PackedSSV.wrap(500)}`
- Fee change request exists for operator 1
- Whitelist exists for operator 1

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `removeOperator(1)` | 300 | Full cleanup + final withdrawal |

#### Detailed Trace:
1. `checkOwner()`: `snapshot.block != 0 || ethSnapshot.block != 0` → `200 != 0` → passes
2. `updateSnapshotsSt(operator, 1)`:
   - ETH: `blockDiffEthFee = (300 - 200) * 17_700 = 1_770_000`, `effectiveVUnits = 0`, no balance change
   - SSV: `blockDiffFee = (300 - 200) * ssvFee`, but fee might be 0 if SSV fees frozen
3. `currentBalanceETH = operator.ethSnapshot.balance` → `PackedETH.wrap(1_000_000)` (unchanged since vUnits=0)
4. `currentBalanceSSV = operator.snapshot.balance` → `PackedSSV.wrap(500)` (or whatever after SSV update)
5. `_resetOperatorState`:
   - `ethSnapshot.block = 0`
   - `ethSnapshot.balance = PACKED_ETH_ZERO`
   - `ethFee = PACKED_ETH_ZERO`
   - `snapshot.block = 0`
   - `snapshot.balance = PACKED_SSV_ZERO`
   - `fee = PACKED_SSV_ZERO`
   - `ethValidatorCount = 0`
   - `validatorCount = 0`
   - **NOT ZEROED: `ethSnapshot.index`, `snapshot.index`, `owner`, `whitelisted`**
6. `delete s.operatorsWhitelist[operatorId]`
7. ETH transfer: `1_000_000 * 100_000 = 100_000_000_000 wei`
8. SSV transfer: `500 * 10_000_000 = 5_000_000_000 wei SSV`

#### Assertions
- [ ] ETH transferred to owner: `100_000_000_000 wei`
- [ ] SSV transferred to owner: `5_000_000_000 wei SSV`
- [ ] `operator.owner == original_owner` (PRESERVED, not zeroed)
- [ ] `operator.ethSnapshot.block == 0`
- [ ] `operator.ethSnapshot.balance == PackedETH.wrap(0)`
- [ ] `operator.ethSnapshot.index != 0` (PRESERVED — frozen at last value)
- [ ] `operator.ethFee == PackedETH.wrap(0)`
- [ ] `operator.ethValidatorCount == 0`
- [ ] `operator.snapshot.block == 0`
- [ ] `s.operatorsWhitelist[1] == address(0)` (deleted)
- [ ] Fee change request deleted (NOTE: code does NOT explicitly delete fee change request in `removeOperator` — **verify this!**)
- [ ] Event: `OperatorWithdrawn(owner, 1, 100_000_000_000)` (ETH)
- [ ] Event: `OperatorWithdrawn(owner, 1, 5_000_000_000)` (SSV)
- [ ] Event: `OperatorRemoved(1)`

**NOTE:** After reviewing the code, `removeOperator` at `SSVOperators.sol:71-93` does NOT delete `s.operatorFeeChangeRequests[operatorId]`. This is documented in FLOWS.md section 4.2 as "Delete fee change request (if any)" but is NOT done in the code. The fee change request struct persists but is harmless since `checkOwner` will fail on any subsequent interaction. This is a minor discrepancy but not a bug.

#### Edge Variations
- Remove operator with `ethValidatorCount > 0`: see DISC-OV-3 — code does NOT check, but should it?
- Remove operator with 0 earnings in both versions: ETH/SSV transfers skipped (checked via `PackedETHLib.raw(currentBalanceETH) > 0`)
- Remove operator then try to register validator with it: `ensureOperatorExist` at OperatorLib.sol:159 will revert — `ethSnapshot.block == 0 && snapshot.block == 0`

---

### OV-15: Fee Change During Active Cluster — No Gap, No Double-Count

**Modules Touched:** SSVOperators, SSVValidators (via cluster update), ClusterLib
**Bug Class Covered:** Earnings gap between old fee and new fee, double-counting at fee boundary

#### Preconditions
- Operator 1: `ethFee = PackedETH.wrap(17_700)`, `ethValidatorCount = 3` (from cluster A with 3 validators)
- `ethSnapshot = {block: 100, index: 0, balance: PackedETH.wrap(0)}`
- Other 3 operators (IDs 2-4) with same fee

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Advance to block 200 | 200 | 100 blocks at old fee |
| 2 | `declareOperatorFee(1, 2_000_000_000)` | 200 | Declaration |
| 3 | Wait for approval period, execute at block 300 | 300 | Fee changes |
| 4 | Advance to block 400 | 400 | 100 blocks at new fee |
| 5 | Trigger cluster state update (deposit 0 or any operation) | 400 | Verify total cluster fees |

#### Key Verification Points:

**At fee execution (block 300):**
- `executeOperatorFee` calls `updateSnapshotSt(operator, 1)`:
  - Settles earnings from block 100 to 300 at OLD fee (17_700)
  - `blockDiffEthFee = 200 * 17_700 = 3_540_000`
  - `effectiveVUnits = 3 * 10_000 = 30_000`
  - `delta = (3_540_000 * 30_000) / 10_000 = 10_620_000`
  - `ethSnapshot.balance = PackedETH.wrap(10_620_000)`
  - `ethSnapshot.index = 3_540_000`
  - `ethSnapshot.block = 300`
- Then sets `operator.ethFee = PackedETH.wrap(20_000)` (new fee)

**At block 400:**
- `blockDiffEthFee = (400 - 300) * 20_000 = 2_000_000`
- `delta = (2_000_000 * 30_000) / 10_000 = 6_000_000`
- `ethSnapshot.balance = 10_620_000 + 6_000_000 = PackedETH.wrap(16_620_000)`
- `ethSnapshot.index = 3_540_000 + 2_000_000 = 5_540_000`

**Cluster balance verification at block 400:**
The cluster's stored `cluster.index` was set at last interaction (say block 100):
- Cumulative operator index = Σ(operator.ethSnapshot.index) = op1: 5_540_000 + op2-4: 3*5_310_000 (at fee 17_700 for 300 blocks)
  - Wait, ops 2-4 kept fee 17_700. Their index at block 400: `(400-100) * 17_700 = 5_310_000`
- Total clusterIndex = `5_540_000 + 3 * 5_310_000 = 5_540_000 + 15_930_000 = 21_470_000`
- If cluster.index was 0 (set at block 100):
  - indexDelta = 21_470_000
  - operatorFeeUnits = `(21_470_000 * 30_000) / 10_000 = 64_410_000`
- This matches: 200 blocks × 4 ops × 17_700 × 3 vUnits + 100 blocks × (1×20_000 + 3×17_700) × 3 vUnits
  - = 200 × (4 × 17_700) × 30_000/10_000 + 100 × (20_000 + 53_100) × 30_000/10_000
  - = 200 × 70_800 × 3 + 100 × 73_100 × 3
  - = 42_480_000 + 21_930_000 = 64_410_000 ✓

#### Assertions
- [ ] No earnings gap: block 300 earnings from blocks 100-300 settled before fee change
- [ ] No double-count: block 300 snapshot.block updated to 300, so subsequent 100 blocks use new fee starting from 300
- [ ] Cluster balance deduction is mathematically continuous across fee change
- [ ] `cluster.balance == initialBalance - (64_410_000 + networkFeeUnits) * 100_000`

---

### OV-16: Multi-Cluster Operator — Earnings From Multiple Clusters

**Modules Touched:** SSVOperators, SSVValidators, OperatorLib
**Bug Class Covered:** Operator earnings double-counted or under-counted across clusters

#### Preconditions
- Operator 1: public, `ethFee = PackedETH.wrap(17_700)`, initially `ethValidatorCount = 0`
- Operators 2-4: same setup
- Block 100: operators created

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | User A: `registerValidator{10 ETH}(pkA1, [1,2,3,4], ..., emptyCluster)` | 200 | Cluster A: 1 validator |
| 2 | User A: `registerValidator{5 ETH}(pkA2, [1,2,3,4], ..., clusterA)` | 200 | Cluster A: 2 validators |
| 3 | User B: `registerValidator{15 ETH}(pkB1, [1,2,3,4], ..., emptyCluster)` | 200 | Cluster B: 1 validator (different owner) |
| 4 | User B: bulk register 2 more validators | 200 | Cluster B: 3 validators |
| 5 | Advance 100 blocks | 300 | 5 total validators, earn fees |
| 6 | User A: `removeValidator(pkA1, [1,2,3,4], clusterA)` | 300 | Cluster A: 1 validator |
| 7 | User A: `removeValidator(pkA2, [1,2,3,4], clusterA)` | 300 | Cluster A: 0 validators |
| 8 | Advance 100 blocks | 400 | 3 validators (cluster B only) |

#### Assertions

After Step 4 (block 200):
- [ ] Operator 1: `ethValidatorCount == 5` (2 from A + 3 from B)
- [ ] `sp.ethDaoValidatorCount == 5`
- [ ] `sp.daoTotalEthVUnits == 50_000`

After Step 5 (block 300):
- Operator 1 earnings for 100 blocks with 5 validators:
  - `blockDiffEthFee = 100 * 17_700 = 1_770_000`
  - `effectiveVUnits = 5 * 10_000 = 50_000`
  - `delta = (1_770_000 * 50_000) / 10_000 = 8_850_000`
- [ ] `operator[1].ethSnapshot.balance == PackedETH.wrap(8_850_000)` (after next snapshot update)

After Steps 6-7 (block 300, remove both from cluster A):
- `updateClusterOperators` is called for each remove, settling operator snapshots
- After removing 2 validators from cluster A:
  - `operator[1].ethValidatorCount = 3` (only cluster B's 3 remain)
- [ ] `sp.ethDaoValidatorCount == 3`

After Step 8 (block 400):
- Operator earnings for blocks 300-400 with 3 validators:
  - `blockDiffEthFee = 100 * 17_700 = 1_770_000`
  - `effectiveVUnits = 3 * 10_000 = 30_000`
  - `delta = (1_770_000 * 30_000) / 10_000 = 5_310_000`
- [ ] `operator[1].ethSnapshot.balance == PackedETH.wrap(8_850_000 + 5_310_000) = PackedETH.wrap(14_160_000)`
- [ ] No double-subtraction: each `removeValidator` only decrements `ethValidatorCount` by 1

---

### OV-17: Operator Removal After All Validators Removed — Final Earnings

**Modules Touched:** SSVOperators, SSVValidators
**Bug Class Covered:** Final earnings lost on removal, incomplete cleanup

#### Preconditions
- Operator 1: `ethFee = PackedETH.wrap(17_700)`, `ethValidatorCount = 2`
- Cluster with 2 validators (operators [1,2,3,4])
- Block 200: initial state

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `removeValidator(pk1, [1,2,3,4], cluster)` | 300 | 1 validator left |
| 2 | `removeValidator(pk2, [1,2,3,4], cluster)` | 350 | 0 validators |
| 3 | `removeOperator(1)` | 400 | Final cleanup |

#### Phase 1 (blocks 200-300, 2 validators):
- Operator 1 earnings:
  - `blockDiffEthFee = 100 * 17_700 = 1_770_000`
  - `effectiveVUnits = 2 * 10_000 = 20_000`
  - `delta = (1_770_000 * 20_000) / 10_000 = 3_540_000`
  - `ethSnapshot.balance = PackedETH.wrap(3_540_000)`

After step 1: `ethValidatorCount = 1`

#### Phase 2 (blocks 300-350, 1 validator):
- `blockDiffEthFee = 50 * 17_700 = 885_000`
- `effectiveVUnits = 1 * 10_000 = 10_000`
- `delta = (885_000 * 10_000) / 10_000 = 885_000`
- `ethSnapshot.balance = 3_540_000 + 885_000 = PackedETH.wrap(4_425_000)`

After step 2: `ethValidatorCount = 0`

#### Phase 3 (blocks 350-400, 0 validators):
- `updateSnapshotsSt(operator, 1)`:
  - ETH: `blockDiffEthFee = 50 * 17_700 = 885_000`, `effectiveVUnits = 0`, no balance change
  - SSV: similar, no change
- `currentBalanceETH = PackedETH.wrap(4_425_000)`
- `_resetOperatorState`: zeroes everything except owner and indices
- Transfer ETH: `4_425_000 * 100_000 = 442_500_000_000 wei`

#### Assertions
- [ ] Final ETH withdrawal: `442_500_000_000 wei`
- [ ] This equals total earnings: 100 blocks × 2 validators + 50 blocks × 1 validator = `(3_540_000 + 885_000) * 100_000`
- [ ] After removal, operator cannot be used to register new validators
- [ ] `operator.ethSnapshot.block == 0` (detection condition for removed operator)
- [ ] `operator.owner` still preserved

---

### OV-18: withdrawAllVersionOperatorEarnings — Combined ETH + SSV Withdrawal

**Modules Touched:** SSVOperators
**Bug Class Covered:** Mixed-version withdrawal, one version's earnings blocking the other

#### Preconditions
- Operator 1: dual earnings
  - ETH: `ethSnapshot.balance = PackedETH.wrap(1_000_000)` → `100_000_000_000 wei`
  - SSV: `snapshot.balance = PackedSSV.wrap(500)` → `5_000_000_000 wei SSV`
- `ethValidatorCount = 2`, `validatorCount = 1` (still has SSV cluster)

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `withdrawAllVersionOperatorEarnings(1)` | 300 | Withdraw both ETH and SSV |

#### Detailed Trace:
1. `checkOwner()` — passes
2. Read into memory: `Operator memory operator = s.operators[operatorId]`
3. `operator.updateSnapshots(operatorId)`:
   - `updateSnapshot(operator, operatorId)` — updates ETH snapshot (memory)
   - `updateSnapshotSSV(operator)` — updates SSV snapshot (memory)
4. Save balances: `ethBalance`, `ssvBalance`
5. Zero both: `ethSnapshot.balance = PACKED_ETH_ZERO`, `snapshot.balance = PACKED_SSV_ZERO`
6. Write back: `s.operators[operatorId] = operator`
7. Transfer ETH (if > 0): `CoreLib.transferBalance`
8. Transfer SSV (if > 0): `CoreLib.transferTokenBalance`

#### Assertions
- [ ] ETH transferred: `(1_000_000 + additional_from_update) * 100_000 wei`
- [ ] SSV transferred: `(500 + additional_from_update) * 10_000_000 wei SSV`
- [ ] Both balances zeroed in storage
- [ ] Both snapshot blocks updated to current
- [ ] Event: `OperatorWithdrawn(owner, 1, ethAmount)` for ETH
- [ ] Event: `OperatorWithdrawn(owner, 1, ssvAmount)` for SSV

#### Edge Variations
- Only ETH earnings, no SSV: SSV transfer skipped, only ETH event emitted
- Only SSV earnings, no ETH: ETH transfer skipped, only SSV event emitted
- Zero earnings in both: ETH transfer skipped AND SSV transfer skipped. No events? Wait — `checkOwner` still passes. The function doesn't revert on zero earnings. It just does nothing. No `InsufficientBalance` revert since the individual `raw > 0` checks handle it.

---

### OV-19: Register Validator — Revert Cases

**Modules Touched:** SSVValidators, ValidatorLib, OperatorLib, ClusterLib
**Bug Class Covered:** Missing validation, incorrect error messages

#### Test Matrix

| Case | Input | Expected Error |
|------|-------|----------------|
| Empty public key list | `bulkRegisterValidator([], ...)` | `EmptyPublicKeysList` |
| Key/share length mismatch | `bulkRegisterValidator([pk1,pk2], ..., [s1])` | `PublicKeysSharesLengthMismatch` |
| Invalid public key length | `registerValidator(bytes(32), ...)` | `InvalidPublicKeyLength` |
| < 4 operators | `registerValidator(pk, [1,2,3], ...)` | `InvalidOperatorIdsLength` |
| > 13 operators | `registerValidator(pk, [1..14], ...)` | `InvalidOperatorIdsLength` |
| 5 operators (not 4,7,10,13) | `registerValidator(pk, [1,2,3,4,5], ...)` | `InvalidOperatorIdsLength` |
| Unsorted operators | `registerValidator(pk, [3,1,2,4], ...)` | `UnsortedOperatorsList` |
| Duplicate operators | `registerValidator(pk, [1,1,2,3], ...)` | `OperatorsListNotUnique` |
| Removed operator in list | `registerValidator(pk, [1,2,3,4], ...)` where op1 removed | `OperatorDoesNotExist` |
| Validator already registered | `registerValidator(pk, ...)` twice | `ValidatorAlreadyExistsWithData` |
| Wrong cluster state | Cluster with wrong validatorCount | `IncorrectClusterState` |
| SSV cluster exists for same key | ETH cluster creation when SSV cluster exists | `IncorrectClusterVersion` |
| Private operator, not whitelisted | Register on private operator | `CallerNotWhitelistedWithData` |
| Exceeds validator limit | Register when operator at capacity | `ExceedValidatorLimitWithData` |
| Insufficient balance | 0 ETH sent, cluster would be liquidatable | `InsufficientBalance` |
| Liquidated cluster | Try register on liquidated cluster | `ClusterIsLiquidated` |

---

### OV-20: Remove Validator — Revert Cases

**Modules Touched:** SSVValidators
**Bug Class Covered:** Authorization bypass, wrong validator removal

| Case | Input | Expected Error |
|------|-------|----------------|
| Validator doesn't exist | `removeValidator(nonExistentPk, ...)` | `IncorrectValidatorStateWithData` |
| Wrong owner | Caller != validator owner | `IncorrectValidatorStateWithData` (different hash) |
| Wrong operator IDs | Different operators than registered | `IncorrectValidatorStateWithData` |
| Cluster doesn't exist | Non-existent cluster hash | `ClusterDoesNotExist` |
| Wrong cluster version | Try to remove from SSV cluster | `IncorrectClusterVersion` |
| Empty public keys list | `bulkRemoveValidator([], ...)` | `ValidatorDoesNotExist` |
| Wrong cluster state | Stale cluster struct | `IncorrectClusterState` |

---

### OV-21: Operator Remove Revert Cases

**Modules Touched:** SSVOperators
**Bug Class Covered:** Unauthorized removal, double removal

| Case | Input | Expected Error |
|------|-------|----------------|
| Operator doesn't exist | `removeOperator(999)` | `OperatorDoesNotExist` |
| Wrong owner | Caller != operator owner | `CallerNotOwnerWithData` |
| Already removed | `removeOperator(1)` twice | `OperatorDoesNotExist` (block == 0) |

---

### OV-22: Race Condition — Register and Remove in Same Block

**Modules Touched:** SSVValidators
**Bug Class Covered:** Zero-block-diff edge case, snapshot not updated

#### Preconditions
- 4 operators, `ethFee = PackedETH.wrap(17_700)`, initialized at block 100
- Cluster with 1 validator, created at block 100

#### Action Sequence (all at block 200)
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `registerValidator{5 ETH}(pk2, [1,2,3,4], shares, cluster)` | 200 | Add validator, settle fees for blocks 100-200 |
| 2 | `removeValidator(pk1, [1,2,3,4], updatedCluster)` | 200 | Remove validator, blockDiff=0 for second operation |

#### Key Verification:

Step 1 settles 100 blocks of fees and adds validator. At the end:
- Each operator: `ethSnapshot.block = 200`, `ethValidatorCount = 2`
- Cluster: `validatorCount = 2`, fees settled for 100 blocks

Step 2 at the same block:
- `updateClusterOperators` called with `blockDiff = 200 - 200 = 0`
- `blockDiffEthFee = 0 * 17_700 = 0`
- No earnings accumulated (correct — 0 blocks passed)
- `ethValidatorCount -= 1` → each operator has `ethValidatorCount = 1`
- Cluster fee settlement: `updateClusterData` with `blockDiff = 0` → no additional fees deducted (correct)

#### Assertions
- [ ] No double-counting: 100 blocks of fees settled exactly once in step 1
- [ ] No missing fees: 0-block-diff in step 2 correctly adds 0 fees
- [ ] Final `ethValidatorCount = 1` per operator (correct: added 1, removed 1)
- [ ] Cluster `validatorCount = 1` (added 1 to make 2, removed 1 to make 1)

---

### OV-23: ensureETHDefaults with Zero SSV Fee — Default Fee NOT Assigned

**Modules Touched:** OperatorLib
**Bug Class Covered:** Zero-fee operator unexpectedly gets default fee, or vice versa

#### Preconditions
- Legacy operator with:
  - `fee = PackedSSV.wrap(0)` (free SSV operator)
  - `snapshot.block = 100` (SSV initialized)
  - `ethSnapshot.block = 0` (not ETH initialized)
  - `ethFee = PackedETH.wrap(0)`

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | First ETH interaction triggers `ensureETHDefaults()` | 200 | ethFee stays 0 |

#### Trace through `ensureETHDefaults` (OperatorLib.sol:142-153):
1. `if(operator.ethSnapshot.block == 0)` → true, enter block
2. Inner `if (operator.ethSnapshot.block == 0)` → true (redundant check):
   - `operator.ethSnapshot.block = 200`
   - `operator.ethSnapshot.balance = PACKED_ETH_ZERO`
3. `if (operator.ethFee.eq(PACKED_ETH_ZERO) && operator.fee.neq(PACKED_SSV_ZERO))`:
   - `ethFee == 0` → true
   - `fee != 0` → **false** (SSV fee is 0)
   - Condition is false → `ethFee` NOT set to default

#### Assertions
- [ ] `operator.ethFee == PackedETH.wrap(0)` (stays zero — free operator)
- [ ] `operator.ethSnapshot.block == 200` (initialized)
- [ ] Validators using this operator accrue ZERO operator fees (correct for free operator)
- [ ] This operator can NEVER increase fee: `declareOperatorFee` will hit `FeeIncreaseNotAllowed` check

#### Critical Test: Verify that a cluster using 4 operators where 1 is free only accrues fees from the 3 paid operators:
- cumulativeFee = 3 * 17_700 + 1 * 0 = 53_100 (not 70_800)
- Cluster burn rate uses this lower fee → cluster lasts longer

---

### OV-24: Precision Loss in Operator Earnings — vUnits Division Truncation

**Modules Touched:** OperatorLib (updateSnapshot/updateSnapshotSt)
**Bug Class Covered:** Precision loss from integer division, earnings leak

#### Preconditions
- Operator 1: `ethFee = PackedETH.wrap(1)` (minimum possible fee: 1 packed = 100_000 wei)
- `ethValidatorCount = 1`, `effectiveVUnits = 10_000` (1 validator at 32 ETH)

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Advance 1 block | 101 | Check earnings |

#### Earnings Calculation:
- `blockDiffEthFee = 1 * 1 = 1`
- `delta = (1 * 10_000) / 10_000 = 1`
- `ethSnapshot.balance += PackedETH.wrap(1)` = `100_000 wei` per block

#### Assertions
- [ ] Minimum earnable amount per block = `100_000 wei` (ETH_DEDUCTED_DIGITS precision)
- [ ] No precision loss with standard vUnits (10_000 divides evenly)

#### Edge Case with Non-Standard vUnits:
- `effectiveVUnits = 10_001` (deviation of 1)
- `delta = (1 * 10_001) / 10_000 = 1` (floor division, 0.0001 vUnits lost)
- Over 10_000 blocks: `delta = (10_000 * 10_001) / 10_000 = 10_001` — no loss!
- The loss only occurs when `blockDiffEthFee * effectiveVUnits < VUNITS_PRECISION`

#### Worst-Case Precision Loss:
- `fee = 1` (packed), `effectiveVUnits = 1` (extreme case)
- `delta = (1 * 1) / 10_000 = 0` — **zero earnings!**
- Need `blockDiffEthFee * effectiveVUnits >= 10_000` to earn anything
- With `effectiveVUnits = 1` and `fee = 1`, need to wait 10_000 blocks

- [ ] Verify: operator with `effectiveVUnits = 1` and minimum fee earns 0 per block but accumulates over time once enough blocks pass
- [ ] This is by design (fixed-point arithmetic) but tests should verify the behavior is expected

---

### OV-25: Cluster Balance Underflow Protection

**Modules Touched:** ClusterLib (updateBalanceWithEB)
**Bug Class Covered:** Balance underflow causing revert or wrap-around

#### Preconditions
- Cluster with 1 validator, `balance = 1_000_000` (1 million wei, very small)
- 4 operators with `ethFee = PackedETH.wrap(17_700)`
- networkFee active

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Advance many blocks until fees exceed balance | N | Balance floors at 0 |

#### Trace through `updateBalanceWithEB` (ClusterLib.sol:298-313):
```
vUnits = 10_000
idxOp = cumOperatorIndex - cluster.index
idxNet = currentNetworkFeeIndex - cluster.networkFeeIndex
operatorFeeUnits = (idxOp * 10_000) / 10_000 = idxOp
networkFeeUnits = (idxNet * 10_000) / 10_000 = idxNet
usageUnits = idxOp + idxNet
usage = usageUnits * 100_000

cluster.balance = usage > cluster.balance ? 0 : cluster.balance - usage
```

When `usage > 1_000_000`:
- `cluster.balance` is set to 0, NOT underflow

#### Assertions
- [ ] `cluster.balance == 0` after fees exceed balance (not a revert, not negative)
- [ ] Cluster is now liquidatable (balance < minimumLiquidationCollateral)
- [ ] Operator earnings are NOT affected by cluster running dry — they earn independently

#### Edge Variation
- What happens when cluster balance is exactly equal to usage? → `usage > balance` is false → `balance = balance - usage = 0`

---

### OV-26: Exit Validator — Signal Only, No State Change

**Modules Touched:** SSVValidators (exitValidator, bulkExitValidator)
**Bug Class Covered:** Exit incorrectly modifying state

#### Preconditions
- Validator registered with operators [1,2,3,4], owner = caller

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `exitValidator(pk, [1,2,3,4])` | 200 | Event emitted, NO state change |

#### Trace (SSVValidators.sol:83-91):
1. `ValidatorLib.validateCorrectState(validatorPKs[hash], hashedOperatorIds)` — checks validator exists with correct operators
2. `emit ValidatorExited(msg.sender, operatorIds, publicKey)`
3. No storage writes, no balance changes, no validator count changes

#### Assertions
- [ ] `validatorPKs[hash]` unchanged (validator still registered)
- [ ] `operator.ethValidatorCount` unchanged
- [ ] `cluster.validatorCount` unchanged
- [ ] `cluster.balance` unchanged
- [ ] Only event emitted: `ValidatorExited`
- [ ] Validator can still be removed via `removeValidator` after exit

#### Edge Variations
- Exit non-existent validator: revert `IncorrectValidatorStateWithData`
- Exit with wrong operator IDs: revert `IncorrectValidatorStateWithData`
- Exit by non-owner: validator hash includes owner address, so wrong owner produces wrong hash → revert

---

### OV-27: DAO Network Fee Earnings — Consistency with Operator/Cluster Accounting

**Modules Touched:** ProtocolLib, ClusterLib
**Bug Class Covered:** DAO earnings not matching what clusters pay in network fees

#### Preconditions
- `sp.ethNetworkFee = PackedETH.wrap(35_509)` (≈ 3.55 gwei)
- `sp.ethDaoValidatorCount = 5`
- `sp.daoTotalEthVUnits = 50_000` (5 validators, no EB deviation)
- `sp.ethDaoBalance = PackedETH.wrap(0)`
- `sp.ethDaoIndexBlockNumber = 100`
- 2 clusters: A (2 validators), B (3 validators)

#### Verification After 100 Blocks (block 200):

**DAO earnings (ProtocolLib.networkTotalEarnings):**
- `units = 50_000`
- `idx = 200 - 100 = 100`
- `earningsUnits = (100 * 35_509 * 50_000) / 10_000 = (177_545_000_000) / 10_000 = 17_754_500`
- Hmm wait: `idx = uint64(block.number) - sp.ethDaoIndexBlockNumber = 100`
- `earningsUnits = (100 * 35_509 * 50_000) / 10_000 = 17_754_500`
- `daoBalance = 0 + 17_754_500` → `PackedETH.wrap(17_754_500)`
- Actual: `17_754_500 * 100_000 = 1_775_450_000_000 wei`

**Cluster A's network fee payment:**
- `networkFeeIndexDelta = 100 * 35_509 = 3_550_900`
- `vUnits = 20_000` (2 validators)
- `networkFeeUnits = (3_550_900 * 20_000) / 10_000 = 7_101_800`
- Fee paid: `7_101_800 * 100_000 = 710_180_000_000 wei`

**Cluster B's network fee payment:**
- `vUnits = 30_000` (3 validators)
- `networkFeeUnits = (3_550_900 * 30_000) / 10_000 = 10_652_700`
- Fee paid: `10_652_700 * 100_000 = 1_065_270_000_000 wei`

**Total cluster payments:** `710_180_000_000 + 1_065_270_000_000 = 1_775_450_000_000`

#### Assertions
- [ ] `DAO earnings == Σ(cluster network fee payments)` → `1_775_450_000_000 == 1_775_450_000_000` ✓
- [ ] This invariant holds because DAO uses `daoTotalEthVUnits` which equals `Σ(clusterVUnits)` when all are implicit
- [ ] With explicit EB, the invariant still holds as long as EB deviations are tracked correctly

---

### OV-28: Operator Index Frozen After Removal — Cluster Still Functions

**Modules Touched:** SSVOperators, SSVValidators, OperatorLib, ClusterLib
**Bug Class Covered:** Cluster operation fails when one operator is removed

#### Preconditions
- Cluster with 1 validator on operators [1,2,3,4]
- All operators `ethFee = PackedETH.wrap(17_700)`, block 100
- At block 150: operator 1 has 0 validators in other clusters, gets removed by its owner (if no validator count check — see DISC-OV-3)

Wait — this scenario depends on DISC-OV-3. If operator removal requires 0 validators AND this cluster has 1 validator on operator 1, then operator 1 can't be removed. Let me reformulate:

#### Revised Scenario:
- Operator 1 serves ONLY cluster A (1 validator). Operator 1 has `ethValidatorCount = 1`.
- If DISC-OV-3 is a true bug (no check), operator can be removed with active validators.
- If it's not a bug (code intentionally allows it), trace what happens.

Actually, re-examining the code: `removeOperator` at `SSVOperators.sol:71-93` does NOT check validator counts. It just calls `updateSnapshotsSt`, saves balances, resets state, and transfers. So an operator WITH validators CAN be removed.

After removal:
- `operator.ethSnapshot.block = 0`
- `operator.ethSnapshot.index = 1_770_000` (preserved from last update, 100 blocks × 17_700)
- Wait, let me recalculate: `updateSnapshotsSt` is called which runs `updateSnapshotSt`. At block 150:
  - `blockDiffEthFee = (150 - 100) * 17_700 = 885_000`
  - `effectiveVUnits = 1 * 10_000 = 10_000`
  - `delta = (885_000 * 10_000) / 10_000 = 885_000`
  - `ethSnapshot.index += 885_000` → `ethSnapshot.index = 885_000`
  - `ethSnapshot.block = 150`
- Then `_resetOperatorState` zeroes block and balance but preserves index at 885_000

Now when cluster tries to remove validator at block 200:
- `updateClusterOperators` for operator 1: `ethSnapshot.block == 0` → skip (line 267)
- `cumulativeIndex += operator.ethSnapshot.index` = `cumulativeIndex += 885_000` (frozen index contributes)
- The cluster sees operator 1's index as frozen at 885_000
- Operators 2-4 continue normally: their indices grow

Effect: cluster's operator fee calculation uses a frozen index for operator 1 — the cluster stops paying operator 1's fee after removal. This is correct behavior since operator 1 has been removed and its earnings withdrawn.

#### Assertions
- [ ] After operator removal: `operator[1].ethSnapshot.block == 0`, `ethSnapshot.index` preserved
- [ ] Cluster operations (remove validator, liquidate) still work — removed operator contributes frozen index
- [ ] Cluster stops accruing fees for the removed operator (index doesn't grow)
- [ ] `sp.ethDaoValidatorCount` is NOT decremented when operator is removed (only when cluster operations decrement)
- [ ] **INVARIANT BROKEN**: `ethDaoValidatorCount > Σ(active_operator.ethValidatorCount)` after operator removal with active validators

---

### OV-29: Concurrent Fee Changes on Multiple Operators in Same Cluster

**Modules Touched:** SSVOperators, ClusterLib
**Bug Class Covered:** Multiple operator fee changes creating accounting inconsistency

#### Preconditions
- Cluster with 1 validator on operators [1,2,3,4]
- All operators initially `ethFee = PackedETH.wrap(17_700)`
- Block 100: cluster created

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Op1 owner: `declareOperatorFee(1, 2_000_000_000)` | 200 | Pending increase for op1 |
| 2 | Op3 owner: `reduceOperatorFee(3, 1_000_000_000)` | 200 | Immediate reduction for op3 |
| 3 | Op1 owner: `executeOperatorFee(1)` | 300 (after timelock) | Op1 fee changes |
| 4 | Trigger cluster update (e.g., deposit) | 400 | Verify total fees correct |

#### Fee History:
- Blocks 100-200: all operators at 17_700
- Block 200: op3 changes to 10_000 immediately
- Blocks 200-300: op1,2,4 at 17_700; op3 at 10_000
- Block 300: op1 changes to 20_000
- Blocks 300-400: op1 at 20_000; op2,4 at 17_700; op3 at 10_000

#### Cluster Cumulative Index at Block 400:
- Op1: `(200-100)*17_700 + (300-200)*17_700 + (400-300)*20_000 = 1_770_000 + 1_770_000 + 2_000_000 = 5_540_000`
- Op2: `(400-100)*17_700 = 5_310_000`
- Op3: `(200-100)*17_700 + (400-200)*10_000 = 1_770_000 + 2_000_000 = 3_770_000`
- Op4: same as op2 = `5_310_000`
- Total cluster index: `5_540_000 + 5_310_000 + 3_770_000 + 5_310_000 = 19_930_000`

Cluster fee from initial index (0):
- `operatorFeeUnits = (19_930_000 * 10_000) / 10_000 = 19_930_000`
- `feeWei = 19_930_000 * 100_000 = 1_993_000_000_000`

#### Assertions
- [ ] Each operator's snapshot captures the fee at the right time via `updateSnapshot`/`updateSnapshotSt` before fee change
- [ ] Cluster pays the correct blended rate over the period
- [ ] No fee is double-counted or lost at the fee change boundaries
- [ ] Each `reduceOperatorFee` and `executeOperatorFee` calls `updateSnapshot` before changing fee

---

### OV-30: Operator Registration Then Immediate Validator Registration — Same Block

**Modules Touched:** SSVOperators, SSVValidators
**Bug Class Covered:** Zero-block-diff between operator registration and first validator

#### Preconditions
- No operators, no clusters

#### Action Sequence (all at block 200)
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Register operators 1-4 with fee 2_000_000_000 | 200 | All operators created |
| 2 | `registerValidator{10 ETH}(pk, [1,2,3,4], shares, emptyCluster)` | 200 | Cluster created |

#### Key Points:
- When operators are registered at block 200, `ethSnapshot.block = 200` (set in `registerOperator`)
- When `registerValidator` runs at same block:
  - `ensureETHDefaults` is a no-op (ethSnapshot.block already != 0)
  - `updateSnapshot`: `blockDiff = 200 - 200 = 0` → no earnings, no index change
  - `ethValidatorCount += 1` → each operator has 1 validator

#### Assertions
- [ ] No error or unexpected behavior from 0-block-diff
- [ ] Operator earnings start accruing from block 200 (first block with validators)
- [ ] `ethSnapshot.index = 0` (no accumulation yet)
- [ ] At block 201: each operator earns `1 * 20_000 * 10_000 / 10_000 = 20_000` packed = `2_000_000 wei`

---

### OV-31: Large Number of Operators (13 Operators) — Gas and Correctness

**Modules Touched:** SSVValidators, OperatorLib
**Bug Class Covered:** Gas limits, loop-related errors with max operators

#### Preconditions
- 13 operators (IDs 1-13), all public, all `ethFee = PackedETH.wrap(17_700)`

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `registerValidator{50 ETH}(pk, [1,2,3,4,5,6,7,8,9,10,11,12,13], shares, emptyCluster)` | 200 | 13-operator cluster |
| 2 | Advance 100 blocks | 300 | Verify fees |

#### Assertions
- [ ] `cluster.validatorCount == 1`
- [ ] Each of 13 operators: `ethValidatorCount == 1`
- [ ] Cumulative fee = `13 * 17_700 = 230_100`
- [ ] After 100 blocks:
  - Each operator earnings: `(100 * 17_700 * 10_000) / 10_000 = 1_770_000` packed
  - Cluster operator fee units: `(13 * 1_770_000 * 10_000) / 10_000 = 23_010_000`
  - Cluster network fee units: `(100 * 35_509 * 10_000) / 10_000 = 3_550_900`
  - Total usage: `(23_010_000 + 3_550_900) * 100_000 = 2_656_090_000_000`
- [ ] `cluster.balance == 50 ETH - 2_656_090_000_000`
- [ ] Transaction doesn't run out of gas

---

### OV-32: Validator Registration with Explicit EB (post-updateClusterBalance)

**Modules Touched:** SSVValidators, SSVStorageEB
**Bug Class Covered:** EB baseline not updated on registration, incorrect vUnits after adding validator

#### Preconditions
- Cluster with 2 validators, explicit EB set:
  - `ebSnapshot.vUnits = 25_000` (2 validators with total EB of 80 ETH → ceil(80*10_000/32) = 25_000)
  - `seb.operatorEthVUnits[1..4] = 5_000 / 4 = 1_250` per operator
    - Wait, deviation = 25_000 - 2*10_000 = 5_000 total. Split across 4 operators: 1_250 each
  - `sp.daoTotalEthVUnits = sp.ethDaoValidatorCount * 10_000 + 5_000`

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `registerValidator{5 ETH}(pk3, [1,2,3,4], shares, cluster)` | 300 | Add validator, update EB |

#### Trace through SSVValidators.sol lines 142-153:
```solidity
if (ebSnapshot.vUnits > 0) {
    ebSnapshot.vUnits += uint64(validatorsLength) * VUNITS_PRECISION;
}
```
- `ebSnapshot.vUnits = 25_000 + 1 * 10_000 = 35_000`
- `operatorEthVUnits` NOT updated (deviation unchanged on registration)

#### Assertions
- [ ] `ebSnapshot.vUnits == 35_000` (original 25_000 + 10_000 baseline for new validator)
- [ ] `seb.operatorEthVUnits[1..4]` unchanged (deviation stays at 1_250 each)
- [ ] New validator gets default 32 ETH EB assumption (10_000 vUnits baseline)
- [ ] Total deviation after: `35_000 - 3 * 10_000 = 5_000` (unchanged from before)
- [ ] `sp.daoTotalEthVUnits += 10_000` (from `updateDAO(true, 1)`)
- [ ] Future fee calculations use `vUnits = 35_000` for this cluster

---

### OV-33: Validator Removal with Explicit EB — Full Cluster Empty

**Modules Touched:** SSVValidators, SSVStorageEB
**Bug Class Covered:** EB deviation not cleaned up on last validator removal

#### Preconditions
- Cluster with 1 validator, explicit EB:
  - `ebSnapshot.vUnits = 15_000` (1 validator with 48 ETH → ceil(48*10_000/32) = 15_000)
  - Deviation per operator: `(15_000 - 1*10_000) / 4 = 1_250` each
  - `seb.operatorEthVUnits[1..4] = 1_250` each
  - `sp.daoTotalEthVUnits` includes this 5_000 deviation

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `removeValidator(pk, [1,2,3,4], cluster)` | 300 | Remove last validator, clean up EB |

#### Trace through SSVValidators.sol lines 211-240:
After `cluster.validatorCount -= 1` → `cluster.validatorCount = 0`

```solidity
if (ebSnapshot.vUnits > 0) {
    uint64 deltaClusterVUnits = uint64(1) * VUNITS_PRECISION; // = 10_000
    ebSnapshot.vUnits -= deltaClusterVUnits; // = 15_000 - 10_000 = 5_000

    if (cluster.validatorCount == 0) { // true
        uint64 remainingVUnits = ebSnapshot.vUnits; // = 5_000
        if (remainingVUnits > 0) { // true
            for each operator:
                seb.operatorEthVUnits[operatorIds[i]] -= 5_000; // wait, -= remainingVUnits
            // But remainingVUnits = 5_000 and each operator has 1_250
            // 1_250 - 5_000 would underflow!
        }
    }
}
```

**ANALYSIS (Verified against SSVClusters.sol `_updateOperatorVUnits`):**

The `_updateOperatorVUnits` function at `SSVClusters.sol:496-515` adds the FULL deviation delta to EACH operator, NOT divided by operator count:
```solidity
uint64 deltaAbs = deltaPositive ? newVUnits - storedVUnits : storedVUnits - newVUnits;
seb.operatorEthVUnits[operatorId] += deltaAbs; // full delta per operator
```

So each operator stores the FULL cluster deviation (5_000 in this example), not `5_000/4 = 1_250`.

When the last validator is removed:
- `remainingVUnits = 5_000` (ebSnapshot.vUnits after baseline subtraction)
- Each operator has `operatorEthVUnits = 5_000`
- Subtract: `5_000 - 5_000 = 0` → no underflow

**CONCLUSION: NOT A BUG.** The deviation-per-operator model stores the full cluster deviation per operator, and the cleanup correctly subtracts the full deviation. This is consistent across:
- `_updateOperatorVUnits` (adds full delta to each operator)
- `_executeLiquidation` (subtracts full deviation from each operator)
- `_bulkRemoveValidator` cleanup (subtracts remaining vUnits from each operator)

**Key invariant for multi-cluster operators:** If operator serves clusters A (deviation 3_000) and B (deviation 5_000), then `operatorEthVUnits = 8_000`. Removing all validators from cluster A subtracts 3_000, leaving 5_000. Correct.

#### Assertions
- [ ] `seb.operatorEthVUnits[1..4] == 5_000` each (full deviation per operator, NOT divided)
- [ ] After cleanup: `seb.operatorEthVUnits[1..4] == 0` (5_000 - 5_000)
- [ ] `ebSnapshot.vUnits == 0` (zeroed after cleanup)
- [ ] `sp.daoTotalEthVUnits` decreased by `remainingVUnits` (5_000)

---

### OV-34: Bulk Remove Validators — Multiple Removals in One Transaction

**Modules Touched:** SSVValidators
**Bug Class Covered:** Multiple validator count decrements, fee settlement computed once

#### Preconditions
- Cluster with 5 validators on operators [1,2,3,4]
- Block 200, 100 blocks of fees accrued

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `bulkRemoveValidator([pk1,pk2,pk3], [1,2,3,4], cluster)` | 300 | Remove 3 validators at once |

#### Trace:
- `validatorsRemoved = 3`
- `updateClusterOperators([1,2,3,4], false, 3, s, sp)`:
  - Each operator: `ethValidatorCount -= 3` (from 5 to 2)
  - Snapshot settled at 5-validator rate for 100 blocks
- `cluster.updateClusterData`:
  - Settles fees using vUnits from 5 validators (50_000) for 100 blocks
- `sp.updateDAO(false, 3)`:
  - `ethDaoValidatorCount -= 3`
  - `daoTotalEthVUnits -= 30_000`
- `cluster.validatorCount -= 3` → `cluster.validatorCount = 2`

#### Assertions
- [ ] `cluster.validatorCount == 2`
- [ ] Each `operator[1..4].ethValidatorCount == 2`
- [ ] Fees settled at 5-validator rate for 100 blocks (before the removal, all 5 were active)
- [ ] 3 `ValidatorRemoved` events emitted
- [ ] `sp.ethDaoValidatorCount` decreased by 3
- [ ] All 3 validators deleted from `validatorPKs`

---

### OV-35: Deposit and Withdraw — Verify No Side Effects on Operator State

**Modules Touched:** SSVClusters, OperatorLib
**Bug Class Covered:** Deposit/withdraw accidentally modifying operator counts or fees

#### Preconditions
- Cluster with 2 validators, balance = 10 ETH
- Operators [1,2,3,4], each `ethValidatorCount = 2`

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `deposit{value: 5 ETH}(owner, [1,2,3,4], cluster)` | 250 | Balance increases, no count changes |
| 2 | `withdraw([1,2,3,4], 3 ETH, cluster)` | 260 | Balance decreases, no count changes |

#### Assertions
- [ ] After step 1: `cluster.balance == settledBalance + 5 ETH`
- [ ] After step 1: each `operator.ethValidatorCount == 2` (unchanged)
- [ ] After step 2: `cluster.balance == settledBalance - 3 ETH`
- [ ] After step 2: each `operator.ethValidatorCount == 2` (unchanged)
- [ ] Operator snapshots updated (earnings settled) but validator counts unchanged
- [ ] `sp.ethDaoValidatorCount` unchanged after both operations

---

## Summary of Critical Findings

### High Priority (Potential Bugs)

1. **DISC-OV-3**: `removeOperator` has NO check that `validatorCount == 0 && ethValidatorCount == 0`. An operator with active validators can be removed, breaking `ethDaoValidatorCount` invariant.

2. **OV-33**: Validator removal with explicit EB — verified NOT a bug. Each operator stores full cluster deviation (not divided by operator count), and cleanup correctly subtracts full deviation from each.

3. **DISC-OV-4** (Note): `removeOperator` does NOT delete `operatorFeeChangeRequests`. Documented in FLOWS.md but not in code. Low impact since removed operator can't execute.

### Medium Priority (Documentation Discrepancies)

4. **DISC-OV-1**: `OperatorPrivacyStatusUpdated` always emitted, FLOWS.md says conditional.
5. **DISC-OV-2**: Fee validation rule for 0-fee operators differs from FLOWS.md description.
6. **DISC-OV-5**: `declareOperatorFee` calls `ensureETHDefaults` but this isn't in FLOWS.md.
7. **DISC-OV-4**: Indices preserved after removal, FLOWS.md implies all snapshot fields zeroed.

### Key Invariants to Monitor

- `ethDaoValidatorCount == Σ(operator.ethValidatorCount)` — broken if DISC-OV-3 is exploited
- `daoTotalEthVUnits` tracks correctly across EB updates + validator add/remove
- Cluster balance == initial + deposits - withdrawals - fees (conservation)
- Operator earnings == Σ(blockDiff × fee × effectiveVUnits / VUNITS_PRECISION) across all intervals
