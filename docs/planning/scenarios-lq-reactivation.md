# Scenarios — Liquidation & Reactivation (LQ-001 to LQ-080)

**Prefix:** LQ
**Worker:** W1-I
**Source contracts:** `SSVClusters.sol` (liquidate, liquidateSSV, reactivate, _executeLiquidation, _liquidateAfterEBUpdateIfNeeded), `ClusterLib.sol` (isLiquidatable, isLiquidatableWithEB, isLiquidatableWithVUnits), `OperatorLib.sol` (updateClusterOperatorsOnReactivation)
**Spec refs:** SPEC §1 "Cluster Flows", SPEC §2 "Effective Balance Accounting" (Stale EB Risk on Reactivation, Operator vUnit Deviation Cleanup on Liquidation), FLOWS §1.9 (Liquidate ETH), §1.10 (Liquidate SSV Legacy), §1.11 (Reactivate)

---

## Liquidation ETH (LQ-001 to LQ-035)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| LQ-001 | liquidate | Third-party liquidation at exact threshold boundary — balance equals burn-rate threshold exactly; should succeed | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:31-65, ClusterLib.sol:67-84 |
| LQ-002 | liquidate | Third-party liquidation just above threshold — balance 1 wei above burn-rate threshold; must revert ClusterNotLiquidatable | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | | SSVClusters.sol:51-62 |
| LQ-003 | liquidate | Third-party liquidation just below threshold — balance 1 wei below burn-rate threshold; should succeed | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:51-62, ClusterLib.sol:67-84 |
| LQ-004 | liquidate | Liquidate cluster with balance = 0 (fully drained); bounty transfer is zero, no ETH sent | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:599-609 |
| LQ-005 | liquidate | Self-liquidation by cluster owner — always allowed regardless of solvency; cluster above threshold | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:52 |
| LQ-006 | liquidate | Self-liquidation with balance = 0 — owner liquidates own drained cluster | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:52, 599-609 |
| LQ-007 | liquidate | Liquidate with 7 operators — verify all 7 operators' ethValidatorCount decremented | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:7; remove_mode:none; revert:no` | | SSVClusters.sol:41-47, OperatorLib.sol:233-262 |
| LQ-008 | liquidate | Liquidate with 10 operators — verify all 10 operators' ethValidatorCount decremented | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:10; remove_mode:none; revert:no` | | SSVClusters.sol:41-47, OperatorLib.sol:233-262 |
| LQ-009 | liquidate | Liquidate with 13 operators — verify all 13 operators' ethValidatorCount decremented | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:13; remove_mode:none; revert:no` | | SSVClusters.sol:41-47, OperatorLib.sol:233-262 |
| LQ-010 | liquidate | Verify ethValidatorCount decremented for each operator after liquidation (4 ops, validatorCount=5) | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | OperatorLib.sol:255, SSVClusters.sol:41-47 |
| LQ-011 | liquidate | Verify daoTotalEthVUnits decremented correctly for implicit EB cluster — only baseline removal via ethDaoValidatorCount | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:562, 569-597 |
| LQ-012 | liquidate | Verify cluster.active = false after liquidation | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:601 |
| LQ-013 | liquidate | Verify cluster.balance = 0 after liquidation | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:600 |
| LQ-014 | liquidate | Verify cluster.index = 0 and cluster.networkFeeIndex = 0 after liquidation | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:602-603 |
| LQ-015 | liquidate | Verify liquidation bounty (remaining balance) transferred to liquidator (third party) | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:607-609 |
| LQ-016 | liquidate | Liquidation with explicit EB (deviation > 0) — verify operatorEthVUnits deviation cleanup per operator | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:564-596 |
| LQ-017 | liquidate | Liquidation with explicit EB at baseline (vUnits == validatorCount * BPS) — no deviation to clean up | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:573-594 |
| LQ-018 | liquidate | Liquidation with explicit EB — verify daoTotalEthVUnits decremented by deviation amount | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:578 |
| LQ-019 | liquidate | Liquidation with one removed operator (ethSnapshot.block == 0) — removed op skipped in updateClusterOperators, no ethValidatorCount decrement for it | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | | OperatorLib.sol:247, SSVClusters.sol:41-47 |
| LQ-020 | liquidate | Liquidation with one removed operator + explicit EB — verify deviation cleanup still applies to remaining operators | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | | SSVClusters.sol:586-592 |
| LQ-021 | liquidate | Liquidation where balance < minimumLiquidationCollateral (absolute floor check) | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | ClusterLib.sol:76 |
| LQ-022 | liquidate | Third-party liquidation where minimumLiquidationCollateral > burn-rate threshold — collateral floor is binding constraint | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | ClusterLib.sol:76, 81-83 |
| LQ-023 | liquidate | Liquidation attempt on already-liquidated cluster — must revert ClusterIsLiquidated | `entry:liquidate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:yes` | | SSVClusters.sol:36, ClusterLib.sol:118-120 |
| LQ-024 | liquidate | Liquidation attempt on cluster with validatorCount = 0 — isLiquidatableWithEB returns false (short-circuit); third-party revert | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | | ClusterLib.sol:75 |
| LQ-025 | liquidate | Self-liquidation on cluster with validatorCount = 0 — bypasses liquidation check; succeeds | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:52 |
| LQ-026 | liquidate | ClusterLiquidated event emitted with correct owner, operatorIds, and zeroed cluster state | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:611 |
| LQ-027 | liquidate | Liquidation with multiple validators (validatorCount=10) — verify daoTotalEthVUnits and ethDaoValidatorCount both decremented by 10 | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:562 |
| LQ-028 | _liquidateAfterEBUpdateIfNeeded | Auto-liquidation triggered by updateClusterBalance when EB increase makes cluster undercollateralized | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:519-550, 406 |
| LQ-029 | _liquidateAfterEBUpdateIfNeeded | Auto-liquidation: ethValidatorCount decremented for active operators inside _liquidateAfterEBUpdateIfNeeded before calling _executeLiquidation | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:539-544 |
| LQ-030 | _liquidateAfterEBUpdateIfNeeded | No auto-liquidation when cluster remains solvent after EB update — returns false, cluster hash stored normally | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:408-409, 547-549 |
| LQ-031 | _liquidateAfterEBUpdateIfNeeded | Auto-liquidation skipped for cluster with validatorCount = 0 — returns false immediately | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:529 |
| LQ-032 | liquidate | Liquidation with explicit EB — threshold computed using vUnits (not validatorCount) via isLiquidatableWithEB | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | | ClusterLib.sol:78-83 |
| LQ-033 | liquidate | Reentrancy guard — liquidate is nonReentrant; reentrant call must revert | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | | SSVClusters.sol:31 |
| LQ-034 | liquidate | Liquidation on cluster with very high explicit EB (2048 ETH per validator) — very large burn-rate threshold; verify arithmetic precision | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | | ClusterLib.sol:78-83 |
| LQ-035 | liquidate | Self-liquidation bounty goes to msg.sender (owner is also liquidator) | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:64, 607-609 |

