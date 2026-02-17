# DIP-X vs Implementation Review: ETH Payments

**Reviewed by:** Claude Code (automated deep review)
**Date:** 2026-02-17
**DIP Source:** `ssv-review/Internal - [DIP-X] SSV Staking.txt` lines 22-113
**Branch:** `review/dip-eth-payments`

---

## Summary

| Verdict | Count |
|---------|-------|
| MATCH | 11 |
| PARTIAL | 3 |
| MISMATCH | 1 |
| GAP | 2 |
| EXTRA (in code, not in DIP) | 4 |

---

## Detailed Findings

### [ETH-1] "All new clusters will operate with ETH payments"

**DIP Says:** "All new clusters will operate with ETH payments from the outset: Operator fees are paid in ETH, Network fees are paid in ETH, ETH must be deposited upfront to fund the cluster's operational runway"

**Implementation:**
- `SSVValidators.sol:28-41` (`registerValidator`) and `SSVValidators.sol:46-53` (`bulkRegisterValidator`) are both `payable`, accepting ETH via `msg.value`.
- `ClusterLib.sol:193-223` (`validateClusterOnRegistration`) checks `s.ethClusters[hashedCluster]` for existing cluster data. At line 204, if an SSV cluster exists (`clusterDataSSV != bytes32(0)`) but no ETH cluster exists (`clusterData == bytes32(0)`), it reverts with `IncorrectClusterVersion()`. This prevents registering validators into a legacy SSV cluster.
- New clusters are stored in `s.ethClusters[hashedCluster]` at `ClusterLib.sol:270`.
- All fee calculations use ETH types: `OperatorLib.updateClusterOperatorsOnRegistration` reads `operator.ethFee` and `operator.ethSnapshot` (OperatorLib.sol:232-237).
- Network fees use `sp.currentNetworkFeeIndex()` which reads `sp.ethNetworkFee` (ProtocolLib.sol:23-25).
- Liquidation check uses `isLiquidatableWithEB` with ETH parameters (ClusterLib.sol:258-265).

**Verdict:** MATCH

**Details:** Fully implemented. All new cluster creation goes through `registerValidator`/`bulkRegisterValidator`, which enforce ETH-only operation. The `validateClusterOnRegistration` function acts as a gatekeeper that prevents new validator registration into legacy SSV clusters. The balance is denominated in wei (native ETH), operator and network fees are in PackedETH, and the cluster is stored in `ethClusters`.

---

### [ETH-2] "Existing SSV-based clusters... can no longer be maintained through operational changes"

**DIP Says:** "While these clusters may continue running as long as they have sufficient runway, they can no longer be maintained through operational changes."

**Implementation:**
- No `depositSSV` or `reactivateSSV` functions exist in `SSVClusters.sol` for cluster operations.
- `deposit()` at SSVClusters.sol:190-205 enforces `ClusterLib.validateClusterVersion(version, VERSION_ETH)` at line 198.
- `withdraw()` at SSVClusters.sol:210-258 enforces `ClusterLib.validateClusterVersion(version, VERSION_ETH)` at line 214.
- `reactivate()` at SSVClusters.sol:133-185 enforces `ClusterLib.validateClusterVersion(version, VERSION_ETH)` at line 140.
- `liquidate()` at SSVClusters.sol:35-69 enforces `ClusterLib.validateClusterVersion(version, VERSION_ETH)` at line 39.

**Verdict:** MATCH

**Details:** All cluster management operations (deposit, withdraw, reactivate, liquidate for ETH) explicitly check that the cluster is `VERSION_ETH`. Legacy SSV clusters cannot use any of these functions. The only remaining operations for SSV clusters are: `liquidateSSV()` (self-liquidation or third-party liquidation) and `migrateClusterToETH()`.

---

### [ETH-3] "Adding new validators... is no longer supported" (for SSV clusters)

**DIP Says:** "adding new validators, removing existing validators, reactivating liquidated clusters or depositing additional SSV to extend a cluster's runway is no longer supported"

**Implementation:**
1. **Adding validators:** `ClusterLib.validateClusterOnRegistration()` at ClusterLib.sol:204 reverts with `IncorrectClusterVersion()` if the cluster hash exists in `s.clusters` (SSV) but not in `s.ethClusters`.
2. **Removing validators:** `SSVValidators._bulkRemoveValidator()` at SSVValidators.sol:178 enforces `ClusterLib.validateClusterVersion(version, VERSION_ETH)`.
3. **Reactivating:** `SSVClusters.reactivate()` at SSVClusters.sol:140 enforces `VERSION_ETH`.
4. **Depositing SSV:** No `depositSSV` function exists. `deposit()` at SSVClusters.sol:198 enforces `VERSION_ETH`.
5. **Withdrawing SSV cluster balance:** No SSV cluster withdrawal function exists (only `withdraw()` for ETH clusters).

