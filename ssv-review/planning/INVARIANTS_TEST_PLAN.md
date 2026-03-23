# Echidna Invariant Coverage Report

**Generated:** 2026-03-19
**Last updated:** 2026-03-23
**Sources:** SPEC.md, FLOWS.md, MAINNET-READINESS.md, echidna test files, unit/integration tests

---

## 1. Echidna Invariants Already Implemented (115 total)

### SSVAccountingEchidna.sol (7 invariants)
| # | Invariant | Description |
|---|-----------|-------------|
| 1 | `echidna_eth_conservation` | ETH balance + outflows >= inflows |
| 2 | `echidna_ssv_conservation` | SSV token balance <= minted amount |
| 3 | `echidna_eth_solvency` | Contract ETH balance >= net inflows |
| 4 | `echidna_operator_vunits_matches_clusters` | Operator effective vUnits align with all their active clusters |
| 5 | `echidna_migration_one_way` | Migrated SSV clusters removed from clusters[], present in ethClusters[] |
| 6 | `echidna_ssv_accrual_no_overflow` | SSV operator earnings never decrease due to overflow |
| 7 | `echidna_vunits_deviation_consistent` | Total DAO vUnits match sum of cluster vUnits + migrated clusters |

### SSVClustersEchidna.sol (18 invariants)
| # | Invariant | Description |
|---|-----------|-------------|
| 8 | `echidna_cluster_hash_consistent` | Stored cluster hash matches in-memory cluster data |
| 9 | `echidna_inactive_clusters_zeroed` | Inactive clusters have zero balance, index, networkFeeIndex |
| 10 | `echidna_cluster_balance_accounting` | Sum of tracked cluster balances matches expected total |
| 11 | `echidna_eth_balance_accounting` | Contract ETH >= all cluster balances + operator earnings + DAO + staking pool |
| 12 | `echidna_withdraw_limit_enforced` | Cannot withdraw more than cluster balance |
| 13 | `echidna_withdraw_conserves_balance` | Withdrew amount matches balance reduction (contract + owner) |
| 14 | `echidna_owner_withdraw_only` | Only cluster owner can withdraw |
| 15 | `echidna_liquidation_cleans_state` | Liquidation pays correct amount and resets cluster to empty |
| 16 | `echidna_reactivate_requires_inactive` | Cannot reactivate already-active cluster |
| 17 | `echidna_dust_liquidation_reachable` | Clusters with balance < burn rate are liquidatable |
| 18 | `echidna_eb_snapshot_block_lte_current` | EB snapshot lastUpdateBlock <= current block |
| 19 | `echidna_eb_snapshot_root_monotonic` | EB snapshot root block number never decreases |
| 20 | `echidna_eb_update_requires_root` | EB update reverts without committed Merkle root |
| 21 | `echidna_eb_update_frequency` | Cannot update EB twice within minBlocksBetweenUpdates window |
| 22 | `echidna_eb_update_staleness` | Cannot update EB with stale root |
| 23 | `echidna_fee_index_current_after_settle` | Fee indices are current after cluster settlement |
| 24 | `echidna_fee_uses_old_vunits_on_eb_change` | Fees computed with OLD vUnits on EB change |
| 25 | `echidna_liquidation_clears_eb_snapshot` | Liquidation zeros the EB snapshot |