---

## Liquidation SSV (LQ-036 to LQ-050)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| LQ-036 | liquidateSSV | Third-party SSV liquidation at exact threshold — balance equals SSV burn-rate threshold; should succeed | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:70-124, ClusterLib.sol:40-55 |
| LQ-037 | liquidateSSV | Third-party SSV liquidation just above threshold — must revert ClusterNotLiquidatable | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | | SSVClusters.sol:95-105 |
| LQ-038 | liquidateSSV | Third-party SSV liquidation just below threshold — should succeed | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:95-105, ClusterLib.sol:40-55 |
| LQ-039 | liquidateSSV | Self-SSV-liquidation — always allowed; owner bypasses isLiquidatable check | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:95 |
| LQ-040 | liquidateSSV | SSV liquidation with balance = 0 — no token transfer; balanceLiquidatable = 0 | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:109-112, 119-121 |
| LQ-041 | liquidateSSV | Verify SSV cluster state reset: active=false, balance=0, index=0, networkFeeIndex=0 | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:113-116 |
| LQ-042 | liquidateSSV | Verify SSV DAO accounting: updateDAOSSV(false, validatorCount) decrements daoValidatorCount | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:107 |
| LQ-043 | liquidateSSV | Verify SSV operator validatorCount decremented via updateClusterOperatorsSSV | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:7; remove_mode:none; revert:no` | | OperatorLib.sol:396-423, SSVClusters.sol:83-89 |
| LQ-044 | liquidateSSV | SSV liquidation bounty transferred as SSV token to msg.sender (CoreLib.transferTokenBalance) | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:119-121 |
| LQ-045 | liquidateSSV | SSV liquidation on already-liquidated cluster — must revert ClusterIsLiquidated | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:yes` | | SSVClusters.sol:79, ClusterLib.sol:118-120 |
| LQ-046 | liquidateSSV | SSV liquidation uses isLiquidatable (not isLiquidatableWithEB) — validatorCount-based threshold, not vUnit-based | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:97-101, ClusterLib.sol:40-55 |
| LQ-047 | liquidateSSV | SSV liquidation with minimumLiquidationCollateralSSV as binding floor — balance above burn-rate threshold but below collateral floor | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | | ClusterLib.sol:48 |
| LQ-048 | liquidateSSV | SSV liquidation with validatorCount = 0 — isLiquidatable returns false; third-party revert | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | | ClusterLib.sol:47 |
| LQ-049 | liquidateSSV | SSV liquidation attempt on ETH cluster — must revert IncorrectClusterVersion (VERSION_ETH != VERSION_SSV) | `entry:liquidateSSV; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | | SSVClusters.sol:78, ClusterLib.sol:328-330 |
| LQ-050 | liquidateSSV | ETH liquidation attempt on SSV cluster — must revert IncorrectClusterVersion (VERSION_SSV != VERSION_ETH) | `entry:liquidate; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | | SSVClusters.sol:35, ClusterLib.sol:328-330 |

---

