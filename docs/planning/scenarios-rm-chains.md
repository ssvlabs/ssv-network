# Cross-Module Scenarios — Removed-Operator Multi-Step Chains (RMC-001 to RMC-045)

**Prefix:** RMC
**Worker:** W3-RM
**Wave:** 3 — Removed-Operator Chain Verification
**Source contracts:** `SSVClusters.sol` (updateClusterBalance, liquidate, reactivate, _executeLiquidation, _liquidateAfterEBUpdateIfNeeded, _updateOperatorVUnits, _applyClusterFeeUpdates, withdraw, deposit, migrateClusterToETH), `SSVOperators.sol` (removeOperator, _resetOperatorState), `SSVValidators.sol` (_bulkRemoveValidator, _bulkRegisterValidator), `OperatorLib.sol` (updateClusterOperators, updateClusterOperatorsOnReactivation, updateSnapshotSt, updateClusterOperatorsMigration)
**Spec refs:** SPEC §1 "Cluster Flows", SPEC §2 "Effective Balance Accounting" (Deviation-Only Model, Operator vUnit Deviation Cleanup), FLOWS §1.9-1.11
**Cross-refs:** XL-011..020 (W2 bug-path chains), OP-001..040 (W1 operator lifecycle), EB-031..100 (W1 EB updates), VL-001..050 (W1 validator registration/removal)

**KEY BUG CONTEXT:** 6 EB bugs traced to `mockRemoveOperator()` not deleting `operatorEthVUnits`. Real `removeOperator()` (SSVOperators.sol:71-104) calls `_resetOperatorState` (zeros `ethSnapshot.block`, `ethValidatorCount`, fees, balances) AND `delete seb.operatorEthVUnits[operatorId]` (line 93). The safe guard pattern: `if (s.operators[operatorId].ethSnapshot.block == 0) continue;` — already present in `updateClusterOperators` (line 247), `_liquidateAfterEBUpdateIfNeeded` (line 541), `updateClusterOperatorsOnReactivation` (line 291). **NOT** present in `_updateOperatorVUnits` (lines 504-509) or `_executeLiquidation` deviation cleanup (lines 586-592). This worker focuses on multi-step chains to verify the guard holds through complex sequences and that no accumulated drift occurs.

---

## Section 1: Full-Chain — Remove Op Then EB Then Liquidate Then Reactivate Then EB Then Remove Validator (RMC-001 to RMC-008)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| RMC-001 | register(4 ops) -> EB(32->48) -> removeOperator(op4) -> liquidate -> reactivate -> EB(48->64) -> removeValidator | Full chain: EB update writes deviation to all 4, remove op4 (deletes operatorEthVUnits[op4]), cluster drains to liquidation, reactivate (3 live ops get ethValidatorCount + deviation via updateClusterOperatorsOnReactivation), second EB update via _updateOperatorVUnits writes to all 4 operatorIds (op4 slot re-populated — stale deviation on dead op). Then remove validator decrements ethValidatorCount on 3 live ops only. Verify: operatorEthVUnits[op4] should remain 0 after full chain if guard applied, or accumulates drift if not | `chain:full-rm; version:eth; eb:explicit; cluster:active->liq->active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:494-510,539-544,552-612,129-181; SSVOperators.sol:71-104,93; SSVValidators.sol:153-257; OperatorLib.sol:233-262,275-330 |
| RMC-002 | register(4 ops) -> removeOperator(op4) -> EB(32->48) -> liquidate -> reactivate -> EB(48->64) -> removeValidator | Operator removed BEFORE first EB update. EB update's _updateOperatorVUnits writes deviation to all 4 including dead op4 (operatorEthVUnits[op4] was deleted, now re-created). Liquidate: _executeLiquidation subtracts deviation from op4's stale slot. Reactivate: deviation re-added to 3 live ops. Second EB: writes to dead op4 again. RemoveValidator: skips dead op4. Verify cumulative drift on op4 across 2 EB updates with interleaved removal | `chain:full-rm-remove-first; version:eth; eb:explicit; cluster:active->liq->active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509,586-592,142-145; SSVOperators.sol:93 |
| RMC-003 | register(7 ops) -> EB(32->48) -> removeOperator(op7) -> EB(48->64) -> liquidate -> reactivate -> EB(64->48) -> removeValidator(2 validators) | 7-op cluster stress: EB increase writes deviation to all 7, remove op7, second EB increase writes delta to all 7 including dead op7, liquidate (deviation cleanup on all 7 — op7 has stale data), reactivate (6 live ops), third EB decrease subtracts delta from all 7 — op7 underflow risk. Bulk remove 2 validators from active cluster. Verify per-operator accounting for 6 live + 1 dead across 3 EB swings | `chain:full-rm-7ops; version:eth; eb:explicit; cluster:active->liq->active; ops:7; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509,586-592,539-544; SSVValidators.sol:153-257; OperatorLib.sol:233-262,275-330 |
| RMC-004 | register(4 ops) -> EB(32->48) -> removeOperator(op3) -> removeOperator(op4) -> liquidate -> reactivate -> EB(48->32) -> removeValidator(all) | Two operators removed between EB update and liquidation. Reactivation: only 2 live ops. EB decrease to baseline: storedVUnits goes from 15000 to 10000, delta = -5000 subtracted from all 4 operatorIds via _updateOperatorVUnits — ops 3,4 are dead. Then remove all validators: cluster empty, deviation cleanup for explicit cluster with validatorCount=0 on 2 live ops. Verify operatorEthVUnits for dead ops and daoTotalEthVUnits invariant | `chain:full-rm-double-remove; version:eth; eb:explicit; cluster:active->liq->active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509,586-592; SSVValidators.sol:196-227; SSVOperators.sol:93 |
| RMC-005 | register(4 ops) -> EB(32->48) -> removeOperator(op4) -> liquidate -> reactivate -> EB(48->64) -> addValidator -> removeValidator | Full chain with validator add/remove after second EB update. Adding validator increments ethValidatorCount on 3 live ops (updateClusterOperatorsOnRegistration skips dead ops via ensureOperatorExist). Then remove validator decrements on 3 live ops. Verify ebSnapshot.vUnits grows by BPS_DENOMINATOR on addValidator for explicit cluster, shrinks by BPS_DENOMINATOR on removeValidator | `chain:full-rm-val-add-remove; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; guard:updateClusterOperatorsOnRegistration; revert:no` | [ ] | SSVClusters.sol:504-509; SSVValidators.sol:105-151,153-257; OperatorLib.sol:155-221 |
| RMC-006 | register(4 ops) -> EB(32->48) -> removeOperator(op4) -> liquidate -> reactivate -> EB(48->64) -> withdraw -> EB(64->48) | Full chain with withdraw between EB updates. Withdraw's solvency check (isLiquidatableWithEB) reads cluster vUnits. After second EB (48->64), withdraw some balance, then third EB decrease (64->48). Verify: _applyClusterFeeUpdates uses oldVUnits (20000 from second EB) for fee calculation, _updateOperatorVUnits writes delta to dead op4. Withdraw solvency correct despite dead operator reducing burn rate | `chain:full-rm-withdraw; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:206-254,461-492,504-509; OperatorLib.sol:233-262 |
| RMC-007 | register(4 ops, implicit) -> removeOperator(op4) -> liquidate -> reactivate -> EB(32->48, first explicit) -> removeValidator | Implicit cluster throughout removal and liquidation cycle. First EB update makes cluster explicit AFTER reactivation. _updateOperatorVUnits: storedVUnits was 0 -> becomes validatorCount*BPS=10000, newVUnits=15000, delta=+5000 written to all 4 including dead op4. RemoveValidator on 3 live ops. Verify transition from implicit to explicit with dead operator present | `chain:full-rm-implicit-to-explicit; version:eth; eb:implicit->explicit; cluster:active->liq->active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:389-391,504-509; SSVValidators.sol:153-257; OperatorLib.sol:247 |
| RMC-008 | register(13 ops) -> EB(32->48) -> removeOperator(ops 5-13) -> liquidate -> reactivate -> EB(48->64) -> removeValidator | Extreme: 13-op cluster, remove 9 of 13 operators. Liquidation: deviation cleanup iterates all 13, subtracts from 9 deleted slots. Reactivation: 4 live ops get ethValidatorCount + deviation. Second EB: _updateOperatorVUnits iterates all 13, writes delta to 9 dead slots. Verify: 9 dead operators accumulate stale deviation, 4 live operators have correct values, daoTotalEthVUnits tracks only live operator contributions | `chain:full-rm-13ops; version:eth; eb:explicit; cluster:active->liq->active; ops:13; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509,586-592; SSVOperators.sol:93; OperatorLib.sol:233-262,275-330 |