### SSVOperatorsEchidna.sol (20 invariants)
| # | Invariant | Description |
|---|-----------|-------------|
| 26 | `echidna_unique_active_pubkeys` | No duplicate public keys among active operators |
| 27 | `echidna_id_monotonic` | Operator IDs never decrease |
| 28 | `echidna_registered_owners_non_zero` | All active operators have non-zero owner |
| 29 | `echidna_eth_fee_within_max` | Operator ETH fee <= protocol maximum |
| 30 | `echidna_eth_fee_minimum` | Operators registered with ETH fee >= protocol minimum |
| 31 | `echidna_declare_fee_from_zero_reverts` | Cannot declare fee increase from zero fee |
| 32 | `echidna_declare_does_not_change_fee` | Declare does not immediately change current fee |
| 33 | `echidna_execute_requires_valid_window` | Execute fails outside approval window |
| 34 | `echidna_execute_rejects_invalid_fee` | Execute fails if fee > max operator fee |
| 35 | `echidna_reduce_fee_decreases` | Reduce actually decreases fee and clears pending declarations |
| 36 | `echidna_withdraw_limit_enforced` | Cannot withdraw more ETH than operator balance |
| 37 | `echidna_withdraw_all_clears_balance` | withdrawAll zeros the ETH balance |
| 38 | `echidna_withdraw_conserves_balance` | Withdraw amount matches balance reduction |
| 39 | `echidna_earnings_monotonic` | Operator earnings never decrease |
| 40 | `echidna_fee_change_latency` | Fee index updates with correct latency |
| 41 | `echidna_eth_withdraw_keeps_ssv` | ETH withdrawal doesn't affect SSV balance |
| 42 | `echidna_ssv_withdraw_keeps_eth` | SSV withdrawal doesn't affect ETH balance |
| 43 | `echidna_owner_only_actions` | Non-owners cannot remove/declare/execute/withdraw |
| 44 | `echidna_remove_cleans_state` | Removal zeros fee, balances, snapshot blocks, validator count |
| 45 | `echidna_remove_pays_out` | Removal pays out both ETH and SSV balances exactly |

### SSVValidatorsEchidna.sol (8 invariants)
| # | Invariant | Description |
|---|-----------|-------------|
| 46 | `echidna_validator_hash_consistent` | Validator storage hash matches tracked state |
| 47 | `echidna_cluster_hash_consistent` | Cluster hash consistent with tracked state |
| 48 | `echidna_cluster_validator_counts` | Cluster validator count matches active validators |
| 49 | `echidna_operator_validator_counts` | Operator ethValidatorCount matches tracked registrations |
| 50 | `echidna_cluster_balance_accounting` | Sum of tracked cluster balances matches expected total |
| 51 | `echidna_no_duplicate_validators` | Cannot register same validator twice |
| 52 | `echidna_owner_only_remove` | Only validator owner can remove |
| 53 | `echidna_owner_only_exit` | Only validator owner can exit |

### SSVStakingEchidna.sol (15 invariants)
| # | Invariant | Description |
|---|-----------|-------------|
| 54 | `echidna_sync_fees_handles_decrease` | syncFees handles pool balance decrease correctly |
| 55 | `echidna_sync_fees_never_fails` | syncFees succeeds and produces correct pool balance |
| 56 | `echidna_invalid_stake_reverts` | Stake with amount < minimum reverts |
| 57 | `echidna_invalid_unstake_reverts` | Unstake with amount > balance or excess pending reverts |
| 58 | `echidna_invalid_withdraw_reverts` | Withdraw with no unlocked requests reverts |
| 59 | `echidna_cssv_supply_matches_users` | cSSV supply = sum of user balances = expected supply |
| 60 | `echidna_cssv_supply_lte_ssv_backing` | cSSV supply <= SSV token balance in contract |
| 61 | `echidna_ssv_balance_matches_staked_plus_pending` | SSV balance = cSSV supply + pending unstake |
| 62 | `echidna_pool_matches_dao_balance` | Staking ETH pool balance = DAO ETH balance |
| 63 | `echidna_pending_requests_bounded` | Pending unstake requests <= MAX_PENDING_REQUESTS (2000) |
| 64 | `echidna_user_index_leq_acc` | User accEthPerShare index <= global accumulator |
| 65 | `echidna_accrued_within_pool` | Accrued rewards (rounded down) <= available pool |
| 66 | `echidna_cssv_transfer_settles_both` | cSSV transfer triggers reward settlement for both parties |
| 67 | `echidna_claim_payout_precision` | Claim payout divisible by ETH_DEDUCTED_DIGITS |
| 68 | `echidna_no_free_rewards_on_transfer` | Transfer doesn't mint/destroy rewards |

