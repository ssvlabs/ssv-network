# Cross-Module Scenarios: Operator x Cluster State Interactions (XO-001 to XO-065)

Wave 2 cross-module scenarios covering STATE CONTAMINATION paths between operator lifecycle/fee/earnings operations and cluster registration/deposit/withdraw/liquidation/EB-update operations.

**Prefix:** XO (cross-module: operator-cluster)
**Worker:** Wave 2
**Dependencies:** Extends W1 scenarios from OP-*, OF-*, OE-*, CL-*, EB-*

**Source files:**
- `contracts/modules/SSVOperators.sol` — operator lifecycle, fees, earnings
- `contracts/modules/SSVClusters.sol` — cluster lifecycle, deposit, withdraw, liquidate, reactivate, EB updates, migration
- `contracts/modules/SSVValidators.sol` — registerValidator, removeValidator (cluster-operator binding)
- `contracts/libraries/OperatorLib.sol` — snapshot updates, cluster operator loops, whitelist, reactivation
- `contracts/libraries/ClusterLib.sol` — balance settlement, liquidation checks, EB math

**Cross-reference convention:** `extends OP-016 + CL-031` means the scenario builds on preconditions or assertions from W1 scenarios.

---

## Code-Grounding Notes (Cross-Module Specific)

1. **Operator removal does NOT update clusters.** `removeOperator` zeroes the operator's own state (`ethSnapshot.block=0`, `ethFee=0`, `ethValidatorCount=0`) but does NOT touch any cluster's stored hash or state. Clusters discover the removal lazily — on the next cluster operation when `updateClusterOperators` skips operators with `ethSnapshot.block == 0`. (`SSVOperators.sol:71-104`, `OperatorLib.sol:247`)
2. **Removed operators contribute preserved index but zero burn rate.** In `updateClusterOperators`, the `if (operator.ethSnapshot.block != 0)` guard (line 247) skips snapshot update and fee accumulation, but `cumulativeIndex += operator.ethSnapshot.index` (line 260) always runs regardless. This means cluster fee settlement still uses the operator's frozen index.
3. **Fee changes settle operator snapshot, NOT cluster balance.** `executeOperatorFee` calls `updateSnapshotSt` which updates the operator's `ethSnapshot.balance` — but the cluster's stored balance is only settled when a cluster operation triggers `updateClusterData` or `_applyClusterFeeUpdates`. The cluster "catches up" lazily.
4. **Deposit is stateless.** `deposit()` has no owner check, no active check, no operator interaction, no fee settlement. It simply adds `msg.value` to `cluster.balance` and re-hashes. (`SSVClusters.sol:186-201`)
5. **Withdraw settles fees inline.** `withdraw()` computes burn rate and cluster index by iterating all operators in the operator ID list, settling fees on the fly. Removed operators contribute zero to `burnRate` (their `ethFee` is zeroed by `_resetOperatorState`). (`SSVClusters.sol:215-230`)
6. **registerValidator with removed operator reverts.** `updateClusterOperatorsOnRegistration` calls `ensureOperatorExist` which checks `operator.owner == address(0) || (ethSnapshot.block == 0 && snapshot.block == 0)`. After removal, `ethSnapshot.block == 0` but `owner` is preserved — so removal of an operator that has ONLY ETH history (no SSV legacy, `snapshot.block == 0`) triggers the revert. If the operator had SSV history (`snapshot.block != 0`), `ensureOperatorExist` passes but `ensureETHDefaults` re-initializes. (`OperatorLib.sol:139-143`, `OperatorLib.sol:122-133`)
7. **EB update writes to ALL operator IDs in the list including removed ones.** `_updateOperatorVUnits` iterates without checking `ethSnapshot.block`. This is the known bug (EB-055/RM1). (`SSVClusters.sol:504-509`)
8. **Liquidation decrements `ethValidatorCount` for active operators only.** `_liquidateAfterEBUpdateIfNeeded` checks `op.ethSnapshot.block != 0` before decrementing. (`SSVClusters.sol:541-543`)
9. **Reactivation restores operator deviation.** `updateClusterOperatorsOnReactivation` adds `clusterDeviation` back to `operatorEthVUnits` for active operators (`ethSnapshot.block != 0`). (`OperatorLib.sol:312-319`)

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| XO-001 | registerValidator → declareOperatorFee → executeOperatorFee → withdraw | Fee increase mid-cluster-life: verify cluster burn rate reflects new fee on next withdraw settlement | `entry:executeOperatorFee,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:146-173, SSVClusters.sol:215-230 |
| XO-002 | registerValidator → declareOperatorFee → executeOperatorFee → verify cluster balance | Fee increase changes operator index growth rate: verify cluster fee settlement uses segmented indices (old rate blocks + new rate blocks) | `entry:executeOperatorFee,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:52-72, SSVClusters.sol:219-226 |
| XO-003 | registerValidator → reduceOperatorFee → withdraw | Fee reduction mid-cluster-life: verify cluster burn rate drops and more balance is withdrawable | `entry:reduceOperatorFee,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:192-214, SSVClusters.sol:215-247 |
| XO-004 | registerValidator → removeOperator(op1) → deposit | Deposit into cluster with removed operator: succeeds (deposit has no operator checks). Extends OP-016 + CL-012 | `entry:removeOperator,deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:71-104, SSVClusters.sol:186-201 |
| XO-005 | registerValidator → removeOperator(op1) → withdraw | Withdraw from cluster with removed operator: succeeds with reduced burn rate. Removed op contributes zero to burnRate (ethFee zeroed). Extends OP-016 + CL-031 | `entry:removeOperator,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:347-358, SSVClusters.sol:219-226 |
| XO-006 | registerValidator → removeOperator(op1) → registerValidator (new validator, same cluster) | Add validator to cluster containing removed operator: reverts because `ensureOperatorExist` fails for removed ETH-only operator | `entry:removeOperator,registerValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:yes` | [ ] | OperatorLib.sol:139-143, SSVValidators.sol:105-151 |
| XO-007 | registerValidator → removeOperator(op1) → removeValidator | Remove validator from cluster with removed operator: succeeds. `updateClusterOperators` skips removed op (ethSnapshot.block==0) | `entry:removeOperator,removeValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:247-261, SSVValidators.sol:153-257 |
| XO-008 | registerValidator → removeOperator(op1) → liquidate | Liquidate cluster with removed operator: liquidation burns with 3-operator rate, bounty reflects reduced balance | `entry:removeOperator,liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:31-65, OperatorLib.sol:247-261 |
| XO-009 | registerValidator → removeOperator(op1) → reactivate | Reactivate cluster after liquidation with removed operator: reactivation skips removed op in `updateClusterOperatorsOnReactivation` (ethSnapshot.block==0) | `entry:removeOperator,reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:275-330, SSVClusters.sol:129-181 |
| XO-010 | 13 operators → removeOperator(op13) → registerValidator (new cluster with ops 1-12) | New cluster with 12 remaining operators after 1 removed: succeeds because new cluster doesn't include removed op | `entry:removeOperator,registerValidator; version:eth; eb:implicit; cluster:active; ops:12; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:71-104, SSVValidators.sol:105-151 |
| XO-011 | registerValidator → executeOperatorFee → liquidate | Fee increase makes cluster liquidatable: increased burn rate pushes cluster below threshold. Third party liquidates | `entry:executeOperatorFee,liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:146-173, SSVClusters.sol:31-65, ClusterLib.sol:67-84 |
| XO-012 | registerValidator → executeOperatorFee → withdraw (revert) | Fee increase: withdraw that was safe before fee change now breaches threshold due to higher burn rate | `entry:executeOperatorFee,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:235-247, ClusterLib.sol:67-84 |
| XO-013 | registerValidator → reduceOperatorFee → withdraw (succeeds) | Fee reduction: same withdraw amount that would revert at old fee now succeeds at new lower burn rate | `entry:reduceOperatorFee,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:192-214, SSVClusters.sol:235-247 |
| XO-014 | registerValidator → updateClusterBalance(EB=48) → executeOperatorFee → withdrawOperatorEarnings | EB increase then fee change: operator earnings settlement uses deviation-weighted vUnits at time of fee change | `entry:updateClusterBalance,executeOperatorFee,withdrawOperatorEarnings; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:385-404, SSVOperators.sol:166-168, OperatorLib.sol:52-72 |
| XO-015 | registerValidator → declareOperatorFee → updateClusterBalance(EB=48) → executeOperatorFee | Fee declared before EB update, executed after: fee settlement at execute uses post-EB vUnits. Extends OF-022 + EB-040 | `entry:declareOperatorFee,updateClusterBalance,executeOperatorFee; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:146-173, OperatorLib.sol:56-71 |
| XO-016 | registerValidator → removeOperator(op1) → updateClusterBalance(EB=48) | EB update on cluster with removed operator: THE BUG — `_updateOperatorVUnits` writes deviation to removed op. Extends OP-016 + EB-055 | `entry:removeOperator,updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:494-510, SSVOperators.sol:71-104 |
| XO-017 | registerValidator → removeOperator(op1) → updateClusterBalance(EB=48) → updateClusterBalance(EB=32) | EB increase then decrease on cluster with removed op: verify stale operatorEthVUnits[removedOp] is cleaned (or not) by decrease. Extends EB-069 | `entry:removeOperator,updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:494-510 |
| XO-018 | registerValidator → removeOperator(op1) → updateClusterBalance(EB=64) → auto-liquidation | EB increase triggers auto-liquidation on cluster with removed op: `_liquidateAfterEBUpdateIfNeeded` skips ethValidatorCount decrement for removed op. Extends EB-057 | `entry:removeOperator,updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:539-547, SSVClusters.sol:567-596 |
| XO-019 | 2 clusters share op1 → removeOperator(op1) → withdraw from cluster A | Multiple clusters sharing removed operator: cluster A's withdraw uses zero burn rate for removed op. Cluster B's separate withdraw also uses zero. Total operator earnings frozen at removal | `entry:removeOperator,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:219-226, SSVOperators.sol:71-104 |
| XO-020 | 2 clusters share op1 → removeOperator(op1) → deposit to cluster A → deposit to cluster B | Multiple clusters, removed op, deposits: both deposits succeed. Deposit is blind to operator state | `entry:removeOperator,deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:186-201 |
| XO-021 | 2 clusters share op1 → executeOperatorFee(op1) → withdraw from cluster A → withdraw from cluster B | Fee change on shared operator: both clusters settle fees using same new index rate. Total settlement = sum of per-cluster contributions at segmented rates | `entry:executeOperatorFee,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:146-173, SSVClusters.sol:215-230 |
| XO-022 | registerValidator → updateClusterBalance(EB=48) → removeOperator(op1) → withdrawOperatorEarnings(op1) | EB update, then op removal: final settlement includes EB-weighted earnings. `operatorEthVUnits[op1]` deleted after settlement | `entry:updateClusterBalance,removeOperator,withdrawOperatorEarnings; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:86-93, OperatorLib.sol:52-72 |
| XO-023 | registerValidator → updateClusterBalance(EB=48) → removeOperator(op1) → updateClusterBalance(EB=64) | EB update after op removal: second EB update writes to removed op's vUnits (already deleted by removeOperator). Deviation re-appears from zero | `entry:updateClusterBalance,removeOperator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:504-509, SSVOperators.sol:93 |
| XO-024 | registerValidator → removeOperator(op1) → withdrawOperatorEarnings(op1) | Withdraw earnings from removed operator: reverts `OperatorDoesNotExist` via `checkOwner` (ethSnapshot.block==0). Extends OE-020 | `entry:removeOperator,withdrawOperatorEarnings; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:yes` | [ ] | SSVOperators.sol:300-303, OperatorLib.sol:111-116 |
| XO-025 | registerValidator(SSV cluster) → updateClusterBalance(EB=48) → migrateClusterToETH | SSV cluster with explicit EB → migrate: migration applies deviation to operators and DAO. Extends EB-062 | `entry:updateClusterBalance,migrateClusterToETH; version:ssv; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:259-343, SSVClusters.sol:310-326 |
| XO-026 | registerValidator(SSV) → updateClusterBalance(EB=48) → removeOperator(op1) → migrateClusterToETH | Migration with removed op + explicit EB: migration writes deviation to all ops including removed. `ensureETHDefaults` re-initializes removed op's ethSnapshot | `entry:updateClusterBalance,removeOperator,migrateClusterToETH; version:ssv; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:310-326, OperatorLib.sol:343-384, OperatorLib.sol:122-133 |
| XO-027 | registerValidator → setOperatorsPrivateUnchecked(op1) → registerValidator (new validator, different owner) | Privacy change on operator with existing cluster: new validator registration by non-whitelisted owner reverts `CallerNotWhitelistedWithData`. Extends OP-034 | `entry:setOperatorsPrivateUnchecked,registerValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:183-210, SSVOperators.sol:219-222 |
| XO-028 | registerValidator → setOperatorsPrivateUnchecked(op1) → deposit | Privacy change has no effect on deposit: deposit has no whitelist check | `entry:setOperatorsPrivateUnchecked,deposit; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-201 |
| XO-029 | registerValidator → setOperatorsPrivateUnchecked(op1) → withdraw | Privacy change has no effect on withdraw: withdraw has no whitelist check | `entry:setOperatorsPrivateUnchecked,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:206-253 |
| XO-030 | registerValidator → setOperatorsPrivateUnchecked(op1) → removeValidator | Privacy change has no effect on removeValidator: no whitelist check on removal | `entry:setOperatorsPrivateUnchecked,removeValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:153-257 |
| XO-031 | registerValidator → setOperatorsPrivateUnchecked(op1) → liquidate | Privacy change has no effect on liquidation: liquidation does not check whitelist | `entry:setOperatorsPrivateUnchecked,liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:31-65 |
| XO-032 | registerValidator → setOperatorsPrivateUnchecked(op1) → reactivate | Privacy change has no effect on reactivation: `updateClusterOperatorsOnReactivation` does not check whitelist | `entry:setOperatorsPrivateUnchecked,reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:275-330, SSVClusters.sol:129-181 |
| XO-033 | registerValidator → updateClusterBalance(EB=48) → withdraw | EB increase raises liquidation threshold: withdrawal that was safe at implicit EB now reverts at explicit EB. Extends CL-029 + EB-040 | `entry:updateClusterBalance,withdraw; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:238-247, ClusterLib.sol:67-84 |
| XO-034 | registerValidator → updateClusterBalance(EB=48) → deposit → withdraw | EB increase then deposit: deposited funds offset higher threshold. Withdraw succeeds if post-deposit balance exceeds EB-weighted threshold | `entry:updateClusterBalance,deposit,withdraw; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-253, ClusterLib.sol:67-84 |
| XO-035 | registerValidator → liquidate → updateClusterBalance(EB=48) → deposit → reactivate | Inactive cluster EB update then reactivation: EB snapshot stored on liquidated cluster, reactivation uses stored vUnits for threshold. Extends EB-060 | `entry:liquidate,updateClusterBalance,reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:129-181, SSVClusters.sol:387-414, OperatorLib.sol:275-330 |
| XO-036 | registerValidator → liquidate → deposit → withdraw (no reactivation) | Deposit into liquidated cluster, withdraw without reactivating: no fee settlement, no liquidation check. Full deposit recoverable. Extends CL-035 | `entry:liquidate,deposit,withdraw; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:186-201, SSVClusters.sol:215-231 |
| XO-037 | registerValidator → liquidate → removeOperator(op1) → deposit → reactivate | Reactivation after liquidation with removed op: reactivation skips removed op for deviation restoration but still accumulates its preserved index | `entry:liquidate,removeOperator,reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:275-330, SSVClusters.sol:129-181 |
| XO-038 | registerValidator → executeOperatorFee(op1, higher) → executeOperatorFee(op2, higher) → withdraw | Multiple operators increase fees sequentially: cluster burn rate is sum of all new fees. Liquidation threshold reflects compound increase | `entry:executeOperatorFee,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:146-173, SSVClusters.sol:219-226 |
| XO-039 | registerValidator → executeOperatorFee(op1, higher) → updateClusterBalance(EB=48) → withdraw | Fee increase + EB increase compound: burn rate and threshold both increase. Balance drain accelerates. Extends OF-034 + EB-040 | `entry:executeOperatorFee,updateClusterBalance,withdraw; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVOperators.sol:146-173, SSVClusters.sol:385-404, SSVClusters.sol:238-247 |
| XO-040 | registerValidator → reduceOperatorFee(op1, to 0) → withdraw | Operator fee reduced to zero: cluster burn rate drops to 3*opFee + networkFee (only 3 remaining ops have fees). Threshold decreases | `entry:reduceOperatorFee,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:192-214, SSVClusters.sol:219-226 |
| XO-041 | registerValidator → removeOperator(op1) → removeOperator(op2) → removeOperator(op3) → removeOperator(op4) → withdraw | All 4 operators removed: cluster burn rate = 0, withdraw of entire balance succeeds (validatorCount > 0 but burn rate = 0). Extends CL-042 | `entry:removeOperator,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:219-226, SSVOperators.sol:71-104 |
| XO-042 | registerValidator → updateClusterBalance(EB=48) → removeValidator (all validators) | Remove all validators from explicit-EB cluster: `ebSnapshot.vUnits` cleaned to 0, deviation subtracted from operators and DAO | `entry:updateClusterBalance,removeValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:196-227, SSVClusters.sol:385-404 |
| XO-043 | registerValidator → updateClusterBalance(EB=48) → registerValidator (add more validators) | Add validators to explicit-EB cluster: `ebSnapshot.vUnits` incremented by `validatorsLength * BPS_DENOMINATOR`. Deviation per-operator UNCHANGED | `entry:updateClusterBalance,registerValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:136-143 |
| XO-044 | registerValidator(cluster A, ops 1-4) → registerValidator(cluster B, ops 1-4) → removeOperator(op1) → withdraw(cluster A) → withdraw(cluster B) | Two clusters share op1, op1 removed: both clusters settle with 3-operator burn rate. Operator op1's frozen index used in both | `entry:removeOperator,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:219-226, OperatorLib.sol:247-261 |
| XO-045 | registerValidator → declareOperatorFee → removeOperator → executeOperatorFee (revert) | Declare fee, then remove operator: pending request deleted. Execute reverts `OperatorDoesNotExist`. Extends OF-025 | `entry:declareOperatorFee,removeOperator,executeOperatorFee; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:yes` | [ ] | SSVOperators.sol:94, SSVOperators.sol:148, OperatorLib.sol:111-116 |
| XO-046 | registerValidator → removeOperator(op1) → reduceOperatorFee(op1) (revert) | Reduce fee on removed operator: reverts `OperatorDoesNotExist` via `checkOwner` | `entry:removeOperator,reduceOperatorFee; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:yes` | [ ] | SSVOperators.sol:194, OperatorLib.sol:111-116 |
| XO-047 | registerValidator → executeOperatorFee(op1) → withdrawOperatorEarnings(op1) → withdraw(cluster) | Operator withdraws earnings (from fee settlement), then cluster owner withdraws: verify no double-counting. Operator earnings come from snapshot accrual, cluster fees come from balance settlement | `entry:executeOperatorFee,withdrawOperatorEarnings,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:235-237, SSVClusters.sol:206-253 |
| XO-048 | registerValidator → updateClusterBalance(EB=48) → executeOperatorFee → withdrawOperatorEarnings | EB-weighted operator earnings: operator earns at 1.5x rate (EB=48, vUnits=15000). Fee change settles at this rate. Withdrawal reflects deviation-weighted accrual | `entry:updateClusterBalance,executeOperatorFee,withdrawOperatorEarnings; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:56-71, SSVOperators.sol:166-168, SSVOperators.sol:235-237 |
| XO-049 | registerValidator → executeOperatorFee(op1, higher) → liquidate → reactivate → verify burn rate | Fee change persists through liquidation-reactivation cycle: reactivated cluster uses the new (higher) fee in burn rate. Extends OF-040 | `entry:executeOperatorFee,liquidate,reactivate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:146-173, SSVClusters.sol:31-65, SSVClusters.sol:129-181 |
| XO-050 | registerValidator → updateClusterBalance(EB=48) → liquidate → reactivate → verify threshold | EB persists through liquidation-reactivation: reactivated cluster uses stored vUnits for liquidation threshold. Higher EB = higher funding required | `entry:updateClusterBalance,liquidate,reactivate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:129-181, ClusterLib.sol:67-84 |
| XO-051 | registerValidator → updateClusterBalance(EB=48) → liquidate → updateClusterBalance(EB=64) → reactivate | EB changed while liquidated: reactivation uses LATEST stored vUnits (64 ETH = 20000 vUnits). Deviation delta applied on reactivation | `entry:updateClusterBalance,liquidate,reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:129-181, OperatorLib.sol:275-330 |
| XO-052 | registerValidator → removeOperator(op1) → updateClusterBalance(EB=48) → removeValidator (empty cluster) | Remove all validators from explicit-EB cluster with removed op: deviation cleanup loop includes removed op, subtracting stale deviation | `entry:removeOperator,updateClusterBalance,removeValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:210-224, SSVClusters.sol:504-509 |
| XO-053 | registerValidator → executeOperatorFee(op1, higher) → same-block withdraw | Fee change and withdraw in same block: operator index jump from fee settlement is immediately visible to withdraw. Zero block diff but non-zero index delta | `entry:executeOperatorFee,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:166-168, SSVClusters.sol:219-226 |
| XO-054 | registerValidator → removeOperator(op1) → same-block withdraw | Operator removal and cluster withdraw in same block: cluster sees ethFee=0 and frozen index for removed op immediately | `entry:removeOperator,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperators.sol:71-104, SSVClusters.sol:219-226 |
| XO-055 | registerValidator(cluster A) → registerValidator(cluster B, same ops) → updateClusterBalance(EB=48, cluster A only) → withdrawOperatorEarnings | Two clusters, one with explicit EB: operator earnings include deviation from cluster A only. `effectiveVUnits = deviation_A + totalEthValidatorCount * BPS`. Extends OE-026 + EB-085 | `entry:updateClusterBalance,withdrawOperatorEarnings; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:52-72, SSVClusters.sol:494-510 |
| XO-056 | registerValidator → updateClusterBalance(EB=48) → executeOperatorFee → updateClusterBalance(EB=64) → withdrawOperatorEarnings | Alternating EB updates and fee changes: operator earnings are sum of segments with different (fee, vUnits) pairs. Each operation settles prior accrual | `entry:updateClusterBalance,executeOperatorFee,withdrawOperatorEarnings; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:396, SSVOperators.sol:166-168, OperatorLib.sol:52-72 |
| XO-057 | registerValidator → updateClusterBalance(EB=48) → liquidate → removeOperator(op1) → reactivate | EB cluster liquidated, op removed during liquidation, then reactivated: reactivation computes clusterDeviation from stored vUnits, applies to active ops only (skips removed) | `entry:updateClusterBalance,liquidate,removeOperator,reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:129-181, OperatorLib.sol:275-330 |
| XO-058 | registerValidator → removeOperator(op1) → 1000 blocks → withdraw → verify fee math | Long-duration removed operator: verify that 1000 blocks of accrual at 3-operator rate (not 4) produces correct fee deduction. No stale fee bleeding from removed op | `entry:removeOperator,withdraw; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:219-226 |
| XO-059 | registerValidator → updateClusterBalance(EB=48) → removeOperator(op1) → withdraw → verify fee settlement uses correct vUnits | Withdraw after op removal from explicit-EB cluster: `isLiquidatableWithEB` reads stored vUnits from `clusterEB[clusterId]`. Removed op does not reduce vUnits (no automatic cleanup). Threshold unchanged despite 3-op burn rate | `entry:updateClusterBalance,removeOperator,withdraw; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:238-247, ClusterLib.sol:67-84 |
| XO-060 | registerValidator → executeOperatorFee(all 4 ops to higher fees) → updateClusterBalance(EB=64) → auto-liquidation | Compound fee + EB increases trigger auto-liquidation: all 4 operators raised fees, then EB doubles burn rate. Cluster becomes insolvent | `entry:executeOperatorFee,updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:519-550, SSVOperators.sol:146-173 |
| XO-061 | registerValidator → removeOperator(op1) → registerOperator(new op5) → registerValidator (new cluster, ops 2,3,4,5) | Replace removed op with new op in new cluster: new cluster operates normally with ops 2-5. Old cluster retains ops 1-4 with op1 removed | `entry:removeOperator,registerOperator,registerValidator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:31-66, SSVValidators.sol:105-151 |
| XO-062 | registerValidator → executeOperatorFee(op1, higher) → withdrawOperatorEarnings(op1) → removeOperator(op1) | Withdraw operator earnings, then remove: removal final settlement should be zero (already withdrawn). No double payout | `entry:executeOperatorFee,withdrawOperatorEarnings,removeOperator; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:235-237, SSVOperators.sol:71-104 |
| XO-063 | registerValidator → reduceOperatorFee(op1, to 0) → updateClusterBalance(EB=48) → verify burn rate | Zero-fee operator + EB update: deviation still written to op1's vUnits even though fee=0. Burn rate from op1 = 0 regardless of vUnits. Other 3 ops earn at EB-weighted rate | `entry:reduceOperatorFee,updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:494-510, OperatorLib.sol:52-72 |
| XO-064 | registerValidator → updateClusterBalance(EB=48) → removeValidator (1 of 2 validators) → withdrawOperatorEarnings | Remove one validator from 2-validator explicit-EB cluster: `ebSnapshot.vUnits` decremented by 10000. Operator earnings recalculated with new effectiveVUnits | `entry:updateClusterBalance,removeValidator,withdrawOperatorEarnings; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVValidators.sol:196-227, OperatorLib.sol:52-72 |
| XO-065 | registerValidator → updateClusterBalance(EB=48) → removeOperator(op1) → withdrawOperatorEarnings(op2) → verify op2 earnings correct | Verify removed op1's stale vUnits do not contaminate op2's earnings: op2's effectiveVUnits = storedDeviation[op2] + ethValidatorCount[op2] * BPS. Independent of op1 | `entry:updateClusterBalance,removeOperator,withdrawOperatorEarnings; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:52-72 |

