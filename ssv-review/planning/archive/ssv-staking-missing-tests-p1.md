# P1 — Correctness (46)

Missing tests for wrong balances, broken lifecycles, and untested state transitions.

---

## SSVClusters (15)

### C-18. EB decrease via `updateClusterBalance` — operator vUnits subtraction [Rank 1]
- **Path:** `_updateOperatorVUnits` — `deltaPositive = false` branch (SSVClusters.sol:500)
- **Test:** Register 1 validator, set EB to 1000 ETH (vUnits=312500). Verify `operatorEthVUnits` = 312500-10000 = 302500 per operator. Set EB to 500 ETH (vUnits=156250) via new root. Verify `operatorEthVUnits` decreased by 156250 (delta = 312500-156250). Verify `daoTotalEthVUnits` also decreased. Verify fee settlement for blocks between updates used OLD vUnits (312500).
- **Risk:** The `deltaPositive = false` branch in `_updateOperatorVUnits` is never exercised. If subtraction underflows or the delta is computed wrong, `operatorEthVUnits` would corrupt all fee calculations for clusters sharing those operators.
- **Severity:** High

### C-19. Two clusters sharing operators, EB update on one doesn't affect other [Rank 2]
- **Path:** `operatorEthVUnits` accumulates per-cluster deviations independently
- **Test:** Owner1 registers cluster A on operators [1,2,3,4] with EB=32 (baseline). Owner2 registers cluster B on same operators with EB=32. Update EB for cluster A to 2048 (deviation=630000). Verify `operatorEthVUnits` increased by 630000 per operator. Verify cluster B's EB snapshot is unchanged. Verify cluster B's liquidation threshold is still based on baseline (1x rate). Liquidate cluster B — verify `operatorEthVUnits` is NOT affected (cluster B had 0 explicit deviation).
- **Risk:** If EB updates on one cluster leak into shared operators' per-cluster accounting, it would silently change burn rates for other cluster owners without their knowledge.
- **Severity:** High

### C-6. Withdraw with EB-aware liquidation threshold (non-baseline vUnits) [Rank 3]
- **Path:** `withdraw()` → inline `isLiquidatableWithEB` check (SSVClusters.sol:241)
- **Test:** Register 1 validator with 100 ETH deposit. Set EB to 2048 (vUnits=640000, 64x). Calculate liquidation threshold at 64x = `minimumBlocksBeforeLiquidation * (totalBurnRate + networkFee) * 640000 / 10000 * 100000`. Attempt to withdraw amount that would leave balance just below this threshold — should revert with `InsufficientBalance`. Withdraw a smaller amount that stays above — should succeed. No existing withdraw test sets non-baseline EB before withdrawing.
- **Risk:** If `withdraw()` doesn't use EB-weighted vUnits for the solvency check, users could withdraw below the safe threshold and their cluster would be immediately liquidatable.
- **Severity:** High

### C-8. Withdraw balance settlement accuracy with high EB (1000 ETH) [Rank 4]
- **Path:** `withdraw()` → `updateClusterData()` → `updateBalanceWithEB()` (SSVClusters.sol:221-229)
- **Test:** Register 1 validator with known deposit. Set EB to 1000 ETH via `updateClusterBalance()`. Mine exactly 500 blocks. Call `withdraw(0)` (triggering fee settlement only). Verify cluster balance was reduced by exactly: `(operatorIndexDelta * vUnits / VUNITS_PRECISION + networkFeeIndexDelta * vUnits / VUNITS_PRECISION) * ETH_DEDUCTED_DIGITS`. Compare against expected value using concrete numbers.
- **Risk:** The `withdraw()` function computes operator and network fee indexes inline — this path is different from `_applyClusterFeeUpdates()`. No test verifies the fee settlement math during withdraw with non-baseline EB.
- **Severity:** Medium

### C-13. Reactivation solvency check uses stored EB vUnits (not baseline) [Rank 5]
- **Path:** `reactivate()` — `effectiveVUnits = vUnitsCluster > 0 ? vUnitsCluster : baselineVUnits` (SSVClusters.sol:146-148)
- **Test:** Register 1 validator, set EB to 1000 ETH (vUnits=312500). Liquidate the cluster. Attempt to reactivate with just enough funds for baseline solvency (1x rate) but NOT enough for stored EB solvency (31.25x rate) — should revert with `InsufficientBalance`. Reactivate with enough funds for 31.25x rate — should succeed. Verify deviation re-added to operators and DAO.
- **Risk:** If reactivation uses baseline instead of stored EB, clusters could be reactivated with insufficient funds and immediately become liquidatable again.
- **Severity:** High

### C-14. Double liquidation/reactivation cycle — accounting drift [Rank 6]
- **Path:** `liquidate` → `reactivate` → `liquidate` → `reactivate` — deviation add/remove cycle
- **Test:** Register 1 validator, set EB to 500 ETH (deviation X). Record operator/DAO vUnits. Cycle 1: liquidate (deviation removed), reactivate with large deposit (deviation re-added). Record vUnits — should match original. Cycle 2: liquidate, reactivate. Record vUnits — should still match. Verify zero drift after 2 full cycles.
- **Risk:** Each cycle adds and subtracts deviation from `operatorEthVUnits` and `daoTotalEthVUnits`. Any rounding inconsistency between the add path (`reactivate`) and remove path (`_executeLiquidation`) would accumulate across cycles, permanently drifting the accounting.
- **Severity:** Medium