### CSSVTokenEchidna.sol (9 invariants)
| # | Invariant | Description |
|---|-----------|-------------|
| 69 | `echidna_supply_equals_minted_minus_burned` | totalSupply = minted - burned |
| 70 | `echidna_burned_lte_minted` | Burned amount never exceeds minted |
| 71 | `echidna_individual_balance_lte_supply` | Each user balance <= totalSupply |
| 72 | `echidna_staking_is_self` | ssvStaking address = this contract |
| 73 | `echidna_name_immutable` | Name = "cSSV" |
| 74 | `echidna_symbol_immutable` | Symbol = "cSSV" |
| 75 | `echidna_decimals_is_18` | Decimals = 18 |
| 76 | `echidna_zero_address_has_no_balance` | Zero address balance = 0 |
| 77 | `echidna_supply_non_negative` | Supply >= 0 |

### SSVDAOEchidna.sol (23 invariants)
| # | Invariant | Description |
|---|-----------|-------------|
| 78 | `echidna_network_fee_matches_expected` | ETH network fee index monotonically increases correctly |
| 79 | `echidna_network_fee_ssv_matches_expected` | SSV network fee index monotonically increases correctly |
| 80 | `echidna_liquidation_thresholds_valid` | Liquidation thresholds >= minimum (21,480 blocks) |
| 81 | `echidna_quorum_bps_valid` | Quorum <= 10,000 BPS |
| 82 | `echidna_dao_balance_matches_expected` | DAO token balance = stored balance * DEDUCTED_DIGITS |
| 83 | `echidna_withdraw_limits_enforced` | Cannot overdraw DAO SSV balance |
| 84 | `echidna_withdraw_conserves_balance` | DAO withdrawal conserves token balance |
| 85 | `echidna_commit_root_only_oracle` | Non-oracle addresses cannot commit roots |
| 86 | `echidna_commit_root_no_duplicate_votes` | Same oracle cannot vote twice for same (block, root) pair |
| 87 | `echidna_commit_root_not_future` | Cannot commit root for future block number |
| 88 | `echidna_commit_root_not_stale` | Cannot commit root for block <= latestCommittedBlock |
| 89 | `echidna_committed_block_monotonic` | latestCommittedBlock never decreases |
| 90 | `echidna_commit_root_dust_round_reaches_quorum` | Dusty supply rounds reach quorum at 3 votes |
| 91 | `echidna_commit_root_dust_round_not_before_threshold` | Cannot finalize dusty round before 3 votes |
| 92 | `echidna_commit_root_dust_round_uses_truncated_supply` | Dusty round freezes truncated supply |
| 93 | `echidna_commit_root_below_oracle_count_reverts` | Cannot commit with fewer oracles than oracle slots |
| 94 | `echidna_oracle_mapping_consistent` | Oracle bidirectional mapping is consistent |
| 95 | `echidna_finalized_weight_cleared` | Finalized root commitments are cleared |
| 96 | `echidna_commitment_weight_lte_supply` | Commitment weight never exceeds cSSV total supply |
| 97 | `echidna_finalization_implies_quorum` | Root finalized only if weight >= quorum threshold |
| 98 | `echidna_dao_earnings_monotonic` | DAO earnings never decrease |
| 99 | `echidna_dao_index_block_lte_current` | DAO index blocks <= current block |
| 100 | `echidna_dao_earnings_matches_formula` | DAO earnings = (blockDelta * fee * vUnits) / BPS_DENOMINATOR |

### SSVMigrationEchidna.sol (3 invariants)
| # | Invariant | Description |
|---|-----------|-------------|
| 101 | `echidna_migration_removed_refund_exact` | Migration refunds exact SSV balance to cluster owner |
| 102 | `echidna_migration_removed_operator_not_eth_initialized` | Removed operators don't get ETH snapshot initialized during migration |
| 103 | `echidna_removed_operator_state_and_frozen_index_preserved` | Removed operators retain frozen snapshot.index |

### SSVEBProofEchidna.sol (3 invariants)
| # | Invariant | Description |
|---|-----------|-------------|
| 104 | `echidna_eb_merkle_proof_verified` | EB updates with invalid Merkle proofs are rejected |
| 105 | `echidna_eb_bounds_enforced` | EB outside [32, 2048] ETH/validator rejected |
| 106 | `echidna_eb_snapshot_fields_exact` | EB snapshot fields set exactly |

