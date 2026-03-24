# Validator Registration Scenarios (VR-001 to VR-060)

Exhaustive test scenarios for `registerValidator` and `bulkRegisterValidator` flows.

**Source files:**
- `contracts/modules/SSVValidators.sol` — `registerValidator`, `bulkRegisterValidator`, `_bulkRegisterValidator`
- `contracts/libraries/OperatorLib.sol` — `updateClusterOperatorsOnRegistration`, `ensureETHDefaults`
- `contracts/libraries/ValidatorLib.sol` — `validateOperatorsLength`, `registerPublicKey`
- `contracts/libraries/ClusterLib.sol` — `validateClusterOnRegistration`, `updateClusterOnRegistration`, `isLiquidatableWithVUnits`

**Revert errors referenced:**
- `EmptyPublicKeysList()` — 0xdf83e679
- `PublicKeysSharesLengthMismatch()` — 0x9ad467b8
- `InvalidOperatorIdsLength()` — 0x38186224
- `InvalidPublicKeyLength()` — 0x637297a4
- `ValidatorAlreadyRegistered(pubkey, owner)` — 0x75106a26
- `UnsortedOperatorsList()` — 0xdd020e25
- `OperatorsListNotUnique()` — 0xa5a1ff5d
- `OperatorDoesNotExist()` — 0x961e3e8c
- `CallerNotWhitelistedWithData(operatorId)` — 0xb7f529fe
- `ExceedValidatorLimitWithData(operatorId)` — 0x639f5851
- `IncorrectClusterState()` — 0x12e04c87
- `IncorrectClusterVersion()` — 0xf6749746
- `ClusterIsLiquidated()` — 0x95a0cf33
- `InsufficientBalance()` — 0xf4d678b8

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| VR-001 | registerValidator | Register first validator in new ETH cluster with 4 operators, sufficient deposit | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol, ClusterLib.sol:validateClusterOnRegistration |
| VR-002 | registerValidator | Register first validator in new ETH cluster with 7 operators, sufficient deposit | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:7; remove_mode:none; revert:no` | [ ] | SSVValidators.sol, ClusterLib.sol:validateClusterOnRegistration |
| VR-003 | registerValidator | Register first validator in new ETH cluster with 10 operators, sufficient deposit | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:10; remove_mode:none; revert:no` | [ ] | SSVValidators.sol, ClusterLib.sol:validateClusterOnRegistration |
| VR-004 | registerValidator | Register first validator in new ETH cluster with 13 operators, sufficient deposit | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:13; remove_mode:none; revert:no` | [ ] | SSVValidators.sol, ClusterLib.sol:validateClusterOnRegistration |
| VR-005 | registerValidator | Register with exact minimum deposit (minimumLiquidationCollateral threshold) — 4 ops | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:isLiquidatableWithVUnits |
| VR-006 | registerValidator | Register with exact minimum deposit — burn-rate threshold dominates over minimumLiquidationCollateral | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:isLiquidatableWithVUnits |
| VR-007 | registerValidator | Register with deposit 1 wei below minimum — revert InsufficientBalance | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:updateClusterOnRegistration |
| VR-008 | registerValidator | Register with zero msg.value for ETH cluster — revert InsufficientBalance | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:updateClusterOnRegistration |
| VR-009 | registerValidator | Register with duplicate pubkey (same owner, same operators) — revert ValidatorAlreadyRegistered | `entry:registerValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | ValidatorLib.sol:registerPublicKey |
| VR-010 | registerValidator | Register with duplicate pubkey (same owner, different operators) — revert ValidatorAlreadyRegistered | `entry:registerValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | ValidatorLib.sol:registerPublicKey |
| VR-011 | registerValidator | Register with unsorted operator IDs [3,1,2,4] — revert UnsortedOperatorsList | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:updateClusterOperatorsOnRegistration |
| VR-012 | registerValidator | Register with duplicate operator IDs [1,2,2,4] — revert OperatorsListNotUnique | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:updateClusterOperatorsOnRegistration |
| VR-013 | registerValidator | Register with removed operator in list — revert OperatorDoesNotExist | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:real; revert:yes` | [ ] | OperatorLib.sol:ensureOperatorExist |
| VR-014 | registerValidator | Register with non-existent operator ID — revert OperatorDoesNotExist | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:ensureOperatorExist |
| VR-015 | registerValidator | Register with private operator — caller IS whitelisted via bitmap — success | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:updateClusterOperatorsOnRegistration |
| VR-016 | registerValidator | Register with private operator — caller NOT whitelisted — revert CallerNotWhitelistedWithData | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:updateClusterOperatorsOnRegistration |
| VR-017 | registerValidator | Register with private operator — caller whitelisted via legacy address — success | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:updateClusterOperatorsOnRegistration |
| VR-018 | registerValidator | Register with private operator — caller whitelisted via whitelisting contract — success | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:updateClusterOperatorsOnRegistration |
| VR-019 | registerValidator | Register with private operator — whitelisting contract returns false — revert CallerNotWhitelistedWithData | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:updateClusterOperatorsOnRegistration |
| VR-020 | registerValidator | Register with invalid operator count (3 operators) — revert InvalidOperatorIdsLength | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:parametric; remove_mode:none; revert:yes` | [ ] | ValidatorLib.sol:validateOperatorsLength |
| VR-021 | registerValidator | Register with invalid operator count (5 operators) — revert InvalidOperatorIdsLength | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:parametric; remove_mode:none; revert:yes` | [ ] | ValidatorLib.sol:validateOperatorsLength |
| VR-022 | registerValidator | Register with invalid operator count (14 operators) — revert InvalidOperatorIdsLength | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:parametric; remove_mode:none; revert:yes` | [ ] | ValidatorLib.sol:validateOperatorsLength |
| VR-023 | registerValidator | Register with invalid operator count (0 operators) — revert InvalidOperatorIdsLength | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:parametric; remove_mode:none; revert:yes` | [ ] | ValidatorLib.sol:validateOperatorsLength |
| VR-024 | registerValidator | Register with invalid public key length (47 bytes) — revert InvalidPublicKeyLength | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | ValidatorLib.sol:registerPublicKey |
| VR-025 | registerValidator | Register with invalid public key length (49 bytes) — revert InvalidPublicKeyLength | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | ValidatorLib.sol:registerPublicKey |
| VR-026 | registerValidator | Register with empty public key (0 bytes) — revert InvalidPublicKeyLength | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | ValidatorLib.sol:registerPublicKey |
| VR-027 | registerValidator | Register into existing active ETH cluster — balance updated correctly, validatorCount incremented | `entry:registerValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:updateClusterOnRegistration |
| VR-028 | registerValidator | Register into existing active ETH cluster with explicit EB — ebSnapshot.vUnits updated | `entry:registerValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:_bulkRegisterValidator (EB block) |
| VR-029 | registerValidator | Register at validatorsPerOperatorLimit (limit-1 existing, adding 1) — success | `entry:registerValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:updateClusterOperatorsOnRegistration |
| VR-030 | registerValidator | Register exceeding validatorsPerOperatorLimit — revert ExceedValidatorLimitWithData | `entry:registerValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:updateClusterOperatorsOnRegistration |
| VR-031 | registerValidator | Register that creates cluster at exact liquidation boundary — success (not strictly less than threshold) | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:isLiquidatableWithVUnits |
| VR-032 | registerValidator | Register into liquidated ETH cluster — revert ClusterIsLiquidated | `entry:registerValidator; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:validateClusterOnRegistration |
| VR-033 | registerValidator | Register with operators that have SSV legacy cluster (s.clusters entry exists) — revert IncorrectClusterVersion | `entry:registerValidator; version:ssv; eb:implicit; cluster:migrated; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:validateClusterOnRegistration |
| VR-034 | registerValidator | Register triggers ensureETHDefaults for legacy SSV operator (first ETH interaction) — ethFee set to DEFAULT_OPERATOR_ETH_FEE | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:ensureETHDefaults |
| VR-035 | registerValidator | Register triggers ensureETHDefaults for operator with SSV fee = 0 — ethFee stays 0 | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:ensureETHDefaults |
| VR-036 | registerValidator | Register with incorrect cluster state (wrong validatorCount in passed cluster) — revert IncorrectClusterState | `entry:registerValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:validateClusterOnRegistration |
| VR-037 | registerValidator | Register new cluster with non-zero initial cluster fields (validatorCount>0) — revert IncorrectClusterState | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:validateClusterOnRegistration |
| VR-038 | registerValidator | Register new cluster with active=false — revert IncorrectClusterState | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:validateClusterOnRegistration |
| VR-039 | registerValidator | Verify operator ethSnapshot updated correctly on registration — index and balance accumulated | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:updateSnapshot, updateClusterOperatorsOnRegistration |
| VR-040 | registerValidator | Verify DAO ethDaoValidatorCount incremented by 1 and daoTotalEthVUnits updated | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:updateClusterOnRegistration, ProtocolLib.sol:updateDAO |
| VR-041 | registerValidator | Verify ValidatorAdded event emitted with correct parameters | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:_bulkRegisterValidator |
| VR-042 | registerValidator | Register with all 4 operators having max fee — verify large deposit required | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:isLiquidatableWithVUnits |
| VR-043 | registerValidator | Register with all zero-fee operators — only minimumLiquidationCollateral required | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:isLiquidatableWithVUnits |
| VR-044 | bulkRegisterValidator | Bulk register 2 validators in new cluster — success | `entry:bulkRegisterValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:bulkRegisterValidator |
| VR-045 | bulkRegisterValidator | Bulk register 10 validators in new cluster — success | `entry:bulkRegisterValidator; version:eth; eb:implicit; cluster:new; ops:7; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:bulkRegisterValidator |
| VR-046 | bulkRegisterValidator | Bulk register 50 validators in new cluster — success, gas check | `entry:bulkRegisterValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:bulkRegisterValidator |
| VR-047 | bulkRegisterValidator | Bulk register 100 validators in new cluster — success, gas check | `entry:bulkRegisterValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:bulkRegisterValidator |
| VR-048 | bulkRegisterValidator | Bulk register with one duplicate pubkey in batch — atomic revert ValidatorAlreadyRegistered | `entry:bulkRegisterValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | ValidatorLib.sol:registerPublicKey |
| VR-049 | bulkRegisterValidator | Bulk register with one invalid-length pubkey in batch — atomic revert InvalidPublicKeyLength | `entry:bulkRegisterValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | ValidatorLib.sol:registerPublicKey |
| VR-050 | bulkRegisterValidator | Bulk register crossing validatorsPerOperatorLimit mid-batch — revert ExceedValidatorLimitWithData | `entry:bulkRegisterValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:updateClusterOperatorsOnRegistration |
| VR-051 | bulkRegisterValidator | Bulk register with insufficient total deposit for all validators — revert InsufficientBalance | `entry:bulkRegisterValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | ClusterLib.sol:updateClusterOnRegistration |
| VR-052 | bulkRegisterValidator | Bulk register with empty publicKeys array — revert EmptyPublicKeysList | `entry:bulkRegisterValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | SSVValidators.sol:_bulkRegisterValidator |
| VR-053 | bulkRegisterValidator | Bulk register with publicKeys.length != sharesData.length — revert PublicKeysSharesLengthMismatch | `entry:bulkRegisterValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:yes` | [ ] | SSVValidators.sol:_bulkRegisterValidator |
| VR-054 | bulkRegisterValidator | Bulk register into existing active cluster with explicit EB — verify ebSnapshot.vUnits += N * BPS_DENOMINATOR | `entry:bulkRegisterValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:_bulkRegisterValidator (EB block) |
| VR-055 | bulkRegisterValidator | Bulk register 10 validators — verify 10 separate ValidatorAdded events emitted | `entry:bulkRegisterValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:_bulkRegisterValidator |
| VR-056 | bulkRegisterValidator | Bulk register verifies msg.value added to cluster.balance once (not per validator) | `entry:bulkRegisterValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:_bulkRegisterValidator |
| VR-057 | registerValidator | Register with mix of private (whitelisted) and public operators — success | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:updateClusterOperatorsOnRegistration |
| VR-058 | registerValidator | Register where operator already has ETH defaults initialized — no re-initialization, ethFee preserved | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:ensureETHDefaults |
| VR-059 | registerValidator | Register into cluster with projected vUnits exactly at liquidation boundary (isLiquidatable uses strict <) — success | `entry:registerValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:isLiquidatableWithVUnits |
| VR-060 | bulkRegisterValidator | Bulk register where one pubkey already exists from a different owner — success (hash includes owner, no collision) | `entry:bulkRegisterValidator; version:eth; eb:implicit; cluster:new; ops:4; remove_mode:none; revert:no` | [ ] | ValidatorLib.sol:registerPublicKey |