### C-9. Liquidation at exact threshold boundary (`balance == threshold`) [Rank 7]
- **Path:** `isLiquidatableWithEB` — `cluster.balance < liquidationThreshold` (strict `<`)
- **Test:** Register 1 validator, set EB to known value (e.g., 64 ETH, vUnits=20000). Calculate exact liquidation threshold. Set cluster balance to EXACTLY this threshold. Third-party liquidation attempt — should revert with `ClusterNotLiquidatable` (balance is NOT less than threshold). Set balance to threshold - 1. Third-party liquidation — should succeed.
- **Risk:** Boundary behavior for the `<` comparison. Off-by-one errors in the threshold formula would incorrectly liquidate (or protect) clusters at the boundary.
- **Severity:** Medium

### C-16. Fee precision with non-divisible vUnits (EB=33, vUnits=10313) [Rank 8]
- **Path:** `_applyClusterFeeUpdates()` — `(idxNet * units) / VUNITS_PRECISION` and `(idxOp * units) / VUNITS_PRECISION`
- **Test:** Register 1 validator, set EB to 33 ETH (vUnits = ceil(33*10000/32) = 10313). Mine 1 block. Trigger fee settlement via `updateClusterBalance()`. Calculate expected fee: `(operatorIndexDelta * 10313) / 10000 * ETH_DEDUCTED_DIGITS + (networkFeeIndexDelta * 10313) / 10000 * ETH_DEDUCTED_DIGITS`. Verify actual balance reduction matches within 1 wei. Note: the separate division means the result may differ from `((idxNet + idxOp) * 10313) / 10000`.
- **Risk:** Rounding in each integer division could systematically under-charge (protocol loses revenue) or over-charge (users lose funds) depending on the direction.
- **Severity:** Medium

### C-11. EB=33 vUnits rounding, then EB decrease to 32 — verify round-trip [Rank 9]
- **Path:** `_updateOperatorVUnits` — increase path then decrease path
- **Test:** Register 1 validator. Set EB to 33 (vUnits=10313). Verify `operatorEthVUnits` = 10313 - 10000 = 313 per operator. Set EB back to 32 via new root (vUnits=10000). Verify `operatorEthVUnits` = 313 - 313 = 0 per operator. Verify `daoTotalEthVUnits` also returns to 0. No rounding drift.
- **Risk:** Ceiling division in `ebToVUnits()` means vUnits for 33 ETH = 10313, not 10312.5. The round-trip (up then down) must produce zero net deviation, otherwise accounting drifts.
- **Severity:** Medium

### C-10. Multi-validator EB at exact baseline (`EB = N * 32`) — no spurious deviation [Rank 10]
- **Path:** `ebToVUnits(N*32)` — ceiling division should yield exact `N * VUNITS_PRECISION`
- **Test:** Register 3 validators (validatorCount=3). Set EB to 96 (= 3 * 32). Verify `ebToVUnits(96) = 30000` exactly. Verify `newVUnits == effectiveOldVUnits` (30000 == 30000). Verify `_updateOperatorVUnits` is NOT called (no deviation). Verify `operatorEthVUnits` unchanged.
- **Risk:** If ceiling division produces 30001 for exact multiples of 32, it creates spurious deviation (1 per operator) that accumulates across all operators silently.
- **Severity:** Low

### C-5. Deposit into liquidated cluster — verify funds recoverable via reactivate [Rank 11]
- **Path:** `deposit()` — no `validateClusterIsNotLiquidated()` check
- **Test:** Register 1 validator, liquidate the cluster. Call `deposit()` with 5 ETH on the liquidated cluster (active=false, balance=0). Verify transaction succeeds. Verify cluster balance is now 5 ETH but `active` is still false. Call `reactivate()` with the correct cluster state (balance=5 ETH, active=false). Verify the 5 ETH is accessible and not permanently locked.
- **Risk:** Users can deposit ETH into a liquidated cluster. If the funds are not recoverable via `reactivate()`, they are permanently locked.
- **Severity:** Medium

### C-7. Withdraw from cluster with 0 validators — should bypass liquidation check [Rank 12]
- **Path:** `withdraw()` — `cluster.active && cluster.validatorCount != 0` guard (SSVClusters.sol:241)
- **Test:** Register 1 validator with 10 ETH deposit. Remove the validator (validatorCount→0, cluster still active with remaining balance). Call `withdraw()` for the full remaining balance. Verify the withdrawal succeeds — the `isLiquidatableWithEB` check is skipped when `validatorCount == 0`.
- **Risk:** A cluster with 0 validators but non-zero balance should allow full withdrawal without solvency checks. If this guard is wrong, leftover funds could be trapped.
- **Severity:** Low

### C-12. `updateClusterBalance()` is permissionless — non-owner can call [Rank 13]
- **Path:** `updateClusterBalance()` — no `msg.sender` restriction
- **Test:** Register a validator as clusterOwner. From a completely different account (otherAccount), call `updateClusterBalance()` with a valid proof. Verify it succeeds. If the EB update triggers auto-liquidation, verify `otherAccount` receives the liquidation balance.
- **Risk:** The function is permissionless by design (oracles or anyone submits proofs). This test confirms the design is intentional and that the liquidation incentive works for third-party submitters.
- **Severity:** Low

### C-15. Migration then SSV entry deletion — old cluster unusable [Rank 14]
- **Path:** `migrateClusterToETH` — `delete s.clusters[hashedCluster]` (SSVClusters.sol:306)
- **Test:** Create SSV cluster. Migrate to ETH. Verify `s.clusters[hashedCluster]` is `bytes32(0)` (deleted). Verify `s.ethClusters[hashedCluster]` is set (new ETH cluster). Attempt to call `liquidateSSV()` on the old cluster ID — should revert with `ClusterDoesNotExist`.
- **Risk:** After migration, the old SSV cluster entry must be fully deleted. If not, someone could interact with both the old SSV cluster and the new ETH cluster simultaneously.
- **Severity:** Medium