### CSSVTokenAccessControlEchidna.sol (3 invariants)
| # | Invariant | Description |
|---|-----------|-------------|
| 107 | `echidna_attacker_cannot_mint` | Non-authorized address cannot mint |
| 108 | `echidna_attacker_cannot_burn` | Non-authorized address cannot burn |
| 109 | `echidna_only_self_is_staking` | ssvStaking address is the contract itself |

### SSVOperatorFeeGovEchidna.sol (1 invariant)
| # | Invariant | Description |
|---|-----------|-------------|
| 110 | `echidna_execute_rejects_legacy_declarations` | Cannot execute fee requests declared before UPGRADE_TIMESTAMP |

### SSVEdgeCasesEchidna.sol (4+ invariants)
| # | Invariant | Description |
|---|-----------|-------------|
| 111 | `echidna_yoyo_liquidation_reachable` | Liquidate -> reactivate -> liquidate cycle succeeds |
| 112 | `echidna_reactivation_vunits_mismatch` | vUnits correctly handled in liquidation->reactivation flow |
| 113 | `echidna_validator_spam_no_failure` | Max validators per operator doesn't cause overflow |
| 114 | Additional edge cases | Fee index overflow, packing overflow, ETH accrual integrity |

### SSVLegacyClustersEchidna.sol (1 invariant)
| # | Invariant | Description |
|---|-----------|-------------|
| 115 | `echidna_ssv_liquidation_resets_and_pays` | SSV liquidation pays exact cluster balance and resets state |

---

## 2. Spec Invariants (SPEC.md Section 11 - Explicitly Labeled)

| # | Invariant | Spec Reference | Echidna Coverage |
|---|-----------|----------------|-----------------|
| A1 | **ETH Conservation**: `contract.ETH >= Sum(ETH cluster balances) + Sum(operator ETH earnings) + DAO ETH + staking pool` | SPEC L991-1002 | COVERED: `echidna_eth_balance_accounting`, `echidna_eth_conservation`, `echidna_eth_solvency` |
| A2 | **SSV Conservation**: `contract.SSV >= Sum(SSV cluster balances) + Sum(operator SSV earnings) + DAO SSV + stakingHeldSSV` | SPEC L1004-1015 | COVERED: `echidna_ssv_conservation` |
| A3 | **Validator Count Consistency**: `ethDaoValidatorCount == Sum(cluster.validatorCount)` across all active ETH clusters | SPEC L1017-1023 | **GAP**: per-cluster/per-operator counts tested but NOT the global DAO-level sum |
| A4 | **vUnit Consistency**: `daoTotalEthVUnits == ethDaoValidatorCount * BPS + Sum(cluster_deviations)` | SPEC L1025-1031 | COVERED: `echidna_vunits_deviation_consistent` |
| A5 | **Cluster Hash Integrity**: every operation ends with `s.ethClusters[key] == cluster.hashClusterData()` | SPEC L1033-1040 | COVERED: `echidna_cluster_hash_consistent` |
| A6 | **cSSV Supply Accounting**: `cSSV.totalSupply() == Sum(staked SSV) - Sum(unstake-requested SSV)` | SPEC L1042-1049 | COVERED: `echidna_cssv_supply_matches_users`, `echidna_ssv_balance_matches_staked_plus_pending` |
| A7 | **Accumulator Monotonicity**: `accEthPerShare` never decreases | SPEC L1051-1057 | COVERED: `echidna_user_index_leq_acc` (implicitly) |
| A8 | **Oracle Block Monotonicity**: `latestCommittedBlock` never decreases | SPEC L1059-1065 | COVERED: `echidna_committed_block_monotonic` |
| A9 | **Cluster Version Exclusivity**: `(s.clusters[key] != 0) XOR (s.ethClusters[key] != 0)` | SPEC L1067-1073 | **GAP**: `echidna_migration_one_way` checks post-migration but NOT the global XOR across all keys |
| A10 | **Operator Dual Tracking**: `operator.validatorCount + operator.ethValidatorCount == total validators using operator` | SPEC L1075-1082 | **GAP**: per-version counts tested separately, cross-version sum never asserted |