## Reactivation (LQ-051 to LQ-080)

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| LQ-051 | reactivate | Reactivate with sufficient msg.value — cluster becomes active, balance = msg.value | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:129-181 |
| LQ-052 | reactivate | Reactivate with insufficient msg.value — must revert InsufficientBalance (fails isLiquidatableWithVUnits) | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:yes` | | SSVClusters.sol:161-171 |
| LQ-053 | reactivate | Reactivate with msg.value exactly at threshold boundary — balance equals solvency threshold; should succeed | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:161-171, ClusterLib.sol:96-112 |
| LQ-054 | reactivate | Reactivate with msg.value 1 wei below threshold — must revert InsufficientBalance | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:yes` | | SSVClusters.sol:161-171 |
| LQ-055 | reactivate | Reactivate already-active cluster — must revert ClusterAlreadyEnabled | `entry:reactivate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | | SSVClusters.sol:137 |
| LQ-056 | reactivate | Verify cluster state after reactivation: active=true, index=current, networkFeeIndex=current | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:157-159 |
| LQ-057 | reactivate | Verify ethValidatorCount incremented for each operator on reactivation | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | OperatorLib.sol:321 |
| LQ-058 | reactivate | Verify daoTotalEthVUnits and ethDaoValidatorCount incremented on reactivation (updateDAO(true, validatorCount)) | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:173 |
| LQ-059 | reactivate | Reactivate with 7 operators — verify all 7 operators updated | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:7; remove_mode:none; revert:no` | | OperatorLib.sol:275-330 |
| LQ-060 | reactivate | Reactivate with 10 operators | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:10; remove_mode:none; revert:no` | | OperatorLib.sol:275-330 |
| LQ-061 | reactivate | Reactivate with 13 operators | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:13; remove_mode:none; revert:no` | | OperatorLib.sol:275-330 |
| LQ-062 | reactivate | Reactivate with one removed operator — removed op skipped (ethSnapshot.block == 0), ethValidatorCount not incremented for it, fee excluded | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | | OperatorLib.sol:291, 321-327 |
| LQ-063 | reactivate | Reactivate with ALL operators removed — all ops skipped; cumulativeFee = 0, cumulativeIndex from preserved indexes only; solvency check should pass trivially | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | | OperatorLib.sol:291 |
| LQ-064 | reactivate | Reactivate with explicit EB (deviation > 0) — verify clusterDeviation added to operatorEthVUnits for each active operator | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:142-145, OperatorLib.sol:312-319, SSVClusters.sol:174-176 |
| LQ-065 | reactivate | Reactivate with explicit EB — verify daoTotalEthVUnits incremented by clusterDeviation | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:174-176 |
| LQ-066 | reactivate | Reactivate with explicit EB at baseline (vUnits == validatorCount * BPS) — deviation = 0, no extra accounting | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:145 |
| LQ-067 | reactivate | Reactivate with implicit EB (vUnitsCluster == 0) — effectiveVUnits = baselineVUnits, clusterDeviation = 0 | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:144 |
| LQ-068 | reactivate | Solvency check uses isLiquidatableWithVUnits (not isLiquidatableWithEB) — uses effectiveVUnits directly, not storage lookup | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:162-171, ClusterLib.sol:96-112 |
| LQ-069 | reactivate | Reactivate then immediately liquidate — reactivate succeeds, advance blocks until below threshold, liquidate succeeds | `entry:reactivate+liquidate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:129-181, 31-65 |
| LQ-070 | reactivate | Reactivate then deposit — cluster balance accumulates correctly (balance = msg.value_reactivate + msg.value_deposit) | `entry:reactivate+deposit; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:156, 186-201 |
| LQ-071 | reactivate | Reactivate with prior deposit on liquidated cluster — balance = prior_deposit + msg.value (deposit is additive) | `entry:deposit+reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:156 |
| LQ-072 | reactivate | Reactivate twice (already reactivated) — second call must revert ClusterAlreadyEnabled | `entry:reactivate; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | | SSVClusters.sol:137 |
| LQ-073 | reactivate | ClusterReactivated event emitted with correct owner, operatorIds, and updated cluster state | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:180 |
| LQ-074 | reactivate | Reactivate with stale EB snapshot (EB increased off-chain during liquidation) — passes solvency with less ETH than real EB requires; auto-liquidation risk on next updateClusterBalance | `entry:reactivate+updateClusterBalance; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | SSVClusters.sol:142-144, SPEC §2 "Stale EB Risk" |
| LQ-075 | reactivate | Reactivate with stale EB snapshot (EB decreased off-chain during liquidation / slashing) — owner overfunds but reactivation succeeds | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | SPEC §2 "Stale EB Risk" |
| LQ-076 | reactivate | Reactivate with removed operator + explicit EB deviation — deviation added only to active operators' operatorEthVUnits | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | | OperatorLib.sol:291, 312-319 |
| LQ-077 | reactivate | Reactivation reentrancy guard — reactivate is nonReentrant; reentrant call must revert | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:yes` | | SSVClusters.sol:132 |
| LQ-078 | reactivate | Reactivation by non-owner — must revert (validateHashedCluster uses msg.sender as owner) | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:yes` | | SSVClusters.sol:135, ClusterLib.sol:131-148 |
| LQ-079 | reactivate | Reactivation with very high explicit EB (2048 ETH/validator) — large effectiveVUnits = 640000; verify solvency threshold calculation precision | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | | ClusterLib.sol:96-112 |
| LQ-080 | reactivate | Reactivation exceeding validatorsPerOperatorLimit — ethValidatorCount increment would exceed limit; must revert ExceedValidatorLimitWithData | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:yes` | | OperatorLib.sol:322-324 |