---

## Section 2: Cascading Operator Removal — Remove Op1 Then EB Then Remove Op2 Then Liquidate Then Reactivate Then EB (RMC-009 to RMC-015)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| RMC-009 | register(4 ops) -> removeOperator(op3) -> EB(32->48) -> removeOperator(op4) -> liquidate -> reactivate -> EB(48->64) | Cascading: op3 removed before EB, op4 removed after EB. First EB writes deviation to all 4 — op3 is dead (deviation written to deleted slot), op4 is alive (gets legitimate deviation). Remove op4: deletes operatorEthVUnits[op4]. Liquidate: deviation cleanup subtracts from all 4 — op3 has stale data, op4 is now 0. Reactivate: 2 live ops. Second EB: delta to all 4 — both dead ops get stale writes. Verify cascading removal creates asymmetric stale state | `chain:cascade-rm; version:eth; eb:explicit; cluster:active->liq->active; ops:4; remove_mode:real; guard:_updateOperatorVUnits+_executeLiquidation; revert:no` | [ ] | SSVClusters.sol:504-509,586-592; SSVOperators.sol:93 |
| RMC-010 | register(4 ops) -> EB(32->48) -> removeOperator(op4) -> EB(48->64) -> removeOperator(op3) -> EB(64->48) -> liquidate | Three EB updates interleaved with two operator removals. First EB: +5000 to all 4. Remove op4: deletes slot. Second EB: delta +5000 to all 4 (op4 stale write: 0->5000). Remove op3: deletes slot (had 10000 from two EBs). Third EB: delta -5000 to all 4 — op4 goes 5000->0, op3 goes 0 with underflow risk. Liquidate cleanup. Verify each EB's _updateOperatorVUnits handles accumulated vs deleted state | `chain:cascade-interleaved; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509; SSVOperators.sol:93 |
| RMC-011 | register(4 ops) -> removeOperator(op2) -> removeOperator(op3) -> removeOperator(op4) -> EB(32->48) -> liquidate -> reactivate -> EB(48->64) | Three operators removed before ANY EB update. First EB: _updateOperatorVUnits writes deviation to all 4, but ops 2,3,4 are dead (operatorEthVUnits deleted). Each gets stale deviation. Liquidate: subtracts from all 4 — 3 stale slots. Reactivate: only op1 is live. Second EB: delta to all 4, 3 dead slots again. Verify single live operator cluster functions correctly despite 3 ghost operators | `chain:cascade-triple-rm; version:eth; eb:explicit; cluster:active->liq->active; ops:4; remove_mode:real; guard:_updateOperatorVUnits+_executeLiquidation; revert:no` | [ ] | SSVClusters.sol:504-509,586-592; OperatorLib.sol:247,291 |
| RMC-012 | register(4 ops) -> EB(32->48) -> removeOperator(op4) -> EB(48->64) -> removeOperator(op3) -> liquidate -> reactivate -> EB(64->96) -> removeOperator(op2) -> EB(96->64) | Four-step cascade: remove one operator at a time between EB updates. Each removal deletes operatorEthVUnits. Each subsequent EB writes to progressively more dead slots. After reactivating with 2 live ops, remove another, leaving only op1. Final EB decrease: _updateOperatorVUnits subtracts delta from all 4 — 3 dead, potential triple underflow. Verify drift compounds linearly with number of dead operators | `chain:cascade-progressive; version:eth; eb:explicit; cluster:active->liq->active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509,586-592; SSVOperators.sol:93; OperatorLib.sol:275-330 |
| RMC-013 | register(4 ops) -> EB(32->48) -> removeOperator(op4) -> EB(48->32, decrease) -> removeOperator(op3) -> EB(32->48, increase) -> liquidate | EB oscillation with interleaved removals: increase then decrease then increase. Op4 removed after first increase (had +5000), second EB subtracts 5000 from dead op4 (underflow if guard absent). Op3 removed after decrease (had 0), third EB adds 5000 to dead op3. Liquidate: deviation cleanup on mixed dead states. Verify oscillating EB with interleaved removals creates predictable final state | `chain:cascade-oscillation; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509,586-592 |
| RMC-014 | register(7 ops) -> removeOperator(op7) -> EB(32->48) -> removeOperator(op6) -> EB(48->64) -> removeOperator(op5) -> liquidate -> reactivate -> EB(64->48) | 7-op cascade: remove ops 7,6,5 one at a time with EB updates between each. Reactivate with 4 live ops. EB decrease: delta subtracted from all 7, ops 5,6,7 dead. Verify 7-operator iteration with 3 dead slots handles correctly. daoTotalEthVUnits should reflect only 4 live operators' contributions | `chain:cascade-7ops; version:eth; eb:explicit; cluster:active->liq->active; ops:7; remove_mode:real; guard:_updateOperatorVUnits+_executeLiquidation; revert:no` | [ ] | SSVClusters.sol:504-509,586-592; SSVOperators.sol:93 |
| RMC-015 | register(4 ops) -> EB(32->48) -> removeOperator(op4) -> EB(48->64) -> removeOperator(op3) -> EB(64->96) -> removeOperator(op2) -> EB(96->128) -> liquidate -> reactivate | Progressive removal until single operator remains, with EB increase at each step. Each EB writes to growing number of dead slots. Final state: 3 dead operators with layered stale deviations, 1 live operator. Liquidate: deviation cleanup iterates 4, only 1 legitimate. Reactivate: 1 live op, clusterDeviation re-added to only op1. Verify single-operator cluster is fully functional | `chain:cascade-to-single-op; version:eth; eb:explicit; cluster:active->liq->active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509,586-592; OperatorLib.sol:291; SSVOperators.sol:93 |

---

## Section 3: Sequential Operator Removal From Single Cluster — All 4 Ops Removed One By One With EB Updates Between (RMC-016 to RMC-020)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| RMC-016 | register(4 ops) -> EB(32->48) -> removeOperator(op4) -> EB(48->64) -> removeOperator(op3) -> EB(64->96) -> removeOperator(op2) -> EB(96->128) -> removeOperator(op1) | All 4 operators removed one by one with EB increase between each. After all removed: ethSnapshot.block == 0 for all. Last EB update writes to all 4 dead slots. Final removeOperator(op1): deletes last legitimate operatorEthVUnits. Verify: cluster has 0 live operators, burn rate = 0, all operatorEthVUnits deleted by real removeOperator. No stale deviation persists after all operators removed | `chain:all-4-removed-sequential; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509; SSVOperators.sol:71-104,93 |
| RMC-017 | register(4 ops) -> removeOperator(op1) -> EB(32->48) -> removeOperator(op2) -> EB(48->64) -> removeOperator(op3) -> EB(64->48) -> removeOperator(op4) -> liquidate | Same as RMC-016 but with EB decrease in third update and liquidation at end. All operators dead before liquidation. Liquidate: _executeLiquidation iterates all 4, all dead. updateClusterOperators in liquidate flow: all ops have ethSnapshot.block == 0, all skipped. Deviation cleanup iterates dead slots. Verify: liquidation with 0 live operators succeeds (self-liquidation bypasses threshold check) | `chain:all-4-removed-then-liq; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; guard:_executeLiquidation+updateClusterOperators; revert:no` | [ ] | SSVClusters.sol:31-65,552-612; OperatorLib.sol:247 |
| RMC-018 | register(4 ops) -> EB(32->48) -> removeOperator(op4) -> EB(48->64) -> removeOperator(op3) -> EB(64->96) -> removeOperator(op2) -> EB(96->128) -> removeOperator(op1) -> reactivate | All operators removed then attempt reactivation. updateClusterOperatorsOnReactivation: all 4 have ethSnapshot.block == 0, all skipped. cumulativeFee = 0, burnRate = 0. Solvency check with burnRate=0 and effectiveVUnits from stored snapshot. If networkFee > 0, threshold depends on networkFee * effectiveVUnits. Verify: reactivation succeeds with sufficient msg.value but cluster is non-functional (no live operators) | `chain:all-4-removed-reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; guard:updateClusterOperatorsOnReactivation; revert:no` | [ ] | OperatorLib.sol:291; SSVClusters.sol:129-181; ClusterLib.sol:96-112 |
| RMC-019 | register(4 ops) -> EB(32->48) -> removeOperator(op4) -> EB(48->64) -> removeOperator(op3) -> EB(64->96) -> removeOperator(op2) -> removeOperator(op1) -> EB(96->128) | Last two operators removed in same "step" (no EB between). Then EB update: _updateOperatorVUnits iterates all 4, all dead. storedVUnits has accumulated deviations from previous EBs, newVUnits has new value. Delta applied to 4 dead slots. Verify: all writes are to deleted storage (operatorEthVUnits deleted by removeOperator), creating 4 orphaned deviation entries | `chain:batch-remove-last-two; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509; SSVOperators.sol:93 |
| RMC-020 | register(4 ops, implicit) -> removeOperator(op4) -> removeOperator(op3) -> removeOperator(op2) -> removeOperator(op1) -> EB(32->48, first explicit) | Implicit cluster: all operators removed before any EB update. EB update transitions to explicit: storedVUnits = 0 -> validatorCount*BPS, newVUnits from EB. _updateOperatorVUnits writes delta to all 4 dead slots. Verify: implicit->explicit transition with all dead operators creates deviation on 4 orphaned slots. daoTotalEthVUnits incremented but no live operator holds the deviation | `chain:all-removed-implicit-to-explicit; version:eth; eb:implicit->explicit; cluster:active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:389-391,504-509; SSVOperators.sol:93 |

