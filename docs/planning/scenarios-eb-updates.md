# EB Update & Deviation Math Scenarios (EB-031 to EB-100)

Code-grounded scenarios for `updateClusterBalance` and the deviation accounting system.

**Source files:**
- `contracts/modules/SSVClusters.sol` — `updateClusterBalance`, `_updateClusterBalanceInternal`, `_verify*`, `_updateOperatorVUnits`, `_updateEBSnapshot`, `_liquidateAfterEBUpdateIfNeeded`, `_executeLiquidation`, `_applyClusterFeeUpdates`
- `contracts/libraries/ClusterLib.sol` — `ebToVUnits`, `vUnitsToEB`, `getVUnits`, `isLiquidatableWithEB`, `updateBalanceWithEB`
- `contracts/libraries/storage/SSVStorageEB.sol` — `ClusterEBSnapshot`, `StorageEB`
- `contracts/libraries/SSVCoreTypes.sol` — `BPS_DENOMINATOR=10_000`, `ETH_DEDUCTED_DIGITS=100_000`, `DEFAULT_EB_PER_VALIDATOR=32 ether`, `MAX_EB_PER_VALIDATOR=2048 ether`

**Code-Grounding Rules:**
- 32 ETH per validator is the enforced floor — below-baseline / negative deviation is UNREACHABLE (`_verifyEBLimits` reverts `EBBelowMinimum`)
- All deviation values are >= 0 (vUnits >= validatorCount * BPS_DENOMINATOR)
- `_liquidateAfterEBUpdateIfNeeded` -> `_executeLiquidation` is a compound path
- `operatorEthVUnits[removedOp]` should be 0 after operator removal (THE BUG — RM1-* cross-ref)

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| EB-031 | updateClusterBalance | Happy path: 4-op ETH cluster, valid proof, EB stays at 32 ETH/val (no-op deviation) | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:348-417 |
| EB-032 | updateClusterBalance | Happy path: 7-op ETH cluster, EB 32 ETH/val, verify event emission and snapshot update | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:7; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:348-417, 512-517 |
| EB-033 | updateClusterBalance | Happy path: 10-op ETH cluster, EB 32 ETH/val | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:10; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:348-417 |
| EB-034 | updateClusterBalance | Happy path: 13-op ETH cluster (max operators), EB 32 ETH/val | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:13; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:348-417 |
| EB-035 | updateClusterBalance | Invalid merkle proof — revert `InvalidProof` | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:445-451 |
| EB-036 | updateClusterBalance | No committed root for blockNum — revert `RootNotFound` | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:419-423 |
| EB-037 | updateClusterBalance | Stale root: blockNum != latestCommittedBlock — revert `MustUseLatestRoot` | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:434-443 |
| EB-038 | updateClusterBalance | Stale per-cluster: blockNum <= lastRootBlockNum — revert `StaleUpdate` | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:434-443 |
| EB-039 | updateClusterBalance | Too frequent: block.number < lastUpdateBlock + minBlocksBetweenUpdates — revert `UpdateTooFrequent` | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:425-431 |
| EB-040 | updateClusterBalance | EB increase: 32->48 ETH/val (1 val), deviation 5000 vUnits added to each operator and DAO | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:385-403, 494-510 |
| EB-041 | updateClusterBalance | EB increase: 32->48 ETH/val (3 vals), deviation 15000 vUnits total | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:7; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:385-403, 494-510 |
| EB-042 | updateClusterBalance | EB decrease: 48->32 ETH/val, deviation returns to 0 for all operators and DAO | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:494-510 |
| EB-043 | updateClusterBalance | EB at max: 2048 ETH/val (1 val), vUnits = 640000, massive deviation | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:385-404, ClusterLib.sol:366-371 |
| EB-044 | updateClusterBalance | EB at min: 32 ETH/val, confirms deviation = 0, storedVUnits == baseline | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:385-404 |
| EB-045 | updateClusterBalance | EB below floor (31 ETH for 1 val) — revert `EBBelowMinimum` | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:453-459 |
| EB-046 | updateClusterBalance | EB above max (2049 ETH for 1 val) — revert `EBExceedsMaximum` | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:453-459 |
| EB-047 | updateClusterBalance | EB below floor multi-val (63 ETH for 2 vals) — revert `EBBelowMinimum` | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:453-459 |
| EB-048 | updateClusterBalance | EB above max multi-val (4097 ETH for 2 vals) — revert `EBExceedsMaximum` | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:453-459 |
| EB-049 | updateClusterBalance | Sequential updates: 32->48->64, two roots committed, deviation grows from 0 to 5000 to 10000 | `entry:updateClusterBalance; version:eth; eb:implicit->explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:385-404, 494-510 |
| EB-050 | updateClusterBalance | Sequential updates: 64->48->32, deviation shrinks back to 0 | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:385-404, 494-510 |
| EB-051 | updateClusterBalance | Update triggers auto-liquidation: EB increase makes burn rate exceed balance | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:519-550, 552-612 |
| EB-052 | updateClusterBalance | Auto-liquidation bounty goes to msg.sender (not cluster owner) | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:546, 607-609 |
| EB-053 | updateClusterBalance | Verify operatorEthVUnits updated per operator: 4 ops, each gets full delta (not divided) | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:494-510 |
| EB-054 | updateClusterBalance | Verify daoTotalEthVUnits updated: delta added/removed from sp.daoTotalEthVUnits | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:402, ProtocolLib updateDAOEthVUnits |
| EB-055 | updateClusterBalance | With removed operator (THE BUG): cluster has 1 removed op, update still writes to operatorEthVUnits[removedOp] — cross-ref RM1-* | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:494-510 |
| EB-056 | updateClusterBalance | With removed operator: verify _applyClusterFeeUpdates skips removed op fee (ethFee=0) but still iterates | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:461-492 |
| EB-057 | updateClusterBalance | With removed operator: auto-liquidation path, deviation cleanup must handle removed op vUnits correctly | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:519-550, 567-596 |
| EB-058 | updateClusterBalance | Implicit cluster first explicit update: storedVUnits=0 becomes validatorCount*BPS, then newVUnits applied | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:388-392 |
| EB-059 | updateClusterBalance | Multiple clusters update in same block (different clusters, same root) | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:425-431 |
| EB-060 | updateClusterBalance | EB update on liquidated ETH cluster: snapshot updated, fee/deviation steps skipped | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:395-403, 512-517 |
| EB-061 | updateClusterBalance | EB update on SSV cluster: only snapshot stored, no fee/deviation updates | `entry:updateClusterBalance; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:411-414 |
| EB-062 | updateClusterBalance | EB update on SSV cluster then migrate: deviation correctly applied during migration | `entry:updateClusterBalance; version:ssv; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:411-414, 259-343 |
| EB-063 | updateClusterBalance | Fee settlement uses OLD vUnits before applying new ones (ordering correctness) | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:396-403 |
| EB-064 | updateClusterBalance | EB same value update: newVUnits == storedVUnits, no deviation change, snapshot still updated | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:400-403 |
| EB-065 | updateClusterBalance | Update on cluster with 0 validators (validatorCount=0): EB limits check with 0 | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVClusters.sol:453-459 |
| EB-066 | updateClusterBalance | Auto-liquidation on EB increase: vUnits applied BEFORE liquidation check (new vUnits used for threshold) | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:399-406 |
| EB-067 | updateClusterBalance | Auto-liquidation cleanup: deviation removed from operatorEthVUnits and daoTotalEthVUnits | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:7; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:562-597 |
| EB-068 | updateClusterBalance | Auto-liquidation on implicit cluster: vUnits=0 stored, _executeLiquidation skips deviation cleanup | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:569-597 |
| EB-069 | updateClusterBalance | Two sequential updates with removed operator between them: first update OK, op removed, second update writes stale vUnits | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:494-510 |
| EB-070 | updateClusterBalance | Cluster with mixed fee operators (some free, some paid): fee settlement + deviation update correctness | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:461-492, 494-510 |
| EB-071 | deviation math | Deviation accumulation: 32->40->48->64 across 3 sequential updates, check incremental delta correctness | `entry:updateClusterBalance; version:eth; eb:implicit->explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:494-510, ClusterLib.sol:366-371 |
| EB-072 | deviation math | Deviation with 4 operators: each operator gets FULL delta (not delta/4) | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:500-509 |
| EB-073 | deviation math | Deviation with 7 operators: same full delta per operator (no division) | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:7; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:500-509 |
| EB-074 | deviation math | Deviation with 10 operators: verify all 10 get identical delta | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:10; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:500-509 |
| EB-075 | deviation math | Deviation with 13 operators (max): verify all 13 get identical delta | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:13; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:500-509 |
| EB-076 | deviation math | Deviation return to zero: explicit EB 48->32 ETH/val, newVUnits == baseline, operatorEthVUnits returns to pre-deviation value | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:500-509 |
| EB-077 | deviation math | Deviation precision: small EB change 32->33 ETH (1 val), vUnits=ceil(33*10000/32)=10313, delta=313 per operator | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:366-371, SSVClusters.sol:500-509 |
| EB-078 | deviation math | Deviation precision: 33->34 ETH, vUnits=ceil(34*10000/32)=10625, delta from previous=312 | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:366-371 |
| EB-079 | deviation math | Deviation precision: 32->2048 ETH (1 val), vUnits=640000, deviation=630000, max single-step delta | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:366-371, SSVClusters.sol:500-509 |
| EB-080 | deviation math | Deviation with max validators per cluster (500 vals), 32 ETH each, baseline=5000000 vUnits | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:385-404 |
| EB-081 | deviation math | Max validators + max EB: 500 vals at 2048 ETH, vUnits=320000000, deviation=315000000 | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:385-404, ClusterLib.sol:366-371 |
| EB-082 | deviation math | ClusterEBSnapshot.vUnits consistency: after update, getVUnits returns stored value (not fallback) | `entry:updateClusterBalance; version:eth; eb:implicit->explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:285-297 |
| EB-083 | deviation math | ClusterEBSnapshot.lastRootBlockNum: set to blockNum from proof, not block.number | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:512-517 |
| EB-084 | deviation math | ClusterEBSnapshot.lastUpdateBlock: set to block.number, enforces minBlocksBetweenUpdates | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:512-517, 425-431 |
| EB-085 | deviation math | Two clusters share operators: deviation from cluster A and B stack on shared operators | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:500-509 |
| EB-086 | deviation math | ebToVUnits ceiling division: 33 ETH -> ceil(33*10000/32) = 10313, verify exact value | `entry:ebToVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:366-371 |
| EB-087 | deviation math | ebToVUnits: 32 ETH -> exactly 10000, no ceiling needed (evenly divisible) | `entry:ebToVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:366-371 |
| EB-088 | deviation math | ebToVUnits: 64 ETH -> exactly 20000 | `entry:ebToVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:366-371 |
| EB-089 | deviation math | ebToVUnits: 2048 ETH -> exactly 640000 | `entry:ebToVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:366-371 |
| EB-090 | deviation math | vUnitsToEB round-trip: ebToVUnits(X) -> vUnitsToEB -> X for all multiples of 32 | `entry:vUnitsToEB; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:366-381 |
| EB-091 | deviation math | vUnitsToEB round-trip asymmetry: ebToVUnits(33) = 10313, vUnitsToEB(10313) = 33 (floor) | `entry:vUnitsToEB; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:366-381 |
| EB-092 | deviation math | Deviation + fee settlement interaction: fees deducted using OLD vUnits, then deviation changes future burn | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:396-403, 461-492 |
| EB-093 | deviation math | Deviation + liquidation threshold: isLiquidatableWithEB uses updated vUnits (post-update), higher threshold | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:67-84, SSVClusters.sol:531-537 |
| EB-094 | deviation math | Multiple clusters, one liquidated, one active: only active cluster deviation tracked | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active|liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:395-403 |
| EB-095 | deviation math | Deviation after auto-liquidation: _executeLiquidation subtracts deviation from all operators | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:567-596 |
| EB-096 | deviation math | Deviation cleanup on liquidation with implicit EB: vUnitsCluster=0, no deviation subtracted | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:569 |
| EB-097 | deviation math | Net-zero deviation: cluster A adds +5000, cluster B subtracts -5000 on same operators, net operator deviation = 0 | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:500-509 |
| EB-098 | deviation math | DAO invariant check: daoTotalEthVUnits == ethDaoValidatorCount*BPS + sum(all cluster deviations) | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SPEC.md §2 "DAO vUnit Tracking" |
| EB-099 | deviation math | Operator vUnits invariant: sum(operatorEthVUnits[op]) across all clusters equals expected per operator | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVClusters.sol:500-509 |
| EB-100 | deviation math | ebToVUnits(0) returns 0, edge case for empty effective balance (unreachable in practice due to floor check) | `entry:ebToVUnits; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ClusterLib.sol:370 |