**Verdict:** MATCH

**Details:** All four operations listed in the DIP are correctly blocked for SSV clusters:
- Add validators: blocked by `validateClusterOnRegistration` version check
- Remove validators: blocked by `validateClusterVersion(version, VERSION_ETH)` in `_bulkRemoveValidator`
- Reactivate: blocked by `validateClusterVersion(version, VERSION_ETH)` in `reactivate`
- Deposit SSV: no function exists; ETH `deposit` blocks SSV clusters

**Edge case - SSV cluster balance withdrawal:** The DIP says depositing SSV is blocked, but doesn't explicitly address *withdrawing* SSV from a running cluster. In the implementation, there is no SSV cluster withdrawal function, so the only way to recover SSV balance is via migration (which refunds it) or self-liquidation (which sends it to the liquidator). This is slightly more restrictive than the DIP explicitly states, but aligns with the intent of forcing migration.

---

### [ETH-4] "Migration is a one-way process"

**DIP Says:** "Migration is a one-way process - once a cluster is migrated to ETH payments, it cannot revert back to SSV-based payments."

**Implementation:**
- `SSVClusters.migrateClusterToETH()` at SSVClusters.sol:264-345:
  - Line 269: Validates the cluster is `VERSION_SSV` via `ClusterLib.validateClusterVersion(version, VERSION_SSV)`.
  - Line 306: Stores cluster in `s.ethClusters[hashedCluster]`.
  - Line 307: Deletes from `s.clusters[hashedCluster]` via `delete`.
  - No reverse migration function exists anywhere in the codebase.

**Verdict:** MATCH

**Details:** The migration atomically moves the cluster from `s.clusters` to `s.ethClusters` and deletes the old entry. There is no function to move a cluster back from `ethClusters` to `clusters`. Once migrated, all version checks will detect the cluster as `VERSION_ETH` (ClusterLib.sol:337-339), and `migrateClusterToETH` itself checks `VERSION_SSV` (line 269), so attempting to re-migrate would fail.

**Migration mechanics verified:**
1. SSV balance is computed and refunded to owner (lines 281-282, 340-342) via `CoreLib.transferTokenBalance`.
2. ETH is deposited via `msg.value` (line 284).
3. Cluster is reactivated (`cluster.active = true`, line 285) even if it was liquidated.
4. Operator SSV validator counts are decremented and ETH validator counts incremented (OperatorLib.updateClusterOperatorsMigration, line 273).
5. DAO accounting transitions from SSV to ETH (lines 289-292).
6. Liquidation check performed on new ETH cluster (lines 294-304).

---

### [ETH-5] "Operators with a 0 SSV fee default to a 0 ETH fee"

**DIP Says:** "Operators with a 0 SSV fee default to a 0 ETH fee"

**Implementation:**
- `OperatorLib.ensureETHDefaults()` at OperatorLib.sol:142-150:
  ```solidity
  function ensureETHDefaults(ISSVNetworkCore.Operator storage operator) internal {
      if (operator.ethSnapshot.block == 0) {
          operator.ethSnapshot.block = uint32(block.number);
          operator.ethSnapshot.balance = PACKED_ETH_ZERO;
      }
      if (operator.ethFee.eq(PACKED_ETH_ZERO) && operator.fee.neq(PACKED_SSV_ZERO)) {
          operator.ethFee = defaultOperatorEthFee();
      }
  }
  ```
- The condition at line 147: `operator.ethFee.eq(PACKED_ETH_ZERO) && operator.fee.neq(PACKED_SSV_ZERO)` means:
  - If SSV fee is zero (`operator.fee == PACKED_SSV_ZERO`), the condition is false, so `ethFee` stays at `PACKED_ETH_ZERO` (0).
  - This correctly implements "0 SSV fee -> 0 ETH fee".

**Verdict:** MATCH

**Details:** The logic is correct. An operator with `fee == 0` (SSV) will not have `ensureETHDefaults` set a non-zero `ethFee`. The ETH fee remains at zero.

---

### [ETH-6] "Operators with a non-zero SSV fee default to a network-defined ETH fee"

**DIP Says:** "Operators with a non-zero SSV fee default to a network-defined ETH fee"

**Implementation:**
- Same function `OperatorLib.ensureETHDefaults()` at OperatorLib.sol:147-149:
  - If `ethFee == 0` AND `fee != 0` (non-zero SSV fee), then `ethFee = defaultOperatorEthFee()`.
  - `defaultOperatorEthFee()` at OperatorLib.sol:123-125 returns `PackedETHLib.pack(DEFAULT_OPERATOR_ETH_FEE)`.
  - `DEFAULT_OPERATOR_ETH_FEE = 1770_000_000` (defined in SSVCoreTypes.sol:14).

