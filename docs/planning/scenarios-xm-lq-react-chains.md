# Cross-Module Scenarios — Liquidation / Reactivation State Chains (XL-001 to XL-065)

**Prefix:** XL
**Worker:** W2-XM
**Wave:** 2 — Cross-Module Multi-Step Chains
**Source contracts:** `SSVClusters.sol` (liquidate, reactivate, updateClusterBalance, _executeLiquidation, _liquidateAfterEBUpdateIfNeeded, _updateOperatorVUnits, _applyClusterFeeUpdates, deposit, withdraw), `OperatorLib.sol` (updateClusterOperators, updateClusterOperatorsOnReactivation, updateSnapshotSt, removeOperator/_resetOperatorState), `ClusterLib.sol` (isLiquidatableWithEB, isLiquidatableWithVUnits, getVUnits, ebToVUnits, updateBalanceWithEB, updateClusterOnRegistration)
**Spec refs:** SPEC §1 "Cluster Flows", SPEC §2 "Effective Balance Accounting" (Stale EB Risk, Operator vUnit Deviation Cleanup on Liquidation, Deviation-Only Model), FLOWS §1.9-1.11
**Cross-refs:** LQ-001..080 (W1 liquidation/reactivation), EB-031..100 (W1 EB updates), OP-001..040 (W1 operator lifecycle)

**KEY BUG CONTEXT:** `_updateOperatorVUnits` (SSVClusters.sol:504-509) iterates all operatorIds without checking `operator.ethSnapshot.block != 0`. Removed operators accumulate stale deviation in `operatorEthVUnits`. Real `removeOperator` deletes `operatorEthVUnits[id]` (SSVOperators.sol:93), but mock `mockRemoveOperator` does not. Guard pattern: `if (s.operators[operatorId].ethSnapshot.block == 0) continue;`

---

## Full Cycle: Active -> EB Update -> Liquidate -> Reactivate -> EB Update (XL-001 to XL-010)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| XL-001 | register -> updateClusterBalance -> liquidate -> reactivate -> updateClusterBalance | Full lifecycle: register 4-op cluster, EB update 32->48, time-drain to liquidation, reactivate with deposit, second EB update 48->64. Verify all deviation accounting round-trips correctly across the full cycle | `chain:full-cycle; version:eth; eb:explicit; cluster:active->liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:348-417,129-181,31-65,552-612; OperatorLib.sol:233-262,275-330; ClusterLib.sol:67-84,96-112,366-371 |
| XL-002 | register -> updateClusterBalance -> liquidate -> reactivate -> updateClusterBalance | Same as XL-001 but with 7 operators. Verify all 7 operators' ethValidatorCount and operatorEthVUnits are correct at every stage | `chain:full-cycle; version:eth; eb:explicit; cluster:active->liquidated->active; ops:7; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:348-417,129-181,31-65; OperatorLib.sol:233-262,275-330 |
| XL-003 | register -> updateClusterBalance -> liquidate -> reactivate -> updateClusterBalance | Full cycle with EB decrease on second update: first 32->64, liquidate, reactivate, then 64->48. Deviation decreases after reactivation. Verify operatorEthVUnits subtracted correctly for each operator | `chain:full-cycle; version:eth; eb:explicit; cluster:active->liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:494-510,552-596,129-181 |
| XL-004 | register -> updateClusterBalance -> liquidate -> reactivate | Full cycle with implicit EB throughout: no explicit EB update, register cluster, drain to liquidation, reactivate. Verify vUnitsCluster=0 handled correctly in both _executeLiquidation (no deviation cleanup) and reactivation (effectiveVUnits = baseline) | `chain:full-cycle; version:eth; eb:implicit; cluster:active->liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:569-597,142-145; ClusterLib.sol:285-297 |
| XL-005 | register -> updateClusterBalance -> liquidate -> reactivate -> updateClusterBalance | Verify DAO invariant across full cycle: daoTotalEthVUnits == ethDaoValidatorCount * BPS + sum(all active cluster deviations) at every step. Explicit EB 32->48->liquidate->reactivate->48->64 | `chain:full-cycle-invariant; version:eth; eb:explicit; cluster:active->liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:562,174-176,402; ProtocolLib.sol:updateDAO,updateDAOEthVUnits |
| XL-006 | register -> updateClusterBalance -> self-liquidate -> reactivate | Self-liquidation mid-cycle: owner liquidates above threshold (bypasses isLiquidatableWithEB), reactivates with fresh deposit. Verify deviation cleaned on self-liquidation and re-added on reactivation | `chain:full-cycle; version:eth; eb:explicit; cluster:active->liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:52,552-596,142-145,174-176 |
| XL-007 | register -> updateClusterBalance -> liquidate -> reactivate -> deposit -> updateClusterBalance | Full cycle with deposit between reactivation and second EB update. Verify balance = msg.value(reactivate) + msg.value(deposit), and EB update settles fees against accumulated balance | `chain:full-cycle; version:eth; eb:explicit; cluster:active->liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:156,186-201,461-492 |
| XL-008 | register -> updateClusterBalance -> liquidate -> deposit -> reactivate | Deposit on liquidated cluster BEFORE reactivation: balance = prior_deposit + msg.value(reactivate). Verify solvency check uses total accumulated balance | `chain:full-cycle; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:156,161-171; ClusterLib.sol:96-112 |
| XL-009 | register -> updateClusterBalance -> auto-liquidate -> reactivate | EB increase triggers auto-liquidation via _liquidateAfterEBUpdateIfNeeded, then reactivation. Verify ethValidatorCount decremented in _liquidateAfterEBUpdateIfNeeded (lines 539-544) is correctly re-incremented on reactivation | `chain:auto-liq-cycle; version:eth; eb:explicit; cluster:active->liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:519-550,129-181; OperatorLib.sol:275-330 |
| XL-010 | register -> updateClusterBalance -> auto-liquidate -> reactivate -> updateClusterBalance | Auto-liquidation then reactivation then second EB update. Verify deviation accounting: auto-liq cleans up deviation, reactivation re-adds it (if cluster had stored vUnits), second update applies incremental delta | `chain:auto-liq-cycle; version:eth; eb:explicit; cluster:active->liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:519-550,142-145,494-510,552-596 |

---