---

## Detailed Scenario Blocks (15 Most Complex)

### LQ-001: Third-party liquidation at exact threshold boundary

**Setup:**
1. Register 4 operators with known ethFee values (e.g., 1,770,000,000 packed each).
2. Register cluster with validatorCount = 1, implicit EB (32 ETH).
3. Compute exact threshold: `threshold = (minimumBlocksBeforeLiquidation * (4 * operatorFee + networkFee) * 10000) / 10000 * ETH_DEDUCTED_DIGITS`.
4. Advance blocks until cluster balance = threshold exactly.

**Execution:**
- Third-party calls `liquidate(owner, operatorIds, cluster)`.

**Assertions:**
- Transaction succeeds (does NOT revert `ClusterNotLiquidatable`).
- `cluster.active == false`.
- `cluster.balance == 0`.
- Liquidator receives the remaining balance as ETH.
- `ethDaoValidatorCount` decremented by `cluster.validatorCount`.
- Each operator's `ethValidatorCount` decremented by `cluster.validatorCount`.
- `ClusterLiquidated` event emitted.

**Edge detail:** `isLiquidatableWithEB` uses `<` comparison (`cluster.balance < liquidationThreshold`), so balance == threshold means NOT liquidatable. However, after `updateClusterData` settles fees, the balance will be exactly at threshold or slightly below depending on block advancement. The precise boundary depends on whether fee settlement reduces balance to below threshold.

---

### LQ-005: Self-liquidation above threshold

**Setup:**
1. Register 4 operators and cluster with validatorCount = 1.
2. Deposit generous ETH so cluster is well above liquidation threshold.
3. Confirm cluster is NOT liquidatable via view function.

**Execution:**
- Owner calls `liquidate(owner, operatorIds, cluster)` (self-liquidation).

**Assertions:**
- Transaction succeeds — self-liquidation bypasses `isLiquidatableWithEB` check (line 52: `clusterOwner != msg.sender`).
- Owner (liquidator) receives own remaining balance back.
- Cluster state zeroed.
- `ethDaoValidatorCount` and operator counts decremented.

**Why complex:** Demonstrates the intentional self-destruct path. Owner may use this to efficiently withdraw all remaining balance in a single transaction rather than `withdraw` + separate cleanup.

---

### LQ-016: Liquidation with explicit EB deviation cleanup

**Setup:**
1. Register 4 operators and cluster with validatorCount = 2.
2. Call `updateClusterBalance` with effectiveBalance = 128 (64 ETH/validator) creating explicit EB.
3. Stored vUnits = `ebToVUnits(128)` = 40000. Baseline = 2 * 10000 = 20000. Deviation = 20000.
4. Verify each operator's `operatorEthVUnits` includes +20000 deviation.
5. Verify `daoTotalEthVUnits` includes +20000 deviation.
6. Drain cluster balance until liquidatable.

**Execution:**
- Third-party calls `liquidate(owner, operatorIds, cluster)`.

**Assertions:**
- `_executeLiquidation` detects `vUnitsCluster = 40000 > 0`.
- Computes deviation = 40000 - 20000 = 20000.
- Each operator's `operatorEthVUnits` decremented by 20000.
- `daoTotalEthVUnits` decremented by 20000.
- Baseline removal via `ethValidatorCount -= 2` for each operator (done in `updateClusterOperators`).
- Net effect: all EB accounting fully unwound.

---

### LQ-019: Liquidation with removed operator

**Setup:**
1. Register 4 operators [1, 2, 3, 4] and cluster with validatorCount = 1.
2. Remove operator 3 via `removeOperator(3)` — sets `ethSnapshot.block = 0`.
3. Drain cluster balance to below threshold.

**Execution:**
- Third-party calls `liquidate(owner, operatorIds, cluster)`.

**Assertions:**
- In `updateClusterOperators`: operator 3 is skipped (`ethSnapshot.block == 0`), its `ethValidatorCount` NOT decremented, its fee NOT included in `cumulativeFee`.
- However, operator 3's preserved `ethSnapshot.index` IS still added to `cumulativeIndex`.
- Remaining operators (1, 2, 4) have `ethValidatorCount` decremented normally.
- In `_executeLiquidation`: deviation cleanup still iterates all 4 operators — if explicit EB, operator 3's `operatorEthVUnits` is also cleaned up.
- Burn rate used for `isLiquidatableWithEB` excludes removed operator's fee.

**Cross-ref:** RM2-* scenarios cover removed operator variants in detail.

---

