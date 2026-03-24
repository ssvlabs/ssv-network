# Scenarios — Global Invariant Verification (INV-001 to INV-050)

**Prefix:** INV
**Purpose:** Scripted invariant verification layer for exhaustive scenario coverage. These are deterministic assertion scenarios — not fuzz tests (Echidna/Foundry handle property-based fuzzing separately).
**Source contracts:**
- `contracts/modules/SSVClusters.sol` — liquidate, liquidateSSV, reactivate, deposit, withdraw, migrateClusterToETH, updateClusterBalance, _executeLiquidation
- `contracts/modules/SSVOperators.sol` — registerOperator, removeOperator, declareOperatorFee, executeOperatorFee, reduceOperatorFee, withdrawOperatorEarnings
- `contracts/modules/SSVStaking.sol` — stake, requestUnstake, withdrawUnlocked, claimEthRewards, syncFees
- `contracts/libraries/ProtocolLib.sol` — updateDAO, updateDAOSSV, updateDAOEarnings, updateDAOEthVUnits, networkTotalEarnings
- `contracts/libraries/ClusterLib.sol` — getVUnits, updateBalanceWithEB, isLiquidatableWithEB, isLiquidatableWithVUnits, hashClusterData, getClusterData, ebToVUnits
- `contracts/libraries/OperatorLib.sol` — updateSnapshotSt, updateClusterOperators, updateClusterOperatorsOnReactivation, updateClusterOperatorsMigration
- `contracts/libraries/storage/SSVStorageEB.sol` — ClusterEBSnapshot, operatorEthVUnits
- `contracts/libraries/storage/SSVStorageProtocol.sol` — StorageProtocol (daoTotalEthVUnits, ethDaoValidatorCount, ethDaoBalance)
- `contracts/libraries/storage/SSVStorageStaking.sol` — StorageStaking (accEthPerShare, stakingEthPoolBalance)
- `contracts/libraries/SSVCoreTypes.sol` — BPS_DENOMINATOR=10_000, ETH_DEDUCTED_DIGITS=100_000, DEFAULT_EB_PER_VALIDATOR=32 ether, MAX_EB_PER_VALIDATOR=2048 ether

**Constants:**
- `BPS_DENOMINATOR = 10_000` (1 validator at 32 ETH = 10_000 vUnits baseline)
- `ETH_DEDUCTED_DIGITS = 100_000` (ETH precision loss in packed representation)
- `DEFAULT_EB_PER_VALIDATOR = 32 ether`, `MAX_EB_PER_VALIDATOR = 2048 ether`

---

## 12 Global Invariants

| # | Invariant | Formula / Rule |
|---|-----------|----------------|
| G1 | ETH Conservation | `address(this).balance >= Σ(cluster.balance for active ETH clusters) + Σ(operator.ethSnapshot.balance for live operators) + sp.ethDaoBalance` (modulo ETH_DEDUCTED_DIGITS rounding) |
| G2 | SSV Conservation | `token.balanceOf(address(this)) >= Σ(cluster.balance for active SSV clusters) + Σ(operator.snapshot.balance for live operators) + sp.daoBalance + Σ(pending unstake amounts)` |
| G3 | Validator Count | `sp.ethDaoValidatorCount == Σ(cluster.validatorCount) across all active ETH clusters` |
| G4 | vUnit Consistency | `sp.daoTotalEthVUnits == sp.ethDaoValidatorCount * 10_000 + Σ(EB deviations for live operators only)` |
| G5 | Cluster Hash Integrity | `s.ethClusters[key] == keccak256(abi.encodePacked(cluster.validatorCount, cluster.networkFeeIndex, cluster.index, cluster.balance, cluster.active))` |
| G6 | cSSV Supply | `cSSV.totalSupply() == Σ(staked) - Σ(unstaked_and_withdrawn)` |
| G7 | Accumulator Monotonicity | `accEthPerShare` only increases (never decreases) |
| G8 | Oracle Monotonicity | `seb.latestCommittedBlock` only increases (never decreases) |
| G9 | Cluster Version Exclusivity | For any `hashedCluster`: `s.clusters[key] != 0 XOR s.ethClusters[key] != 0` (never both nonzero) |
| G10 | Operator Dual Tracking | `operator.ethValidatorCount == Σ(validatorCount of active ETH clusters using this operator)` |
| G11 | Removed Operator Zero State | If `operator.ethSnapshot.block == 0` then `seb.operatorEthVUnits[operatorId] == 0` — **THE BUG DETECTOR** |
| G12 | No Deviation Without EB | If cluster never called `updateClusterBalance`, then `seb.clusterEB[clusterId].vUnits == 0` |

---

## Scenario Table

