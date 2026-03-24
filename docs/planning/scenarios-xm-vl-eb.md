# Cross-Module Scenarios: Validator Operations x EB Updates (XV-001 to XV-060)

Wave 2 cross-module interaction scenarios covering the interplay between validator lifecycle operations (`registerValidator`, `bulkRegisterValidator`, `removeValidator`, `bulkRemoveValidator`, `exitValidator`) and Effective Balance updates (`updateClusterBalance`).

**Worker:** W2-A
**Prefix:** XV
**Wave:** 2 (Cross-Module)

**Source files:**
- `contracts/modules/SSVValidators.sol` — `_bulkRegisterValidator` (lines 105-151), `_bulkRemoveValidator` (lines 153-257)
- `contracts/modules/SSVClusters.sol` — `updateClusterBalance` (lines 348-417), `_updateOperatorVUnits` (lines 494-510), `_applyClusterFeeUpdates` (lines 461-492), `_liquidateAfterEBUpdateIfNeeded` (lines 519-550), `_executeLiquidation` (lines 552-612)
- `contracts/libraries/ClusterLib.sol` — `updateClusterOnRegistration` (lines 234-277), `updateBalanceWithEB` (lines 306-321), `getVUnits` (lines 285-297), `ebToVUnits` (lines 366-371), `isLiquidatableWithVUnits` (lines 96-112)
- `contracts/libraries/OperatorLib.sol` — `updateClusterOperatorsOnRegistration` (lines 155-221), `updateClusterOperators` (lines 233-262), `updateSnapshotSt` (lines 52-72)

**W1 Cross-References:**
- `scenarios-vl-register.md` — VR-001 to VR-073
- `scenarios-vl-remove-exit.md` — VX-001 to VX-069
- `scenarios-eb-updates.md` — EB-031 to EB-119