---

## Detailed Scenario Blocks (15 Most Complex)

---

### EB-040: EB Increase 32->48 ETH/val — Deviation Accounting

**Goal:** Verify that an EB increase from the implicit 32 ETH baseline to 48 ETH correctly creates deviation entries for each operator and the DAO.

**Setup:**
1. Register 4 operators with non-zero ETH fees.
2. Create an active ETH cluster (4 ops, 1 validator), deposit sufficient ETH.
3. Commit oracle root containing `(clusterId, effectiveBalance=48)`.
4. Advance blocks past `minBlocksBetweenUpdates`.

**Execution:**
1. Call `updateClusterBalance(blockNum, owner, operatorIds, cluster, 48, proof)`.

**Assertions:**
- `storedVUnits` was 0 (implicit), so `effectiveOld = 1 * 10000 = 10000`.
- `newVUnits = ebToVUnits(48) = ceil(48 * 10000 / 32) = 15000`.
- Delta = 15000 - 10000 = 5000.
- For each of the 4 operators: `operatorEthVUnits[opId]` increased by 5000 (not 5000/4).
- `daoTotalEthVUnits` increased by 5000 (via `updateDAOEthVUnits`).
- `clusterEB[clusterId].vUnits == 15000`.
- `clusterEB[clusterId].lastRootBlockNum == blockNum`.
- `clusterEB[clusterId].lastUpdateBlock == block.number`.
- `ClusterBalanceUpdated` event emitted with `effectiveBalance=48`.