## Operator Removal Before Liquidation — THE BUG Chains (XL-011 to XL-020)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| XL-011 | register -> updateClusterBalance -> removeOperator -> liquidate | THE BUG PATH: EB update writes deviation to all 4 ops including op4. Remove op4 (deletes operatorEthVUnits[op4]). Liquidate. _executeLiquidation subtracts deviation from operatorEthVUnits[op4] which is now 0 — underflow risk. Verify guard prevents underflow or arithmetic is safe | `chain:bug-path; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:494-510,586-592; SSVOperators.sol:93; OperatorLib.sol:247 |
| XL-012 | register -> updateClusterBalance -> removeOperator -> updateClusterBalance -> liquidate | Double EB update with removed operator between them: first update 32->48 (deviation +5000 to all 4 ops), remove op4 (deletes operatorEthVUnits[op4]), second update 48->64 (writes +5000 to op4 again via _updateOperatorVUnits). Liquidate: deviation cleanup subtracts 20000 from op4 which has only 5000. Underflow | `chain:bug-path-double; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:504-509,586-592; SSVOperators.sol:93 |
| XL-013 | register -> updateClusterBalance -> removeOperator -> updateClusterBalance(auto-liq) | Auto-liquidation path with removed operator: EB update pushes cluster below threshold. _liquidateAfterEBUpdateIfNeeded skips removed op for ethValidatorCount (line 541). _executeLiquidation subtracts deviation from removed op's operatorEthVUnits. Verify guard pattern needed | `chain:bug-path-auto-liq; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:539-544,586-592,504-509 |
| XL-014 | register -> updateClusterBalance -> removeOperator -> removeOperator -> liquidate | Two operators removed after EB update: deviation written to all 4, remove op3 + op4. Liquidate: deviation cleanup iterates all 4, subtracts from deleted slots. Verify both removed operators handled correctly | `chain:bug-path-multi-remove; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:504-509,586-592; SSVOperators.sol:93 |
| XL-015 | register -> removeOperator -> updateClusterBalance -> liquidate | Operator removed BEFORE EB update: op4 removed (operatorEthVUnits[op4] = 0), EB update 32->48 writes +5000 to op4 via _updateOperatorVUnits (no guard). Liquidate cleans up. Stale deviation accumulates on dead operator | `chain:bug-path-remove-first; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:504-509; SSVOperators.sol:93 |
| XL-016 | register -> updateClusterBalance -> removeOperator -> updateClusterBalance(decrease) -> liquidate | EB update 32->48 (adds deviation), remove op4, EB update 48->32 (subtracts deviation). _updateOperatorVUnits subtracts 5000 from operatorEthVUnits[op4] which was deleted — underflow or wraps to max uint64 | `chain:bug-path-decrease; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:504-509,508; SSVOperators.sol:93 |
| XL-017 | register -> updateClusterBalance -> removeOperator -> reactivate | EB update, then op removed, then cluster liquidates naturally, then reactivation with dead op. updateClusterOperatorsOnReactivation skips removed op (line 291). clusterDeviation re-added only to active operators. Verify deviation accounting asymmetry: was added to 4 ops, removed from 4 on liquidation, re-added to only 3 on reactivation | `chain:bug-path-reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:142-145; OperatorLib.sol:291,312-319; SSVClusters.sol:586-592 |
| XL-018 | register -> removeOperator -> updateClusterBalance -> reactivate | Operator removed before any EB update, then EB update writes stale deviation to dead op, then cluster liquidates + reactivates. Verify daoTotalEthVUnits drift: EB update adds to DAO, liquidation subtracts from DAO, but deviation was written to dead op that never gets properly cleaned | `chain:bug-path-dao-drift; version:eth; eb:explicit; cluster:active->liquidated->active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:402,578,175; SSVOperators.sol:93 |
| XL-019 | register -> updateClusterBalance -> mockRemoveOperator -> liquidate | THE EXACT BUG: mockRemoveOperator does NOT delete operatorEthVUnits[op4]. EB update wrote +5000 to op4. Mock removal zeroes ethSnapshot.block but leaves operatorEthVUnits[op4] = 5000. Liquidation _executeLiquidation subtracts deviation correctly. Compare to XL-011 (real removeOperator) which deletes the slot first | `chain:bug-mock-vs-real; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:mock; revert:no` | [ ] | SSVClusters.sol:586-592; SSVOperators.sol:93,347-358 |
| XL-020 | register -> updateClusterBalance -> removeOperator -> updateClusterBalance -> removeOperator -> liquidate | Chained: EB update 32->48, remove op4, EB update 48->64 (writes to dead op4), remove op3 (deletes operatorEthVUnits[op3]), liquidate. Two dead operators with different deviation states. Verify cleanup handles both | `chain:bug-path-chained; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:504-509,586-592; SSVOperators.sol:93 |

---

## Operator Removal After Liquidation — Reactivation With Dead Operators (XL-021 to XL-030)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| XL-021 | register -> liquidate -> removeOperator -> reactivate | Operator removed AFTER liquidation. Reactivation skips dead op (ethSnapshot.block == 0). Verify: ethValidatorCount incremented only for 3 live ops, cumulativeFee from 3 ops, solvency check uses reduced burn rate | `chain:post-liq-remove; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:291,321,326-327; SSVClusters.sol:161-171 |
| XL-022 | register -> updateClusterBalance -> liquidate -> removeOperator -> reactivate | Explicit EB cluster: liquidation cleans deviation, op removed after liquidation, reactivation re-adds clusterDeviation only to 3 live ops. Verify operatorEthVUnits for removed op stays 0 (deleted by removeOperator), 3 live ops each get clusterDeviation | `chain:post-liq-remove-eb; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:312-319,291; SSVClusters.sol:142-145,174-176 |
| XL-023 | register -> liquidate -> removeOperator -> removeOperator -> reactivate | Two operators removed after liquidation (2/4 remaining). Reactivation: only 2 ops get ethValidatorCount increment and deviation. Solvency check uses 2-operator burn rate. Cluster operates at 50% operator coverage | `chain:post-liq-multi-remove; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:291,321,326-327; SSVClusters.sol:161-171 |
| XL-024 | register -> liquidate -> removeOperator(all 4) -> reactivate | ALL operators removed after liquidation. Reactivation: all ops skipped, cumulativeFee=0, burnRate=0. Solvency check with burnRate=0: threshold depends only on networkFee. If networkFee=0, any msg.value passes. Verify cluster is active but non-functional | `chain:post-liq-all-remove; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:291; SSVClusters.sol:161-171; ClusterLib.sol:96-112 |
| XL-025 | register -> liquidate -> removeOperator(all 4) -> reactivate(insufficient) | All operators removed, reactivation with 0 msg.value and networkFee > 0. isLiquidatableWithVUnits: threshold = minBlocks * networkFee * vUnits / BPS * ETH_DEDUCTED_DIGITS > 0. Should revert InsufficientBalance | `chain:post-liq-all-remove-fail; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:yes` | [ ] | SSVClusters.sol:161-171; ClusterLib.sol:96-112 |
| XL-026 | register -> updateClusterBalance -> liquidate -> removeOperator -> reactivate -> updateClusterBalance | Full chain with post-liquidation operator removal and subsequent EB update. After reactivation (3 ops live, 1 dead), EB update via _updateOperatorVUnits writes to all 4 operatorIds including dead op. Verify bug manifests on post-reactivation EB update | `chain:post-liq-remove-eb-update; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:504-509; OperatorLib.sol:291 |
| XL-027 | register -> liquidate -> operatorFeeChange -> reactivate | Operator fee changed during liquidation period. Reactivation: updateClusterOperatorsOnReactivation reads new fee (PackedETH.unwrap(operator.ethFee)). Solvency check uses new burn rate. Verify threshold recalculation with updated fees | `chain:post-liq-fee-change; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:292,326; SSVClusters.sol:161-171 |
| XL-028 | register -> liquidate -> operatorFeeChange(increase) -> reactivate(insufficient) | Operator fee increased during liquidation. Reactivation with amount sufficient for old burn rate but insufficient for new. Must revert InsufficientBalance due to higher threshold | `chain:post-liq-fee-change-fail; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:161-171; ClusterLib.sol:96-112 |
| XL-029 | register -> liquidate -> operatorFeeChange(decrease) -> reactivate | Operator fee decreased during liquidation. Reactivation threshold lower than at original liquidation. Verify msg.value that would have failed at old rate now succeeds at new rate | `chain:post-liq-fee-decrease; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:326; SSVClusters.sol:161-171 |
| XL-030 | register -> liquidate -> removeOperator -> operatorFeeChange(remaining) -> reactivate | Combined: one op removed + remaining ops change fees during liquidation. Reactivation: 3 ops at new fees, 1 dead. Verify burn rate = sum of 3 new fees, solvency check correct | `chain:post-liq-remove-and-fee; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:291,326; SSVClusters.sol:161-171 |

---