---

## Detailed Scenario Blocks

---

### XO-001: Fee Increase Mid-Cluster-Life — Burn Rate Reflects New Fee on Withdraw

**Purpose:** Verify that after an operator increases their fee via the declare/execute flow, a subsequent cluster `withdraw` settles fees using the updated burn rate. The cluster owner pays the old rate for blocks before the fee change and the new rate for blocks after.

**Preconditions:**
1. Register 4 operators (op1-op4) with `ethFee = 1_000_000_000` each.
2. Register validator in 4-op ETH cluster with deposit of 10 ETH. Mine 100 blocks (accrual at old rate).
3. Op1 declares fee increase to `1_100_000_000`, wait for approval window, execute.
4. Mine 100 more blocks (accrual at new rate).

**Steps:**
1. Record cluster balance before withdraw.
2. Call `withdraw(operatorIds, withdrawAmount, cluster)`.
3. Verify fee settlement in withdraw reflects segmented accrual.

**Expected Results:**
- `executeOperatorFee` calls `updateSnapshotSt(op1)` — settles op1's snapshot at old rate. `ethSnapshot.index` advances by `100 * packed(1_000_000_000)`.
- On `withdraw`, the loop computes: for op1: `index_current = ethSnapshot.index + 100 * packed(1_100_000_000)`. For ops 2-4: `index_current = ethSnapshot.index + 200 * packed(1_000_000_000)`.
- Cluster fee settlement: `indexDelta = sum(op_current_indexes) - cluster.index`. This captures the segmented rates.
- Burn rate at withdraw time: `1_100_000_000 + 3 * 1_000_000_000 = 4_100_000_000` (packed units).
- Liquidation threshold uses the new burn rate.