**Code path:** `SSVClusters.sol:388-392` (storedVUnits fallback) -> `385` (ebToVUnits) -> `400-403` (_updateOperatorVUnits + updateDAOEthVUnits) -> `404` (_updateEBSnapshot).

---

### EB-042: EB Decrease 48->32 — Deviation Returns to Zero

**Goal:** Verify that decreasing EB back to the baseline removes all deviation from operators and DAO.

**Setup:**
1. Start from EB-040 postcondition: cluster has explicit vUnits=15000, each operator has +5000 deviation.
2. Commit new oracle root with `(clusterId, effectiveBalance=32)`.
3. Advance blocks.

**Execution:**
1. Call `updateClusterBalance` with `effectiveBalance=32`.

**Assertions:**
- `storedVUnits = 15000` (explicit, non-zero).
- `newVUnits = ebToVUnits(32) = 10000`.
- Delta = 10000 - 15000 = -5000 (deltaPositive = false, deltaAbs = 5000).
- For each operator: `operatorEthVUnits[opId]` decreased by 5000.
- `daoTotalEthVUnits` decreased by 5000.
- `clusterEB[clusterId].vUnits == 10000` (now explicit at baseline).
- Future fee accrual uses vUnits=10000 (equivalent to pre-EB-update behavior).

**Code path:** `SSVClusters.sol:501` (deltaPositive=false) -> `508` (subtraction branch).

---

### EB-049: Sequential Updates 32->48->64 — Incremental Deviation Growth

**Goal:** Verify that two sequential EB increases correctly accumulate deviation incrementally rather than from baseline each time.

**Setup:**
1. Active ETH cluster, 4 ops, 2 validators, implicit EB.
2. Commit root A with `effectiveBalance=96` (48 ETH/val * 2 vals).
3. After minBlocksBetweenUpdates + new root commit, root B with `effectiveBalance=128` (64 ETH/val * 2 vals).