**Verdict:** MATCH

**Details:** Non-zero SSV operators correctly get the default ETH fee assigned. The `ensureETHDefaults` function is called during:
1. Validator registration: `OperatorLib.updateClusterOperatorsOnRegistration()` at line 201.
2. Migration: `OperatorLib.updateClusterOperatorsMigration()` at line 395.
3. Fee declaration: `SSVOperators.declareOperatorFee()` at line 109.

This covers all entry points where an operator would first interact with the ETH system.

---

### [ETH-7] Default ETH fee = 0.000000001775464912 ETH/block

**DIP Says:** "0.000000001775464912 ETH (0.00464 ETH - annual)"

**Implementation:**
- `SSVCoreTypes.sol:14`: `DEFAULT_OPERATOR_ETH_FEE = 1770_000_000` (1,770,000,000 wei = 1.77 gwei)
- DIP specifies: 1,775,464,912 wei = 1.775464912 gwei

**Verdict:** MISMATCH

**Details:** The implementation uses a rounded value (1.77 gwei) vs the DIP's precise value (1.775464912 gwei).

- **Per-block difference:** 5,464,912 wei (~0.31% shortfall)
- **Annual impact per validator:** ~0.0000143 ETH less than DIP target
  - DIP: 1,775,464,912 * 2,614,900 blocks/year = ~0.004643 ETH/year
  - Code: 1,770,000,000 * 2,614,900 blocks/year = ~0.004628 ETH/year
- **Reason:** The packed ETH type requires divisibility by `ETH_DEDUCTED_DIGITS = 100,000`. The DIP value `1,775,464,912` is NOT divisible by 100,000 (`1,775,464,912 % 100,000 = 64,912`), so it would revert with `MaxPrecisionExceeded`. The closest packable value is `1,775,400,000` (rounding down) or `1,775,500,000` (rounding up). The implementation chose `1,770,000,000` which is a cleaner number but further from the spec.

**Recommendation:** Consider using `1_775_500_000` (the closest packable value rounding up) to more closely match the DIP specification. The current value under-delivers by about 0.31% on the stated fee. Alternatively, the DIP should be updated to note the rounded value.

---

### [ETH-8] New operators onboard directly with ETH-denominated fees

**DIP Says:** "New operators onboard directly with ETH-denominated fees. From launch onward, operators registering in the network will not be able to define or configure fees in SSV, and will operate exclusively under the ETH payment model."

**Implementation:**
- `SSVOperators.registerOperator()` at SSVOperators.sol:31-68:
  - Line 56: `op.ethFee = PackedETHLib.pack(fee)` — fee is set as ETH.
  - Lines 38-43: Fee validation against `sp.minimumOperatorEthFee` and `sp.operatorMaxFee` (both ETH).
  - Line 59-60: Both `op.snapshot.block` and `op.ethSnapshot.block` are set to current block.
  - No SSV fee (`op.fee`) is set — it defaults to `PACKED_SSV_ZERO`.

**Verdict:** MATCH

**Details:** New operators register with ETH fees exclusively. The `fee` parameter in `registerOperator` is treated as ETH (validated against ETH bounds, packed as PackedETH). The SSV fee field is never populated for new operators, ensuring they operate exclusively under the ETH model.

---

### [ETH-9] Existing operators SSV fee cannot be modified

**DIP Says:** "operators are no longer able to modify or adjust their SSV fee configuration. Accrued fees can still be withdrawn."

**Implementation:**
- `SSVOperators.declareOperatorFee()` at SSVOperators.sol:100-132: The fee change request stores `PackedETH.unwrap(shrunkFee)` (line 127), and `executeOperatorFee()` at line 159 sets `operator.ethFee`. Both functions operate only on `ethFee`, not `fee` (SSV).
- `SSVOperators.reduceOperatorFee()` at SSVOperators.sol:183-201: Operates on `operator.ethFee` only (line 192, 195).
- No function exists to modify `operator.fee` (SSV fee) after registration.
- `SSVOperators.withdrawOperatorEarningsSSV()` at SSVOperators.sol:263-265 and `withdrawAllOperatorEarningsSSV()` at lines 270-272: Allow withdrawing accrued SSV earnings.

**Verdict:** MATCH

**Details:** All fee modification functions (`declareOperatorFee`, `executeOperatorFee`, `reduceOperatorFee`, `cancelDeclaredOperatorFee`) exclusively modify `ethFee`. There is no mechanism to change the legacy `fee` (SSV) field. SSV earnings withdrawal is preserved via dedicated `withdrawOperatorEarningsSSV` and `withdrawAllOperatorEarningsSSV` functions.

