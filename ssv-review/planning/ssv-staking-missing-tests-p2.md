# P2 — Edge Cases (19)

Missing tests for boundary conditions, dust handling, and defensive checks.

---

## SSVClusters (6)

### C-21. Liquidation with `minimumLiquidationCollateral` boundary [Rank 1]
- **Path:** `isLiquidatableWithEB` line 76: `cluster.balance < PackedETHLib.unpack(minimumLiquidationCollateral)`
- **Test:** Register 1 validator with exactly `minimumLiquidationCollateral` balance (after fee deduction). Third-party liquidation attempt — should revert (balance NOT less than collateral). Mine 1 block (fees accrue, balance drops below collateral). Third-party liquidation — should succeed.
- **Risk:** The collateral check triggers before the burn-rate threshold check. Boundary behavior at exact collateral value confirms the `<` comparison is correct.
- **Severity:** Low

### C-23. EB=2048 exactly succeeds, EB=2049 reverts `EBExceedsMaximum` [Rank 2]
- **Path:** `_verifyEBLimits` — upper bound check
- **Test:** Register 1 validator. Set EB to exactly 2048 — should succeed. Verify `vUnits = ebToVUnits(2048) = 640000`. Set EB to 2049 — should revert with `EBExceedsMaximum`. Existing test only checks 2049 (exceeds) but NOT that 2048 exactly succeeds.
- **Risk:** Confirms the `>` comparison (not `>=`) in the upper bound check. Off-by-one would reject the maximum valid EB.
- **Severity:** Low

### C-24. EB=64 for 2 validators succeeds, EB=63 reverts `EBBelowMinimum` [Rank 3]
- **Path:** `_verifyEBLimits` — lower bound check
- **Test:** Register 2 validators (validatorCount=2). Set EB to exactly 64 (= 2*32, minimum) — should succeed. Set EB to 63 — should revert with `EBBelowMinimum`. Existing test uses 60 for 2 validators but doesn't verify that exactly 64 succeeds.
- **Risk:** Confirms the `<` comparison in the lower bound check. Off-by-one would reject the minimum valid EB.
- **Severity:** Low

### C-25. `ebToVUnits` / `vUnitsToEB` round-trip consistency [Rank 4]
- **Path:** `ClusterLib.ebToVUnits()` (ceiling division) and `ClusterLib.vUnitsToEB()` (floor division)
- **Test:** For each EB in [32, 33, 64, 100, 1000, 2048]: compute `vUnits = ebToVUnits(eb)`, then `roundTrip = vUnitsToEB(vUnits)`. Verify `roundTrip >= eb` (ceiling means vUnits may round up). Verify `roundTrip - eb <= 1` (error is at most 1 ETH). Special case: `ebToVUnits(0)` returns 0.
- **Risk:** These are inverse operations with different rounding. Verifies the discrepancy is bounded and predictable.
- **Severity:** Low

### C-22. Liquidation when cluster balance is already 0 — no ETH transfer [Rank 5]
- **Path:** `_executeLiquidation` — `if (balanceLiquidatable > 0)` guard before transfer
- **Test:** Register 1 validator with minimal deposit. Mine enough blocks to drain cluster balance to 0 via fee accrual. Call `liquidate()` as owner. Verify transaction succeeds. Verify liquidator receives 0 ETH (no transfer call since `balanceLiquidatable == 0`). Verify no revert on zero-balance liquidation.
- **Risk:** Edge case where the transfer is skipped. Confirms the guard prevents a zero-value ETH transfer (which could behave differently on some contracts).
- **Severity:** Low