**Extends:** OF-022, CL-021

**Code path:** `SSVOperators.sol:166-168` (execute updates snapshot), `SSVClusters.sol:219-226` (withdraw computes current indices inline).

---

### XO-005: Withdraw from Cluster with Removed Operator — Reduced Burn Rate

**Purpose:** Verify that after operator removal, the cluster's withdraw function correctly computes a reduced burn rate by reading the removed operator's zeroed `ethFee`, while still using the operator's preserved `ethSnapshot.index` for balance settlement.

**Preconditions:**
1. Register 4 operators with `ethFee = 2_000_000_000` each.
2. Register validator, deposit 10 ETH. Mine 200 blocks.
3. Remove op1 — `_resetOperatorState` zeroes `ethFee`, `ethSnapshot.block`, `ethSnapshot.balance`, `ethValidatorCount`.
4. `ethSnapshot.index` is PRESERVED (non-zero, reflects accrual up to removal block).
5. Mine 100 more blocks.

**Steps:**
1. Call `withdraw(operatorIds, amount, cluster)`.
2. Verify fee settlement and burn rate.

**Expected Results:**
- Withdraw loop iterates ops 1-4.
- Op1: `ethSnapshot.block == 0`, so `(block.number - 0) * 0 = 0` added to index computation. BUT this is wrong — the code computes `(uint64(block.number) - operator.ethSnapshot.block) * ethFee`, where `ethSnapshot.block = 0` and `ethFee = 0`. Result: `block.number * 0 = 0`. So op1 contributes `ethSnapshot.index + 0 = preservedIndex` to clusterIndex.
- Ops 2-4: normal index computation at `2_000_000_000` rate.
- `burnRate = 0 + 3 * 2_000_000_000 = 6_000_000_000` (3-operator rate, not 4).
- Fee settlement uses index delta which includes op1's frozen index contribution.
- Liquidation threshold computed with 3-operator burn rate — lower threshold allows more withdrawal.