| ID | Invariant | Trigger Flow | Purpose | Tags | Tested | File References |
|----|-----------|-------------|---------|------|--------|-----------------|
| INV-001 | G1: ETH Conservation | register + deposit | ETH balance = cluster balance + operator accrued + DAO after single cluster registration with deposit | `invariant:eth-conservation; flow:register+deposit; version:eth; ops:4; cluster:active; complexity:simple` | [ ] | SSVClusters.sol, ProtocolLib.sol:84-89 |
| INV-002 | G1: ETH Conservation | register + advance + withdraw | After blocks advance (fees accrue), cluster withdraws partial balance; sum still conserved | `invariant:eth-conservation; flow:register+advance+withdraw; version:eth; ops:4; cluster:active; complexity:medium` | [ ] | SSVClusters.sol:206-254, ProtocolLib.sol:84-89 |
| INV-003 | G1: ETH Conservation | liquidate (ETH) | After liquidation, bounty sent to liquidator + operator/DAO earnings = original contract ETH | `invariant:eth-conservation; flow:liquidate; version:eth; ops:4; cluster:active->liquidated; complexity:medium` | [ ] | SSVClusters.sol:552-612, ProtocolLib.sol:65-68 |
| INV-004 | G1: ETH Conservation | reactivate | After reactivation with msg.value, new contract balance = old + msg.value; cluster balance accounts for it | `invariant:eth-conservation; flow:reactivate; version:eth; ops:4; cluster:liquidated->active; complexity:medium` | [ ] | SSVClusters.sol:129-181 |
| INV-005 | G1: ETH Conservation | operator withdrawal | After operator withdraws ETH earnings, contract balance decreases by exact withdrawn amount | `invariant:eth-conservation; flow:withdrawOperatorEarnings; version:eth; ops:4; cluster:active; complexity:simple` | [ ] | SSVOperators.sol:235-237, 292-345 |
| INV-006 | G1: ETH Conservation | migrateClusterToETH | Migration adds msg.value and returns SSV; ETH side conserved post-migration | `invariant:eth-conservation; flow:migrate; version:ssv->eth; ops:4; cluster:active; complexity:high` | [ ] | SSVClusters.sol:259-343 |
| INV-007 | G2: SSV Conservation | register SSV + deposit SSV | SSV token balance = SSV cluster balances + SSV operator balances + DAO SSV balance + pending unstakes | `invariant:ssv-conservation; flow:register+deposit; version:ssv; ops:4; cluster:active; complexity:simple` | [ ] | ProtocolLib.sol:97-99 |
| INV-008 | G2: SSV Conservation | liquidateSSV | After SSV liquidation, bounty transferred as SSV tokens; total conserved | `invariant:ssv-conservation; flow:liquidateSSV; version:ssv; ops:4; cluster:active->liquidated; complexity:medium` | [ ] | SSVClusters.sol:70-124 |
| INV-009 | G2: SSV Conservation | stake + syncFees | After staking SSV and syncing fees, token balance includes staked amount + pending unstakes | `invariant:ssv-conservation; flow:stake+syncFees; version:ssv; staking:yes; complexity:medium` | [ ] | SSVStaking.sol:43-59, 183-207 |
| INV-010 | G2: SSV Conservation | migrateClusterToETH | Migration returns SSV balance to owner; SSV side decrements correctly | `invariant:ssv-conservation; flow:migrate; version:ssv->eth; ops:4; cluster:active; complexity:high` | [ ] | SSVClusters.sol:335-337 |
| INV-011 | G3: Validator Count | register multiple clusters | ethDaoValidatorCount == sum of all active ETH cluster validatorCounts after registering 3 clusters | `invariant:validator-count; flow:register; version:eth; ops:4; cluster:active; complexity:simple` | [ ] | ProtocolLib.sol:107-119, ClusterLib.sol:234-277 |
| INV-012 | G3: Validator Count | liquidate one of many | After liquidating 1 of 3 clusters, ethDaoValidatorCount decremented by that cluster's validatorCount only | `invariant:validator-count; flow:register+liquidate; version:eth; ops:4; cluster:active+liquidated; complexity:medium` | [ ] | ProtocolLib.sol:107-119, SSVClusters.sol:562 |
| INV-013 | G3: Validator Count | reactivate | After reactivation, ethDaoValidatorCount incremented by reactivated cluster's validatorCount | `invariant:validator-count; flow:liquidate+reactivate; version:eth; ops:4; cluster:liquidated->active; complexity:medium` | [ ] | SSVClusters.sol:173, ProtocolLib.sol:107-119 |
| INV-014 | G3: Validator Count | operator removal | Removing operator does NOT change ethDaoValidatorCount (cluster still exists with same validator count) | `invariant:validator-count; flow:register+removeOperator; version:eth; ops:4; cluster:active; complexity:medium` | [ ] | SSVOperators.sol:71-104 |
| INV-015 | G4: vUnit Consistency | register (implicit EB) | daoTotalEthVUnits == ethDaoValidatorCount * 10_000 when no explicit EB has been set (all deviations = 0) | `invariant:vunit-consistency; flow:register; version:eth; eb:implicit; ops:4; complexity:simple` | [ ] | ProtocolLib.sol:107-119 |
| INV-016 | G4: vUnit Consistency | updateClusterBalance (EB increase) | After EB 32->48 ETH/val: daoTotalEthVUnits == ethDaoValidatorCount * 10_000 + Σ(deviation); deviation = (vUnits - baseline) per cluster | `invariant:vunit-consistency; flow:register+ebUpdate; version:eth; eb:implicit->explicit; ops:4; complexity:high` | [ ] | SSVClusters.sol:385-404, ProtocolLib.sol:142-150 |
| INV-017 | G4: vUnit Consistency | liquidate (explicit EB) | After liquidating cluster with deviation, daoTotalEthVUnits decremented by both baseline (via ethDaoValidatorCount) and deviation | `invariant:vunit-consistency; flow:register+ebUpdate+liquidate; version:eth; eb:explicit; ops:4; complexity:high` | [ ] | SSVClusters.sol:562-597, ProtocolLib.sol:107-119 |
| INV-018 | G4: vUnit Consistency | operator removal + EB update | After operator removal, operatorEthVUnits[removedOp] deleted; daoTotalEthVUnits still equals ethDaoValidatorCount*BPS + Σ(live operator deviations) | `invariant:vunit-consistency; flow:register+ebUpdate+removeOperator; version:eth; eb:explicit; ops:4; complexity:high` | [ ] | SSVOperators.sol:93, SSVClusters.sol:494-510 |
| INV-019 | G4: vUnit Consistency | reactivate (with prior EB) | After reactivating cluster with stored EB deviation, daoTotalEthVUnits includes re-added deviation | `invariant:vunit-consistency; flow:liquidate+reactivate; version:eth; eb:explicit; ops:4; complexity:high` | [ ] | SSVClusters.sol:142-177 |
| INV-020 | G4: vUnit Consistency | migrateClusterToETH (with EB) | After migration with stored EB, daoTotalEthVUnits includes migrated cluster's deviation | `invariant:vunit-consistency; flow:migrate; version:ssv->eth; eb:explicit; ops:4; complexity:high` | [ ] | SSVClusters.sol:309-327 |
| INV-021 | G5: Cluster Hash Integrity | register | After registration, s.ethClusters[key] matches keccak256 of actual cluster struct | `invariant:hash-integrity; flow:register; version:eth; ops:4; complexity:simple` | [ ] | ClusterLib.sol:172-183, 234-277 |
| INV-022 | G5: Cluster Hash Integrity | deposit | After deposit, stored hash updated to reflect new balance | `invariant:hash-integrity; flow:deposit; version:eth; ops:4; complexity:simple` | [ ] | SSVClusters.sol:186-201 |
| INV-023 | G5: Cluster Hash Integrity | liquidate | After liquidation, stored hash reflects zeroed state (balance=0, index=0, networkFeeIndex=0, active=false) | `invariant:hash-integrity; flow:liquidate; version:eth; ops:4; complexity:medium` | [ ] | SSVClusters.sol:599-605 |
| INV-024 | G5: Cluster Hash Integrity | reactivate | After reactivation, stored hash reflects new balance, active=true, updated indexes | `invariant:hash-integrity; flow:reactivate; version:eth; ops:4; complexity:medium` | [ ] | SSVClusters.sol:156-178 |
| INV-025 | G6: cSSV Supply | stake + requestUnstake + withdrawUnlocked | cSSV totalSupply == staked - burned; SSV tokens in contract == totalSupply + pending withdrawals | `invariant:cssv-supply; flow:stake+unstake+withdraw; staking:yes; complexity:medium` | [ ] | SSVStaking.sol:43-59, 65-93, 98-108 |
| INV-026 | G6: cSSV Supply | multiple users stake + partial unstake | With 3 users staking different amounts and 1 partially unstaking, cSSV totalSupply == Σ(staked) - Σ(burned) | `invariant:cssv-supply; flow:stake+unstake; staking:yes; complexity:high` | [ ] | SSVStaking.sol:43-93 |
| INV-027 | G7: Accumulator Monotonicity | syncFees across multiple blocks | accEthPerShare after syncFees at block N+100 >= accEthPerShare at block N | `invariant:accumulator-monotonic; flow:syncFees; staking:yes; complexity:simple` | [ ] | SSVStaking.sol:183-207 |
| INV-028 | G7: Accumulator Monotonicity | syncFees with zero totalStaked | When cSSV totalSupply == 0, accEthPerShare remains unchanged (no division by zero, no decrease) | `invariant:accumulator-monotonic; flow:syncFees; staking:yes; complexity:edge` | [ ] | SSVStaking.sol:199-203 |
| INV-029 | G8: Oracle Monotonicity | commitRoot twice | latestCommittedBlock after second commitRoot >= latestCommittedBlock after first | `invariant:oracle-monotonic; flow:commitRoot; eb:oracle; complexity:simple` | [ ] | SSVStorageEB.sol:18 |
| INV-030 | G8: Oracle Monotonicity | commitRoot + updateClusterBalance | Calling updateClusterBalance does not modify latestCommittedBlock; it only reads it | `invariant:oracle-monotonic; flow:commitRoot+ebUpdate; eb:oracle; complexity:simple` | [ ] | SSVClusters.sol:434-443, SSVStorageEB.sol:18 |
| INV-031 | G9: Cluster Version Exclusivity | register ETH cluster | After registration, s.ethClusters[key] != 0 and s.clusters[key] == 0 | `invariant:version-exclusivity; flow:register; version:eth; ops:4; complexity:simple` | [ ] | ClusterLib.sol:193-223, 339-358 |
| INV-032 | G9: Cluster Version Exclusivity | migrateClusterToETH | After migration, s.ethClusters[key] != 0 and s.clusters[key] == 0 (delete s.clusters[key] called) | `invariant:version-exclusivity; flow:migrate; version:ssv->eth; ops:4; complexity:medium` | [ ] | SSVClusters.sol:301-302 |
| INV-033 | G9: Cluster Version Exclusivity | liquidate ETH + verify SSV slot | After liquidating ETH cluster, s.ethClusters[key] reflects liquidated state and s.clusters[key] remains 0 | `invariant:version-exclusivity; flow:liquidate; version:eth; ops:4; complexity:medium` | [ ] | SSVClusters.sol:605, ClusterLib.sol:339-358 |
| INV-034 | G10: Operator Dual Tracking | register 2 clusters on same ops | After registering 2 ETH clusters (validatorCount 3 and 5) on same 4 operators, each operator's ethValidatorCount == 8 | `invariant:operator-dual-tracking; flow:register; version:eth; ops:4; complexity:medium` | [ ] | OperatorLib.sol:155-221 |
| INV-035 | G10: Operator Dual Tracking | liquidate 1 of 2 clusters | After liquidating cluster with validatorCount=3, each operator's ethValidatorCount == 5 (decremented by 3) | `invariant:operator-dual-tracking; flow:register+liquidate; version:eth; ops:4; complexity:medium` | [ ] | OperatorLib.sol:233-262, SSVClusters.sol:41-47 |
| INV-036 | G10: Operator Dual Tracking | reactivate | After reactivating cluster with validatorCount=3, operators incremented back to ethValidatorCount=8 | `invariant:operator-dual-tracking; flow:liquidate+reactivate; version:eth; ops:4; complexity:medium` | [ ] | OperatorLib.sol:275-330 |
| INV-037 | G11: Removed Op Zero State | removeOperator (fresh) | After removing operator with no clusters, ethSnapshot.block == 0 AND operatorEthVUnits == 0 | `invariant:removed-op-zero; flow:removeOperator; version:eth; ops:1; complexity:simple; bug-detector:yes` | [ ] | SSVOperators.sol:71-104, 347-358 |
| INV-038 | G11: Removed Op Zero State | removeOperator (with active cluster) | After removing operator that has active ETH cluster, ethSnapshot.block == 0; verify operatorEthVUnits[opId] == 0 via `delete seb.operatorEthVUnits[operatorId]` | `invariant:removed-op-zero; flow:register+removeOperator; version:eth; eb:implicit; ops:4; complexity:medium; bug-detector:yes` | [ ] | SSVOperators.sol:93 |
| INV-039 | G11: Removed Op Zero State | removeOperator + EB update on surviving cluster | **THE BUG PATH**: Operator removed, then updateClusterBalance writes to operatorEthVUnits[removedOp] via _updateOperatorVUnits — G11 violated | `invariant:removed-op-zero; flow:register+removeOperator+ebUpdate; version:eth; eb:implicit->explicit; ops:4; complexity:critical; bug-detector:yes` | [ ] | SSVOperators.sol:93, SSVClusters.sol:494-510 |
| INV-040 | G11: Removed Op Zero State | cascading removal (2 ops removed) | Remove 2 of 4 operators from a cluster, then updateClusterBalance — both removed operators should have operatorEthVUnits == 0; verify both are violated | `invariant:removed-op-zero; flow:register+removeOperator×2+ebUpdate; version:eth; eb:implicit->explicit; ops:4; complexity:critical; bug-detector:yes` | [ ] | SSVOperators.sol:93, SSVClusters.sol:494-510 |
| INV-041 | G11: Removed Op Zero State | removeOperator + liquidation | Remove operator, then liquidate cluster; _executeLiquidation deviation cleanup writes to operatorEthVUnits[removedOp] — G11 violated if cluster had explicit EB | `invariant:removed-op-zero; flow:register+ebUpdate+removeOperator+liquidate; version:eth; eb:explicit; ops:4; complexity:critical; bug-detector:yes` | [ ] | SSVClusters.sol:586-592, SSVOperators.sol:93 |
| INV-042 | G11: Removed Op Zero State | removeOperator + reactivation | Remove operator, then reactivate cluster; updateClusterOperatorsOnReactivation skips removed op (block==0); G11 preserved IF no prior EB update wrote stale data | `invariant:removed-op-zero; flow:register+removeOperator+liquidate+reactivate; version:eth; eb:implicit; ops:4; complexity:high; bug-detector:yes` | [ ] | OperatorLib.sol:275-330, SSVOperators.sol:93 |
| INV-043 | G11: Removed Op Zero State | removeOperator + migration | SSV cluster migrates to ETH after operator removal; migration adds deviation via operatorEthVUnits for ALL operators including removed — G11 violated | `invariant:removed-op-zero; flow:register+removeOperator+migrate; version:ssv->eth; eb:explicit; ops:4; complexity:critical; bug-detector:yes` | [ ] | SSVClusters.sol:318-322, SSVOperators.sol:93 |
| INV-044 | G11: Removed Op Zero State | shared operator removal | Operator shared by 2 clusters, removed; cluster A does EB update (writes stale vUnits), cluster B does EB update (writes again) — cumulative stale data | `invariant:removed-op-zero; flow:register×2+removeOperator+ebUpdate×2; version:eth; eb:implicit->explicit; ops:shared; complexity:critical; bug-detector:yes` | [ ] | SSVClusters.sol:494-510 |
| INV-045 | G11: Removed Op Zero State | removeOperator + EB update + reactivation | Full cycle: register, EB update, remove op, liquidate, reactivate — verify final operatorEthVUnits state for removed op | `invariant:removed-op-zero; flow:full-cycle; version:eth; eb:explicit; ops:4; complexity:critical; bug-detector:yes` | [ ] | SSVOperators.sol:93, SSVClusters.sol:129-181, 494-510 |
| INV-046 | G12: No Deviation Without EB | register (no EB update) | After registration without calling updateClusterBalance, seb.clusterEB[clusterId].vUnits == 0 | `invariant:no-deviation-without-eb; flow:register; version:eth; eb:implicit; ops:4; complexity:simple` | [ ] | SSVStorageEB.sol:14 |
| INV-047 | G12: No Deviation Without EB | register + deposit + withdraw (no EB) | After normal cluster operations without EB update, clusterEB.vUnits remains 0 | `invariant:no-deviation-without-eb; flow:register+deposit+withdraw; version:eth; eb:implicit; ops:4; complexity:simple` | [ ] | SSVStorageEB.sol:14 |
| INV-048 | G9: Cluster Version Exclusivity | register SSV + attempt ETH register same ops | Registering ETH cluster for same (owner, operatorIds) that has SSV cluster must revert IncorrectClusterVersion | `invariant:version-exclusivity; flow:register; version:ssv+eth; ops:4; complexity:medium; revert:yes` | [ ] | ClusterLib.sol:193-223 |
| INV-049 | G1+G4: Conservation + vUnit | mixed SSV/ETH operations | Register SSV cluster, register ETH cluster (different ops), migrate SSV to ETH, EB update on both — verify ETH conservation AND vUnit consistency simultaneously | `invariant:eth-conservation+vunit-consistency; flow:register+migrate+ebUpdate; version:mixed; ops:8; complexity:high` | [ ] | SSVClusters.sol:259-343, ProtocolLib.sol:84-89, 107-119 |
| INV-050 | G1+G3+G4+G10+G11 | full lifecycle stress | Register 3 clusters, EB update cluster 1, remove 1 operator, liquidate cluster 2, reactivate cluster 2, migrate cluster 3 — verify ALL 5 invariants hold after each step | `invariant:multi; flow:full-lifecycle; version:mixed; ops:varied; complexity:critical; bug-detector:yes` | [ ] | ALL |