**Execution:**
1. Call `updateClusterBalance` with root A, `effectiveBalance=96`.
2. Wait for minBlocksBetweenUpdates. Commit root B.
3. Call `updateClusterBalance` with root B, `effectiveBalance=128`.

**Assertions after update 1:**
- `effectiveOldVUnits = 2 * 10000 = 20000` (implicit).
- `newVUnits = ebToVUnits(96) = ceil(96 * 10000 / 32) = 30000`.
- Delta1 = 30000 - 20000 = 10000 per operator.

**Assertions after update 2:**
- `storedVUnits = 30000` (explicit from update 1).
- `newVUnits = ebToVUnits(128) = ceil(128 * 10000 / 32) = 40000`.
- Delta2 = 40000 - 30000 = 10000 per operator.
- Total deviation per operator = 20000 (cumulative from two updates).
- `daoTotalEthVUnits` increased by 20000 total across both updates.

**Code path:** First update: `SSVClusters.sol:391` (storedVUnits=0 fallback). Second update: `SSVClusters.sol:389` (storedVUnits=30000, non-zero).

---

### EB-051: Update Triggers Auto-Liquidation

**Goal:** Verify that an EB increase can make a marginally-funded cluster undercollateralized, triggering auto-liquidation within the same call.

**Setup:**
1. Active ETH cluster, 4 ops, 1 validator.
2. Cluster balance set to just above the liquidation threshold at 32 ETH EB (e.g., `minimumBlocksBeforeLiquidation * totalBurnRate * 10000 / 10000 * 100000 + minimumLiquidationCollateral + 1`).
3. Commit root with `effectiveBalance=64` (doubling EB).

**Execution:**
1. Call `updateClusterBalance` with `effectiveBalance=64` from a non-owner address (liquidator).

**Assertions:**
- Fees settled using OLD vUnits (10000) first — balance decreases.
- New vUnits = 20000 applied to operator and DAO deviation.
- `_liquidateAfterEBUpdateIfNeeded` checks `isLiquidatableWithEB` with new vUnits.
- New threshold = `minimumBlocksBeforeLiquidation * totalBurnRate * 20000 / 10000 * 100000` — doubled.
- Cluster balance < new threshold -> liquidation triggered.
- `_executeLiquidation` called: deviation removed from operators/DAO, ethValidatorCount decremented, balance transferred to msg.sender (liquidator).
- `cluster.active == false`, `cluster.balance == 0`.
- `ClusterLiquidated` event emitted.
- `ClusterBalanceUpdated` event emitted (before liquidation event).

**Code path:** `SSVClusters.sol:399-403` (apply new vUnits) -> `406` (_liquidateAfterEBUpdateIfNeeded) -> `531-537` (isLiquidatableWithEB) -> `539-547` (decrement ethValidatorCount, call _executeLiquidation) -> `562-612`.

---

### EB-055: EB Update With Removed Operator (THE BUG)

**Goal:** Demonstrate that `_updateOperatorVUnits` writes deviation to `operatorEthVUnits[removedOpId]` even though the operator has been removed. This is the known bug cross-referenced as RM1-*.

**Setup:**
1. Register 4 operators (op1, op2, op3, op4).
2. Create active ETH cluster with all 4 operators, 1 validator.
3. Remove operator op4 (via `removeOperator`): `ethSnapshot.block = 0`, `ethFee = 0`, `ethValidatorCount = 0`.
4. Confirm `operatorEthVUnits[op4] == 0` after removal.
5. Commit root with `effectiveBalance=48` for the cluster.

**Execution:**
1. Call `updateClusterBalance` with `effectiveBalance=48`.

**Assertions:**
- `_updateOperatorVUnits` iterates all 4 operatorIds (including op4).
- Delta = 5000 (15000 - 10000).
- `operatorEthVUnits[op4] += 5000` — deviation written to removed operator.
- This is the bug: removed operators should not accumulate deviation.
- The stale `operatorEthVUnits[op4]` can never be cleaned up through normal flows since the operator is removed.
- Impact: `daoTotalEthVUnits` also includes this deviation, creating a permanent accounting mismatch.

**Code path:** `SSVClusters.sol:504-509` — no check for `operator.ethSnapshot.block != 0` before writing.

---

### EB-057: Auto-Liquidation With Removed Operator — Deviation Cleanup

**Goal:** Verify the compound path where an EB update triggers auto-liquidation on a cluster containing a removed operator, and check whether `_executeLiquidation` correctly handles the removed operator's deviation.

**Setup:**
1. Active ETH cluster, 4 ops (op4 removed), 1 validator.
2. Previous EB update set vUnits=15000 (48 ETH/val), writing +5000 deviation to all 4 ops including removed op4.
3. Commit root with `effectiveBalance=96` (3x baseline).
4. Cluster balance is below the new liquidation threshold.

**Execution:**
1. Call `updateClusterBalance` with `effectiveBalance=96`.

**Assertions:**
- `_updateOperatorVUnits`: delta = ebToVUnits(96) - 15000 = 30000 - 15000 = 15000. Applied to all 4 ops.
- `operatorEthVUnits[op4]` now = 5000 + 15000 = 20000.
- Auto-liquidation triggers.
- `_executeLiquidation`: `vUnitsCluster = 30000`, `baseline = 10000`, `deviation = 20000`.
- Subtraction: `operatorEthVUnits[op4] -= 20000` -> back to 0 (clean).
- In this specific case, cleanup accidentally works because the total deviation written to removed op equals the total cleaned up.
- But if validator count changed between updates, this invariant breaks.

**Code path:** `SSVClusters.sol:494-510` -> `519-550` -> `567-596`.