### C-17. Auto-liquidation with 0 validators — should not fire [Rank 15]
- **Path:** `_liquidateAfterEBUpdateIfNeeded` — `if (!cluster.active || cluster.validatorCount == 0) return false` (SSVClusters.sol:531)
- **Test:** Register 1 validator, remove it (validatorCount→0, cluster active with remaining balance). Call `updateClusterBalance()` with valid proof. Verify `_liquidateAfterEBUpdateIfNeeded()` returns false. Verify cluster state hash is updated normally (not liquidated).
- **Risk:** A cluster with 0 validators should never be auto-liquidated, even if it has a balance. The EB update should succeed and store new vUnits without triggering the liquidation path.
- **Severity:** Low

---

## SSVValidators (11)

### V-14. DAO validator count tracking through register/remove lifecycle [Rank 1]
- **Path:** `_bulkRegisterValidator` → `updateDAO(true, ...)` and `_bulkRemoveValidator` → `updateDAO(false, ...)`
- **Test:** Verify `ethDaoValidatorCount` starts at 0. Register 3 validators — verify `ethDaoValidatorCount = 3`, `daoTotalEthVUnits = 3 * VUNITS_PRECISION`. Remove 1 — verify `ethDaoValidatorCount = 2`, `daoTotalEthVUnits = 2 * VUNITS_PRECISION`. Remove remaining 2 — verify both return to 0.
- **Risk:** DAO-level counters drive network fee earnings. If these diverge from actual validator count, `networkTotalEarnings()` is wrong, causing staker reward over/under-payment.
- **Severity:** High

### V-15. Operator `ethValidatorCount` tracking through register/remove cycle [Rank 2]
- **Path:** `updateClusterOperatorsOnRegistration` / `updateClusterOperators`
- **Test:** Verify all operators start with `ethValidatorCount = 0`. Register 2 validators — verify each operator has `ethValidatorCount = 2`. Remove 1 — verify `ethValidatorCount = 1`. Register 1 more on SAME operators — verify `ethValidatorCount = 2` again.
- **Risk:** `ethValidatorCount` is the baseline for `effectiveVUnits` in `updateSnapshotSt`, which drives operator earnings. A wrong count means operators earn too much or too little.
- **Severity:** High

### V-5. Registration at exact InsufficientBalance boundary with real fees [Rank 3]
- **Path:** `_bulkRegisterValidator` → `updateClusterOnRegistration` → `isLiquidatableWithEB`
- **Test:** Deploy with operators at non-zero fees. Set `minimumBlocksBeforeLiquidation` and `minimumLiquidationCollateral` to real values. Calculate the exact minimum deposit needed to pass the liquidation check. Register with exactly that amount — should succeed. Register with 1 wei less — should revert with `InsufficientBalance`. All current tests use `DEFAULT_ETH_REGISTER_VALUE = 10 ETH` which far exceeds any threshold.
- **Risk:** The liquidation check during registration uses EB-weighted vUnits. A wrong boundary could prevent legitimate registrations or allow underfunded clusters.
- **Severity:** Medium

### V-10. Remove validator from inactive (liquidated) cluster — skips fee settlement [Rank 4]
- **Path:** `_bulkRemoveValidator` — `if (cluster.active)` guard (SSVValidators.sol:193)
- **Test:** Register 1 validator. Mock-liquidate the cluster (active=false). Remove the validator from the liquidated cluster. Verify removal succeeds without calling `updateClusterOperators` or `updateDAO`. Verify `validatorCount` still decrements. Verify operator `ethValidatorCount` does NOT change (the `if (cluster.active)` block is skipped).
- **Risk:** If this guard fails, removing validators from liquidated clusters could corrupt operator state (decrementing counts that were already zeroed during liquidation).
- **Severity:** Medium

### V-8. Re-register same public key after removal [Rank 5]
- **Path:** `registerPublicKey` → `validatorPKs[hashedPk] != bytes32(0)` check
- **Test:** Register validator with publicKey A. Remove validator with publicKey A (deletes `validatorPKs[hash]`). Re-register with publicKey A (same or different operator set). Verify re-registration succeeds. Verify the validator maps to the new operator set if different.
- **Risk:** This lifecycle (remove then re-add) is common in production. If `validatorPKs` deletion doesn't properly clear state, re-registration could fail or map to stale operator data.
- **Severity:** Medium

### V-6. Operator validator limit reached — `ExceedValidatorLimitWithData` [Rank 6]
- **Path:** `updateClusterOperatorsOnRegistration` → `ExceedValidatorLimitWithData`
- **Test:** Set `validatorsPerOperatorLimit` to 2. Register 2 validators (filling capacity). Attempt to register a 3rd — should revert with `ExceedValidatorLimitWithData` containing the correct operatorId. Verify the returned operatorId is the one that hit the limit.
- **Risk:** The `ExceedValidatorLimitWithData` error path is referenced in code but never tested. This is a critical user-facing limit that prevents operator overload.
- **Severity:** Medium