---

### [ETH-10] Governance Parameter: ethNetworkFee

**DIP Says:** "ethNetworkFee: Protocol network fee charged in ETH. Update function: updateNetworkFee(uint256 fee). Initial Value: 0.000000003550929823 ETH (0.00928 ETH - annual)"

**Implementation:**
- `SSVDAO.updateNetworkFee()` at SSVDAO.sol:30-36: Updates `sp.ethNetworkFee` via `sp.updateNetworkFee(fee)`.
- `ProtocolLib.updateNetworkFee()` at ProtocolLib.sol:41-47: Correctly settles DAO earnings, updates the fee index, and stores the new fee.
- The function signature matches: `updateNetworkFee(uint256 fee)`.
- Initial value is set at deployment/upgrade time, not hardcoded in the contract.

**Verdict:** PARTIAL

**Details:** The update function exists and matches the DIP signature. However:
1. The DIP-specified value `0.000000003550929823 ETH` = 3,550,929,823 wei. Checking packability: `3,550,929,823 % 100,000 = 29,823`. This is NOT divisible by `ETH_DEDUCTED_DIGITS (100,000)`, so the exact DIP value cannot be stored. The closest packable values are `3,550,900,000` or `3,551,000,000`.
2. The initial value is not hardcoded in the contract but rather set during deployment. The contract itself has no validation that this specific initial value is used — it's a governance responsibility.
3. There is no access control in the `SSVDAO.updateNetworkFee()` function itself, but this function is called via `delegatecall` from `SSVNetwork.sol` which enforces `onlyOwner` at the proxy level.

---

### [ETH-11] Governance Parameter: minimumLiquidationCollateral

**DIP Says:** "minimumLiquidationCollateral: Minimum ETH collateral an ETH-denominated cluster must maintain. Update function: updateMinimumLiquidationCollateral(uint256 amount). Initial Value: 0.00094 ETH"

**Implementation:**
- `SSVDAO.updateMinimumLiquidationCollateral()` at SSVDAO.sol:122-125: `SSVStorageProtocol.load().minimumLiquidationCollateral = PackedETHLib.pack(amount)`.
- Used in liquidation checks: `ClusterLib.isLiquidatableWithEB()` at ClusterLib.sol:76: `cluster.balance < PackedETHLib.unpack(minimumLiquidationCollateral)`.
- Function signature matches: `updateMinimumLiquidationCollateral(uint256 amount)`.
- DIP value: `0.00094 ETH = 940,000,000,000,000 wei`. Packability: `940,000,000,000,000 % 100,000 = 0`. Packable.

**Verdict:** MATCH

**Details:** Function exists with correct signature. The DIP value is packable and can be set correctly. The function correctly packs the value using `PackedETHLib.pack()`. The value is correctly used in the liquidation check as a minimum balance threshold.

---

### [ETH-12] Governance Parameter: minimumBlocksBeforeLiquidation

**DIP Says:** "minimumBlocksBeforeLiquidation: Minimum number of blocks an ETH-denominated cluster must maintain sufficient balance before becoming eligible for liquidation. Update function: updateLiquidationThresholdPeriod(uint64 blocks). Initial Value: 50190 (7 days)"

**Implementation:**
- `SSVDAO.updateLiquidationThresholdPeriod()` at SSVDAO.sol:98-105:
  ```solidity
  function updateLiquidationThresholdPeriod(uint64 blocks) external override {
      if (blocks < MINIMAL_LIQUIDATION_THRESHOLD) {
          revert NewBlockPeriodIsBelowMinimum();
      }
      SSVStorageProtocol.load().minimumBlocksBeforeLiquidation = blocks;
  }
  ```
- `MINIMAL_LIQUIDATION_THRESHOLD = 21_480` (SSVDAO.sol:19).
- Function signature matches: `updateLiquidationThresholdPeriod(uint64 blocks)`.
- DIP value 50,190 > 21,480, so it can be set.

**Verdict:** MATCH

**Details:** The function exists with the correct signature and parameter type. The minimum threshold check (21,480 blocks) is a safety floor that permits the proposed 50,190 value. The value is stored as a plain `uint64` (not packed), so there's no precision loss.

---

### [ETH-13] Governance Parameter: operatorMaxFee

**DIP Says:** "operatorMaxFee: Maximum operator fee cap, setting a technical upper bound on operator fees denominated in ETH. Update function: updateMaximumOperatorFee(uint64 maxFee). This parameter exists as a protocol safety constraint."