---

## 3. Gap Analysis: Spec'd but NOT Fuzz-Tested

### HIGH Priority (Accounting & Core Safety)

| ID | Invariant | Spec Source | Why It Matters |
|----|-----------|-------------|----------------|
| **A3** | `ethDaoValidatorCount == Sum(cluster.validatorCount)` global sum | SPEC L1017 | Wrong DAO validator count -> wrong network fee calculations for all clusters |
| **A9** | Cluster version exclusivity: `clusters[key] XOR ethClusters[key]` globally | SPEC L1067 | Violation means a cluster exists in both maps -> double-accounting, double-liquidation |
| **A10** | Operator dual tracking: `op.validatorCount + op.ethValidatorCount == total` | SPEC L1075 | Cross-version validator count mismatch -> earnings drift, wrong EB baselines |
| **B7** | Implicit EB default: when `clusterEB.vUnits == 0`, use `validatorCount * BPS_DENOMINATOR` | SPEC L322 | Wrong default vUnits -> wrong fee accrual for all clusters before first EB update |
| **B8** | SSV clusters never use EB for fee scaling | SPEC L325 | If SSV fees accidentally used EB, legacy cluster balances would drain at wrong rate |
| **B9** | Fee settlement uses old rate before storing new rate | SPEC L892 | Out-of-order settlement -> operators earn fees at new rate for blocks served at old rate |
| **C8** | Rewards STOP accruing at exact `requestUnstake` moment for burned portion | SPEC L447 | If rewards continue accruing on burned cSSV, reward pool drains faster than expected |
| **E3** | Net-zero validator shift on migration: SSV count down, ETH count up by same N | FLOWS L452 | Non-zero-sum shift -> DAO counts diverge from reality -> fee/liquidation miscalculations |

### MEDIUM Priority (Lifecycle & Edge Cases)

| ID | Invariant | Spec Source | Why It Matters |
|----|-----------|-------------|----------------|
| **B11** | Cluster balance never negative after arbitrary operation sequences | SPEC L933 | `max(0, balance - fees)` pattern could be bypassed in edge cases under fuzzing |
| **C9** | Dust forfeiture: `remainder > 0 && balanceOf == 0` -> dust forfeited; `balanceOf > 0` -> preserved | SPEC L412-422 | Wrong dust handling -> either locked ETH or reward inflation |
| **C10** | Zero-cSSV users cannot accrue future rewards | SPEC L420 | If accrual continues with zero balance, `pendingReward` computation is undefined |
| **C11** | `withdrawUnlocked` batch processes ALL matured requests, leaves immature intact | SPEC L115 | Partial processing -> stuck SSV tokens; wrong swap-and-pop -> data corruption |
| **D3** | Deposit into liquidated cluster succeeds | FLOWS L278 | If blocked, users cannot prepare for reactivation |
| **D4** | Withdraw from liquidated cluster (fee settlement skipped) succeeds | FLOWS L309 | If blocked or fees applied, users lose funds from dead clusters |
| **D6** | Reactivation with removed operators: removed operators silently skipped | FLOWS L387 | If revert, clusters with removed operators are permanently stuck |
| **G1** | Removed operator `owner` field preserved (non-zero) | FLOWS L640 | If zeroed, off-chain systems lose operator identity; re-registration detection breaks |
| **G2** | Removed operator earnings remain withdrawable post-removal | FLOWS L640 | If not, operators lose earned fees on removal |
| **G6** | `ensureETHDefaults` initialization: first ETH interaction sets `ethFee = DEFAULT_OPERATOR_ETH_FEE` | SPEC L269 | Wrong initialization -> operators charge wrong ETH fee to all clusters |

### LOW Priority (Oracle & Token Bounds)