### V-7. Private operator whitelisting — `CallerNotWhitelistedWithData` [Rank 7]
- **Path:** `updateClusterOperatorsOnRegistration` → `CallerNotWhitelistedWithData`
- **Test:** Mock operators with `setPrivate = true`. Attempt to register a validator from a non-whitelisted address. Verify revert with `CallerNotWhitelistedWithData`.
- **Risk:** The operator whitelisting check is exercised during every registration. No SSVValidator test covers this access control path.
- **Severity:** Medium

### V-9. Register to SSV cluster should revert `IncorrectClusterVersion` [Rank 8]
- **Path:** `_bulkRegisterValidator` → `validateClusterOnRegistration` → `IncorrectClusterVersion` (ClusterLib.sol:204)
- **Test:** Use `mockRegisterSSVValidator` to create an SSV-version cluster (stored in `s.clusters`). Attempt to register a new ETH validator with the same owner+operatorIds. Verify revert with `IncorrectClusterVersion`.
- **Risk:** The code explicitly checks for cross-version registration attempts. This migration guard prevents users from accidentally mixing SSV and ETH validators in the same cluster.
- **Severity:** Low

### V-11. Remove with wrong operator IDs — `IncorrectValidatorStateWithData` [Rank 9]
- **Path:** `_bulkRemoveValidator` → `validateCorrectState`
- **Test:** Register a validator with operators [1,2,3,4]. Attempt to remove it using operators [5,6,7,8]. Verify revert with `IncorrectValidatorStateWithData`. The `validateCorrectState` function hashes operatorIds and compares — a mismatch should revert.
- **Risk:** This is the wrong-cluster-for-validator scenario. Existing tests cover non-existent keys but not keys registered under different operators.
- **Severity:** Low

### V-12. Exit validator after removal — should revert [Rank 10]
- **Path:** `exitValidator` → `validateCorrectState` → `validatorPKs[hash] == bytes32(0)`
- **Test:** Register a validator. Remove it (deletes `validatorPKs[hash]`). Attempt to exit the removed validator. Verify revert with `IncorrectValidatorStateWithData`.
- **Risk:** After removal, exit should fail. This lifecycle scenario (remove then try to exit) is realistic and untested.
- **Severity:** Low

### V-13. Exit from different owner — access control [Rank 11]
- **Path:** `exitValidator` → `keccak256(abi.encodePacked(publicKey, msg.sender))`
- **Test:** Owner A registers a validator. Owner B attempts to exit the same validator public key. Verify revert with `IncorrectValidatorStateWithData`. The exit function hashes `(publicKey, msg.sender)` — different sender produces different hash.
- **Risk:** Access control is implicit (hash includes msg.sender, no explicit onlyOwner). Must verify this implicit mechanism actually works.
- **Severity:** Low

---

## SSVOperators (10)

### O-3. Precision loss in EB-weighted earnings across many blocks [Rank 1]
- **Path:** `OperatorLib.updateSnapshotSt()` line 68: `uint128 delta = (uint128(blockDiffEthFee) * uint128(effectiveVUnits)) / VUNITS_PRECISION`
- **Test:** Set minimum fee (1770_000_000 packed = 17700 raw). Set `ethValidatorCount=1`, `operatorEthVUnits=1` (tiny deviation, effectiveVUnits=10001). Advance 1 block: `delta = 17700 * 10001 / 10000 = 17701` (truncated from 17701.77). Advance 10000 blocks: total delta = 177010000 (truncated). Compare with exact: 177017700. Verify the precision loss magnitude (7700 in 177M = 0.004%) is acceptable.
- **Risk:** Over many blocks, precision loss compounds. With 3000 validators at EB=2048, truncation per-block could matter for operator payouts.
- **Severity:** Medium

### O-6. `removeOperator` with `ethValidatorCount > 0` — final earnings settlement [Rank 2]
- **Path:** `SSVOperators.removeOperator()` → `_resetOperatorState` sets `ethValidatorCount = 0`
- **Test:** Register operator with non-zero fee. Via harness, set `ethValidatorCount = 10`. Mine 100 blocks (earnings should accrue). Remove the operator. Verify: (a) earnings up to removal block are correctly settled and paid out in the ETH transfer, (b) `ethValidatorCount` is reset to 0, (c) `ethSnapshot.block = 0` signals removal.
- **Risk:** Removing an operator with active validators is a realistic production scenario. If the final settlement amount doesn't account for the validators' contribution to earnings, the operator loses revenue.
- **Severity:** High

### O-5. `reduceOperatorFee` — earnings at old rate before, new rate after [Rank 3]
- **Path:** `SSVOperators.reduceOperatorFee()` lines 194-196
- **Test:** Register operator with fee=2X and 1 validator (via mock `ethValidatorCount=1`). Mine 100 blocks. Call `reduceOperatorFee(id, X)`. Verify earnings for the 100 blocks accrued at rate 2X. Mine 100 more blocks. Verify new earnings accrue at rate X. Withdraw all — verify total matches `100*2X + 100*X` (times vUnits arithmetic).
- **Risk:** If the snapshot update before fee change is incorrect, the operator could lose or gain earnings from the transition block. Existing test only checks fee value changes and events, never earnings amounts.
- **Severity:** Medium

### O-9. Reentrancy test for `withdrawAllVersionOperatorEarnings` (dual ETH+SSV transfer) [Rank 4]
- **Path:** `SSVOperators.withdrawAllVersionOperatorEarnings()` lines 236-258
- **Test:** Deploy a malicious contract as operator owner. Give the operator both ETH and SSV earnings. The malicious contract's `receive()` function attempts to call back into `withdrawAllVersionOperatorEarnings` or `withdrawOperatorEarnings`. Verify the `nonReentrant` guard blocks the re-entry. Existing reentrancy tests cover `withdrawOperatorEarnings` and `withdrawOperatorEarningsSSV` but NOT this dual-transfer function.
- **Risk:** `withdrawAllVersionOperatorEarnings` is the only function that performs BOTH ETH and SSV transfers in one call. Reentrancy during the ETH transfer could potentially drain the SSV transfer or vice versa.
- **Severity:** Medium