**Implementation:**
- `SSVDAO.updateMaximumOperatorFee()` at SSVDAO.sol:138-141: `SSVStorageProtocol.load().operatorMaxFee = PackedETHLib.pack(maxFee)`.
- Used in: `SSVOperators.registerOperator()` line 41-43, `declareOperatorFee()` line 107, `executeOperatorFee()` line 155.
- **Function signature discrepancy:** DIP says `updateMaximumOperatorFee(uint64 maxFee)` but implementation uses `updateMaximumOperatorFee(uint256 maxFee)` (SSVDAO.sol:138).

**Verdict:** PARTIAL

**Details:** The function exists and works correctly, but the parameter type differs from the DIP specification. The DIP says `uint64 maxFee` while the implementation uses `uint256 maxFee` (which is then packed into `PackedETH` / `uint64` internally). The `uint256` parameter is actually more user-friendly since users pass the full wei value, and the packing handles the conversion. This is a cosmetic difference in the interface specification, not a functional issue.

---

### [ETH-14] Governance Parameter: defaultOperatorETHFee (not governance-controlled)

**DIP Says:** "defaultOperatorETHFee: Not governance-controlled. The default value is defined in the contract and applied automatically. Value: 0.000000001775464912 ETH (0.00464 ETH - annual)"

**Implementation:**
- `SSVCoreTypes.sol:14`: `DEFAULT_OPERATOR_ETH_FEE = 1770_000_000`
- Applied in `OperatorLib.defaultOperatorEthFee()` at OperatorLib.sol:123-125: `PackedETHLib.pack(DEFAULT_OPERATOR_ETH_FEE)`.
- Used in `OperatorLib.ensureETHDefaults()` at OperatorLib.sol:148.
- Not governance-controlled: Correct, it's a compile-time constant.

**Verdict:** PARTIAL (see [ETH-7] for the value mismatch)

**Details:** The implementation correctly makes this a compile-time constant (not governance-controlled), matching the DIP. However, the actual value is 1,770,000,000 wei vs the DIP's 1,775,464,912 wei (see finding [ETH-7] for full analysis). The DIP value is not packable due to the ETH_DEDUCTED_DIGITS precision constraint.

---

### [ETH-15] SSV cluster self-liquidation preserved

**DIP Says:** "For cluster owners who do not wish to migrate, or are unable to do so, the remaining option is to voluntarily liquidate the cluster. Self-liquidation returns the remaining cluster balance to the owner."

**Implementation:**
- `SSVClusters.liquidateSSV()` at SSVClusters.sol:74-128:
  - Line 82: Validates `VERSION_SSV`.
  - Lines 99-100: If `clusterOwner == msg.sender`, the liquidation threshold check is skipped (self-liquidation always succeeds).
  - Lines 113-116: Remaining balance is captured.
  - Line 124: Balance transferred to `msg.sender` (the liquidator) via `CoreLib.transferTokenBalance`.

**Verdict:** MATCH

**Details:** Self-liquidation is fully implemented. When `clusterOwner == msg.sender`, the liquidation bypasses the `isLiquidatable` check (lines 99-109), so the owner can always self-liquidate. The remaining SSV balance is sent to `msg.sender`.

**Important nuance:** The balance goes to `msg.sender` (the liquidator), not explicitly to `clusterOwner`. For self-liquidation these are the same address, but for third-party liquidation, the SSV balance goes to the liquidator, not the cluster owner. This matches the existing SSV liquidation behavior and is consistent with the DIP's statement about self-liquidation specifically.

---

### [ETH-16] Migration refunds remaining SSV balance

**DIP Says:** "any remaining SSV balance is returned to the cluster owner"

**Implementation:**
- `SSVClusters.migrateClusterToETH()` at SSVClusters.sol:281-342:
  - Line 281: `cluster.updateBalanceSSV(clusterIndexSSV, sp.currentNetworkFeeIndexSSV())` — settles outstanding SSV fees.
  - Line 282: `ssvClusterBalance = cluster.balance` — captures remaining SSV balance after fee settlement.
  - Lines 340-342: `CoreLib.transferTokenBalance(msg.sender, ssvClusterBalance)` — transfers SSV tokens to the cluster owner (`msg.sender`).

**Verdict:** MATCH

**Details:** The SSV balance refund is correctly implemented. The function:
1. Settles all outstanding SSV fees (operator + network) up to the current block.
2. Captures the remaining balance.
3. Transfers SSV tokens back to the cluster owner.
4. The `migrateClusterToETH` function can only be called by the cluster owner (since `msg.sender` is used as the owner in `validateHashedCluster` at line 268).

---

### [ETH-17] UPGRADE_TIMESTAMP protection for legacy fee declarations