---

### EB-058: Implicit Cluster First Explicit Update

**Goal:** Verify the transition from implicit EB (storedVUnits=0) to explicit EB on first `updateClusterBalance` call.

**Setup:**
1. Active ETH cluster, 4 ops, 3 validators, no prior EB update.
2. `clusterEB[clusterId].vUnits == 0`.
3. Commit root with `effectiveBalance=96` (32 ETH/val * 3 vals — baseline, no actual change).

**Execution:**
1. Call `updateClusterBalance` with `effectiveBalance=96`.

**Assertions:**
- `storedVUnits = 0` -> `effectiveOldVUnits = 3 * 10000 = 30000`.
- `newVUnits = ebToVUnits(96) = 30000`.
- `newVUnits == effectiveOldVUnits` -> NO call to `_updateOperatorVUnits` or `updateDAOEthVUnits`.
- `_updateEBSnapshot` called: `clusterEB[clusterId].vUnits = 30000` (now explicit).
- Future calls will use stored 30000, not fallback.
- `getVUnits(clusterId, 3)` now returns 30000 from storage instead of computing `3 * 10000`.

**Code path:** `SSVClusters.sol:388-392` (storedVUnits=0 branch) -> `400` (newVUnits == storedVUnits, condition false, skip) -> `404`.

---

### EB-060: EB Update on Liquidated ETH Cluster

**Goal:** Verify that updating EB on a liquidated cluster stores the snapshot but skips all fee settlement and deviation accounting.

**Setup:**
1. Liquidate an ETH cluster (4 ops, 1 val, had explicit EB=48 -> vUnits=15000).
2. `cluster.active == false`.
3. Commit a new root that includes this cluster with `effectiveBalance=64`.
   (Note: in production, oracle excludes liquidated clusters; this tests the code path if a proof exists.)

**Execution:**
1. Call `updateClusterBalance` with the liquidated cluster state and `effectiveBalance=64`.

**Assertions:**
- `cluster.active == false`.
- `_applyClusterFeeUpdates` NOT called (line 395-397: `if (cluster.active)`).
- `_updateOperatorVUnits` NOT called (line 400: `if (cluster.active && newVUnits != storedVUnits)`).
- `_updateEBSnapshot` IS called: `clusterEB[clusterId].vUnits = 20000`.
- `_liquidateAfterEBUpdateIfNeeded` returns `false` immediately (line 529: `!cluster.active`).
- No deviation changes to operators or DAO.
- `ClusterBalanceUpdated` event emitted.

**Code path:** `SSVClusters.sol:387` (VERSION_ETH) -> `395` (active=false, skip fees) -> `400` (active=false, skip deviation) -> `404` (snapshot updated) -> `406-409` (not liquidated, but `cluster.active==false` so `!liquidated && cluster.active` is false, skip store).

**Important subtlety:** Line 408-409: `if (!liquidated && cluster.active)` — since cluster is NOT active, the updated cluster hash is NOT stored. The cluster data remains in its liquidated state. Only the EB snapshot is updated.

---

### EB-063: Fee Settlement Uses OLD vUnits Before New Ones Applied

**Goal:** Verify the critical ordering: fees are settled with pre-update vUnits, then deviation is changed. This prevents retroactive fee changes.

**Setup:**
1. Active ETH cluster, 4 ops, 1 validator, explicit EB=48 (vUnits=15000).
2. Operator fees are 1000 wei/block each (packed). Network fee is 500 wei/block.
3. 100 blocks have elapsed since last cluster.index/networkFeeIndex update.
4. Commit new root with `effectiveBalance=64` (vUnits=20000).

**Execution:**
1. Call `updateClusterBalance`.

**Assertions:**
- `_applyClusterFeeUpdates` called with `oldVUnits=15000`.
- Fee calculation: `networkFeeUnits = (indexDelta * 15000) / 10000`, `operatorFeeUnits = (indexDelta * 15000) / 10000`.
- Total fee deducted from `cluster.balance` using the OLD 15000 vUnits.
- THEN `_updateOperatorVUnits` changes deviation: delta = 20000 - 15000 = 5000 per op.
- Future fee accrual will use 20000 vUnits (higher burn rate).
- The 100 blocks of historical fees are correctly charged at the 15000 rate, not the 20000 rate.

**Code path:** `SSVClusters.sol:396` (_applyClusterFeeUpdates with storedVUnits) -> `400-403` (_updateOperatorVUnits + updateDAOEthVUnits).

---

### EB-066: Auto-Liquidation Uses New vUnits for Threshold

**Goal:** Verify that the auto-liquidation check uses the NEW (post-update) vUnits for the liquidation threshold, not the old ones. This is by design: new vUnits are applied BEFORE the liquidation check.

**Setup:**
1. Active ETH cluster, 4 ops, 1 validator, implicit EB.
2. Balance is sufficient at 10000 vUnits but insufficient at 20000 vUnits.
3. Commit root with `effectiveBalance=64`.

**Execution:**
1. Call `updateClusterBalance` with `effectiveBalance=64`.

**Assertions:**
- Fees settled with old vUnits (10000).
- New vUnits (20000) applied to operators and DAO (line 400-403).
- EB snapshot stored with newVUnits=20000 (line 404).
- `_liquidateAfterEBUpdateIfNeeded` (line 406) calls `isLiquidatableWithEB` which calls `getVUnits`.
- `getVUnits` reads `clusterEB[clusterId].vUnits` which is now 20000 (just stored).
- Liquidation threshold doubles. Cluster is undercollateralized. Auto-liquidation executes.