### O-11. `reduceOperatorFee` to zero is irreversible [Rank 5]
- **Path:** `SSVOperators.reduceOperatorFee()` → `declareOperatorFee` → `FeeIncreaseNotAllowed` when `operatorFee.raw() == 0`
- **Test:** Register operator with minimum fee. Call `reduceOperatorFee(id, 0)`. Verify fee becomes 0. Attempt `declareOperatorFee(id, someAmount)` — should revert with `FeeIncreaseNotAllowed`. The operator can NEVER charge fees again.
- **Risk:** Reducing to zero is an irreversible economic state change. A user calling this accidentally permanently disables their operator's revenue. This footgun should be documented via a test.
- **Severity:** Medium

### O-4. `executeOperatorFee` only updates ETH snapshot, not SSV [Rank 6]
- **Path:** `SSVOperators.executeOperatorFee()` line 158: calls `updateSnapshotSt` (ETH only), not `updateSnapshotsSt` (both)
- **Test:** Operator has both SSV and ETH validators. Execute a fee change. Verify SSV snapshot is NOT updated (block remains old). Mine blocks. Trigger an SSV-related operation. Verify SSV earnings are correctly computed despite the stale SSV snapshot block.
- **Risk:** The SSV snapshot block goes stale during ETH-only fee executions. If SSV earnings depend on the snapshot block being current, they could be miscalculated after a fee change.
- **Severity:** Medium

### O-10. Fee increase limit bypass via compounding (1.1^N) up to `operatorMaxFee` [Rank 7]
- **Path:** `SSVOperators.declareOperatorFee()` — per-declaration limit check
- **Test:** Register operator at fee F. Cycle 1: declare F*1.1 (10% increase at limit), wait, execute. Cycle 2: declare F*1.21, wait, execute. Repeat 5 times. Final fee = F*1.1^5 = ~1.61F. Verify each declaration succeeds. Verify the absolute cap `operatorMaxFee` eventually blocks further increases. Test: declare a fee that passes the 10% check but exceeds `operatorMaxFee` — should revert.
- **Risk:** Operators can compound fee increases exponentially. The test verifies that `operatorMaxFee` provides the absolute ceiling. Without it, an operator could theoretically double fees every cycle.
- **Severity:** Medium

### O-12. `ensureETHDefaults` — migration from SSV-only to ETH billing [Rank 8]
- **Path:** `OperatorLib.ensureETHDefaults()` lines 142-150
- **Test:** Create an operator with `ethSnapshot.block == 0` (never used in ETH path) and `fee != 0` (has SSV fee). Call `declareOperatorFee` — which calls `ensureETHDefaults` at line 108-110. Verify `ethSnapshot.block` is set to current block. Verify `ethFee` is set to `DEFAULT_OPERATOR_ETH_FEE` (1770_000_000), regardless of the existing SSV fee.
- **Risk:** The default fee assignment is hardcoded. If an operator with a very different SSV fee gets this default, the resulting ETH economics could be surprising. This migration path is completely untested.
- **Severity:** Low

### O-7. `withdrawOperatorEarnings(id, 0)` withdraws ALL (not zero) [Rank 9]
- **Path:** `SSVOperators._withdrawOperatorEarnings()` — `amount == 0` enters "withdraw all" path
- **Test:** Register operator, seed earnings of 5 units. Call `withdrawOperatorEarnings(id, 0)`. Verify it withdraws the FULL 5 units (not zero). Verify the balance after is 0. A user calling `withdrawOperatorEarnings(id, 0)` expecting a no-op will instead drain their entire balance.
- **Risk:** Counterintuitive API — `amount=0` means "withdraw everything", not "withdraw nothing". Could cause accidental full withdrawal.
- **Severity:** Low

### O-8. `withdrawAllOperatorEarnings` reverts on zero balance, `withdrawAllVersionOperatorEarnings` doesn't [Rank 10]
- **Path:** `_withdrawOperatorEarnings(id, 0, VERSION_ETH)` reverts with `InsufficientBalance` when balance=0. `withdrawAllVersionOperatorEarnings` silently succeeds.
- **Test:** Register operator with zero earnings. Call `withdrawAllOperatorEarnings(id)` — should revert with `InsufficientBalance`. Call `withdrawAllVersionOperatorEarnings(id)` — should succeed (no-op). Verify the behavioral inconsistency between the two "withdraw all" functions.
- **Risk:** Inconsistent behavior between two similar functions. Users or integrators expecting consistent behavior could have error handling issues.
- **Severity:** Low

---

## SSVDAO + SSVStaking (11)

### D-11. `_syncFees` — fees lost when totalStaked=0 (permanently trapped) [Rank 1]
- **Path:** `_syncFees` (SSVStaking.sol:195-198)
- **Test:** Network has active validators generating network fees. No one has staked SSV yet (cSSV totalSupply=0). Mine 100 blocks — `networkTotalEarnings()` increases. Call `syncFees()`: `newFeesWei` is computed but `accEthPerShare` is NOT updated (division by zero protection). `stakingEthPoolBalance` increases. User stakes SSV, their `userIndex` is set to current `accEthPerShare` (still 0). Call `syncFees()` again — no new fees since last sync. Verify: fees accrued while `totalStaked=0` are trapped in pool but never distributed.
- **Risk:** ETH fees accruing while no one is staked go to the pool balance but are never reflected in `accEthPerShare`, making them permanently unclaimable. This is either WAD or a design issue — test should document the behavior.
- **Severity:** High