---

## INV-001 to INV-006: ETH Conservation (G1)

**Invariant G1:** `address(this).balance >= Σ(active ETH cluster balances) + Σ(live operator ETH earnings) + sp.ethDaoBalance` (modulo ETH_DEDUCTED_DIGITS=100_000 rounding)

The ETH side uses packed representation (`PackedETH`, which truncates by `ETH_DEDUCTED_DIGITS`). Conservation holds within rounding: the contract never sends more ETH out than it received.

**INV-001: Register + Deposit (Baseline)**
- Setup: Register 4 operators. Register 1 ETH cluster with `validatorCount=1`, `msg.value = 10 ETH`.
- Advance 0 blocks (no fee accrual).
- Assert: `address(this).balance == 10 ETH`. Cluster balance == 10 ETH. Operator earnings == 0. DAO earnings == 0.
- Assert: `10 ETH == cluster.balance + 0 + 0`. G1 holds.

**INV-002: Register + Advance + Withdraw**
- Setup: Register 4 operators (each fee = 1778800000 packed). Register 1 ETH cluster, `msg.value = 10 ETH`.
- Advance 100 blocks. Fees accrue to operators and DAO.
- Cluster withdraws 1 ETH. Contract sends 1 ETH to owner.
- Assert: `address(this).balance == 9 ETH`. Decompose: `cluster.balance (after fee deduction and withdrawal) + Σ(operator.ethSnapshot.balance) + sp.ethDaoBalance == 9 ETH` (within rounding).