**DIP Says:** Not explicitly mentioned in ETH Payments section.

**Implementation:**
- `SSVOperators.sol:17`: `uint256 public immutable UPGRADE_TIMESTAMP`
- `SSVOperators.executeOperatorFee()` at SSVOperators.sol:145-147:
  ```solidity
  if (feeChangeRequest.approvalBeginTime <= UPGRADE_TIMESTAMP) {
      revert LegacyOperatorFeeDeclarationInvalid();
  }
  ```

**Verdict:** EXTRA (beneficial)

**Details:** This is a safety mechanism not mentioned in the DIP but critical for the migration. It prevents operators from executing fee change requests that were declared before the upgrade (when fees were denominated in SSV). Without this check, a pre-upgrade SSV fee declaration could be executed post-upgrade and applied as an ETH fee, which would be semantically incorrect and potentially exploitable (SSV-denominated values interpreted as ETH-denominated values).

---

### [ETH-18] Operator fee change constraints (FeeIncreaseNotAllowed for free operators)

**DIP Says:** Not explicitly mentioned (the DIP focuses on default fee assignment, not fee change mechanics).

**Implementation:**
- `SSVOperators.declareOperatorFee()` at SSVOperators.sol:117-119:
  ```solidity
  if (shrunkFee.raw() != 0 && operatorFee.raw() == 0 && operatorSSVFee.raw() == 0) {
      revert FeeIncreaseNotAllowed();
  }
  ```

**Verdict:** EXTRA (important semantic)

**Details:** This prevents an operator that has always been free (0 SSV fee AND 0 ETH fee) from declaring a non-zero ETH fee. This is consistent with the existing SSV protocol rule that free operators cannot start charging. However, note the interaction with `ensureETHDefaults()`: if an operator had a non-zero SSV fee, they get the default ETH fee, and CAN then modify it (subject to percentage limits). If they had a 0 SSV fee, they have a 0 ETH fee and CANNOT increase it. This aligns with the DIP's default fee logic.

---

### [ETH-19] Reentrancy protection

**DIP Says:** Not explicitly mentioned.

**Implementation:** The following functions use `nonReentrant` modifier:
- `SSVClusters.liquidate()` (line 35)
- `SSVClusters.liquidateSSV()` (line 78)
- `SSVClusters.withdraw()` (line 210)
- `SSVClusters.updateClusterBalance()` (line 357)
- `SSVOperators.removeOperator()` (line 73)
- `SSVOperators.withdrawOperatorEarnings()` (line 222)
- `SSVOperators.withdrawAllOperatorEarnings()` (line 229)
- `SSVOperators.withdrawAllVersionOperatorEarnings()` (line 236)
- `SSVOperators.withdrawOperatorEarningsSSV()` (line 263)
- `SSVOperators.withdrawAllOperatorEarningsSSV()` (line 270)

**Not protected (intentionally):**
- `reactivate()` — accepts ETH via `msg.value`, no external calls before state writes
- `deposit()` — accepts ETH via `msg.value`, no external calls before state writes
- `migrateClusterToETH()` — transfers SSV tokens AND ETH, but state is fully written before transfers

**Verdict:** EXTRA (security review item)

**Details:** The reentrancy protection pattern is generally well-applied. However, `migrateClusterToETH` deserves special attention:
- At line 306-307, the new ETH cluster is stored and the old SSV cluster is deleted.
- At line 341, SSV tokens are transferred to the owner.
- The SSV token transfer happens AFTER state changes, following checks-effects-interactions.
- However, if the SSV token has a callback (e.g., ERC-777), the `transferTokenBalance` could trigger a reentrant call. In practice, the SSV token is a standard ERC-20 without callbacks, so this is not exploitable, but it's worth noting that `migrateClusterToETH` lacks the `nonReentrant` modifier despite performing an external token transfer.

---

### [ETH-20] Governance Parameter: operatorMinFee (minimumOperatorEthFee)

**DIP Says:** "operatorMinFee: Minimum operator fee cap for fees denominated in ETH." (No update function or initial value specified in the DIP table — cells appear empty)

**Implementation:**
- `SSVDAO.updateMinimumOperatorEthFee()` at SSVDAO.sol:147-150: Sets `sp.minimumOperatorEthFee`.
- Used in: `SSVOperators.registerOperator()` line 38, `declareOperatorFee()` line 106, `reduceOperatorFee()` line 187.

**Verdict:** GAP

**Details:** The DIP leaves the update function and initial value cells empty/blank for `operatorMinFee`. The implementation provides `updateMinimumOperatorEthFee(uint256 minFee)` as a governance function. This appears to be an intentional omission in the DIP (perhaps to be specified later), but the implementation has gone ahead and implemented it as a governance-controlled parameter. The DIP should be updated to document this.