### D-12. Multiple stakers — proportional reward distribution with real math [Rank 2]
- **Path:** `_syncFees` + `_settle` + `claimEthRewards`
- **Test:** User A stakes 100 SSV, User B stakes 300 SSV. Network fees accrue (say 1 ETH total). syncFees: `accEthPerShare += (1e18 * PRECISION) / 400`. User A settlement: `pending = 100 * accDelta / PRECISION = 0.25 ETH`. User B settlement: `pending = 300 * accDelta / PRECISION = 0.75 ETH`. Both claim: verify User A gets 0.25 ETH, User B gets 0.75 ETH. Verify pool balance decreases by exactly 1 ETH total. Verify no dust remains.
- **Risk:** The `accEthPerShare` mechanism is the core reward distribution system. No test verifies actual proportional distribution with concrete amounts through the full computation path.
- **Severity:** High

### D-10. `claimEthRewards` after full unstake (cSSV balance=0 but accrued>0) [Rank 3]
- **Path:** `requestUnstake` (settles rewards, burns cSSV) → `claimEthRewards`
- **Test:** User stakes 100 SSV, earns rewards over 100 blocks. Call `requestUnstake(100)` — all cSSV burned, but rewards are settled during `requestUnstake` (line 76-77) so `accrued[user]` has pending rewards. Call `claimEthRewards()` — should succeed because `accrued > 0` even though cSSV balance is 0. Verify the full accrued amount is claimable. Call again — should revert with `NothingToClaim`.
- **Risk:** Users who fully unstake should still be able to claim their accrued ETH rewards. If settlement ordering during `requestUnstake` is wrong, rewards could be lost on unstake.
- **Severity:** High

### D-13. cSSV transfer → claimRewards — rewards follow token holder [Rank 4]
- **Path:** `onCSSVTransfer` + `claimEthRewards`
- **Test:** User A stakes 100 SSV (100 cSSV). Fees accrue for period 1. User A transfers 50 cSSV to User B (triggers `onCSSVTransfer` — settles A at 100 balance, settles B at 0 balance). More fees accrue for period 2. User A claims: gets period-1 rewards (100 cSSV share) + period-2 rewards (50 cSSV share). User B claims: gets period-2 rewards only (50 cSSV share). Verify exact amounts.
- **Risk:** The `onCSSVTransfer` hook ensures rewards are correctly attributed when cSSV tokens change hands. If settlement timing is wrong, rewards could be double-counted or lost during transfers.
- **Severity:** Medium

### D-5. Split oracle voting — different roots for same block [Rank 5]
- **Path:** `commitRoot` — commitment key = `keccak256(abi.encodePacked(merkleRoot, blockNum))`
- **Test:** 4 oracles, quorum 75%. Oracle1 votes for (block100, rootA). Oracle2 votes for (block100, rootB). Oracle3 votes for (block100, rootA). Verify: rootA has accumulated weight from oracle1+oracle3, rootB has weight from oracle2 only. Each root's weight is tracked independently under different commitment keys. With 75% quorum (3 out of 4 needed), neither root reaches quorum with just 2 votes.
- **Risk:** Oracle disagreement is the most realistic adversarial case. If commitment keys aren't properly separated, votes for different roots could cross-contaminate.
- **Severity:** Medium

### D-6. `replaceOracle` mid-voting round — hasVoted tied to oracleId [Rank 6]
- **Path:** `replaceOracle(uint32 oracleId, address newOracle)` then `commitRoot`
- **Test:** 3 oracles, oracle1=addressA at id=1. Oracle1 (addressA) votes for (blockN, rootX) — vote recorded under oracleId=1. DAO calls `replaceOracle(1, addressB)`. AddressB calls `commitRoot(rootX, blockN)` — oracleId lookup returns 1. `hasVoted[commitmentKey][1]` is already TRUE — should revert with `AlreadyVoted`. Verify addressB CAN vote for a DIFFERENT root at the same block (different commitmentKey).
- **Risk:** Oracle replacement during active voting could double-count votes (if hasVoted is not checked) or prevent new oracle from participating. The test confirms hasVoted is tied to oracleId, not address.
- **Severity:** Medium

### D-8. `updateNetworkFee` — earnings settled before fee change [Rank 7]
- **Path:** `ProtocolLib.updateNetworkFee` → `updateDAOEarnings(sp)` first
- **Test:** Set initial network fee, register validators. Mine 100 blocks. Record `networkTotalEarnings`. Update network fee to 2x. Verify `ethDaoBalance` was updated to include earnings from the 100 blocks at old rate. Verify `ethNetworkFeeIndex` was updated. Mine 100 more blocks. Verify new earnings accrue at new rate. Existing test only checks event and stored fee, never the settlement.
- **Risk:** If `updateDAOEarnings` isn't called before the fee change, earnings for the transition period would be calculated at the wrong rate — either lost or inflated.
- **Severity:** Medium