**INV-003: Liquidation**
- Setup: Register cluster with minimal balance (just above liquidation threshold). Advance blocks until undercollateralized.
- Third-party calls `liquidate()`. Bounty (remaining cluster balance) sent to liquidator.
- Assert: `address(this).balance == original - bounty`. Operator earnings remain in contract. DAO earnings remain. G1 holds.

**INV-004: Reactivation**
- Setup: Liquidated cluster from INV-003. Owner calls `reactivate{value: 5 ETH}()`.
- Assert: `address(this).balance == prev + 5 ETH`. Cluster balance == 5 ETH. Operator and DAO earnings unchanged. G1 holds.

**INV-005: Operator Withdrawal**
- Setup: Active cluster, 100 blocks advanced. Operator 1 calls `withdrawAllOperatorEarnings()`.
- Assert: `address(this).balance` decremented by exact withdrawn amount. Operator's `ethSnapshot.balance` reset to 0. G1 holds.
- File ref: `SSVOperators.sol:292-345`, `OperatorLib.sol:52-72`

**INV-006: Migration**
- Setup: SSV cluster with balance 1000 SSV tokens. Call `migrateClusterToETH{value: 5 ETH}()`.
- Assert: ETH side: `address(this).balance` increased by 5 ETH. SSV tokens returned to owner. ETH cluster balance == 5 ETH. G1 holds for ETH side.