---

## Detailed Scenario Blocks (12 Most Complex)

### VR-005: Register with exact minimum deposit (minimumLiquidationCollateral threshold)

**Goal:** Confirm registration succeeds when msg.value equals the exact minimum required ETH, and the cluster is not flagged as liquidatable.

**Setup:**
1. Register 4 operators with default ETH fee (1,778,800,000 packed wei/block).
2. Set `minimumBlocksBeforeLiquidation = 214800` (30 days at ~12s blocks).
3. Set `minimumLiquidationCollateral` to its current value (e.g., 0.00094 ETH packed).
4. Compute:
   - `burnRate = 4 * 1,778,800,000 = 7,115,200,000` packed wei/block
   - `networkFee` — get current from `sp.ethNetworkFee`
   - `totalRate = burnRate + networkFee`
   - `vUnits = 1 * BPS_DENOMINATOR = 10,000`
   - `thresholdUnits = minimumBlocksBeforeLiquidation * totalRate * 10,000 / 10,000 = minimumBlocksBeforeLiquidation * totalRate`
   - `thresholdWei = thresholdUnits * ETH_DEDUCTED_DIGITS (100,000)`
   - `minimumETH = max(minimumLiquidationCollateral, thresholdWei)`
5. Send `msg.value = minimumETH`.