**Code path:** `SSVClusters.sol:399-404` (apply new vUnits + store snapshot BEFORE liquidation check) -> `406` -> `531` (isLiquidatableWithEB reads stored vUnits).

---

### EB-067: Auto-Liquidation Deviation Cleanup — Multi-Operator

**Goal:** Verify that `_executeLiquidation` correctly removes deviation from all operators and DAO when triggered by an EB update on a 7-operator cluster.

**Setup:**
1. Active ETH cluster, 7 ops, 2 validators.
2. Previous EB update set vUnits=40000 (64 ETH/val). Baseline = 20000. Deviation = 20000.
3. Each of 7 operators has +20000 in `operatorEthVUnits`.
4. `daoTotalEthVUnits` includes +20000 for this cluster.
5. Now commit root with `effectiveBalance=256` (128 ETH/val).

**Execution:**
1. Call `updateClusterBalance` with `effectiveBalance=256`.

**Assertions:**
- `storedVUnits=40000`, `newVUnits=ebToVUnits(256)=80000`.
- `_updateOperatorVUnits`: delta=40000 applied to all 7 ops. Each now has 60000 deviation.
- `_updateEBSnapshot`: stored vUnits=80000.
- Auto-liquidation triggers.
- `_executeLiquidation`: `vUnitsCluster=80000`, `baseline=20000`, `deviation=60000`.
- For each of 7 operators: `operatorEthVUnits[opId] -= 60000`.
- `daoTotalEthVUnits -= 60000`.
- Post-liquidation: all operator deviations for this cluster are fully cleaned.

**Code path:** `SSVClusters.sol:494-510` -> `519-550` -> `570-596`.

---

### EB-077: Deviation Precision — Small EB Change 32->33

**Goal:** Verify ceiling division in `ebToVUnits` produces correct vUnits for non-aligned EB values and that the resulting deviation is precisely tracked.

**Setup:**
1. Active ETH cluster, 4 ops, 1 validator, implicit EB.
2. Commit root with `effectiveBalance=33`.

**Execution:**
1. Call `updateClusterBalance` with `effectiveBalance=33`.

**Assertions:**
- `ebToVUnits(33)`:
  - `vUnits = 33 * 10000 = 330000`
  - `vUnitsPerValidator = 32 ether / 1 ether = 32`
  - Result = `(330000 - 1) / 32 + 1 = 329999 / 32 + 1 = 10312 + 1 = 10313`
- `effectiveOldVUnits = 1 * 10000 = 10000`.
- Delta = 10313 - 10000 = 313 per operator.
- Each operator gets exactly +313 deviation.
- `daoTotalEthVUnits` increases by 313.
- Fee accrual going forward uses 10313 vUnits (3.13% higher than baseline).
- `vUnitsToEB(10313)`:
  - `(10313 * 32) / 10000 = 330016 / 10000 = 33` (floor division).
  - Round-trip: 33 ETH -> 10313 vUnits -> 33 ETH. Consistent.

**Code path:** `ClusterLib.sol:366-371` (ebToVUnits ceiling) -> `SSVClusters.sol:500-509` (deviation).

---

### EB-085: Two Clusters Share Operators — Deviation Stacking

**Goal:** Verify that when two clusters share some operators, deviation from both clusters correctly accumulates on shared operators.

**Setup:**
1. Register 6 operators (op1-op6).
2. Cluster A: ops [op1, op2, op3, op4], 1 validator.
3. Cluster B: ops [op3, op4, op5, op6], 1 validator.
4. Operators op3 and op4 are shared.
5. Commit root with cluster A at 48 ETH, cluster B at 64 ETH.

**Execution:**
1. `updateClusterBalance` for cluster A: `effectiveBalance=48`. Delta_A = 5000.
2. `updateClusterBalance` for cluster B: `effectiveBalance=64`. Delta_B = 10000.

