# Operator Fee Lifecycle — Test Scenarios (OF-001 to OF-040)

**Scope:** `declareOperatorFee`, `executeOperatorFee`, `cancelDeclaredOperatorFee`, `reduceOperatorFee`, and their interactions with operator removal, active clusters, EB (vUnits), liquidation, and DAO parameters.

**Source files:**
- `contracts/modules/SSVOperators.sol` — fee entry points
- `contracts/libraries/OperatorLib.sol` — snapshot update logic, `ensureETHDefaults`
- `contracts/interfaces/ISSVNetworkCore.sol` — `OperatorFeeChangeRequest` struct, error definitions
- `contracts/libraries/SSVCoreTypes.sol` — `ETH_DEDUCTED_DIGITS` (100,000), `BPS_DENOMINATOR` (10,000), `DEFAULT_OPERATOR_ETH_FEE`
- `contracts/libraries/storage/SSVStorageProtocol.sol` — `declareOperatorFeePeriod`, `executeOperatorFeePeriod`, `operatorMaxFeeIncrease`, `operatorMaxFee`, `minimumOperatorEthFee`

**Key invariants under test:**
- Fee precision: all fees must be divisible by `ETH_DEDUCTED_DIGITS` (100,000)
- Fee Settlement Rule: snapshot updated at OLD fee before new fee stored (SPEC §10)
- Declare/execute timelock: `approvalBeginTime = now + declarePeriod`, `approvalEndTime = approvalBeginTime + executePeriod`
- Reduce bypasses timelock entirely; deletes any pending declaration
- `removeOperator` deletes `operatorFeeChangeRequests`
- Zero-fee operators (both SSV=0 and ETH=0) cannot increase fee (`FeeIncreaseNotAllowed`)
- `ensureETHDefaults` assigns `DEFAULT_OPERATOR_ETH_FEE` only when `ethFee == 0 && SSV fee > 0`

---

## Tag Legend