**Expected:**
- Transaction succeeds.
- `cluster.balance == minimumETH`.
- `isLiquidatableWithVUnits` returns false (balance is NOT strictly less than threshold).

**Verification:**
- Call `getBalance` — returns `minimumETH` minus any fees accrued in same block (should be 0 for new cluster).
- One block later, cluster becomes liquidatable (balance < threshold after one block of fee accrual).

**Code path:** `ClusterLib.sol:updateClusterOnRegistration` -> `isLiquidatableWithVUnits` -> comparison `cluster.balance < liquidationThreshold` — at exact boundary, `<` is false so registration passes.

---

### VR-009: Register with duplicate pubkey (same owner)

**Goal:** Verify that registering the same validator public key twice under the same owner address reverts, regardless of whether the operator set is the same or different.

**Setup:**
1. Register 4 operators, create cluster.
2. Register validator with pubkey `PK_A` into cluster `[op1, op2, op3, op4]` — success.
3. Attempt to register validator with same `PK_A` into same cluster.

**Expected:**
- Revert with `ValidatorAlreadyRegistered(PK_A, owner)`.

**Code path:** `ValidatorLib.registerPublicKey` — computes `hashedPk = keccak256(abi.encodePacked(publicKey, owner))`, checks `s.validatorPKs[hashedPk] != bytes32(0)`.

**Edge case:** The hash is `(pubkey, owner)` — same pubkey under different owners does NOT collide. This is tested in VR-060.

---

### VR-013: Register with removed operator in list

**Goal:** Confirm that including a removed operator in the operator ID list causes a revert, even when all other operators are valid.

**Setup:**
1. Register 4 operators: op1, op2, op3, op4.
2. Remove op3 via `removeOperator(op3)` — this zeroes `operator.owner`, sets `ethSnapshot.block = 0`, `snapshot.block = 0`.
3. Attempt `registerValidator(pubkey, [op1, op2, op3, op4], shares, cluster)` with msg.value > 0.