---

## Section 4: Cross-Cluster Isolation — Removed Operator Shared Between Clusters (RMC-021 to RMC-028)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| RMC-021 | register clusterA(ops 1,2,3,4) -> register clusterB(ops 1,2,5,6) -> EB_A(32->48) -> removeOperator(op4) -> EB_B(32->48) | Op4 is in cluster A only. Remove op4. EB update on cluster B (which doesn't include op4): _updateOperatorVUnits iterates ops 1,2,5,6 only. Verify: op4 removal has ZERO effect on cluster B's deviation accounting. Ops 1,2 get cluster B deviation correctly, no contamination from op4's removal | `chain:cross-cluster-isolation; version:eth; eb:explicit; cluster:A_active,B_active; ops:parametric; remove_mode:real; guard:isolation; revert:no` | [ ] | SSVClusters.sol:504-509; SSVOperators.sol:93 |
| RMC-022 | register clusterA(ops 1,2,3,4) -> register clusterB(ops 3,4,5,6) -> EB_A(32->48) -> EB_B(32->48) -> removeOperator(op4) -> EB_A(48->64) -> EB_B(48->64) | Ops 3,4 shared between clusters A and B. Both get EB updates (deviation stacks on shared ops). Remove op4 (deletes operatorEthVUnits[op4] which had deviation from BOTH clusters). Second EB update on cluster A: _updateOperatorVUnits writes delta to op4 (stale — only cluster A's delta, not the accumulated value from both). Same for cluster B. Verify: op4 accumulates stale deviation from both clusters independently after deletion | `chain:cross-cluster-shared-removed; version:eth; eb:explicit; cluster:A_active,B_active; ops:parametric; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509; SSVOperators.sol:93 |
| RMC-023 | register clusterA(ops 1,2,3,4) -> register clusterB(ops 1,2,3,4) -> EB_A(32->48) -> removeOperator(op4) -> EB_B(32->48) -> liquidate_A -> liquidate_B | Same 4 operators in both clusters. EB on A writes deviation to all 4. Remove op4. EB on B writes deviation to all 4 including dead op4. Liquidate A: _executeLiquidation subtracts cluster A deviation from dead op4. Liquidate B: subtracts cluster B deviation from op4 — but op4's slot may have been modified by cluster A's liquidation. Verify: each cluster's deviation cleanup is independent, no cross-cluster interference on dead operator's slot | `chain:cross-cluster-same-ops-liq; version:eth; eb:explicit; cluster:A_active,B_active; ops:4; remove_mode:real; guard:_executeLiquidation; revert:no` | [ ] | SSVClusters.sol:504-509,586-592; SSVOperators.sol:93 |
| RMC-024 | register clusterA(ops 1,2,3,4) -> removeOperator(op4) -> register clusterB(ops 1,2,3,4) | Attempt to register cluster B with removed operator op4. ensureOperatorExist checks: owner != address(0) AND (ethSnapshot.block != 0 OR snapshot.block != 0). removeOperator zeros ethSnapshot.block but does NOT zero owner. If operator had no SSV snapshot (snapshot.block == 0), ensureOperatorExist reverts OperatorDoesNotExist. Verify: registration correctly rejects dead operator | `chain:cross-cluster-register-dead; version:eth; eb:n/a; cluster:B_register; ops:4; remove_mode:real; guard:ensureOperatorExist; revert:yes` | [ ] | OperatorLib.sol:139-144; SSVOperators.sol:347-358 |
| RMC-025 | register clusterA(ops 1,2,3,4) -> register clusterB(ops 1,2,5,6) -> EB_A(32->48) -> removeOperator(op4) -> EB_A(48->64) -> operations on clusterB (deposit, withdraw, EB) | Op4 removed from cluster A. Subsequent operations on cluster B (which never had op4): deposit, withdraw (solvency check), EB update. All cluster B operations iterate ops 1,2,5,6 only. Verify: cluster B is entirely unaffected by op4 removal. No observable difference in cluster B behavior vs. a world where op4 was never removed | `chain:cross-cluster-unaffected; version:eth; eb:explicit; cluster:A_active,B_active; ops:parametric; remove_mode:real; guard:isolation; revert:no` | [ ] | SSVClusters.sol:186-201,206-254,348-417 |
| RMC-026 | register clusterA(ops 1,2,3,4) -> EB_A(32->48) -> removeOperator(op4) -> migrateClusterB(ops 1,2,3,4) from SSV to ETH | Attempt to migrate a second cluster that includes dead op4 from SSV to ETH. updateClusterOperatorsMigration: for dead op4, snapshot.block == 0 AND ethSnapshot.block == 0 → continue (line 363-364). Op4 skipped entirely for ETH setup. Verify: migration succeeds but cluster B effectively operates with 3 live operators. ethValidatorCount incremented on 3 live ops only (or on 4 if ensureETHDefaults re-initializes dead op — ambiguity to verify) | `chain:cross-cluster-migrate-dead; version:eth; eb:explicit; cluster:B_migrate; ops:4; remove_mode:real; guard:updateClusterOperatorsMigration; revert:no` | [ ] | OperatorLib.sol:343-384,363-364; SSVOperators.sol:347-358 |
| RMC-027 | register clusterA(ops 1,2,3,4) -> register clusterB(ops 1,2,5,6) -> EB_A(32->48) -> removeOperator(op1) -> EB_B(32->48) -> liquidate_B | Op1 shared between clusters, removed after cluster A's EB. Cluster B's EB update: _updateOperatorVUnits writes deviation to ops 1,2,5,6 — op1 dead, stale write. Cluster B liquidation: _executeLiquidation subtracts deviation from op1's stale slot. Meanwhile cluster A still has op1 in its operatorIds but op1 is dead. Verify: shared-operator removal affects BOTH clusters' deviation accounting independently | `chain:cross-cluster-shared-removed-liq; version:eth; eb:explicit; cluster:A_active,B_active; ops:parametric; remove_mode:real; guard:_updateOperatorVUnits+_executeLiquidation; revert:no` | [ ] | SSVClusters.sol:504-509,586-592; SSVOperators.sol:93 |
| RMC-028 | register clusterA(ops 1,2,3,4) -> register clusterB(ops 1,2,3,4) -> EB_A(32->48) -> EB_B(32->64) -> removeOperator(op4) -> EB_A(48->64) -> EB_B(64->96) -> verify operatorEthVUnits[op4] | Same 4 operators, both clusters get different EB levels, then op4 removed. Both clusters' subsequent EB updates write to dead op4 independently. Verify: operatorEthVUnits[op4] after both updates = sum of both clusters' deltas written to the dead slot (not the correct value of 0). Quantify exact drift amount: cluster A delta + cluster B delta on a slot that should be 0 | `chain:cross-cluster-quantify-drift; version:eth; eb:explicit; cluster:A_active,B_active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509; SSVOperators.sol:93 |

---

## Section 5: Long Chain Drift Detection — 10+ Operations With Removed Operator (RMC-029 to RMC-033)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| RMC-029 | register(4 ops) -> EB(32->48) -> removeOperator(op4) -> EB(48->64) -> EB(64->96) -> EB(96->128) -> EB(128->96) -> EB(96->64) -> EB(64->48) -> EB(48->32) -> EB(32->48) -> EB(48->64) -> liquidate | 10 consecutive EB updates after operator removal. Each EB's _updateOperatorVUnits writes delta to dead op4. Deltas alternate positive and negative (increase/decrease pattern). Verify: op4's operatorEthVUnits accumulates net drift over 10 updates. Final liquidation's deviation cleanup uses accumulated cluster deviation, not per-operation tracking. Quantify: expected op4 drift = sum of all 10 deltas applied to the orphaned slot | `chain:long-10-eb; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509,586-592 |
| RMC-030 | register(4 ops) -> removeOperator(op4) -> [EB(32->48) -> deposit -> withdraw -> EB(48->32)]x3 -> liquidate | 12-operation chain: 3 cycles of (EB increase, deposit, withdraw, EB decrease) with dead op4. Each EB pair (up then down) should net to zero delta. Verify: after 3 complete oscillation cycles, op4's operatorEthVUnits = 0 (each increase writes +delta, each decrease writes -delta, net zero). No cumulative drift if oscillations are symmetric | `chain:long-oscillation; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509,186-201,206-254 |
| RMC-031 | register(4 ops) -> EB(32->48) -> removeOperator(op4) -> EB(48->64) -> addValidator -> EB(64->96) -> removeValidator -> EB(96->64) -> deposit -> EB(64->128) -> withdraw -> EB(128->64) -> liquidate -> reactivate | 13-operation chain mixing EB updates, validator management, deposits, withdrawals, liquidation, and reactivation — all with dead op4. Validator add/remove changes baseline (validatorCount * BPS). Verify: each EB's storedVUnits calculation accounts for changed validatorCount AND writes to dead op4. Net drift on op4 = sum of all _updateOperatorVUnits deltas. Reactivation only re-adds deviation to 3 live ops | `chain:long-mixed-13ops; version:eth; eb:explicit; cluster:multi-state; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509,586-592,142-145; SSVValidators.sol:105-151,153-257; OperatorLib.sol:275-330 |
| RMC-032 | register(4 ops) -> EB(32->33) -> removeOperator(op4) -> [EB(+1 ETH)]x10 -> liquidate | 10 minimal EB increments (1 ETH each: 33->34->...->43) after op4 removal. Each increment: vUnits delta = ebToVUnits(N+1) - ebToVUnits(N) ≈ 312 per step. _updateOperatorVUnits adds ~312 to dead op4 each time. After 10 steps: op4 has ~3120 stale vUnits. Verify: precision of ceiling division in ebToVUnits compounds correctly over many small increments. Dead operator drift = exactly sum of 10 rounded deltas | `chain:long-precision-drift; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509; ClusterLib.sol:366-371 |
| RMC-033 | register(4 ops) -> EB(32->48) -> removeOperator(op4) -> EB(48->64) -> removeOperator(op3) -> EB(64->96) -> removeOperator(op2) -> [EB(+32 ETH)]x5 -> liquidate -> reactivate | Progressive operator removal with continued EB growth. After 3 operators removed, 5 more EB increases with only op1 live. Each EB writes delta to 3 dead ops. Liquidation: deviation cleanup on 3 dead + 1 live. Reactivation: only op1 gets ethValidatorCount + deviation. Verify: daoTotalEthVUnits invariant maintained through progressive degradation. Operator 1's operatorEthVUnits = all legitimate deviations, ops 2,3,4 have layered stale data | `chain:long-progressive-removal; version:eth; eb:explicit; cluster:active->liq->active; ops:4; remove_mode:real; guard:_updateOperatorVUnits+_executeLiquidation; revert:no` | [ ] | SSVClusters.sol:504-509,586-592; OperatorLib.sol:291; SSVOperators.sol:93 |

---

## Section 6: Multi-Cluster Same Removed Operator — Independent Handling (RMC-034 to RMC-038)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| RMC-034 | register clusterA(ops 1,2,3,4) -> register clusterB(ops 1,2,3,4) -> register clusterC(ops 1,2,3,4) -> removeOperator(op4) -> EB_A(32->48) -> EB_B(32->64) -> EB_C(32->96) | 3 clusters with same operators, op4 removed, then each gets a DIFFERENT EB level. _updateOperatorVUnits writes to dead op4 three times with different deltas. Verify: operatorEthVUnits[op4] = sum of all 3 clusters' deltas (should be 0 if guard present, or 5000+10000+20000=35000 stale if not). Each cluster's deviation accounting is independently correct for ops 1,2,3 | `chain:multi-cluster-3-same-ops; version:eth; eb:explicit; cluster:A_B_C_active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509; SSVOperators.sol:93 |
| RMC-035 | register clusterA(ops 1,2,3,4) -> register clusterB(ops 1,2,3,4) -> EB_A(32->48) -> EB_B(32->48) -> removeOperator(op4) -> liquidate_A -> liquidate_B | Both clusters have same EB deviation on op4 before removal. Remove op4. Liquidate A: _executeLiquidation subtracts 5000 from op4's stale slot. Liquidate B: subtracts another 5000. If guard absent and op4 had 10000 stale from both EBs before removal, after both liquidations op4 should be 0. But removeOperator already deleted the slot, so A's liquidation writes -5000 to empty slot (underflow on uint64), B's subtracts from that. Verify: arithmetic safety | `chain:multi-cluster-double-liq; version:eth; eb:explicit; cluster:A_B_active; ops:4; remove_mode:real; guard:_executeLiquidation; revert:no` | [ ] | SSVClusters.sol:586-592; SSVOperators.sol:93 |
| RMC-036 | register clusterA(ops 1,2,3,4) -> register clusterB(ops 1,2,3,4) -> EB_A(32->48) -> removeOperator(op4) -> EB_B(32->48) -> liquidate_A -> reactivate_A -> EB_A(48->64) | Cluster A and B share all ops. Remove op4 after A's EB. B's EB writes to dead op4. Liquidate A: cleans deviation from dead op4's stale slot. Reactivate A: deviation re-added to 3 live ops only (op4 skipped by guard in updateClusterOperatorsOnReactivation line 291). New EB on A: _updateOperatorVUnits writes to dead op4 again. Verify: reactivation correctly excludes dead operator, but subsequent EB re-contaminates. Cluster B's accounting unaffected by A's lifecycle | `chain:multi-cluster-react-then-eb; version:eth; eb:explicit; cluster:A_active->liq->active,B_active; ops:4; remove_mode:real; guard:_updateOperatorVUnits+updateClusterOperatorsOnReactivation; revert:no` | [ ] | SSVClusters.sol:504-509,586-592; OperatorLib.sol:291,312-319 |
| RMC-037 | register clusterA(ops 1,2,3,4) -> register clusterB(ops 1,2,3,4) -> register clusterC(ops 1,2,3,4) -> EB_A(32->48) -> EB_B(32->64) -> removeOperator(op4) -> EB_C(32->48) -> liquidate_A -> liquidate_B -> liquidate_C | 3 clusters, different EBs, shared op4 removed, then all 3 liquidated in sequence. Each liquidation's _executeLiquidation iterates ops and subtracts its cluster's deviation from dead op4. Verify: sequential liquidation of 3 clusters all touching dead op4 produces correct final state. operatorEthVUnits[op4] must not underflow if guard handles deletions | `chain:multi-cluster-triple-liq; version:eth; eb:explicit; cluster:A_B_C_active; ops:4; remove_mode:real; guard:_executeLiquidation; revert:no` | [ ] | SSVClusters.sol:586-592; SSVOperators.sol:93 |
| RMC-038 | register clusterA(ops 1,2,3,4) -> register clusterB(ops 1,2,3,4) -> EB_A(32->48) -> removeOperator(op4) -> EB_B(32->48) -> removeValidator from clusterA -> removeValidator from clusterB (all validators) | Both clusters with dead op4, remove validators from each. _bulkRemoveValidator: updateClusterOperators iterates operatorIds, skips dead op4 (ethSnapshot.block == 0 guard at line 247). ethValidatorCount decremented on 3 live ops. For explicit clusters going to validatorCount=0: deviation cleanup at lines 216-217 subtracts remainingVUnits from operatorEthVUnits — iterates all 4 including dead op4. Verify: validator removal deviation cleanup writes to dead op4 | `chain:multi-cluster-remove-all-val; version:eth; eb:explicit; cluster:A_B_active; ops:4; remove_mode:real; guard:_bulkRemoveValidator; revert:no` | [ ] | SSVValidators.sol:196-227,216-217; SSVClusters.sol:504-509; OperatorLib.sol:247 |

---

## Section 7: Mixed Implicit/Explicit EB Clusters Sharing Removed Operator (RMC-039 to RMC-042)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| RMC-039 | register clusterA(ops 1,2,3,4, implicit) -> register clusterB(ops 1,2,3,4, explicit: EB 32->48) -> removeOperator(op4) -> EB_B(48->64) -> operations on clusterA | Cluster A is implicit (no EB update ever), cluster B is explicit. Remove shared op4. Cluster B's EB update writes to dead op4. Operations on implicit cluster A: updateClusterOperators skips dead op4 (guard at line 247). Since cluster A never had EB update, ebSnapshot.vUnits=0 for A — no deviation involved. Verify: implicit cluster is completely immune to shared removed operator's stale deviation from explicit cluster | `chain:mixed-implicit-explicit; version:eth; eb:A_implicit,B_explicit; cluster:A_B_active; ops:4; remove_mode:real; guard:isolation; revert:no` | [ ] | SSVClusters.sol:504-509; OperatorLib.sol:247 |
| RMC-040 | register clusterA(ops 1,2,3,4, implicit) -> register clusterB(ops 1,2,3,4, explicit: EB 32->48) -> removeOperator(op4) -> EB_A(32->48, first explicit for A) -> EB_B(48->64) | Both clusters share ops, op4 removed. Cluster A transitions from implicit to explicit with its first EB update. _updateOperatorVUnits for cluster A: storedVUnits=0 -> becomes validatorCount*BPS=10000, newVUnits=15000, delta=+5000 written to all 4 including dead op4. Cluster B also writes to dead op4. Verify: implicit-to-explicit transition on cluster A correctly computes baseline but contaminates dead op4's slot alongside cluster B's contamination | `chain:mixed-both-explicit-after-rm; version:eth; eb:A_implicit->explicit,B_explicit; cluster:A_B_active; ops:4; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:389-391,504-509 |
| RMC-041 | register clusterA(ops 1,2,3,4, explicit: EB 32->48) -> register clusterB(ops 1,2,3,4, implicit) -> removeOperator(op4) -> liquidate_A -> liquidate_B | Explicit cluster A has deviation on op4 before removal. Implicit cluster B has no deviation. Remove op4. Liquidate A: _executeLiquidation subtracts A's deviation from dead op4's slot. Liquidate B: vUnitsCluster=0 for B, so deviation cleanup skipped entirely (line 569). Verify: implicit cluster's liquidation correctly ignores deviation cleanup, dead operator unaffected by B's liquidation | `chain:mixed-explicit-liq-implicit-liq; version:eth; eb:A_explicit,B_implicit; cluster:A_B_active; ops:4; remove_mode:real; guard:_executeLiquidation; revert:no` | [ ] | SSVClusters.sol:569-597; SSVOperators.sol:93 |
| RMC-042 | register clusterA(ops 1,2,3,4, explicit: EB 32->48) -> register clusterB(ops 1,2,3,4, implicit) -> removeOperator(op4) -> EB_A(48->64) -> liquidate_A -> reactivate_A -> EB_A(64->48) -> liquidate_B -> reactivate_B | Full lifecycle on both clusters with shared dead op4. Cluster A (explicit) goes through EB->liquidate->reactivate->EB cycle, writing to dead op4 at each EB step. Cluster B (implicit) goes through liquidate->reactivate cycle, never touching EB deviation. Verify: two clusters with different EB modes and shared dead operator maintain independent accounting. daoTotalEthVUnits reflects only explicit cluster A's deviations | `chain:mixed-full-lifecycle; version:eth; eb:A_explicit,B_implicit; cluster:A_B_multi-state; ops:4; remove_mode:real; guard:all; revert:no` | [ ] | SSVClusters.sol:504-509,586-592,142-145; OperatorLib.sol:247,291 |

---

## Section 8: Stress — 13 Operators, Remove 12, Keep 1 (RMC-043 to RMC-045)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| RMC-043 | register(13 ops) -> EB(32->48) -> removeOperator(ops 2-13) -> EB(48->64) -> deposit -> withdraw -> liquidate -> reactivate | 13-op cluster, EB update writes deviation to all 13, remove 12 operators in batch, second EB update writes delta to all 13 (12 dead). Deposit/withdraw operate normally. Liquidation: _executeLiquidation iterates 13 operators, subtracts deviation from 12 dead slots. Reactivation: only op1 gets ethValidatorCount/deviation. Verify: single remaining operator carries entire cluster's burn rate. All 12 dead operator slots have stale deviation. Gas cost of 13-operator iteration | `chain:stress-13-remove-12; version:eth; eb:explicit; cluster:active->liq->active; ops:13; remove_mode:real; guard:all; revert:no` | [ ] | SSVClusters.sol:504-509,586-592,129-181; OperatorLib.sol:233-262,275-330,291; SSVOperators.sol:93 |
| RMC-044 | register(13 ops) -> EB(32->48) -> removeOperator(ops 2-13) -> EB(48->64) -> EB(64->96) -> EB(96->128) -> EB(128->96) -> EB(96->64) -> liquidate | 13-op cluster with 12 removed, then 6 consecutive EB updates. Each update's _updateOperatorVUnits iterates all 13, writing to 12 dead slots per update. Total stale writes: 12 * 6 = 72 dead-slot modifications. Verify: cumulative drift on each dead operator = net delta across 6 EB changes. Final liquidation cleanup on 12 stale slots. Measure: total stale vUnits across all dead operators vs. correct value (0) | `chain:stress-13-6-eb-updates; version:eth; eb:explicit; cluster:active; ops:13; remove_mode:real; guard:_updateOperatorVUnits; revert:no` | [ ] | SSVClusters.sol:504-509,586-592 |
| RMC-045 | register(13 ops) -> EB(32->48) -> removeOperator(ops 2-13) -> addValidator(3 more) -> EB(48->64) -> removeValidator(2) -> EB(64->48) -> removeValidator(all remaining) -> verify ebSnapshot and operatorEthVUnits | 13-op cluster, remove 12 operators, then add/remove validators with EB updates between. Adding validators: updateClusterOperatorsOnRegistration (ensureOperatorExist) will REJECT dead operators (owner != 0 but ethSnapshot.block == 0 and snapshot.block == 0) → revert OperatorDoesNotExist. This means: clusters with removed operators CANNOT add new validators. Verify: this is the expected behavior — cluster is effectively frozen for new registrations but can still have validators removed and go through liquidation/reactivation | `chain:stress-13-val-ops; version:eth; eb:explicit; cluster:active; ops:13; remove_mode:real; guard:ensureOperatorExist; revert:partial` | [ ] | OperatorLib.sol:139-144; SSVValidators.sol:105-151,153-257; SSVClusters.sol:504-509 |

---

## Detailed Scenario Blocks

### Block 1: RMC-001 — Full Chain End-to-End With Guard Verification

**Setup:**
- Register 4 operators (op1-op4) with ethFee = 1000 wei each
- Register cluster C1 with ops [1,2,3,4], 1 validator, deposit 10 ETH
- Set minimumBlocksBeforeLiquidation = 100, networkFee = 500 wei

**Steps:**
1. `updateClusterBalance(C1, effectiveBalance=48)`: newVUnits = 15000, storedVUnits = 10000 (baseline). _updateOperatorVUnits: delta = +5000 written to ops 1,2,3,4. operatorEthVUnits = [5000, 5000, 5000, 5000]. daoTotalEthVUnits += 5000.
2. `removeOperator(op4)`: _resetOperatorState zeros ethSnapshot.block, ethFee, ethValidatorCount, balances. `delete seb.operatorEthVUnits[4]`. operatorEthVUnits = [5000, 5000, 5000, 0].
3. Advance blocks until cluster C1 is liquidatable. `liquidate(C1)`: updateClusterOperators iterates ops 1,2,3,4 — op4 has ethSnapshot.block == 0 → skipped (line 247). Only ops 1,2,3 snapshot-updated and ethValidatorCount decremented. _executeLiquidation: deviation cleanup iterates all 4. `seb.operatorEthVUnits[4] -= 5000` — underflow on 0 if no guard. **Critical verification point.**
4. `reactivate(C1, msg.value=20 ETH)`: updateClusterOperatorsOnReactivation: op4 has ethSnapshot.block == 0 → skipped (line 291). clusterDeviation = 5000 (from stored vUnits 15000 - baseline 10000). Deviation added to ops 1,2,3 only. operatorEthVUnits = [10000, 10000, 10000, X] where X depends on step 3.
5. `updateClusterBalance(C1, effectiveBalance=64)`: newVUnits = 20000, storedVUnits = 15000. _updateOperatorVUnits: delta = +5000 written to all 4 operatorIds including dead op4. **Second guard verification: writes to dead op4.**
6. `removeValidator(C1, pk1)`: updateClusterOperators: op4 skipped (line 247). ethValidatorCount decremented on ops 1,2,3 only. ebSnapshot.vUnits -= BPS_DENOMINATOR.

**Assertions:**
- After step 2: operatorEthVUnits[op4] == 0 (deleted)
- After step 3: operatorEthVUnits[op4] must not underflow (guard in _executeLiquidation needed)
- After step 4: operatorEthVUnits[op4] unchanged (reactivation skips dead op)
- After step 5: operatorEthVUnits[op4] == 5000 if guard absent (stale write), 0 if guard present
- After step 6: operatorEthVUnits[op4] unchanged (removeValidator skips dead op in updateClusterOperators)
- daoTotalEthVUnits == ethDaoValidatorCount * BPS + sum(all active cluster deviations) at every step

---

### Block 2: RMC-009 — Cascading Removal Asymmetric State

**Setup:**
- Register 4 operators, register cluster C1, deposit 10 ETH, 1 validator

**Steps:**
1. `removeOperator(op3)`: operatorEthVUnits[op3] deleted, ethSnapshot.block = 0.
2. `updateClusterBalance(C1, EB=48)`: storedVUnits=10000 → newVUnits=15000. _updateOperatorVUnits: delta=+5000 to ops 1,2,3,4. Op3 is dead → stale write: operatorEthVUnits[3] = 5000 (re-created from deleted slot). Op4 is alive → legitimate: operatorEthVUnits[4] = 5000.
3. `removeOperator(op4)`: operatorEthVUnits[op4] deleted (was 5000, now 0). ethSnapshot.block = 0.
4. `liquidate(C1)`: updateClusterOperators skips ops 3,4 (both dead). _executeLiquidation deviation cleanup: subtracts 5000 from all 4. Op3 has 5000 stale → goes to 0. Op4 has 0 → underflow. **Asymmetry: op3 (removed before EB) has stale data that gets cleaned, op4 (removed after EB) has deleted data that underflows.**
5. `reactivate(C1)`: updateClusterOperatorsOnReactivation: only ops 1,2 live. clusterDeviation added to ops 1,2.
6. `updateClusterBalance(C1, EB=64)`: _updateOperatorVUnits delta to all 4 — ops 3,4 dead. Both get stale writes again.

**Assertions:**
- After step 2: operatorEthVUnits = [5000, 5000, 5000(stale), 5000(legit)]
- After step 3: operatorEthVUnits = [5000, 5000, 5000(stale), 0(deleted)]
- After step 4: op3 cleaned to 0, op4 must not underflow. Verify guard needed for op4
- After step 6: both dead ops re-contaminated. Total stale drift = 2 * delta

---

### Block 3: RMC-016 — All 4 Operators Removed Sequentially

**Setup:**
- Register 4 operators, cluster C1, 1 validator, deposit 50 ETH

**Steps:**
1. `updateClusterBalance(C1, EB=48)`: deviation +5000 to all 4 ops.
2. `removeOperator(op4)`: deletes operatorEthVUnits[4]. ethSnapshot.block=0.
3. `updateClusterBalance(C1, EB=64)`: delta +5000 to all 4. Op4 stale: 0→5000.
4. `removeOperator(op3)`: deletes operatorEthVUnits[3] (was 10000 from 2 EBs). ethSnapshot.block=0.
5. `updateClusterBalance(C1, EB=96)`: delta +10000 to all 4. Ops 3,4 dead.
6. `removeOperator(op2)`: deletes operatorEthVUnits[2] (was 20000 from 3 EBs). ethSnapshot.block=0.
7. `updateClusterBalance(C1, EB=128)`: delta +10000 to all 4. Ops 2,3,4 dead.
8. `removeOperator(op1)`: deletes operatorEthVUnits[1] (was 30000 from 4 EBs). ethSnapshot.block=0. Last operator removed.

**Assertions:**
- After each removeOperator: that operator's operatorEthVUnits == 0 (deleted)
- After each EB update: dead operators' operatorEthVUnits re-populated with stale delta
- After all 4 removed: all operatorEthVUnits deleted by real removeOperator, no persistent stale data
- Key insight: real removeOperator always cleans up. The bug is BETWEEN removal and cleanup — stale writes happen, but removal deletes them. The problem is when _executeLiquidation or _updateOperatorVUnits reads/writes stale data before the next removeOperator call

---

### Block 4: RMC-022 — Cross-Cluster Shared Removed Operator Drift

**Setup:**
- Register ops 1-6
- Cluster A: ops [1,2,3,4], 1 validator, deposit 10 ETH
- Cluster B: ops [3,4,5,6], 1 validator, deposit 10 ETH

**Steps:**
1. `updateClusterBalance(A, EB=48)`: deviation +5000 to ops 1,2,3,4. operatorEthVUnits[3]=5000, [4]=5000 (from cluster A).
2. `updateClusterBalance(B, EB=48)`: deviation +5000 to ops 3,4,5,6. operatorEthVUnits[3]=10000 (A+B), [4]=10000 (A+B).
3. `removeOperator(op4)`: deletes operatorEthVUnits[4] (was 10000 from both clusters).
4. `updateClusterBalance(A, EB=64)`: storedVUnits=15000→newVUnits=20000, delta=+5000 to ops 1,2,3,4. Op4 dead: stale write 0→5000.
5. `updateClusterBalance(B, EB=64)`: same delta +5000 to ops 3,4,5,6. Op4 dead: stale write 5000→10000.

**Assertions:**
- After step 2: operatorEthVUnits[4] = 10000 (correct: sum of both clusters' deviations)
- After step 3: operatorEthVUnits[4] = 0 (deleted by removeOperator)
- After step 4: operatorEthVUnits[4] = 5000 (stale from cluster A's update only)
- After step 5: operatorEthVUnits[4] = 10000 (stale from both clusters' updates, but represents post-removal drift, not the correct pre-removal sum)
- Op3 (live): operatorEthVUnits[3] = 10000 + 5000 + 5000 = 20000 (correct accumulation from both clusters' 2 EB updates each)
- **Key insight**: dead operator accumulates drift proportional to number of clusters touching it

---

### Block 5: RMC-029 — 10 EB Updates Drift Quantification

**Setup:**
- Register 4 operators, cluster C1, 1 validator, deposit 100 ETH
- EB sequence: 32→48→64→96→128→96→64→48→32→48→64 (10 updates)

**Steps:**
1. `updateClusterBalance(EB=48)`: deviation +5000 to all 4. Remove op4.
2-11. Ten EB updates with deltas: +5000, +10000, +10000, -10000, -10000, -5000, -5000, +5000, +5000. Each writes to dead op4.

**vUnits progression and per-update delta on dead op4:**
| Step | EB | vUnits | Delta | Dead op4 accumulation |
|------|----|--------|-------|-----------------------|
| 2 | 48→64 | 15000→20000 | +5000 | 5000 |
| 3 | 64→96 | 20000→30000 | +10000 | 15000 |
| 4 | 96→128 | 30000→40000 | +10000 | 25000 |
| 5 | 128→96 | 40000→30000 | -10000 | 15000 |
| 6 | 96→64 | 30000→20000 | -10000 | 5000 |
| 7 | 64→48 | 20000→15000 | -5000 | 0 |
| 8 | 48→32 | 15000→10000 | -5000 | underflow(-5000) |
| 9 | 32→48 | 10000→15000 | +5000 | 0 or wrapped |
| 10 | 48→64 | 15000→20000 | +5000 | 5000 or wrapped+5000 |

**Assertions:**
- Step 8 is critical: delta = -5000 applied to op4 which has 0 → uint64 underflow
- If no underflow protection: op4 wraps to max uint64 - 5000. Subsequent additions compound the corruption
- Net delta across 10 updates: +5000+10000+10000-10000-10000-5000-5000+5000+5000 = +5000 (same as initial deviation before removal). But dead op4 doesn't start from the initial value — it starts from 0
- Guard needed at _updateOperatorVUnits to skip dead operators and prevent ANY drift

---

### Block 6: RMC-034 — 3 Clusters Same Operators Drift Measurement

**Setup:**
- Register ops 1-4
- Clusters A, B, C: all use ops [1,2,3,4], 1 validator each, 10 ETH deposit each

**Steps:**
1. `updateClusterBalance(A, EB=48)`: deviation +5000 to ops 1,2,3,4 from cluster A.
2. `updateClusterBalance(B, EB=64)`: deviation +10000 to ops 1,2,3,4 from cluster B. Cumulative for each: 15000.
3. `removeOperator(op4)`: deletes operatorEthVUnits[4] (was 15000). Zeros ethSnapshot.block.
4. `updateClusterBalance(C, EB=96)`: storedVUnits=10000→newVUnits=30000, delta=+20000 to all 4. Dead op4: 0→20000 (stale from cluster C).
5. Check operatorEthVUnits[op4]: should be 0 (guard present) or 20000 (no guard, only cluster C's delta since removal).

**Assertions:**
- Live operators (1,2,3): operatorEthVUnits = 5000 (A) + 10000 (B) + 20000 (C) = 35000 each. Correct.
- Dead op4: 20000 if no guard (one cluster's delta), 0 if guard present
- daoTotalEthVUnits: should include only 3 clusters' deviations for live operators. If dead op4 contributes to earnings calculation via updateSnapshotSt, the stale 20000 inflates the operator's balance computation. But since ethSnapshot.block == 0, updateSnapshotSt is never called for dead ops — so stale operatorEthVUnits[op4] is "dormant pollution" that only manifests if a new operator is registered with the same ID (impossible with incrementing IDs)

---

### Block 7: RMC-038 — Validator Removal Deviation Cleanup On Dead Operator

**Setup:**
- Register ops 1-6
- Cluster A: ops [1,2,3,4], 2 validators, explicit EB=48 (vUnits=30000, baseline=20000, deviation=10000)
- Cluster B: ops [1,2,3,4], 1 validator, explicit EB=48 (vUnits=15000, baseline=10000, deviation=5000)

**Steps:**
1. `removeOperator(op4)`: deletes operatorEthVUnits[4] (was 15000 from A+B combined).
2. `removeValidator(A, pk1)`: cluster A validatorCount 2→1. updateClusterOperators: op4 skipped (line 247). ebSnapshot.vUnits for A: 30000 - 10000 = 20000.
3. `removeValidator(A, pk2)`: cluster A validatorCount 1→0. updateClusterOperators: op4 skipped. Deviation cleanup at lines 216-217: remainingVUnits = ebSnapshot.vUnits (20000 - 10000 = 10000 pure deviation). `seb.operatorEthVUnits[operatorIds[i]] -= remainingVUnits` for ALL operatorIds including dead op4. Dead op4: 0 - 10000 = underflow. **Bug manifestation in _bulkRemoveValidator deviation cleanup, NOT just in _updateOperatorVUnits.**
4. `removeValidator(B, pk1)`: cluster B validatorCount 1→0. Same deviation cleanup: remainingVUnits = 5000, subtracted from dead op4 again.

**Assertions:**
- Step 3 is the critical path: _bulkRemoveValidator at SSVValidators.sol:216-217 subtracts from dead op4. No guard exists in this code path
- Step 4 compounds: second subtraction from already-underflowed dead slot
- This is a SEPARATE bug vector from _updateOperatorVUnits — the validator removal path also lacks the guard

---

### Block 8: RMC-040 — Implicit-to-Explicit Transition With Dead Operator

**Setup:**
- Register ops 1-4
- Cluster A: ops [1,2,3,4], 1 validator, implicit EB (no EB update), deposit 10 ETH
- Cluster B: ops [1,2,3,4], 1 validator, explicit EB=48 (after EB update), deposit 10 ETH

**Steps:**
1. `updateClusterBalance(B, EB=48)`: cluster B explicit. deviation +5000 to ops 1,2,3,4.
2. `removeOperator(op4)`: deletes operatorEthVUnits[4] (was 5000 from B). ethSnapshot.block=0.
3. `updateClusterBalance(A, EB=48)`: FIRST EB update for cluster A. storedVUnits = 0. Code at line 389-391: `if (storedVUnits == 0) { storedVUnits = uint64(cluster.validatorCount) * BPS_DENOMINATOR; }` → storedVUnits=10000. newVUnits=15000. delta=+5000. _updateOperatorVUnits writes to all 4 including dead op4. Dead op4: 0→5000.
4. `updateClusterBalance(B, EB=64)`: storedVUnits=15000→newVUnits=20000, delta=+5000 to all 4. Dead op4: 5000→10000.

**Assertions:**
- After step 2: operatorEthVUnits[4] = 0 (deleted)
- After step 3: operatorEthVUnits[4] = 5000 (stale write from implicit→explicit transition)
- After step 4: operatorEthVUnits[4] = 10000 (accumulated stale from both clusters)
- The implicit→explicit transition does NOT have special handling for dead operators — same _updateOperatorVUnits path, same vulnerability
- Live ops: operatorEthVUnits[1,2,3] = 5000(B step1) + 5000(A step3) + 5000(B step4) = 15000. Correct.

---

### Block 9: RMC-043 — 13-Op Stress Test

**Setup:**
- Register 13 operators (op1-op13) with ethFee = 1000 wei each
- Cluster C1: all 13 ops, 1 validator, deposit 100 ETH

**Steps:**
1. `updateClusterBalance(C1, EB=48)`: deviation +5000 to all 13 operators.
2. `removeOperator(ops 2-13)`: 12 batch removals. Each deletes operatorEthVUnits[id]. ethSnapshot.block=0 for each. Only op1 remains live.
3. `updateClusterBalance(C1, EB=64)`: delta +5000 to all 13 operatorIds. Op1: 5000+5000=10000 (correct). Ops 2-13: each gets 0→5000 (stale). Total stale writes: 12 * 5000 = 60000.
4. `deposit(C1, 50 ETH)`: no operator iteration. Balance += 50 ETH.
5. `withdraw(C1, 10 ETH)`: iterates 13 ops for index/burnRate. Ops 2-13 skipped (ethSnapshot.block==0) at line 224: `(uint64(block.number) - operator.ethSnapshot.block)` would be `block.number - 0` if no guard. **Verify: withdraw's manual loop (lines 219-227) has the guard.** Wait — there is NO explicit guard in withdraw's loop. `operator.ethSnapshot.block` is 0 for dead ops, so `block.number - 0 = block.number`. Fee computed as `block.number * ethFee`, but ethFee is also 0 (reset by removeOperator). So `burnRate += 0` and `clusterIndex += operator.ethSnapshot.index` (preserved index). Implicitly safe because ethFee=0 for dead ops.
6. Advance blocks. `liquidate(C1)`: updateClusterOperators skips 12 dead ops. _executeLiquidation subtracts deviation from 12 dead slots.
7. `reactivate(C1, 200 ETH)`: only op1 gets ethValidatorCount, clusterDeviation added to op1 only.

**Assertions:**
- Gas measurement: 13-operator iterations in EB update, liquidation, withdraw, reactivation
- After step 3: 60000 total stale vUnits across 12 dead operators
- After step 5: withdraw solvency uses only op1's burn rate (correct behavior despite no explicit guard, because dead ops' ethFee == 0)
- After step 7: op1.ethValidatorCount=1, op1.operatorEthVUnits = deviation for cluster. All other ops at 0 or stale from step 3/6 interactions

---

### Block 10: RMC-035 — Double Liquidation Underflow On Dead Operator

**Setup:**
- Register ops 1-4
- Cluster A: ops [1,2,3,4], 1 validator, explicit EB=48 (deviation=5000), deposit 5 ETH
- Cluster B: ops [1,2,3,4], 1 validator, explicit EB=48 (deviation=5000), deposit 5 ETH

**Steps:**
1. Before removal: operatorEthVUnits[4] = 10000 (5000 from A + 5000 from B).
2. `removeOperator(op4)`: deletes operatorEthVUnits[4]. Now 0.
3. `liquidate(A)`: updateClusterOperators skips dead op4. _executeLiquidation deviation cleanup: vUnitsCluster for A = 15000, baseline = 10000, deviation = 5000. `seb.operatorEthVUnits[4] -= 5000`. Dead op4: 0 - 5000 = **uint64 underflow**. Wraps to 2^64 - 5001.
4. `liquidate(B)`: same deviation cleanup for cluster B. `seb.operatorEthVUnits[4] -= 5000`. Dead op4: (2^64 - 5001) - 5000 = 2^64 - 10001. Double corruption.

**Assertions:**
- Step 3: underflow on uint64 subtraction. In Solidity 0.8.24, this is a checked subtraction → **REVERT**. The transaction reverts with arithmetic underflow.
- This means: if guard is absent, liquidation of cluster A with dead operator op4 REVERTS. Cluster becomes un-liquidatable. **Critical bug: cluster stuck in active state, cannot be liquidated.**
- Fix validation: with guard `if (s.operators[operatorIds[i]].ethSnapshot.block == 0) continue;` in _executeLiquidation lines 586-592, dead op4 is skipped, liquidation succeeds.
- Step 4 with guard: same skip, liquidation of B also succeeds.

---

### Block 11: RMC-044 — 6 EB Updates on 13-Op Cluster With 12 Dead

**Setup:**
- Register 13 operators, cluster C1 with all 13, 1 validator, deposit 200 ETH
- EB sequence after removal: 48→64→96→128→96→64

**Steps:**
1. `updateClusterBalance(EB=48)`: deviation +5000 to all 13.
2. `removeOperator(ops 2-13)`: all 12 deleted.
3-8. Six EB updates with deltas applied to all 13 operatorIds:

| Update | EB | vUnits | Delta | Dead ops (each) | Live op1 |
|--------|----|--------|-------|------------------|----------|
| 3 | 48→64 | 15000→20000 | +5000 | 5000 | 10000 |
| 4 | 64→96 | 20000→30000 | +10000 | 15000 | 20000 |
| 5 | 96→128 | 30000→40000 | +10000 | 25000 | 30000 |
| 6 | 128→96 | 40000→30000 | -10000 | 15000 | 20000 |
| 7 | 96→64 | 30000→20000 | -10000 | 5000 | 10000 |
| 8 | 64→48 | 20000→15000 | -5000 | 0 | 5000 |

**Assertions:**
- After 6 updates: each dead op has net delta = +5000+10000+10000-10000-10000-5000 = 0. Symmetric oscillation nets to zero.
- Op1 (live): operatorEthVUnits = 5000 (initial) + 0 (net delta) = 5000. Correct.
- Dead ops: if started from 0 (deleted by removeOperator), net 0 → back to 0. No permanent drift for symmetric oscillations.
- **But**: if any intermediate step goes negative (step 7 or 8 above), uint64 underflow reverts the transaction. Step 8: dead op at 5000 - 5000 = 0 (safe). All intermediate values stay >= 0 for this specific sequence. Changing the sequence could trigger underflow.
- Liquidation after step 8: deviation = 15000 - 10000 = 5000. Cleanup subtracts 5000 from dead ops at 0 → underflow → revert. **Even with net-zero drift, liquidation cleanup triggers underflow.**

---

### Block 12: RMC-045 — Validator Registration Blocked By Dead Operator

**Setup:**
- Register 13 operators, cluster C1 with all 13, 1 validator, deposit 100 ETH

**Steps:**
1. `updateClusterBalance(EB=48)`: deviation +5000 to all 13.
2. `removeOperator(ops 2-13)`: 12 operators removed.
3. `registerValidator(C1, newPubkey)`: _bulkRegisterValidator calls updateClusterOperatorsOnRegistration. For each operatorId, calls `ensureOperatorExist(operatorSt)`. For dead ops (2-13): `operator.owner == address(0)` — wait, _resetOperatorState does NOT zero the owner. Check: `operator.ethSnapshot.block == 0 && operator.snapshot.block == 0` → true for dead ops. ensureOperatorExist: `if (operator.owner == address(0) || (operator.ethSnapshot.block == 0 && operator.snapshot.block == 0))` → second condition true. **REVERTS: OperatorDoesNotExist.**

**Assertions:**
- Registration of new validator to cluster with ANY dead operator FAILS with OperatorDoesNotExist
- This is by design: a cluster with removed operators cannot grow
- The cluster can still: remove validators, get EB updates, be liquidated, be reactivated, deposit, withdraw
- The only way to "fix" the cluster: remove all validators, let it go empty, register a new cluster with live operators
- This is a natural consequence of the operator lifecycle, not a bug

---

## Coverage Matrix

| Guard Location | Code Reference | Scenarios Exercising It |
|----------------|----------------|-------------------------|
| `updateClusterOperators` (ethSnapshot.block==0 skip) | OperatorLib.sol:247 | RMC-001,002,003,004,006,007,008,009,010,011,014,016,017,029,030,031,038,043 |
| `_liquidateAfterEBUpdateIfNeeded` (ethSnapshot.block==0 skip) | SSVClusters.sol:541 | RMC-003,008,013 |
| `updateClusterOperatorsOnReactivation` (ethSnapshot.block==0 skip) | OperatorLib.sol:291 | RMC-001,002,004,005,007,008,009,011,012,015,018,033,036,043 |
| `_updateOperatorVUnits` (**NO guard — bug vector**) | SSVClusters.sol:504-509 | RMC-001,002,003,005,006,007,008,009,010,012,013,014,015,019,020,021,022,023,025,027,028,029,030,031,032,033,034,036,039,040,043,044 |
| `_executeLiquidation` deviation cleanup (**NO guard — bug vector**) | SSVClusters.sol:586-592 | RMC-001,002,003,004,008,009,010,011,013,014,017,023,027,029,033,034,035,037,041,043,044 |
| `_bulkRemoveValidator` deviation cleanup (**NO guard — bug vector**) | SSVValidators.sol:216-217 | RMC-038 |
| `ensureOperatorExist` (registration block) | OperatorLib.sol:139-144 | RMC-024,045 |
| `removeOperator` deletes operatorEthVUnits | SSVOperators.sol:93 | ALL (RMC-001 through RMC-045) |
| `withdraw` loop (implicit safety via ethFee==0) | SSVClusters.sol:219-227 | RMC-006,030,043 |
| `updateClusterOperatorsMigration` (double-zero skip) | OperatorLib.sol:363-364 | RMC-026 |

## Summary

**45 scenarios** (RMC-001 to RMC-045) organized in 8 sections covering:

1. **Full-chain sequences** (8 scenarios): End-to-end flows combining EB update, operator removal, liquidation, reactivation, and validator removal. These verify the guard pattern holds across the most complex real-world operation sequences.

2. **Cascading operator removal** (7 scenarios): Multiple operators removed at different points in the EB update sequence. Tests asymmetric stale state (some ops removed before EB, some after) and progressive degradation as operators are removed one at a time.

3. **All-operator sequential removal** (5 scenarios): Edge case where all 4 operators in a cluster are removed one by one with EB updates between each. Verifies behavior when the cluster has zero live operators.

4. **Cross-cluster isolation** (8 scenarios): Clusters sharing operators where one operator is removed. Verifies that removal from one cluster's perspective does not corrupt another cluster's accounting, and that shared dead operators accumulate drift from multiple clusters independently.

5. **Long chain drift detection** (5 scenarios): 10+ operations with a removed operator to quantify cumulative drift. Includes EB oscillation patterns that can trigger uint64 underflow on intermediate steps.

6. **Multi-cluster same removed operator** (5 scenarios): Multiple clusters using identical operator sets, measuring how a single removed operator accumulates stale writes from all clusters' EB updates.

7. **Mixed implicit/explicit EB** (4 scenarios): Clusters with different EB modes sharing a removed operator. Verifies implicit clusters are immune to stale deviation and that implicit-to-explicit transitions interact correctly with dead operators.

8. **Stress test with 13 operators** (3 scenarios): Maximum operator count with 12 removed, testing gas costs, iteration behavior, and validator registration blocking.

**Three unguarded code paths identified:**
- `_updateOperatorVUnits` (SSVClusters.sol:504-509): writes deviation delta to ALL operatorIds without checking `ethSnapshot.block`
- `_executeLiquidation` deviation cleanup (SSVClusters.sol:586-592): subtracts deviation from ALL operatorIds without checking `ethSnapshot.block` — causes uint64 underflow → transaction revert in Solidity 0.8.24 checked arithmetic, making clusters with dead operators **un-liquidatable**
- `_bulkRemoveValidator` deviation cleanup (SSVValidators.sol:216-217): subtracts remaining deviation from ALL operatorIds when cluster empties — same underflow risk