---

## INV-007 to INV-010: SSV Conservation (G2)

**Invariant G2:** `token.balanceOf(address(this)) >= Σ(active SSV cluster balances) + Σ(live operator SSV earnings) + sp.daoBalance + Σ(pending unstake amounts)`

**INV-007: SSV Register + Deposit (Baseline)**
- Setup: Register SSV cluster via legacy flow. Deposit SSV tokens.
- Assert: Token balance == cluster balance + operator balances + DAO balance. No pending unstakes.

**INV-008: SSV Liquidation**
- Setup: SSV cluster becomes undercollateralized. Third-party calls `liquidateSSV()`.
- Bounty sent as SSV tokens via `CoreLib.transferTokenBalance`.
- Assert: `token.balanceOf(contract) == prev - bounty`. `sp.daoBalance` correctly updated via `updateDAOSSV(false, ...)`.

**INV-009: Stake + SyncFees**
- Setup: User stakes 1000 SSV. `syncFees()` called after blocks advance.
- Assert: `token.balanceOf(contract) == staked_amount`. `cSSV.totalSupply() == 1000`. No pending unstakes. `stakingEthPoolBalance` reflects ETH DAO earnings allocated to staking pool.

**INV-010: Migration Returns SSV**
- Setup: SSV cluster with balance. Migrate to ETH.
- Assert: `ssvClusterBalance` transferred to msg.sender. Token balance decremented. SSV DAO balance adjusted via `updateDAOSSV(false, ...)`.

---

## INV-011 to INV-014: Validator Count (G3)

**Invariant G3:** `sp.ethDaoValidatorCount == Σ(cluster.validatorCount across active ETH clusters)`

**INV-011: Multiple Registrations**
- Register cluster A (3 validators), cluster B (5 validators), cluster C (2 validators). All on different operator sets.
- Assert: `sp.ethDaoValidatorCount == 10`.

**INV-012: Liquidate One**
- From INV-011 state. Liquidate cluster B (5 validators).
- Assert: `sp.ethDaoValidatorCount == 5` (10 - 5). `updateDAO(false, 5)` was called.

**INV-013: Reactivate**
- From INV-012 state. Reactivate cluster B.
- Assert: `sp.ethDaoValidatorCount == 10`. `updateDAO(true, 5)` was called.

**INV-014: Operator Removal**
- From INV-011 state. Remove operator 1 (used by cluster A).
- Assert: `sp.ethDaoValidatorCount` unchanged at 10. Operator removal does not affect DAO validator count — the cluster still exists and has validators.

---

## INV-015 to INV-020: vUnit Consistency (G4)

**Invariant G4:** `sp.daoTotalEthVUnits == sp.ethDaoValidatorCount * BPS_DENOMINATOR + Σ(deviations from live operators' clusters)`

This is the most complex invariant because it involves the deviation-only accounting model where baseline vUnits are tracked via `ethDaoValidatorCount * 10_000` and only deviations from 32 ETH/validator default are stored per-operator.

**INV-015: Implicit EB (No Deviations)**
- Setup: Register 2 ETH clusters, no EB updates. All clusters use default 32 ETH/val.
- Assert: `sp.daoTotalEthVUnits == sp.ethDaoValidatorCount * 10_000`. All `operatorEthVUnits` == 0.

**INV-016: EB Increase**
- Setup: Register ETH cluster (4 ops, 2 validators). Call `updateClusterBalance(EB=48 ETH/val)`.
- `ebToVUnits(48*2) = ceil(96*10000/32) = 30000`. Baseline = 2 * 10000 = 20000. Deviation = 10000.
- Assert: `sp.daoTotalEthVUnits == ethDaoValidatorCount * 10000 + 10000`.
- Assert: Each of 4 operators has `operatorEthVUnits[opId] += 10000`.

**INV-017: Liquidation with Explicit EB**
- From INV-016 state. Liquidate the cluster.
- `_executeLiquidation` calls `updateDAO(false, 2)` which subtracts `2 * 10000 = 20000` from `daoTotalEthVUnits`.
- Then deviation cleanup subtracts `10000` from `daoTotalEthVUnits` (since `vUnitsCluster > baselineVUnits`).
- Assert: `sp.daoTotalEthVUnits == 0` (no other clusters). `ethDaoValidatorCount == 0`.

**INV-018: Operator Removal + EB Update**
- Setup: Register cluster (4 ops). Remove op1 (`delete seb.operatorEthVUnits[op1]`, `ethSnapshot.block = 0`).
- Call `updateClusterBalance(EB=48)` — `_updateOperatorVUnits` iterates ALL 4 operatorIds including removed op.
- Assert: `operatorEthVUnits[op1] != 0` after EB update (**BUG — G4 and G11 violated**).
- Expected: `daoTotalEthVUnits == ethDaoValidatorCount * 10000 + deviation` but operator-level sum includes stale data on removed operator.

