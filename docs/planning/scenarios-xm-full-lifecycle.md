# Cross-Module Full Lifecycle — Integration Scenarios (XF-001 to XF-055)

**Wave:** 2 — Cross-Module Integration
**Prefix:** XF
**Worker:** W2-X (Cross-Module Integration)
**Scope:** End-to-end lifecycle scenarios exercising 3+ modules per scenario. Every scenario is a multi-step chain testing state consistency across `SSVOperators`, `SSVValidators`, `SSVClusters`, `SSVStaking`, `SSVDAO`, and supporting libraries.
**Source files:**
- `contracts/modules/SSVOperators.sol` — operator registration, removal, fee lifecycle
- `contracts/modules/SSVValidators.sol` — validator registration/removal, bulk operations
- `contracts/modules/SSVClusters.sol` — deposit, withdraw, liquidate, reactivate, migrate, updateClusterBalance
- `contracts/modules/SSVStaking.sol` — stake, requestUnstake, withdrawUnlocked, claimEthRewards, syncFees
- `contracts/modules/SSVDAO.sol` — network fee, liquidation params, oracle, governance
- `contracts/libraries/ClusterLib.sol` — cluster hashing, EB math, liquidation checks
- `contracts/libraries/OperatorLib.sol` — operator snapshots, whitelist, cluster operator updates
- `contracts/libraries/ProtocolLib.sol` — DAO earnings, fee indices, network totals
- `contracts/libraries/ValidatorLib.sol` — pubkey registration, operator length validation

**Spec refs:** SPEC.md (all sections), FLOWS.md (all flows)

---

## Code-Grounding Rules

These invariants must hold after any valid sequence of operations. Every scenario below validates one or more.