### LQ-028: Auto-liquidation via updateClusterBalance

**Setup:**
1. Register 4 operators and cluster with validatorCount = 1, implicit EB.
2. Fund cluster with enough ETH to be solvent at 32 ETH EB.
3. Commit oracle root with effectiveBalance = 128 (64 ETH/validator) via 3-of-4 quorum.
4. Cluster's burn rate effectively quadruples. Current balance may no longer cover threshold at new vUnits.

**Execution:**
- Anyone calls `updateClusterBalance(blockNum, owner, operatorIds, cluster, 128, merkleProof)`.

**Assertions:**
- `_applyClusterFeeUpdates` settles fees using OLD vUnits (storedVUnits before update).
- `_updateOperatorVUnits` applies new vUnits to each operator.
- `sp.updateDAOEthVUnits` updates DAO deviation.
- `_updateEBSnapshot` writes new vUnits to storage.
- `_liquidateAfterEBUpdateIfNeeded` checks solvency with NEW vUnits via `isLiquidatableWithEB`.
- If balance < new threshold: auto-liquidation fires.
- `ethValidatorCount` decremented inside `_liquidateAfterEBUpdateIfNeeded` (lines 539-544) BEFORE `_executeLiquidation`.
- `_executeLiquidation` handles deviation cleanup and balance transfer.
- `ClusterBalanceUpdated` event emitted AFTER liquidation (line 416).
- `ClusterLiquidated` event also emitted.

**Why complex:** Two-phase operator decrement (first in `_liquidateAfterEBUpdateIfNeeded`, then baseline in `_executeLiquidation` via `updateDAO`). vUnit accounting applies BEFORE liquidation check, ensuring the auto-liquidation uses the correct new threshold.

---

### LQ-032: Liquidation threshold uses vUnits not validatorCount

**Setup:**
1. Register 4 operators and cluster with validatorCount = 1.
2. Call `updateClusterBalance` with effectiveBalance = 64 (64 ETH for 1 validator).
3. vUnits = `ebToVUnits(64)` = 20000 (2x baseline of 10000).
4. Threshold is now 2x what it would be with implicit EB.
5. Fund cluster to be above the implicit threshold but below the explicit threshold.

**Execution:**
- Third-party calls `liquidate(owner, operatorIds, cluster)`.

**Assertions:**
- `isLiquidatableWithEB` reads vUnits from `getVUnits` which returns 20000 (not 10000).
- Threshold = `(minimumBlocksBeforeLiquidation * (burnRate + networkFee) * 20000) / 10000 * ETH_DEDUCTED_DIGITS`.
- Cluster IS liquidatable because balance < this higher threshold.
- If we had used validatorCount-based threshold (implicit), cluster would NOT be liquidatable.

**Why complex:** Validates that the EB-aware threshold correctly scales with actual effective balance, not just validator count.

---

### LQ-046: SSV liquidation uses validatorCount-based threshold

**Setup:**
1. Register 4 operators with SSV fees and cluster (SSV version).
2. Call `updateClusterBalance` with explicit EB to set vUnits > baseline.
3. Drain SSV balance to just below the validatorCount-based threshold but above what vUnit-based threshold would be.

**Execution:**
- Third-party calls `liquidateSSV(owner, operatorIds, cluster)`.

**Assertions:**
- `isLiquidatable` (NOT `isLiquidatableWithEB`) is used — line 97-101.
- Threshold = `minimumBlocksBeforeLiquidation * (burnRate + networkFee) * validatorCount`.
- No vUnit scaling — SSV liquidation does not use EB.
- Liquidation succeeds based on validatorCount-based math.

---

### LQ-062: Reactivation with removed operator

**Setup:**
1. Register 4 operators [1, 2, 3, 4] and cluster with validatorCount = 2.
2. Liquidate the cluster (via self-liquidation or time-based).
3. Remove operator 3 via `removeOperator(3)`.
4. Confirm operator 3 has `ethSnapshot.block == 0`.

**Execution:**
- Owner calls `reactivate(operatorIds, cluster)` with sufficient msg.value.

**Assertions:**
- `updateClusterOperatorsOnReactivation` iterates all 4 operators.
- Operator 3 (`ethSnapshot.block == 0`): skipped entirely — no snapshot update, no ethValidatorCount increment, fee NOT included in cumulativeFee, but preserved index IS added to cumulativeIndex (line 328).
- Operators 1, 2, 4: snapshot updated, `ethValidatorCount += 2`, fee included.
- Solvency check via `isLiquidatableWithVUnits` uses burnRate from only 3 active operators.
- Cluster operates with reduced operator coverage (3/4 active).
- If clusterDeviation > 0: deviation added only to operators with `ethSnapshot.block != 0` (line 312-319).

---

### LQ-063: Reactivation with ALL operators removed

**Setup:**
1. Register 4 operators and cluster with validatorCount = 1.
2. Liquidate the cluster.
3. Remove ALL 4 operators via `removeOperator`.
4. All operators have `ethSnapshot.block == 0`.

**Execution:**
- Owner calls `reactivate(operatorIds, cluster)` with msg.value = 1 ETH.