---

### [ETH-21] Dual withdrawal functions for operator earnings

**DIP Says:** "Accrued fees can still be withdrawn." (referring to SSV operator earnings)

**Implementation:**
- ETH withdrawal: `withdrawOperatorEarnings()`, `withdrawAllOperatorEarnings()` (SSVOperators.sol:222-231)
- SSV withdrawal: `withdrawOperatorEarningsSSV()`, `withdrawAllOperatorEarningsSSV()` (SSVOperators.sol:263-272)
- Combined: `withdrawAllVersionOperatorEarnings()` (SSVOperators.sol:236-258) — withdraws both ETH and SSV in one call.

**Verdict:** MATCH

**Details:** Operators can withdraw both ETH and SSV earnings independently. The combined withdrawal function is a convenience method not mentioned in the DIP but consistent with the intent. The SSV earnings continue to accrue for clusters that haven't migrated, since `updateSnapshotStSSV` (called during migration at OperatorLib.sol:385) settles all accumulated SSV fees up to the migration block.

---

### [ETH-22] Cluster migration handles both active and liquidated SSV clusters

**DIP Says:** "Migration applies at the cluster level, and each cluster can be migrated in a single interaction, which upgrades it to ETH payments immediately."

**Implementation:**
- `SSVClusters.migrateClusterToETH()` at SSVClusters.sol:264-345:
  - Line 270: `bool isLiquidated = !cluster.active` — detects if the SSV cluster was liquidated.
  - Line 285: `cluster.active = true` — always reactivates during migration.
  - Lines 289-291: Only decrements SSV DAO count if the cluster was NOT already liquidated (liquidated clusters already had their counts removed).
  - Line 292: Always increments ETH DAO count.
  - `OperatorLib.updateClusterOperatorsMigration()` at OperatorLib.sol:367-411: Handles operator transitions, only decrementing `validatorCount` (SSV) if not liquidated (line 389-391).

**Verdict:** MATCH

**Details:** The implementation correctly handles both active and liquidated SSV cluster migration. Liquidated clusters are reactivated during migration (they get a fresh ETH balance and new indices). This is a useful feature that allows cluster owners who couldn't top up SSV in time to migrate and continue operating.

---

### [ETH-23] SSV network fee can still be updated

**DIP Says:** Not explicitly mentioned in the ETH Payments section.

**Implementation:**
- `SSVDAO.updateNetworkFeeSSV()` at SSVDAO.sol:41-47: Updates `sp.networkFee` (SSV network fee).
- `SSVDAO.withdrawNetworkSSVEarnings()` at SSVDAO.sol:52-69: Withdraws accumulated SSV network earnings.
- `SSVDAO.updateLiquidationThresholdPeriodSSV()` at SSVDAO.sol:110-117: Updates SSV liquidation threshold.
- `SSVDAO.updateMinimumLiquidationCollateralSSV()` at SSVDAO.sol:130-133: Updates SSV minimum collateral.

**Verdict:** EXTRA (legacy support)

**Details:** The DAO retains full control over SSV-denominated parameters. This is necessary during the transition period while SSV clusters still exist. The SSV network fee continues to accrue for unmigrated clusters, and the DAO can still withdraw those earnings. These functions would become no-ops once all clusters migrate, but they're correctly maintained for backward compatibility.

---

### [ETH-24] ETH liquidation check uses vUnit model with effective balance

**DIP Says:** Not explicitly detailed in the ETH Payments section (this is more of an EB-specific concern, but the liquidation formula is fundamental to ETH payments).

**Implementation:**
- `ClusterLib.isLiquidatableWithEB()` at ClusterLib.sol:67-84:
  ```solidity
  function isLiquidatableWithEB(...) internal view returns (bool liquidatable) {
      if (cluster.validatorCount == 0) return false;
      if (cluster.balance < PackedETHLib.unpack(minimumLiquidationCollateral)) return true;
      uint64 vUnits = getVUnits(clusterId, cluster.validatorCount);
      uint128 units = vUnits;
      uint128 rate = burnRate + networkFee;
      uint256 thresholdUnits = (uint256(minimumBlocksBeforeLiquidation) * rate * units) / VUNITS_PRECISION;
      uint256 liquidationThreshold = thresholdUnits * ETH_DEDUCTED_DIGITS;
      return cluster.balance < liquidationThreshold;
  }
  ```
- Two-tier check: (1) minimum collateral floor, (2) burn-rate-based runway threshold.

**Verdict:** MATCH (with the ETH Payments governance parameters)