## Multi-Cycle Stability (XL-031 to XL-040)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| XL-031 | register -> EB -> liquidate -> reactivate -> EB -> liquidate -> reactivate | Double cycle: full lifecycle executed twice. Verify operator/DAO accounting returns to correct state after two complete liquidate/reactivate cycles with EB updates at each stage. No deviation drift | `chain:double-cycle; version:eth; eb:explicit; cluster:active->liq->active->liq->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:552-612,129-181,494-510; OperatorLib.sol:233-262,275-330 |
| XL-032 | register -> EB -> liquidate -> reactivate -> EB -> liquidate -> reactivate -> EB -> liquidate -> reactivate | Triple cycle stress test: three full liquidation/reactivation cycles with EB changes at each stage (32->48->liq->react, 48->64->liq->react, 64->48->liq->react). Verify cumulative accounting stability | `chain:triple-cycle; version:eth; eb:explicit; cluster:multi-cycle; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:all-relevant |
| XL-033 | register -> reactivate -> addValidator -> EB -> liquidate | Reactivation from prior liquidation, add validators to increase validatorCount, EB update raises burn rate, liquidate again. Verify validatorCount changes interact correctly with EB deviation: baseline = newValidatorCount * BPS, deviation = storedVUnits - baseline | `chain:react-add-val-liq; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:385-404; ClusterLib.sol:234-277,366-371 |
| XL-034 | register -> reactivate -> addValidator -> EB -> auto-liquidate | Same as XL-033 but EB update triggers auto-liquidation. Verify _liquidateAfterEBUpdateIfNeeded uses post-registration validatorCount for threshold and ethValidatorCount decrement | `chain:react-add-val-auto-liq; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:519-550,539-544; ClusterLib.sol:234-277 |
| XL-035 | register -> EB -> liquidate -> reactivate(exact-minimum) -> verify solvency | Reactivation with msg.value exactly at solvency threshold. Compute threshold: minBlocksBeforeLiquidation * (burnRate + networkFee) * effectiveVUnits / BPS * ETH_DEDUCTED_DIGITS. msg.value = threshold. Verify reactivation succeeds (isLiquidatableWithVUnits returns false at boundary) | `chain:react-exact-min; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:161-171; ClusterLib.sol:96-112 |
| XL-036 | register -> EB -> liquidate -> reactivate(1-wei-above) -> verify solvency | msg.value = threshold + 1 wei. Verify passes solvency | `chain:react-above-min; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:161-171; ClusterLib.sol:96-112 |
| XL-037 | register -> EB -> liquidate -> reactivate(1-wei-below) -> revert | msg.value = threshold - 1 wei. Verify revert InsufficientBalance | `chain:react-below-min; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:170 |
| XL-038 | register -> EB(32->48) -> liquidate -> reactivate -> EB(48->64) -> withdraw -> liquidate | Withdraw after second EB update drains balance below threshold. Verify withdraw solvency check uses updated vUnits (isLiquidatableWithEB reads getVUnits which returns stored 20000). Then third-party liquidation succeeds | `chain:react-eb-withdraw-liq; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:206-254,31-65; ClusterLib.sol:67-84,285-297 |
| XL-039 | register -> EB(32->2048) -> liquidate -> reactivate(high-deposit) | Max EB liquidation and reactivation: vUnits = 640000, massive threshold. Verify arithmetic precision with very large vUnits values. No overflow in uint256 threshold calculation | `chain:max-eb-cycle; version:eth; eb:explicit; cluster:active->liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:96-112,366-371; SSVClusters.sol:552-612,129-181 |
| XL-040 | register -> EB(32->33) -> liquidate -> reactivate -> EB(33->34) | Minimal EB changes (1 ETH increments): vUnits = 10313 -> 10625. Verify ceiling division precision preserved across liquidation/reactivation. Delta = 312 after reactivation, not recalculated from baseline | `chain:precision-cycle; version:eth; eb:explicit; cluster:active->liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:366-371; SSVClusters.sol:494-510,142-145 |

---

## EB Update on Inactive/Liquidated Clusters (XL-041 to XL-048)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| XL-041 | register -> liquidate -> updateClusterBalance -> reactivate | EB update on liquidated cluster: snapshot stored but no fee/deviation accounting (cluster.active == false skips lines 395-403). Reactivation reads updated vUnitsCluster from snapshot. Verify effectiveVUnits uses new stored value, not stale pre-liquidation value | `chain:liq-eb-react; version:eth; eb:explicit; cluster:liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:395,400,404,142-145 |
| XL-042 | register -> liquidate -> updateClusterBalance(EB increase) -> reactivate(insufficient-for-new-eb) | EB increased while cluster liquidated. Reactivation: effectiveVUnits uses new higher vUnits, solvency threshold increases. msg.value sufficient for old EB but not new. Must revert InsufficientBalance | `chain:liq-eb-react-fail; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:142-145,161-171 |
| XL-043 | register -> liquidate -> updateClusterBalance -> updateClusterBalance -> reactivate | Two EB updates on liquidated cluster: 32->48, then 48->64. Only snapshots stored (no deviation applied). Reactivation uses final vUnits=20000. Verify no deviation accumulated during liquidation, only added on reactivation | `chain:liq-double-eb-react; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:395,400,404,142-145,174-176; OperatorLib.sol:312-319 |
| XL-044 | register -> updateClusterBalance -> liquidate -> updateClusterBalance(EB decrease) -> reactivate | EB decreased while liquidated (slashing scenario): was 48 (vUnits=15000), liquidated, updated to 32 (vUnits=10000). Reactivation: vUnitsCluster=10000, baseline=10000, clusterDeviation=0. No deviation added to operators. Solvency uses baseline threshold | `chain:liq-eb-decrease-react; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:142-145; OperatorLib.sol:312-319 |
| XL-045 | register -> updateClusterBalance -> liquidate -> updateClusterBalance(same-EB) -> reactivate | EB unchanged while liquidated: snapshot updated with same vUnits. Reactivation reads same vUnits as before liquidation. Verify deviation re-added equals deviation cleaned during liquidation — round-trip symmetry | `chain:liq-eb-same-react; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:404,142-145,552-596 |
| XL-046 | register -> liquidate -> removeOperator -> updateClusterBalance -> reactivate | Operator removed, then EB update on liquidated cluster (no deviation applied since cluster inactive), then reactivation. Verify: EB update writes snapshot only, reactivation adds deviation to 3 live ops, dead op untouched | `chain:liq-remove-eb-react; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:395,400; OperatorLib.sol:291,312-319 |
| XL-047 | register -> EB(32->48) -> auto-liquidate -> EB(48->32, while liquidated) -> reactivate | Auto-liquidation from EB increase. While liquidated, EB decreases back to baseline. Reactivation: stored vUnits=10000, baseline=10000, clusterDeviation=0. Cluster effectively returns to implicit-like state with explicit tracking | `chain:auto-liq-eb-decrease-react; version:eth; eb:explicit; cluster:liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:519-550,404,142-145 |
| XL-048 | register -> liquidate -> updateClusterBalance -> removeOperator -> reactivate -> updateClusterBalance | EB update while liquidated, then op removed, then reactivation (3 ops, deviation from stored vUnits), then another EB update. Second update writes deviation to all 4 operatorIds including dead op. Full compound path exercising the bug after a liquidation-era EB update | `chain:compound-liq-era; version:eth; eb:explicit; cluster:liquidated->active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:404,142-145,504-509; OperatorLib.sol:291 |

---

## Concurrency and Race Conditions (XL-049 to XL-055)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| XL-049 | two callers liquidate same cluster | Liquidation race: caller A and caller B both submit liquidate in same block. First succeeds, second must revert ClusterIsLiquidated (cluster.active=false after first) | `chain:race-liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:partial` | [ ] | SSVClusters.sol:36; ClusterLib.sol:118-120 |
| XL-050 | caller A liquidates, caller B reactivates same block | Liquidation then reactivation in same block by different callers: liquidator collects bounty, owner reactivates immediately. Verify cluster state transitions correctly: active->false->true. Owner passes correct (zeroed) cluster state to reactivate | `chain:liq-react-same-block; version:eth; eb:implicit; cluster:active->liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:31-65,129-181 |
| XL-051 | owner self-liquidates + reactivates same block | Owner self-liquidates then reactivates in same block. Self-liquidation bounty goes to owner, owner funds reactivation with fresh ETH. Net effect: old balance returned, new balance deposited. Verify all indexes reset correctly | `chain:self-liq-react-same-block; version:eth; eb:implicit; cluster:active->liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:52,64,129-181,599-609 |
| XL-052 | EB update auto-liquidates, owner reactivates same block | Auto-liquidation via updateClusterBalance by third party, then owner reactivates. updateClusterBalance caller gets bounty. Owner must use the post-liquidation cluster state for reactivation. Verify ClusterLiquidated and ClusterReactivated events both emitted | `chain:auto-liq-react-same-block; version:eth; eb:explicit; cluster:active->liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:519-550,129-181,611,180 |
| XL-053 | EB update + liquidation by different callers, same cluster, same block | Caller A does updateClusterBalance (no auto-liq, but raises threshold), caller B liquidates (cluster now below raised threshold). Verify: EB update stores new vUnits, subsequent liquidate uses new vUnits via getVUnits in isLiquidatableWithEB | `chain:eb-then-liq-same-block; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:348-417,31-65; ClusterLib.sol:67-84,285-297 |
| XL-054 | two callers reactivate same cluster | Reactivation race: owner calls reactivate twice (possible via two txns in same block). First succeeds, second must revert ClusterAlreadyEnabled | `chain:race-reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:partial` | [ ] | SSVClusters.sol:137 |
| XL-055 | reactivate + EB update same block | Owner reactivates then updateClusterBalance called in same block. Verify: reactivation sets cluster active, EB update processes normally on active cluster (fee settlement, deviation update). If EB increase makes cluster immediately undercollateralized, auto-liquidation fires same block as reactivation | `chain:react-eb-same-block; version:eth; eb:explicit; cluster:liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:129-181,348-417,519-550 |