### D-7. `withdrawNetworkSSVEarnings` — dynamic earnings accrual (not mocked) [Rank 8]
- **Path:** `withdrawNetworkSSVEarnings(uint256 amount)` → `networkTotalEarningsSSV()`
- **Test:** Set network fee, register SSV validators so `daoValidatorCount > 0`. Mine N blocks. Call `withdrawNetworkSSVEarnings` with the exact accrued amount. Verify withdrawal succeeds and `daoBalance` resets. Mine more blocks, verify earnings re-accrue from zero. Attempt to withdraw more than newly accrued — verify revert. Existing test only uses mocked `daoBalance` values.
- **Risk:** `networkTotalEarningsSSV()` computes `daoBalance + (blocks * fee * validatorCount)`. If this dynamic computation is wrong, the DAO could withdraw more than available or be unable to withdraw earned fees.
- **Severity:** Medium

### D-14. `withdrawUnlocked` swap-and-pop with interleaved locked/unlocked requests [Rank 9]
- **Path:** `calculateTotalUnfrozenBalance` (SSVStaking.sol:226-241)
- **Test:** User creates 5 unstake requests at times T1-T5. DAO changes cooldown between requests so requests 1, 3, 5 are unlocked but 2 and 4 are NOT. Call `withdrawUnlocked()`. Verify only requests 1, 3, 5 amounts are withdrawn. Verify remaining array contains exactly requests 2 and 4 (order may differ due to swap-and-pop). Verify no request is lost or double-counted.
- **Risk:** The swap-and-pop pattern replaces current element with last element and pops. If the swapped-in element is also unlocked, the while loop must process it (since `i` doesn't increment on removal). Complex iteration with in-place mutation.
- **Severity:** Medium

### D-15. Cooldown duration change between unstake requests [Rank 10]
- **Path:** `requestUnstake` → `block.timestamp + s.cooldownDuration`
- **Test:** Stake 100 SSV. DAO sets cooldownDuration=1 day. Request unstake 50 — unlockTime = now + 1 day. DAO changes cooldownDuration to 7 days. Request unstake 50 — unlockTime = now + 7 days. After 1 day: `withdrawUnlocked()` — only first request (50) withdrawable. After 7 days: second request (50) withdrawable. Each request uses the cooldown active at REQUEST time.
- **Risk:** If unlock time is recalculated at withdrawal time instead of request time, DAO parameter changes could retroactively lock or unlock funds.
- **Severity:** Low

### D-9. `requestUnstake` — MAX_PENDING_REQUESTS + withdrawal + re-stake cycle [Rank 11]
- **Path:** `requestUnstake` → `MAX_PENDING_REQUESTS` check → `withdrawUnlocked` → `stake`
- **Test:** Stake 100 cSSV. Create 10 unstake requests of 10 each (reaching MAX_PENDING_REQUESTS). All cSSV burned. Verify user cannot create more requests. After cooldown, withdraw 5 requests (slot-freeing via swap-and-pop). User stakes 50 more SSV, gets 50 cSSV. Create 5 more unstake requests — should succeed (freed slots).
- **Risk:** The interaction between MAX_PENDING_REQUESTS limit, cSSV burns, and slot freeing after partial withdrawals is a complex lifecycle not tested.
- **Severity:** Low

---

## Cross-Module E2E (9)

### E-8. Operator fee change + EB-weighted burn rate verification [Rank 1]
- **Path:** `SSVOperators.executeOperatorFee` → `SSVClusters.withdraw` (triggers settlement)
- **Test:** Register 4 operators at fee F=1e10. Register cluster, deposit 100 ETH, 1 validator. Update EB to 1000 ETH (31.25x). Mine 100 blocks (burn at F*4*31.25 + networkFee*31.25 per block). Operator 1 declares F*1.1, wait, execute. Mine 100 more blocks. Trigger settlement via withdraw. Verify: first 100 blocks charged at 4*F rate, next 100 blocks charged at 3*F + F*1.1 rate, both multiplied by 31.25x vUnits. Verify operator 1's earnings reflect the fee change.
- **Risk:** Operator fee change does NOT recalculate cluster indexes with EB weighting. Fees are only EB-weighted when cluster data is "touched". A bug here silently over/under-charges clusters.
- **Severity:** High

### E-13. Register validator on EB-tracked cluster — vUnits increment [Rank 2]
- **Path:** `SSVValidators.registerValidator` → `SSVClusters.updateClusterBalance`
- **Test:** Register cluster with 1 validator, deposit 50 ETH. Update EB to 64 ETH (vUnits=20000). Mine 50 blocks. Register 2nd validator. Verify: `ebSnapshot.vUnits` = 20000 + 10000 = 30000 (adds baseline, not EB-weighted). Verify `operatorEthVUnits` unchanged (deviation doesn't change on registration). Fees for blocks 1-50 settled at vUnits=20000. Mine 50 more blocks, remove 2nd validator. Verify `ebSnapshot.vUnits` back to 20000.
- **Risk:** Incorrect vUnits adjustment on register/remove directly affects all cluster owners' burn rates. The design adds/subtracts baseline per validator, not actual per-validator EB.
- **Severity:** High

### E-9. Two clusters update EB in same block on shared operators [Rank 3]
- **Path:** `SSVClusters.updateClusterBalance` × 2 in same block, shared operators
- **Test:** Register operators [1,2,3,4]. User A and User B each register 1 validator on those operators. Oracle commits root. In one block: update EB for cluster A to 1000 ETH, then update EB for cluster B to 500 ETH. Verify: `operatorEthVUnits` = (cluster A deviation) + (cluster B deviation). Each cluster's `_applyClusterFeeUpdates` uses its OWN old vUnits. Operator snapshot is updated between calls (second EB update sees updated indexes from first).
- **Risk:** If the second call doesn't see updated snapshots from the first, fees could be double-counted or under-counted for the shared operators.
- **Severity:** Medium

### E-10. Network fee change + EB-weighted cluster burn rate [Rank 4]
- **Path:** `SSVDAO.updateNetworkFee` → `SSVClusters.withdraw` (settlement)
- **Test:** Register cluster, deposit 50 ETH, 1 validator. Update EB to 512 ETH (16x). Mine 100 blocks at network fee N1. DAO updates network fee to N2=N1*2. Mine 100 blocks at N2. Withdraw (triggers settlement). Verify: network fee for first 100 blocks = `N1 * 100 * vUnits / VUNITS_PRECISION`. For next 100 blocks = `N2 * 100 * vUnits / VUNITS_PRECISION`. Total deducted matches sum.
- **Risk:** Network fee changes update indexes that are later multiplied by vUnits. If the index-based accumulation doesn't interact correctly with EB weighting, high-EB clusters could be under/over-charged.
- **Severity:** Medium

### E-15. Full lifecycle: register→EB→drain→liquidate→reactivate→EB→withdraw [Rank 5]
- **Path:** All modules — SSVValidators, SSVClusters, SSVOperators, SSVDAO
- **Test:** Register 4 operators at fee F. Register cluster with 2 validators, deposit 20 ETH. Update EB to 100 ETH (3.125x). Mine blocks until near liquidation. Third-party liquidates. Verify: balance=0, active=false, EB snapshot preserved, deviation removed. Reactivate with 20 ETH. Verify: deviation restored. Oracle commits new root, update EB to 64 ETH. Verify: deviation adjusted. Mine 100 blocks, verify exact balance decrease. Withdraw half. Verify operator earnings accumulated correctly. Verify invariant: initial deposits = remaining balance + operator earnings + network earnings + liquidator payouts.
- **Risk:** This is the definitive "everything works together" test. No existing test covers the full lifecycle with concrete accounting verification across all modules.
- **Severity:** High

### E-11. Liquidation threshold change makes high-EB cluster liquidatable [Rank 6]
- **Path:** `SSVDAO.updateLiquidationThresholdPeriod` → `SSVClusters.liquidate`
- **Test:** Register cluster, deposit 1 ETH, 1 validator. Update EB to 2048 (64x). Cluster is solvent at threshold T1=21480 blocks. DAO increases threshold to T2=T1*2. Now `balance < T2 * burnRate * vUnits / VUNITS_PRECISION * ETH_DEDUCTED_DIGITS`. Third party liquidates — should succeed. Reverse test: DAO reduces threshold — verify cluster is NOT liquidatable at the lower threshold.
- **Risk:** The liquidation threshold is multiplied by vUnits in `isLiquidatableWithEB`. High-EB clusters are much more sensitive to threshold changes. A DAO governance action could accidentally trigger liquidation cascades.
- **Severity:** Medium

### E-12. Deposit into liquidated cluster then reactivate with EB deviation [Rank 7]
- **Path:** `SSVClusters.deposit` → `SSVClusters.reactivate`
- **Test:** Register cluster, deposit 10 ETH. Update EB to 100 ETH (3.125x). Self-liquidate. Deposit 5 ETH into the liquidated cluster (succeeds — no `active` check). Verify: cluster state is active=false, balance=5 ETH. Reactivate with 5 ETH additional (total 10 ETH). Verify: reactivation uses stored EB vUnits (3.125x) for solvency check. `operatorEthVUnits` restored. `daoTotalEthVUnits` restored.
- **Risk:** `deposit()` modifies balance without checking `active`. The `reactivate()` function reads the stored EB snapshot. If the deposit put the cluster in a state that reactivation doesn't expect, it could be reactivated inconsistently.
- **Severity:** Medium

### E-14. SSV→ETH migration with pre-existing EB snapshot lifecycle [Rank 8]
- **Path:** `SSVClusters.migrateClusterToETH` → `SSVClusters.updateClusterBalance`
- **Test:** Create SSV cluster with 1 validator. Oracle commits root, update EB to 64 ETH (vUnits=20000). Verify EB snapshot stored but `operatorEthVUnits` NOT updated (SSV clusters only store snapshot). Migrate to ETH, deposit 10 ETH. Verify: `operatorEthVUnits` now has deviation=10000 per operator. `daoTotalEthVUnits` includes deviation. Cluster burns at 2x rate. Mine 100 blocks. Oracle commits new root, update EB to 32 ETH (baseline). Verify: deviation reduced to 0, burn rate back to 1x.
- **Risk:** Migration code handles EB snapshot transfer from SSV to ETH. This is a one-way door. If pre-migration EB data is carried over incorrectly, the cluster's burn rate post-migration would be wrong.
- **Severity:** Medium

### E-16. `withdrawNetworkSSVEarnings` — daoIndexBlockNumber temporal reset [Rank 9]
- **Path:** `SSVDAO.withdrawNetworkSSVEarnings` line 64: `sp.daoIndexBlockNumber = uint32(block.number)`
- **Test:** Set up with accrued DAO earnings across 100 blocks. Withdraw partial amount. Verify `daoIndexBlockNumber` reset to current block. Mine 100 more blocks. Verify new earnings calculated from withdrawal block (not genesis). Withdraw again with newly accrued amount. If `daoIndexBlockNumber` wasn't reset, future calls would double-count the already-withdrawn portion.
- **Risk:** The function manually resets the earnings baseline. Without this reset, `networkTotalEarningsSSV()` would double-count withdrawn earnings.
- **Severity:** Low