**Assertions:**
- `updateClusterOperatorsOnReactivation`: ALL operators skipped.
- `cumulativeFee = 0`, `cumulativeIndex` = sum of preserved indexes.
- `burnRate = 0` in solvency check.
- `isLiquidatableWithVUnits`: with burnRate = 0 and networkFee = 0 (if also zero), threshold = 0, so any balance passes.
- If networkFee > 0: threshold = `minimumBlocksBeforeLiquidation * networkFee * vUnits / BPS_DENOMINATOR * ETH_DEDUCTED_DIGITS`. Solvency depends on msg.value vs this threshold.
- `updateDAO(true, validatorCount)` still increments `ethDaoValidatorCount`.
- Cluster is technically active but with zero active operator coverage.

**Why complex:** Edge case where the cluster reactivates into a degraded state. The validator continues to exist on beacon chain but has no active SSV operators running duties.

---

### LQ-064: Reactivation with explicit EB deviation re-accounting

**Setup:**
1. Register 4 operators and cluster with validatorCount = 1.
2. Call `updateClusterBalance` to set explicit EB = 64 ETH (vUnits = 20000).
3. Baseline = 10000. Deviation = 10000.
4. Liquidate the cluster — `_executeLiquidation` removes deviation from operators and DAO.
5. Verify post-liquidation: `operatorEthVUnits` for each op decreased by 10000, `daoTotalEthVUnits` decreased by 10000.

**Execution:**
- Owner calls `reactivate(operatorIds, cluster)` with sufficient msg.value.

**Assertions:**
- `vUnitsCluster = seb.clusterEB[hashedCluster].vUnits` = 20000 (EB snapshot persists across liquidation).
- `baselineVUnits = 1 * 10000 = 10000`.
- `effectiveVUnits = 20000` (vUnitsCluster > 0 so used directly).
- `clusterDeviation = 20000 - 10000 = 10000`.
- `updateClusterOperatorsOnReactivation`: each operator's `operatorEthVUnits += 10000`.
- After loop: `sp.daoTotalEthVUnits += 10000` (line 175).
- Solvency check uses `effectiveVUnits = 20000` (higher threshold than implicit).
- Net effect: deviation accounting fully restored to pre-liquidation state.

---

### LQ-069: Reactivate then immediately liquidate

**Setup:**
1. Register 4 operators and cluster with validatorCount = 1.
2. Liquidate the cluster.
3. Compute exact minimum deposit for reactivation.

**Execution:**
1. Owner calls `reactivate(operatorIds, cluster)` with msg.value = exact threshold.
2. Advance blocks so balance drops below threshold.
3. Third-party calls `liquidate(owner, operatorIds, cluster)`.

**Assertions:**
- Reactivation succeeds (balance >= threshold at that block).
- After block advancement, fee settlement reduces balance below threshold.
- Second liquidation succeeds.
- Full round-trip: operator counts go -N (liquidate) → +N (reactivate) → -N (liquidate again).
- DAO accounting: -N → +N → -N (net: -N from original).
- Cluster ends in liquidated state again.
- Owner recovers remaining balance as liquidation bounty (self-liquidation) or third-party receives it.

---

### LQ-071: Reactivation with prior deposit on liquidated cluster

**Setup:**
1. Register 4 operators and cluster with validatorCount = 1.
2. Liquidate the cluster.
3. Call `deposit(owner, operatorIds, cluster)` with 0.5 ETH to pre-fund.
4. Note: deposit on liquidated cluster succeeds (no active check in deposit).

**Execution:**
- Owner calls `reactivate(operatorIds, cluster)` with msg.value = 0.5 ETH.

**Assertions:**
- `cluster.balance += msg.value` at line 156 adds to EXISTING balance.
- But wait: liquidation set `cluster.balance = 0`. The deposit AFTER liquidation changed the stored cluster hash. So the cluster passed to reactivate must reflect balance = 0.5 ETH (from deposit).
- After reactivation: `cluster.balance = 0.5 + 0.5 = 1.0 ETH`.
- Solvency check uses this combined balance.
- If 1.0 ETH passes threshold: reactivation succeeds.

**Why complex:** Tests that deposits accumulate on liquidated clusters and the reactivation msg.value is additive, not replacing.

---

### LQ-074: Stale EB risk — reactivation with increased off-chain EB

**Setup:**
1. Register 4 operators and cluster with validatorCount = 1.
2. Set explicit EB = 32 ETH (vUnits = 10000) via `updateClusterBalance`.
3. Liquidate the cluster.
4. Off-chain, validator consolidates to 64 ETH effective balance.
5. On-chain EB snapshot still shows vUnits = 10000 (stale — liquidated clusters excluded from oracle roots).

**Execution:**
1. Owner calls `reactivate(operatorIds, cluster)` with enough ETH for the 32 ETH threshold.
2. Oracle commits new root including this now-active cluster with EB = 64.
3. Someone calls `updateClusterBalance` with effectiveBalance = 64.