---

## Cross-Module Deviation Accounting Edge Cases (XL-056 to XL-065)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| XL-056 | two clusters share operators, both update EB, one liquidates | Shared operators: cluster A (ops 1,2,3,4) and cluster B (ops 1,2,5,6). Both get EB updates (deviation stacks on shared ops 1,2). Cluster A liquidates: deviation cleaned for ops 1,2,3,4. Ops 1,2 retain cluster B deviation only. Verify operatorEthVUnits[1] = clusterB_deviation (not zero) | `chain:shared-ops-liq; version:eth; eb:explicit; cluster:active; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:494-510,586-592 |
| XL-057 | two clusters share operators, one liquidates then reactivates | Cluster A liquidation cleans its deviation from shared ops. Cluster A reactivation re-adds its deviation to shared ops. Verify shared ops' operatorEthVUnits = clusterA_deviation + clusterB_deviation after reactivation — same as before liquidation | `chain:shared-ops-liq-react; version:eth; eb:explicit; cluster:active->liquidated->active; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:586-592,142-145; OperatorLib.sol:312-319 |
| XL-058 | shared operator removed between cluster A liquidation and cluster B liquidation | Ops 1,2 shared. Cluster A liquidates (deviation cleaned from op1). Remove op1. Cluster B liquidates: deviation cleanup writes to operatorEthVUnits[op1] which was deleted — the bug. Verify: cluster B should skip dead op1 in deviation cleanup but doesn't (no guard in _executeLiquidation lines 586-592) | `chain:shared-ops-remove-liq; version:eth; eb:explicit; cluster:active; ops:parametric; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:586-592; SSVOperators.sol:93 |
| XL-059 | register -> addValidator -> EB(increase) -> liquidate -> reactivate | Validator added after initial registration increases validatorCount. EB update uses new validatorCount for baseline. Liquidation: baseline = newValidatorCount * BPS. Reactivation: effectiveVUnits uses stored vUnits. Verify validatorCount consistency across all operations | `chain:add-val-eb-liq-react; version:eth; eb:explicit; cluster:active->liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:234-277; SSVClusters.sol:570,142-145 |
| XL-060 | register -> removeValidator -> EB(decrease required) -> liquidate -> reactivate | Validator removed reduces validatorCount. EB update must reflect new validatorCount (floor = newValidatorCount * 32). Liquidation and reactivation use updated validatorCount. Verify baseline recalculation at each step | `chain:remove-val-eb-liq-react; version:eth; eb:explicit; cluster:active->liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:453-459,570,142-145 |
| XL-061 | register -> EB(32->48) -> withdraw(near-threshold) -> auto-liquidate-on-next-EB | Withdraw brings balance just above liquidation threshold at current vUnits. Next EB update 48->64 raises threshold above remaining balance. Auto-liquidation fires. Verify withdraw did not itself revert (was solvent at old vUnits), but next EB update correctly triggers auto-liquidation at new vUnits | `chain:withdraw-auto-liq; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:206-254,519-550; ClusterLib.sol:67-84 |
| XL-062 | register -> EB(32->48) -> deposit -> EB(48->32) -> liquidate attempt(fail) | EB decrease lowers threshold. Deposit adds balance. Cluster has more balance than needed at reduced threshold. Third-party liquidation attempt must revert ClusterNotLiquidatable | `chain:eb-decrease-deposit-no-liq; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:51-62; ClusterLib.sol:67-84 |
| XL-063 | register -> EB(32->48) -> liquidate -> reactivate -> removeValidator -> verify-solvency | Reactivation, then validator removal reduces validatorCount and baseline. Stored vUnits unchanged but baseline decreases. If storedVUnits > newValidatorCount * BPS, deviation increases implicitly. Verify solvency check after removal accounts for the relatively higher deviation | `chain:react-remove-val; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:234-277,257-261,67-84 |
| XL-064 | register -> EB -> liquidate -> migrate (SSV cluster liquidated, migrates to ETH) | Cross-version: SSV cluster with EB tracking, liquidated, then migrated to ETH via migrateClusterToETH. Migration: isLiquidated=true, SSV counts already removed, ETH counts added, deviation applied from stored vUnits. Verify migration correctly handles the liquidated-to-active transition with EB deviation | `chain:liq-migrate; version:ssv->eth; eb:explicit; cluster:liquidated->active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:259-343,309-326; OperatorLib.sol:343-384 |
| XL-065 | register -> EB -> removeOperator -> liquidate -> migrate -> verify deviation | Migration after liquidation with dead operator. migrateClusterToETH applies deviation to all operatorIds (line 321) including dead op (no ethSnapshot.block check in migration deviation loop). Verify bug manifests in migration path too | `chain:liq-migrate-dead-op; version:ssv->eth; eb:explicit; cluster:liquidated->active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:318-322; SSVOperators.sol:93 |

---

## Detailed Scenario Blocks (12 Most Complex)

---

### XL-001: Full Lifecycle — Register -> EB Update -> Liquidate -> Reactivate -> EB Update

**Goal:** Verify complete state machine round-trip with deviation accounting correctness at every stage.

**Setup:**
1. Register 4 operators with ethFee = 2,000,000,000 each.
2. Register cluster with validatorCount = 1, implicit EB (32 ETH).
3. Deposit sufficient ETH for initial solvency.
4. Commit oracle root with effectiveBalance = 48 (48 ETH for 1 validator).

**Execution:**
| Step | Action | Expected State Change |
|------|--------|-----------------------|
| 1 | `updateClusterBalance(48)` | storedVUnits: 0->15000. Delta = 5000. Each op: operatorEthVUnits += 5000. daoTotalEthVUnits += 5000 |
| 2 | Advance blocks until balance < threshold | Balance drains at higher rate due to vUnits=15000 |
| 3 | Third-party `liquidate` | `_executeLiquidation`: deviation = 15000 - 10000 = 5000. Each op: operatorEthVUnits -= 5000. daoTotalEthVUnits -= 5000. ethValidatorCount -= 1 for each. cluster.active = false |
| 4 | `reactivate` with sufficient msg.value | effectiveVUnits = stored 15000 (vUnitsCluster=15000 > 0). clusterDeviation = 15000 - 10000 = 5000. Each live op: operatorEthVUnits += 5000, ethValidatorCount += 1. daoTotalEthVUnits += 5000. cluster.active = true |
| 5 | Commit new root, `updateClusterBalance(64)` | storedVUnits: 15000. newVUnits = ebToVUnits(64) = 20000. Delta = 5000. Each op: operatorEthVUnits += 5000. daoTotalEthVUnits += 5000 |

**Assertions:**
- After step 1: operatorEthVUnits[each] == 5000, daoTotalEthVUnits == ethDaoValidatorCount * BPS + 5000
- After step 3: operatorEthVUnits[each] == 0, daoTotalEthVUnits == (ethDaoValidatorCount - 1) * BPS
- After step 4: operatorEthVUnits[each] == 5000, daoTotalEthVUnits == ethDaoValidatorCount * BPS + 5000
- After step 5: operatorEthVUnits[each] == 10000, daoTotalEthVUnits == ethDaoValidatorCount * BPS + 10000
- DAO invariant holds at every step: `daoTotalEthVUnits == ethDaoValidatorCount * BPS_DENOMINATOR + sum(active_cluster_deviations)`

**Code path:** SSVClusters.sol:385-404 -> 494-510 -> 31-65 -> 552-612 -> 129-181 -> OperatorLib.sol:275-330 -> SSVClusters.sol:385-404 -> 494-510

---

### XL-011: THE BUG PATH — EB Update -> Remove Operator -> Liquidate

**Goal:** Demonstrate the exact interaction where real `removeOperator` deletes `operatorEthVUnits[op4]` but `_executeLiquidation` still attempts to subtract deviation from it.

**Setup:**
1. Register 4 operators [op1, op2, op3, op4].
2. Register cluster with validatorCount = 1.
3. Deposit ETH.
4. Commit oracle root, call `updateClusterBalance(48)`:
   - operatorEthVUnits[op1..4] each = 5000.
5. Remove op4 via `removeOperator(op4)`:
   - `_resetOperatorState`: ethSnapshot.block = 0, ethFee = 0, ethValidatorCount = 0.
   - `delete seb.operatorEthVUnits[op4]` (line SSVOperators.sol:93) -> operatorEthVUnits[op4] = 0.
6. Drain cluster to below threshold.

**Execution:**
1. Third-party calls `liquidate(owner, [op1, op2, op3, op4], cluster)`.

**Analysis:**
- `updateClusterOperators` (line 41-47): op4 skipped (ethSnapshot.block == 0), ethValidatorCount not decremented for op4.
- `_executeLiquidation` (line 552-612):
  - `vUnitsCluster = 15000` (stored in EB snapshot — NOT cleared on operator removal).
  - `baselineVUnits = 1 * 10000 = 10000`.
  - `deviation = 15000 - 10000 = 5000`.
  - Loop (lines 586-592): `seb.operatorEthVUnits[op4] -= 5000`.
  - **op4's slot is 0 (deleted). Subtraction: 0 - 5000 = UNDERFLOW.**

**Critical finding:** The `_executeLiquidation` deviation cleanup loop (lines 585-592) has NO guard for removed operators (`ethSnapshot.block == 0`). It unconditionally subtracts from all operatorIds. With Solidity 0.8.24 checked arithmetic, this will REVERT, making the cluster unliquidatable.

**Fix verification:** After applying guard `if (s.operators[operatorIds[i]].ethSnapshot.block == 0) continue;` in the loop at line 586, the subtraction is skipped for dead operators.

**Code path:** SSVOperators.sol:93 (delete) -> SSVClusters.sol:41-47 (updateClusterOperators, skip dead) -> 552-612 (_executeLiquidation, NO skip for dead -> underflow)

---

### XL-012: Double EB Update With Removed Operator — Compounding Deviation Mismatch

**Goal:** Show that multiple EB updates with an operator removal between them creates an irrecoverable deviation accounting mismatch.

**Setup:**
1. Register 4 operators, cluster with 1 validator.
2. EB update 32->48: operatorEthVUnits[op1..4] = 5000 each.
3. Remove op4: operatorEthVUnits[op4] deleted (= 0).
4. EB update 48->64:
   - storedVUnits = 15000, newVUnits = 20000, delta = 5000.
   - `_updateOperatorVUnits` line 507: `seb.operatorEthVUnits[op4] += 5000` -> op4 = 5000 (stale, on dead operator).
   - op1..3 = 10000 each.
5. Drain to liquidation.

**Execution:**
1. `liquidate(owner, [op1, op2, op3, op4], cluster)`.

**Analysis:**
- `vUnitsCluster = 20000`, `baselineVUnits = 10000`, `deviation = 10000`.
- Loop: `seb.operatorEthVUnits[op4] -= 10000`. op4 = 5000 - 10000 = UNDERFLOW. Revert.

**Key insight:** The mismatch compounds: EB update wrote delta (5000) to dead op, but liquidation tries to subtract full deviation (10000). The stale write was only partial (one delta), but cleanup uses total accumulated deviation. This makes the cluster permanently unliquidatable after two EB updates with an operator removal between them.

**Code path:** SSVClusters.sol:504-509 (stale write to dead op) -> 586-592 (underflow on cleanup)

---

### XL-017: EB Update -> Remove Operator -> Liquidate -> Reactivate — Deviation Asymmetry

**Goal:** Verify deviation accounting asymmetry when an operator is removed between EB update and reactivation.

**Setup:**
1. Register 4 operators, cluster with 1 validator.
2. EB update 32->48: operatorEthVUnits[op1..4] = 5000 each. daoTotalEthVUnits += 5000.
3. Remove op4.
4. Drain to liquidation. Liquidate.
5. In `_executeLiquidation`: deviation=5000 subtracted from ALL 4 ops. op4: 0 - 5000 -> UNDERFLOW (see XL-011).

**Assuming guard is applied (skipping dead ops in _executeLiquidation):**
5b. Deviation subtracted from op1..3 (5000 each). op4 skipped. daoTotalEthVUnits -= 5000.
6. Reactivate with sufficient msg.value.
7. In reactivation: clusterDeviation = 15000 - 10000 = 5000. Added to live ops only (op1..3) via line 312-319.

**Result:**
- op1..3: 0 + 5000 = 5000 each (correct).
- op4: 0 (dead, not touched).
- daoTotalEthVUnits: += 5000 (correct).
- **Accounting is correct IF the guard is applied.** Without the guard, liquidation reverts and this state is unreachable.

**Code path:** SSVClusters.sol:586-592 (guard needed) -> OperatorLib.sol:291,312-319 (reactivation skip)

---

### XL-024: All Operators Removed After Liquidation — Reactivation With Zero Burn Rate

**Goal:** Test the extreme edge case where all operators are removed from a liquidated cluster, then reactivation is attempted.

**Setup:**
1. Register 4 operators, cluster with 1 validator.
2. Liquidate cluster (self-liquidation or time-based).
3. Remove all 4 operators: each gets ethSnapshot.block = 0.

**Execution:**
1. Owner calls `reactivate([op1, op2, op3, op4], cluster)` with msg.value = 1 ETH.

**Analysis:**
- `updateClusterOperatorsOnReactivation`:
  - All ops skipped (ethSnapshot.block == 0 for each).
  - cumulativeFee = 0, cumulativeIndex = sum of preserved indexes.
  - No ethValidatorCount increments.
  - No deviation applied (all skipped).
- cluster.balance = 1 ETH, cluster.active = true.
- `isLiquidatableWithVUnits(effectiveVUnits, burnRate=0, networkFee, ...)`:
  - If networkFee > 0: threshold = minBlocks * networkFee * effectiveVUnits / BPS * ETH_DEDUCTED_DIGITS. Must be < 1 ETH.
  - If networkFee == 0: threshold = 0. Any balance passes.
- `sp.updateDAO(true, 1)`: ethDaoValidatorCount += 1 (even though no operators are tracking it).

**Critical observation:** ethDaoValidatorCount incremented but no operator's ethValidatorCount incremented. The global validator count drifts from the sum of per-operator counts. This is a DAO accounting inconsistency.

**Code path:** OperatorLib.sol:287-329 (all skipped) -> SSVClusters.sol:156-173 (balance set, solvency check, DAO update)

---

### XL-031: Double Cycle Stability — Liquidate/Reactivate Twice

**Goal:** Verify that two consecutive liquidation/reactivation cycles produce identical operator/DAO accounting states (no drift).

**Setup:**
1. Register 4 operators, cluster with 1 validator.
2. EB update 32->48: deviation = 5000 per op.

**Execution:**
| Step | Action | operatorEthVUnits[each] | daoTotalEthVUnits delta |
|------|--------|------------------------|-------------------------|
| 1 | EB 32->48 | 5000 | +5000 |
| 2 | Liquidate | 0 | -5000 |
| 3 | Reactivate | 5000 | +5000 |
| 4 | Liquidate | 0 | -5000 |
| 5 | Reactivate | 5000 | +5000 |

**Assertions:**
- After step 3: state identical to after step 1.
- After step 5: state identical to after steps 1 and 3.
- ethDaoValidatorCount returns to same value after each reactivation.
- No cumulative drift in operatorEthVUnits or daoTotalEthVUnits across cycles.
- Operator earnings settle correctly at each liquidation (snapshot balance paid out in ETH transfer).

**Code path:** SSVClusters.sol:494-510 (EB) -> 552-612 (liq) -> 129-181 (react) -> repeated

---

### XL-041: EB Update on Liquidated Cluster Then Reactivation

**Goal:** Verify that an EB update on a liquidated cluster only stores the snapshot without applying deviation, and that subsequent reactivation correctly uses the updated vUnits.

**Setup:**
1. Register 4 operators, cluster with 1 validator, implicit EB.
2. Liquidate cluster. cluster.active = false.
3. Commit new oracle root with effectiveBalance = 48.

**Execution:**
| Step | Action | Expected |
|------|--------|----------|
| 1 | `updateClusterBalance(48)` on liquidated cluster | `cluster.active == false`. Line 395: `if (cluster.active)` is false -> skip `_applyClusterFeeUpdates`. Line 400: `if (cluster.active && ...)` is false -> skip `_updateOperatorVUnits`. Line 404: `_updateEBSnapshot` IS called -> vUnits = 15000 stored. Line 406-409: `_liquidateAfterEBUpdateIfNeeded` returns false (line 529: `!cluster.active`). Line 408: `!liquidated && cluster.active` is false -> cluster hash NOT stored |
| 2 | `reactivate` with sufficient msg.value | `vUnitsCluster = 15000` (from stored snapshot). `effectiveVUnits = 15000`. `clusterDeviation = 5000`. deviation added to each live op. Solvency uses vUnits=15000 |

**Assertions:**
- After step 1: operatorEthVUnits unchanged (no deviation applied during liquidated EB update). daoTotalEthVUnits unchanged. clusterEB[id].vUnits = 15000.
- After step 2: operatorEthVUnits[each] = 5000. daoTotalEthVUnits += 5000. Solvency threshold higher than implicit EB.

**Key subtlety:** The cluster hash is NOT updated in step 1 (line 408-409), so the reactivation call must still use the pre-EB-update cluster state (zeroed from liquidation). The EB snapshot is a separate storage slot that IS updated.

**Code path:** SSVClusters.sol:387-416 (EB update, most skipped) -> 129-181 (reactivation reads updated snapshot)

---

### XL-049: Liquidation Race — Two Callers Same Block

**Goal:** Verify that when two liquidators race to liquidate the same cluster, exactly one succeeds and the other reverts.

**Setup:**
1. Register 4 operators, cluster with 1 validator.
2. Drain cluster balance to below liquidation threshold.

**Execution:**
1. Caller A sends `liquidate(owner, operatorIds, cluster)` — succeeds.
2. Caller B sends `liquidate(owner, operatorIds, cluster)` with same cluster state — reverts.

**Analysis:**
- Caller A: `validateHashedCluster` passes (cluster hash matches). `validateClusterIsNotLiquidated` passes (active=true). Liquidation executes. `s.ethClusters[clusterId] = cluster.hashClusterData()` stores new hash (active=false, balance=0).
- Caller B: `validateHashedCluster` fails because stored hash changed. Reverts `IncorrectClusterState` (not `ClusterIsLiquidated`) — the cluster state passed by B no longer matches storage.

**Important:** The revert is `IncorrectClusterState`, NOT `ClusterIsLiquidated`. Caller B passed the pre-liquidation cluster state, but storage now has post-liquidation hash.

**Code path:** SSVClusters.sol:34 (validateHashedCluster) -> ClusterLib.sol:143-144 (hash mismatch revert)

---

### XL-053: EB Update Then Liquidation by Different Callers Same Block

**Goal:** Verify that an EB update followed by a liquidation in the same block correctly applies the new vUnits to the liquidation threshold check.

**Setup:**
1. Register 4 operators, cluster with 1 validator, implicit EB.
2. Cluster balance is above implicit-EB threshold but below 2x threshold.
3. Commit oracle root with effectiveBalance = 64 (2x baseline).

**Execution:**
| Step | Action | Expected |
|------|--------|----------|
| 1 | Caller A: `updateClusterBalance(64)` | storedVUnits 0->20000. Fee settlement with old vUnits. Deviation applied: each op += 10000. Auto-liquidation check: `isLiquidatableWithEB` with new vUnits. If balance above new threshold, no auto-liq. Cluster hash stored with updated balance |
| 2 | Caller B: `liquidate(owner, ops, cluster_updated)` | `validateHashedCluster` uses post-EB cluster hash. `updateClusterOperators` settles one more block of fees. `isLiquidatableWithEB` reads `getVUnits` = 20000 (stored). Threshold doubled. If balance < new threshold, liquidation succeeds |

**Assertions:**
- Step 1: No auto-liquidation (balance was sufficient but marginal).
- Step 2: One additional block of fee burn at doubled rate pushes balance below threshold. Liquidation succeeds.
- Caller A receives no bounty (only EB updater). Caller B receives remaining balance as bounty.
- `ClusterBalanceUpdated` event from step 1 shows updated balance. `ClusterLiquidated` event from step 2 shows zeroed state.

**Code path:** SSVClusters.sol:348-417 -> 31-65; ClusterLib.sol:67-84,285-297

---

### XL-056: Two Clusters Share Operators — Deviation Stacking and Partial Liquidation

**Goal:** Verify that when two clusters share operators, deviation from both clusters stacks correctly on shared operators, and liquidating one cluster removes only its deviation.

**Setup:**
1. Register 6 operators [op1..op6].
2. Cluster A: operators [op1, op2, op3, op4], validatorCount = 1.
3. Cluster B: operators [op1, op2, op5, op6], validatorCount = 1.
4. EB update cluster A: 32->48 (deviation = 5000). operatorEthVUnits[op1] += 5000, [op2] += 5000, [op3] += 5000, [op4] += 5000.
5. EB update cluster B: 32->64 (deviation = 10000). operatorEthVUnits[op1] += 10000, [op2] += 10000, [op5] += 10000, [op6] += 10000.

**State before liquidation:**
- operatorEthVUnits[op1] = 15000 (5000 + 10000)
- operatorEthVUnits[op2] = 15000
- operatorEthVUnits[op3] = 5000
- operatorEthVUnits[op4] = 5000
- operatorEthVUnits[op5] = 10000
- operatorEthVUnits[op6] = 10000

**Execution:**
1. Liquidate cluster A. `_executeLiquidation`: deviation A = 5000. Subtracts 5000 from ops 1,2,3,4.

**State after liquidation:**
- operatorEthVUnits[op1] = 10000 (cluster B deviation only)
- operatorEthVUnits[op2] = 10000
- operatorEthVUnits[op3] = 0
- operatorEthVUnits[op4] = 0
- operatorEthVUnits[op5] = 10000 (unchanged)
- operatorEthVUnits[op6] = 10000 (unchanged)

**Assertions:**
- Shared operators (op1, op2) retain cluster B's deviation only.
- Non-shared operators (op3, op4) return to zero.
- Cluster B's operators (op5, op6) completely unaffected.
- daoTotalEthVUnits decremented by cluster A's deviation (5000) only.
- Cluster B remains fully functional with correct deviation accounting.

**Code path:** SSVClusters.sol:494-510 (both EB updates) -> 552-612 (liquidation cleanup)

---

### XL-058: Shared Operator Removed Between Two Cluster Liquidations — The Bug in Multi-Cluster Context

**Goal:** Demonstrate the removed-operator bug in a multi-cluster context where a shared operator is removed between two cluster liquidations.

**Setup:**
1. Register 4 operators [op1..op4].
2. Cluster A: operators [op1, op2, op3, op4], validatorCount = 1. EB 32->48 (deviation 5000).
3. Cluster B: operators [op1, op2, op3, op4], validatorCount = 1. EB 32->48 (deviation 5000).
4. operatorEthVUnits[op1..4] = 10000 each (stacked from both clusters).

**Execution:**
| Step | Action | operatorEthVUnits[op1] | Notes |
|------|--------|------------------------|-------|
| Pre | Both clusters active | 10000 | 5000 from A + 5000 from B |
| 1 | Liquidate cluster A | 5000 | -5000 (cluster A deviation removed) |
| 2 | Remove op1 | 0 (deleted) | `delete seb.operatorEthVUnits[op1]` (SSVOperators.sol:93) |
| 3 | Liquidate cluster B | 0 - 5000 = UNDERFLOW | Bug: cleanup tries to subtract B's 5000 from deleted slot |

**Critical finding:** `removeOperator` deletes the ENTIRE `operatorEthVUnits[op1]` slot, including cluster B's remaining deviation. When cluster B liquidates, `_executeLiquidation` tries to subtract cluster B's deviation (5000) from a zeroed slot, causing an underflow revert. Cluster B becomes unliquidatable.

**Impact:** In a production network with shared operators, removing an operator that serves multiple clusters can make other clusters permanently unliquidatable if they have explicit EB deviation.

**Code path:** SSVClusters.sol:586-592 -> SSVOperators.sol:93 (delete wipes all cluster contributions)

---

### XL-064: Liquidated SSV Cluster Migrates to ETH With EB Deviation

**Goal:** Verify that `migrateClusterToETH` correctly handles a liquidated SSV cluster that has EB tracking, applying deviation to operators and DAO during the migration.

**Setup:**
1. Register 4 operators (SSV + ETH capable).
2. Create SSV cluster with validatorCount = 1.
3. EB update on SSV cluster: 32->48 (only snapshot stored, no deviation — SSV path at line 411-414).
4. Liquidate SSV cluster via `liquidateSSV`.

**Execution:**
1. Owner calls `migrateClusterToETH(operatorIds, cluster)` with sufficient msg.value.

**Analysis:**
- `isLiquidated = !cluster.active = true` (line 265).
- `updateClusterOperatorsMigration`: SSV counts NOT decremented (isLiquidated=true, line 357). ETH counts incremented.
- `updateDAOSSV(false, ...)` NOT called (isLiquidated, line 284-286). `updateDAO(true, ...)` IS called.
- Deviation block (lines 309-326): `vUnitsCluster = 15000` (stored from EB update). `baseline = 10000`. `deviation = 5000`.
- Each op: `seb.operatorEthVUnits[opId] += 5000`.
- `sp.daoTotalEthVUnits += 5000`.
- Cluster becomes active ETH cluster with deviation accounting.
- `ClusterMigratedToETH` + `ClusterReactivated` events emitted.

**Assertions:**
- After migration: cluster.active = true, version = ETH.
- operatorEthVUnits correctly reflects deviation from stored EB snapshot.
- daoTotalEthVUnits includes the deviation.
- The migration path at lines 318-322 has NO guard for removed operators (same bug pattern as _updateOperatorVUnits).

**Code path:** SSVClusters.sol:259-343

---

## Coverage Matrix

| State Transition | Without EB | With EB (explicit) | With Removed Op | With Fee Change | Multi-Cluster |
|------------------|-----------|-------------------|----------------|----------------|---------------|
| Active -> Liquidate -> Reactivate | XL-004 | XL-001, XL-002, XL-003 | XL-021, XL-022, XL-023 | XL-027, XL-028, XL-029 | XL-056, XL-057 |
| Active -> EB -> Liquidate -> Reactivate | — | XL-001, XL-009, XL-010 | XL-011..020, XL-026 | XL-030 | XL-058 |
| Active -> Auto-Liquidate -> Reactivate | — | XL-009, XL-010 | XL-013 | — | — |
| Liquidated -> EB Update -> Reactivate | — | XL-041..045 | XL-046, XL-048 | — | — |
| Liquidated -> Remove Op -> Reactivate | XL-021, XL-024 | XL-022 | XL-023, XL-024, XL-025 | XL-030 | — |
| Liquidated -> All Ops Removed -> Reactivate | XL-024, XL-025 | — | XL-024, XL-025 | — | — |
| Multi-Cycle (2+ liq/react) | — | XL-031, XL-032 | — | — | — |
| Reactivate -> Add Validators -> Liquidate | — | XL-033, XL-034 | — | — | — |
| Reactivate Boundary (exact/above/below) | — | XL-035, XL-036, XL-037 | — | — | — |
| Race / Same-Block | XL-049, XL-050, XL-051 | XL-052, XL-053, XL-055 | — | — | — |
| Cross-Version (SSV -> ETH migration) | — | XL-064 | XL-065 | — | — |
| Withdraw -> Auto-Liquidate | — | XL-061 | — | — | — |
| Deposit -> EB Decrease -> No-Liquidate | — | XL-062 | — | — | — |

---

## Bug Pattern Summary

The **removed-operator deviation bug** manifests in 3 code locations:

| Location | Function | Lines | Guard Status |
|----------|----------|-------|--------------|
| `_updateOperatorVUnits` | EB update deviation write | SSVClusters.sol:504-509 | **MISSING** — writes to dead operators |
| `_executeLiquidation` | Deviation cleanup on liquidation | SSVClusters.sol:585-592 | **MISSING** — subtracts from dead operators (underflow revert) |
| `migrateClusterToETH` | Migration deviation application | SSVClusters.sol:318-322 | **MISSING** — writes to dead operators |

**Required guard:** `if (s.operators[operatorIds[i]].ethSnapshot.block == 0) continue;`

Scenarios that exercise each location:
- `_updateOperatorVUnits`: XL-012, XL-015, XL-016, XL-018, XL-026, XL-048
- `_executeLiquidation`: XL-011, XL-012, XL-013, XL-014, XL-017, XL-058
- `migrateClusterToETH`: XL-065

---

## Summary

| Category | Count | ID Range |
|----------|-------|----------|
| Full Cycle (Active -> EB -> Liq -> React -> EB) | 10 | XL-001 to XL-010 |
| Operator Removal Before Liquidation (THE BUG) | 10 | XL-011 to XL-020 |
| Operator Removal After Liquidation | 10 | XL-021 to XL-030 |
| Multi-Cycle Stability & Boundary | 10 | XL-031 to XL-040 |
| EB Update on Inactive/Liquidated Clusters | 8 | XL-041 to XL-048 |
| Concurrency & Race Conditions | 7 | XL-049 to XL-055 |
| Cross-Module Deviation Edge Cases | 10 | XL-056 to XL-065 |
| **Total** | **65** | **XL-001 to XL-065** |
| Detailed Scenario Blocks | 12 | XL-001, XL-011, XL-012, XL-017, XL-024, XL-031, XL-041, XL-049, XL-053, XL-056, XL-058, XL-064 |

## ask-codex Review Findings

### Corrections
- XL rows with `register → reactivate` flow are WRONG: `reactivate` reverts on active cluster (SSVClusters.sol:137), and first registration requires active cluster (ClusterLib.sol:208). Fix: need liquidation step between.
- XL-063 WRONG: Doc says stored vUnits stay unchanged after removeValidator — code reduces ebSnapshot.vUnits by removed baseline at SSVValidators.sol:204.
- XL-018 "DAO drift" WRONG MECHANISM: Real issue is stale writes to dead operators, not DAO drift. removeOperator deletes operatorEthVUnits (SSVOperators.sol:93), then _updateOperatorVUnits rewrites it (SSVClusters.sol:494), then _executeLiquidation tries to clean it (SSVClusters.sol:552).

### Additional Scenarios
| XL-066 | explicit-EB + all-operators-removed → reactivate → liquidate | All operators removed. Reactivation skips all in deviation loop (OperatorLib.sol:291) but SSVClusters.sol:174 still re-adds DAO deviation. Later liquidation hits unguarded subtraction at SSVClusters.sol:586 → underflow. | `entry:liquidate; bug:all-removed; revert:yes` | [ ] | OperatorLib.sol:291, SSVClusters.sol:174, 586 |
| XL-067 | removed operators + hasDeviation=true reactivation | Another cluster keeps DAO deviation non-zero. Reactivation of cluster with removed ops enters hasDeviation=true branch (OperatorLib.sol:285) but skips dead ops in snapshot loop → partial deviation restoration. | `entry:reactivate; bug:removed-op; revert:no` | [ ] | OperatorLib.sol:285, 291, 313 |
| XL-068 | validator-count mutation after reactivation → EB update | Reactivate explicit-EB cluster, add validators (changing baseline), then EB update. New validators get baseline vUnits but stored deviation doesn't account for them → deviation/baseline mismatch. | `entry:updateClusterEB; revert:no` | [ ] | SSVValidators.sol:138, SSVClusters.sol:504 |

---

## Coverage Verification (W4)

| ID | Tested | remove_mode | Test File | Notes |
|----|--------|-------------|-----------|-------|
| XL-001 | no | none | — | No test covers full register->EB->liquidate->reactivate->EB cycle with deviation assertions at each step |
| XL-002 | no | none | — | No 7-operator full cycle test exists |
| XL-003 | no | none | — | No test covers EB decrease after reactivation |
| XL-004 | no | none | — | No test covers implicit EB full cycle (vUnitsCluster=0 path) |
| XL-005 | no | none | — | No DAO invariant assertion test across full cycle |
| XL-006 | no | none | — | Self-liquidation mid-cycle not tested with deviation cleanup |
| XL-007 | no | none | — | No test covers deposit between reactivation and second EB update |
| XL-008 | no | none | — | No test covers deposit on liquidated cluster before reactivation |
| XL-009 | partial:weak | none | test/e2e/clusters-eth/cluster-eth-liquidation.test.ts | "EB increase triggers auto-liquidation" test exists but does not test reactivation after auto-liq; no deviation round-trip assertion |
| XL-010 | no | none | — | No auto-liq->reactivate->EB update chain test |
| XL-011 | partial:weak | real | test/sanity/removed-operator.test.ts | Test removes op then liquidates (real removeOperator), but uses implicit EB (no deviation), so the underflow bug path (operatorEthVUnits subtraction) is not exercised |
| XL-012 | no | real | — | No test covers double EB update with operator removal between them |
| XL-013 | no | real | — | No test covers auto-liquidation path with removed operator |
| XL-014 | no | real | — | No test covers two operators removed after EB update then liquidation |
| XL-015 | no | real | — | No test covers operator removed BEFORE EB update then liquidation |
| XL-016 | no | real | — | No test covers EB decrease after operator removal |
| XL-017 | no | real | — | No test covers deviation asymmetry across removal + liquidation + reactivation |
| XL-018 | no | real | — | No test covers DAO drift from stale writes to dead operator |
| XL-019 | no | mock_zero | — | No test compares mock vs real removeOperator with EB deviation |
| XL-020 | no | real | — | No test covers chained EB updates with interleaved operator removals |
| XL-021 | no | real | — | No test covers operator removed after liquidation then reactivation |
| XL-022 | no | real | — | No test covers explicit EB cluster with post-liquidation operator removal + reactivation |
| XL-023 | no | real | — | No test covers two operators removed after liquidation |
| XL-024 | no | real | — | No test covers all operators removed after liquidation + reactivation |
| XL-025 | no | real | — | No test covers all operators removed + insufficient reactivation revert |
| XL-026 | no | real | — | No test covers post-liq removal + reactivation + EB update chain |
| XL-027 | no | none | — | No test covers operator fee change during liquidation period |
| XL-028 | no | none | — | No test covers fee increase during liquidation causing reactivation revert |
| XL-029 | no | none | — | No test covers fee decrease during liquidation enabling cheaper reactivation |
| XL-030 | no | real | — | No test covers combined operator removal + fee change during liquidation |
| XL-031 | no | none | — | No double liq/react cycle test with EB deviation drift assertions |
| XL-032 | no | none | — | No triple cycle stress test |
| XL-033 | no | none | — | No test covers reactivation + addValidator + EB + liquidation |
| XL-034 | no | none | — | No test covers reactivation + addValidator + EB triggering auto-liquidation |
| XL-035 | no | none | — | No exact-minimum reactivation threshold test |
| XL-036 | no | none | — | No 1-wei-above threshold test |
| XL-037 | no | none | — | No 1-wei-below threshold revert test |
| XL-038 | no | none | — | No withdraw-after-EB-update liquidation chain test |
| XL-039 | no | none | — | No max EB (2048) liquidation/reactivation test |
| XL-040 | no | none | — | No minimal EB increment precision test |
| XL-041 | no | none | — | No EB update on liquidated cluster + reactivation test |
| XL-042 | no | none | — | No EB increase on liquidated cluster causing insufficient reactivation revert |
| XL-043 | no | none | — | No double EB update on liquidated cluster test |
| XL-044 | no | none | — | No EB decrease on liquidated cluster (slashing) test |
| XL-045 | no | none | — | No EB unchanged on liquidated cluster test |
| XL-046 | no | real | — | No test covers operator removal + EB update on liquidated cluster + reactivation |
| XL-047 | no | none | — | No auto-liq + EB decrease while liquidated + reactivation test |
| XL-048 | no | real | — | No compound liquidation-era EB + removal + reactivation + EB test |
| XL-049 | no | none | — | No concurrent liquidation race test (two callers same block) |
| XL-050 | no | none | — | No liquidate-then-reactivate same block test |
| XL-051 | partial:weak | none | test/integration/SSVNetwork/clusters.test.ts | "Owner can self-liquidate even when not underfunded" exists, but does not test same-block reactivation or deviation round-trip |
| XL-052 | no | none | — | No auto-liq via updateClusterBalance + same-block reactivation test |
| XL-053 | no | none | — | No EB update + third-party liquidation same block test |
| XL-054 | no | none | — | No double reactivation race test |
| XL-055 | no | none | — | No reactivate + EB update same block test |
| XL-056 | partial:weak | none | test/e2e/cross-cutting/economics.test.ts | "Operator Serving Multiple Clusters with Different EBs" covers shared ops + EB + liquidation, but does not assert operatorEthVUnits at subtraction granularity |
| XL-057 | no | none | — | No shared-ops liq-then-reactivate deviation stacking test |
| XL-058 | no | real | — | No shared operator removed between two clusters' liquidations test |
| XL-059 | no | none | — | No addValidator + EB + liq + reactivate chain test |
| XL-060 | no | none | — | No removeValidator + EB decrease + liq + reactivate test |
| XL-061 | no | none | — | No withdraw near threshold + auto-liq on next EB test |
| XL-062 | no | none | — | No EB decrease + deposit making cluster non-liquidatable test |
| XL-063 | no | none | — | No reactivation + removeValidator solvency test |
| XL-064 | no | none | — | No liquidated SSV cluster + EB + migration test |
| XL-065 | no | real | — | No migration path bug with dead operator deviation test |
| XL-066 | no | real | — | No all-operators-removed + reactivate + liquidate underflow test |
| XL-067 | no | real | — | No removed-ops + hasDeviation reactivation test |
| XL-068 | no | none | — | No validator-count mutation after reactivation + EB update test |

**Summary:** 0/68 fully tested. 4 partial (XL-009, XL-011, XL-051, XL-056). 64 have no coverage. The critical bug paths (XL-011 through XL-020) involving operator removal + EB deviation are entirely untested with real removeOperator and explicit EB. The removed-operator.test.ts sanity test only covers implicit EB (no deviation), so it does not exercise the underflow bug.