**INV-019: Reactivation with Prior EB**
- Setup: Cluster had EB=48, got liquidated. Deviation was cleaned during liquidation.
- Reactivate. `clusterDeviation` computed from stored `seb.clusterEB[clusterId].vUnits`.
- Assert: `sp.daoTotalEthVUnits` includes re-added deviation. `operatorEthVUnits` updated for live operators only (removed ops skipped via `block != 0` check).

**INV-020: Migration with EB**
- Setup: SSV cluster had `updateClusterBalance` called (storing vUnits in clusterEB). Migrate to ETH.
- Assert: If `vUnitsCluster > baseline`, deviation added to `daoTotalEthVUnits` and each `operatorEthVUnits[opId]`.
- Verify: Only live operators get deviation updates.

---

## INV-021 to INV-024: Cluster Hash Integrity (G5)

**Invariant G5:** `s.ethClusters[key] == keccak256(abi.encodePacked(cluster.validatorCount, cluster.networkFeeIndex, cluster.index, cluster.balance, cluster.active))`

**INV-021: Registration**
- Register cluster. Read `s.ethClusters[key]` from storage.
- Compute expected hash from known cluster struct fields.
- Assert: match.

**INV-022: Deposit**
- Deposit 2 ETH into cluster. Balance increases by 2 ETH.
- Assert: Stored hash reflects new balance; all other fields unchanged.

**INV-023: Liquidation**
- Liquidate. Cluster state becomes: `balance=0, index=0, networkFeeIndex=0, active=false, validatorCount=unchanged`.
- Assert: Stored hash matches zeroed state.

**INV-024: Reactivation**
- Reactivate with 5 ETH. State becomes: `balance=5ETH, active=true, index=currentClusterIndex, networkFeeIndex=currentNetworkFeeIndex`.
- Assert: Stored hash matches reactivated state.

---

## INV-025 to INV-026: cSSV Supply (G6)

**Invariant G6:** `cSSV.totalSupply() == Σ(staked) - Σ(burned via requestUnstake)`

**INV-025: Stake + Unstake + Withdraw Cycle**
- User stakes 1000 SSV -> cSSV minted: totalSupply = 1000.
- User unstakes 400 -> cSSV burned: totalSupply = 600.
- After cooldown, user withdraws 400 SSV tokens.
- Assert: `cSSV.totalSupply() == 600`. `token.balanceOf(contract) >= 600` (remaining staked).

**INV-026: Multi-User**
- User A stakes 1000, User B stakes 500, User C stakes 300. totalSupply = 1800.
- User A unstakes 200. totalSupply = 1600.
- Assert: `cSSV.totalSupply() == 1600 == 1000 + 500 + 300 - 200`.

---

## INV-027 to INV-028: Accumulator Monotonicity (G7)

**Invariant G7:** `accEthPerShare` only increases.

**INV-027: Normal SyncFees**
- Record `accEthPerShare` at block N. Advance 100 blocks (network fees accrue). Call `syncFees()`.
- Assert: `accEthPerShare_after >= accEthPerShare_before`.
- Repeat 3 times. Each time: `accEthPerShare` non-decreasing.

**INV-028: Zero TotalStaked Edge Case**
- No one has staked (cSSV totalSupply == 0). Advance blocks. Call `syncFees()`.
- `newFeesWei` would cause division by zero, but code checks `totalStaked != 0` first.
- Assert: `accEthPerShare` unchanged (no update applied). G7 trivially holds.

---

## INV-029 to INV-030: Oracle Monotonicity (G8)

**Invariant G8:** `seb.latestCommittedBlock` only increases.

**INV-029: Sequential Root Commits**
- Commit root at block 100. Assert: `latestCommittedBlock == 100`.
- Commit root at block 200. Assert: `latestCommittedBlock == 200`.
- Attempt commit at block 150 — must be rejected or overwrite; either way `latestCommittedBlock >= 200`.

**INV-030: EB Update Does Not Modify latestCommittedBlock**
- Commit root at block 100. Record `latestCommittedBlock = 100`.
- Call `updateClusterBalance` (which reads but does not write `latestCommittedBlock`).
- Assert: `latestCommittedBlock == 100` (unchanged).

---

## INV-031 to INV-033 + INV-048: Cluster Version Exclusivity (G9)

**Invariant G9:** For any `hashedCluster`: `s.clusters[key] != 0` XOR `s.ethClusters[key] != 0` (never both nonzero simultaneously).

**INV-031: ETH Registration**
- Register ETH cluster. Assert: `s.ethClusters[key] != 0`, `s.clusters[key] == 0`.

**INV-032: Migration**
- SSV cluster exists: `s.clusters[key] != 0`, `s.ethClusters[key] == 0`.
- Call `migrateClusterToETH`. Code does `s.ethClusters[key] = hash; delete s.clusters[key]`.
- Assert: After migration, `s.ethClusters[key] != 0`, `s.clusters[key] == 0`. XOR holds.

**INV-033: ETH Liquidation**
- Liquidate ETH cluster. `_executeLiquidation` writes to `s.ethClusters[key]` (not `s.clusters[key]`).
- Assert: `s.ethClusters[key] != 0` (liquidated state hash), `s.clusters[key] == 0`.

**INV-048: Cross-Version Registration Attempt**
- SSV cluster exists at key K. Attempt to register ETH cluster with same (owner, operatorIds).
- `validateClusterOnRegistration` checks: if `s.ethClusters == 0 && s.clusters != 0`, revert `IncorrectClusterVersion`.
- Assert: Revert. G9 cannot be violated via registration.

---

## INV-034 to INV-036: Operator Dual Tracking (G10)

**Invariant G10:** `operator.ethValidatorCount == Σ(validatorCount of active ETH clusters using this operator)`

**INV-034: Two Clusters on Same Operators**
- Register cluster A (validatorCount=3) and cluster B (validatorCount=5) on operators [1,2,3,4].
- Assert: Each operator's `ethValidatorCount == 8`.

**INV-035: Liquidate One**
- Liquidate cluster A (validatorCount=3). `updateClusterOperators(false, 3)` decrements each operator.
- Assert: Each operator's `ethValidatorCount == 5`.