**Key validation:**
- Compare fee deducted: should be `(200 blocks * 4-op rate + 100 blocks * 3-op rate)` worth of fees, adjusted for when settlement happens relative to removal block.
- Actually: the cluster's stored `cluster.index` reflects the state at last settlement. The delta is computed from current operator indices minus stored cluster index. Op1's frozen index creates a one-time jump that correctly accounts for pre-removal accrual.

**Extends:** OP-016 + CL-031

**Code path:** `SSVClusters.sol:219-226` (loop), `SSVOperators.sol:347-358` (_resetOperatorState).

---

### XO-016: EB Update on Cluster with Removed Operator — THE BUG

**Purpose:** Demonstrate that `_updateOperatorVUnits` writes deviation to `operatorEthVUnits[removedOp]` even after the operator was removed (and `operatorEthVUnits[removedOp]` was deleted by `removeOperator`). This creates orphaned deviation that permanently pollutes the operator's vUnits storage.

**Preconditions:**
1. Register 4 operators, create cluster with 1 validator.
2. Remove op1 — `delete seb.operatorEthVUnits[op1]` (line 93).
3. Confirm `operatorEthVUnits[op1] == 0`.
4. Commit oracle root with `effectiveBalance=48` for the cluster.

**Steps:**
1. Call `updateClusterBalance(blockNum, owner, operatorIds, cluster, 48, proof)`.
2. Read `operatorEthVUnits[op1]` after.