**Assertions:**
- Reactivation succeeds: solvency check uses stale vUnits = 10000 → lower threshold.
- After `updateClusterBalance`: vUnits updated to 20000, threshold doubles.
- If owner only funded for 10000 vUnits: `_liquidateAfterEBUpdateIfNeeded` triggers auto-liquidation.
- Cluster liquidated again in same `updateClusterBalance` call.
- This is the "stale EB risk" documented in SPEC §2.

**Mitigation awareness:** Off-chain tooling should use beacon-chain EB to compute deposit, not stale on-chain snapshot.

---

### LQ-076: Reactivation with removed operator + explicit EB deviation

**Setup:**
1. Register 4 operators [1, 2, 3, 4] and cluster with validatorCount = 1.
2. Set explicit EB = 64 ETH (vUnits = 20000, deviation = 10000).
3. Liquidate → deviation cleaned up from all 4 operators and DAO.
4. Remove operator 3 (`ethSnapshot.block = 0`).

**Execution:**
- Owner calls `reactivate(operatorIds, cluster)` with sufficient msg.value.

**Assertions:**
- `clusterDeviation = 10000` (from stored vUnits 20000 - baseline 10000).
- `updateClusterOperatorsOnReactivation` loop:
  - Operators 1, 2, 4 (`ethSnapshot.block != 0`): snapshot updated, `ethValidatorCount += 1`, `operatorEthVUnits += 10000` (line 315).
  - Operator 3 (`ethSnapshot.block == 0`): SKIPPED entirely — no deviation added, no ethValidatorCount increment.
- After loop: `sp.daoTotalEthVUnits += 10000` (line 175) — DAO gets full deviation.
- Asymmetry: DAO has full deviation but only 3 operators carry it. Operator 3's share is effectively orphaned.
- Solvency check uses `effectiveVUnits = 20000` but `burnRate` excludes operator 3's fee.

**Why complex:** Reveals a potential accounting asymmetry between per-operator deviation and DAO-level deviation when operators are removed during liquidation. The DAO deviation is restored in full, but only 3 operators carry the per-operator share.

---

### LQ-080: Reactivation exceeding validatorsPerOperatorLimit

**Setup:**
1. Register 4 operators, each already carrying (validatorsPerOperatorLimit - 1) validators from other clusters.
2. Register a cluster with validatorCount = 2 on these operators.
3. Liquidate the cluster — `ethValidatorCount -= 2` for each operator.
4. Register 2 more validators on each operator from other clusters (now back at limit - 1 + 2 = limit + 1... adjust: register exactly enough so that +2 from reactivation would exceed limit).

**Execution:**
- Owner calls `reactivate(operatorIds, cluster)` with sufficient msg.value.

**Assertions:**
- In `updateClusterOperatorsOnReactivation`, `operator.ethValidatorCount += validatorCount` (line 321).
- If new count > `sp.validatorsPerOperatorLimit`: revert `ExceedValidatorLimitWithData(operatorId)` (line 322-324).
- Reactivation blocked even with sufficient funds.

**Why complex:** Shows that reactivation is not just about funding — operator capacity constraints are enforced. A cluster liquidated and later attempted to reactivate may find its operators are now full from other clusters.

---

## Audit Gaps (Added post-audit)