1. **ETH Conservation:** `address(contract).balance >= Σ(cluster.balance) + Σ(operator.ethSnapshot.balance) + stakingRewardPool`. No ETH is created or destroyed by internal accounting. (`SSVClusters.sol:196,249-251`, `SSVOperators.sol:97-99`, `SSVStaking.sol:146-149`)
2. **DAO vUnit Invariant:** `daoTotalEthVUnits == Σ(deviation across all active explicit-EB clusters)`. Baseline is tracked via `ethDaoValidatorCount * BPS_DENOMINATOR`. (`ProtocolLib.sol:updateDAO`, `SSVClusters.sol:402,562-596`)
3. **Operator vUnit Invariant:** For each operator, `operatorEthVUnits[opId] == Σ(deviation from each active explicit-EB cluster using this operator)`. (`SSVClusters.sol:494-510`)
4. **Cluster Hash Integrity:** `s.ethClusters[hash]` matches the canonical hash of `(owner, operatorIds, cluster)` after every state-changing operation. (`ClusterLib.sol:131-148`)
5. **Fee Settlement Ordering:** Fee settlement uses OLD vUnits before applying new deviation. (`SSVClusters.sol:396-403`)
6. **Removed Operator Accounting:** Removed operators contribute `ethFee = 0` to burn rate; their `ethSnapshot.index` is preserved for historical fee settlement. (`SSVOperators.sol:347-358`, `OperatorLib.sol:246-261`)
7. **Staking Pool Monotonicity:** `accEthPerShare` never decreases across `syncFees` calls. (`SSVStaking.sol:199-203`)
8. **cSSV Supply Conservation:** `cSSV.totalSupply() == Σ(staked) - Σ(unstake-requested)` at all times. (`SSVStaking.sol:57,90`)

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| XF-001 | registerOperator → registerValidator → deposit → withdraw → removeValidator → removeOperator | Complete happy-path lifecycle with 4 ops: register everything, fund, partial withdraw, then tear down. Verify all intermediate state hashes and final cleanup. | `modules:OP,VL,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVOperators.sol:31-66, SSVValidators.sol:26-39, SSVClusters.sol:186-201,206-253, SSVValidators.sol:56-64, SSVOperators.sol:71-104 |
| XF-002 | registerOperator → registerValidator → deposit → withdraw → removeValidator → removeOperator (7 ops) | Same as XF-001 with 7-operator cluster. Verify correct burn rate scaling and operator earnings proportional to fee. | `modules:OP,VL,CL; version:eth; eb:implicit; ops:7; revert:no` | [ ] | SSVOperators.sol:31-66, SSVClusters.sol:206-253 |
| XF-003 | registerOperator → registerValidator → deposit → withdraw → removeValidator → removeOperator (10 ops) | Same as XF-001 with 10-operator cluster. | `modules:OP,VL,CL; version:eth; eb:implicit; ops:10; revert:no` | [ ] | SSVOperators.sol:31-66, SSVClusters.sol:206-253 |
| XF-004 | registerOperator → registerValidator → deposit → withdraw → removeValidator → removeOperator (13 ops) | Same as XF-001 with 13-operator (max) cluster. Verify gas stays within block limits. | `modules:OP,VL,CL; version:eth; eb:implicit; ops:13; revert:no` | [ ] | SSVOperators.sol:31-66, SSVClusters.sol:206-253 |
| XF-005 | registerOperator → registerValidator → deposit → updateClusterBalance → declareOperatorFee → executeOperatorFee → withdraw → removeValidator → removeOperator | Full lifecycle including EB update and operator fee change mid-lifecycle. Verify fee settlement uses old fee up to change block, new fee after. | `modules:OP,VL,CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVOperators.sol:109-173, SSVClusters.sol:348-417,461-492 |
| XF-006 | registerOperator(SSV) → registerValidator(SSV) → migrateClusterToETH → deposit → updateClusterBalance → withdraw → removeValidator → removeOperator | SSV cluster → ETH migration → full ETH lifecycle continuation. Verify SSV balance returned, ETH accounting starts fresh, deviation correctly applied on migration. | `modules:OP,VL,CL,MIG; version:ssv→eth; eb:implicit; ops:4; revert:no` | [ ] | SSVClusters.sol:259-343, SSVValidators.sol:153-229 |
| XF-007 | registerOperator(SSV) → registerValidator(SSV) → updateClusterBalance(SSV) → migrateClusterToETH → deposit → updateClusterBalance(ETH) → withdraw | SSV cluster with explicit EB → migrate to ETH. Verify deviation accounting carries over correctly: `operatorEthVUnits` and `daoTotalEthVUnits` both include pre-migration deviation. | `modules:OP,VL,CL,MIG,EB; version:ssv→eth; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:259-343,309-326, SSVClusters.sol:494-510 |
| XF-008 | 3 owners × registerValidator (shared operators) → interleaved deposits/withdrawals → verify operator earnings consistency | Multi-user: 3 cluster owners share the same 4 operators. Each registers validators at different blocks. Interleave deposits and withdrawals. Verify operator `ethSnapshot.balance` and `ethSnapshot.index` reflect aggregate accrual from all clusters. | `modules:OP,VL,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | OperatorLib.sol:updateSnapshot, SSVClusters.sol:219-226 |
| XF-009 | Owner A and B share operators → A liquidated → B still functional → A reactivates | Two cluster owners share 4 operators. A is liquidated. Verify B's cluster remains fully functional (deposits, withdrawals, EB updates). A then reactivates with sufficient deposit. Verify operator vUnit accounting consistent throughout. | `modules:OP,VL,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVClusters.sol:31-65,129-181,552-612 |
| XF-010 | 100 validators across 10 clusters sharing operators → cascade fee change | Register 100 validators spread across 10 clusters, all sharing a common set of operators. Execute operator fee change. Verify all 10 clusters' burn rates update on next settlement and operator earnings are correct across all clusters. | `modules:OP,VL,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVOperators.sol:109-173, SSVClusters.sol:461-492 |
| XF-011 | 100 validators across 10 clusters → cascade liquidation | Same setup as XF-010. Advance blocks until 3 clusters are liquidatable. Liquidate all 3 in sequence. Verify remaining 7 clusters are unaffected. Verify operator `ethValidatorCount` decremented correctly per liquidation. | `modules:OP,VL,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVClusters.sol:31-65,552-612 |
| XF-012 | Time-lapse: 1M blocks with ongoing fee accrual → deposit → withdraw → verify accounting | Register cluster, advance 1,000,000 blocks. Deposit to keep cluster solvent. Withdraw partial balance. Verify fee settlement arithmetic does not overflow and matches `(blocks * burnRate * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS`. | `modules:OP,VL,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | ClusterLib.sol:306-321, SSVClusters.sol:219-226 |
| XF-013 | Time-lapse: 1M blocks with explicit EB (64 ETH/val, vUnits=20000) → verify no overflow | Same as XF-012 but with explicit EB doubling the vUnits. Higher burn rate for longer duration. Verify uint256 arithmetic stays within bounds. | `modules:OP,VL,CL,EB; version:eth; eb:explicit; ops:13; revert:no` | [ ] | ClusterLib.sol:306-321, SSVClusters.sol:494-510 |
| XF-014 | All operations in single block (block.number doesn't advance) | Register 4 operators, register validator, deposit, EB update (mock oracle), withdraw — all in the same block. Verify no fees accrue (0 block delta), all indexes consistent. | `modules:OP,VL,CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:219-226, OperatorLib.sol:updateSnapshot |
| XF-015 | Rapid-fire: all operations with 1 block between each | Register ops at block N, register validator at N+1, deposit at N+2, EB update at N+3, withdraw at N+4, remove validator at N+5, remove operator at N+6. Verify micro-accruals at each step are correctly accumulated. | `modules:OP,VL,CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:219-226, OperatorLib.sol:updateSnapshot |
| XF-016 | Two EB updates for different clusters in same transaction | Two clusters using different operator sets. Oracle commits root covering both clusters. Submit both `updateClusterBalance` calls in same block. Verify operator vUnits for shared-vs-disjoint operators are correctly updated. | `modules:CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:348-417,494-510 |
| XF-017 | Deploy → DAO params set → operators registered → validators → EB → staking → fees → unstake | Full protocol bootstrap lifecycle. DAO sets all parameters (network fee, liquidation threshold, operator fee limits, oracle, quorum). Then operators register, validators register, oracle commits root, EB update, user stakes SSV, fees accrue, user claims ETH rewards, user unstakes. | `modules:DAO,OP,VL,CL,EB,ST; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVDAO.sol:29-276, SSVOperators.sol:31-66, SSVValidators.sol:26-39, SSVClusters.sol:348-417, SSVStaking.sol:43-151 |
| XF-018 | DAO changes network fee mid-lifecycle → verify cluster balance settlement | Register cluster with active validators. DAO increases `ethNetworkFee` at block N. Advance blocks. Withdraw at block N+500. Verify fee settlement splits: old fee for blocks [last_settlement, N), new fee for blocks [N, N+500]. | `modules:DAO,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVDAO.sol:29-35, ProtocolLib.sol:40-46, SSVClusters.sol:219-229 |
| XF-019 | DAO changes liquidation threshold → cluster becomes liquidatable → liquidate → reactivate | Cluster is solvent under old threshold. DAO increases `minimumBlocksBeforeLiquidation`. Cluster is now liquidatable. Third party liquidates. Owner deposits and reactivates under new threshold. | `modules:DAO,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVDAO.sol:101-108, SSVClusters.sol:31-65,129-181 |
| XF-020 | DAO changes minimumLiquidationCollateral → withdraw that was safe now reverts | Active cluster with balance just above old `minimumLiquidationCollateral`. DAO increases collateral floor. Withdraw attempt that would have succeeded before now reverts `InsufficientBalance`. | `modules:DAO,CL; version:eth; eb:implicit; ops:4; revert:yes` | [ ] | SSVDAO.sol:125-128, SSVClusters.sol:235-247, ClusterLib.sol:75-76 |
| XF-021 | Operator fee lifecycle → cluster impact: declare → wait → execute → verify cluster burn rate changes | Register cluster. Operator declares fee increase. Wait through `declareOperatorFeePeriod`. Execute fee. Cluster's next settlement (via withdraw) uses new fee. Verify old-fee accrual for pre-change blocks and new-fee accrual for post-change blocks. | `modules:OP,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVOperators.sol:109-173, SSVClusters.sol:219-226 |
| XF-022 | Operator fee reduction → cluster gets cheaper → withdraw more is possible | Cluster at liquidation boundary. Operator reduces fee via `reduceOperatorFee`. Cluster burn rate drops. Withdraw that would have failed before fee reduction now succeeds. | `modules:OP,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVOperators.sol:192-214, SSVClusters.sol:235-247 |
| XF-023 | Operator removed mid-cluster-lifecycle → verify reduced burn rate and earnings payout | Active cluster with 4 operators. Remove one operator. Verify cluster burn rate drops to 3-operator rate. Verify removed operator receives accumulated earnings up to removal. Verify cluster can withdraw more due to lower threshold. | `modules:OP,VL,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVOperators.sol:71-104, SSVClusters.sol:219-226 |
| XF-024 | Operator removed → EB update → verify operatorEthVUnits[removedOp] is zero (BUG cross-ref) | Active cluster with explicit EB. Remove one operator (`operatorEthVUnits[opId]` deleted). Submit EB update. Verify `_updateOperatorVUnits` still writes to `operatorEthVUnits[removedOpId]` (THE BUG from EB-055). Document expected vs actual behavior. | `modules:OP,CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVOperators.sol:93, SSVClusters.sol:494-510, EB-055 cross-ref |
| XF-025 | Bulk register 50 validators → EB update → bulk remove 25 → EB update → verify vUnits halved | Register 50 validators in one bulk call. Oracle updates EB to 48 ETH. Remove 25 validators. Oracle updates EB again. Verify `ebSnapshot.vUnits` reflects 25 validators at the new EB, and deviation accounting is correct across both EB updates. | `modules:VL,CL,EB; version:eth; eb:explicit; ops:7; revert:no` | [ ] | SSVValidators.sol:44-51,70-76, SSVClusters.sol:348-417,494-510, SSVValidators.sol:197-227 |
| XF-026 | Register validator → deposit → liquidate → deposit into liquidated → withdraw from liquidated → reactivate | Full liquidation-recovery cycle. Verify: (a) deposit into liquidated cluster succeeds (no active check), (b) withdraw from liquidated skips fee settlement, (c) reactivation requires meeting threshold with current EB. | `modules:VL,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVClusters.sol:31-65,129-181,186-201,206-253 |
| XF-027 | Liquidation → reactivation with explicit EB → verify deviation restored | Cluster with explicit EB (48 ETH, vUnits=15000) is liquidated. Deviation cleaned up during liquidation (`_executeLiquidation`). Reactivate cluster. Verify `operatorEthVUnits` and `daoTotalEthVUnits` are restored with the stored deviation on reactivation. | `modules:CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:552-612,129-181, SSVClusters.sol:142-176 |
| XF-028 | Staking → cluster fees → syncFees → claimEthRewards → verify ETH flows through full pipeline | Stake SSV → create ETH cluster with validators → advance blocks → syncFees → claim ETH rewards. Verify: DAO network fee accrual → `stakingEthPoolBalance` → `accEthPerShare` → user claim. End-to-end ETH flow from cluster owner's deposit to SSV staker's reward. | `modules:ST,CL,DAO; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVStaking.sol:43-151, ProtocolLib.sol:84-89, SSVClusters.sol:219-229 |
| XF-029 | Staking → EB update increases vUnits → higher network fee accrual → staker gets more rewards | Stake SSV. Create cluster. Oracle updates EB to 64 ETH (vUnits doubled). Advance blocks. Sync fees. Claim. Verify staker rewards are proportionally higher due to increased `daoTotalEthVUnits` in network fee accrual. | `modules:ST,CL,EB,DAO; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVStaking.sol:183-207, ProtocolLib.sol:65-68, SSVClusters.sol:494-510 |
| XF-030 | Staking → cluster liquidated → fees stop accruing → staker claims pre-liquidation rewards | Stake SSV. Create cluster. Advance blocks until liquidatable. Liquidate. Sync fees. Staker claims. Verify rewards only cover pre-liquidation accrual. Post-liquidation `syncFees` should yield zero new fees. | `modules:ST,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVStaking.sol:113-151, SSVClusters.sol:552-612, ProtocolLib.sol:84-89 |
| XF-031 | Two stakers → one exits mid-lifecycle → remaining staker gets 100% of future fees | Alice and Bob stake equal SSV. Create active cluster. Advance blocks. Alice unstakes fully. Advance more blocks. Bob claims. Verify Bob gets 100% of fees accrued after Alice's exit. Alice claims pre-exit rewards. | `modules:ST,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVStaking.sol:65-93,113-151,209-228 |
| XF-032 | Migrate SSV cluster → liquidated SSV cluster → verify SSV balance returned and reactivation as ETH | Liquidated SSV cluster. Migrate to ETH (which implicitly reactivates). Verify: SSV balance returned to owner, ETH deposit becomes new balance, `sp.daoValidatorCountSSV` not decremented (already removed during liquidation), `sp.ethDaoValidatorCount` incremented. | `modules:CL,MIG; version:ssv→eth; eb:implicit; ops:4; revert:no` | [ ] | SSVClusters.sol:259-343,265,284-287 |
| XF-033 | DAO replaceOracle → old oracle EB update fails → new oracle EB update succeeds → cluster accounting valid | Replace oracle. Old oracle attempts `commitRoot` — reverts `NotOracle`. New oracle commits root. Submit `updateClusterBalance` using new root. Verify cluster EB accounting is correct. | `modules:DAO,CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVDAO.sol:226-249, SSVClusters.sol:348-417 |
| XF-034 | DAO updateMaximumOperatorFee → operator executeOperatorFee fails because new max is lower | Operator declares fee increase to X. DAO lowers `operatorMaxFee` below X before execution window. Operator attempts `executeOperatorFee` — reverts `FeeTooHigh`. Cluster burn rate unchanged. | `modules:DAO,OP; version:eth; eb:implicit; ops:4; revert:yes` | [ ] | SSVDAO.sol:141-149, SSVOperators.sol:146-173,164 |
| XF-035 | Register private operators → whitelist owner A → A registers validator → remove whitelist → B cannot register | Register 4 private operators. Whitelist owner A. A registers validator successfully. Owner updates operators to public then back to private without whitelisting B. B attempts registration — reverts `CallerNotWhitelistedWithData`. Verify A's existing cluster unaffected by privacy toggle. | `modules:OP,VL; version:eth; eb:implicit; ops:4; revert:yes` | [ ] | SSVOperators.sol:219-222, OperatorLib.sol:518-529, SSVValidators.sol:26-39 |
| XF-036 | Cluster with 4 ops → 2 ops removed → EB update → verify deviation only applied to 2 remaining ops (BUG) | Active cluster with explicit EB. Remove 2 of 4 operators. Oracle updates EB. `_updateOperatorVUnits` iterates ALL 4 operator IDs (including removed). Verify that `operatorEthVUnits` for removed operators gets non-zero values (the known bug). Document invariant violation. | `modules:OP,CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:494-510, SSVOperators.sol:91-93 |
| XF-037 | Validator removal cleans up deviation when cluster becomes empty (explicit EB) | Active cluster with 2 validators and explicit EB (vUnits = 30000, baseline = 20000, deviation = 10000). Remove both validators via `bulkRemoveValidator`. Verify `ebSnapshot.vUnits` goes to 0, `operatorEthVUnits` decremented by the deviation, and `daoTotalEthVUnits` decremented. | `modules:VL,CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVValidators.sol:153-227, specifically lines 204-223 |
| XF-038 | Register cluster → EB update → liquidation triggered by EB increase → verify deviation cleanup | Cluster with thin balance. Oracle reports EB increase from 32 to 64 ETH. Higher vUnits trigger auto-liquidation in `_liquidateAfterEBUpdateIfNeeded`. Verify: (a) cluster balance goes to 0, (b) deviation subtracted from all operators and DAO, (c) liquidation bounty sent to msg.sender. | `modules:CL,EB; version:eth; eb:implicit→explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:519-550,552-612 |
| XF-039 | Two clusters share operators → concurrent EB updates → verify operator vUnit stacking | Cluster A (ops 1,2,3,4) and Cluster B (ops 1,2,3,4). Both get EB updates in same block. Cluster A: 32→48 (+5000 delta). Cluster B: 32→64 (+10000 delta). Each operator's `operatorEthVUnits` should increase by 15000 total. `daoTotalEthVUnits` increases by 15000. | `modules:CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:494-510, EB-085 cross-ref |
| XF-040 | Full lifecycle → operator earnings withdrawal → verify earnings match fee accrual formula | Register 4 operators. Register cluster with 5 validators. Advance 10,000 blocks. Withdraw operator earnings. Verify each operator's earnings = `(index_delta * ethValidatorCount) * ETH_DEDUCTED_DIGITS` where index_delta accounts for all clusters served. | `modules:OP,VL,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVOperators.sol:234-261, OperatorLib.sol:updateSnapshot |
| XF-041 | Deposit → EB update → fee settlement uses OLD vUnits → new vUnits applied → withdraw | Verify fee settlement ordering. Cluster has explicit EB (32 ETH, vUnits=10000). Deposit. Oracle reports 64 ETH. During `_applyClusterFeeUpdates`, fees deducted using oldVUnits=10000 (not 20000). Then newVUnits=20000 applied. Withdraw uses new threshold. | `modules:CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:396-403,461-492 |
| XF-042 | Register validator in cluster with explicit EB → vUnits increase by baseline (not deviation) | Active cluster with explicit EB (1 validator, vUnits=15000, deviation=5000). Register second validator. Verify `ebSnapshot.vUnits` becomes 25000 (not 30000 — only baseline 10000 added per validator). `operatorEthVUnits` unchanged (deviation doesn't change on registration). | `modules:VL,CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVValidators.sol:132-143 |
| XF-043 | cSSV transfer settles both parties → one claims → other claims → no double-counting | Alice stakes, earns rewards over 1000 blocks. Alice transfers all cSSV to Bob. `onCSSVTransfer` settles both. Alice claims her pre-transfer rewards. Bob earns for 500 more blocks, claims. Verify total claimed = total fees accrued. No overlap, no gap. | `modules:ST; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVStaking.sol:173-181,113-151,209-228 |
| XF-044 | DAO updateMinimumOperatorEthFee → existing operators below new minimum → operator reduces fee → revert FeeTooLow | DAO raises `minimumOperatorEthFee`. Existing operator with fee below new minimum attempts `reduceOperatorFee` to 0 — succeeds (0 is always valid). Operator attempts `reduceOperatorFee` to value below new minimum but > 0 — reverts `FeeTooLow`. | `modules:DAO,OP; version:eth; eb:implicit; ops:4; revert:yes` | [ ] | SSVDAO.sol:155-163, SSVOperators.sol:192-214,196 |
| XF-045 | EB update on cluster → immediately liquidate → verify no double deviation subtraction | EB update with new deviation applied (`_updateOperatorVUnits`). In the same transaction, `_liquidateAfterEBUpdateIfNeeded` triggers. Verify deviation is subtracted once in `_executeLiquidation` using the NEW vUnits (not the old + the delta separately). | `modules:CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:399-406,519-550,567-596 |
| XF-046 | Multi-cluster cascade: remove all validators from 3 clusters sharing operators → verify operator counts | 3 clusters, each with 5 validators, sharing the same 4 operators. Remove all validators from each cluster in sequence. Verify `ethValidatorCount` per operator decrements by 5 each time, ending at 0. Verify all `ebSnapshot.vUnits` cleaned up. | `modules:VL,CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVValidators.sol:153-227, OperatorLib.sol:updateClusterOperators |
| XF-047 | Register cluster → stake SSV → advance → liquidate cluster → syncFees → verify staking pool stops growing | Create cluster. Stake SSV. Advance 500 blocks (fees accrue). Liquidate cluster. Advance 500 more blocks. SyncFees twice (once after liquidation, once after more blocks). Verify `accEthPerShare` increases on first sync but second sync adds zero new fees. | `modules:ST,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVStaking.sol:183-207, SSVClusters.sol:552-612, ProtocolLib.sol:84-89 |
| XF-048 | Reactivate cluster with explicit EB → verify deviation restored to operators and DAO | Cluster with explicit EB (vUnits=15000) is liquidated (deviation=5000 removed from ops and DAO). Reactivate with sufficient ETH. Verify: (a) `clusterDeviation` computed from stored `ebSnapshot.vUnits`, (b) `operatorEthVUnits` restored by deviation, (c) `daoTotalEthVUnits` restored. | `modules:CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:129-181,142-176 |
| XF-049 | DAO changes all parameters simultaneously → verify no cross-contamination | Set network fee, liquidation threshold, collateral, operator fee limits, quorum, cooldown, oracle — all in same block. Register cluster, register validator, deposit. Verify all parameters applied correctly with no stale reads. | `modules:DAO,OP,VL,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVDAO.sol:29-276 |
| XF-050 | Operator removed → cluster deposit → cluster withdraw → verify zero burn rate from removed op | Cluster with 4 operators. Remove one. Advance 1000 blocks. Deposit. Withdraw. Verify: fee settlement only includes 3 active operators' fees. Liquidation threshold computed with 3-operator burn rate. Removed operator contributes preserved index but zero burn rate. | `modules:OP,CL; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVOperators.sol:71-104, SSVClusters.sol:219-226 |
| XF-051 | Cluster owner is a contract that rejects ETH → withdraw reverts ETHTransferFailed | Register cluster where the owner is a smart contract without `receive()`. Deposit ETH. Attempt withdraw. Verify `CoreLib.transferBalance` reverts with `ETHTransferFailed`. Verify cluster state unchanged (revert rolls back). | `modules:CL; version:eth; eb:implicit; ops:4; revert:yes` | [ ] | SSVClusters.sol:249-251, CoreLib.sol |
| XF-052 | Bulk register 100 validators → EB update → cascade liquidation → verify gas and accounting | Register 100 validators in single bulk call (gas upper bound). Oracle updates EB. Auto-liquidation triggered. Verify: gas fits within block limit, all 100 validators' deviation cleaned up, operator counts decremented by 100, full bounty transferred. | `modules:VL,CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVValidators.sol:44-51, SSVClusters.sol:519-550,552-612 |
| XF-053 | Staking full cycle: stake → requestUnstake → wait cooldown → withdrawUnlocked → verify SSV conservation | End-to-end staking lifecycle. Verify: SSV transferred from user to contract on stake, cSSV minted 1:1, cSSV burned on unstake request, SSV returned after cooldown. Total SSV in system conserved. | `modules:ST; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVStaking.sol:43-108 |
| XF-054 | DAO updateUnstakeCooldownDuration → existing unstake request uses old duration → new request uses new | Change cooldown duration mid-lifecycle. Verify: existing `UnstakeRequest.unlockTime` unchanged, new request's `unlockTime` uses new duration. Both requests mature at their own times. | `modules:DAO,ST; version:eth; eb:implicit; ops:4; revert:no` | [ ] | SSVDAO.sol:265-268, SSVStaking.sol:87-88 |
| XF-055 | DAO updateQuorumBps → previously-stuck root now commits → EB update uses new root → cluster updated | Lower quorum so that existing oracle votes (which were short of old quorum) now reach quorum. Root commits. Submit `updateClusterBalance` with new root. Verify cluster EB updated and accounting correct. | `modules:DAO,CL,EB; version:eth; eb:explicit; ops:4; revert:no` | [ ] | SSVDAO.sol:254-260, SSVClusters.sol:348-417 |

---

## Detailed Scenario Blocks (12 Most Complex)

---

### XF-001: Complete Happy-Path Lifecycle (4 Operators)

**Goal:** Verify the full protocol lifecycle from operator registration through teardown, confirming state consistency at every step across 3 modules.

**Setup:**
1. 4 fresh accounts for operator owners, 1 for cluster owner.
2. DAO has set: `ethNetworkFee`, `minimumBlocksBeforeLiquidation`, `minimumLiquidationCollateral`, `operatorMaxFee`, `minimumOperatorEthFee`.

**Action Sequence:**

| Step | Action | Module | Expected State Change |
|------|--------|--------|----------------------|
| 1 | `registerOperator` ×4 with fees [1M, 2M, 3M, 4M] packed wei | SSVOperators | 4 operators, IDs 1-4, `ethSnapshot.block = currentBlock` |
| 2 | `registerValidator` with ops [1,2,3,4], `msg.value = 10 ETH` | SSVValidators | Cluster created, `validatorCount=1`, `balance=10 ETH`, operator `ethValidatorCount` incremented |
| 3 | Advance 5000 blocks | — | Fees accrue: `5000 * (1M+2M+3M+4M) * 10000/10000 * 100000` = 5×10^12 wei = 0.000005 ETH |
| 4 | `deposit` 1 ETH into cluster | SSVClusters | `cluster.balance += 1 ETH`, no fee settlement (deposit is "dumb add") |
| 5 | Advance 5000 blocks | — | More fees accrue |
| 6 | `withdraw` 0.5 ETH | SSVClusters | Fee settlement for 10000 blocks total, then balance reduced by 0.5 ETH |
| 7 | `removeValidator` | SSVValidators | `validatorCount → 0`, operator `ethValidatorCount` decremented, DAO `ethDaoValidatorCount` decremented |
| 8 | `withdraw` remaining balance | SSVClusters | Succeeds (validatorCount=0 → liquidation check skipped per line 237) |
| 9 | `removeOperator` ×4 | SSVOperators | Each operator's earnings paid out, state zeroed, `operatorEthVUnits` deleted |

**Invariants Checked:**
- After step 2: `s.ethClusters[hash] != 0`, cluster hash matches canonical hash of (owner, operatorIds, cluster).
- After step 6: `cluster.balance == initialBalance + deposit - fees - withdrawal`, operator snapshots updated.
- After step 7: `validatorCount == 0`, operator `ethValidatorCount` each decremented by 1.
- After step 8: cluster balance == 0, full ETH conservation: `sum(operator_earnings) + withdrawn + fees_in_DAO == total_deposited`.
- After step 9: operator state zeroed per `_resetOperatorState`, `operatorEthVUnits` deleted.

**Code path:** `SSVOperators.sol:31-66` → `SSVValidators.sol:105-151` → `SSVClusters.sol:186-201` → `SSVClusters.sol:206-253` → `SSVValidators.sol:153-229` → `SSVOperators.sol:71-104`

---

### XF-009: Shared Operators — A Liquidated, B Still Functional

**Goal:** Prove that liquidation of one cluster does not affect another cluster sharing the same operators. Verify operator accounting isolates per-cluster state correctly.

**Setup:**
1. Register 4 operators with `ethFee = 2,000,000,000` each.
2. Owner A registers cluster with 1 validator, deposits 0.1 ETH (thin balance).
3. Owner B registers cluster with same 4 operators, 1 validator, deposits 10 ETH (generous balance).
4. Advance blocks until A is liquidatable but B is not.

**Action Sequence:**

| Step | Action | Expected |
|------|--------|----------|
| 1 | Third party liquidates A's cluster | A: `active=false`, `balance=0`. Liquidator receives A's remaining balance. Operator `ethValidatorCount` decremented by 1 (A's validators). |
| 2 | B deposits 1 ETH | Succeeds. B's cluster is independent. No cross-contamination. |
| 3 | B withdraws 0.5 ETH | Succeeds. Fee settlement only covers B's accrual. Burn rate reflects 4 operators (not affected by A's liquidation). |
| 4 | A deposits 5 ETH into liquidated cluster | Succeeds — `deposit()` has no active check. |
| 5 | A reactivates cluster | Succeeds. Operator `ethValidatorCount` re-incremented by 1. `sp.ethDaoValidatorCount` incremented. |
| 6 | Both A and B withdraw | Both succeed independently. Operator snapshots reflect aggregate of both clusters. |

**Key Assertions:**
- Operator `ethSnapshot.index` is shared across clusters — A's liquidation does NOT reset operator indexes.
- After step 1: operator `ethValidatorCount` decremented by A's `validatorCount` only, not B's.
- After step 5: operator `ethValidatorCount` reflects both A and B again.
- Throughout: B's cluster hash in `s.ethClusters` is completely independent of A's operations.

**Code path:** `SSVClusters.sol:31-65` (liquidate), `SSVClusters.sol:129-181` (reactivate), `SSVClusters.sol:186-201` (deposit), `SSVClusters.sol:206-253` (withdraw), `OperatorLib.sol:updateClusterOperators` (shared operator snapshots).

---

### XF-017: Full Protocol Bootstrap Lifecycle

**Goal:** Exercise every module in the protocol in a single end-to-end scenario, from DAO configuration through staker reward claim.

**Setup:**
- Fresh deployment. No parameters set. No operators.

**Action Sequence:**

| Step | Action | Module | Verification |
|------|--------|--------|-------------|
| 1 | `updateNetworkFee(3,550,929,823)` | SSVDAO | `ethNetworkFee` stored, `ethNetworkFeeIndex` initialized |
| 2 | `updateLiquidationThresholdPeriod(214800)` | SSVDAO | 30-day threshold stored |
| 3 | `updateMinimumLiquidationCollateral(0.00094 ETH)` | SSVDAO | Packed collateral stored |
| 4 | `updateMaximumOperatorFee(5,326,300,000)` | SSVDAO | Packed max fee stored |
| 5 | `updateMinimumOperatorEthFee(1,065,200,000)` | SSVDAO | Packed min fee stored |
| 6 | `replaceOracle(oracleId=1, oracleAddress)` | SSVDAO | Oracle mapped |
| 7 | `updateQuorumBps(5000)` | SSVDAO | 50% quorum set |
| 8 | `updateUnstakeCooldownDuration(604800)` | SSVDAO | 7-day cooldown |
| 9 | `registerOperator` ×4 | SSVOperators | IDs 1-4, fees within [min, max] |
| 10 | `registerValidator` with 10 ETH deposit | SSVValidators | Cluster active, `validatorCount=1` |
| 11 | Oracle `commitRoot` with EB data | SSVDAO/EB | Root stored for blockNum |
| 12 | `updateClusterBalance(64 ETH)` | SSVClusters | `vUnits=20000`, deviation applied |
| 13 | User stakes 1000 SSV | SSVStaking | cSSV minted, `userIndex` set |
| 14 | Advance 10,000 blocks | — | Fees accrue at higher EB rate |
| 15 | `syncFees` | SSVStaking | `accEthPerShare` updated |
| 16 | `claimEthRewards` | SSVStaking | ETH transferred to staker |
| 17 | `requestUnstake(500 SSV)` | SSVStaking | cSSV burned, request created |
| 18 | Wait cooldown + `withdrawUnlocked` | SSVStaking | 500 SSV returned |

**Invariants Checked:**
- ETH conservation after step 16: `contract.balance = cluster.balance + operator_earnings + DAO_balance - claimed_rewards`.
- cSSV supply after step 17: `totalSupply = 1000 - 500 = 500`.
- Staker reward after step 16: `reward ∝ (10000 blocks * networkFee * daoTotalEthVUnits / BPS) * (cSSV_balance / totalSupply)`.

**Code path:** All modules. This scenario is the canonical integration test for the entire protocol.

---

### XF-010: 100 Validators Across 10 Clusters — Cascade Fee Change

**Goal:** Stress-test operator fee change propagation across many clusters sharing operators. Verify no accounting errors accumulate.

**Setup:**
1. Register 4 operators with `ethFee = 1,500,000,000` each.
2. 10 different owners each register 10 validators = 10 clusters × 10 validators = 100 total.
3. Each cluster deposited with sufficient ETH for long runway.
4. Advance 1000 blocks.

**Action Sequence:**

| Step | Action | Expected |
|------|--------|----------|
| 1 | `declareOperatorFee(op1, 3,000,000,000)` | Fee change request stored. No immediate effect on clusters. |
| 2 | Advance past `declareOperatorFeePeriod` | — |
| 3 | `executeOperatorFee(op1)` | Op1's `ethFee` updated. Operator snapshot settled at OLD fee up to this block. |
| 4 | Each of 10 cluster owners calls `withdraw(1 wei)` | Each triggers fee settlement. Pre-change blocks use old fee, post-change blocks use new fee for op1. Other 3 operators unchanged. |

**Key Calculations:**
- Before fee change: `burnRate_per_cluster = 4 * 1.5B = 6B` packed wei/block.
- After fee change: `burnRate_per_cluster = 1.5B + 1.5B + 1.5B + 3B = 7.5B` packed wei/block.
- Each cluster's settlement: `old_blocks * 6B * vUnits / BPS + new_blocks * 7.5B * vUnits / BPS` (approximately, since operator index captures this automatically).
- Op1 earnings: `index_delta * ethValidatorCount * ETH_DEDUCTED_DIGITS`. `ethValidatorCount = 100` (10 clusters × 10 validators each).

**Invariants:**
- Sum of all 10 cluster balance reductions + operator earnings + DAO earnings == 0 (conservation).
- Op1 earnings are strictly higher than op2/3/4 due to higher post-change fee.

**Code path:** `SSVOperators.sol:109-173` (fee lifecycle), `SSVClusters.sol:219-226` (withdraw settlement loop), `OperatorLib.sol:updateSnapshot` (per-operator index update).

---

### XF-014: All Operations in Single Block

**Goal:** Verify that when `block.number` doesn't advance between operations, zero fees accrue and all index-based accounting is consistent.

**Setup:**
- Fresh state. All operations executed at block N.

**Action Sequence (all at block N):**

| Step | Action | Expected |
|------|--------|----------|
| 1 | Register 4 operators | `ethSnapshot.block = N` for each |
| 2 | Register validator, `msg.value = 10 ETH` | Cluster created, `index = clusterIndex at N`, `networkFeeIndex at N` |
| 3 | Deposit 1 ETH | `balance = 11 ETH`. No settlement (deposit never settles). |
| 4 | Oracle commits root, `updateClusterBalance(48 ETH)` | vUnits = 15000. Fee settlement: `(N - N) * fee = 0`. No fees deducted. Deviation applied. |
| 5 | Withdraw 1 ETH | Settlement: `(N - N) * fee = 0`. Balance = 10 ETH. Liquidation check with vUnits=15000. |

**Key Assertions:**
- Zero fees deducted at every step (block delta = 0).
- Operator `ethSnapshot.balance` = 0 throughout (no accrual).
- `cluster.index` and `cluster.networkFeeIndex` update to current values at each step but produce zero deltas.
- EB deviation correctly applied even with zero block advancement.

**Code path:** `SSVClusters.sol:219-226` (withdraw loop: `block.number - ethSnapshot.block = 0`), `SSVClusters.sol:461-492` (_applyClusterFeeUpdates with zero deltas).

---

### XF-027: Liquidation and Reactivation with Explicit EB — Deviation Round-Trip

**Goal:** Verify that EB deviation accounting is symmetric: liquidation removes deviation, reactivation restores it.

**Setup:**
1. Register 4 operators.
2. Register cluster with 1 validator, deposit minimal ETH.
3. Oracle updates EB to 48 ETH → `vUnits = 15000`, `deviation = 5000`.
4. Verify: each `operatorEthVUnits[opId]` increased by 5000, `daoTotalEthVUnits` increased by 5000.
5. Advance blocks until cluster is liquidatable.

**Liquidation Phase:**

| Step | Action | Expected |
|------|--------|----------|
| 1 | Liquidate cluster | `_executeLiquidation` runs. `vUnitsCluster = 15000`, `baselineVUnits = 10000`, `deviation = 5000`. Each `operatorEthVUnits[opId]` decremented by 5000. `daoTotalEthVUnits` decremented by 5000. |
| 2 | Verify post-liquidation | `cluster.active = false`. `ebSnapshot.vUnits` still = 15000 (NOT zeroed — only deviation removed from operator/DAO tracking). |

**Reactivation Phase:**

| Step | Action | Expected |
|------|--------|----------|
| 3 | Deposit 10 ETH into liquidated cluster | Succeeds (no active check). |
| 4 | `reactivate` cluster with sufficient ETH | `updateClusterOperatorsOnReactivation` called with `clusterDeviation = 15000 - 10000 = 5000`. Each `operatorEthVUnits[opId]` increased by 5000. `daoTotalEthVUnits += 5000`. |
| 5 | Verify post-reactivation | Operator vUnits match pre-liquidation values. `daoTotalEthVUnits` restored. Cluster is active. |

**Invariant:**
- `operatorEthVUnits[opId]_post_reactivation == operatorEthVUnits[opId]_pre_liquidation` (modulo any other clusters' contributions).
- `daoTotalEthVUnits_post_reactivation == daoTotalEthVUnits_pre_liquidation`.

**Code path:** `SSVClusters.sol:552-612` (liquidation deviation cleanup, lines 567-596), `SSVClusters.sol:129-181` (reactivation, lines 142-176).

---

### XF-028: Staking End-to-End — ETH Flows from Cluster to SSV Staker

**Goal:** Trace ETH from cluster owner's deposit through DAO network fee accrual to SSV staker's reward claim. Verify the complete pipeline.

**Setup:**
1. DAO sets `ethNetworkFee = 1,000,000,000` (1B packed wei/block).
2. Register 4 operators with `ethFee = 2,000,000,000` each.
3. Register cluster with 1 validator, deposit 100 ETH.
4. User Alice stakes 10,000 SSV (gets 10,000 cSSV).

**Action Sequence:**

| Step | Action | Expected |
|------|--------|----------|
| 1 | Advance 10,000 blocks | DAO earns: `10000 * 1B * 10000/10000 * 100000 = 10^18 wei = 1 ETH` (implicit EB, vUnits=10000) |
| 2 | `syncFees()` | `networkTotalEarnings()` computes DAO earnings. `stakingEthPoolBalance` updated. `newFeesWei = earnings_delta`. `accEthPerShare += (newFeesWei * PRECISION) / totalStaked`. |
| 3 | `claimEthRewards()` (Alice) | `settle`: `pending = (10000_cSSV * (accEthPerShare - userIndex)) / PRECISION`. `payout = pending - (pending % 100000)`. `stakingEthPoolBalance` decremented. `ethDaoBalance` decremented. ETH transferred to Alice. |

**Key Calculation:**
- DAO earnings after 10,000 blocks: `10000 * 1,000,000,000 * 10000 / 10000 * 100,000 = 1,000,000,000,000,000,000 = 1 ETH`.
- Alice is sole staker: she gets 100% of staking pool.
- Alice's payout ≈ 1 ETH (minus precision truncation).

**Assertions:**
- `accEthPerShare > 0` after sync.
- Alice receives ETH > 0.
- `stakingEthPoolBalance` and `ethDaoBalance` both decremented by `packedPayout`.
- Post-claim, `address(contract).balance >= cluster.balance + operator_earnings + remaining_DAO_balance`.

**Code path:** `SSVStaking.sol:183-207` (syncFees), `SSVStaking.sol:113-151` (claim), `ProtocolLib.sol:65-68` (networkTotalEarnings), `ProtocolLib.sol:84-89` (ethDaoBalance calculation).

---

### XF-038: EB Increase Triggers Auto-Liquidation — Full Cleanup Verification

**Goal:** Verify that when an EB increase makes a cluster's burn rate exceed its balance, the auto-liquidation path in `_liquidateAfterEBUpdateIfNeeded` correctly handles all accounting.

**Setup:**
1. Register 4 operators with `ethFee = 2,000,000,000` each.
2. Register cluster with 1 validator. Deposit just enough ETH to be above the implicit-EB threshold.
3. `balance ≈ threshold_at_10000_vUnits + small_margin`.

**Action Sequence:**

| Step | Action | Expected |
|------|--------|----------|
| 1 | Oracle commits root with EB = 64 ETH | — |
| 2 | `updateClusterBalance(64 ETH)` | `newVUnits = 20000`. Fee settlement uses OLD vUnits (10000). Then deviation applied: `operatorEthVUnits += 10000` for each op, `daoTotalEthVUnits += 10000`. |
| 3 | `_liquidateAfterEBUpdateIfNeeded` fires | `isLiquidatableWithEB` uses NEW vUnits=20000, making threshold 2x higher. Cluster balance is below new threshold → liquidatable. |
| 4 | `_executeLiquidation` runs | (a) `sp.updateDAO(false, 1)` decrements `ethDaoValidatorCount`. (b) `vUnitsCluster = 20000` (the NEW value from step 2). `baselineVUnits = 10000`. `deviation = 10000`. (c) Each `operatorEthVUnits -= 10000`. (d) `daoTotalEthVUnits -= 10000`. (e) Remaining balance sent to liquidator (msg.sender). (f) `cluster.active = false`. |

**Critical Assertion — No Double Deviation:**
- In step 2, `_updateOperatorVUnits` adds deviation (+10000).
- In step 4, `_executeLiquidation` subtracts deviation (-10000) using the ebSnapshot.vUnits which is now the NEW value.
- Net effect on `operatorEthVUnits`: 0 (correct — cluster is liquidated, deviation should be zero).
- This is NOT a double subtraction because the snapshot was updated to the new value before liquidation.

**Code path:** `SSVClusters.sol:385-406` (EB update with fee settlement), `SSVClusters.sol:494-510` (_updateOperatorVUnits), `SSVClusters.sol:519-550` (_liquidateAfterEBUpdateIfNeeded), `SSVClusters.sol:552-612` (_executeLiquidation).

---

### XF-006: SSV to ETH Migration — Full Continuation

**Goal:** Verify that migrating an SSV cluster to ETH correctly settles SSV accounting, starts fresh ETH accounting, and the cluster can continue through the full ETH lifecycle.

**Setup:**
1. Register 4 operators with both SSV and ETH fee structures.
2. Register SSV cluster with 1 validator, deposit 1000 SSV tokens.
3. Advance 5000 blocks (SSV fees accrue).

**Action Sequence:**

| Step | Action | Expected |
|------|--------|----------|
| 1 | `migrateClusterToETH(msg.value = 10 ETH)` | (a) SSV balance settled: `updateBalanceSSV` computes remaining SSV balance. (b) `ssvClusterBalance` returned to owner via `CoreLib.transferTokenBalance`. (c) Cluster balance set to `msg.value` (10 ETH). (d) `cluster.active = true`, `cluster.index` = ETH cluster index, `cluster.networkFeeIndex` = ETH network fee index. (e) `sp.daoValidatorCountSSV` decremented, `sp.ethDaoValidatorCount` incremented. (f) `s.clusters[hash]` deleted, `s.ethClusters[hash]` written. |
| 2 | Advance 5000 blocks | ETH fees accrue |
| 3 | Deposit 1 ETH | `cluster.balance += 1 ETH` (no settlement) |
| 4 | Withdraw 0.5 ETH | Fee settlement for 5000 blocks at ETH rates. Balance reduced by 0.5 ETH. |
| 5 | Oracle updates EB | Deviation applied. Cluster now has explicit EB. |
| 6 | Remove validator | `validatorCount → 0`. Deviation cleaned up if explicit EB. |
| 7 | Withdraw remaining | Succeeds (validatorCount = 0 → no liquidation check). |

**Key Assertion:**
- After step 1: SSV tokens returned to owner. Cluster exists only in `s.ethClusters`, not `s.clusters`.
- After step 1: No SSV fees accrue. Only ETH fees accrue from this point.
- Deviation from pre-migration EB (if any) is correctly carried over in step 1 (lines 309-326).

**Code path:** `SSVClusters.sol:259-343` (migration), `SSVClusters.sol:186-253` (deposit/withdraw), `SSVClusters.sol:348-417` (EB update), `SSVValidators.sol:153-227` (remove validator).

---

### XF-043: cSSV Transfer Settles Both Parties — No Double Counting

**Goal:** Verify that `onCSSVTransfer` correctly settles accrued rewards for both sender and receiver, preventing double-counting or gaps.

**Setup:**
1. Active ETH cluster generating network fees.
2. Alice stakes 1000 SSV (gets 1000 cSSV). Bob has 0 cSSV.
3. Advance 1000 blocks (Alice accrues rewards).

**Action Sequence:**

| Step | Action | Expected |
|------|--------|----------|
| 1 | Record `accEthPerShare` = A | Alice's `userIndex` was set at stake time to A₀. Pending = `1000 * (A - A₀) / PRECISION`. |
| 2 | Alice transfers 1000 cSSV to Bob | `onCSSVTransfer(Alice, Bob, 1000)` called by cSSV contract. `_syncFees` runs. `_settle(Alice)`: pending computed and added to `accrued[Alice]`, `userIndex[Alice] = current_accEthPerShare`. `_settle(Bob)`: Bob has 0 cSSV at this point (transfer hasn't happened yet in ERC20 flow? — verify hook timing), so `pending = 0`, `userIndex[Bob] = current_accEthPerShare`. |
| 3 | Advance 500 more blocks | Bob now holds 1000 cSSV. Fees accrue. |
| 4 | `syncFees()` | `accEthPerShare` increases by new_delta. |
| 5 | Alice calls `claimEthRewards()` | Alice claims her pre-transfer `accrued[Alice]`. Settlement: `pending = 0` (Alice has 0 cSSV). Payout = `accrued[Alice] - (accrued % ETH_DEDUCTED_DIGITS)`. Remainder zeroed (no cSSV balance). |
| 6 | Bob calls `claimEthRewards()` | Bob's `pending = 1000 * (accEthPerShare - userIndex[Bob]) / PRECISION`. This covers only post-transfer blocks. No overlap with Alice's rewards. |

**Critical Invariant:**
- `Alice_claimed + Bob_claimed <= total_network_fees_accrued_over_all_blocks`.
- No gap: Alice covers blocks [stake, transfer). Bob covers blocks [transfer, claim). Sum = full duration.

**Code path:** `SSVStaking.sol:173-181` (onCSSVTransfer), `SSVStaking.sol:209-228` (_settle), `SSVStaking.sol:113-151` (claimEthRewards).

---

### XF-025: Bulk Register 50 → EB Update → Bulk Remove 25 → EB Update — vUnits Halved

**Goal:** Verify that large validator count changes combined with EB updates produce correct vUnit accounting.

**Setup:**
1. Register 7 operators.
2. Bulk register 50 validators in single call. Deposit sufficient ETH.
3. Implicit EB: `vUnits = 0` (stored), effective = `50 * 10000 = 500000`.

**Action Sequence:**

| Step | Action | Expected |
|------|--------|----------|
| 1 | Oracle commits root, `updateClusterBalance(48 ETH for 50 vals → EB = 48*50 = 2400)` | `newVUnits = ebToVUnits(2400/50_per_val=48) * 50 = 15000 * 50`... Wait — `ebToVUnits` operates on per-validator EB: `ceil(48*10000/32) = 15000`. `newVUnits = 15000 * 50?` No — `ebToVUnits(totalEB)` where `totalEB = effectiveBalance = 2400`. `newVUnits = ceil(2400*10000/32) = 750000`. `storedVUnits = 500000`. Delta = `250000` per operator and DAO. |
| 2 | Verify post-EB-update | `ebSnapshot.vUnits = 750000`. Each operator `operatorEthVUnits += 250000`. `daoTotalEthVUnits += 250000`. |
| 3 | `bulkRemoveValidator` × 25 | `validatorCount: 50 → 25`. `ebSnapshot.vUnits -= 25 * 10000 = 250000` → `ebSnapshot.vUnits = 500000`. Cluster not empty, so no deviation cleanup. |
| 4 | Oracle commits new root, `updateClusterBalance(48 ETH for 25 vals → EB = 1200)` | `newVUnits = ceil(1200*10000/32) = 375000`. `storedVUnits = 500000`. Delta = `500000 - 375000 = 125000` (DECREASE). Each `operatorEthVUnits -= 125000`. `daoTotalEthVUnits -= 125000`. |
| 5 | Verify final state | `ebSnapshot.vUnits = 375000`. Baseline = `25 * 10000 = 250000`. Deviation = `125000`. Consistent with 25 validators at 48 ETH each (48/32 = 1.5, deviation_per_val = 5000, total_deviation = 25*5000 = 125000). |

**Invariant:**
- After step 5: `operatorEthVUnits[op] == initial + 250000 (step 1) - 125000 (step 4) = initial + 125000`.
- `daoTotalEthVUnits` matches: `initial + 250000 - 125000 = initial + 125000`.

**Code path:** `SSVValidators.sol:44-51` (bulk register), `SSVClusters.sol:348-417` (updateClusterBalance), `SSVClusters.sol:494-510` (_updateOperatorVUnits), `SSVValidators.sol:70-76,153-227` (bulk remove), `SSVValidators.sol:204-223` (ebSnapshot.vUnits adjustment on removal).

---

### XF-045: EB Update + Immediate Auto-Liquidation — No Double Deviation Subtraction

**Goal:** Prove that when `_updateOperatorVUnits` adds deviation and `_executeLiquidation` subtracts it in the same transaction, the net effect is zero (deviation is cleaned up, not double-subtracted).

**Setup:**
1. Register 4 operators.
2. Register cluster with 1 validator. Deposit enough for implicit-EB threshold only.
3. Advance blocks so cluster balance is slightly above threshold at vUnits=10000.

**Action Sequence:**

| Step | Action | Storage Before | Storage After |
|------|--------|---------------|--------------|
| 1 | Record: `op1.operatorEthVUnits = X`, `daoTotalEthVUnits = D` | — | — |
| 2 | `updateClusterBalance(64 ETH)` | `storedVUnits = 0 → 10000` | `newVUnits = 20000`. Step a: `_applyClusterFeeUpdates` settles with OLD vUnits=10000. Step b: `_updateOperatorVUnits`: delta=10000, each op `+= 10000`. `daoTotalEthVUnits += 10000`. Step c: `_updateEBSnapshot`: `ebSnapshot.vUnits = 20000`. |
| 3 | `_liquidateAfterEBUpdateIfNeeded` triggers | `op1.operatorEthVUnits = X + 10000` | `_executeLiquidation`: reads `ebSnapshot.vUnits = 20000`. `baseline = 10000`. `deviation = 10000`. Each op `-= 10000`. `daoTotalEthVUnits -= 10000`. |
| 4 | Final state | — | `op1.operatorEthVUnits = X`. `daoTotalEthVUnits = D`. Net change = 0. |

**The Subtlety:**
- `_updateOperatorVUnits` at line 507 adds `deltaAbs = newVUnits - storedVUnits = 10000`.
- `_executeLiquidation` at line 588 subtracts `deviation = vUnitsCluster - baselineVUnits = 20000 - 10000 = 10000`.
- These are the SAME value because `vUnitsCluster` was already updated to `newVUnits` by `_updateEBSnapshot` at line 514.
- If the code had used `storedVUnits` (old value) in liquidation, it would subtract wrong amount.

**Code path:** `SSVClusters.sol:399-406` (EB update path), `SSVClusters.sol:494-510` (add deviation), `SSVClusters.sol:512-517` (update snapshot), `SSVClusters.sol:519-550` (auto-liquidation trigger), `SSVClusters.sol:567-596` (deviation cleanup in liquidation).

---

## Coverage Matrix

| Category | Scenarios | Count |
|----------|-----------|-------|
| Full lifecycle (register → teardown) | XF-001 through XF-004 | 4 |
| Full lifecycle with EB/fee changes | XF-005, XF-015, XF-040, XF-041 | 4 |
| SSV → ETH migration continuity | XF-006, XF-007, XF-032 | 3 |
| Multi-user / shared operators | XF-008, XF-009, XF-010, XF-011, XF-039 | 5 |
| Stress / high validator count | XF-010, XF-011, XF-025, XF-046, XF-052 | 5 |
| Time-lapse / long duration | XF-012, XF-013 | 2 |
| Same-block / rapid-fire | XF-014, XF-015, XF-016 | 3 |
| DAO parameter changes → protocol impact | XF-017, XF-018, XF-019, XF-020, XF-034, XF-044, XF-049, XF-054, XF-055 | 9 |
| Liquidation → reactivation | XF-009, XF-026, XF-027, XF-038, XF-048 | 5 |
| Staking / rewards pipeline | XF-028, XF-029, XF-030, XF-031, XF-043, XF-047, XF-053, XF-054 | 8 |
| Operator fee lifecycle → cluster impact | XF-005, XF-010, XF-021, XF-022 | 4 |
| Operator removal → cluster impact | XF-023, XF-024, XF-036, XF-050 | 4 |
| EB deviation accounting | XF-024, XF-025, XF-027, XF-036, XF-037, XF-038, XF-039, XF-041, XF-042, XF-045, XF-048 | 11 |
| Validator bulk operations | XF-025, XF-037, XF-046, XF-052 | 4 |
| Known bugs (documented) | XF-024, XF-036 | 2 |
| Edge / revert scenarios | XF-020, XF-034, XF-035, XF-044, XF-051 | 5 |
| Privacy / whitelist cross-module | XF-035 | 1 |

---

## Summary

- **Total scenarios:** 55 (XF-001 to XF-055)
- **Detailed blocks:** 12
- **Modules exercised per scenario:** 3+ (minimum)
- **Maximum modules in single scenario:** 6 (XF-017: DAO, OP, VL, CL, EB, ST)
- **Known bugs documented:** 2 (XF-024, XF-036 — operatorEthVUnits written for removed operators during EB update)
- **Revert scenarios:** 5 (XF-020, XF-034, XF-035, XF-044, XF-051)
- **Stress scenarios:** 5 (100+ validators, 10+ clusters, 1M blocks)

### Cross-References to W1 Scenarios

| XF Scenario | Related W1 Scenarios |
|-------------|---------------------|
| XF-001 to XF-004 | OP-014, VR-001, CL-021, CL-024 |
| XF-005 | OP-014, EB-040, CL-034 |
| XF-006, XF-007, XF-032 | CL-050, EB-062 |
| XF-009 | CL-004, CL-031 |
| XF-017 | DA-001 through DA-055, ST-016 |
| XF-024, XF-036 | EB-055, EB-069 |
| XF-028, XF-029 | ST-016, ST-068 |
| XF-038 | EB-051, EB-066, EB-067 |
| XF-045 | EB-051, EB-095 |

## ask-codex Review Findings

### Corrections
- XF-006/007 NOT EXECUTABLE: No SSV registration in current codebase. Current `registerValidator` writes to `s.ethClusters` (ClusterLib.sol:276). SSV clusters are legacy/preloaded state only. Fix: should use preloaded SSV cluster state, not SSV registration.
- XF-017 ORDERING WRONG: `commitRoot` before any staking reverts `ZeroCSSVSupply` at SSVDAO.sol:193. Stake must come before first root commit.
- "3+ modules per scenario" OVERSTATED: Only ~21 of 55 scenarios actually hit 3+ core modules. Many (XF-016, XF-043, XF-051 etc.) are 1-2 module chains.
- DAO invariant MISSTATED: `daoTotalEthVUnits` includes baseline via updateDAO (ProtocolLib.sol:107), not just deviation.
- ETH conservation rule INCOMPLETE: Omits `ethDaoBalance` which is protocol's actual ETH liability tracker (ProtocolLib.sol:84, SSVStaking.sol:183).
- XF-043 question about cSSV hook timing is answered in code: `CSSVToken` calls `onCSSVTransfer` in `_beforeTokenTransfer` (CSSVToken.sol:26), so settlement happens before balances move.

### Additional Scenarios
| XF-056 | all stakers exit → cSSV supply zero → commitRoot reverts | requestUnstake burns cSSV to zero (SSVStaking.sol:90). Next commitRoot reverts ZeroCSSVSupply (SSVDAO.sol:193). Live clusters can no longer get updateClusterBalance. Tests ST+DAO+CL dependency. | `entry:commitRoot; revert:yes; modules:3+` | [ ] | SSVStaking.sol:90, SSVDAO.sol:193, SSVClusters.sol:419 |
| XF-057 | whitelist module end-to-end on live cluster | setOperatorsWhitelists → existing cluster deposit/withdraw/liquidate/reactivate unaffected → new registerValidator gated by whitelist. Tests 4 modules: Whitelist+Operators+Clusters+Validators. | `entry:setOperatorsWhitelists+registerValidator; revert:partial; modules:4` | [ ] | SSVOperatorsWhitelist.sol:15,37, OperatorLib.sol:183 |
| XF-058 | mid-round oracle governance → updateClusterBalance fails | Partial votes exist, DAO raises quorum via updateQuorumBps. Next vote doesn't reach threshold, no root committed. Active cluster's updateClusterBalance fails with RootNotFound/MustUseLatestRoot. | `entry:updateClusterBalance; revert:yes; modules:3+` | [ ] | SSVDAO.sol:207,254, SSVClusters.sol:419,434 |
| XF-059 | SSVViews consistency after mutation chain | Full lifecycle: register → EB update → fee change → liquidate → reactivate. After each step verify getBurnRate, getBalance, isLiquidatable, getEffectiveBalance return consistent values. | `entry:SSVViews; revert:no; modules:5` | [ ] | SSVViews.sol:222,309,389,438 |
| XF-060 | full protocol bootstrap (corrected ordering) | Deploy → DAO params → register operators → stake cSSV → register validators → deposit → commitRoot → updateClusterBalance → fee changes → withdraw → claimEthRewards → unstake. Corrects XF-017 ordering. | `entry:all; revert:no; modules:6` | [ ] | All modules |