**Expected Results:**
- `_updateOperatorVUnits` at SSVClusters.sol:504-509 iterates ALL 4 operatorIds.
- `storedVUnits = 0 → effectiveOld = 1 * 10000 = 10000. newVUnits = 15000. delta = 5000`.
- For each op: `operatorEthVUnits[opId] += 5000`.
- Op1 (removed): `operatorEthVUnits[op1] = 0 + 5000 = 5000`. BUG: deviation written to removed operator.
- This deviation is orphaned — it can never be cleaned through normal flows:
  - `removeOperator` already ran (it was the one that deleted it).
  - `_executeLiquidation` will subtract deviation, but only if liquidation occurs.
  - No other code path deletes `operatorEthVUnits[op1]` after initial removal.
- Impact: `daoTotalEthVUnits` is also incremented by 5000 (via `updateDAOEthVUnits`), creating a permanent DAO accounting mismatch since op1's deviation is orphaned.

**Extends:** OP-016, EB-055

**Code path:** `SSVClusters.sol:504-509` (no `ethSnapshot.block != 0` check), `SSVOperators.sol:93` (delete on removal).

---

### XO-019: Multiple Clusters Sharing Removed Operator — Each Cluster Affected

**Purpose:** Verify that when two clusters share an operator and that operator is removed, BOTH clusters correctly compute reduced burn rates on subsequent operations, and the operator's preserved index is consistently used by both.

**Preconditions:**
1. Register 4 operators with `ethFee = 1_000_000_000`.
2. Create cluster A (owner1, ops 1-4, 1 validator). Create cluster B (owner2, ops 1-4, 2 validators).
3. Op1: `ethValidatorCount = 3` (1 from A + 2 from B).
4. Mine 100 blocks.
5. Remove op1 — `ethValidatorCount` zeroed, `ethFee` zeroed, `ethSnapshot.block` zeroed. Final earnings settled include vUnits from 3 validators.
6. Mine 100 more blocks.

**Steps:**
1. Cluster A owner calls `withdraw(operatorIds, amountA, clusterA)`.
2. Cluster B owner calls `withdraw(operatorIds, amountB, clusterB)`.

**Expected Results:**
- Both withdrawals compute `burnRate = 3 * 1_000_000_000` (3 active operators).
- Op1's preserved `ethSnapshot.index` is used in both cluster index computations.
- Cluster A fee settlement: 200 total blocks, but the index delta encodes: 100 blocks at 4-op rate + 100 blocks at 3-op rate (via the index jumps).
- Cluster B fee settlement: same index delta computation, but multiplied by `vUnits/BPS_DENOMINATOR * validatorCount` (2 validators).
- No interference between cluster A and cluster B settlements — each uses independent cluster state but same operator indices.

**Extends:** OE-025, OP-016

**Code path:** `SSVClusters.sol:219-226`, `SSVOperators.sol:347-358`.

---

### XO-035: Inactive Cluster EB Update Then Reactivation — vUnits Carry Forward

**Purpose:** Verify the full lifecycle: cluster liquidated, EB updated while inactive (snapshot stored but no fee/deviation changes), then reactivated with the new EB. The reactivation must use the stored vUnits for the liquidation check AND restore deviation to operators.

**Preconditions:**
1. Register 4 operators, create cluster with 1 validator, deposit enough for short runway.
2. Advance blocks until cluster is liquidatable. Liquidate — `cluster.active = false`, deviation cleaned via `_executeLiquidation`.
3. Commit oracle root with `effectiveBalance=64` for the liquidated cluster.
4. Call `updateClusterBalance` on liquidated cluster — only EB snapshot stored (line 404), no fee/deviation updates (lines 395-403 guarded by `cluster.active`).

**Steps:**
1. Deposit sufficient ETH into the liquidated cluster.
2. Call `reactivate(operatorIds, cluster)`.