**Expected:**
- Revert with `OperatorDoesNotExist()`.

**Code path:** `OperatorLib.updateClusterOperatorsOnRegistration` iterates operators. For op3, calls `ensureOperatorExist(operatorSt)` which checks `operator.owner == address(0) || (ethSnapshot.block == 0 && snapshot.block == 0)` — both true for removed operator, so it reverts.

**Note:** Removed operators have their owner preserved (non-zero) per FLOWS.md, but `_resetOperatorState` also zeroes snapshot blocks. The `ensureOperatorExist` check catches the zeroed snapshot blocks. Verify this matches the actual `_resetOperatorState` implementation.

---

### VR-016: Register with private operator — caller NOT whitelisted

**Goal:** Verify that a non-whitelisted caller cannot register validators using a private operator.

**Setup:**
1. Register operator op1 as private (`whitelisted = true`).
2. Whitelist address `ALLOWED_ADDR` for op1.
3. From address `OTHER_ADDR` (not whitelisted), attempt `registerValidator(pubkey, [op1, op2, op3, op4], shares, cluster)`.

**Expected:**
- Revert with `CallerNotWhitelistedWithData(op1)`.

**Code path:** `OperatorLib.updateClusterOperatorsOnRegistration`:
1. `operator.whitelisted == true` → enter whitelist check.
2. `blockIndex = op1 >> 8`, load bitmap `s.addressWhitelistedForOperators[msg.sender][blockIndex]`.
3. Bitmap bit for op1 is 0 (msg.sender not whitelisted).
4. Fallback: `s.operatorsWhitelist[op1]` — returns `ALLOWED_ADDR`, not `msg.sender`.
5. Check if `ALLOWED_ADDR` is whitelisting contract — if not, revert.

**Three-layer whitelist check:** bitmap → legacy address → whitelisting contract. All three must fail for revert.

---

### VR-028: Register into active cluster with explicit EB

**Goal:** When a cluster already has explicit EB tracking (oracle has submitted an EB update), registering a new validator must update `ebSnapshot.vUnits` by adding the new validator's baseline (`BPS_DENOMINATOR`), while NOT updating `operatorEthVUnits` (deviation unchanged).

**Setup:**
1. Create cluster with 4 operators, register 1 validator.
2. Oracle commits root, call `updateClusterBalance` with Merkle proof setting EB to 32 ETH (10,000 vUnits) — now `ebSnapshot.vUnits = 10,000`.
3. Register a second validator into the same cluster.