| Tag | Values | Meaning |
|-----|--------|---------|
| `entry` | function name | Entry-point under test |
| `version` | `eth` / `ssv` / `both` | Operator fee version context |
| `eb` | `implicit` / `explicit` / `none` | Effective balance model of associated clusters |
| `cluster` | `active` / `liquidated` / `migrated` / `none` | Cluster state context |
| `ops` | `4` / `7` / `10` / `13` / `parametric` | Operator count in related cluster |
| `remove_mode` | `real` / `mock_zero` / `mock_payout` / `none` | How operator removal is handled |
| `revert` | `yes` / `no` | Whether the scenario expects a revert |

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| OF-001 | Declare fee increase within limit → wait → execute | Happy-path fee increase: declare within `operatorMaxFeeIncrease`, wait for `approvalBeginTime`, execute within window | `entry:declareOperatorFee,executeOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:109-173` |
| OF-002 | Declare fee increase exceeding `operatorMaxFeeIncrease` | Revert with `FeeExceedsIncreaseLimit` when declared fee exceeds percentage limit | `entry:declareOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:131-133` |
| OF-003 | Declare fee exceeding `operatorMaxFee` | Revert with `FeeTooHigh` when declared fee exceeds absolute max | `entry:declareOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:116` |
| OF-004 | Declare fee below `minimumOperatorEthFee` (non-zero) | Revert with `FeeTooLow` when non-zero fee is below minimum | `entry:declareOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:115` |
| OF-005 | Declare fee same as current | Revert with `SameFeeChangeNotAllowed` | `entry:declareOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:124` |
| OF-006 | Declare fee increase on zero-fee operator (SSV=0, ETH=0) | Revert with `FeeIncreaseNotAllowed` — zero-fee operators cannot increase | `entry:declareOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:126-128` |
| OF-007 | Execute fee too early (before `approvalBeginTime`) | Revert with `ApprovalNotWithinTimeframe` | `entry:executeOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:158-162` |
| OF-008 | Execute fee too late (after `approvalEndTime`) | Revert with `ApprovalNotWithinTimeframe` | `entry:executeOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:158-162` |
| OF-009 | Execute fee exactly at `approvalBeginTime` boundary | Boundary: execute succeeds at the exact second the window opens | `entry:executeOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:158-162` |
| OF-010 | Execute fee exactly at `approvalEndTime` boundary | Boundary: execute succeeds at the exact last second of the window | `entry:executeOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:159` |
| OF-011 | Execute with no pending declaration | Revert with `NoFeeDeclared` | `entry:executeOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:152` |
| OF-012 | Execute pre-upgrade declaration (`approvalBeginTime <= UPGRADE_TIMESTAMP`) | Revert with `LegacyOperatorFeeDeclarationInvalid` | `entry:executeOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:154-156` |
| OF-013 | Declare → cancel → verify no pending request | Cancel clears the request; subsequent execute reverts with `NoFeeDeclared` | `entry:declareOperatorFee,cancelDeclaredOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:178-187` |
| OF-014 | Cancel with no pending declaration | Revert with `NoFeeDeclared` | `entry:cancelDeclaredOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:184` |
| OF-015 | Declare → cancel → declare new → execute | After cancellation, a new declaration can be made and executed normally | `entry:declareOperatorFee,cancelDeclaredOperatorFee,executeOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:109-173,178-187` |
| OF-016 | Multiple sequential declarations (overwrite) | Second declare overwrites first; only second fee is executable | `entry:declareOperatorFee,executeOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:135-139` |
| OF-017 | Reduce fee within valid range (immediate, no timelock) | Happy-path reduce: new fee < current fee, >= minimumOperatorEthFee. Applied immediately. | `entry:reduceOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:192-214` |
| OF-018 | Reduce fee to zero (permanent zero) | Reduce to 0 succeeds; operator becomes free. Cannot increase back (FeeIncreaseNotAllowed on next declare). | `entry:reduceOperatorFee,declareOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:192-214,126-128` |
| OF-019 | Reduce fee to value >= current fee | Revert with `FeeIncreaseNotAllowed` — reduce must be strictly less | `entry:reduceOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:205` |
| OF-020 | Reduce fee below `minimumOperatorEthFee` (non-zero) | Revert with `FeeTooLow` when reducing to non-zero value below minimum | `entry:reduceOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:196` |
| OF-021 | Reduce fee clears pending declaration | After declare, reduce deletes the pending fee change request | `entry:declareOperatorFee,reduceOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:211` |
| OF-022 | Fee change with active validators — snapshot balance settlement | Operator with N validators: fee change settles balance at old rate, then accrues at new rate. Verify `ethSnapshot.balance` math. | `entry:declareOperatorFee,executeOperatorFee; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | `OperatorLib.sol:52-72, SSVOperators.sol:166-168` |
| OF-023 | Fee change with explicit EB clusters — vUnits impact on burn rate | Operator with explicit EB validators (vUnits != validatorCount * BPS_DENOMINATOR). Fee change settles using `effectiveVUnits` formula. Verify balance delta includes deviation. | `entry:declareOperatorFee,executeOperatorFee; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | `OperatorLib.sol:56-71` |
| OF-024 | Reduce fee with explicit EB clusters — vUnits settlement | Same as OF-023 but using `reduceOperatorFee`. Verify snapshot settles correctly with EB-weighted vUnits before new fee applies. | `entry:reduceOperatorFee; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | `OperatorLib.sol:79-97, SSVOperators.sol:207-208` |
| OF-025 | Declare fee → remove operator before execution | `removeOperator` deletes `operatorFeeChangeRequests`. Verify declaration is gone. | `entry:declareOperatorFee,removeOperator; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:real; revert:no` | [ ] | `SSVOperators.sol:94` |
| OF-026 | Fee change by non-owner | Revert with `CallerNotOwnerWithData` — only operator owner can change fee | `entry:declareOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:111, OperatorLib.sol:111-116` |
| OF-027 | Execute fee by non-owner | Revert with `CallerNotOwnerWithData` | `entry:executeOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:148` |
| OF-028 | Cancel fee by non-owner | Revert with `CallerNotOwnerWithData` | `entry:cancelDeclaredOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:180` |
| OF-029 | Reduce fee by non-owner | Revert with `CallerNotOwnerWithData` | `entry:reduceOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:194` |
| OF-030 | Fee precision — value not divisible by 100,000 | `PackedETHLib.pack(fee)` reverts with `MaxPrecisionExceeded` when fee % 100,000 != 0 | `entry:declareOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVPackedLib.sol (pack)` |
| OF-031 | Fee precision — reduce with non-divisible value | Same precision check on `reduceOperatorFee` | `entry:reduceOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVPackedLib.sol (pack)` |
| OF-032 | Fee at uint64 max boundary (packed) | Declare fee at `operatorMaxFee` exactly — should succeed if within increase limit. Verify no overflow in packed representation. | `entry:declareOperatorFee,executeOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:116,131-133,164` |
| OF-033 | Execute fee when DAO lowers `operatorMaxFee` between declare and execute | Fee was valid at declaration but now exceeds `operatorMaxFee` → revert with `FeeTooHigh` at execute time | `entry:declareOperatorFee,executeOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:164` |
| OF-034 | Fee change interaction with liquidation threshold | Operator fee increase → cluster's burn rate rises → cluster becomes liquidatable. Verify `isLiquidatable` returns true post-execute. | `entry:declareOperatorFee,executeOperatorFee; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:166-168`, SPEC §10 liquidation formula |
| OF-035 | Legacy SSV operator — `ensureETHDefaults` on first declare | Legacy operator (SSV fee > 0, ethSnapshot.block == 0): `declareOperatorFee` triggers `ensureETHDefaults`, assigns `DEFAULT_OPERATOR_ETH_FEE`, emits extra event | `entry:declareOperatorFee; version:both; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:117-119, OperatorLib.sol:122-133` |
| OF-036 | Legacy SSV operator — `ensureETHDefaults` on first reduce | Legacy operator: `reduceOperatorFee` triggers `ensureETHDefaults`, sets default fee, then reduces. Verify two events emitted. | `entry:reduceOperatorFee; version:both; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:198-199, OperatorLib.sol:122-133` |
| OF-037 | Fee increase at exact `operatorMaxFeeIncrease` boundary | Declare fee that is exactly `currentFee * (BPS_DENOMINATOR + operatorMaxFeeIncrease) / BPS_DENOMINATOR` (ceiling). Boundary test — should succeed. | `entry:declareOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:131` |
| OF-038 | Fee increase 1 wei above max increase limit | Declare fee = `maxAllowedFee + ETH_DEDUCTED_DIGITS` (next valid packed value above limit). Revert with `FeeExceedsIncreaseLimit`. | `entry:declareOperatorFee; version:eth; eb:none; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | `SSVOperators.sol:131-133` |
| OF-039 | Sequential fee changes — declare, execute, declare again, execute again | Two full declare→execute cycles in sequence. Verify each cycle settles correctly with intermediate fee. | `entry:declareOperatorFee,executeOperatorFee; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:109-173` |
| OF-040 | Fee change on operator in liquidated cluster | Operator fee change succeeds even when clusters using this operator are liquidated. Verify operator snapshot is still updated. Post-fee-change, cluster burn rate reflects new fee on reactivation. | `entry:declareOperatorFee,executeOperatorFee; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | `SSVOperators.sol:166-168, OperatorLib.sol:52-72` |

---

## Detailed Scenarios (10 Most Complex)

---

### OF-001: Declare Fee Increase Within Limit → Wait → Execute (Happy Path)

**Preconditions:**
- Operator `O1` registered with `ethFee = 2_000_000_000` (2 gwei, packed), `ethSnapshot.block > 0`
- `operatorMaxFeeIncrease = 1000` (10% in BPS)
- `declareOperatorFeePeriod = 86400` (1 day)
- `executeOperatorFeePeriod = 86400` (1 day)
- `operatorMaxFee` is sufficiently high (e.g., 10 gwei)
- `minimumOperatorEthFee` is below target fee
- Caller is `O1.owner`

**Action Sequence:**
1. `declareOperatorFee(O1.id, 2_200_000_000)` — 10% increase, exactly at limit
2. Verify `OperatorFeeDeclared` event with correct fee, block number
3. Verify `operatorFeeChangeRequests[O1.id]` stores packed fee, `approvalBeginTime = block.timestamp + 86400`, `approvalEndTime = block.timestamp + 172800`
4. Advance time by `86400` seconds (to `approvalBeginTime`)
5. `executeOperatorFee(O1.id)`
6. Verify `OperatorFeeExecuted` event with new fee

**Assertions:**
- `O1.ethFee == packed(2_200_000_000)` after execute
- `O1.ethSnapshot.block == block.number` at execute time (snapshot updated)
- `operatorFeeChangeRequests[O1.id]` is deleted (all fields zero)
- Operator's `ethSnapshot.balance` reflects earnings accrued at old fee (2 gwei) for blocks between declare and execute

**Edge Variations:**
- Execute at `approvalBeginTime + 1` (one second into window)
- Execute at `approvalEndTime - 1` (one second before window closes)
- Declare with fee increase of exactly 1 packed unit above current

---

### OF-008: Execute Fee Too Late (After `approvalEndTime`)

**Preconditions:**
- Operator `O1` with `ethFee = 3_000_000_000`, `ethSnapshot.block > 0`
- Valid declaration pending: `approvalBeginTime = T`, `approvalEndTime = T + 86400`
- `operatorMaxFeeIncrease` sufficient for declared fee
- Caller is `O1.owner`

**Action Sequence:**
1. `declareOperatorFee(O1.id, 3_300_000_000)` at time `T0`
2. Advance time to `T0 + declareOperatorFeePeriod + executeOperatorFeePeriod + 1` (one second past window)
3. Call `executeOperatorFee(O1.id)`

**Assertions:**
- Revert with `ApprovalNotWithinTimeframe()`
- `O1.ethFee` unchanged at `packed(3_000_000_000)`
- `operatorFeeChangeRequests[O1.id]` still exists (not deleted on failed execute)
- Operator must re-declare to change fee

**Edge Variations:**
- Execute at `approvalEndTime + 0` (exactly at boundary — should still succeed per `<=` check in code: `block.timestamp > feeChangeRequest.approvalEndTime`)
- Execute at `approvalEndTime + 1` (first second past — reverts)

---

### OF-016: Multiple Sequential Declarations (Overwrite)

**Preconditions:**
- Operator `O1` with `ethFee = 1_000_000_000`, `ethSnapshot.block > 0`
- `operatorMaxFeeIncrease = 1000` (10%)
- `declareOperatorFeePeriod = 3600`, `executeOperatorFeePeriod = 3600`
- Caller is `O1.owner`

**Action Sequence:**
1. `declareOperatorFee(O1.id, 1_100_000_000)` at time `T0` — 10% increase
2. Verify `OperatorFeeDeclared` event, request stored with `approvalBeginTime = T0 + 3600`
3. At time `T0 + 1800` (30 min later), call `declareOperatorFee(O1.id, 1_050_000_000)` — 5% increase (overwrites)
4. Verify new `OperatorFeeDeclared` event, request now has `approvalBeginTime = T0 + 1800 + 3600 = T0 + 5400`
5. Advance time to `T0 + 3600` — try `executeOperatorFee(O1.id)` — should revert (too early for second declaration)
6. Advance time to `T0 + 5400` — `executeOperatorFee(O1.id)` succeeds

**Assertions:**
- After step 3: `operatorFeeChangeRequests[O1.id].fee == packed(1_050_000_000)` (overwritten)
- After step 5: revert with `ApprovalNotWithinTimeframe()`
- After step 6: `O1.ethFee == packed(1_050_000_000)`, request deleted
- Original 1_100_000_000 declaration is permanently lost

**Edge Variations:**
- Overwrite with lower fee (still above current — triggers increase limit check against current fee, not previous declaration)
- Overwrite with fee that would exceed increase limit from current fee

---

### OF-022: Fee Change with Active Validators — Snapshot Balance Settlement

**Preconditions:**
- Operator `O1` with `ethFee = 1_000_000_000` (packed), `ethValidatorCount = 10`, `ethSnapshot.block = B0`, `ethSnapshot.balance = 0`
- No EB deviations (`operatorEthVUnits[O1.id] = 0`), so `effectiveVUnits = 10 * 10_000 = 100_000`
- 100 blocks pass between `B0` and fee change execution block `B1`
- New fee declared and executable: `2_000_000_000`

**Action Sequence:**
1. `declareOperatorFee(O1.id, 2_000_000_000)` at block `B0 + 50`
2. Wait for approval window
3. `executeOperatorFee(O1.id)` at block `B1 = B0 + 100`

**Assertions:**
- Before execute: `ethSnapshot.index` should be 0 (not yet updated)
- Execute calls `updateSnapshotSt(operator, operatorId)`:
  - `blockDiffEthFee = (B1 - B0) * packed(1_000_000_000) = 100 * 10` (packed units) `= 1000`
  - `effectiveVUnits = 0 + 10 * 10_000 = 100_000`
  - `delta = (1000 * 100_000) / 10_000 = 10_000`
  - `ethSnapshot.balance += packed(10_000)` which unpacks to `10_000 * 100_000 = 1_000_000_000` wei
  - `ethSnapshot.index = 0 + 1000 = 1000`
  - `ethSnapshot.block = B1`
- After execute: `O1.ethFee == packed(2_000_000_000)`
- Subsequent 100 blocks accrue at new rate: `delta = (100 * 20) * 100_000 / 10_000 = 20_000` packed

**Edge Variations:**
- `ethValidatorCount = 0` → `effectiveVUnits = 0`, no balance delta despite fee change
- Very large `ethValidatorCount` near `validatorsPerOperatorLimit`

---

### OF-023: Fee Change with Explicit EB Clusters — vUnits Impact on Burn Rate

**Preconditions:**
- Operator `O1` with `ethFee = 1_000_000_000`, `ethValidatorCount = 5`, `ethSnapshot.block = B0`, `ethSnapshot.balance = 0`
- Explicit EB deviation stored: `operatorEthVUnits[O1.id] = 30_000` (represents 3 additional vUnits worth of deviation from clusters with non-default EB)
- `effectiveVUnits = 30_000 + 5 * 10_000 = 80_000`
- 200 blocks since last snapshot
- New fee: `1_500_000_000` (50% increase, within `operatorMaxFeeIncrease`)

**Action Sequence:**
1. Declare and wait for approval window
2. `executeOperatorFee(O1.id)` at block `B0 + 200`

**Assertions:**
- Snapshot update calculates:
  - `blockDiffEthFee = 200 * packed(1_000_000_000) = 200 * 10 = 2000`
  - `effectiveVUnits = 30_000 + 50_000 = 80_000`
  - `delta = (2000 * 80_000) / 10_000 = 16_000` packed
  - `ethSnapshot.balance = packed(16_000)` → unpacked = `16_000 * 100_000 = 1_600_000_000` wei
- Contrast with implicit-only (no deviation): `delta = (2000 * 50_000) / 10_000 = 10_000` — EB deviation adds 60% more earnings
- New fee stored: `packed(1_500_000_000)`

**Edge Variations:**
- Negative-like deviation scenario: deviation = 0, all clusters are default EB
- Very large deviation pushing `effectiveVUnits` near uint64 boundary
- Fee change immediately after an EB oracle update changes `operatorEthVUnits`

---

### OF-025: Declare Fee → Remove Operator Before Execution

**Preconditions:**
- Operator `O1` with `ethFee = 2_000_000_000`, `ethSnapshot.block > 0`, `ethValidatorCount = 0` (no active clusters)
- `operatorMaxFeeIncrease = 1000`, fee increase to `2_200_000_000` declared
- Pending `operatorFeeChangeRequests[O1.id]` exists with valid future window
- Caller is `O1.owner`

**Action Sequence:**
1. `declareOperatorFee(O1.id, 2_200_000_000)` — pending request created
2. Verify `operatorFeeChangeRequests[O1.id].approvalBeginTime > 0`
3. `removeOperator(O1.id)` — should succeed
4. Verify `operatorFeeChangeRequests[O1.id]` is deleted (line 94 of SSVOperators.sol)
5. Attempt `executeOperatorFee(O1.id)` — should revert

**Assertions:**
- After step 3: all operator fields zeroed (`ethSnapshot.block = 0`, `ethFee = 0`, `ethSnapshot.balance = 0`)
- After step 3: `operatorFeeChangeRequests[O1.id]` has all-zero fields
- Step 5 reverts with `OperatorDoesNotExist()` (checkOwner fails because `snapshot.block == 0 && ethSnapshot.block == 0`)
- Any ETH balance is withdrawn to owner during removal

**Edge Variations:**
- Remove operator with active validators (`ethValidatorCount > 0`) — removal still succeeds, snapshot settled, balance paid out
- Remove operator with pending reduce (reduce already clears request, so removal just zeros state)
- Re-register operator after removal, then declare — fresh state, no leftover request

---

### OF-033: Execute Fee When DAO Lowers `operatorMaxFee` Between Declare and Execute

**Preconditions:**
- Operator `O1` with `ethFee = 4_000_000_000`, `ethSnapshot.block > 0`
- `operatorMaxFee = packed(6_000_000_000)` initially
- `operatorMaxFeeIncrease = 1000` (10%)
- Declared fee: `4_400_000_000` (10% increase, within both limits)
- `declareOperatorFeePeriod = 86400`, `executeOperatorFeePeriod = 86400`

**Action Sequence:**
1. `declareOperatorFee(O1.id, 4_400_000_000)` at time `T0` — succeeds (4.4 gwei < 6 gwei max)
2. DAO calls `updateMaximumOperatorFee(4_000_000_000)` — lowers max to 4 gwei
3. Advance time to `T0 + 86400` (approval window opens)
4. `executeOperatorFee(O1.id)` — declared fee 4.4 gwei > new max 4 gwei

**Assertions:**
- Step 4 reverts with `FeeTooHigh()`
- `O1.ethFee` unchanged at `packed(4_000_000_000)`
- `operatorFeeChangeRequests[O1.id]` still exists (stale request, must be cancelled or overwritten)
- Operator can `cancelDeclaredOperatorFee` and declare a new compliant fee

**Edge Variations:**
- DAO raises `operatorMaxFee` back above declared fee before operator retries → execute succeeds
- DAO lowers `operatorMaxFee` below current operator fee — existing fee is grandfathered, but no increase possible

---

### OF-034: Fee Change Interaction with Liquidation Threshold

**Preconditions:**
- Cluster `C1` with operators `[O1, O2, O3, O4]`, `validatorCount = 10`, `active = true`
- All operators have `ethFee = 1_000_000_000` (1 gwei each)
- Network fee: `500_000_000` (0.5 gwei)
- Total burn rate per block per vUnit: `4 * 1 gwei + 0.5 gwei = 4.5 gwei` (packed: `4 * 10 + 5 = 45`)
- Cluster balance: just above liquidation threshold for current burn rate
- `minimumBlocksBeforeLiquidation = 21_480` blocks
- All implicit EB: `vUnits = 10 * 10_000 = 100_000`
- Liquidation threshold = `21_480 * 45 * 100_000 / 10_000 = 9_666_000` packed = `966_600_000_000` wei

**Action Sequence:**
1. Cluster balance is `970_000_000_000` wei (~3.4B wei above threshold)
2. `O1` declares fee increase to `2_000_000_000` (doubles fee)
3. Wait and execute `O1` fee change
4. New burn rate: `(10 + 10 + 10 + 20 + 5) * 100_000 / 10_000 = 55 * 10 = 550` per block
5. New liquidation threshold = `21_480 * 55 * 100_000 / 10_000 = 11_814_000` packed = `1_181_400_000_000` wei
6. Call `isLiquidatable(C1)` — cluster is now below threshold

**Assertions:**
- Before fee change: `isLiquidatable(C1) == false`
- After fee change: `isLiquidatable(C1) == true` (balance < new threshold)
- Cluster can be liquidated by anyone after fee increase
- Note: fee change itself does NOT auto-liquidate — it only changes operator state. Liquidation is a separate call.

**Edge Variations:**
- Fee increase makes cluster exactly at threshold boundary (not liquidatable due to `>=`)
- Multiple operators increase fees simultaneously, compounding the burn rate increase
- Fee reduce brings cluster back from liquidatable to solvent

---

### OF-035: Legacy SSV Operator — `ensureETHDefaults` on First Declare

**Preconditions:**
- Legacy operator `O1`: `fee (SSV) = packed_ssv(5_000_000)` (non-zero SSV fee), `ethFee = 0`, `ethSnapshot.block = 0`
- Operator was registered pre-migration, never interacted with ETH fee system
- `DEFAULT_OPERATOR_ETH_FEE = 1_778_800_000` (from SSVCoreTypes.sol)
- `operatorMaxFeeIncrease = 1000`, `minimumOperatorEthFee < 2_000_000_000`, `operatorMaxFee > 2_000_000_000`
- Caller is `O1.owner`

**Action Sequence:**
1. `declareOperatorFee(O1.id, 2_000_000_000)` — triggers `ensureETHDefaults` because `ethSnapshot.block == 0`
2. `ensureETHDefaults` checks: `ethFee == 0 && SSV fee > 0` → true
3. Sets `ethSnapshot.block = block.number`, `ethFee = DEFAULT_OPERATOR_ETH_FEE`
4. Emits `OperatorFeeExecuted(owner, O1.id, block.number, DEFAULT_OPERATOR_ETH_FEE)`
5. Then `declareOperatorFee` continues: checks increase limit against `DEFAULT_OPERATOR_ETH_FEE` (not zero)
6. `maxAllowedFee = packed(DEFAULT_OPERATOR_ETH_FEE) * (10_000 + 1000) / 10_000` → ~10% above default
7. If `2_000_000_000 > maxAllowedFee`, revert with `FeeExceedsIncreaseLimit`

**Assertions:**
- Two events emitted in sequence: `OperatorFeeExecuted` (default assignment) then `OperatorFeeDeclared`
- Increase limit is checked against `DEFAULT_OPERATOR_ETH_FEE`, NOT against zero
- `ethSnapshot.block` is now `> 0` — subsequent calls skip `ensureETHDefaults`
- If declared fee exceeds 10% of default, entire transaction reverts (including the default assignment — it's atomic)

**Edge Variations:**
- Legacy operator with `SSV fee == 0`: no default assigned, `ethFee` stays 0, declare reverts with `FeeIncreaseNotAllowed`
- Declare fee equal to `DEFAULT_OPERATOR_ETH_FEE`: reverts with `SameFeeChangeNotAllowed`
- Declare fee below `DEFAULT_OPERATOR_ETH_FEE`: this is a decrease, not covered by `declareOperatorFee` (use `reduceOperatorFee` instead — but the code path would check `shrunkFee.raw() != 0 && operatorFee.raw() == 0 && operatorSSVFee.raw() == 0` which is false because `operatorFee` is now default, so it falls through to the increase limit check)

---

### OF-039: Sequential Fee Changes — Two Full Declare→Execute Cycles

**Preconditions:**
- Operator `O1` with `ethFee = 1_000_000_000`, `ethValidatorCount = 5`, `ethSnapshot.block = B0`, `ethSnapshot.balance = 0`
- Implicit EB only: `effectiveVUnits = 5 * 10_000 = 50_000`
- `operatorMaxFeeIncrease = 1000` (10%)
- `declareOperatorFeePeriod = 3600`, `executeOperatorFeePeriod = 3600`

**Action Sequence:**
1. **Cycle 1 — Declare:** `declareOperatorFee(O1.id, 1_100_000_000)` at block `B0`, time `T0`
2. Advance time to `T0 + 3600`, advance blocks to `B0 + 300`
3. **Cycle 1 — Execute:** `executeOperatorFee(O1.id)` at block `B1 = B0 + 300`
   - Snapshot settles: `blockDiffEthFee = 300 * 10 = 3000`, `delta = 3000 * 50_000 / 10_000 = 15_000`
   - `ethSnapshot.balance = packed(15_000)`, `ethFee = packed(1_100_000_000)`
4. **Cycle 2 — Declare:** `declareOperatorFee(O1.id, 1_200_000_000)` at block `B2 = B1 + 100`, time `T1`
   - No snapshot update on declare (declare doesn't call `updateSnapshotSt`)
5. Advance time to `T1 + 3600`, advance blocks to `B2 + 300 = B1 + 400`
6. **Cycle 2 — Execute:** `executeOperatorFee(O1.id)` at block `B3 = B1 + 400`
   - Snapshot settles from `B1`: `blockDiffEthFee = 400 * 11 = 4400` (fee is now 11 packed units)
   - `delta = 4400 * 50_000 / 10_000 = 22_000`
   - `ethSnapshot.balance = packed(15_000 + 22_000) = packed(37_000)`
   - `ethFee = packed(1_200_000_000)`

**Assertions:**
- After cycle 1: `ethFee == packed(1_100_000_000)`, `ethSnapshot.balance == packed(15_000)`
- After cycle 2: `ethFee == packed(1_200_000_000)`, `ethSnapshot.balance == packed(37_000)`
- Cumulative balance = `(15_000 + 22_000) * 100_000 = 3_700_000_000` wei total earnings
- Each cycle settles independently — no double-counting or gap
- Second declare's increase limit checked against `1_100_000_000` (the intermediate fee), not `1_000_000_000`

**Edge Variations:**
- Second cycle declares decrease (use `reduceOperatorFee` instead for immediate effect)
- Validators added/removed between cycles — `ethValidatorCount` changes affect settlement amounts
- Withdraw earnings between cycles — balance resets, new cycle starts fresh

---

## Audit Gaps (Added post-audit)

> Identified by code-level branch analysis. These scenarios cover branches and edge conditions not addressed by the original OF-001 through OF-040 set.

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| OF-041 | declareOperatorFee | Declare fee on non-existent operator (never registered or already removed) — revert `OperatorDoesNotExist` via `checkOwner` | `entry:declareOperatorFee; revert:yes` | [ ] | SSVOperators.sol:111, OperatorLib.sol:111-116 |
| OF-042 | executeOperatorFee | Execute fee on non-existent operator — revert `OperatorDoesNotExist` via `checkOwner` | `entry:executeOperatorFee; revert:yes` | [ ] | SSVOperators.sol:148, OperatorLib.sol:111-116 |
| OF-043 | cancelDeclaredOperatorFee | Cancel declared fee on non-existent operator — revert `OperatorDoesNotExist` via `checkOwner` | `entry:cancelDeclaredOperatorFee; revert:yes` | [ ] | SSVOperators.sol:180, OperatorLib.sol:111-116 |
| OF-044 | reduceOperatorFee | Reduce fee on non-existent operator — revert `OperatorDoesNotExist` via `checkOwner` | `entry:reduceOperatorFee; revert:yes` | [ ] | SSVOperators.sol:194, OperatorLib.sol:111-116 |
| OF-045 | declareOperatorFee | Declare fee with value causing `MaxValueExceeded` from `pack()` — fee exceeds uint64 max after packing | `entry:declareOperatorFee; revert:yes` | [ ] | SSVPackedLib.sol:10 |
| OF-046 | declareOperatorFee | Declare fee=0 on operator with non-zero fee — valid decrease-to-zero via the declare path (not `reduceOperatorFee`). Verify declare succeeds, pending request stored with fee=0. | `entry:declareOperatorFee; revert:no` | [ ] | SSVOperators.sol:109-139 |
| OF-047 | executeOperatorFee | DAO raises `minimumOperatorEthFee` between declare and execute — execute succeeds even though the declared fee is now below the new minimum (no re-check at line 164). Documents asymmetry with registration. | `entry:executeOperatorFee; revert:no` | [ ] | SSVOperators.sol:164 |
| OF-048 | reduceOperatorFee | Reduce fee with fee == currentFee — reverts `FeeIncreaseNotAllowed` (not `SameFeeChangeNotAllowed`). Documents error asymmetry with `declareOperatorFee` which uses `SameFeeChangeNotAllowed` for same-fee. | `entry:reduceOperatorFee; revert:yes` | [ ] | SSVOperators.sol:205 |

---

## ask-codex Review Findings

### Additional Scenarios

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| OF-049 | declareOperatorFee | Declare a fee DECREASE via `declareOperatorFee` (not `reduceOperatorFee`). Timelocked decrease-to-zero path — declare fee=0, wait for approval window, execute. | `entry:declareOperatorFee; revert:no` | [ ] | SSVOperators.sol:124-135, 168 |
| OF-050 | declareOperatorFee+executeOperatorFee | DAO sets `declareOperatorFeePeriod=0` AND `executeOperatorFeePeriod=0` → zero-width approval window. Verify declare+execute in same block succeeds. | `entry:declareOperatorFee; revert:no` | [ ] | SSVOperators.sol:137-138, SSVDAO.sol:85,93 |
| OF-051 | cancelDeclaredOperatorFee | Cancel after approval window expires (expired request). Verify cancel succeeds — no time-window check on cancel. | `entry:cancelDeclaredOperatorFee; revert:no` | [ ] | SSVOperators.sol:182 |
| OF-052 | cancelDeclaredOperatorFee | Cancel while approval window is open. Verify cancel succeeds. | `entry:cancelDeclaredOperatorFee; revert:no` | [ ] | SSVOperators.sol:182 |
| OF-053 | declareOperatorFee | Overwrite pending request while approval window is open. Verify new request overwrites with fresh timestamps. | `entry:declareOperatorFee; revert:no` | [ ] | SSVOperators.sol:135 |
| OF-054 | declareOperatorFee | Overwrite pending request after approval window expires. Verify overwrite succeeds. | `entry:declareOperatorFee; revert:no` | [ ] | SSVOperators.sol:135 |
| OF-055 | declareOperatorFee | DAO raises `minimumOperatorEthFee` between declare and execute — execute succeeds even though declared fee is now below new minimum. Documents no re-check at execute. | `entry:executeOperatorFee; revert:no` | [ ] | SSVOperators.sol:164 |
| OF-056 | declareOperatorFee | DAO changes `operatorMaxFeeIncrease` between declare and execute — execute still uses the originally-validated increase. No re-check at execute time. | `entry:executeOperatorFee; revert:no` | [ ] | SSVOperators.sol:131, 164 |

---

## Coverage Verification (W4)

| ID | Tested | remove_mode | Test File | Notes |
|----|--------|-------------|-----------|-------|
| OF-001 | yes | none | `test/unit/SSVOperators/declareOperatorFee.test.ts` ("Declares operator fee"), `test/unit/SSVOperators/executeOperatorFee.test.ts` ("Executes declared fee"), `test/e2e/operators/operator-lifecycle.test.ts` ("Declares fee, waits, and executes"), `test/integration/SSVNetwork/operators.test.ts` ("Fee change via declare->execute workflow") | Full happy-path: declare within limit, wait, execute. Both unit and e2e |
| OF-002 | yes | none | `test/unit/SSVOperators/declareOperatorFee.test.ts` ("Is reverted with 'FeeExceedsIncreaseLimit'"), `test/e2e/operators/operator-lifecycle.test.ts` ("Fee increase exceeding limit reverts"), `test/integration/SSVNetwork/operators.test.ts` ("reverts at just above max allowed increase") | FeeExceedsIncreaseLimit verified |
| OF-003 | yes | none | `test/unit/SSVOperators/declareOperatorFee.test.ts` ("Is reverted with 'FeeTooHigh'") | Fixture sets tight max fee, FeeTooHigh verified |
| OF-004 | yes | none | `test/unit/SSVOperators/declareOperatorFee.test.ts` ("Is reverted with 'FeeTooLow' when declaring below minimal fee") | Mock sets min fee, fee below min reverts |
| OF-005 | yes | none | `test/unit/SSVOperators/declareOperatorFee.test.ts` ("Is reverted with 'SameFeeChangeNotAllowed'") | Declaring same fee reverts |
| OF-006 | yes | none | `test/unit/SSVOperators/declareOperatorFee.test.ts` ("Is reverted with 'FeeIncreaseNotAllowed' when starting from zero fee"), `test/e2e/operators/operator-lifecycle.test.ts` ("Register with fee=0 succeeds, operator is free forever"), `test/integration/SSVNetwork/operators.test.ts` ("Cannot increase fee from zero") | Zero-fee operator cannot declare increase |
| OF-007 | yes | none | `test/unit/SSVOperators/executeOperatorFee.test.ts` ("Is reverted with 'ApprovalNotWithinTimeframe' when executing too early or too late"), `test/integration/SSVNetwork/operators.test.ts` ("executeOperatorFee reverts before declare period ends") | Execute before approvalBeginTime -> revert |
| OF-008 | yes | none | `test/unit/SSVOperators/executeOperatorFee.test.ts` ("Is reverted with 'ApprovalNotWithinTimeframe'"), `test/e2e/operators/operator-lifecycle.test.ts` ("Execute after approval window expires reverts"), `test/integration/SSVNetwork/operators.test.ts` ("executeOperatorFee reverts after execute period expires") | Execute after approvalEndTime -> revert |
| OF-009 | partial:weak | none | `test/unit/SSVOperators/executeOperatorFee.test.ts` ("Executes declared fee and emits event") | Mines past declare period, executes. Does not test exact boundary second |
| OF-010 | no | none | — | No test verifies execution at exact approvalEndTime second |
| OF-011 | yes | none | `test/unit/SSVOperators/executeOperatorFee.test.ts` ("Is reverted with 'NoFeeDeclared'") | Execute without declaration -> NoFeeDeclared |
| OF-012 | yes | none | `test/unit/SSVOperators/executeOperatorFee.test.ts` ("Is reverted with 'LegacyOperatorFeeDeclarationInvalid'") | Pre-upgrade declaration timestamp -> LegacyOperatorFeeDeclarationInvalid |
| OF-013 | yes | none | `test/unit/SSVOperators/cancelDeclaredOperatorFee.test.ts` ("Cancels declared fee"), `test/e2e/operators/operator-lifecycle.test.ts` ("cancel declared fee clears the request") | Cancel clears request, subsequent execute -> NoFeeDeclared |
| OF-014 | yes | none | `test/unit/SSVOperators/cancelDeclaredOperatorFee.test.ts` ("Is reverted with 'NoFeeDeclared' when canceling without a declaration") | Cancel with no pending -> NoFeeDeclared |
| OF-015 | yes | none | `test/e2e/operators/operator-lifecycle.test.ts` ("Reducing fee clears pending fee change request") | Full cycle: declare, execute first increase, declare second, reduce clears, execute -> NoFeeDeclared |
| OF-016 | no | none | — | No test explicitly overwrites a pending declaration with a second declare and verifies only the second is executable |
| OF-017 | yes | none | `test/unit/SSVOperators/reduceOperatorFee.test.ts` ("Reduces operator fee"), `test/e2e/operators/operator-lifecycle.test.ts` ("Reduces fee immediately"), `test/integration/SSVNetwork/operators.test.ts` ("succeeds reducing to exact minimum fee") | Immediate reduce, OperatorFeeExecuted emitted |
| OF-018 | yes | none | `test/e2e/operators/operator-lifecycle.test.ts` ("Operator can reduce to 0 then cannot increase"), `test/unit/SSVOperators/reduceOperatorFee.test.ts` ("Keeps explicit zero fee after legacy initialization") | Reduce to 0 succeeds, subsequent declare reverts FeeIncreaseNotAllowed |
| OF-019 | yes | none | `test/unit/SSVOperators/reduceOperatorFee.test.ts` ("Is reverted with 'FeeIncreaseNotAllowed' when reducing to the same or higher fee"), `test/e2e/operators/operator-lifecycle.test.ts` ("Reduce to exactly current fee reverts", "Reduce to higher fee reverts") | Same or higher -> FeeIncreaseNotAllowed |
| OF-020 | yes | none | `test/unit/SSVOperators/reduceOperatorFee.test.ts` ("Is reverted with 'FeeTooLow'"), `test/integration/SSVNetwork/operators.test.ts` ("reverts when reducing below minimum fee") | Below minimum non-zero -> FeeTooLow |
| OF-021 | yes | none | `test/unit/SSVOperators/reduceOperatorFee.test.ts` ("Clears pending fee declaration when reducing fee"), `test/e2e/operators/operator-lifecycle.test.ts` ("Reducing fee clears pending fee change request") | Declare then reduce -> request cleared |
| OF-022 | yes | none | `test/e2e/operators/operator-economics.test.ts` ("Verifies continuous fee accrual across fee change boundary"), `test/e2e/operators/operator-lifecycle.test.ts` ("Reduces fee immediately, preserving earnings at old fee"), `test/integration/SSVNetwork/operators.test.ts` ("Fee change via declare->execute workflow") | Active validators: earnings settle at old fee, accrue at new fee. Exact math verified |
| OF-023 | yes | none | `test/unit/SSVClusters/ebWeightedOperatorEarnings.test.ts` ("earnings split correctly at fee change boundary with EB-weighted vUnits") | Explicit EB=64 with fee change mid-accrual; vUnits impact verified with exact math |
| OF-024 | no | none | — | No test specifically reduces fee on operator with explicit EB clusters and verifies EB-weighted settlement |
| OF-025 | yes | real | `test/unit/SSVOperators/removeOperator.test.ts` ("Clears a pending fee change request", "Blocks executeOperatorFee with OperatorDoesNotExist after removal") | Declare -> remove -> request deleted; execute -> OperatorDoesNotExist |
| OF-026 | yes | none | `test/unit/SSVOperators/declareOperatorFee.test.ts` ("Is reverted with 'CallerNotOwnerWithData'") | Non-owner declare -> CallerNotOwnerWithData |
| OF-027 | yes | none | `test/unit/SSVOperators/executeOperatorFee.test.ts` ("Is reverted with 'CallerNotOwnerWithData'") | Non-owner execute -> CallerNotOwnerWithData |
| OF-028 | no | none | — | No explicit test for non-owner cancel. cancelDeclaredOperatorFee.test.ts does not include non-owner test |
| OF-029 | yes | none | `test/unit/SSVOperators/reduceOperatorFee.test.ts` ("Is reverted with 'CallerNotOwnerWithData'") | Non-owner reduce -> CallerNotOwnerWithData |
| OF-030 | yes | none | `test/unit/SSVOperators/declareOperatorFee.test.ts` ("Is reverted with 'MaxPrecisionExceeded'") | Non-aligned fee declared -> MaxPrecisionExceeded |
| OF-031 | yes | none | `test/unit/SSVOperators/reduceOperatorFee.test.ts` ("Is reverted with 'MaxPrecisionExceeded'") | Non-aligned reduce fee -> MaxPrecisionExceeded |
| OF-032 | no | none | — | No test declares fee at exact operatorMaxFee to verify packed representation and no overflow |
| OF-033 | yes | none | `test/unit/SSVOperators/executeOperatorFee.test.ts` ("Is reverted with 'FeeTooHigh' if DAO lowers max fee below declared amount") | DAO lowers max between declare and execute -> FeeTooHigh |
| OF-034 | no | none | — | No test verifies that fee increase makes a cluster cross the liquidation threshold |
| OF-035 | yes | none | `test/unit/SSVOperators/declareOperatorFee.test.ts` ("Emits OperatorFeeExecuted when defaulting legacy SSV operator to ETH fee on declare") | Legacy SSV operator triggers ensureETHDefaults on declare; two events emitted |
| OF-036 | yes | none | `test/unit/SSVOperators/reduceOperatorFee.test.ts` ("Initializes legacy ETH snapshot and reduces fee for SSV legacy operator") | Legacy SSV operator reduce triggers ensureETHDefaults; two OperatorFeeExecuted events verified |
| OF-037 | partial:weak | none | `test/unit/SSVOperators/declareOperatorFee.test.ts` ("Declares operator fee within allowed limits") | Tests 2x fee (which may be at limit), but does not specifically test exact boundary math |
| OF-038 | partial:weak | none | `test/unit/SSVOperators/declareOperatorFee.test.ts` ("Is reverted with 'FeeExceedsIncreaseLimit'") | Tests 3x (well above limit) but not exactly "1 packed unit above limit" |
| OF-039 | partial:weak | none | `test/e2e/operators/operator-lifecycle.test.ts` ("Reducing fee clears pending fee change request") | Does declare-execute-declare-reduce, but not two full declare-execute cycles in sequence |
| OF-040 | no | none | — | No test changes operator fee while clusters are liquidated and verifies post-reactivation burn rate |
| OF-049 | no | none | — | No test for timelocked decrease-to-zero via declareOperatorFee |
| OF-050 | no | none | — | No test for zero-width approval window |
| OF-051 | no | none | — | No test for cancel after approval window expires |
| OF-052 | partial:weak | none | `test/unit/SSVOperators/cancelDeclaredOperatorFee.test.ts` | Cancel is tested but does not explicitly verify it happens during the approval window |
| OF-053 | no | none | — | No test for overwriting pending request while window is open |
| OF-054 | no | none | — | No test for overwriting pending request after window expires |
| OF-055 | no | none | — | No test for DAO raising minimumOperatorEthFee between declare and execute |
| OF-056 | no | none | — | No test for DAO changing operatorMaxFeeIncrease between declare and execute |