**Expected Results:**
- `reactivate` reads `seb.clusterEB[hashedCluster].vUnits = 20000` (stored by EB update while inactive).
- `effectiveVUnits = 20000` (stored vUnits > 0, used instead of baseline).
- `clusterDeviation = 20000 - (1 * 10000) = 10000`.
- `updateClusterOperatorsOnReactivation` adds `clusterDeviation = 10000` to each active operator's `operatorEthVUnits`.
- `sp.daoTotalEthVUnits += 10000`.
- Liquidation check uses `isLiquidatableWithVUnits(20000, ...)` — threshold is 2x baseline.
- If deposit is insufficient for the 2x threshold, reactivation reverts `InsufficientBalance`.

**Extends:** EB-060, CL-020

**Code path:** `SSVClusters.sol:142-145` (read stored vUnits), `SSVClusters.sol:161-171` (liquidation check with vUnits), `OperatorLib.sol:312-319` (restore deviation).

---

### XO-039: Compound Fee Increase + EB Increase — Burn Rate Double-Hit

**Purpose:** Verify that a fee increase followed by an EB increase creates a compound effect on burn rate and liquidation threshold. The fee increase changes the per-operator rate; the EB increase multiplies the threshold by the vUnits ratio. Together, they can rapidly make a cluster insolvent.

**Preconditions:**
1. Register 4 operators with `ethFee = 1_000_000_000` each.
2. Create cluster with 1 validator, deposit 5 ETH. `networkFee = 500_000_000`.
3. Baseline burn rate: `4 * 1_000_000_000 + 500_000_000 = 4_500_000_000` packed. Threshold at vUnits=10000.
4. Declare and execute fee increase for all 4 operators to `2_000_000_000`.
5. New burn rate: `4 * 2_000_000_000 + 500_000_000 = 8_500_000_000`. Already nearly double.

**Steps:**
1. Commit oracle root with `effectiveBalance=64`.
2. Call `updateClusterBalance` — new vUnits = 20000, threshold multiplied by 2.
3. Check if auto-liquidation triggers.

**Expected Results:**
- `_applyClusterFeeUpdates` settles fees at old vUnits (10000 if first EB update) with the new higher fees.
- `_updateOperatorVUnits` applies deviation: +10000 per operator.
- `_liquidateAfterEBUpdateIfNeeded` checks threshold: `minimumBlocksBeforeLiquidation * 8_500_000_000 * 20000 / 10000 * 100000`.
- The compound effect: burn rate doubled (fee increase) AND threshold multiplied by 2 (EB), making the effective threshold 4x the original.
- If cluster balance cannot cover 4x the original threshold, auto-liquidation triggers.

**Extends:** OF-034, EB-051

**Code path:** `SSVOperators.sol:146-173`, `SSVClusters.sol:396`, `SSVClusters.sol:519-550`.

---

### XO-042: Remove All Validators from Explicit-EB Cluster — Deviation Cleanup

**Purpose:** Verify that removing all validators from a cluster with explicit EB tracking triggers full deviation cleanup: `ebSnapshot.vUnits` set to 0, deviation subtracted from all operators' `operatorEthVUnits`, and DAO `daoTotalEthVUnits` adjusted.

**Preconditions:**
1. Register 4 operators, create cluster with 2 validators.
2. `updateClusterBalance` with `effectiveBalance=96` (48 ETH/val). `vUnits = 30000`, baseline = `2 * 10000 = 20000`, deviation = 10000.
3. Each operator has `operatorEthVUnits[opId] += 10000`. `daoTotalEthVUnits += 10000`.

**Steps:**
1. Remove validator 1: `validatorCount = 1`. `ebSnapshot.vUnits -= 10000 = 20000`. `validatorCount != 0`, no cleanup.
2. Remove validator 2: `validatorCount = 0`. `ebSnapshot.vUnits -= 10000 = 10000`. Since `validatorCount == 0`:
   - `remainingVUnits = 10000` (pure deviation, no baseline left).
   - For each operator: `operatorEthVUnits[opId] -= 10000`.
   - `sp.updateDAOEthVUnits(10000, 0)` — subtracts deviation from DAO.
   - `ebSnapshot.vUnits = 0`.

**Expected Results:**
- After removing all validators: `ebSnapshot.vUnits == 0` (explicit EB tracking cleared).
- Each operator: `operatorEthVUnits[opId]` returned to pre-EB-update value (deviation fully cleaned).
- `daoTotalEthVUnits` returned to pre-EB-update value.
- Cluster's `validatorCount == 0`, `cluster.active == true`.
- Future operations on this cluster treat it as having no EB tracking.

**Code path:** `SSVValidators.sol:196-227` (removeValidator deviation cleanup), specifically lines 204-224.

---

### XO-049: Fee Change Persists Through Liquidation-Reactivation Cycle

**Purpose:** Verify that an operator's fee change made BEFORE a cluster is liquidated is still in effect when the cluster is reactivated. The reactivation does not reset operator fees — it reads the current state.

**Preconditions:**
1. Register 4 operators with `ethFee = 1_000_000_000`.
2. Create cluster with 1 validator, deposit minimal ETH.
3. Op1 increases fee to `2_000_000_000` via declare/execute.
4. Advance blocks, cluster becomes liquidatable. Third party liquidates.
5. Cluster is now inactive. Op1's fee remains `2_000_000_000`.

**Steps:**
1. Deposit sufficient ETH into the liquidated cluster.
2. Call `reactivate(operatorIds, cluster)`.
3. Mine blocks, call `withdraw` to observe the burn rate.

**Expected Results:**
- `updateClusterOperatorsOnReactivation` reads each operator's current `ethFee`. Op1: `2_000_000_000` (not reset by liquidation).
- `cumulativeFee = 2_000_000_000 + 3 * 1_000_000_000 = 5_000_000_000`.
- Burn rate on reactivated cluster: `5_000_000_000` (higher than original `4_000_000_000`).
- Liquidation threshold at reactivation uses `5_000_000_000` burn rate.
- If reactivation deposit is barely above old threshold, it may fail at new threshold — revert `InsufficientBalance`.

**Extends:** OF-040

**Code path:** `SSVClusters.sol:129-181` (reactivate), `OperatorLib.sol:275-330` (reads current operator state).

---

### XO-057: EB Cluster Liquidated, Op Removed, Then Reactivated — Deviation Reconstruction

**Purpose:** Verify the complex lifecycle where a cluster with explicit EB is liquidated (deviation cleaned), an operator is removed during the liquidated period, and then the cluster is reactivated. The reactivation must correctly restore deviation to only the active operators, skipping the removed one.

**Preconditions:**
1. Register 4 operators, create cluster with 1 validator.
2. `updateClusterBalance` with `effectiveBalance=48` — vUnits=15000, deviation=5000.
3. Liquidate cluster — `_executeLiquidation` subtracts 5000 from each operator's `operatorEthVUnits`.
4. Remove op1 — `delete seb.operatorEthVUnits[op1]`, `ethSnapshot.block = 0`.