| ID | Invariant | Spec Source | Why It Matters |
|----|-----------|-------------|----------------|
| **C12** | `cSSV.totalSupply() <= SSV.totalSupply()` | FLOWS L866 | Theoretical upper bound; violation implies unbacked cSSV |
| **F9** | Failed quorum proposals persist (no auto-cleanup) | SPEC L476 | Storage hygiene; not a security issue but verifies no unintended cleanup |
| **F10** | Re-voting same `blockNum` with different root succeeds | SPEC L74 | Oracle operational flexibility; positive-case coverage |
| **F11** | Frozen voting supply exact formula on first vote (truncated to multiple of oracle count) | SPEC L463 | Already partially covered by dust-round tests |

---

## 4. Cross-Reference with Unit/Integration Tests

Some gaps above ARE tested in the JS test suite but NOT under fuzzing:

| Gap ID | JS Test Coverage | Fuzzing Value |
|--------|-----------------|---------------|
| A3 | `test/e2e/cross-cutting/validator-count-invariant.test.ts` | Fuzzing would catch edge cases in concurrent register/remove/liquidate/migrate sequences |
| B11 | `test/simulation/invariants.ts` (Monte Carlo) | Echidna explores more state-space than simulation |
| D3 | `test/unit/SSVClusters/deposit.test.ts` | Fuzzing would test deposit-into-liquidated with arbitrary cluster states |
| D4 | Implicitly in `test/unit/SSVClusters/withdraw.test.ts` | Fuzzing would test withdraw-from-liquidated with fee edge cases |
| G1 | `test/unit/SSVOperators/removeOperator.test.ts` | Fuzzing would test removal after complex operator lifecycle sequences |
| G2 | `test/unit/SSVOperators/withdrawOperatorEarnings.test.ts` | Fuzzing would test post-removal withdrawal under arbitrary fee/EB states |

---

## 5. Recommended Implementation Order

### Phase 1: Global Accounting Invariants (HIGH impact, moderate effort)
1. **A3** - Add `echidna_dao_validator_count_consistent` to SSVAccountingEchidna `[DONE 2026-03-23]`
2. **A9** - Add `echidna_cluster_version_exclusive` to SSVAccountingEchidna `[DONE 2026-03-23]`
3. **A10** - Add `echidna_operator_total_validators_consistent` to SSVAccountingEchidna `[DONE 2026-03-23]`
4. **E3** - Add `echidna_migration_net_zero_validators` to SSVMigrationEchidna `[DONE 2026-03-23]`

### Phase 2: Fee Calculation Correctness (HIGH impact, higher effort)
5. **B7** - Add `echidna_implicit_eb_default_used` to SSVClustersEchidna `[DONE 2026-03-23]`
6. **B8** - Add `echidna_ssv_fees_ignore_eb` to SSVLegacyClustersEchidna `[DONE 2026-03-23]`
7. **B9** - Add `echidna_fee_settle_before_change` to SSVOperatorsEchidna `[DONE 2026-03-23]`

### Phase 3: Staking Reward Edge Cases (HIGH impact, moderate effort)
8. **C8** - Add `echidna_unstake_stops_accrual` to SSVStakingEchidna
9. **C9** - Add `echidna_dust_forfeiture_correct` to SSVStakingEchidna
10. **C10** - Add `echidna_zero_cssv_no_accrual` to SSVStakingEchidna

### Phase 4: Cluster Lifecycle Edges (MEDIUM impact, lower effort)
11. **B11** - Add `echidna_cluster_balance_non_negative` to SSVClustersEchidna
12. **C11** - Add `echidna_withdraw_unlocked_batch_correct` to SSVStakingEchidna
13. **D3** - Add `echidna_deposit_liquidated_succeeds` to SSVClustersEchidna
14. **D4** - Add `echidna_withdraw_liquidated_skips_fees` to SSVClustersEchidna
15. **D6** - Add `echidna_reactivate_with_removed_operators` to SSVClustersEchidna

### Phase 5: Operator Lifecycle (MEDIUM impact, lower effort)
16. **G1** - Add `echidna_removed_operator_owner_preserved` to SSVOperatorsEchidna
17. **G2** - Add `echidna_removed_operator_earnings_withdrawable` to SSVOperatorsEchidna
18. **G6** - Add `echidna_ensure_eth_defaults_correct` to SSVOperatorsEchidna