**INV-036: Reactivate**
- Reactivate cluster A. `updateClusterOperatorsOnReactivation` increments each operator by 3.
- Assert: Each operator's `ethValidatorCount == 8`.

---

## INV-037 to INV-045: Removed Operator Zero State (G11) — BUG DETECTOR

**Invariant G11:** If `operator.ethSnapshot.block == 0`, then `seb.operatorEthVUnits[operatorId] == 0`.

This invariant is the primary bug detector. `removeOperator` calls `delete seb.operatorEthVUnits[operatorId]` (line 93 of SSVOperators.sol) and sets `ethSnapshot.block = 0` (line 348 of _resetOperatorState). However, subsequent operations on clusters containing the removed operator can re-write `operatorEthVUnits[removedOp]`, violating G11.

**INV-037: Clean Removal (Baseline)**
- Register operator. No clusters. Remove operator.
- Assert: `ethSnapshot.block == 0` AND `operatorEthVUnits[opId] == 0`. G11 holds.

**INV-038: Removal with Active Cluster (Implicit EB)**
- Register 4 operators. Register ETH cluster (no EB update). Remove operator 1.
- `_resetOperatorState` sets `ethSnapshot.block = 0`. `delete seb.operatorEthVUnits[op1]` -> 0 (was already 0 since implicit EB).
- Assert: G11 holds — `operatorEthVUnits[op1] == 0`.
- **Note:** Cluster still exists with removed operator in its operatorIds array.

**INV-039: Removal + EB Update (PRIMARY BUG PATH)**
- Setup: Register 4 operators. Register ETH cluster. Remove operator 1.
- Call `updateClusterBalance(EB=48 ETH)` on the cluster (which still references op1 in its operatorIds).
- `_updateOperatorVUnits` (SSVClusters.sol:494-510) iterates ALL operatorIds including op1.
- `seb.operatorEthVUnits[op1] += deltaAbs` — writes nonzero value to removed operator.
- **Assert: G11 VIOLATED.** `ethSnapshot.block == 0` but `operatorEthVUnits[op1] != 0`.
- This is the canonical demonstration of the bug.

**INV-040: Cascading Removals + EB Update**
- Register 4 operators. Register ETH cluster. Remove operator 1 AND operator 2.
- Call `updateClusterBalance(EB=48 ETH)`.
- `_updateOperatorVUnits` writes to both `operatorEthVUnits[op1]` and `operatorEthVUnits[op2]`.
- **Assert: G11 VIOLATED for both op1 and op2.**

**INV-041: Removal + Liquidation with Explicit EB**
- Register 4 operators. Register ETH cluster. Call `updateClusterBalance(EB=48)` (deviation set).
- Remove operator 1. (`delete seb.operatorEthVUnits[op1]` — was nonzero, now 0.)
- Liquidate the cluster. `_executeLiquidation` deviation cleanup (SSVClusters.sol:586-592) subtracts deviation from ALL operatorIds.
- `seb.operatorEthVUnits[op1] -= deviation` — underflow or wraps (writes nonzero).
- **Assert: G11 VIOLATED.** Removed operator gets stale deviation subtraction.

**INV-042: Removal + Reactivation (Implicit EB)**
- Register 4 operators. Register ETH cluster. Remove operator 1. Liquidate cluster.
- Reactivate cluster. `updateClusterOperatorsOnReactivation` checks `operator.ethSnapshot.block != 0`.
- For removed op1: `ethSnapshot.block == 0`, so it is SKIPPED (OperatorLib.sol:291).
- **Assert: G11 PRESERVED** in this specific path (reactivation correctly skips removed ops).
- BUT: if a prior EB update had already written stale data, it persists.

**INV-043: Removal + Migration (with EB)**
- Register SSV cluster. Call `updateClusterBalance` to set EB on SSV side.
- Remove operator 1.
- Migrate SSV cluster to ETH. `migrateClusterToETH` (SSVClusters.sol:318-322) adds deviation to ALL operatorIds.
- `seb.operatorEthVUnits[op1] += deviation` — writes nonzero to removed operator.
- **Assert: G11 VIOLATED.**

**INV-044: Shared Operator Removal + Multiple EB Updates**
- Operator 1 is shared by cluster A (ops [1,2,3,4]) and cluster B (ops [1,5,6,7]).
- Remove operator 1.
- Cluster A calls `updateClusterBalance(EB=48)`. Writes `operatorEthVUnits[op1] += delta_A`.
- Cluster B calls `updateClusterBalance(EB=64)`. Writes `operatorEthVUnits[op1] += delta_B`.
- **Assert: G11 VIOLATED.** `operatorEthVUnits[op1] == delta_A + delta_B` (cumulative stale data from two independent clusters).

**INV-045: Full Lifecycle**
- Register 4 operators. Register ETH cluster. `updateClusterBalance(EB=48)` (deviation set).
- Remove operator 1. Liquidate cluster. Reactivate cluster.
- Assert: After full cycle, check `operatorEthVUnits[op1]`. If liquidation cleanup subtracted deviation (writing nonzero via underflow/wrap) and reactivation skipped op1, the stale data from liquidation persists.
- **Assert: G11 status depends on whether liquidation cleanup re-wrote the value.**

---

## INV-046 to INV-047: No Deviation Without EB (G12)

**Invariant G12:** If a cluster never called `updateClusterBalance`, then `seb.clusterEB[clusterId].vUnits == 0`.

**INV-046: Registration Only**
- Register ETH cluster. Do NOT call `updateClusterBalance`.
- Assert: `seb.clusterEB[clusterId].vUnits == 0`. `getVUnits()` returns fallback `validatorCount * BPS_DENOMINATOR`.

**INV-047: Normal Operations Without EB**
- Register, deposit, withdraw, advance blocks — never call `updateClusterBalance`.
- Assert: `seb.clusterEB[clusterId].vUnits == 0` throughout.

---

## INV-049 to INV-050: Composite Multi-Invariant Scenarios