**Steps:**
1. Deposit sufficient ETH into liquidated cluster.
2. Call `reactivate(operatorIds, cluster)`.

**Expected Results:**
- `seb.clusterEB[hashedCluster].vUnits = 15000` (stored by EB update, NOT cleared by liquidation).
- `reactivate` computes: `effectiveVUnits = 15000`, `clusterDeviation = 15000 - 10000 = 5000`.
- `updateClusterOperatorsOnReactivation` iterates ops 1-4:
  - Op1: `ethSnapshot.block == 0` — SKIPPED. Deviation NOT restored to op1. Op1 does not contribute to cumulativeFee.
  - Ops 2-4: `ethSnapshot.block != 0` — `operatorEthVUnits[opId] += 5000`. Each contributes to cumulativeFee.
- `sp.daoTotalEthVUnits += 5000`.
- Burn rate at reactivation: `3 * opFee + networkFee` (3 active operators).
- Liquidation threshold uses `effectiveVUnits = 15000` (from stored vUnits), but burn rate is 3-operator.
- This creates an asymmetry: threshold is based on the full cluster vUnits (which includes the removed op's weight), but burn rate only includes 3 operators. The threshold is higher than what the active burn rate warrants.

**Key finding:** The cluster is "over-collateralized" relative to its actual burn rate because the vUnits reflect all 4 operators' deviation while only 3 contribute to the burn. This is a design trade-off, not a bug — the EB floor is validators * 32 ETH regardless of operator count.

**Extends:** EB-057, OP-039

**Code path:** `SSVClusters.sol:129-181`, `OperatorLib.sol:291,312-319,327-329`.

---

### XO-060: Compound Fee + EB Increases Trigger Auto-Liquidation

**Purpose:** Verify the extreme state contamination path where all 4 operators raise their fees, then an EB update doubles the effective rate, triggering auto-liquidation. The combined effect makes a well-funded cluster suddenly insolvent.

**Preconditions:**
1. Register 4 operators with `ethFee = 1_000_000_000`. `networkFee = 500_000_000`.
2. Create cluster with 1 validator, deposit 3 ETH.
3. `minimumBlocksBeforeLiquidation = 100_000`.
4. Original threshold: `100_000 * (4_000_000_000 + 500_000_000) * 10000 / 10000 * 100_000 = 45 ETH`. This should already be liquidatable at 3 ETH but assume lower parameters.
5. (Adjust: `minimumBlocksBeforeLiquidation = 1000`, `ethFee = 100_000_000`, `networkFee = 50_000_000`.)
6. Original threshold: `1000 * (400_000_000 + 50_000_000) * 10000 / 10000 * 100_000 = 0.045 ETH`. Cluster is safe at 3 ETH.
7. All 4 operators increase fee to `500_000_000`. New burn rate: `2_000_000_000 + 50_000_000 = 2_050_000_000`.
8. New threshold at implicit EB: `1000 * 2_050_000_000 * 10000 / 10000 * 100_000 = 0.205 ETH`. Still safe at 3 ETH (after fee settlement).

**Steps:**
1. Commit oracle root with `effectiveBalance=64`.
2. Call `updateClusterBalance` — new vUnits = 20000.
3. Threshold: `1000 * 2_050_000_000 * 20000 / 10000 * 100_000 = 0.41 ETH`. Still safe.
4. But fee settlement during `_applyClusterFeeUpdates` may have consumed significant balance. If 2000 blocks passed at the higher burn rate: `2000 * 2_050_000_000 * 10000 / 10000 * 100_000 = 0.41 ETH` consumed. Remaining: ~2.59 ETH. Safe.
5. With higher parameters or longer duration, auto-liquidation triggers.

**Expected Results:**
- `_applyClusterFeeUpdates` settles fees at OLD vUnits (10000) first.
- `_updateOperatorVUnits` applies new deviation (+10000 per operator).
- `_liquidateAfterEBUpdateIfNeeded` checks with new vUnits (20000).
- If balance < new threshold: auto-liquidation fires.
- `_executeLiquidation`: deviation cleaned from all operators, `ethValidatorCount` decremented, balance transferred to msg.sender (liquidator, could be the EB update caller).
- `ClusterLiquidated` event emitted after `ClusterBalanceUpdated`.

**Code path:** `SSVOperators.sol:146-173`, `SSVClusters.sol:396-406`, `SSVClusters.sol:519-612`.

---

### XO-065: Removed Op1's Stale vUnits Do NOT Contaminate Op2's Earnings

**Purpose:** Verify the independence of operator earnings calculations. After op1 is removed and an EB update writes stale deviation to `operatorEthVUnits[op1]`, op2's earnings are still correctly computed using only op2's own `operatorEthVUnits[op2]` and `ethValidatorCount`.

**Preconditions:**
1. Register 4 operators, create cluster with 1 validator.
2. `updateClusterBalance` with `effectiveBalance=48` — deviation=5000 per operator.
3. Remove op1 — `delete seb.operatorEthVUnits[op1]`, `ethValidatorCount=0`.
4. `updateClusterBalance` again with `effectiveBalance=64` — delta from 15000 to 20000 = 5000 per op.
5. Op1: `operatorEthVUnits[op1] = 0 + 5000 = 5000` (stale, BUG).
6. Op2: `operatorEthVUnits[op2] = 5000 + 5000 = 10000` (legitimate).

**Steps:**
1. Mine 100 blocks.
2. Call `withdrawOperatorEarnings(op2, amount)`.
3. Verify op2's earnings match expectation.

**Expected Results:**
- `updateSnapshotSt(op2)` at OperatorLib.sol:52-72:
  - `storedDeviation = seb.operatorEthVUnits[op2] = 10000`.
  - `effectiveVUnits = 10000 + (op2.ethValidatorCount * 10000)`.
  - Op2's `ethValidatorCount` reflects ALL clusters op2 serves (at least 1 from our cluster, potentially more).
  - `delta = (blockDiffEthFee * effectiveVUnits) / BPS_DENOMINATOR`.
- Op2's earnings are computed entirely from op2's own state — `operatorEthVUnits[op2]` and `op2.ethValidatorCount`.
- Op1's stale `operatorEthVUnits[op1] = 5000` has NO effect on op2's calculation.
- However, `daoTotalEthVUnits` is inflated by op1's stale 5000, which could affect DAO-level accounting (network fee distribution).

**Key validation:** op2's actual earned ETH = `(100 * packedFee * effectiveVUnits_op2) / BPS_DENOMINATOR`. Compare against baseline (no EB) and explicit-EB expectations. Must match the EB-weighted formula exactly, independent of op1's state.

**Code path:** `OperatorLib.sol:52-72` (each operator's earnings computed from its own storage independently).

---

## Coverage Matrix

| Cross-Module Path | Scenarios Covering |
|---|---|
| **Op fee change → cluster burn rate** | XO-001, XO-002, XO-003, XO-012, XO-013, XO-038, XO-040, XO-053 |
| **Op removal → cluster deposit** | XO-004, XO-020 |
| **Op removal → cluster withdraw** | XO-005, XO-019, XO-041, XO-044, XO-054, XO-058, XO-059 |
| **Op removal → add validator (revert)** | XO-006 |
| **Op removal → remove validator** | XO-007 |
| **Op removal → liquidation** | XO-008, XO-018 |
| **Op removal → reactivation** | XO-009, XO-037, XO-057 |
| **Op removal → EB update (THE BUG)** | XO-016, XO-017, XO-023, XO-052 |
| **Op fee change → EB update → compound** | XO-039, XO-060, XO-063 |
| **EB update → op fee change → operator earnings** | XO-014, XO-015, XO-048, XO-056 |
| **EB update → cluster withdraw threshold** | XO-033, XO-034 |
| **EB update → remove all validators (cleanup)** | XO-042, XO-064 |
| **EB update → add validators** | XO-043 |
| **Liquidation → EB update → reactivation** | XO-035, XO-050, XO-051 |
| **Op fee change → liquidation → reactivation** | XO-011, XO-049 |
| **Op removal → new cluster with remaining ops** | XO-010, XO-061 |
| **Op removal → op fee changes (revert)** | XO-045, XO-046 |
| **Op removal → operator earnings (revert)** | XO-024 |
| **Op earnings + cluster withdraw (no double-count)** | XO-047, XO-062 |
| **Privacy change → cluster operations** | XO-027, XO-028, XO-029, XO-030, XO-031, XO-032 |
| **Migration + EB + removal** | XO-025, XO-026 |
| **Multiple clusters sharing operator** | XO-019, XO-020, XO-021, XO-044, XO-055 |
| **Removed op vUnits isolation** | XO-065 |

---

## State Contamination Risk Matrix

| Operation A (Side Effect) | Operation B (Victim) | Risk Level | Scenarios |
|---|---|---|---|
| `removeOperator` zeroes ethFee | `withdraw` computes burn rate from ethFee | Medium — Burn rate silently drops. Works correctly but surprising. | XO-005, XO-041, XO-058 |
| `removeOperator` zeroes ethSnapshot.block | `registerValidator` calls `ensureOperatorExist` | High — Revert path for ETH-only removed ops | XO-006 |
| `removeOperator` deletes operatorEthVUnits | `_updateOperatorVUnits` writes back | Critical (BUG) — Orphaned deviation after EB update | XO-016, XO-017, XO-023, XO-052 |
| `executeOperatorFee` changes index growth rate | `withdraw` settles fees using current indices | Low — Works correctly via segmented index accumulation | XO-001, XO-002 |
| `executeOperatorFee` changes burn rate | `isLiquidatableWithEB` threshold check | Medium — Threshold unchanged but affordability changed | XO-011, XO-012 |
| `_updateOperatorVUnits` changes deviation | `updateSnapshotSt` reads deviation for earnings | Low — Works correctly; each op reads its own storage | XO-014, XO-048, XO-065 |
| `_executeLiquidation` removes deviation | `reactivate` restores deviation | Medium — Asymmetry if op removed between liquidation and reactivation | XO-057 |
| `setOperatorsPrivateUnchecked` sets whitelisted | `deposit`/`withdraw`/`liquidate`/`reactivate` | None — These ops do not check whitelist | XO-028-032 |

---

## Summary

- **Total scenarios:** 65 (XO-001 to XO-065)
- **Detailed blocks:** 11
- **Revert scenarios:** 6 (XO-006, XO-012, XO-024, XO-033, XO-045, XO-046)
- **Bug-documenting scenarios:** 4 (XO-016, XO-017, XO-023, XO-052) — THE BUG: `_updateOperatorVUnits` writes to removed operators
- **Multi-cluster scenarios:** 7 (XO-019, XO-020, XO-021, XO-044, XO-055, XO-010, XO-061)
- **Compound state-change scenarios:** 6 (XO-039, XO-049, XO-050, XO-051, XO-056, XO-060)
- **Privacy/whitelist boundary scenarios:** 6 (XO-027 to XO-032)
- **Migration cross-paths:** 2 (XO-025, XO-026)
- **W1 cross-references:** 30+ explicit references to OP-*, OF-*, OE-*, CL-*, EB-* scenarios

## ask-codex Review Findings

### Corrections
- XO-041 WRONG: Removing all 4 operators does NOT let owner drain balance while validators exist — liquidation guard at SSVClusters.sol:235 still enforces collateral floor. Fix: should be a revert scenario.
- XO-022 UNREACHABLE: `withdrawOperatorEarnings` after removal reverts in `checkOwner` because `_resetOperatorState` zeros snapshot blocks at SSVOperators.sol:347. Fix: mark as revert.
- XO-006 WRONG: Note 6 claims prior SSV-history branch survives removal — false. `removeOperator` zeros `snapshot.block` at SSVOperators.sol:351, so `ensureOperatorExist` at OperatorLib.sol:139 always reverts.
- XO-026 WRONG MECHANISM: Doc says migration revives removed operator via `ensureETHDefaults` — in code, removed operators are skipped entirely (OperatorLib.sol:363). Real contamination is the deviation loop at SSVClusters.sol:320.
- XO-005 withdraw path misdescribed: `withdraw` doesn't skip removed operators — it always adds `ethSnapshot.index + (block - ethSnapshot.block) * ethFee` at SSVClusters.sol:219. Lower burn rate comes from zeroed `ethFee`, not a branch.
- Scope drift: XO-004 duplicates CL-012, XO-005 duplicates CL-031, XO-036 duplicates CL-035, XO-016/018/023 duplicate EB-055/057/069.

### Additional Scenarios
| XO-066 | removeOperator → liquidate (no EB update between) | Explicit-EB cluster: removeOperator deletes operatorEthVUnits at SSVOperators.sol:93, then _executeLiquidation subtracts deviation for ALL operatorIds at SSVClusters.sol:587 → underflow revert. Cluster becomes unliquidatable. | `entry:liquidate; bug:removed-op; revert:yes` | [ ] | SSVOperators.sol:93, SSVClusters.sol:587 |
| XO-067 | removeOperator → removeValidator (last) | Explicit-EB cluster: removeOperator then remove last validator. Cleanup loop at SSVValidators.sol:217 subtracts deviation from zero → underflow revert. Cluster becomes unremovable. | `entry:bulkRemoveValidator; bug:removed-op; revert:yes` | [ ] | SSVOperators.sol:93, SSVValidators.sol:217 |
| XO-068 | removeOperator (shared) → other cluster EB update | Shared operator across 2 explicit-EB clusters. removeOperator wipes operatorEthVUnits globally (SSVOperators.sol:93). Second cluster's EB decrease at SSVClusters.sol:508 underflows from wiped state. | `entry:updateClusterEB; bug:shared-op; revert:yes` | [ ] | SSVOperators.sol:93, SSVClusters.sol:508 |
| XO-069 | reactivate with hasDeviation=true from other cluster | Another explicit-EB cluster's deviation makes hasDeviation=true. Reactivation adds to existing deviation at OperatorLib.sol:313 instead of initializing. Tests additive path not covered by XO-035/057. | `entry:reactivate; revert:no` | [ ] | OperatorLib.sol:285, 313 |