**KEY BUG CONTEXT:** `_updateOperatorVUnits` at SSVClusters.sol:504-509 writes to `operatorEthVUnits[removedOpId]` without checking `ethSnapshot.block != 0`. The guard pattern `if (s.operators[operatorId].ethSnapshot.block == 0) continue;` is used in `updateClusterOperators` (OperatorLib.sol:247) but is MISSING from `_updateOperatorVUnits` and the deviation cleanup loop in `_bulkRemoveValidator` (SSVValidators.sol:216-217).

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| XV-001 | register 1 val -> updateClusterBalance -> remove 1 val | Full lifecycle: register validator, oracle EB update (32 ETH, no deviation), remove validator; verify vUnits return to 0, ebSnapshot.vUnits zeroed | `lifecycle:full; eb:explicit-baseline; ops:4; revert:no` | [ ] | SSVValidators.sol:105-151, SSVClusters.sol:348-417, SSVValidators.sol:153-257 |
| XV-002 | register 1 val -> updateClusterBalance (48 ETH) -> remove 1 val | Full lifecycle with deviation: register, EB increase creates deviation, remove last val triggers deviation cleanup loop at SSVValidators.sol:216-218 | `lifecycle:full; eb:explicit-deviation; ops:4; revert:no` | [ ] | SSVValidators.sol:138-141, 204-224, SSVClusters.sol:494-510 |
| XV-003 | register 3 vals -> updateClusterBalance (48 ETH/val) -> remove 1 val | Partial remove with explicit EB: verify ebSnapshot.vUnits -= 1 * BPS_DENOMINATOR, deviation preserved (not cleaned since validatorCount > 0) | `lifecycle:partial-remove; eb:explicit-deviation; ops:4; revert:no` | [ ] | SSVValidators.sol:204-207, ClusterLib.sol:285-297 |
| XV-004 | register 3 vals -> updateClusterBalance (48 ETH/val) -> remove 2 vals | Partial remove leaving 1 validator: verify ebSnapshot.vUnits correctly holds baseline + deviation for remaining validator | `lifecycle:partial-remove; eb:explicit-deviation; ops:4; revert:no` | [ ] | SSVValidators.sol:204-207 |
| XV-005 | register 3 vals -> updateClusterBalance (48 ETH/val) -> remove all 3 vals | Full remove with deviation cleanup: verify deviation subtracted from all 4 operators and DAO, ebSnapshot.vUnits zeroed | `lifecycle:full-remove; eb:explicit-deviation; ops:4; revert:no` | [ ] | SSVValidators.sol:210-224 |
| XV-006 | register 5 vals -> updateClusterBalance -> bulk remove 3 -> verify vUnits | Bulk partial remove: verify ebSnapshot.vUnits -= 3 * BPS_DENOMINATOR, deviation intact, remaining 2 validators still EB-weighted | `lifecycle:bulk-partial-remove; eb:explicit-deviation; ops:4; revert:no` | [ ] | SSVValidators.sol:204-207 |
| XV-007 | register 5 vals -> updateClusterBalance -> bulk remove all 5 | Bulk full remove: identical to XV-005 but with 5 validators; verify deviation cleanup scales correctly | `lifecycle:bulk-full-remove; eb:explicit-deviation; ops:7; revert:no` | [ ] | SSVValidators.sol:210-224 |
| XV-008 | register 1 val -> updateClusterBalance -> register 1 more val | Register into explicit EB cluster: verify ebSnapshot.vUnits += BPS_DENOMINATOR at SSVValidators.sol:140; operatorEthVUnits unchanged | `lifecycle:register-after-eb; eb:explicit-deviation; ops:4; revert:no` | [ ] | SSVValidators.sol:138-141, ClusterLib.sol:256-260 |
| XV-009 | register 1 val -> updateClusterBalance (48 ETH) -> register 2 more -> updateClusterBalance (48 ETH/val = 144 ETH) | Double EB update across validator count change: first update with 1 val, second with 3 vals; verify deviation delta computed correctly on second update | `lifecycle:multi-update; eb:explicit-deviation; ops:4; revert:no` | [ ] | SSVClusters.sol:388-404, SSVValidators.sol:138-141 |
| XV-010 | register 2 vals -> updateClusterBalance -> register 3 more -> updateClusterBalance again | Interleaved register and EB: verify storedVUnits on second update reflects both the first update's vUnits AND the +3*BPS_DENOMINATOR from registration | `lifecycle:interleaved; eb:explicit; ops:4; revert:no` | [ ] | SSVValidators.sol:138-141, SSVClusters.sol:389-392 |
| XV-011 | bulk register 10 vals -> updateClusterBalance -> bulk remove 10 vals -> verify clean slate | Complete cycle at scale: verify all operator deviations, DAO vUnits, and ebSnapshot are fully cleaned after removing all validators | `lifecycle:full-cycle-scale; eb:explicit-deviation; ops:4; revert:no` | [ ] | SSVValidators.sol:210-224 |
| XV-012 | register 1 val (implicit EB) -> remove 1 val (implicit EB) | Implicit EB lifecycle: no ebSnapshot ever set (vUnits == 0); verify removal does NOT enter EB cleanup path at SSVValidators.sol:204 | `lifecycle:implicit-only; eb:implicit; ops:4; revert:no` | [ ] | SSVValidators.sol:204 |
| XV-013 | register 1 val -> updateClusterBalance (32 ETH, baseline) -> remove 1 val | Explicit EB at baseline (no deviation): ebSnapshot.vUnits = BPS_DENOMINATOR, deviation = 0; verify cleanup loop at line 212 is skipped (remainingVUnits == 0) | `lifecycle:explicit-baseline; eb:explicit-no-deviation; ops:4; revert:no` | [ ] | SSVValidators.sol:210-222 |
| XV-014 | exit 1 val -> updateClusterBalance -> remove 1 val | Exit then EB update then remove: exit is event-only (no state change per SSVValidators.sol:81-86); verify EB update still uses full validatorCount for vUnits calculation | `lifecycle:exit-eb-remove; eb:explicit; ops:4; revert:no` | [ ] | SSVValidators.sol:81-86, SSVClusters.sol:385-404 |
| XV-015 | register 3 vals -> exit 1 val -> updateClusterBalance -> remove 1 val (non-exited) | Mixed exit+remove: exit has no state effect; EB update sees 3 validators; remove reduces to 2; verify ebSnapshot.vUnits adjusted by BPS_DENOMINATOR only | `lifecycle:exit-mixed; eb:explicit; ops:4; revert:no` | [ ] | SSVValidators.sol:81-86, 204-207 |
| XV-016 | register 1 val -> updateClusterBalance (48 ETH) -> remove all -> register 1 new val | Re-registration after full cleanup: ebSnapshot.vUnits was zeroed at line 222; new registration hits `ebSnapshot.vUnits > 0` check at line 138 — false, so NO vUnits added; cluster returns to implicit EB | `lifecycle:re-register; eb:implicit-after-cleanup; ops:4; revert:no` | [ ] | SSVValidators.sol:138, 222 |
| XV-017 | register 1 val -> updateClusterBalance (48 ETH) -> remove all -> register 1 new val -> updateClusterBalance (48 ETH) | Full round-trip: after re-registration (implicit EB), new updateClusterBalance transitions back to explicit; verify storedVUnits=0 fallback at SSVClusters.sol:391 produces correct baseline for new validatorCount | `lifecycle:round-trip; eb:implicit-to-explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:388-392, SSVValidators.sol:138 |
| XV-018 | register 1 val -> updateClusterBalance (48 ETH) -> register 1 more -> remove 1 val | Add-after-EB then partial remove: verify ebSnapshot.vUnits goes from 15000 to 25000 (registration adds BPS) then to 15000 (removal subtracts BPS); deviation (5000) preserved throughout | `lifecycle:add-remove-deviation; eb:explicit; ops:4; revert:no` | [ ] | SSVValidators.sol:138-141, 204-207 |
| XV-019 | register 5 vals -> updateClusterBalance -> remove 2 -> updateClusterBalance again -> remove 3 | Sequential EB updates with removals between: first EB at 5 vals, remove 2 (ebSnapshot reduced by 2*BPS), second EB at 3 vals (storedVUnits reflects reduced count), remove last 3 (deviation cleanup) | `lifecycle:sequential-eb-remove; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:389, SSVValidators.sol:204-224 |
| XV-020 | register 1 val -> updateClusterBalance (64 ETH) -> register 9 more vals | Massive expansion after high EB: cluster has vUnits=20000 (1 val, 64 ETH); registration adds 9*BPS=90000; new ebSnapshot.vUnits=110000; verify projected vUnits in isLiquidatableWithVUnits uses 110000 | `lifecycle:expand-after-eb; eb:explicit; ops:4; revert:no` | [ ] | ClusterLib.sol:256-274, SSVValidators.sol:138-141 |
| XV-021 | register 1 val -> updateClusterBalance -> remove 1 val -> updateClusterBalance (revert StaleUpdate) | EB update after all validators removed: cluster has validatorCount=0, ebSnapshot.vUnits=0 (zeroed at line 222); second updateClusterBalance should revert EBBelowMinimum at SSVClusters.sol:456 (effectiveBalance < 0 * 32 is always false for EB>0... but 0 vals * 32 = 0, so effectiveBalance >= 0 always true) — verify actual behavior | `lifecycle:eb-after-empty; eb:edge; ops:4; revert:depends` | [ ] | SSVClusters.sol:453-459, SSVValidators.sol:222 |
| XV-022 | register 1 val with removed operator in cluster -> updateClusterBalance | Registration revert: registering with a removed operator (ethSnapshot.block==0) should revert OperatorDoesNotExist at OperatorLib.sol:139-143; verify EB update path is never reached | `lifecycle:register-reverts; eb:none; ops:4; revert:yes` | [ ] | OperatorLib.sol:139-143 |
| XV-023 | register 1 val -> removeOperator(op3) -> updateClusterBalance (48 ETH) -> remove 1 val | THE BUG PATH: register, remove operator, EB update writes deviation to removed op (line 507), then remove last val cleanup subtracts deviation from removed op (line 217); verify both writes hit operatorEthVUnits[removedOp] | `lifecycle:removed-op-bug; eb:explicit; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:504-509, SSVValidators.sol:216-217 |
| XV-024 | register 1 val -> removeOperator(op3) -> updateClusterBalance (48 ETH) -> updateClusterBalance (32 ETH) | Removed-op deviation return-to-baseline: first EB update adds 5000 to removed op, second subtracts 5000 (SSVClusters.sol:508); verify operatorEthVUnits[removedOp] returns to 0 | `lifecycle:removed-op-roundtrip; eb:explicit; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:507-508 |
| XV-025 | register 3 vals -> removeOperator(op2) -> updateClusterBalance (48 ETH/val) -> bulk remove all 3 vals | Removed-op full cleanup: EB update creates deviation on all ops including removed; bulk remove last val enters cleanup loop at line 216 which subtracts from removed op without guard; verify no underflow | `lifecycle:removed-op-cleanup; eb:explicit; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:215-218, SSVClusters.sol:504-509 |
| XV-026 | register 1 val -> updateClusterBalance (48 ETH) -> removeOperator(op3) -> remove 1 val | EB update BEFORE operator removal: deviation written to op3 (SSVClusters.sol:507), then op3 removed (operatorEthVUnits[op3] deleted by removeOperator at SSVOperators.sol), then remove last val subtracts remainingVUnits from operatorEthVUnits[op3] which is now 0 — UNDERFLOW | `lifecycle:eb-before-opremove; eb:explicit; ops:4; remove_mode:real; revert:depends` | [ ] | SSVClusters.sol:507, SSVValidators.sol:217 |
| XV-027 | register 2 vals -> updateClusterBalance (64 ETH/val, shared ops with another cluster) -> remove 1 val from cluster A | Shared operators: two clusters share ops 3,4; update cluster A EB to 64 ETH/val (+10000 deviation per shared op); remove 1 val from A; verify shared op deviation correctly reflects only cluster A's contribution change | `lifecycle:shared-ops; eb:explicit; ops:4-shared; revert:no` | [ ] | SSVClusters.sol:500-509, SSVValidators.sol:204-207 |
| XV-028 | register 1 val -> updateClusterBalance (marginal balance) -> register 1 more val (revert InsufficientBalance) | Registration liquidity check with explicit EB: cluster barely solvent at current vUnits; registering second val uses projectedVUnits = storedVUnits + BPS_DENOMINATOR for isLiquidatableWithVUnits; if projected threshold exceeds balance, revert | `lifecycle:register-liquidity; eb:explicit; ops:4; revert:yes` | [ ] | ClusterLib.sol:256-274 |
| XV-029 | register 1 val -> updateClusterBalance (2048 ETH max EB) -> register 1 more val | Max EB then register: cluster at max EB (vUnits=640000); registration adds BPS_DENOMINATOR=10000; projectedVUnits=650000; verify liquidation threshold computed with 650000 and sufficient deposit required | `lifecycle:max-eb-register; eb:explicit-max; ops:4; revert:no` | [ ] | ClusterLib.sol:258-260, SSVValidators.sol:138-141 |
| XV-030 | register 1 val -> updateClusterBalance (2048 ETH) -> remove 1 val | Max EB then remove: deviation = 640000 - 10000 = 630000; on last-val removal, cleanup loop subtracts 630000 from each operator's operatorEthVUnits | `lifecycle:max-eb-remove; eb:explicit-max; ops:4; revert:no` | [ ] | SSVValidators.sol:210-224 |
| XV-031 | bulk register 50 vals -> updateClusterBalance -> bulk remove 25 -> updateClusterBalance -> bulk remove 25 | Large-scale interleaved: verify gas costs and correctness at scale; ebSnapshot.vUnits tracks correctly across two EB updates and two partial removals | `lifecycle:scale-interleaved; eb:explicit; ops:4; revert:no` | [ ] | SSVValidators.sol:204-224, SSVClusters.sol:388-404 |
| XV-032 | register 1 val -> updateClusterBalance -> liquidate cluster -> remove 1 val | Liquidation then remove: liquidation cleans deviation at SSVClusters.sol:567-596; subsequent removal enters EB path but cluster.active==false so cleanup skipped at line 212; verify no double-decrement | `lifecycle:liquidate-then-remove; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:567-596, SSVValidators.sol:210-222 |
| XV-033 | register 1 val -> updateClusterBalance (triggers auto-liquidation) -> verify post-state | Auto-liquidation during EB update: EB increase makes cluster undercollateralized; _liquidateAfterEBUpdateIfNeeded triggers; verify ethValidatorCount decremented, deviation cleaned, cluster inactive | `lifecycle:auto-liquidation; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:519-550, 552-612 |
| XV-034 | register 1 val -> updateClusterBalance -> liquidate -> reactivate -> updateClusterBalance | Reactivation after liquidation restores deviation: reactivation at SSVClusters.sol:142-176 recomputes clusterDeviation and adds to operators; verify second EB update correctly uses restored storedVUnits | `lifecycle:reactivation; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:142-176, 388-404 |
| XV-035 | register 1 val -> updateClusterBalance -> liquidate -> remove 1 val -> register 1 val -> updateClusterBalance | Liquidated remove then fresh register: after liquidation, remove val (cluster.active=false path), ebSnapshot.vUnits zeroed; register new val (implicit since ebSnapshot=0); new EB update treats as implicit->explicit transition | `lifecycle:post-liquidation-cycle; eb:implicit-after-liquidation; ops:4; revert:no` | [ ] | SSVValidators.sol:204-222, SSVClusters.sol:388-392 |
| XV-036 | register 1 val -> block N: updateClusterBalance -> block N+1: register 1 more -> block N+2: updateClusterBalance | Cross-block interleaving: EB update at block N settles fees for [0,N]; registration at N+1; second EB update at N+2 settles fees for [N,N+2] using storedVUnits that includes +BPS from registration | `lifecycle:cross-block; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:396, SSVValidators.sol:138-141 |
| XV-037 | register 1 val -> updateClusterBalance (48 ETH) -> advance 100 blocks -> remove 1 val | Fee settlement with EB-weighted vUnits: removal calls updateClusterOperators then updateClusterData which uses getVUnits; verify fee deduction uses explicit vUnits=15000 (not implicit 10000) | `lifecycle:fee-settlement; eb:explicit-deviation; ops:4; revert:no` | [ ] | ClusterLib.sol:306-321, 285-297 |
| XV-038 | register 1 val -> updateClusterBalance (48 ETH) -> advance 100 blocks -> register 1 more val | Fee settlement on registration: updateClusterOnRegistration settles fees using storedVUnits before adding new validator; verify fee calculation uses vUnits=15000 (explicit, pre-registration), not 25000 (post-registration) | `lifecycle:fee-on-register; eb:explicit; ops:4; revert:no` | [ ] | ClusterLib.sol:234-277, 306-321 |
| XV-039 | register 3 vals -> updateClusterBalance (48 ETH/val) -> remove 1 val -> remove 1 val -> remove 1 val | Serial single removals: verify ebSnapshot.vUnits correctly decremented by BPS_DENOMINATOR each time; last removal triggers deviation cleanup; intermediate removals do not | `lifecycle:serial-remove; eb:explicit; ops:4; revert:no` | [ ] | SSVValidators.sol:195, 204-224 |
| XV-040 | register 1 val -> updateClusterBalance (33 ETH, non-aligned EB) -> remove 1 val | Non-aligned EB precision: ebToVUnits(33) = 10313; deviation = 313; on last-val remove, remainingVUnits = 313; verify precise subtraction from operators and DAO | `lifecycle:precision; eb:explicit-non-aligned; ops:4; revert:no` | [ ] | ClusterLib.sol:366-371, SSVValidators.sol:210-224 |
| XV-041 | register 1 val -> updateClusterBalance (48 ETH) -> register 1 val -> remove 1 val -> remove 1 val | Add-then-serial-remove: after EB, register adds BPS to vUnits; first remove subtracts BPS (not last val, no cleanup); second remove is last val, remainingVUnits = 5000 (deviation from original EB update) | `lifecycle:add-serial-remove; eb:explicit; ops:4; revert:no` | [ ] | SSVValidators.sol:138-141, 204-224 |
| XV-042 | register 1 val (cluster A) -> register 1 val (cluster B, same ops) -> updateClusterBalance A -> updateClusterBalance B -> remove all A -> remove all B | Two clusters, same operators, independent EB: verify operatorEthVUnits accumulates deviation from both clusters; removing cluster A's deviation does not affect cluster B's | `lifecycle:multi-cluster; eb:explicit; ops:shared; revert:no` | [ ] | SSVClusters.sol:500-509, SSVValidators.sol:210-224 |
| XV-043 | register 1 val -> updateClusterBalance (48 ETH) -> deposit more ETH -> remove 1 val | Deposit between EB and remove: deposit does not affect ebSnapshot or vUnits (SSVClusters.sol:196-198 only updates cluster.balance); verify removal uses correct ebSnapshot.vUnits | `lifecycle:deposit-between; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:186-201, SSVValidators.sol:204-224 |
| XV-044 | register 1 val -> updateClusterBalance (48 ETH) -> withdraw partial -> remove 1 val | Withdraw between EB and remove: withdraw settles fees using EB-weighted vUnits (SSVClusters.sol:229); verify subsequent removal also uses correct vUnits; no double-settlement | `lifecycle:withdraw-between; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:206-253, SSVValidators.sol:204-224 |
| XV-045 | register 1 val -> updateClusterBalance (48 ETH) -> operator fee change -> remove 1 val | Operator fee change between EB and remove: operator snapshot updated during fee change; removal's updateClusterOperators settles at new fee but with preserved vUnits; verify consistency | `lifecycle:fee-change-between; eb:explicit; ops:4; revert:no` | [ ] | OperatorLib.sol:233-262, SSVValidators.sol:204-224 |
| XV-046 | register 10 vals -> updateClusterBalance -> remove 5 -> register 3 -> updateClusterBalance -> remove 8 | Complex interleaving: 10 vals, EB update, partial remove (5), re-register (3), second EB update, final bulk remove (8); verify ebSnapshot tracks through add/remove/update transitions | `lifecycle:complex-interleave; eb:explicit; ops:7; revert:no` | [ ] | SSVValidators.sol:138-141, 204-224, SSVClusters.sol:388-404 |
| XV-047 | register 1 val -> updateClusterBalance (same block as registration) | Same-block EB update: registration and EB update in same block; fee delta = 0 since no blocks elapsed; verify ebSnapshot correctly initialized despite zero fee settlement | `lifecycle:same-block; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:396, 461-492 |
| XV-048 | register 1 val -> updateClusterBalance -> remove 1 val (same block as EB update) | Same-block remove after EB: removal settles fees with zero block delta; verify vUnits used for (zero) fee calculation come from new explicit ebSnapshot, not implicit | `lifecycle:same-block-remove; eb:explicit; ops:4; revert:no` | [ ] | ClusterLib.sol:306-321 |
| XV-049 | register 1 val -> 2 x removeOperator -> updateClusterBalance -> remove 1 val | Multiple removed operators: 2 of 4 operators removed; EB update writes deviation to both removed ops (no guard); removal cleanup subtracts from both; verify accounting | `lifecycle:multi-removed-op; eb:explicit; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:504-509, SSVValidators.sol:216-217 |
| XV-050 | register 1 val -> updateClusterBalance (48 ETH) -> removeOperator(op3) -> register 1 more val -> remove 1 val | Removed op + register after EB: registration at line 138 adds BPS to ebSnapshot (explicit); removal is not last val; verify no cleanup triggered; operatorEthVUnits[removedOp] unchanged during registration/partial-removal | `lifecycle:removed-op-add; eb:explicit; ops:4; remove_mode:real; revert:no` | [ ] | SSVValidators.sol:138-141, 204-207 |
| XV-051 | register 1 val -> updateClusterBalance -> network fee change -> remove 1 val | Network fee change between EB update and removal: fee settlement on remove uses current networkFeeIndex minus cluster.networkFeeIndex, weighted by vUnits; verify the network fee portion is EB-weighted | `lifecycle:networkfee-change; eb:explicit; ops:4; revert:no` | [ ] | ClusterLib.sol:314-318 |
| XV-052 | register 1 val -> updateClusterBalance (48 ETH) -> register 1 more val (barely sufficient deposit) | Liquidation boundary with explicit EB: projectedVUnits = 15000 + 10000 = 25000; deposit must cover threshold at 25000 vUnits; verify isLiquidatableWithVUnits uses projected value, not baseline 20000 | `lifecycle:liquidity-boundary; eb:explicit; ops:4; revert:no` | [ ] | ClusterLib.sol:256-274 |
| XV-053 | register 1 val -> updateClusterBalance (48 ETH) -> register 1 more val (deposit 1 wei below threshold for projected vUnits) | Insufficient deposit with EB deviation: projectedVUnits = 25000 raises threshold; deposit below threshold reverts InsufficientBalance; verify the EB-aware threshold is enforced | `lifecycle:liquidity-revert; eb:explicit; ops:4; revert:yes` | [ ] | ClusterLib.sol:262-273 |
| XV-054 | register 1 val -> updateClusterBalance (48 ETH) -> bulk remove 0 vals (empty array, revert) | Edge case: bulk remove with empty pubkeys from explicit EB cluster; verify revert ValidatorDoesNotExist before any EB logic is reached | `lifecycle:edge-empty; eb:explicit; ops:4; revert:yes` | [ ] | SSVValidators.sol:161-163 |
| XV-055 | bulk register 3 vals -> updateClusterBalance (48 ETH/val) -> bulk remove with 1 invalid pubkey in batch (revert, atomicity) | Atomic revert preserves EB state: batch of [pk1, invalid, pk3]; revert rolls back all state including any ebSnapshot changes; verify ebSnapshot.vUnits unchanged after revert | `lifecycle:atomic-revert-eb; eb:explicit; ops:4; revert:yes` | [ ] | SSVValidators.sol:172, 204-207 |
| XV-056 | register 1 val -> updateClusterBalance -> operator changes fee -> updateClusterBalance -> remove 1 val | Two EB updates straddling operator fee change: first EB at old fee, operator changes fee (snapshot settled), second EB at new fee; remove settles remaining fees at new rate with latest vUnits | `lifecycle:fee-change-multi-eb; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:461-492, OperatorLib.sol:52-72 |
| XV-057 | register 1 val -> updateClusterBalance (48 ETH) -> updateClusterBalance (64 ETH) -> remove 1 val | Sequential EB increases then remove: deviation grows incrementally (5000 then +5000 = 10000 total); on last-val remove, remainingVUnits = 10000; verify full accumulated deviation cleaned from operators | `lifecycle:sequential-eb-remove; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:494-510, SSVValidators.sol:210-224 |
| XV-058 | register 1 val -> updateClusterBalance (64 ETH) -> updateClusterBalance (48 ETH) -> remove 1 val | EB increase then decrease then remove: deviation grows to 10000 then shrinks to 5000; on last-val remove, remainingVUnits = 5000 (current deviation, not peak); verify correct cleanup | `lifecycle:eb-increase-decrease; eb:explicit; ops:4; revert:no` | [ ] | SSVClusters.sol:500-509, SSVValidators.sol:210-224 |
| XV-059 | register 1 val (13 ops) -> updateClusterBalance (48 ETH) -> remove 1 val (13 ops) | Max operator count: 13 operators; deviation cleanup loop iterates all 13; verify each operator's operatorEthVUnits correctly adjusted; gas check | `lifecycle:max-ops; eb:explicit; ops:13; revert:no` | [ ] | SSVValidators.sol:215-218 |
| XV-060 | register 1 val -> updateClusterBalance -> liquidate -> remove val -> register new val -> updateClusterBalance -> register more -> remove all | Full complex lifecycle: covers liquidation deviation cleanup, post-liquidation removal (no double-decrement), re-registration to implicit EB, new EB update, expansion, full removal with fresh deviation cleanup | `lifecycle:exhaustive; eb:mixed; ops:4; revert:no` | [ ] | SSVValidators.sol:105-257, SSVClusters.sol:348-612 |

---

## Detailed Scenario Blocks (12 Most Complex)

---

### XV-002: Full Lifecycle With Deviation — Register, EB Update, Remove

**Entry:** `registerValidator` -> `updateClusterBalance` -> `removeValidator`

**Preconditions:**
1. Register 4 operators (op1-op4) with ethFee = 1000 packed wei/block each.
2. Network fee = 500 packed wei/block.
3. Register 1 validator into new ETH cluster with sufficient deposit (e.g., 10 ETH).

**Step 1 — Register:**
- `_bulkRegisterValidator`: pubkey registered, cluster validated, `updateClusterOnRegistration` called.
- `updateClusterOperatorsOnRegistration`: `ethValidatorCount += 1` for each op, `ensureETHDefaults` runs.
- `updateClusterOnRegistration`: fee settlement (zero for new cluster), `sp.updateDAO(true, 1)`.
- `ebSnapshot.vUnits == 0` (implicit EB — condition at SSVValidators.sol:138 is false).
- Cluster: `validatorCount=1, balance=10 ETH, active=true`.

**Step 2 — EB Update (48 ETH):**
- Advance blocks past `minBlocksBetweenUpdates`. Commit oracle root for 48 ETH.
- `updateClusterBalance(blockNum, owner, ops, cluster, 48, proof)`.
- `newVUnits = ebToVUnits(48) = ceil(48*10000/32) = 15000`.
- `storedVUnits = 0` -> fallback at SSVClusters.sol:391: `storedVUnits = 1 * 10000 = 10000`.
- Fee settlement via `_applyClusterFeeUpdates` using oldVUnits=10000.
- `_updateOperatorVUnits`: delta = 15000 - 10000 = 5000; each op gets `operatorEthVUnits[opId] += 5000`.
- `sp.updateDAOEthVUnits(10000, 15000)`: `daoTotalEthVUnits += 5000`.
- `_updateEBSnapshot`: `ebSnapshot.vUnits = 15000`.

**Step 3 — Remove:**
- `removeValidator(pubkey, ops, cluster)`.
- `_bulkRemoveValidator`: validator record deleted.
- `version == VERSION_ETH` and `cluster.active == true`:
  - `updateClusterOperators`: for each op, `updateSnapshotSt` uses `effectiveVUnits = operatorEthVUnits[opId] + ethValidatorCount * BPS = 5000 + 1*10000 = 15000`. `ethValidatorCount -= 1`.
  - `updateClusterData`: `updateBalanceWithEB` uses `getVUnits(clusterId, 1)` = 15000 (explicit). Fees computed at 15000 vUnits.
  - `sp.updateDAO(false, 1)`: `ethDaoValidatorCount -= 1`.
- `cluster.validatorCount -= 1` = 0.
- EB path (line 204): `ebSnapshot.vUnits > 0` (15000 > 0) -> true.
  - `deltaClusterVUnits = 1 * 10000 = 10000`.
  - `ebSnapshot.vUnits -= 10000` = 5000.
  - `cluster.validatorCount == 0` -> enter cleanup (line 210).
  - `remainingVUnits = 5000`, `cluster.active == true` -> enter loop (line 212).
  - For each of 4 ops: `operatorEthVUnits[opId] -= 5000`.
  - `sp.updateDAOEthVUnits(5000, 0)`: `daoTotalEthVUnits -= 5000`.
  - `ebSnapshot.vUnits = 0` (line 222).

**Postconditions:**
- `operatorEthVUnits[op1..op4] == 0` (deviation fully cleaned).
- `daoTotalEthVUnits` back to pre-EB-update value.
- `ethDaoValidatorCount` back to pre-registration value.
- `ethValidatorCount == 0` for all ops.
- `ebSnapshot.vUnits == 0`.
- Cluster balance reflects EB-weighted fee settlement.

**Code path:** SSVValidators.sol:105-151 -> SSVClusters.sol:348-417 -> SSVValidators.sol:153-257 (lines 204-224).

---

### XV-009: Double EB Update Across Validator Count Change

**Entry:** `registerValidator` -> `updateClusterBalance` (1 val) -> `bulkRegisterValidator` (2 more) -> `updateClusterBalance` (3 vals)

**Preconditions:**
1. 4 operators, register 1 validator. Cluster: `validatorCount=1`, implicit EB.

**Step 1 — First EB Update (48 ETH, 1 validator):**
- `newVUnits = 15000`.
- `storedVUnits = 0` -> fallback to `1 * 10000 = 10000`.
- Delta = 5000 per operator. `ebSnapshot.vUnits = 15000`.

**Step 2 — Register 2 More Validators:**
- `_bulkRegisterValidator`: 2 new pubkeys.
- `updateClusterOnRegistration`: settles fees using `storedVUnits = 15000` (explicit, non-zero at ClusterLib.sol:258).
- `projectedVUnits = 15000 + 2 * 10000 = 35000` — used for liquidity check.
- At SSVValidators.sol:138: `ebSnapshot.vUnits > 0` (15000 > 0) -> true.
- `ebSnapshot.vUnits += 2 * 10000 = 20000` -> `ebSnapshot.vUnits = 35000`.
- `operatorEthVUnits` NOT touched (deviation unchanged by registration).
- `cluster.validatorCount = 3`.

**Step 3 — Second EB Update (144 ETH = 48 ETH/val * 3 vals):**
- `newVUnits = ebToVUnits(144) = ceil(144*10000/32) = 45000`.
- `storedVUnits = 35000` (from registration addition).
- Delta = 45000 - 35000 = 10000.
- `_updateOperatorVUnits`: each op gets `operatorEthVUnits[opId] += 10000`.
- Total operatorEthVUnits per op: 5000 (from step 1) + 10000 (step 3) = 15000.
- `sp.updateDAOEthVUnits(35000, 45000)`: `daoTotalEthVUnits += 10000`.
- `ebSnapshot.vUnits = 45000`.

**Key Verification:**
- The second EB update correctly uses `storedVUnits = 35000` (which includes the +20000 from registration), NOT `3 * 10000 = 30000` (which would be the baseline for 3 validators).
- If the stored vUnits didn't include the registration addition, the delta would be 45000 - 30000 = 15000 instead of 10000, causing over-counting.
- `projectedVUnits` in `updateClusterOnRegistration` and `storedVUnits` in second `updateClusterBalance` must agree: both 35000.

**Invariant:** Registration adds to `ebSnapshot.vUnits` at SSVValidators.sol:140, and EB update reads from `seb.clusterEB[clusterId].vUnits` at SSVClusters.sol:389. These share the same storage slot, so the registration addition is visible to subsequent EB updates.

**Code path:** SSVClusters.sol:388-404, SSVValidators.sol:138-141, ClusterLib.sol:256-260.

---

### XV-016: Re-Registration After Full Cleanup — Implicit EB Restoration

**Entry:** `registerValidator` -> `updateClusterBalance` -> `removeValidator` -> `registerValidator`

**Preconditions:**
1. Register 1 validator, receive explicit EB (48 ETH, vUnits=15000), remove last validator.
2. After removal: `ebSnapshot.vUnits = 0` (zeroed at SSVValidators.sol:222), `operatorEthVUnits[*] = 0`.

**Step — Re-Register:**
- `_bulkRegisterValidator`: register new pubkey into same cluster.
- `updateClusterOnRegistration`: at ClusterLib.sol:257, `storedVUnits = seb.clusterEB[hashedCluster].vUnits = 0`.
- `projectedVUnits = storedVUnits > 0 ? ... : cluster.validatorCount * BPS = 1 * 10000 = 10000`. Takes implicit path.
- Liquidity check uses 10000 vUnits.
- At SSVValidators.sol:138: `ebSnapshot.vUnits > 0` -> false (0 > 0 is false).
- `ebSnapshot.vUnits` NOT updated. Remains 0.
- Cluster returns to implicit EB mode.

**Key Verification:**
- The cluster effectively "forgets" it ever had explicit EB.
- `getVUnits(clusterId, 1)` returns `1 * 10000 = 10000` via fallback at ClusterLib.sol:293.
- Future fee calculations use implicit vUnits.
- To restore explicit EB, another `updateClusterBalance` is needed (tested in XV-017).

**Why this matters:** This is the only path where a cluster transitions from explicit back to implicit EB. If `ebSnapshot.vUnits` were not zeroed at line 222, re-registration would incorrectly add BPS to a stale non-zero value, creating phantom deviation.

**Code path:** SSVValidators.sol:138, 222; ClusterLib.sol:257-260, 289-293.

---

### XV-023: THE BUG PATH — Removed Operator + EB Update + Remove

**Entry:** `registerValidator` -> `removeOperator(op3)` -> `updateClusterBalance` -> `removeValidator`

**Preconditions:**
1. Register 4 operators (op1-op4). Register 1 validator in ETH cluster.
2. Remove operator op3: `op3.ethSnapshot.block = 0`, `operatorEthVUnits[op3]` deleted by `removeOperator` at SSVOperators.sol.

**Step 1 — EB Update (48 ETH):**
- `updateClusterBalance`: `newVUnits = 15000`, `storedVUnits = 10000` (fallback), delta = 5000.
- `_updateOperatorVUnits` at SSVClusters.sol:504-509 iterates ALL operatorIds including op3.
- **NO GUARD**: `seb.operatorEthVUnits[op3] += 5000` — writes deviation to removed operator.
- After: `operatorEthVUnits[op3] = 5000` (was 0 after removal, now stale).

**Step 2 — Remove Validator:**
- `_bulkRemoveValidator`: validator deleted.
- `updateClusterOperators` at OperatorLib.sol:247: `op3.ethSnapshot.block == 0` -> SKIPPED. Op3's `ethValidatorCount` NOT decremented (already 0 from operator removal).
- Fee settlement excludes op3's fee (0 after removal).
- `cluster.validatorCount -= 1` = 0.
- EB cleanup at SSVValidators.sol:210-224:
  - `ebSnapshot.vUnits -= 10000` = 5000 (remaining deviation).
  - `remainingVUnits = 5000`, `cluster.active` = true.
  - Loop at line 216: `seb.operatorEthVUnits[op3] -= 5000` -> back to 0.
  - For op1, op2, op4: `operatorEthVUnits -= 5000` -> back to 0.

**Observation:**
In this specific case, the bug is *self-canceling*: the EB update writes +5000, and the cleanup subtracts -5000, netting to 0. However, this relies on the same delta being written and cleaned in one cycle. If additional EB updates or validator count changes occur between the write and cleanup, the amounts may not cancel.

**Why this is still a bug:**
1. Between the EB update and removal, `operatorEthVUnits[op3] = 5000` is visible to other operations (e.g., operator earnings calculation via `updateSnapshotSt` — though op3 is skipped there due to block==0).
2. The DAO vUnits includes deviation for op3, which is a removed operator.
3. If the cluster is liquidated instead of having validators removed, `_executeLiquidation` also subtracts deviation from all operators including op3 (SSVClusters.sol:586-591), which accesses the stale value.

**Code path:** SSVClusters.sol:504-509 (no guard), SSVValidators.sol:216-217 (no guard).

---

### XV-026: EB Update BEFORE Operator Removal — Underflow Risk

**Entry:** `registerValidator` -> `updateClusterBalance` -> `removeOperator(op3)` -> `removeValidator`

**Preconditions:**
1. Register 4 operators, 1 validator, explicit EB at 48 ETH (vUnits=15000, deviation=5000).
2. `operatorEthVUnits[op3] = 5000` (from EB update).
3. `removeOperator(op3)`: this deletes `operatorEthVUnits[op3]` (set to 0 by `removeOperator` at SSVOperators.sol).

**Critical State:**
- `operatorEthVUnits[op3] = 0` (deleted by operator removal).
- `ebSnapshot.vUnits = 15000` (still reflects deviation from EB update).
- The EB system "thinks" op3 has 5000 deviation, but the operator system deleted it.

**Step — Remove Last Validator:**
- `cluster.validatorCount -= 1` = 0.
- EB cleanup: `ebSnapshot.vUnits -= 10000` = 5000. `remainingVUnits = 5000`.
- Loop: `seb.operatorEthVUnits[op3] -= 5000`.
- But `operatorEthVUnits[op3] = 0` (deleted by operator removal).
- **UNDERFLOW**: `0 - 5000` in uint64 wraps to `2^64 - 5000 = 18446744073709546616`.
- In Solidity 0.8.24 with default checked arithmetic, this **REVERTS** with arithmetic underflow.

**Impact:**
- The entire `removeValidator` transaction reverts.
- The validator is stuck and cannot be removed from the cluster.
- The cluster owner's funds are locked.

**Mitigation (the guard pattern):** The fix is to add the same guard used in `updateClusterOperators`:
```solidity
if (s.operators[operatorIds[i]].ethSnapshot.block == 0) continue;
```
at SSVValidators.sol:216, before subtracting from `operatorEthVUnits`.

**Code path:** SSVOperators.sol (removeOperator deletes operatorEthVUnits), SSVValidators.sol:217 (underflow).

---

### XV-032: Liquidation Then Remove — No Double-Decrement

**Entry:** `registerValidator` -> `updateClusterBalance` -> `liquidate` -> `removeValidator`

**Preconditions:**
1. Register 1 validator, explicit EB (48 ETH, vUnits=15000, deviation=5000 per op).
2. Liquidate cluster via `SSVClusters.liquidate()`:
   - `updateClusterOperators` settles fees, `ethValidatorCount -= 1` for each op.
   - `_executeLiquidation` at SSVClusters.sol:562-612:
     - `sp.updateDAO(false, 1)`: `ethDaoValidatorCount -= 1`.
     - `vUnitsCluster = 15000`, `baseline = 10000`, `deviation = 5000`.
     - `sp.daoTotalEthVUnits -= 5000`.
     - For each op: `operatorEthVUnits[opId] -= 5000` -> back to 0.
     - `cluster.active = false`, `cluster.balance = 0`.
3. Post-liquidation: `operatorEthVUnits[*] = 0`, `ethValidatorCount = 0`, `ebSnapshot.vUnits = 15000` (NOT zeroed by liquidation).

**Step — Remove Validator From Liquidated Cluster:**
- `_bulkRemoveValidator`: validator deleted.
- `version == VERSION_ETH`, `cluster.active == false` -> SKIP active-cluster block (SSVValidators.sol:179).
- No operator snapshot updates, no DAO decrement, no fee settlement.
- `cluster.validatorCount -= 1` = 0.
- EB path: `ebSnapshot.vUnits > 0` (15000 > 0) -> true.
  - `deltaClusterVUnits = 10000`. `ebSnapshot.vUnits -= 10000` = 5000.
  - `cluster.validatorCount == 0` -> enter cleanup.
  - `remainingVUnits = 5000`, BUT `cluster.active == false` -> **SKIP cleanup loop** (line 212).
  - `ebSnapshot.vUnits = 0` (line 222 executes unconditionally).

**Key Verification:**
- Operator deviation NOT subtracted again (already cleaned by liquidation).
- DAO NOT decremented again (already done by liquidation).
- `ebSnapshot.vUnits` zeroed (cleanup for storage).
- The guard at line 212 (`cluster.active`) prevents double-decrement.

**Code path:** SSVClusters.sol:552-612 (liquidation), SSVValidators.sol:178-227 (post-liquidation removal).

---

### XV-034: Reactivation After Liquidation — Deviation Restoration

**Entry:** `registerValidator` -> `updateClusterBalance` -> `liquidate` -> `reactivate` -> `updateClusterBalance`

**Preconditions:**
1. Register 1 validator, EB update to 48 ETH (vUnits=15000, deviation=5000 per op).
2. Liquidate: deviation cleaned, `ethValidatorCount=0`, `cluster.active=false`.
3. `ebSnapshot.vUnits = 15000` (not zeroed by liquidation — only zeroed when last val removed per SSVValidators.sol:222).

**Step 1 — Reactivate:**
- `SSVClusters.reactivate()` at SSVClusters.sol:129-181.
- `vUnitsCluster = seb.clusterEB[clusterId].vUnits = 15000` (still set from EB update).
- `baselineVUnits = 1 * 10000 = 10000`.
- `effectiveVUnits = 15000` (vUnitsCluster > 0).
- `clusterDeviation = 15000 - 10000 = 5000`.
- `updateClusterOperatorsOnReactivation`: for each op, `operatorEthVUnits[opId] += 5000`, `ethValidatorCount += 1`.
- `sp.updateDAO(true, 1)`: `ethDaoValidatorCount += 1`.
- `sp.daoTotalEthVUnits += 5000`.
- `cluster.active = true`.

**Step 2 — Second EB Update (64 ETH):**
- `newVUnits = ebToVUnits(64) = 20000`.
- `storedVUnits = 15000` (from ebSnapshot, still valid).
- Delta = 5000.
- `_updateOperatorVUnits`: each op gets `operatorEthVUnits[opId] += 5000`.
- Total per op: 5000 (reactivation) + 5000 (new EB) = 10000.
- `ebSnapshot.vUnits = 20000`.

**Key Verification:**
- Reactivation correctly restores deviation from ebSnapshot.
- The second EB update treats the cluster as if liquidation never happened (deviation accumulates normally).
- `updateSnapshotSt` uses `effectiveVUnits = operatorEthVUnits[opId] + ethValidatorCount * BPS = 10000 + 1*10000 = 20000`.

**Code path:** SSVClusters.sol:129-181 (reactivate), 142-176 (deviation restoration), 388-404 (second EB).

---

### XV-037: Fee Settlement With EB-Weighted vUnits on Remove

**Entry:** `registerValidator` -> `updateClusterBalance` (48 ETH) -> advance 100 blocks -> `removeValidator`

**Preconditions:**
1. Register 1 validator, 4 operators each with `ethFee = 2000` packed wei/block.
2. Network fee = 1000 packed wei/block.
3. Initial deposit = 10 ETH. Cluster created at block B0.
4. EB update at block B1: `ebSnapshot.vUnits = 15000`. Fees settled from B0 to B1 at implicit vUnits=10000.
5. Advance 100 blocks to B2 = B1 + 100.

**Step — Remove at block B2:**
- `updateClusterOperators`: for each op, `updateSnapshotSt`:
  - `blockDiffEthFee = 100 * 2000 = 200000`.
  - `effectiveVUnits = operatorEthVUnits[opId] + ethValidatorCount * BPS = 5000 + 10000 = 15000`.
  - `delta = (200000 * 15000) / 10000 = 300000`.
  - `operator.ethSnapshot.balance += 300000` packed.
  - `ethValidatorCount -= 1`.
- `cumulativeIndex = sum of updated indexes across 4 ops`.
- `updateClusterData -> updateBalanceWithEB`:
  - `vUnits = getVUnits(clusterId, 1) = 15000` (explicit).
  - `idxOp = newIndex - cluster.index` (reflects 100 blocks * 4 ops' fees).
  - `idxNet = currentNetworkFeeIndex - cluster.networkFeeIndex` (100 blocks * 1000).
  - `networkFeeUnits = (100 * 1000 * 15000) / 10000 = 150000`.
  - `operatorFeeUnits = (100 * 4 * 2000 * 15000) / 10000 = 1200000`.
  - Wait — `idxOp` is the cumulative index delta across all operators, so:
  - `idxOp = 4 * (100 * 2000) = 800000` (cumulative).
  - `operatorFeeUnits = (800000 * 15000) / 10000 = 1200000000`.
  - `totalFees = (1200000000 + 150000) * 100000` = impractically large — use actual packed values.
- **The key point**: fees are 50% higher than they would be at baseline vUnits=10000, because 15000/10000 = 1.5x.

**Verification:**
- If vUnits were incorrectly 10000 (baseline/implicit), fees would be 33% lower.
- `getVUnits` returns 15000 because `ebSnapshot.vUnits != 0`.
- The EB weighting affects BOTH operator fees and network fees equally.

**Code path:** OperatorLib.sol:52-72 (updateSnapshotSt), ClusterLib.sol:306-321 (updateBalanceWithEB), 285-297 (getVUnits).

---

### XV-042: Two Clusters, Same Operators, Independent EB Lifecycles

**Entry:** Register cluster A -> Register cluster B (same ops) -> updateClusterBalance A -> updateClusterBalance B -> remove all A -> remove all B

**Preconditions:**
1. Register 4 operators (op1-op4).
2. Cluster A: 1 validator, owner Alice.
3. Cluster B: 1 validator, owner Bob.
4. Both clusters share all 4 operators.

**Step 1 — EB Update Cluster A (48 ETH):**
- Delta_A = 5000. Each op: `operatorEthVUnits[opId] += 5000`.
- `daoTotalEthVUnits += 5000`.

**Step 2 — EB Update Cluster B (64 ETH):**
- Delta_B = 10000. Each op: `operatorEthVUnits[opId] += 10000`.
- Total per op: 5000 + 10000 = 15000.
- `daoTotalEthVUnits += 10000`. Total DAO deviation = 15000.

**Step 3 — Remove All From Cluster A:**
- `ebSnapshot_A.vUnits -= 10000` = 5000 (deviation).
- Last val cleanup: `operatorEthVUnits[opId] -= 5000` for each op.
- Per op after: 15000 - 5000 = 10000 (cluster B's deviation preserved).
- `daoTotalEthVUnits -= 5000`. DAO deviation = 10000.
- `ebSnapshot_A.vUnits = 0`.

**Step 4 — Remove All From Cluster B:**
- `ebSnapshot_B.vUnits -= 10000` = 10000 (deviation).
- Last val cleanup: `operatorEthVUnits[opId] -= 10000` for each op.
- Per op after: 10000 - 10000 = 0.
- `daoTotalEthVUnits -= 10000`. DAO deviation = 0.
- `ebSnapshot_B.vUnits = 0`.

**Key Verification:**
- Operator deviation is a global per-operator value, not per-cluster.
- Removing cluster A's deviation leaves cluster B's intact.
- The `remainingVUnits` in the cleanup loop is per-cluster (from `ebSnapshot.vUnits`), not global.
- Invariant: `operatorEthVUnits[opId] == sum(deviations from all active clusters using opId)` holds throughout.

**Code path:** SSVClusters.sol:500-509 (stacking), SSVValidators.sol:210-224 (per-cluster cleanup).

---

### XV-046: Complex Interleaving — Register, EB, Remove, Register, EB, Remove

**Entry:** bulk register 10 -> updateClusterBalance -> remove 5 -> register 3 -> updateClusterBalance -> remove 8

**Preconditions:**
1. 7 operators, bulk register 10 validators. Cluster: `validatorCount=10`.

**Step 1 — First EB Update (480 ETH = 48 ETH/val * 10 vals):**
- `storedVUnits = 0` -> fallback `10 * 10000 = 100000`.
- `newVUnits = ebToVUnits(480) = ceil(480*10000/32) = 150000`.
- Delta = 50000 per op. `ebSnapshot.vUnits = 150000`.

**Step 2 — Bulk Remove 5:**
- `updateClusterOperators`: `ethValidatorCount -= 5` per op.
- Fee settlement uses `getVUnits = 150000` (explicit).
- `cluster.validatorCount -= 5` = 5.
- `ebSnapshot.vUnits -= 5 * 10000 = 50000` -> `ebSnapshot.vUnits = 100000`.
- `cluster.validatorCount != 0` -> no deviation cleanup.

**Step 3 — Register 3 More:**
- `ebSnapshot.vUnits > 0` (100000 > 0) -> `ebSnapshot.vUnits += 3 * 10000 = 30000` -> `ebSnapshot.vUnits = 130000`.
- `projectedVUnits = 130000`. Liquidity checked at this level.
- `cluster.validatorCount = 8`.

**Step 4 — Second EB Update (384 ETH = 48 ETH/val * 8 vals):**
- `storedVUnits = 130000` (from step 3).
- `newVUnits = ebToVUnits(384) = ceil(384*10000/32) = 120000`.
- Delta = 120000 - 130000 = -10000 (decrease!).
- `_updateOperatorVUnits`: each op `operatorEthVUnits[opId] -= 10000`.
- Per op: 50000 - 10000 = 40000.
- `ebSnapshot.vUnits = 120000`.

**Step 5 — Bulk Remove All 8:**
- Fee settlement uses `getVUnits = 120000` (explicit).
- `cluster.validatorCount -= 8` = 0.
- `ebSnapshot.vUnits -= 8 * 10000 = 80000` -> `ebSnapshot.vUnits = 40000`.
- `remainingVUnits = 40000`, `cluster.active` = true -> cleanup.
- Each op: `operatorEthVUnits[opId] -= 40000`. Per op: 40000 - 40000 = 0.
- `daoTotalEthVUnits -= 40000`.
- `ebSnapshot.vUnits = 0`.

**Invariant Check:**
- Deviation per op through the lifecycle: +50000 (step 1) - 10000 (step 4) - 40000 (step 5) = 0. Correct.
- `ebSnapshot.vUnits` through lifecycle: 0 -> 150000 -> 100000 -> 130000 -> 120000 -> 40000 -> 0. Clean round-trip.

**Code path:** SSVValidators.sol:138-141, 204-224; SSVClusters.sol:388-404, 494-510.

---

### XV-052: Liquidation Boundary With Explicit EB on Registration

**Entry:** `registerValidator` -> `updateClusterBalance` (48 ETH) -> `registerValidator` (barely sufficient deposit)

**Preconditions:**
1. Register 4 operators with `ethFee = 2000` packed. Network fee = 1000 packed.
2. `minimumBlocksBeforeLiquidation = 100`, `minimumLiquidationCollateral = 0`.
3. Register 1 validator, EB update to 48 ETH: `ebSnapshot.vUnits = 15000`.
4. Advance blocks so cluster.balance is settled.

**Step — Register Second Validator:**
- `updateClusterOnRegistration` at ClusterLib.sol:234-277.
- `storedVUnits = 15000` (explicit). `projectedVUnits = 15000 + 10000 = 25000`.
- `burnRate = 4 * 2000 = 8000`.
- `isLiquidatableWithVUnits(cluster, 25000, 8000, 1000, 100, 0)`:
  - `units = 25000`, `rate = 8000 + 1000 = 9000`.
  - `thresholdUnits = (100 * 9000 * 25000) / 10000 = 2250000`.
  - `liquidationThreshold = 2250000 * 100000 = 225000000000` (225 Gwei).
  - `cluster.balance` must be >= 225 Gwei after fee settlement.

**Comparison — Without EB (baseline only):**
- If `projectedVUnits = 2 * 10000 = 20000`:
  - `thresholdUnits = (100 * 9000 * 20000) / 10000 = 1800000`.
  - `liquidationThreshold = 180 Gwei`.
- The EB deviation adds 25% to the required deposit (225 vs 180 Gwei).

**Key Verification:**
- If `msg.value` is enough for 180 Gwei but not 225 Gwei, the transaction reverts.
- This is correct: the cluster's higher EB means higher burn rate and higher collateral requirement.
- Bug scenario: if code used `cluster.validatorCount * BPS = 20000` instead of `projectedVUnits = 25000`, it would allow undercollateralized registration.

**Code path:** ClusterLib.sol:256-274 (projectedVUnits calculation), 96-112 (isLiquidatableWithVUnits).

---

### XV-057: Sequential EB Increases Then Remove — Accumulated Deviation Cleanup

**Entry:** `registerValidator` -> `updateClusterBalance` (48 ETH) -> `updateClusterBalance` (64 ETH) -> `removeValidator`

**Preconditions:**
1. Register 1 validator, 4 operators.

**Step 1 — First EB Update (48 ETH):**
- `storedVUnits = 0` -> fallback 10000. `newVUnits = 15000`. Delta = +5000 per op.
- `ebSnapshot.vUnits = 15000`.

**Step 2 — Second EB Update (64 ETH):**
- `storedVUnits = 15000`. `newVUnits = 20000`. Delta = +5000 per op.
- Per op: `operatorEthVUnits = 5000 + 5000 = 10000`.
- `ebSnapshot.vUnits = 20000`.

**Step 3 — Remove Last Validator:**
- `ebSnapshot.vUnits -= 10000` = 10000 (remaining = accumulated deviation).
- `cluster.validatorCount == 0` -> cleanup.
- `remainingVUnits = 10000`. For each op: `operatorEthVUnits[opId] -= 10000` -> 0.
- `daoTotalEthVUnits -= 10000`.
- `ebSnapshot.vUnits = 0`.

**Key Verification:**
- The cleanup correctly handles the cumulative deviation from two sequential EB increases.
- `remainingVUnits` captures the total deviation because `ebSnapshot.vUnits` has been tracking it cumulatively: 15000 (first update) -> 20000 (second update) -> 10000 (after subtracting baseline on remove) = pure deviation.
- Each operator gets the full 10000 subtracted, matching what was added across two updates.

**Code path:** SSVClusters.sol:494-510 (two incremental additions), SSVValidators.sol:204-224 (single cleanup).

---

## Coverage Matrix

| Interaction Pattern | Implicit EB | Explicit EB (No Deviation) | Explicit EB (With Deviation) | Removed Operator | Multi-Cluster |
|---------------------|-------------|----------------------------|------------------------------|------------------|---------------|
| Register -> Remove | XV-012 | XV-013 | XV-002, XV-005 | XV-022 (revert) | — |
| Register -> EB -> Remove (partial) | — | — | XV-003, XV-004, XV-006 | — | XV-027 |
| Register -> EB -> Remove (all) | — | XV-013 | XV-002, XV-005, XV-007, XV-011 | XV-023, XV-025, XV-026 | XV-042 |
| Register -> EB -> Register | — | — | XV-008, XV-009, XV-020, XV-029 | XV-050 | — |
| Register -> EB -> Register -> EB | — | — | XV-009, XV-010, XV-036 | — | — |
| Register -> EB -> Remove -> Register | — | — | XV-016, XV-017, XV-018 | — | — |
| Exit -> EB -> Remove | — | — | XV-014, XV-015 | — | — |
| EB -> Liquidation -> Remove | — | — | XV-032, XV-033 | — | — |
| EB -> Liquidation -> Reactivate -> EB | — | — | XV-034, XV-035 | — | — |
| Multi-step interleaving | — | — | XV-019, XV-031, XV-046, XV-060 | XV-049 | XV-042 |
| Sequential EB updates + Remove | — | — | XV-057, XV-058 | XV-024 | — |
| Same-block operations | XV-047 | XV-048 | — | — | — |
| Boundary / Precision | — | — | XV-028, XV-040, XV-052, XV-053 | — | — |
| Reverts / Edge cases | — | — | XV-021, XV-054, XV-055 | XV-022, XV-026 | — |
| Fee interaction | — | — | XV-037, XV-038, XV-045, XV-051, XV-056 | — | — |
| Deposit/Withdraw between | — | — | XV-043, XV-044 | — | — |
| Max operators / scale | — | — | XV-059, XV-031 | — | — |

---

## Cross-Reference Index

| Bug/Feature | XV Scenarios | W1 Cross-Refs |
|-------------|-------------|---------------|
| Removed operator vUnits bug (no guard in _updateOperatorVUnits) | XV-023, XV-024, XV-025, XV-026, XV-049, XV-050 | EB-055, EB-056, EB-057, VX-028, VX-037 |
| Deviation cleanup on last-val remove | XV-002, XV-005, XV-007, XV-011, XV-030, XV-057, XV-058 | VX-009, VX-027 |
| Liquidation double-decrement prevention | XV-032, XV-033, XV-035 | VX-016, EB-060 |
| Reactivation deviation restoration | XV-034 | — |
| Implicit->explicit EB transition | XV-017, XV-035 | EB-058 |
| Explicit->implicit EB transition (cleanup to zero) | XV-016 | — |
| ebSnapshot.vUnits tracking across add/remove | XV-008, XV-009, XV-010, XV-018, XV-041, XV-046 | VR-028, VR-054 |
| Fee settlement EB-weighting | XV-037, XV-038, XV-044, XV-051, XV-056 | VX-019, VX-020, EB-063, EB-092 |
| Projected vUnits liquidation check | XV-028, XV-029, XV-052, XV-053 | VR-059 |
| Shared operator deviation stacking | XV-027, XV-042 | EB-085 |
| Auto-liquidation on EB update | XV-033 | EB-051, EB-066, EB-067 |

---

## Summary

- **Total scenarios:** 60 (XV-001 to XV-060)
- **Detailed blocks:** 12
- **Revert scenarios:** 5 (XV-021, XV-022, XV-026, XV-053, XV-054, XV-055)
- **Bug-path scenarios:** 6 (XV-023 through XV-026, XV-049, XV-050)
- **Scale/gas scenarios:** 3 (XV-011, XV-031, XV-059)
- **Key coverage gaps filled by Wave 2:**
  - vUnits baseline changes when validator count changes mid-lifecycle
  - ebSnapshot lifecycle through add/remove/EB-update/liquidation/reactivation cycles
  - Deviation accumulation across interleaved operations
  - Removed operator vUnits interaction across both `_updateOperatorVUnits` and deviation cleanup
  - Implicit/explicit EB transition round-trips
  - Fee settlement correctness with EB-weighted vUnits after validator count changes

## ask-codex Review Findings

### Corrections
- XV-035 IMPOSSIBLE PATH: `liquidate → remove → register` is unreachable. After liquidation, cluster stays `active=false`. Next registration rejected by `validateClusterIsNotLiquidated` at ClusterLib.sol:193/221. Matrix/index entries reusing XV-035 are also wrong.
- XV-026 tag should be `revert:yes` not `revert:depends` — Solidity 0.8 checked arithmetic makes the underflow deterministic.
- XV empty-cluster EB-update edge (around XV-016/017): With validatorCount==0 and positive effectiveBalance, reverts `EBExceedsMaximum` at SSVClusters.sol:454, NOT `EBBelowMinimum`. With effectiveBalance==0, succeeds and short-circuits at SSVClusters.sol:529.

### Additional Scenarios
| XV-061 | liquidate → remove subset → reactivate → updateClusterBalance | Liquidated cluster, remove some (not all) validators while inactive. Inactive removal still subtracts baseline from ebSnapshot.vUnits (SSVValidators.sol:204/207). Reactivate with reduced validator count, then EB update recomputes deviation from new baseline. | `entry:updateClusterEB; revert:no` | [ ] | SSVValidators.sol:204, SSVClusters.sol:142,145 |
| XV-062 | liquidate → remove subset → reactivate → updateClusterBalance (with removed operator) | Same as XV-061 but one operator was also removed. Reactivation skips dead operator in deviation loop. Tests compound validator-count-change + operator-removal on deviation accounting. | `entry:updateClusterEB; bug:removed-op; revert:no` | [ ] | OperatorLib.sol:291, SSVClusters.sol:504 |

---

## Coverage Verification (W4)

| ID | Tested | remove_mode | Test File | Notes |
|----|--------|-------------|-----------|-------|
| XV-001 | partial:weak | none | test/e2e/cross-cutting/full-lifecycle.test.ts | Full lifecycle test covers register→EB→remove flow but only checks cluster balance/validatorCount, not vUnits==0 or ebSnapshot zeroed |
| XV-002 | partial:weak | none | test/e2e/cross-cutting/full-lifecycle.test.ts, test/unit/SSVValidator/removeValidator.test.ts ("Clears remaining explicit EB vUnits when removing the last validator") | Unit test verifies clusterVUnits==0 after last-val remove with EB, but does not verify per-operator deviation cleanup |
| XV-003 | partial:weak | none | test/unit/SSVValidator/bulkRemoveValidator.test.ts ("Decrements stored EB snapshot vUnits when set and removing a subset") | Tests ebSnapshot.vUnits decrement on partial remove, but does not verify deviation preserved |
| XV-004 | no | none | — | No test for partial remove leaving 1 validator with deviation verification |
| XV-005 | partial:weak | none | test/unit/SSVValidator/bulkRemoveValidator.test.ts ("Clears stored EB snapshot vUnits when removing the last validators") | Tests ebSnapshot.vUnits cleared on full remove, but does not verify per-operator deviation subtracted |
| XV-006 | no | none | — | No test for bulk partial remove with EB deviation intact |
| XV-007 | no | none | — | No test for bulk full remove at 7 operators with deviation cleanup scaling |
| XV-008 | yes | none | test/unit/SSVValidator/registerValidator.test.ts ("Increments stored EB snapshot vUnits when cluster EB snapshot is set") | Verifies ebSnapshot.vUnits += BPS_DENOMINATOR on registration into explicit-EB cluster |
| XV-009 | no | none | — | No test for double EB update across validator count change verifying storedVUnits coherence |
| XV-010 | no | none | — | No test for interleaved register and EB update with storedVUnits consistency |
| XV-011 | no | none | — | No test for complete cycle at scale (10 vals) with full deviation cleanup |
| XV-012 | partial:weak | none | test/unit/SSVValidator/removeValidator.test.ts ("Updates operatorEthVUnits on register/remove even when cluster EB snapshot is not set") | Tests implicit-EB register/remove but does not specifically verify the EB cleanup path is NOT entered |
| XV-013 | no | none | — | No test for explicit EB at baseline (no deviation) then remove verifying cleanup loop skipped |
| XV-014 | no | none | — | No test for exit→EB→remove flow verifying exit is event-only |
| XV-015 | no | none | — | No test for mixed exit+remove with EB update |
| XV-016 | no | none | — | No test for re-registration after full cleanup returning to implicit EB |
| XV-017 | no | none | — | No test for full round-trip implicit→explicit→cleanup→implicit→explicit |
| XV-018 | no | none | — | No test for add-after-EB then partial remove verifying deviation preserved |
| XV-019 | no | none | — | No test for sequential EB updates with removals between |
| XV-020 | no | none | — | No test for massive expansion (9 more vals) after high EB |
| XV-021 | no | none | — | No test for EB update after all validators removed |
| XV-022 | yes | none | test/unit/SSVValidator/registerValidator.test.ts ("OperatorDoesNotExist when one of operators has been removed"), test/integration/SSVNetwork.test.ts (line 1789) | Verifies register with removed operator reverts OperatorDoesNotExist |
| XV-023 | no | real | — | THE BUG PATH: No test for register→removeOperator→EB update→remove (writes deviation to removed op). Critical gap |
| XV-024 | no | real | — | No test for removed-op deviation return-to-baseline across two EB updates |
| XV-025 | no | real | — | No test for removed-op full cleanup: EB update + bulk remove all |
| XV-026 | no | real | — | No test for EB before operator removal causing underflow on last-val remove. Critical bug path |
| XV-027 | no | none | — | No test for shared operators between two clusters with EB + partial remove |
| XV-028 | partial:weak | none | test/sanity/ssv3-stale-vunits-liquidation.test.ts ("Reverts with InsufficientBalance when deposit covers old vUnits but not post-registration vUnits") | Tests registration liquidity check with explicit EB, but at unit harness level, not full lifecycle |
| XV-029 | no | none | — | No test for max EB then register verifying projected vUnits |
| XV-030 | no | none | — | No test for max EB then remove verifying large deviation cleanup |
| XV-031 | no | none | — | No test for large-scale interleaved (50 vals) with gas verification |
| XV-032 | yes | none | test/unit/SSVValidator/bug4-double-deviation-liquidated.test.ts ("should not double-subtract deviation when removing all validators from a liquidated cluster") | Exact match: liquidation then remove, verifies no double-decrement of operatorEthVUnits and daoTotalEthVUnits |
| XV-033 | yes | none | test/unit/SSVClusters/ebAutoLiquidation.test.ts ("Auto-liquidates cluster when EB increase makes it insolvent"), test/e2e/clusters-eth/cluster-eth-liquidation.test.ts ("EB increase triggers auto-liquidation") | Tests EB-triggered auto-liquidation with deviation cleanup verification |
| XV-034 | no | none | — | No test for reactivation after liquidation restoring deviation then second EB update |
| XV-035 | no | none | — | IMPOSSIBLE PATH per corrections (registration rejected on liquidated cluster) |
| XV-036 | no | none | — | No test for cross-block interleaving (EB→register→EB) |
| XV-037 | yes | none | test/unit/SSVClusters/ebSettlement.test.ts ("Removal settles fees using EB-weighted vUnits") | Tests remove after EB update verifying fee settlement uses explicit vUnits=15000 not baseline |
| XV-038 | yes | none | test/unit/SSVClusters/ebSettlement.test.ts ("Registration settles fees using EB-weighted vUnits, not flat validatorCount") | Tests registration after EB, verifies fee settlement at pre-registration explicit vUnits |
| XV-039 | no | none | — | No test for serial single removals with deviation cleanup on last |
| XV-040 | no | none | — | No test for non-aligned EB precision (e.g., 33 ETH) |
| XV-041 | no | none | — | No test for add-then-serial-remove with deviation only cleaned on last |
| XV-042 | partial:weak | none | test/e2e/effective-balance/eb-operator-vunits.test.ts ("Accumulates vUnit deviations from multiple clusters") | Tests two clusters same operators with independent EB updates, but does not verify independent removal/cleanup |
| XV-043 | no | none | — | No test for deposit between EB and remove verifying ebSnapshot unchanged |
| XV-044 | no | none | — | No test for withdraw between EB and remove verifying no double-settlement |
| XV-045 | no | none | — | No test for operator fee change between EB and remove |
| XV-046 | no | none | — | No test for complex interleaving (10 vals, partial removes, re-register, second EB, final remove) |
| XV-047 | no | none | — | No test for same-block EB update (zero fee delta) |
| XV-048 | no | none | — | No test for same-block remove after EB |
| XV-049 | no | real | — | No test for multiple removed operators + EB update + remove |
| XV-050 | no | real | — | No test for removed op + register after EB: operatorEthVUnits unchanged |
| XV-051 | partial:weak | none | test/unit/SSVClusters/networkFeeImpact.test.ts ("Network fee with EB-weighted cluster vUnit scaling applied") | Tests network fee with EB-weighted vUnits but not specifically between EB and removal |
| XV-052 | partial:weak | none | test/sanity/ssv3-stale-vunits-liquidation.test.ts ("Reverts with InsufficientBalance...") | Tests liquidation boundary with explicit EB but specific projectedVUnits math not fully isolated |
| XV-053 | no | none | — | No test for insufficient deposit with EB deviation at exact boundary |
| XV-054 | no | none | — | No test for bulk remove with empty pubkeys from explicit EB cluster |
| XV-055 | no | none | — | No test for atomic revert preserving EB state on invalid pubkey in batch |
| XV-056 | partial:weak | none | test/unit/SSVClusters/operatorFeeEBInteraction.test.ts ("Fee change boundary accounting") | Tests two fee rate periods with EB but not two EB updates straddling a fee change |
| XV-057 | no | none | — | No test for sequential EB increases then remove (accumulated deviation) |
| XV-058 | partial:weak | none | test/unit/SSVClusters/ebDecreaseScenarios.test.ts ("EB decrease from 64 to 32 ETH reduces vUnits") | Tests EB increase then decrease but does not then remove last validator to verify cleanup |
| XV-059 | partial:weak | none | test/unit/SSVClusters/updateClusterBalance.test.ts ("Updates vUnit accounting correctly for 13 operators at maximum EB") | Tests 13-operator EB update but does not test the full register→EB→remove cycle at 13 ops |
| XV-060 | no | none | — | No test for exhaustive full complex lifecycle |
| XV-061 | no | none | — | No test for liquidate→remove subset→reactivate→EB update |
| XV-062 | no | real | — | No test for XV-061 variant with removed operator |

**Summary:** 6 yes, 13 partial (0 partial:mock, 13 partial:weak), 43 no. Coverage is 10% full, 31% partial. Critical bug paths (XV-023 through XV-026, XV-049) are completely untested. The existing tests for liquidation-then-remove (XV-032) and fee settlement (XV-037, XV-038) are the strongest coverage points.