**INV-049: Mixed SSV/ETH with Conservation + vUnit**
- Step 1: Register SSV cluster (ops [1,2,3,4]). Register ETH cluster (ops [5,6,7,8]).
- Step 2: Migrate SSV cluster to ETH with `msg.value = 10 ETH`.
- Step 3: `updateClusterBalance` on both clusters (EB=48 ETH/val).
- After each step, verify:
  - G1: `address(this).balance == Σ(ETH cluster balances) + Σ(op ETH earnings) + DAO ETH`
  - G4: `daoTotalEthVUnits == ethDaoValidatorCount * 10000 + Σ(deviations)`

**INV-050: Full Lifecycle Multi-Invariant Stress Test**
- Step 1: Register 4+4+4 operators (12 total). Register 3 ETH clusters on ops [1-4], [5-8], [9-12].
- Step 2: `updateClusterBalance(EB=48)` on cluster 1. G4 check.
- Step 3: Remove operator 2. G11 check.
- Step 4: Liquidate cluster 2. G1, G3, G4, G10 check.
- Step 5: Reactivate cluster 2. G1, G3, G4, G10 check.
- Step 6: `updateClusterBalance(EB=64)` on cluster 1 (with removed op2). G11 check (**expect violation**).
- Step 7: Migrate SSV cluster (if one exists) to ETH. G9 check.
- After EACH step, assert all 5 invariants (G1, G3, G4, G10, G11). Document which steps cause G11 violations.

---

## Coverage Matrix

Maps each invariant to the scenarios that test it, and which trigger flows exercise it:

| Invariant | Scenarios | Register | Deposit | Withdraw | Liquidate ETH | Liquidate SSV | Reactivate | Migration | EB Update | Op Removal | Op Withdraw | Stake/Unstake |
|-----------|-----------|----------|---------|----------|---------------|---------------|------------|-----------|-----------|------------|-------------|---------------|
| G1: ETH Conservation | INV-001 to INV-006, INV-049, INV-050 | x | x | x | x | | x | x | | | x | |
| G2: SSV Conservation | INV-007 to INV-010 | x | x | | | x | | x | | | | x |
| G3: Validator Count | INV-011 to INV-014, INV-050 | x | | | x | | x | | | x | | |
| G4: vUnit Consistency | INV-015 to INV-020, INV-049, INV-050 | x | | | x | | x | x | x | x | | |
| G5: Hash Integrity | INV-021 to INV-024 | x | x | | x | | x | | | | | |
| G6: cSSV Supply | INV-025, INV-026 | | | | | | | | | | | x |
| G7: Acc Monotonicity | INV-027, INV-028 | | | | | | | | | | | x |
| G8: Oracle Monotonicity | INV-029, INV-030 | | | | | | | | x | | | |
| G9: Version Exclusivity | INV-031 to INV-033, INV-048 | x | | | x | | | x | | | | |
| G10: Op Dual Tracking | INV-034 to INV-036, INV-050 | x | | | x | | x | | | | | |
| **G11: Removed Op Zero** | **INV-037 to INV-045, INV-050** | **x** | | | **x** | | **x** | **x** | **x** | **x** | | |
| G12: No Dev w/o EB | INV-046, INV-047 | x | x | x | | | | | | | | |

### G11 Detailed Trigger Matrix (Bug Detector)

| Scenario | Single Removal | Cascading Removal | Removal + EB Update | Removal + Liquidation | Removal + Reactivation | Removal + Migration | Shared Op Removal | Full Cycle | G11 Violated? |
|----------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| INV-037 | x | | | | | | | | No |
| INV-038 | x | | | | | | | | No |
| INV-039 | x | | x | | | | | | **YES** |
| INV-040 | | x | x | | | | | | **YES** |
| INV-041 | x | | | x | | | | | **YES** |
| INV-042 | x | | | | x | | | | Conditional |
| INV-043 | x | | | | | x | | | **YES** |
| INV-044 | | | x | | | | x | | **YES** |
| INV-045 | x | | x | x | x | | | x | **YES** |
| INV-050 | x | | x | x | x | x | | x | **YES** |

---

## Summary

**Total scenarios:** 50 (INV-001 through INV-050)

**Coverage by invariant:**
- G1 (ETH Conservation): 8 scenarios, exercised across register/deposit/withdraw/liquidate/reactivate/migrate/op-withdraw
- G2 (SSV Conservation): 4 scenarios, covering SSV cluster lifecycle + staking + migration
- G3 (Validator Count): 5 scenarios, verifying DAO count consistency across register/liquidate/reactivate/op-removal
- G4 (vUnit Consistency): 8 scenarios, the most complex invariant testing deviation-only accounting model
- G5 (Cluster Hash Integrity): 4 scenarios, verifying storage hash correctness after every state mutation
- G6 (cSSV Supply): 2 scenarios, mint/burn accounting across single and multi-user flows
- G7 (Accumulator Monotonicity): 2 scenarios, including zero-supply edge case
- G8 (Oracle Monotonicity): 2 scenarios, verifying latestCommittedBlock never decreases
- G9 (Version Exclusivity): 4 scenarios, ensuring clusters never exist in both SSV and ETH mappings
- G10 (Operator Dual Tracking): 3 scenarios, verifying ethValidatorCount == Σ(cluster validators)
- **G11 (Removed Operator Zero State): 9 scenarios (INV-037 to INV-045) + INV-050 — the most critical invariant and primary bug detector**
- G12 (No Deviation Without EB): 2 scenarios, confirming clusterEB.vUnits stays 0 without explicit EB updates

**Critical findings:**
- **G11 is violated in 7 of 10 scenarios** — the `_updateOperatorVUnits` and `_executeLiquidation` deviation cleanup paths iterate all operatorIds without checking `ethSnapshot.block != 0`, writing stale deviation data to removed operators
- **Root cause paths:** `SSVClusters.sol:494-510` (`_updateOperatorVUnits`), `SSVClusters.sol:586-592` (liquidation deviation cleanup), `SSVClusters.sol:318-322` (migration deviation addition)
- **Safe paths:** Reactivation (`OperatorLib.sol:291` correctly checks `block != 0`) and registration (`OperatorLib.sol:155-221` requires operator to exist)
- INV-050 is the comprehensive multi-invariant stress test that demonstrates the bug's impact on global accounting