**Assertions:**
- `operatorEthVUnits[op1] == 5000` (only cluster A).
- `operatorEthVUnits[op2] == 5000` (only cluster A).
- `operatorEthVUnits[op3] == 5000 + 10000 == 15000` (both clusters).
- `operatorEthVUnits[op4] == 5000 + 10000 == 15000` (both clusters).
- `operatorEthVUnits[op5] == 10000` (only cluster B).
- `operatorEthVUnits[op6] == 10000` (only cluster B).
- `daoTotalEthVUnits` increased by 5000 + 10000 = 15000 total.
- If cluster A is later liquidated, op3/op4 lose only 5000 (cluster A's deviation), retaining 10000 from cluster B.

**Code path:** Two independent calls to `SSVClusters.sol:494-510`. Operator storage is per-operator, not per-cluster, so deviations stack.

---

### EB-092: Deviation + Fee Settlement Interaction — Balance Correctness

**Goal:** Verify end-to-end balance correctness when an EB update settles fees at old rate and transitions to new rate, ensuring no ETH is lost or created.

**Setup:**
1. Active ETH cluster, 4 ops, 1 validator, explicit EB=48 (vUnits=15000).
2. Each operator: ethFee = 1_000_000_000 wei/block (packed: 10000).
3. Network fee: 500_000_000 wei/block (packed: 5000).
4. 200 blocks elapsed since last index update.
5. Initial cluster.balance = 10 ETH.
6. Commit root with `effectiveBalance=64` (vUnits=20000).

**Execution:**
1. Call `updateClusterBalance`.

**Assertions:**
- **Fee settlement (old vUnits = 15000):**
  - Operator index delta across 200 blocks = 200 * (10000 * 4) = 8_000_000 (packed).
  - Network fee index delta = 200 * 5000 = 1_000_000 (packed).
  - `operatorFeeUnits = (8_000_000 * 15000) / 10000 = 12_000_000_000`.
  - `networkFeeUnits = (1_000_000 * 15000) / 10000 = 1_500_000_000`.
  - `totalFees = (12_000_000_000 + 1_500_000_000) * 100_000 = 1.35 ETH`.
  - `cluster.balance = 10 ETH - 1.35 ETH = 8.65 ETH`.
- **Deviation update:**
  - Delta = 20000 - 15000 = 5000 per operator. Applied to storage.
  - No balance change during deviation update.
- **Future burn rate (post-update):**
  - Per block: `(burnRate + networkFee) * 20000 / 10000 * 100000` — 33% higher than before.
- **Balance is exactly 8.65 ETH** — no rounding loss beyond ETH_DEDUCTED_DIGITS precision.

**Code path:** `SSVClusters.sol:461-492` (_applyClusterFeeUpdates) -> `400-403` (deviation, no balance effect).

---

### EB-098: DAO Invariant Check — daoTotalEthVUnits Consistency

**Goal:** Verify the global invariant `daoTotalEthVUnits == ethDaoValidatorCount * BPS_DENOMINATOR + sum(all_cluster_deviations)` holds after a series of EB updates, liquidations, and reactivations.

**Setup:**
1. 3 clusters with different operator sets:
   - Cluster A: 4 ops, 2 vals, EB=64 (vUnits=20000, deviation=0).
   - Cluster B: 4 ops, 1 val, EB=48 (vUnits=15000, deviation=5000).
   - Cluster C: 7 ops, 3 vals, EB=128 (vUnits=40000, deviation=10000 — 128/3 vals = ~42.67 ETH/val).
2. `ethDaoValidatorCount = 6` (2+1+3).
3. Expected `daoTotalEthVUnits = 6 * 10000 + 0 + 5000 + 10000 = 75000`.

**Execution:**
1. Update cluster B EB to 32 (deviation -> 0). `daoTotalEthVUnits -= 5000 -> 70000`.
2. Liquidate cluster C. `_executeLiquidation` removes deviation 10000. `ethDaoValidatorCount -= 3 -> 3`. `daoTotalEthVUnits -= 10000 -> 60000`.
3. Expected: `daoTotalEthVUnits == 3 * 10000 + 0 + 0 = 30000`.
   Wait — DAO baseline is tracked via `ethDaoValidatorCount`, and `daoTotalEthVUnits` tracks only deviations? No: per SPEC, `daoTotalEthVUnits = ethDaoValidatorCount * BPS + sum(deviations)`. But `updateDAO(false, 3)` decrements `ethDaoValidatorCount` and also adjusts `daoTotalEthVUnits` by `3 * BPS = 30000`.

**Assertions:**
- After step 1: `daoTotalEthVUnits = 75000 - 5000 = 70000`. `ethDaoValidatorCount = 6`. Check: `6*10000 + 0 + 0 + 10000 = 70000`. Holds.
- After step 2: `ethDaoValidatorCount = 3`. `daoTotalEthVUnits = 70000 - 10000 (deviation) - 30000 (baseline via updateDAO) = 30000`. Check: `3*10000 + 0 + 0 = 30000`. Holds.
- Invariant maintained across all operations.

**Code path:** SPEC.md §2 "DAO vUnit Tracking", `SSVClusters.sol:402` (updateDAOEthVUnits), `562` (updateDAO in _executeLiquidation), `573-579` (deviation subtraction).

---

## Cross-Reference Index

| Bug/Feature | Related Scenarios |
|-------------|-------------------|
| RM1-* (removed operator vUnits bug) | EB-055, EB-056, EB-057, EB-069 |
| Auto-liquidation compound path | EB-051, EB-052, EB-066, EB-067, EB-068, EB-095 |
| Implicit->explicit EB transition | EB-031, EB-040, EB-044, EB-058, EB-082 |
| ebToVUnits precision/ceiling | EB-077, EB-078, EB-086, EB-087, EB-088, EB-089, EB-090, EB-091, EB-100 |
| DAO invariant | EB-054, EB-098 |
| Operator vUnits invariant | EB-053, EB-072-075, EB-085, EB-097, EB-099 |
| Fee settlement ordering | EB-063, EB-092 |
| Revert paths | EB-035, EB-036, EB-037, EB-038, EB-039, EB-045, EB-046, EB-047, EB-048, EB-065 |
| Liquidated cluster updates | EB-060, EB-094, EB-096 |
| SSV cluster EB snapshot | EB-061, EB-062 |

---

## Audit Gaps (Added post-audit)

> Identified by code-level branch analysis. These scenarios cover branches and edge conditions not addressed by the original EB-031 through EB-100 set.

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| EB-101 | updateClusterBalance | Fee settlement balance clamp: after `_applyClusterFeeUpdates`, cluster balance could theoretically underflow if fees exceed balance. Verify `updateBalanceWithEB` correctly clamps or reverts in this edge case. | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; revert:no` | [ ] | SSVClusters.sol:461-492, ClusterLib.sol:306-321 |
| EB-102 | _executeLiquidation | **CRITICAL**: Below-baseline deviation in `_executeLiquidation` — if `vUnitsCluster < validatorCount * BPS_DENOMINATOR` (theoretically unreachable due to `_verifyEBLimits` floor), the subtraction at line 575 would underflow. Verify the 32 ETH floor guarantee prevents this path. | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; revert:no` | [ ] | SSVClusters.sol:573-578 |
| EB-103 | _updateOperatorVUnits | `operatorEthVUnits` underflow: if a removed operator's `operatorEthVUnits[opId]` was deleted (set to 0) during `removeOperator`, but `_updateOperatorVUnits` attempts to subtract a negative delta, the subtraction underflows. Cross-ref with RM1 bug. | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:yes` | [ ] | SSVClusters.sol:494-510 |
| EB-104 | _liquidateAfterEBUpdateIfNeeded | Auto-liquidation with removed operator: verify `ethValidatorCount` check correctly handles operators where `ethValidatorCount` is already 0 (removed). The loop at lines 539-544 should skip decrement for removed ops. | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:539-544 |
| EB-105 | _liquidateAfterEBUpdateIfNeeded | `validatorCount == 0` active cluster: EB update on cluster with no validators but `active == true`. Verify `_liquidateAfterEBUpdateIfNeeded` returns false immediately (line 529). | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; revert:no` | [ ] | SSVClusters.sol:529 |
| EB-106 | liquidate | `cluster.balance == 0` liquidation: cluster whose balance is exactly zero after fee settlement. Third-party liquidation should succeed (balance < threshold). Verify bounty transfer is a no-op (0 ETH sent). | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; revert:no` | [ ] | SSVClusters.sol:599-609 |
| EB-107 | isLiquidatableWithEB | Collateral floor: cluster with zero burn rate (all operators free, no network fee) but balance below `minimumLiquidationCollateral`. Verify `isLiquidatableWithEB` returns true based on the absolute floor, not the burn-rate threshold. | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; revert:no` | [ ] | ClusterLib.sol:75-76 |
| EB-108 | updateClusterBalance | Frequency boundary: call `updateClusterBalance` at exactly `lastUpdateBlock + minBlocksBetweenUpdates` — should succeed (not revert `UpdateTooFrequent`). Boundary test for `>=` vs `>`. | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; revert:no` | [ ] | SSVClusters.sol:425-431 |
| EB-109 | updateClusterBalance | Staleness boundary: call with `blockNum == latestCommittedBlock` AND `blockNum > lastRootBlockNum` — should succeed. Verify the per-cluster staleness check is strictly `>`. | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; revert:no` | [ ] | SSVClusters.sol:434-443 |
| EB-110 | updateClusterBalance | Merkle proof: valid root but proof for a different cluster — revert `InvalidProof`. Verify proof validation rejects mismatched leaves. | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; revert:yes` | [ ] | SSVClusters.sol:445-451 |
| EB-111 | updateClusterBalance | Merkle proof: empty proof array with single-leaf root — verify proof validation handles this edge case. | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; revert:no` | [ ] | SSVClusters.sol:445-451 |
| EB-112 | updateClusterBalance | Non-existent cluster: call with operator IDs that have no registered cluster — revert `ClusterDoesNotExist`. | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:none; ops:4; revert:yes` | [ ] | ClusterLib.sol:141-142 |
| EB-113 | updateClusterBalance | Incorrect cluster state: call with stale cluster struct (wrong balance/validatorCount) — revert `IncorrectClusterState`. | `entry:updateClusterBalance; version:eth; eb:implicit; cluster:active; ops:4; revert:yes` | [ ] | ClusterLib.sol:143-145 |

---

## ask-codex Review Findings

### Corrections

- **EB-065**: Marked as revert but SSVClusters.sol:453 only reverts when effectiveBalance is outside [0,0]. With validatorCount==0 && effectiveBalance==0, verification succeeds and short-circuits at SSVClusters.sol:529. Fix to mark as success/short-circuit.

### Additional Scenarios

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| EB-114 | _updateOperatorVUnits | Removed operator with cluster still referencing it + EB decrease → subtraction at SSVClusters.sol:508 can underflow/revert. Negative-delta branch for removed operators. | `entry:updateClusterEB; revert:yes` | [ ] | SSVClusters.sol:508 |
| EB-115 | _liquidateAfterEBUpdateIfNeeded | Removed-operator skip: live operators take decrement at SSVClusters.sol:542, removed operators skip via guard at :541. Explicit test of the skip branch. | `entry:updateClusterEB; revert:no` | [ ] | SSVClusters.sol:541-542 |
| EB-116 | _executeLiquidation | Explicit-baseline no-cleanup: ebSnapshot.vUnits is explicit but equals baseline → enter SSVClusters.sol:569 but skip deviation cleanup at :573. | `entry:executeLiquidation; revert:no` | [ ] | SSVClusters.sol:569, 573 |
| EB-117 | updateClusterEB | Inactive cluster first-update: storedVUnits==0 falls back at SSVClusters.sol:390. Tests the implicit-to-explicit initialization for an inactive cluster. | `entry:updateClusterEB; revert:no` | [ ] | SSVClusters.sol:390 |
| EB-118 | updateClusterEB | Inactive/liquidated SSV cluster: snapshot-only branch at SSVClusters.sol:411. Tests SSV cluster EB update skips fee-related calculations. | `entry:updateClusterEB; revert:no` | [ ] | SSVClusters.sol:411 |
| EB-119 | _executeLiquidation | Zero-payout auto-liquidation: balanceLiquidatable==0 → transfer at SSVClusters.sol:607 is skipped. | `entry:executeLiquidation; revert:no` | [ ] | SSVClusters.sol:607 |