### Phase 6: Token & Oracle Edges (LOW impact, low effort)
19. **C12** - Add `echidna_cssv_supply_lte_ssv_total_supply` to CSSVTokenEchidna
20. **F9** - Add `echidna_failed_quorum_persists` to SSVDAOEchidna
21. **F10** - Add `echidna_revote_different_root_succeeds` to SSVDAOEchidna
22. **F11** - Extend existing dust-round tests in SSVDAOEchidna

### Progress

| Phase | Scope | Status |
|------|-------|--------|
| Phase 1 | Global accounting invariants (`A3`, `A9`, `A10`, `E3`) | COMPLETED |
| Phase 2 | Fee calculation correctness (`B7`, `B8`, `B9`) | COMPLETED |
| Phase 3 | Staking reward edge cases (`C8`, `C9`, `C10`) | NOT STARTED |
| Phase 4 | Cluster lifecycle edges (`B11`, `C11`, `D3`, `D4`, `D6`) | NOT STARTED |
| Phase 5 | Operator lifecycle (`G1`, `G2`, `G6`) | NOT STARTED |
| Phase 6 | Token & oracle edges (`C12`, `F9`, `F10`, `F11`) | NOT STARTED |

### Phase 1 Completion

| Gap ID | Invariant | Harness | Status |
|-------|-----------|---------|--------|
| A3 | `echidna_dao_validator_count_consistent` | `SSVAccountingEchidna.sol` | COMPLETED |
| A9 | `echidna_cluster_version_exclusive` | `SSVAccountingEchidna.sol` | COMPLETED |
| A10 | `echidna_operator_total_validators_consistent` | `SSVAccountingEchidna.sol` | COMPLETED |
| E3 | `echidna_migration_net_zero_validators` | `SSVMigrationEchidna.sol` | COMPLETED |

### Phase 1 Validation

| Check | Result |
|------|--------|
| `npx hardhat compile` | PASS |
| `echidna test/echidna/SSVAccountingEchidna.sol --contract SSVAccountingEchidna --config test/echidna/echidna.yaml` | PASS |
| `echidna test/echidna/SSVMigrationEchidna.sol --contract SSVMigrationEchidna --config test/echidna/echidna.yaml` | PASS |
| `SSVAccountingEchidna` with seed `8525641213984558505` | PASS |
| `SSVAccountingEchidna` with seed `985768268619296310` | PASS |
| `SSVMigrationEchidna` with seed `8525641213984558505` | PASS |
| `SSVMigrationEchidna` with seed `985768268619296310` | PASS |

### Phase 2 Completion

| Gap ID | Invariant | Harness | Status |
|-------|-----------|---------|--------|
| B7 | `echidna_implicit_eb_default_used` | `SSVClustersEchidna.sol` | COMPLETED |
| B8 | `echidna_ssv_fees_ignore_eb` | `SSVLegacyClustersEchidna.sol` | COMPLETED |
| B9 | `echidna_fee_settle_before_change` | `SSVOperatorsEchidna.sol` | COMPLETED |

### Phase 2 Validation

| Check | Result |
|------|--------|
| `npx hardhat compile` | PASS |
| `echidna test/echidna/SSVClustersEchidna.sol --contract SSVClustersEchidna --config test/echidna/echidna.yaml` | PASS |
| `echidna test/echidna/SSVLegacyClustersEchidna.sol --contract SSVLegacyClustersEchidna --config test/echidna/echidna.yaml` | PASS |
| `echidna test/echidna/SSVOperatorsEchidna.sol --contract SSVOperatorsEchidna --config test/echidna/echidna.yaml` | PASS |
| `SSVClustersEchidna` with seed `8525641213984558505` | PASS |
| `SSVClustersEchidna` with seed `985768268619296310` | PASS |
| `SSVLegacyClustersEchidna` with seed `8525641213984558505` | PASS |
| `SSVLegacyClustersEchidna` with seed `985768268619296310` | PASS |
| `SSVOperatorsEchidna` with seed `8525641213984558505` | PASS |
| `SSVOperatorsEchidna` with seed `985768268619296310` | PASS |