### C-20. Deposit with `msg.value = 0` — no revert, no-op [Rank 6]
- **Path:** `deposit()` — no minimum deposit check
- **Test:** Register 1 validator. Call `deposit()` with `msg.value = 0`. Verify transaction succeeds (no revert). Verify cluster balance is unchanged. Verify cluster state hash is updated in storage (even though balance didn't change).
- **Risk:** Zero-value deposits update storage hash, costing gas but doing nothing. Minor gas waste concern.
- **Severity:** Low

---

## SSVValidators (3)

### V-16. `bulkRegisterValidator` with single public key (boundary) [Rank 1]
- **Path:** `bulkRegisterValidator` with arrays of length 1
- **Test:** Call `bulkRegisterValidator` with exactly 1 public key and 1 share. Verify it behaves identically to `registerValidator` — same cluster state, same events. `registerValidator` delegates to `_bulkRegisterValidator` internally, so this confirms the shared path handles the single-item case.
- **Risk:** Boundary condition for the batch path. Ensures no off-by-one in array iteration.
- **Severity:** Low

### V-17. Exit same validator twice — idempotent (no state change) [Rank 2]
- **Path:** `exitValidator` — stateless operation, only checks existence
- **Test:** Register 1 validator. Exit the validator (succeeds, emits `ValidatorExited`). Exit the same validator again — should succeed again (exit doesn't modify state, only emits event). Verify 2 events emitted.
- **Risk:** Exit is a signal to off-chain systems. Calling it twice should be harmless. Important for idempotent retry logic.
- **Severity:** Low

### V-18. `bulkExitValidator` with single key (boundary) [Rank 3]
- **Path:** `bulkExitValidator` with array of length 1
- **Test:** Register 1 validator. Call `bulkExitValidator` with exactly 1 public key. Verify exactly 1 `ValidatorExited` event emitted. Unlike register (which delegates to bulk internally), `exitValidator` and `bulkExitValidator` are separate implementations — behavior consistency should be verified.
- **Risk:** Different code paths for single vs bulk exit could have subtle differences.
- **Severity:** Low

---

## SSVOperators (6)

### O-14. `removeOperator` — pending fee declaration not cleared (stale state) [Rank 1]
- **Path:** `SSVOperators.removeOperator()` → `_resetOperatorState` — does NOT call `delete s.operatorFeeChangeRequests[operatorId]`
- **Test:** Register operator. Declare a fee change. Remove the operator WITHOUT canceling the declaration. Verify `operatorFeeChangeRequests[operatorId]` is NOT cleared. Register a NEW operator (gets new monotonically incrementing ID). Verify the stale request from the old operator is NOT inherited (different ID).
- **Risk:** State pollution — a dangling fee change request exists for a removed operator. Since operator IDs never reuse, it's low impact, but could confuse off-chain indexers.
- **Severity:** Low

### O-18. Multiple concurrent fee declarations — overwrite behavior [Rank 2]
- **Path:** `SSVOperators.declareOperatorFee()` line 126 — writes directly to `operatorFeeChangeRequests`
- **Test:** Declare fee to X. Before executing, declare fee to Y. Verify the second declaration overwrites the first. Verify the new declaration's timing is based on the second call's timestamp. Execute after the second declaration's wait period — verify fee becomes Y (not X).
- **Risk:** An operator changing their mind about a fee increase. The overwrite behavior is implicit and untested. The first declaration is silently discarded.
- **Severity:** Low

### O-13. `ethSnapshot.index` uint64 overflow (far-future) [Rank 3]
- **Path:** `OperatorLib.updateSnapshotSt()` line 66: `operator.ethSnapshot.index += blockDiffEthFee`
- **Test:** With maximum fee raw = 765286500, compute blocks until `ethSnapshot.index` overflows uint64: `type(uint64).max / 765286500 ~ 24 billion blocks`. Verify this is unreachable in practice. Also verify `uint32(block.number)` wrapping behavior — `currentBlock - operator.ethSnapshot.block` could underflow when block.number wraps every ~4.3 billion blocks.
- **Risk:** Far-future architectural concern. The `uint32` block number wrapping is more likely to matter first (in ~1300 years at 1 block/12s).
- **Severity:** Low

### O-15. `declareOperatorFee` for non-existent operator — `OperatorDoesNotExist` [Rank 4]
- **Path:** `SSVOperators.declareOperatorFee()` line 102: `s.operators[operatorId].checkOwner()`
- **Test:** Call `declareOperatorFee(999, someAmount)` where operator 999 was never registered. `checkOwner()` checks `snapshot.block == 0 && ethSnapshot.block == 0` and reverts with `OperatorDoesNotExist`.
- **Risk:** Basic negative testing. `CallerNotOwnerWithData` is tested (operator exists, wrong caller) but `OperatorDoesNotExist` is not tested for declare/execute/cancel/reduce.
- **Severity:** Low

### O-16. `cancelDeclaredOperatorFee` from non-owner — access control [Rank 5]
- **Path:** `SSVOperators.cancelDeclaredOperatorFee()` line 171
- **Test:** Register operator by account A. Declare fee. Call `cancelDeclaredOperatorFee` from account B. Should revert with `CallerNotOwnerWithData`. All other operator functions test the non-owner case, but cancel does not.
- **Risk:** Access control coverage completeness. Every mutating operator function should verify non-owner revert.
- **Severity:** Low

### O-17. `setOperatorsPrivateUnchecked([])` — empty array revert [Rank 6]
- **Path:** `OperatorLib.updatePrivacyStatus()` line 530: `checkOperatorsLength(operatorIds)`
- **Test:** Call `setOperatorsPrivateUnchecked([])` with empty array. Should revert with `InvalidOperatorIdsLength`.
- **Risk:** Input validation completeness.
- **Severity:** Low

---

## SSVDAO + SSVStaking (7)

### D-19. `commitRoot` with quorum=100% — all oracles must agree [Rank 1]
- **Path:** `commitRoot` — threshold = totalSupply when quorum = 10000 bps
- **Test:** 4 oracles, quorum 100% (10000 bps). totalSupply=1000. Each oracle weight = 250. Oracle1 votes: accumulated=250 (<1000). Oracle2: 500. Oracle3: 750. Oracle4: 1000 (>=1000). Verify root committed only after ALL 4 oracles vote. Verify 3 out of 4 is insufficient.
- **Risk:** 100% quorum is the strictest setting. Tests the opposite extreme from the existing 1% quorum test.
- **Severity:** Low

### D-18. `claimEthRewards` dust accumulation from `% ETH_DEDUCTED_DIGITS` [Rank 2]
- **Path:** `claimEthRewards` line 123: `claimable - (claimable % ETH_DEDUCTED_DIGITS)`
- **Test:** User stakes, accrues 199,999 wei rewards (just under 2 * ETH_DEDUCTED_DIGITS). payout = 199,999 - (199,999 % 100,000) = 100,000 wei. Remainder stored: 99,999 wei. More rewards accrue: 1 wei → accrued=100,000. payout=100,000. Repeat many times. Verify dust never permanently exceeds ETH_DEDUCTED_DIGITS-1. Verify total claimed + remaining accrued always equals total rewards earned.
- **Risk:** Up to 99,999 wei per claim is left as dust. The `s.accrued[msg.sender] = claimable - payout` preserves this for next claim. Must verify dust handling works correctly over multiple cycles.
- **Severity:** Low

### D-16. `requestUnstake` — uint192 truncation for very large amounts [Rank 3]
- **Path:** `requestUnstake(uint256 amount)` line 89: `uint192(amount)`
- **Test:** Attempt to unstake an amount > `type(uint192).max`. Verify: either the `uint192(amount)` cast silently truncates (storing wrong amount) or the practical cSSV supply limit prevents this. If truncation is possible, the user would lose funds.
- **Risk:** The `UnstakeRequest` struct uses `uint192` for amount but `requestUnstake` accepts `uint256`. In practice cSSV supply may never reach this, but there's no explicit check.
- **Severity:** Low

### D-22. `_syncFees` idempotency when called twice in same block [Rank 4]
- **Path:** `_syncFees` — sets `sp.ethDaoBalance = current` and `sp.ethDaoIndexBlockNumber = block.number`
- **Test:** Call `syncFees()` in block N. Call `syncFees()` again in same block N. On second call: `networkTotalEarnings()` returns same value (0 blocks elapsed since last sync). Verify `accEthPerShare` doesn't change on second call. Call `stake()` then `claimEthRewards()` in same block — verify both internal `_syncFees` calls produce correct results.
- **Risk:** Multiple functions call `_syncFees` internally (stake, requestUnstake, claimEthRewards, syncFees, onCSSVTransfer). If two are called in same block, second should be a no-op.
- **Severity:** Low

### D-20. `_settle` for user with zero balance (pre-initialization) [Rank 5]
- **Path:** `_settle(address user, StorageStaking storage s)`
- **Test:** Fees accrue, `accEthPerShare` increases to large value. New user (never interacted) calls `claimEthRewards()` (triggers `_settle`). bal=0, userIdx=0. Since bal==0, pending=0 regardless of index gap. `userIndex[user]` set to current `accEthPerShare`. User then stakes — index already up-to-date. Verify no phantom rewards from the gap.
- **Risk:** If `_settle` is called before a user stakes, their index gets initialized. Must verify pre-initialization doesn't create issues or phantom rewards.
- **Severity:** Low

### D-17. `onCSSVTransfer` with address(0) (mint/burn) — settlement no-op [Rank 6]
- **Path:** `onCSSVTransfer(address from, address to, uint256 amount)`
- **Test:** Mint triggers `onCSSVTransfer(address(0), user, amount)` — settles for address(0). Burn triggers `onCSSVTransfer(user, address(0), amount)` — settles for address(0). Verify settling for address(0) is a no-op (balance always 0). Verify user's rewards are correctly settled before the mint/burn changes their balance.
- **Risk:** address(0) should always have 0 balance, making settlement a no-op. But if the cSSV token treats address(0) specially, there could be unexpected behavior.
- **Severity:** Low

### D-21. `commitRoot` hasVoted persistence after root committed (defense in depth) [Rank 7]
- **Path:** `commitRoot` line 194 comment: "Do not delete hasVoted to prevent re-voting"
- **Test:** 2 oracles, quorum 50%. Oracle1 votes — root committed immediately. Verify `hasVoted[commitmentKey][1]` is still TRUE after commit. Verify `rootCommitments[commitmentKey]` is deleted (0). latestCommittedBlock is now set. Any future `commitRoot` with block <= latestCommittedBlock reverts with `StaleBlockNumber`. Verify double defense: StaleBlockNumber prevents revisiting AND hasVoted prevents re-voting.
- **Risk:** Defense-in-depth verification. The code intentionally keeps hasVoted as a second protection layer even though StaleBlockNumber should be sufficient.
- **Severity:** Low

---

## Cross-Module E2E (3)

### E-19. Rapid operator fee compounding (1.1^N) + cluster solvency impact [Rank 1]
- **Path:** `SSVOperators.declareOperatorFee` + `executeOperatorFee` (×5 cycles) → `SSVClusters.liquidate`
- **Test:** Register operator at fee F = min fee. Register cluster with 1 validator, deposit enough for ~1000 blocks. Cycle: declare F*1.1, wait, execute. Repeat 5 times. Final fee = F*1.1^5 ≈ 1.61F. Verify cluster burn rate increased by compounded amount. Cluster safe for 1000 blocks originally is now safe for ~620. Mine until liquidatable. Liquidate — verify correct with updated fees.
- **Risk:** Operators can compound fee increases over time. Verifies cumulative effect on cluster solvency and that the time delays prevent instant griefing.
- **Severity:** Low

### E-17. Migration while newer EB root available but not yet applied [Rank 2]
- **Path:** `SSVClusters.migrateClusterToETH` → `SSVClusters.updateClusterBalance`
- **Test:** Create SSV cluster, 2 validators. Oracle commits root, update EB to 100 ETH (vUnits=31250). Oracle commits NEWER root with EB=200 ETH. Before anyone calls `updateClusterBalance` with new root, owner migrates to ETH. Verify migration uses STORED snapshot (vUnits=31250 from first update). After migration, call `updateClusterBalance` with new root (EB=200 ETH). Verify EB correctly transitions from 31250→62500 on the now-ETH cluster.
- **Risk:** Migration and EB updates are independent operations. A newer root being available but not applied shouldn't affect migration. Subsequent updates should work normally.
- **Severity:** Low

### E-18. Old EB proof replay across root transitions — staleness + proof combined [Rank 3]
- **Path:** `SSVClusters.updateClusterBalance` → `_verifyEBStaleness` + `_verifyMerkleProof`
- **Test:** Oracle commits root at block 100, apply EB update (lastRootBlockNum=100). Oracle commits new root at block 200. Attempt `updateClusterBalance` with block 100 and old EB — should revert with `StaleUpdate` (100 <= 100). Attempt with block 200 but wrong proof (old leaf) — should revert with `InvalidProof`. Attempt with block 200 and correct proof — should succeed.
- **Risk:** Combined staleness + proof verification across root transitions. Individual protections are tested but the combined flow across root changes is not.
- **Severity:** Low