**Details:** The liquidation formula correctly scales with effective balance (vUnits). The formula is:
```
liquidationThreshold = minimumBlocksBeforeLiquidation * (burnRate + networkFee) * vUnits / VUNITS_PRECISION * ETH_DEDUCTED_DIGITS
```
This ensures clusters with higher effective balances (more vUnits) need proportionally more runway, which is the correct behavior for the vUnit-based fee model.

---

### [ETH-25] No SSV cluster withdrawal function

**DIP Says:** "depositing additional SSV to extend a cluster's runway is no longer supported"

**Implementation:** There is no `withdrawSSV` cluster function at all. The `withdraw()` function at SSVClusters.sol:210-258 enforces `VERSION_ETH`.

**Verdict:** GAP (minor)

**Details:** While the DIP explicitly blocks SSV deposits, it does not explicitly address SSV cluster balance withdrawal. The implementation goes further and also blocks SSV cluster withdrawal. This means an SSV cluster owner who wants to recover their remaining SSV balance has exactly two options:
1. **Migrate** (`migrateClusterToETH`) — refunds SSV balance and switches to ETH.
2. **Self-liquidate** (`liquidateSSV` where `clusterOwner == msg.sender`) — sends SSV balance to the liquidator (themselves).

Both paths accomplish SSV balance recovery, but there is no direct "just withdraw my SSV" without either migrating or liquidating. This is more restrictive than the DIP requires, but creates a cleaner incentive to migrate. The DIP's statement "the only path forward for maintaining an existing cluster is migration" and "self-liquidation returns the remaining cluster balance to the owner" together imply this behavior is acceptable.

---

## Edge Cases & Best Practices Summary

### 1. Migration Safety
- **One-way enforced:** `delete s.clusters[hashedCluster]` + storing in `s.ethClusters` makes it irreversible.
- **Liquidated cluster migration:** Correctly handles the case where SSV cluster was liquidated (skips SSV DAO count decrement, reactivates cluster).
- **Zero SSV balance migration:** If cluster has zero SSV balance, no token transfer occurs (line 340 check).
- **Reentrancy:** `migrateClusterToETH` lacks `nonReentrant` but follows checks-effects-interactions. The SSV token is ERC-20 (no callbacks), so this is safe in practice but not defense-in-depth.

### 2. Precision & Overflow
- **PackedETH precision:** Values must be divisible by 100,000 (ETH_DEDUCTED_DIGITS). The DIP's specified default fee (1,775,464,912 wei) is NOT packable, forcing rounding.
- **vUnit calculations:** Use `uint128` intermediates to avoid overflow in fee calculations (e.g., ClusterLib.sol:79-82).
- **Balance underflow protection:** `updateBalanceWithEB` at ClusterLib.sol:314 uses `usage > cluster.balance ? 0 : cluster.balance - usage` pattern, preventing underflow.

### 3. Operator Fee Transition
- **UPGRADE_TIMESTAMP guard:** Prevents execution of pre-migration fee declarations as ETH fees.
- **Free operator protection:** Operators with 0 SSV fee get 0 ETH fee and cannot increase it.
- **Fee declaration requires ETH defaults:** `declareOperatorFee` calls `ensureETHDefaults()` if needed (line 108-110), ensuring operators are properly initialized before fee changes.

### 4. Legacy SSV Cluster Operations
- **Still operational:** Clusters run as long as they have runway (no deposits/withdrawals blocked).
- **Can be liquidated:** Third-party and self-liquidation via `liquidateSSV()`.
- **SSV earnings still accrue:** Operator SSV snapshots continue to accumulate for unmigrated clusters.
- **SSV DAO earnings still accrue:** `networkTotalEarningsSSV()` continues to calculate.

---

## Recommendations

1. **[HIGH] Fix DEFAULT_OPERATOR_ETH_FEE value:** Consider `1_775_500_000` instead of `1_770_000_000` to match the DIP more closely (within packing constraints). The current value under-delivers by ~0.31% vs the spec.

2. **[MEDIUM] Add nonReentrant to migrateClusterToETH:** While the SSV token is standard ERC-20, defense-in-depth suggests adding the reentrancy guard since the function performs external token transfers.

3. **[LOW] DIP documentation gap - operatorMinFee:** The DIP leaves update function and initial value blank. Should be documented now that the implementation provides `updateMinimumOperatorEthFee(uint256)`.

4. **[LOW] DIP documentation gap - operatorMaxFee signature:** The DIP specifies `uint64` parameter but implementation uses `uint256`. Should be aligned.

5. **[INFO] DIP-specified ethNetworkFee value is not packable:** The value 3,550,929,823 is not divisible by 100,000. The deployment must use a rounded value. This should be documented.
