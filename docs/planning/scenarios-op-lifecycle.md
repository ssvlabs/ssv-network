# Operator Lifecycle — Exhaustive Test Scenarios (OP-001 to OP-040)

## Summary

40 scenarios covering the full operator lifecycle: registration, removal, privacy toggling, and edge interactions between these operations. Grounded in `SSVOperators.sol`, `OperatorLib.sol`, SPEC.md, and FLOWS.md.

### Key Code-Grounding Facts

1. **`_resetOperatorState` zeroes:** `ethSnapshot.block`, `ethSnapshot.balance`, `ethFee`, `snapshot.block`, `snapshot.balance`, `fee`, `ethValidatorCount`, `validatorCount`
2. **`_resetOperatorState` preserves:** `owner`, `whitelisted`, `ethSnapshot.index`, `snapshot.index`
3. **`removeOperator` additionally deletes:** `operatorEthVUnits[id]`, `operatorFeeChangeRequests[id]`, `operatorsWhitelist[id]`
4. **`removeOperator` does NOT delete:** `operatorsPKs[hash(pubkey)]` — the pubkey-to-ID mapping is never cleared
5. **Re-registration with same pubkey reverts** with `OperatorAlreadyExists` because `operatorsPKs` is NOT cleared on removal
6. **Fee packing:** fees must be divisible by `ETH_DEDUCTED_DIGITS` (100,000). Non-divisible fees revert with `MaxPrecisionExceeded`
7. **Fee range:** fee must be 0 OR within `[minimumOperatorEthFee, operatorMaxFee]`. Below minimum → `FeeTooLow`. Above maximum → `FeeTooHigh`
8. **32 ETH per validator** is the enforced floor (`DEFAULT_EB_PER_VALIDATOR = 32 ether`)
9. **Operator existence check (`checkOwner`):** `snapshot.block == 0 && ethSnapshot.block == 0` → reverts `OperatorDoesNotExist`

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| OP-001 | registerOperator | Register with zero fee (free operator), verify ethFee stored as 0, public by default | `entry:registerOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:31-66 |
| OP-002 | registerOperator | Register with minimumOperatorEthFee (exact boundary), verify packed fee stored correctly | `entry:registerOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:38-39, SSVCoreTypes.sol:19 |
| OP-003 | registerOperator | Register with operatorMaxFee (exact upper boundary), verify packed fee stored correctly | `entry:registerOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:41-43 |
| OP-004 | registerOperator | Register with fee = minimumOperatorEthFee - 100000 (one precision unit below min), expect FeeTooLow | `entry:registerOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:yes` | [ ] | SSVOperators.sol:38-39 |
| OP-005 | registerOperator | Register with fee = operatorMaxFee + 100000 (one precision unit above max), expect FeeTooHigh | `entry:registerOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:yes` | [ ] | SSVOperators.sol:41-43 |
| OP-006 | registerOperator | Register with fee not divisible by ETH_DEDUCTED_DIGITS (100000), expect MaxPrecisionExceeded from PackedETHLib.pack | `entry:registerOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:yes` | [ ] | SSVPackedLib.sol:11, SSVCoreTypes.sol:19 |
| OP-007 | registerOperator | Register with fee at precision boundary (exactly 100000 = one packing unit), verify stores correctly | `entry:registerOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:no` | [ ] | SSVPackedLib.sol:9-13 |
| OP-008 | registerOperator | Register with fee exceeding uint64 max after packing (fee > type(uint64).max * 100000), expect MaxValueExceeded | `entry:registerOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:yes` | [ ] | SSVPackedLib.sol:10 |
| OP-009 | registerOperator | Register public (setPrivate=false), verify whitelisted=false and both events emitted | `entry:registerOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:55, 64-65 |
| OP-010 | registerOperator | Register private (setPrivate=true), verify whitelisted=true and OperatorPrivacyStatusUpdated(true) emitted | `entry:registerOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:55, 65 |
| OP-011 | registerOperator | Register duplicate pubkey (same pubkey already registered by another operator), expect OperatorAlreadyExists | `entry:registerOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:yes` | [ ] | SSVOperators.sol:47-48 |
| OP-012 | registerOperator | Register first operator ever (ID=1), verify lastOperatorId increments from 0 to 1 and operator ID is 1 | `entry:registerOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:50-51 |
| OP-013 | registerOperator | Register multiple operators sequentially, verify IDs are monotonically incrementing (1, 2, 3) | `entry:registerOperator; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:50-51 |
| OP-014 | registerOperator → removeOperator | Register then immediately remove (same block), verify removal succeeds and earnings are zero | `entry:registerOperator,removeOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:31-66, 71-104 |
| OP-015 | removeOperator | Remove operator with no validators (ethValidatorCount=0, validatorCount=0), verify clean removal | `entry:removeOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:71-104 |
| OP-016 | removeOperator | Remove operator with active ETH validators (ethValidatorCount > 0), verify ethValidatorCount zeroed but validators still registered in clusters | `entry:removeOperator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:91, 347-358 |
| OP-017 | removeOperator | Remove operator with active SSV validators (validatorCount > 0, legacy), verify validatorCount zeroed | `entry:removeOperator; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:80-84, 347-358 |
| OP-018 | removeOperator | Remove operator with both ETH and SSV validators, verify both counters zeroed and both earnings withdrawn | `entry:removeOperator; version:both; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:78-103 |
| OP-019 | removeOperator | Remove operator with pending fee change request, verify operatorFeeChangeRequests[id] deleted | `entry:removeOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:94 |
| OP-020 | removeOperator | Remove operator with legacy whitelist (operatorsWhitelist[id] set), verify operatorsWhitelist[id] deleted | `entry:removeOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:95 |
| OP-021 | removeOperator | Remove operator with explicit EB (operatorEthVUnits[id] > 0), verify operatorEthVUnits[id] deleted | `entry:removeOperator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:93 |
| OP-022 | removeOperator | Verify _resetOperatorState fields: ethSnapshot.block=0, ethSnapshot.balance=0, ethFee=0, snapshot.block=0, snapshot.balance=0, fee=0, ethValidatorCount=0, validatorCount=0 | `entry:removeOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:347-358 |
| OP-023 | removeOperator | Verify NOT cleared by removal: owner preserved (non-zero), whitelisted flag preserved, ethSnapshot.index preserved, snapshot.index preserved, operatorsPKs NOT cleared | `entry:removeOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:347-358, 47-48 |
| OP-024 | removeOperator | Verify ETH earnings payout on removal: accumulated ethSnapshot.balance transferred to owner via _transferOperatorBalanceUnsafe | `entry:removeOperator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:97-99 |
| OP-025 | removeOperator | Verify SSV earnings payout on removal: accumulated snapshot.balance transferred to owner via _transferOperatorTokenBalanceUnsafe | `entry:removeOperator; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:100-102 |
| OP-026 | removeOperator → registerOperator | Remove then re-register same pubkey, expect OperatorAlreadyExists because operatorsPKs NOT cleared | `entry:removeOperator,registerOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:real; revert:yes` | [ ] | SSVOperators.sol:47-48, 93 |
| OP-027 | removeOperator | Remove non-existent operator (ID never registered), expect OperatorDoesNotExist from checkOwner | `entry:removeOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:111-116 |
| OP-028 | removeOperator | Remove already-removed operator (remove twice), expect OperatorDoesNotExist because snapshot.block=0 && ethSnapshot.block=0 | `entry:removeOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:real; revert:yes` | [ ] | OperatorLib.sol:112-113 |
| OP-029 | removeOperator | Remove operator by non-owner (different msg.sender), expect CallerNotOwnerWithData | `entry:removeOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:115 |
| OP-030 | setOperatorsPrivateUnchecked | Set single public operator to private, verify whitelisted=true and OperatorPrivacyStatusUpdated(true) emitted | `entry:setOperatorsPrivateUnchecked; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:219-222, OperatorLib.sol:518-529 |
| OP-031 | setOperatorsPublicUnchecked | Set single private operator to public, verify whitelisted=false and OperatorPrivacyStatusUpdated(false) emitted | `entry:setOperatorsPublicUnchecked; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:227-230, OperatorLib.sol:518-529 |
| OP-032 | setOperatorsPrivateUnchecked → setOperatorsPublicUnchecked | Toggle private→public→private rapidly (same block), verify final state is private | `entry:setOperatorsPrivateUnchecked,setOperatorsPublicUnchecked; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:518-529 |
| OP-033 | setOperatorsPrivateUnchecked | Set privacy on batch of operators (multiple IDs), verify all toggled and single event emitted with full array | `entry:setOperatorsPrivateUnchecked; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:219-222 |
| OP-034 | setOperatorsPrivateUnchecked | Set private on operator with active ETH cluster, verify whitelisted=true and existing cluster unaffected (no whitelist check on active clusters) | `entry:setOperatorsPrivateUnchecked; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:518-529 |
| OP-035 | setOperatorsPublicUnchecked | Set public on removed operator, expect OperatorDoesNotExist from checkOwner inside updatePrivacyStatus | `entry:setOperatorsPublicUnchecked; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:real; revert:yes` | [ ] | OperatorLib.sol:525, 111-116 |
| OP-036 | setOperatorsPrivateUnchecked | Set private by non-owner, expect CallerNotOwnerWithData | `entry:setOperatorsPrivateUnchecked; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:525, 115 |
| OP-037 | setOperatorsPrivateUnchecked | Set private with empty operatorIds array, expect InvalidOperatorIdsLength from checkOperatorsLength | `entry:setOperatorsPrivateUnchecked; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:555-558 |
| OP-038 | removeOperator | Remove operator with accrued earnings but ethSnapshot.block=0 (SSV-only legacy operator that never had ETH interaction), verify only SSV branch executes, no ETH transfer | `entry:removeOperator; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:81-84, 86-89, 97-102 |
| OP-039 | removeOperator | Remove operator serving in a liquidated ETH cluster, verify removal succeeds and ethValidatorCount reset (cluster remains liquidated, operator block=0 causes skip on future cluster ops) | `entry:removeOperator; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:71-104, OperatorLib.sol:246-261 |
| OP-040 | registerOperator → removeOperator → registerOperator | Register with pubkey A, remove, register with different pubkey B (same owner), verify new operator gets next ID and pubkey B mapping stored | `entry:registerOperator,removeOperator; version:eth; eb:implicit; cluster:none; ops:1; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:47-51 |

---

## Detailed Scenarios (10 Most Complex)

---

### OP-006: Register with non-divisible fee (revert)

**Purpose:** Verify that fees not divisible by `ETH_DEDUCTED_DIGITS` (100,000) are rejected at the packing layer, preventing precision loss in stored fee values.

#### Preconditions

| # | Condition |
|---|-----------|
| 1 | No operators registered (fresh state) |
| 2 | `minimumOperatorEthFee` = 1,065,200,000 (default) |
| 3 | `operatorMaxFee` = 5,326,300,000 (default) |

#### Action Sequence

| Step | Action | Caller | Parameters | Expected |
|------|--------|--------|------------|----------|
| 1 | `registerOperator` | Account A | pubkey: valid 48-byte key, fee: 1,065,200,001 (min + 1 wei), setPrivate: false | Revert `MaxPrecisionExceeded` |
| 2 | `registerOperator` | Account A | pubkey: valid 48-byte key, fee: 1,065,250,000 (divisible by 50000 but not 100000), setPrivate: false | Revert `MaxPrecisionExceeded` |
| 3 | `registerOperator` | Account A | pubkey: valid 48-byte key, fee: 99,999 (below packing unit), setPrivate: false | Revert `MaxPrecisionExceeded` |
| 4 | `registerOperator` | Account A | pubkey: valid 48-byte key, fee: 1,065,200,000 (min, divisible), setPrivate: false | Success, ID=1 |

#### Assertions Checklist

- [ ] Steps 1-3 all revert with `MaxPrecisionExceeded` (error from `PackingLib._pack`)
- [ ] Step 4 succeeds, operator stored with `ethFee = PackedETH.wrap(1065200000 / 100000) = PackedETH.wrap(10652)`
- [ ] No `OperatorAdded` event emitted for steps 1-3
- [ ] `lastOperatorId` unchanged after reverts (still 0), becomes 1 after step 4

#### Edge Variations

- Fee = 0 is always valid (zero-fee operator), no packing precision issue since `0 % 100000 == 0`
- Fee = 100,000 is the smallest non-zero fee that passes packing, but will revert `FeeTooLow` if below `minimumOperatorEthFee`

---

### OP-014: Register then immediately remove (same block)

**Purpose:** Verify that an operator registered and removed in the same block produces zero earnings, clean state reset, and that the pubkey becomes permanently locked.

#### Preconditions

| # | Condition |
|---|-----------|
| 1 | No operators registered (fresh state) |
| 2 | Valid 48-byte pubkey prepared |
| 3 | Fee = 2,000,000,000 (within valid range, divisible by 100,000) |

#### Action Sequence

| Step | Action | Caller | Parameters | Expected |
|------|--------|--------|------------|----------|
| 1 | `registerOperator` | Account A | pubkey: PK1, fee: 2,000,000,000, setPrivate: false | Success, ID=1, ethSnapshot.block = block.number |
| 2 | `removeOperator` | Account A | operatorId: 1 | Success, OperatorRemoved(1) emitted. No OperatorWithdrawn/OperatorWithdrawnSSV (zero balance) |

#### Assertions Checklist

- [ ] After step 1: `operators[1].owner == Account A`, `ethFee == packed(2000000000)`, `ethSnapshot.block == block.number`
- [ ] After step 2: `operators[1].ethSnapshot.block == 0` (zeroed by _resetOperatorState)
- [ ] After step 2: `operators[1].ethSnapshot.balance == 0` (no blocks elapsed, no earnings)
- [ ] After step 2: `operators[1].ethFee == 0`
- [ ] After step 2: `operators[1].owner == Account A` (preserved)
- [ ] After step 2: `operators[1].ethSnapshot.index == 0` (preserved but was 0 since same block)
- [ ] After step 2: `operatorsPKs[keccak256(PK1)] == 1` (NOT cleared)
- [ ] After step 2: `operatorEthVUnits[1] == 0` (deleted)
- [ ] After step 2: `operatorFeeChangeRequests[1]` is zeroed (deleted, was never set)
- [ ] No ETH transfer occurred (currentBalanceETH == 0 because blockDiff = 0)
- [ ] No SSV transfer occurred (snapshot.block was 0, SSV branch skipped entirely)

#### Edge Variations

- Same test with `setPrivate: true` — verify `whitelisted` is preserved after removal (true remains)
- Same test with fee = 0 — verify zero-fee operator removal also produces no earnings

---

### OP-016: Remove operator with active ETH validators

**Purpose:** Verify that removing an operator with active validators zeroes the operator's validator count, settles all accrued ETH earnings, and that the removed operator is correctly skipped in subsequent cluster operations.

#### Preconditions

| # | Condition |
|---|-----------|
| 1 | 4 operators registered (IDs 1-4) with valid fees |
| 2 | Cluster created with operators [1,2,3,4], 1 ETH validator registered |
| 3 | Multiple blocks advanced to accumulate operator earnings |
| 4 | Operator 1 has `ethValidatorCount == 1`, `ethSnapshot.balance > 0` |

#### Action Sequence

| Step | Action | Caller | Parameters | Expected |
|------|--------|--------|------------|----------|
| 1 | Verify pre-state | — | — | `operators[1].ethValidatorCount == 1`, `ethSnapshot.block > 0`, `ethSnapshot.balance > 0` |
| 2 | `removeOperator` | Operator 1 owner | operatorId: 1 | Success. OperatorWithdrawn emitted with settled ETH earnings. OperatorRemoved(1) emitted |
| 3 | Verify operator state | — | — | All _resetOperatorState fields zeroed. `ethSnapshot.index` preserved (non-zero). `owner` preserved |
| 4 | `removeValidator` | Cluster owner | pubkey, operatorIds: [1,2,3,4] | Success. Operator 1 skipped (ethSnapshot.block == 0). Operators 2,3,4 updated normally |

#### Assertions Checklist

- [ ] Before removal: `operators[1].ethValidatorCount == 1`
- [ ] After removal: `operators[1].ethValidatorCount == 0` (zeroed by _resetOperatorState)
- [ ] After removal: `operators[1].ethSnapshot.block == 0`
- [ ] After removal: ETH transferred to operator 1 owner == pre-removal `ethSnapshot.balance` (settled)
- [ ] After removal: `operators[1].ethSnapshot.index` preserved (non-zero, used by cluster index calc)
- [ ] Subsequent cluster ops: operator 1 skipped because `ethSnapshot.block == 0` (see `updateClusterOperators` line 247)
- [ ] Subsequent cluster ops: `cumulativeIndex` still includes operator 1's preserved `ethSnapshot.index`
- [ ] Cluster continues to operate with 3 of 4 operators contributing fees

#### Edge Variations

- Remove operator with `ethValidatorCount > 1` (multiple validators across clusters)
- Remove operator from cluster that has explicit EB updates (operatorEthVUnits > 0 before removal)

---

### OP-021: Remove operator with explicit EB (operatorEthVUnits deleted)

**Purpose:** Verify that `operatorEthVUnits[operatorId]` is deleted on removal, ensuring EB deviation tracking is cleaned up. Confirm that the final earnings settlement uses the correct effectiveVUnits before deletion.

#### Preconditions

| # | Condition |
|---|-----------|
| 1 | 4 operators registered (IDs 1-4) |
| 2 | Cluster created with operators [1,2,3,4], validator registered |
| 3 | Oracle has submitted EB update via `updateClusterBalance` with effectiveBalance > 32 ETH (e.g., 34 ETH) |
| 4 | `operatorEthVUnits[1]` is non-zero (deviation from baseline stored) |
| 5 | Multiple blocks advanced to accumulate EB-weighted earnings |

#### Action Sequence

| Step | Action | Caller | Parameters | Expected |
|------|--------|--------|------------|----------|
| 1 | Verify pre-state | — | — | `operatorEthVUnits[1] > 0` (EB deviation stored) |
| 2 | `removeOperator` | Operator 1 owner | operatorId: 1 | Success. `updateSnapshotSt` called first (uses effectiveVUnits including deviation). Then _resetOperatorState. Then `delete operatorEthVUnits[1]` |
| 3 | Verify earnings | — | — | ETH transferred includes EB-weighted earnings (higher than baseline-only earnings would be) |
| 4 | Verify cleanup | — | — | `operatorEthVUnits[1] == 0` (deleted) |

#### Assertions Checklist

- [ ] Before removal: `operatorEthVUnits[1] != 0`
- [ ] `updateSnapshotSt` is called BEFORE `_resetOperatorState` — earnings include EB deviation
- [ ] Earnings formula used: `effectiveVUnits = storedDeviation + ethValidatorCount * BPS_DENOMINATOR`
- [ ] After removal: `operatorEthVUnits[1] == 0` (explicitly deleted at SSVOperators.sol:93)
- [ ] After removal: `operators[1].ethValidatorCount == 0` (baseline component also zeroed)
- [ ] `daoTotalEthVUnits` is NOT decremented by `removeOperator` — deviation cleanup from DAO is not performed here (handled separately by cluster operations)

#### Edge Variations

- Operator with deviation but `ethValidatorCount == 0` (all validators removed before operator removal, but deviation persists from prior EB updates)
- Multiple operators sharing the same cluster EB deviation — removing one doesn't affect others' `operatorEthVUnits`

---

### OP-023: Verify fields NOT cleared by removal

**Purpose:** Exhaustively verify that `owner`, `whitelisted`, `ethSnapshot.index`, `snapshot.index`, and `operatorsPKs[hash]` survive operator removal. These preserved fields are critical for cluster index continuity and off-chain queryability.

#### Preconditions

| # | Condition |
|---|-----------|
| 1 | Operator registered (ID=1) by Account A, setPrivate=true, fee=2,000,000,000 |
| 2 | Cluster created with this operator + 3 others, validator registered |
| 3 | Legacy SSV cluster also exists using this operator (both SSV and ETH snapshots active) |
| 4 | Multiple blocks advanced so both `ethSnapshot.index > 0` and `snapshot.index > 0` |
| 5 | `operatorsPKs[keccak256(pubkey)] == 1` |

#### Action Sequence

| Step | Action | Caller | Parameters | Expected |
|------|--------|--------|------------|----------|
| 1 | Record pre-removal values | — | — | `owner`, `whitelisted`, `ethSnapshot.index`, `snapshot.index`, `operatorsPKs[hash]` |
| 2 | `removeOperator` | Account A | operatorId: 1 | Success |
| 3 | Verify preserved fields | — | — | All 5 fields match pre-removal values |
| 4 | `getOperatorById(1)` | Anyone | — | Returns `owner = Account A`, `isActive = false` |
| 5 | `registerOperator` | Account A | same pubkey | Revert `OperatorAlreadyExists` |

#### Assertions Checklist

- [ ] `operators[1].owner == Account A` (preserved, non-zero)
- [ ] `operators[1].whitelisted == true` (preserved from registration with setPrivate=true)
- [ ] `operators[1].ethSnapshot.index > 0` (preserved — NOT zeroed by _resetOperatorState)
- [ ] `operators[1].snapshot.index > 0` (preserved — NOT zeroed by _resetOperatorState)
- [ ] `operatorsPKs[keccak256(pubkey)] == 1` (preserved — NOT deleted by removeOperator)
- [ ] `getOperatorById` view returns preserved owner but `isActive = false` (ethSnapshot.block == 0)
- [ ] Re-registration with same pubkey reverts because `operatorsPKs` mapping still points to operator ID 1
- [ ] Cluster operations using operator 1 still read `ethSnapshot.index` for cumulative index (OperatorLib.sol:260)

#### Edge Variations

- Operator registered public (whitelisted=false) — verify `whitelisted` preserved as false after removal
- Operator with `snapshot.index > 0` but `ethSnapshot.index == 0` (SSV-only legacy, never had ETH validators)

---

### OP-026: Remove then re-register same pubkey (revert)

**Purpose:** Confirm that operator public key uniqueness is permanently enforced because `removeOperator` does NOT delete `operatorsPKs[keccak256(pubkey)]`. This is a critical invariant — the same physical operator node cannot be re-registered under a different operator ID.

#### Preconditions

| # | Condition |
|---|-----------|
| 1 | Operator registered with pubkey PK1, assigned ID=1 |
| 2 | Operator subsequently removed |
| 3 | `operators[1].owner` is preserved, `operators[1].ethSnapshot.block == 0` |

#### Action Sequence

| Step | Action | Caller | Parameters | Expected |
|------|--------|--------|------------|----------|
| 1 | `registerOperator` | Account A | pubkey: PK1, fee: valid, setPrivate: false | Success, ID=1 |
| 2 | `removeOperator` | Account A | operatorId: 1 | Success |
| 3 | Verify `operatorsPKs` | — | `keccak256(PK1)` | Value == 1 (NOT cleared) |
| 4 | `registerOperator` | Account A | pubkey: PK1 (same), fee: valid, setPrivate: false | Revert `OperatorAlreadyExists` |
| 5 | `registerOperator` | Account B | pubkey: PK1 (same), fee: valid, setPrivate: false | Revert `OperatorAlreadyExists` (different caller, same pubkey) |
| 6 | `registerOperator` | Account A | pubkey: PK2 (different), fee: valid, setPrivate: false | Success, ID=2 |

#### Assertions Checklist

- [ ] Step 4 reverts with `OperatorAlreadyExists` — same owner, same pubkey
- [ ] Step 5 reverts with `OperatorAlreadyExists` — different owner, same pubkey
- [ ] `operatorsPKs[keccak256(PK1)]` remains 1 throughout (never cleared)
- [ ] Step 6 succeeds — different pubkey is fine, gets ID=2
- [ ] `lastOperatorId == 2` after step 6 (incremented for successful registrations only)
- [ ] NOTE: FLOWS.md §4.2 postcondition says "Public key can be re-registered" — this is inconsistent with the actual code. The CODE is the source of truth: `operatorsPKs` is NOT deleted, so re-registration reverts

#### Edge Variations

- Remove operator, register with different pubkey (PK2), then try PK1 again — still reverts
- Register operator, don't remove, try same pubkey — same revert (tests both removed and active cases)

---

### OP-019: Remove operator with pending fee change request

**Purpose:** Verify that `operatorFeeChangeRequests[operatorId]` is deleted on removal, ensuring that no stale fee declaration can be executed after re-creation of the operator slot (which is impossible due to pubkey lock, but the cleanup is still critical for storage hygiene).

#### Preconditions

| # | Condition |
|---|-----------|
| 1 | Operator registered (ID=1) with fee F1 |
| 2 | `declareOperatorFee(1, F2)` called, pending request stored with approvalBeginTime and approvalEndTime |
| 3 | Time has NOT reached approvalBeginTime yet (declaration still in waiting period) |

#### Action Sequence

| Step | Action | Caller | Parameters | Expected |
|------|--------|--------|------------|----------|
| 1 | Verify pending request | — | `operatorFeeChangeRequests[1]` | `approvalBeginTime > 0`, `fee == packed(F2)` |
| 2 | `removeOperator` | Operator owner | operatorId: 1 | Success. OperatorRemoved(1) emitted |
| 3 | Verify request deleted | — | `operatorFeeChangeRequests[1]` | All fields zero (approvalBeginTime=0, approvalEndTime=0, fee=0) |

#### Assertions Checklist

- [ ] Before removal: `operatorFeeChangeRequests[1].approvalBeginTime > 0`
- [ ] After removal: `operatorFeeChangeRequests[1].approvalBeginTime == 0` (struct deleted)
- [ ] After removal: `operatorFeeChangeRequests[1].fee == 0`
- [ ] `delete s.operatorFeeChangeRequests[operatorId]` at SSVOperators.sol:94 is the cleanup point
- [ ] `executeOperatorFee(1)` after removal reverts with `OperatorDoesNotExist` (from checkOwner, not NoFeeDeclared) because snapshot blocks are zeroed

#### Edge Variations

- Pending request in executable window (between approvalBeginTime and approvalEndTime) at time of removal
- Pending request already expired (past approvalEndTime) at time of removal — still cleaned up

---

### OP-034: Set private on operator with active ETH cluster

**Purpose:** Verify that toggling an operator to private while it has active clusters does NOT retroactively affect existing clusters. New validator registrations to that cluster will require whitelist checks, but existing validators are unaffected.

#### Preconditions

| # | Condition |
|---|-----------|
| 1 | 4 operators registered (IDs 1-4), all public (whitelisted=false) |
| 2 | Cluster created with operators [1,2,3,4] by Account X, 1 validator registered |
| 3 | Cluster is active and not liquidated |
| 4 | Operator 1 has `ethValidatorCount == 1` |

#### Action Sequence

| Step | Action | Caller | Parameters | Expected |
|------|--------|--------|------------|----------|
| 1 | `setOperatorsPrivateUnchecked` | Operator 1 owner | operatorIds: [1] | Success. `operators[1].whitelisted = true`. Event emitted |
| 2 | `removeValidator` | Account X | pubkey, operatorIds: [1,2,3,4] | Success — privacy check NOT performed on remove |
| 3 | `registerValidator` | Account X (not whitelisted) | new pubkey, operatorIds: [1,2,3,4] | Revert `CallerNotWhitelistedWithData(1)` — operator 1 now private, Account X not whitelisted |
| 4 | Whitelist Account X for operator 1 | Operator 1 owner | via `setOperatorsWhitelists` | Success |
| 5 | `registerValidator` | Account X | new pubkey, operatorIds: [1,2,3,4] | Success — Account X now whitelisted |

#### Assertions Checklist

- [ ] `operators[1].whitelisted == true` after step 1
- [ ] Existing cluster operations (remove, exit, liquidate, deposit, withdraw) are NOT affected by privacy toggle
- [ ] Only `registerValidator` and `bulkRegisterValidator` perform whitelist checks (in `updateClusterOperatorsOnRegistration`)
- [ ] Event `OperatorPrivacyStatusUpdated([1], true)` emitted in step 1
- [ ] After whitelisting, registration succeeds normally

#### Edge Variations

- Toggle privacy on multiple operators in the same cluster simultaneously
- Toggle private → public while a validator registration is pending in the same transaction (unlikely but tests ordering)
- Private operator in a liquidated cluster — reactivation does NOT check whitelist (uses `updateClusterOperatorsOnReactivation`)

---

### OP-039: Remove operator serving in liquidated ETH cluster

**Purpose:** Verify that removing an operator from a liquidated cluster succeeds, settles earnings correctly, and that the cluster remains functional (liquidated state preserved). Subsequent cluster operations correctly skip the removed operator.

#### Preconditions

| # | Condition |
|---|-----------|
| 1 | 4 operators registered (IDs 1-4) |
| 2 | ETH cluster created with operators [1,2,3,4], validator registered |
| 3 | Cluster liquidated (cluster.active = false, cluster.validatorCount unchanged) |
| 4 | Operator 1 has `ethValidatorCount > 0` (validator count NOT decremented at liquidation for ETH) |
| 5 | Multiple blocks advanced after liquidation — operator 1 has accrued earnings at fee rate * ethValidatorCount |

#### Action Sequence

| Step | Action | Caller | Parameters | Expected |
|------|--------|--------|------------|----------|
| 1 | Verify pre-state | — | — | `operators[1].ethValidatorCount > 0`, `operators[1].ethSnapshot.block > 0` |
| 2 | `removeOperator` | Operator 1 owner | operatorId: 1 | Success. ETH earnings settled and transferred. `_resetOperatorState` zeros all fields. `operatorEthVUnits[1]` deleted |
| 3 | Verify post-state | — | — | `operators[1].ethSnapshot.block == 0`, `ethValidatorCount == 0` |
| 4 | `reactivate` | Cluster owner | operatorIds: [1,2,3,4], msg.value: sufficient | Success. Operator 1 skipped (ethSnapshot.block == 0). Cluster reactivated with 3 active operators |
| 5 | `removeValidator` | Cluster owner | pubkey, operatorIds: [1,2,3,4] | Success. Operator 1 skipped. Cluster settles with 3 operators |

#### Assertions Checklist

- [ ] Operator removal from liquidated cluster succeeds (no special restriction)
- [ ] Earnings settle correctly despite cluster being liquidated (operator snapshot is independent of cluster active state)
- [ ] After removal: `ethValidatorCount == 0` even though cluster still has validators assigned to this operator
- [ ] Reactivation skips removed operator (ethSnapshot.block == 0 check in `updateClusterOperatorsOnReactivation`)
- [ ] Removed operator's `ethSnapshot.index` is still included in cumulative index for cluster balance computation
- [ ] Cluster effectively operates with 3 of 4 operators post-removal

#### Edge Variations

- Remove all 4 operators from liquidated cluster — cluster becomes fully orphaned (no active operators)
- Remove operator, then liquidateSSV on the same cluster's SSV side
- Reactivate with removed operator, then try to register new validator — operator 1 will fail `ensureOperatorExist` check

---

### OP-018: Remove operator with both ETH and SSV validators

**Purpose:** Verify dual-version removal: both SSV and ETH snapshot branches execute, both earnings are settled and transferred, and both validator counters are zeroed. This tests the complete removal path for a legacy operator that has been partially migrated.

#### Preconditions

| # | Condition |
|---|-----------|
| 1 | 4 operators registered (IDs 1-4) — legacy SSV operators with SSV fee > 0 |
| 2 | SSV cluster created (pre-migration), 1 validator registered → `operators[1].validatorCount == 1`, `snapshot.block > 0` |
| 3 | ETH cluster created or migrated → `operators[1].ethValidatorCount == 1`, `ethSnapshot.block > 0` |
| 4 | Multiple blocks advanced — both `snapshot.balance > 0` (SSV earnings) and `ethSnapshot.balance > 0` (ETH earnings) |

#### Action Sequence

| Step | Action | Caller | Parameters | Expected |
|------|--------|--------|------------|----------|
| 1 | Record pre-removal balances | — | — | SSV balance B_ssv, ETH balance B_eth (both > 0) |
| 2 | `removeOperator` | Operator 1 owner | operatorId: 1 | Success. Both earnings settled |
| 3 | Verify SSV transfer | — | — | SSV tokens transferred: `OperatorWithdrawnSSV(owner, 1, B_ssv_settled)` |
| 4 | Verify ETH transfer | — | — | ETH transferred: `OperatorWithdrawn(owner, 1, B_eth_settled)` |
| 5 | Verify state | — | — | All _resetOperatorState fields zeroed. Both counters = 0 |

#### Assertions Checklist

- [ ] `snapshot.block != 0` triggers SSV branch: `updateSnapshotStSSV` → capture `snapshot.balance` → include in SSV transfer
- [ ] `ethSnapshot.block != 0` triggers ETH branch: `updateSnapshotSt` → capture `ethSnapshot.balance` → include in ETH transfer
- [ ] After removal: `validatorCount == 0` AND `ethValidatorCount == 0`
- [ ] After removal: `fee == 0` (SSV) AND `ethFee == 0` (ETH)
- [ ] After removal: `snapshot.block == 0` AND `ethSnapshot.block == 0`
- [ ] After removal: `snapshot.balance == 0` AND `ethSnapshot.balance == 0`
- [ ] Both `snapshot.index` and `ethSnapshot.index` preserved (non-zero)
- [ ] Two separate transfer events emitted (SSV token transfer + ETH native transfer)
- [ ] Order: SSV snapshot update first (line 82-83), ETH snapshot update second (line 86-88), _resetOperatorState, delete operatorEthVUnits, delete feeChangeRequests, delete whitelist, ETH transfer, SSV transfer
- [ ] `owner` preserved after removal

#### Edge Variations

- Operator with SSV earnings but zero ETH earnings (ethSnapshot.block > 0 but no ETH validators)
- Operator with ETH earnings but zero SSV earnings (snapshot.block > 0 but SSV fee was 0)
- Operator where one balance is exactly 0 after settlement — no transfer for that version

---

## Audit Gaps (Added post-audit)

> Identified by code-level branch analysis. These scenarios cover branches and edge conditions not addressed by the original OP-001 through OP-040 set.

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| OP-041 | registerOperator | Verify `snapshot.block` stays 0 after registration — only `ethSnapshot.block` is set. Ensures SSV snapshot is not accidentally initialized. | `entry:registerOperator; version:eth; revert:no` | [ ] | SSVOperators.sol:52-62 |
| OP-042 | setOperatorsPrivateUnchecked | Call with duplicate operator IDs in array (e.g., [3, 3, 5]). No validation exists for duplicates in this function — should be a no-op (second toggle is idempotent). Verify no revert and final state correct. | `entry:setOperatorsPrivateUnchecked; revert:no` | [ ] | SSVOperators.sol:219-222, OperatorLib.sol:518-529 |

---

## ask-codex Review Findings

### Corrections

- **OP-009** (~line 90): Description says `fee = 99,999` reverts `MaxPrecisionExceeded` — **WRONG**. It actually reverts `FeeTooLow` at SSVOperators.sol:38 because 99,999 < minimumOperatorEthFee (100,000). Fix the revert reason.
- **OP-005**: `registerOperator` packing overflow scenario is unreachable as written — the `FeeTooHigh` guard at SSVOperators.sol:41 fires first unless `operatorMaxFee` is raised. Scenario needs rework (see OP-043).
- **FLOWS.md line 644**: States removed operator's pubkey can be re-registered — **WRONG**. SSVOperators.sol:48 leaves `operatorsPKs` intact, so the pubkey cannot be reused.

### Additional Scenarios

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| OP-043 | registerOperator | Raise `operatorMaxFee` above default, then register with fee that passes `FeeTooHigh` but overflows `PackedETHLib.pack()` → revert `MaxValueExceeded`. Proves the packing overflow is reachable. | `entry:registerOperator; revert:yes` | [ ] | SSVOperators.sol:41, SSVPackedLib.sol:10 |
| OP-044 | removeOperator | Remove operator with SSV snapshot (block!=0) but zero settled SSV balance → no `OperatorWithdrawnSSV` event emitted, no SSV transfer. Proves the zero-balance/no-transfer branch. | `entry:removeOperator; version:ssv; revert:no` | [ ] | SSVOperators.sol:81, 100 |