> Identified by code-level branch analysis. These scenarios cover branches and edge conditions not addressed by the original LQ-001 through LQ-080 set.

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| LQ-081 | liquidate | Incorrect cluster state hash — revert `IncorrectClusterState`. Verifies input validation on liquidation. | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; revert:yes` | [ ] | ClusterLib.sol:131-148 |
| LQ-082 | liquidate | Non-existent cluster — revert `ClusterDoesNotExist`. | `entry:liquidate; version:eth; eb:implicit; cluster:none; ops:4; revert:yes` | [ ] | ClusterLib.sol:141-142 |
| LQ-083 | liquidateSSV | Incorrect cluster state hash — revert `IncorrectClusterState`. | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:4; revert:yes` | [ ] | ClusterLib.sol:131-148 |
| LQ-084 | liquidateSSV | Non-existent SSV cluster — revert `ClusterDoesNotExist`. | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:none; ops:4; revert:yes` | [ ] | ClusterLib.sol:141-142 |
| LQ-085 | liquidateSSV | Non-owner calls SSV liquidation — verify reverts (SSV path uses `validateHashedCluster(msg.sender, ...)` for self-liquidation check but third-party path is allowed). Clarify access model. | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:4; revert:no` | [ ] | SSVClusters.sol:70-124 |
| LQ-086 | liquidateSSV | SSV-specific: liquidation with removed operator. Verify `updateClusterOperatorsSSV` correctly skips removed operator (snapshot.block == 0). | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:396-423 |
| LQ-087 | liquidateSSV | SSV-specific: operator snapshot settlement during liquidation — verify SSV index updated for each active operator. | `entry:liquidateSSV; version:ssv; eb:implicit; cluster:active; ops:4; revert:no` | [ ] | OperatorLib.sol:396-423 |
| LQ-088 | _executeLiquidation | Defensive: below-baseline deviation branch — if `vUnitsCluster > 0` but `vUnitsCluster < validatorCount * BPS_DENOMINATOR`, the deviation calculation at line 575 would produce a negative value. Verify this is unreachable due to EB floor. | `entry:liquidate; version:eth; eb:explicit; cluster:active; ops:4; revert:no` | [ ] | SSVClusters.sol:573-578 |
| LQ-089 | _liquidateAfterEBUpdateIfNeeded | Auto-liquidation with removed operator: verify the `ethValidatorCount > 0` guard at line 541 prevents decrementing removed operators during auto-liquidation. | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVClusters.sol:539-544 |
| LQ-090 | _liquidateAfterEBUpdateIfNeeded | Auto-liquidation: EB decrease makes cluster solvent — verify `_liquidateAfterEBUpdateIfNeeded` returns false (no liquidation). EB decrease reduces burn rate threshold. | `entry:updateClusterBalance; version:eth; eb:explicit; cluster:active; ops:4; revert:no` | [ ] | SSVClusters.sol:519-550 |
| LQ-091 | reactivate | Incorrect cluster state — revert `IncorrectClusterState`. | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; revert:yes` | [ ] | ClusterLib.sol:131-148 |
| LQ-092 | reactivate | Non-existent cluster — revert `ClusterDoesNotExist`. | `entry:reactivate; version:eth; eb:implicit; cluster:none; ops:4; revert:yes` | [ ] | ClusterLib.sol:141-142 |
| LQ-093 | reactivate | SSV cluster (wrong version) — revert `IncorrectClusterVersion`. | `entry:reactivate; version:ssv; eb:implicit; cluster:liquidated; ops:4; revert:yes` | [ ] | ClusterLib.sol:328-330 |
| LQ-094 | reactivate | Reactivate with removed operator where operator's `ethSnapshot.block == 0`: verify `updateClusterOperatorsOnReactivation` correctly skips the operator. `cumulativeFee` excludes removed op's fee. `ethValidatorCount` NOT incremented. | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:291, 321-327 |
| LQ-095 | reactivate | Reactivate with explicit EB + removed operator: deviation added to active operators only, NOT to removed operator's `operatorEthVUnits`. Verify removed op skipped in deviation loop. | `entry:reactivate; version:eth; eb:explicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:312-319 |
| LQ-096 | reactivate | Reactivate with `msg.value == 0` — cluster has prior deposited balance from deposit-while-liquidated. If prior balance >= threshold, reactivation succeeds with zero new ETH. | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; revert:no` | [ ] | SSVClusters.sol:156, 161-171 |
| LQ-097 | reactivate | Operator-level: verify `ensureETHDefaults` is called during reactivation for operators that were never ETH-initialized. | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; revert:no` | [ ] | OperatorLib.sol:275-330 |
| LQ-098 | reactivate | Operator-level: verify `updateSnapshotSt` is called for each active operator during reactivation, settling any accrued earnings. | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; revert:no` | [ ] | OperatorLib.sol:297-310 |
| LQ-099 | reactivate | Operator-level: verify operator's `ethSnapshot.index` is preserved through liquidation and correctly used during reactivation index accumulation. | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; revert:no` | [ ] | OperatorLib.sol:305-310 |
| LQ-100 | reactivate | Operator-level: removed operator contributes its preserved `ethSnapshot.index` to `cumulativeIndex` but zero fee during reactivation. | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:real; revert:no` | [ ] | OperatorLib.sol:291, 305-310 |
| LQ-101 | liquidate | ETH transfer failure: liquidation bounty transfer to `msg.sender` fails (recipient is a contract that rejects ETH). Verify revert. | `entry:liquidate; version:eth; eb:implicit; cluster:active; ops:4; revert:yes` | [ ] | SSVClusters.sol:607-609 |
| LQ-102 | reactivate | Reactivate with `validatorCount == 0` (all validators removed while liquidated) — cluster becomes active with no validators. Solvency check short-circuits (no burn rate). | `entry:reactivate; version:eth; eb:implicit; cluster:liquidated; ops:4; revert:no` | [ ] | SSVClusters.sol:161-171 |

---

## ask-codex Review Findings

### Additional Scenarios

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| LQ-103 | reactivate | Reactivation with hasDeviation==true from ANOTHER active cluster's deviation. Cluster being reactivated has clusterDeviation==0 but DAO deviation is non-zero. Tests OperatorLib.sol:285 and snapshot recomputation at :298. | `entry:reactivate; revert:no` | [ ] | OperatorLib.sol:285, 298 |
| LQ-104 | reactivate | Reactivation with hasDeviation==true from another cluster AND reactivated cluster also has clusterDeviation>0. Tests additive deviation writeback at OperatorLib.sol:313-315 (not fallback at :317). | `entry:reactivate; revert:no` | [ ] | OperatorLib.sol:313-315 |
| LQ-105 | reactivate | Same-block reactivation: blockDiffEthFee==0 at OperatorLib.sol:294 → skip snapshot/index/balance accrual. | `entry:reactivate; revert:no` | [ ] | OperatorLib.sol:294 |