**Expected:**
- `ebSnapshot.vUnits == 20,000` (10,000 from first validator + 10,000 for new validator's baseline).
- `operatorEthVUnits[op_i]` for each operator is unchanged (no deviation added — new validators start at exactly 32 ETH).
- `daoTotalEthVUnits` increased by `BPS_DENOMINATOR` via `updateDAO(true, 1)`.
- Cluster `validatorCount == 2`.

**Code path:** `SSVValidators._bulkRegisterValidator` EB block: `if (ebSnapshot.vUnits > 0) { ebSnapshot.vUnits += uint64(validatorsLength) * BPS_DENOMINATOR; }`.

**Key invariant:** The deviation-only model means registration never touches operator-level vUnits. Only EB oracle updates and liquidation/reactivation modify `operatorEthVUnits`.

---

### VR-030: Register exceeding validatorsPerOperatorLimit

**Goal:** Verify that registering a validator that would push an operator above `validatorsPerOperatorLimit` reverts with the offending operator ID.

**Setup:**
1. Set `validatorsPerOperatorLimit = 500`.
2. Register 4 operators.
3. Register 500 validators across multiple clusters using op1 (op1 now at limit).
4. Attempt to register 1 more validator in a new cluster using op1.

**Expected:**
- Revert with `ExceedValidatorLimitWithData(op1)`.

**Code path:** `OperatorLib.updateClusterOperatorsOnRegistration`: `if ((operator.ethValidatorCount += deltaValidatorCount) > sp.validatorsPerOperatorLimit)` — the increment happens before the check (increment-then-check pattern), so the revert fires when the new count exceeds the limit.

**Edge case VR-029:** At exactly the limit (500 existing → adding 1 to reach 500 when one was already removed), the `+=` makes count equal to limit, which does NOT trigger `> limit`. This is the at-limit success case.

---

### VR-033: Register with SSV legacy cluster existing

**Goal:** Verify that attempting to register a new validator into operator set that already has an SSV (legacy) cluster reverts.

**Setup:**
1. Pre-migration state: cluster `[op1, op2, op3, op4]` exists as SSV cluster in `s.clusters[hashedCluster]`.
2. Attempt `registerValidator(pubkey, [op1, op2, op3, op4], shares, zeroCluster)` where `zeroCluster` is a fresh/zeroed cluster struct.

**Expected:**
- Revert with `IncorrectClusterVersion()`.

**Code path:** `ClusterLib.validateClusterOnRegistration`:
1. `hashedCluster = keccak256(abi.encodePacked(owner, operatorIds))`.
2. `clusterData = s.ethClusters[hashedCluster]` → `bytes32(0)` (no ETH cluster).
3. `clusterDataSSV = s.clusters[hashedCluster]` → non-zero (SSV cluster exists).
4. `clusterData == bytes32(0) && clusterDataSSV != bytes32(0)` → `revert IncorrectClusterVersion()`.

**Resolution:** Owner must first call `migrateClusterToETH` before registering new validators.

---

### VR-034: Register triggers ensureETHDefaults for legacy SSV operator

**Goal:** When a legacy SSV operator (has SSV fee > 0, ethSnapshot.block == 0) is first used in an ETH cluster registration, verify that `ensureETHDefaults` initializes ETH state correctly.

**Setup:**
1. Register operator via legacy path so `operator.fee > 0` (SSV fee set) but `operator.ethSnapshot.block == 0`.
2. Register a validator in new ETH cluster using this operator.

**Expected:**
- `operator.ethSnapshot.block` set to current `block.number`.
- `operator.ethSnapshot.balance` set to `PACKED_ETH_ZERO`.
- `operator.ethFee` set to `DEFAULT_OPERATOR_ETH_FEE` (1,778,800,000).
- `OperatorFeeExecuted(owner, operatorId, block.number, DEFAULT_OPERATOR_ETH_FEE)` event emitted.

**Code path:** `OperatorLib.updateClusterOperatorsOnRegistration` → `ensureETHDefaults(operatorSt, operatorId)`:
1. `ethSnapshot.block == 0` → enter initialization block.
2. `ethFee.eq(PACKED_ETH_ZERO) && fee.neq(PACKED_SSV_ZERO)` → true (SSV fee > 0, ETH fee not set).
3. `ethFee = defaultOperatorEthFee()` → `DEFAULT_OPERATOR_ETH_FEE`.

---

### VR-048: Bulk register with duplicate pubkey in batch

**Goal:** Verify atomic revert when a batch contains the same pubkey twice — no partial state changes.

**Setup:**
1. 4 operators, new cluster.
2. `publicKeys = [PK_A, PK_B, PK_A]`, `sharesData = [sh1, sh2, sh3]`.
3. Sufficient msg.value for 3 validators.

**Expected:**
- Revert with `ValidatorAlreadyRegistered(PK_A, owner)`.
- No validators registered (atomic — entire transaction reverts).
- No operator state changes.
- No cluster created.

**Code path:** `_bulkRegisterValidator` loops `registerPublicKey` for each pubkey. On iteration 0: PK_A registered in `s.validatorPKs`. On iteration 2: PK_A found in `s.validatorPKs` → revert. EVM atomically undoes all state changes from iterations 0 and 1.

**Note:** The contract does not have try/catch around individual registrations — the batch is all-or-nothing.

---

### VR-050: Bulk register crossing operator limit mid-batch

**Goal:** Verify that bulk registering N validators where the operator reaches `validatorsPerOperatorLimit` at validator N/2 causes a revert on the entire batch.

**Setup:**
1. `validatorsPerOperatorLimit = 10`.
2. Register 4 operators, each already has 8 validators from prior registrations.
3. `bulkRegisterValidator(publicKeys=[pk1..pk5], operatorIds, sharesData, cluster)` with msg.value for 5 validators.

**Expected:**
- Revert with `ExceedValidatorLimitWithData(op_id)`.
- `deltaValidatorCount = 5`, so the check is `8 + 5 = 13 > 10` — revert.
- No validators registered, no state changed.

**Code path:** `updateClusterOperatorsOnRegistration` receives `deltaValidatorCount = 5` (the full batch size). The limit check is `(operator.ethValidatorCount += deltaValidatorCount) > sp.validatorsPerOperatorLimit` — this happens for each operator in the loop. The first operator to exceed triggers the revert.

**Key insight:** The limit check applies the FULL batch delta at once per operator, not one-by-one. So it catches the violation immediately.

---

### VR-054: Bulk register into cluster with explicit EB — vUnits update

**Goal:** Verify that bulk registering N validators into a cluster with explicit EB correctly adds `N * BPS_DENOMINATOR` to `ebSnapshot.vUnits`.

**Setup:**
1. Create cluster with 4 operators, register 2 validators. Oracle updates EB to 64 ETH → `ebSnapshot.vUnits = 20,000`.
2. `bulkRegisterValidator(publicKeys=[pk3..pk7], operatorIds, sharesData, cluster)` — 5 new validators.

**Expected:**
- `ebSnapshot.vUnits = 20,000 + (5 * 10,000) = 70,000`.
- `operatorEthVUnits[op_i]` unchanged for all operators.
- `cluster.validatorCount = 7`.
- Liquidation check uses `projectedVUnits = 20,000 + 5 * 10,000 = 70,000` (from `updateClusterOnRegistration`).
- `daoTotalEthVUnits` increased by `5 * BPS_DENOMINATOR`.

**Code path chain:**
1. `_bulkRegisterValidator` → `cluster.updateClusterOnRegistration(operatorIds, hashedCluster, 5, s, sp)`.
2. In `updateClusterOnRegistration`: `projectedVUnits = storedVUnits > 0 ? storedVUnits + 5 * BPS_DENOMINATOR : ...` — takes explicit path since `storedVUnits = 20,000 > 0`.
3. Then in `_bulkRegisterValidator` EB block: `ebSnapshot.vUnits > 0` → `ebSnapshot.vUnits += 5 * BPS_DENOMINATOR`.

**Invariant:** There are TWO separate EB update sites: one in `updateClusterOnRegistration` (for liquidation check, using projected vUnits) and one in `_bulkRegisterValidator` (for actual storage update). They must agree. Both add `validatorsLength * BPS_DENOMINATOR`.

---

### VR-059: Register at projected vUnits liquidation boundary with explicit EB

**Goal:** Stress-test the liquidation boundary check when a cluster has explicit EB. The projected vUnits calculation must use `storedVUnits + delta`, not `cluster.validatorCount * BPS_DENOMINATOR`, to correctly account for EB deviation.

**Setup:**
1. Create cluster with 4 operators, register 1 validator.
2. Oracle updates EB to 48 ETH → `ebSnapshot.vUnits = 15,000` (50% above baseline of 10,000).
3. Compute exact minimum deposit for 2 validators at projected `vUnits = 15,000 + 10,000 = 25,000`:
   - `burnRate = 4 * operator.ethFee`
   - `totalRate = burnRate + networkFee`
   - `thresholdUnits = minimumBlocksBeforeLiquidation * totalRate * 25,000 / 10,000`
   - `thresholdWei = thresholdUnits * 100,000`
   - `minimumETH = max(minimumLiquidationCollateral, thresholdWei)`
4. Set `cluster.balance` (after fees settled) + msg.value to exactly `minimumETH`.

**Expected:**
- Registration succeeds because `cluster.balance` is NOT strictly less than `liquidationThreshold`.
- If the code incorrectly used `2 * BPS_DENOMINATOR = 20,000` instead of `25,000`, the threshold would be lower and wrong.

**Code path:** `updateClusterOnRegistration`:
```
storedVUnits = seb.clusterEB[hashedCluster].vUnits  // 15,000
projectedVUnits = storedVUnits > 0 ? storedVUnits + 1 * BPS_DENOMINATOR : ...  // 25,000
isLiquidatableWithVUnits(cluster, 25000, burnRate, networkFee, ...)
```

**Why this matters:** If the projected vUnits calculation is wrong, clusters with above-baseline EB could register validators at dangerously low funding levels and become instantly liquidatable.

---

## Audit Gaps (Added post-audit)

> Identified by code-level branch analysis. These scenarios cover branches and edge conditions not addressed by the original VR-001 through VR-060 set.

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| VR-061 | registerValidator | Implicit EB no-op assertion: register first validator, verify `ebSnapshot.vUnits` remains 0 (not explicitly set). The cluster uses implicit EB where `getVUnits` returns `validatorCount * BPS_DENOMINATOR` as fallback. | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; revert:no` | [ ] | ClusterLib.sol:285-297 |
| VR-062 | registerValidator | Whitelist bitmap miss with zero legacy slot: register with private operator where msg.sender has no bitmap bit AND `operatorsWhitelist[operatorId] == address(0)` — revert `CallerNotWhitelistedWithData`. Distinct from VR-016 which does not specify the legacy slot state. | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; revert:yes` | [ ] | OperatorLib.sol:194-196 |
| VR-063 | registerValidator | Non-whitelisting contract fallback: private operator where `operatorsWhitelist[operatorId]` holds an address that is neither msg.sender nor an `ISSVWhitelistingContract` — revert `CallerNotWhitelistedWithData`. Distinct from VR-019 which tests contract returning false. | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; revert:yes` | [ ] | OperatorLib.sol:199-207 |
| VR-064 | registerValidator | New cluster: verify individual field defaults — `cluster.index == 0`, `cluster.networkFeeIndex == 0`, `cluster.balance == 0` before registration populates them. Assert the initial cluster struct passed by caller has all-zero fields. | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; revert:no` | [ ] | ClusterLib.sol:validateClusterOnRegistration |
| VR-065 | registerValidator | New cluster: verify `cluster.networkFeeIndex` is set to current `sp.ethNetworkFeeIndex` after registration. | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; revert:no` | [ ] | ClusterLib.sol:updateClusterOnRegistration |
| VR-066 | registerValidator | New cluster: verify `cluster.balance` equals `msg.value` after registration (not accumulated from a prior state). | `entry:registerValidator; version:eth; eb:implicit; cluster:new; ops:4; revert:no` | [ ] | SSVValidators.sol:_bulkRegisterValidator |
| VR-067 | registerValidator | DAO validator count overflow: register validators until `ethDaoValidatorCount` approaches max uint. Verify the counter does not silently overflow. (Theoretical; requires extremely large state.) | `entry:registerValidator; version:eth; eb:implicit; cluster:active; ops:4; revert:yes` | [ ] | ProtocolLib.sol:updateDAO |

---

## ask-codex Review Findings

### Corrections

- **VR-013**: Setup description says `removeOperator` zeroes `operator.owner` — **WRONG**. The code preserves `owner` and only zeroes snapshot/counter fields at SSVOperators.sol:347. Fix description.

### Additional Scenarios

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| VR-068 | bulkRegisterValidator | Bulk register with unsorted operator IDs → revert after some PKs already written → verify atomic rollback. | `entry:bulkRegisterValidator; revert:yes` | [ ] | SSVValidators.sol:123, OperatorLib.sol:170-172 |
| VR-069 | bulkRegisterValidator | Bulk register with duplicate operator ID in array → revert after PKs written → atomic rollback. | `entry:bulkRegisterValidator; revert:yes` | [ ] | OperatorLib.sol:173-174 |
| VR-070 | bulkRegisterValidator | Bulk register with non-existent operator (owner==address(0)) → revert `OperatorDoesNotExist`. | `entry:bulkRegisterValidator; revert:yes` | [ ] | OperatorLib.sol:139-143, 177 |
| VR-071 | bulkRegisterValidator | Bulk register with whitelist check (private operator, bitmap whitelist) → verify whitelist enforced per operator in batch. | `entry:bulkRegisterValidator; revert:no` | [ ] | OperatorLib.sol:183-206 |
| VR-072 | bulkRegisterValidator | Bulk register where existing + batchSize == validatorsPerOperatorLimit → success at exact limit. | `entry:bulkRegisterValidator; revert:no` | [ ] | OperatorLib.sol:213-214 |
| VR-073 | registerValidator | Registration with operator IDs crossing bitmap slot boundary (e.g., 255 and 256) → verify cached-mask refresh at OperatorLib.sol:185-189. | `entry:registerValidator; revert:no` | [ ] | OperatorLib.sol:185-189 |

---

## Coverage Verification (W4)

| ID | Tested | remove_mode | Test File | Notes |
|----|--------|-------------|-----------|-------|
| VR-001 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Registers a new validator, creates new cluster with the expected data and emits correct events" — 4 ops, new cluster, event verified |
| VR-002 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Registers a new validator with 7 operators" — gas tracked |
| VR-003 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Registers a new validator with 10 operators" — gas tracked |
| VR-004 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Registers a new validator with 13 operators" — gas tracked |
| VR-005 | no | none | — | No test for exact minimum deposit at liquidation boundary |
| VR-006 | no | none | — | No test for burn-rate threshold dominating minimumLiquidationCollateral |
| VR-007 | no | none | — | No test for 1 wei below minimum deposit revert |
| VR-008 | no | none | — | No test for zero msg.value InsufficientBalance revert |
| VR-009 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Is reverted with 'ValidatorAlreadyRegistered' if trying to register already existing key" — same owner same ops |
| VR-010 | no | none | — | No test for duplicate pubkey with different operator set |
| VR-011 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Is reverted with 'UnsortedOperatorsList'" — uses [4,3,2,1] |
| VR-012 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Is reverted with 'OperatorsListNotUnique'" — uses [1,1,2,4] |
| VR-013 | partial:mock | mock_zero | unit/SSVValidator/registerValidator.test.ts | "Is reverted with 'OperatorDoesNotExist' when one of the operators has been removed" — uses `mockRemoveOperator`, not real `removeOperator` |
| VR-014 | partial:weak | none | unit/SSVValidator/registerValidator.test.ts | VR-013 test covers removed op (which internally is non-existent); no separate test for never-registered operator ID |
| VR-015 | yes | none | e2e/validators/validator-lifecycle.test.ts | "Non-whitelisted caller reverts, whitelisted caller succeeds" — whitelisted via `setOperatorsWhitelists` (bitmap), then registers successfully |
| VR-016 | yes | none | e2e/validators/validator-lifecycle.test.ts | "Non-whitelisted caller reverts, whitelisted caller succeeds" — private ops, non-whitelisted caller gets CallerNotWhitelisted revert |
| VR-017 | no | none | — | No test specifically for legacy address whitelist path |
| VR-018 | no | none | — | No test for whitelisting contract returning true |
| VR-019 | no | none | — | No test for whitelisting contract returning false |
| VR-020 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Is reverted with 'InvalidOperatorIdsLength'" — uses 3 operators |
| VR-021 | yes | none | e2e/validators/validator-edge-cases.test.ts | "Reverts with InvalidOperatorIdsLength for 5 operators" |
| VR-022 | no | none | — | No test for 14 operators specifically |
| VR-023 | no | none | — | No test for 0 operators specifically (VR-020 uses 3) |
| VR-024 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Is reverted with 'InvalidPublicKeyLength'" — tests invalid length pubkey (49 bytes via appending "11") |
| VR-025 | yes | none | unit/SSVValidator/registerValidator.test.ts | Same test as VR-024 — covers both short and long via two subcases |
| VR-026 | yes | none | unit/SSVValidator/registerValidator.test.ts | Same test — covers empty `0x` public key |
| VR-027 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Registers a validator into an existing cluster with 7 operators" + equivalent 10/13; also e2e lifecycle adds to existing cluster |
| VR-028 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Increments stored EB snapshot vUnits when cluster EB snapshot is set" — mocks explicit EB, verifies vUnits += BPS_DENOMINATOR |
| VR-029 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Succeeds registering a validator after removing one to bring operator back below the limit" — registers at limit-1 after removal |
| VR-030 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Is reverted with 'ExceedValidatorLimitWithData'" — limit=5, 5 registered, 6th reverts with operatorIds[0] |
| VR-031 | no | none | — | No test for exact liquidation boundary (balance == threshold) |
| VR-032 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Is reverted with 'ClusterIsLiquidated'" — uses mockSetClusterLiquidated |
| VR-033 | no | none | — | No test for IncorrectClusterVersion on SSV legacy cluster registration |
| VR-034 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Initializes ETH defaults for legacy SSV operators and keeps them after registration" — verifies ethFee set to DEFAULT_OPERATOR_ETH_FEE, OperatorFeeExecuted event |
| VR-035 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Legacy SSV operators with zero SSV fee initialize ETH snapshot but keep ethFee=0" — verifies no fee event, ethFee=0 |
| VR-036 | yes | none | unit/SSVValidator/removeValidator.test.ts | "Is reverted with 'IncorrectClusterState'" — provides mismatched cluster balance |
| VR-037 | yes | none | e2e/validators/validator-edge-cases.test.ts | "Reverts with IncorrectClusterState when passing wrong cluster struct" — non-zero validatorCount for new cluster |
| VR-038 | no | none | — | No explicit test for new cluster with active=false revert |
| VR-039 | partial:weak | none | unit/SSVValidator/registerValidator.test.ts | "Updates operatorEthVUnits even when cluster EB snapshot is not set" — checks effectiveVUnits but not snapshot index/balance directly |
| VR-040 | no | none | — | No test specifically verifying DAO ethDaoValidatorCount and daoTotalEthVUnits increments on registration |
| VR-041 | yes | none | unit/SSVValidator/registerValidator.test.ts | First test verifies ValidatorAdded event with all parameters |
| VR-042 | no | none | — | No test for max-fee operators requiring large deposit |
| VR-043 | yes | none | e2e/validators/validator-lifecycle.test.ts | "Register on operators with fee=0 — zero fee accrual" — all zero-fee operators |
| VR-044 | yes | none | unit/SSVValidator/bulkRegisterValidator.test.ts | "Registers multiple validators, creates new cluster" — 2 validators, new cluster |
| VR-045 | yes | none | unit/SSVValidator/bulkRegisterValidator.test.ts | "Registers 10 validators into a new cluster with 7 operators" — gas tracked |
| VR-046 | no | none | — | No 50-validator bulk test |
| VR-047 | no | none | — | No 100-validator bulk test |
| VR-048 | yes | none | unit/SSVValidator/bulkRegisterValidator.test.ts | "Is reverted with 'ValidatorAlreadyRegistered'" — batch [pk, pk] |
| VR-049 | yes | none | unit/SSVValidator/bulkRegisterValidator.test.ts | "Is reverted with 'InvalidPublicKeyLength'" — batch with invalid-length key |
| VR-050 | no | none | — | No test for crossing validatorsPerOperatorLimit mid-batch in bulk register (unit test VR-030 only tests single register) |
| VR-051 | no | none | — | No test for bulk register with insufficient total deposit |
| VR-052 | yes | none | unit/SSVValidator/bulkRegisterValidator.test.ts | "Is reverted with 'EmptyPublicKeysList'" |
| VR-053 | yes | none | unit/SSVValidator/bulkRegisterValidator.test.ts | "Is reverted with 'PublicKeysSharesLengthMismatch'" — also in registerValidator.test.ts |
| VR-054 | yes | none | unit/SSVValidator/bulkRegisterValidator.test.ts | "Increments stored EB snapshot vUnits when cluster EB snapshot is set" — mocks explicit EB, verifies vUnits += N * BPS_DENOMINATOR |
| VR-055 | partial:weak | none | e2e/validators/validator-lifecycle.test.ts | Bulk register 3 validators verifies 3 ValidatorAdded events; but not 10 |
| VR-056 | no | none | — | No test verifying msg.value added once (not per validator) in bulk |
| VR-057 | yes | none | e2e/validators/validator-lifecycle.test.ts | "Mix of public and private operators in same cluster" — 2 public + 2 private, whitelist only private, register succeeds |
| VR-058 | partial:weak | none | unit/SSVValidator/registerValidator.test.ts | "Keeps stored EB snapshot unset when registering into existing cluster without explicit EB" — implicit assertion that no re-init happens, but not testing preserved ethFee explicitly |
| VR-059 | no | none | — | No test for projected vUnits at liquidation boundary with explicit EB |
| VR-060 | no | none | — | No test for same pubkey different owner in bulk register (no collision) |
| VR-061 | yes | none | unit/SSVValidator/registerValidator.test.ts | "Updates operatorEthVUnits even when cluster EB snapshot is not set" — verifies clusterVUnits stays 0 (implicit EB) |
| VR-062 | no | none | — | No test for bitmap miss + zero legacy slot revert |
| VR-063 | no | none | — | No test for non-whitelisting contract fallback revert |
| VR-064 | no | none | — | No test asserting initial cluster struct field defaults |
| VR-065 | no | none | — | No test verifying cluster.networkFeeIndex set to current ethNetworkFeeIndex |
| VR-066 | yes | none | e2e/validators/validator-lifecycle.test.ts | First test verifies cluster.balance == depositEth after new cluster registration |
| VR-067 | no | none | — | No overflow test for DAO validator count |
| VR-068 | yes | none | unit/SSVValidator/bulkRegisterValidator.test.ts | "Is reverted with 'UnsortedOperatorsList'" — bulk version |
| VR-069 | yes | none | unit/SSVValidator/bulkRegisterValidator.test.ts | "Is reverted with 'OperatorsListNotUnique'" — bulk version |
| VR-070 | partial:mock | mock_zero | unit/SSVValidator/bulkRegisterValidator.test.ts | "Is reverted with 'OperatorDoesNotExist'" — uses mockRemoveOperator |
| VR-071 | no | none | — | No test for bulk register with private operator bitmap whitelist check |
| VR-072 | no | none | — | No test for bulk register at exact validatorsPerOperatorLimit |
| VR-073 | no | none | — | No test for operator IDs crossing bitmap slot boundary |
