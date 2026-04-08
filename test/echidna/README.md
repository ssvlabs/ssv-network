# Echidna Invariant Testing — SSV Network v2

Fuzz testing for SSV Network v2 smart contracts using [Echidna](https://github.com/crytic/echidna).

## Quick Start (macOS)

```bash
bash test/echidna/run-echidna.sh
```

Both CI and `bash test/echidna/run-echidna.sh` auto-discover every harness matching `test/echidna/*Echidna.sol`.

## Manual Setup

```bash
brew install echidna solc-select
solc-select install 0.8.24 && solc-select use 0.8.24
```

## Running Tests

```bash
echidna test/echidna/CSSVTokenEchidna.sol --contract CSSVTokenEchidna --config test/echidna/echidna.yaml
echidna test/echidna/CSSVTokenAccessControlEchidna.sol --contract CSSVTokenAccessControlEchidna --config test/echidna/echidna.yaml
echidna test/echidna/SSVOperatorsEchidna.sol --contract SSVOperatorsEchidna --config test/echidna/echidna.yaml
echidna test/echidna/SSVClustersEchidna.sol --contract SSVClustersEchidna --config test/echidna/echidna.yaml
echidna test/echidna/SSVAccountingEchidna.sol --contract SSVAccountingEchidna --config test/echidna/echidna.yaml
echidna test/echidna/SSVEdgeCasesEchidna.sol --contract SSVEdgeCasesEchidna --config test/echidna/echidna.yaml
echidna test/echidna/SSVValidatorsEchidna.sol --contract SSVValidatorsEchidna --config test/echidna/echidna.yaml
echidna test/echidna/SSVStakingEchidna.sol --contract SSVStakingEchidna --config test/echidna/echidna.yaml
echidna test/echidna/SSVDAOEchidna.sol --contract SSVDAOEchidna --config test/echidna/echidna.yaml
echidna test/echidna/SSVMigrationEchidna.sol --contract SSVMigrationEchidna --config test/echidna/echidna.yaml
echidna test/echidna/SSVEBProofEchidna.sol --contract SSVEBProofEchidna --config test/echidna/echidna.yaml
echidna test/echidna/SSVOperatorFeeGovEchidna.sol --contract SSVOperatorFeeGovEchidna --config test/echidna/echidna.yaml
echidna test/echidna/SSVLegacyClustersEchidna.sol --contract SSVLegacyClustersEchidna --config test/echidna/echidna.yaml
```

## Files

```
test/echidna/
├── CSSVTokenEchidna.sol              # Core invariants (9 tests)
├── CSSVTokenAccessControlEchidna.sol # Access control (3 tests)
├── SSVOperatorsEchidna.sol           # Operators invariants (20 tests)
├── SSVClustersEchidna.sol            # Clusters invariants (19 tests)
├── SSVAccountingEchidna.sol          # System accounting invariants (7 tests)
├── SSVEdgeCasesEchidna.sol           # Edge-case invariants (7 tests)
├── SSVValidatorsEchidna.sol          # Validators invariants (8 tests)
├── SSVStakingEchidna.sol             # Staking invariants (16 tests)
├── SSVDAOEchidna.sol                 # DAO invariants (23 tests)
├── SSVMigrationEchidna.sol           # Migration invariants (6 tests) [BUG-14]
├── SSVEBProofEchidna.sol             # EB proof invariants (3 tests) [FUZZ-3 B6/B7/B8]
├── SSVOperatorFeeGovEchidna.sol      # Operator fee governance (1 test) [FUZZ-3 B19]
├── SSVLegacyClustersEchidna.sol      # Legacy SSV cluster liquidation (1 test) [FUZZ-3 B15]
├── echidna.yaml
├── run-echidna.sh
└── README.md
```

## CSSVTokenEchidna (9 Invariants)

| Property | Description |
|----------|-------------|
| `echidna_supply_equals_minted_minus_burned` | Supply integrity |
| `echidna_burned_lte_minted` | No underflow |
| `echidna_individual_balance_lte_supply` | No balance > supply |
| `echidna_staking_is_self` | ssvStaking immutable |
| `echidna_name_immutable` | Name is "cSSV" |
| `echidna_symbol_immutable` | Symbol is "cSSV" |
| `echidna_decimals_is_18` | Standard decimals |
| `echidna_zero_address_has_no_balance` | Zero addr check |
| `echidna_supply_non_negative` | No negative supply |

## CSSVTokenAccessControlEchidna (3 Invariants)

| Property | Description |
|----------|-------------|
| `echidna_attacker_cannot_mint` | Unauthorized mint blocked |
| `echidna_attacker_cannot_burn` | Unauthorized burn blocked |
| `echidna_only_self_is_staking` | Single authorized address |

## SSVOperatorsEchidna (20 Invariants)

| Property | Description |
|----------|-------------|
| `echidna_unique_active_pubkeys` | No duplicate active operator public keys |
| `echidna_id_monotonic` | Operator IDs strictly increase |
| `echidna_registered_owners_non_zero` | Owners are non-zero |
| `echidna_eth_fee_within_max` | ETH fee <= max fee |
| `echidna_eth_fee_minimum` | ETH fee is 0 or >= minimum |
| `echidna_declare_does_not_change_fee` | Declaration does not change fee |
| `echidna_execute_requires_valid_window` | Execute respects approval window |
| `echidna_execute_rejects_invalid_fee` | Execute rejects invalid fee |
| `echidna_reduce_fee_decreases` | Reduce strictly decreases fee |
| `echidna_withdraw_limit_enforced` | Cannot withdraw more than earnings |
| `echidna_withdraw_all_clears_balance` | withdrawAll clears balance |
| `echidna_withdraw_conserves_balance` | Withdrawals conserve balances |
| `echidna_earnings_monotonic` | Earnings never decrease without withdrawals |
| `echidna_fee_change_latency` | Fee change applies only after execution |
| `echidna_eth_withdraw_keeps_ssv` | ETH withdraws do not touch SSV earnings |
| `echidna_ssv_withdraw_keeps_eth` | SSV withdraws do not touch ETH earnings |
| `echidna_owner_only_actions` | Owner-only access enforced |
| `echidna_remove_cleans_state` | Removal zeroes operator state |
| `echidna_remove_pays_out` | Removal pays out and reduces holdings |
| `echidna_declare_fee_from_zero_reverts` | **[FUZZ-3 B17]** Declaring non-zero ETH fee when both fees are 0 reverts |

## SSVClustersEchidna (19 Invariants)

This harness also instantiates staking claimants and operator owners so `echidna_eth_balance_accounting` is exercised through `claimEthRewards` and `withdrawOperatorEarnings`, not only cluster flows.

| Property | Description |
|----------|-------------|
| `echidna_cluster_hash_consistent` | Stored cluster hash matches local view |
| `echidna_inactive_clusters_zeroed` | Inactive clusters are zeroed |
| `echidna_cluster_balance_accounting` | Cluster balance accounting matches totals |
| `echidna_withdraw_limit_enforced` | Cannot withdraw more than balance |
| `echidna_withdraw_conserves_balance` | Withdrawals conserve balances |
| `echidna_owner_withdraw_only` | Only owner can withdraw |
| `echidna_liquidation_cleans_state` | Liquidation zeroes cluster and pays out |
| `echidna_reactivate_requires_inactive` | Reactivation only from inactive |
| `echidna_dust_liquidation_reachable` | Dust balances become liquidatable after burn |
| `echidna_eb_snapshot_block_lte_current` | EB snapshot update block never exceeds current block |
| `echidna_eb_snapshot_root_monotonic` | Cluster EB root block number never decreases |
| `echidna_eb_update_requires_root` | EB update cannot succeed without a committed root |
| `echidna_eb_update_requires_latest_root` | EB update must use the latest committed root |
| `echidna_eb_update_frequency` | EB update frequency limit is enforced |
| `echidna_eb_update_staleness` | EB updates reject stale root block numbers |
| `echidna_inactive_eb_update_skips_accounting` | Inactive/liquidated ETH EB updates only refresh the EB snapshot |
| `echidna_fee_index_current_after_settle` | Cluster fee indices settle to current protocol indices |
| `echidna_fee_uses_old_vunits_on_eb_change` | Fee settlement on EB change uses pre-update vUnits |
| `echidna_eth_balance_accounting` | ETH balance covers cluster, operator, DAO, and staking liabilities |

## SSVAccountingEchidna (7 Invariants)

| Property | Description |
|----------|-------------|
| `echidna_eth_conservation` | ETH conservation across clusters/operators/DAO |
| `echidna_ssv_conservation` | SSV conservation across clusters/operators/DAO |
| `echidna_eth_solvency` | ETH solvency for all tracked balances |
| `echidna_operator_vunits_matches_clusters` | Per-operator deviation equals sum of cluster deviations containing that operator (C6) |
| `echidna_migration_one_way` | After migrateClusterToETH: SSV cluster deleted, ETH cluster active (C7) |
| `echidna_ssv_accrual_no_overflow` | SSV operator balance never decreases during max-param accrual (X5) |
| `echidna_vunits_deviation_consistent` | daoTotalEthVUnits equals sum of effective vUnits across all active ETH clusters (C5) |

## SSVEdgeCasesEchidna (7 Invariants)

| Property | Description |
|----------|-------------|
| `echidna_yoyo_liquidation_reactivates` | Repeated liquidate/reactivate remains reachable |
| `echidna_reactivation_restores_vunits` | Reactivation restores EB-weighted vUnits |
| `echidna_validator_spam_safe` | High validator counts do not corrupt snapshots |
| `echidna_fee_index_overflow_protected` | Fee index overflow paths revert safely |
| `echidna_eth_accrual_no_overflow` | ETH operator balance never decreases during max-param accrual (X4) |
| `echidna_intermediate_mul_no_overflow` | `fee * effectiveVUnits` product stays within uint128 for max protocol params (X6) |
| `echidna_pack_reverts_on_overflow` | Packing a value exceeding uint64 max reverts, never truncates (X7) |

## SSVValidatorsEchidna (8 Invariants)

| Property | Description |
|----------|-------------|
| `echidna_validator_hash_consistent` | Validator state matches stored operator ids |
| `echidna_cluster_hash_consistent` | Cluster hash matches local view |
| `echidna_cluster_validator_counts` | Cluster validatorCount matches active validators |
| `echidna_operator_validator_counts` | Operator ethValidatorCount matches expectations |
| `echidna_cluster_balance_accounting` | Cluster balances sum to expected total |
| `echidna_no_duplicate_validators` | Duplicate validators cannot be registered |
| `echidna_owner_only_remove` | Only owner can remove validators |
| `echidna_owner_only_exit` | Only owner can exit validators |

## SSVStakingEchidna (16 Invariants)

| Property | Description |
|----------|-------------|
| `echidna_sync_fees_handles_decrease` | Sync fees does not fail when earnings decrease |
| `echidna_sync_fees_never_fails` | Sync fees never fails or mismatches |
| `echidna_invalid_stake_reverts` | Invalid stake amounts are rejected |
| `echidna_invalid_unstake_reverts` | Invalid unstake requests are rejected |
| `echidna_invalid_withdraw_reverts` | Withdraw with no unlocked balance is rejected |
| `echidna_cssv_supply_matches_users` | cSSV supply matches tracked user balances |
| `echidna_cssv_supply_lte_ssv_backing` | cSSV supply never exceeds SSV backing |
| `echidna_ssv_balance_matches_staked_plus_pending` | Contract SSV balance equals staked plus pending |
| `echidna_pool_matches_dao_balance` | ETH pool balance matches DAO balance |
| `echidna_claim_twice_same_block_no_second_payout` | A second reward claim in the same block cannot pay out twice |
| `echidna_pending_requests_bounded` | Withdrawal request count stays within bounds |
| `echidna_user_index_leq_acc` | User index never exceeds global accumulator |
| `echidna_accrued_within_pool` | Accrued rewards stay within pool balance |
| `echidna_cssv_transfer_settles_both` | cSSV transfer settles sender and receiver reward indices |
| `echidna_claim_payout_precision` | Claimed ETH payout always respects packing precision |
| `echidna_no_free_rewards_on_transfer` | Transfers cannot move already-accrued rewards between users |

## SSVDAOEchidna (23 Invariants)

| Property | Description |
|----------|-------------|
| `echidna_network_fee_matches_expected` | ETH network fee index is consistent with block number |
| `echidna_network_fee_ssv_matches_expected` | SSV network fee index is consistent with block number |
| `echidna_liquidation_thresholds_valid` | Liquidation thresholds respect minimums |
| `echidna_quorum_bps_valid` | Quorum stays within bounds |
| `echidna_dao_balance_matches_expected` | DAO balance matches token holdings |
| `echidna_withdraw_limits_enforced` | Withdrawals cannot exceed balance |
| `echidna_withdraw_conserves_balance` | Withdrawals conserve balances |
| `echidna_commit_root_only_oracle` | Only oracles can commit roots |
| `echidna_commit_root_no_duplicate_votes` | Oracles cannot vote twice on the same key |
| `echidna_commit_root_not_future` | Commit block is not in the future |
| `echidna_commit_root_not_stale` | Commit block is newer than last committed |
| `echidna_committed_block_monotonic` | Latest committed block is monotonic |
| `echidna_commit_root_dust_round_reaches_quorum` | Shared-root dusty round still commits on the third vote at 75% quorum |
| `echidna_commit_root_dust_round_not_before_threshold` | Dusty shared-root round cannot commit before the third unique vote |
| `echidna_commit_root_dust_round_uses_truncated_supply` | Pending dusty rounds store truncated frozen voting supply |
| `echidna_commit_root_below_oracle_count_reverts` | Rounds with supply below oracle count always revert with zero weight |
| `echidna_oracle_mapping_consistent` | Oracle ID mappings remain consistent |
| `echidna_finalized_weight_cleared` | Finalized commitment keys clear accumulated weight |
| `echidna_commitment_weight_lte_supply` | Commitment weight never exceeds the round's frozen voting supply |
| `echidna_finalization_implies_quorum` | Root finalization only happens at/above the quorum threshold for the round's frozen voting supply |
| `echidna_dao_earnings_monotonic` | Gross DAO earnings do not decrease over time |
| `echidna_dao_index_block_lte_current` | DAO index block numbers never exceed current block |
| `echidna_dao_earnings_matches_formula` | **[FUZZ-3 C4]** ETH DAO earnings matches `daoBalance + blockDelta × fee × vUnits / precision` |

## SSVEBProofEchidna (3 Invariants) — FUZZ-3 B6/B7/B8

Tests `updateClusterBalance` Merkle proof correctness and EB bounds enforcement.
Setup: single operator (zero fees), 4-validator ETH cluster, single-leaf Merkle tree built in-harness.

| Property | Description |
|----------|-------------|
| `echidna_eb_merkle_proof_verified` | **[B6]** A tampered `effectiveBalance` (≠ committed value) is rejected by the proof check |
| `echidna_eb_bounds_enforced` | **[B7]** `effectiveBalance` outside `[validatorCount×32, validatorCount×2048]` is rejected |
| `echidna_eb_snapshot_fields_exact` | **[B8]** After a valid update: `vUnits == ebToVUnits(eb)`, `lastRootBlockNum == blockNum`, `lastUpdateBlock == block.number` |

## SSVOperatorFeeGovEchidna (1 Invariant) — FUZZ-3 B19

Tests that `executeOperatorFee` rejects fee-change requests whose `approvalBeginTime` predates the migration.
Setup: `UPGRADE_TIMESTAMP = 1`; legacy requests are planted directly into storage with `approvalBeginTime = 1`.

| Property | Description |
|----------|-------------|
| `echidna_execute_rejects_legacy_declarations` | **[B19]** `executeOperatorFee` always reverts when the stored declaration has `approvalBeginTime ≤ UPGRADE_TIMESTAMP` |

## SSVLegacyClustersEchidna (1 Invariant) — FUZZ-3 B15

Tests that `liquidateSSV` correctly resets legacy SSV cluster state and transfers the SSV balance to the liquidator.
Setup: two SSV operators with non-zero fees, one active SSV cluster, liquidator == cluster owner (self-liquidation path).

| Property | Description |
|----------|-------------|
| `echidna_ssv_liquidation_resets_and_pays` | **[B15]** After `liquidateSSV` succeeds: cluster is inactive with zeroed indexes/balance, and the SSV balance was fully transferred to the liquidator |

## SSVMigrationEchidna (6 Invariants) — BUG-14

Tests SSV→ETH migration accounting when operators were removed before migration and must keep their frozen SSV indices, plus the legacy `updateClusterBalance` snapshot-only path that prepares SSV clusters for future migration.
Setup: one legacy SSV cluster with three operators, with harness actions for operator removal, block advancement, legacy EB updates, self-liquidation, and ETH migration from both active and liquidated states.

| Property | Description |
|----------|-------------|
| `echidna_migration_removed_refund_exact` | On successful SSV→ETH migration, refunded SSV equals settlement computed with the full cumulative SSV index, including removed operators' frozen `snapshot.index` |
| `echidna_migration_removed_operator_not_eth_initialized` | Operators removed before migration remain excluded from ETH initialization and ETH validator-count updates |
| `echidna_migration_net_zero_validators` | Successful active-cluster migration shifts validator counts from SSV DAO accounting to ETH DAO accounting without changing the total |
| `echidna_removed_operator_state_and_frozen_index_preserved` | Removed operators keep zeroed snapshot blocks while preserving their frozen `snapshot.index` across later actions |
| `echidna_liquidated_migration_branch_correct` | Successful migration of an already-liquidated SSV cluster keeps SSV DAO counts unchanged, initializes the ETH cluster, and does not refund extra SSV |
| `echidna_ssv_eb_update_only_snapshot` | Legacy `updateClusterBalance` updates only `clusterEB` and leaves SSV cluster/accounting state unchanged |

---

## Planned Invariants (Remaining)

Evaluated from `ssv-review/planning/SSVNetwork — Enrich Invariant Suite.md` against the 119 existing invariants above. Only invariants that are **not already covered** are listed below. Grouped by priority.

### Strengthen Existing (partial coverage → full)

These existing invariants should be upgraded to catch more subtle bugs:

| Existing Property | Upgrade | Ref |
|---|---|---|
| `echidna_network_fee_matches_expected` | Add explicit monotonicity: track `prevEthIndex` / `prevSsvIndex` in harness, assert never decreases | A8 |
| `echidna_cssv_supply_matches_users` | Add per-operation delta: on stake `amount`, assert cSSV supply increased by exactly `amount` | A11 |
| `echidna_user_index_leq_acc` | Strengthen to exact equality: after `_settle(user)`, assert `userIndex[user] == accEthPerShare` | A14 |
| `echidna_pool_matches_dao_balance` | Add per-claim delta: on successful claim of `payout`, assert both `stakingEthPoolBalance` and `ethDaoBalance` decreased by exactly `payout` | A16 |
| `echidna_accrued_within_pool` | Add cumulative tracking: wrap `claimEthRewards` to track `totalEthPaidOut`, assert `totalEthPaidOut <= totalEthCredited` | C2 |

### High Priority — New Invariants

Directly testable with current harness patterns. High bug-catching value.

#### Oracle / EB Governance

| Planned Property | Type | Description | Ref |
|---|---|---|---|
| `echidna_finalized_weight_cleared` | Always | If `ebRoots[blockNum] == root != 0`, then `rootCommitments[key] == 0` — prevents re-finalization | A4 |
| `echidna_commitment_weight_lte_supply` | Always | For each tracked `commitmentKey`, `rootCommitments[key] <= roundFrozenSupply[key]` while the round is pending — catches quorum overflow | A5 |
| `echidna_finalization_implies_quorum` | Conditional | At finalization time, accumulated weight >= `threshold(roundFrozenSupply[key], quorumBps)` — catches quorum bypass | B1 |

#### DAO Accounting

| Planned Property | Type | Description | Ref |
|---|---|---|---|
| `echidna_dao_earnings_monotonic` | Always | `networkTotalEarnings()` (ETH) and `networkTotalEarningsSSV()` never decrease as `block.number` advances — catches settlement regression | A9 |
| `echidna_dao_index_block_lte_current` | Always | `ethDaoIndexBlockNumber <= block.number` and `daoIndexBlockNumber <= block.number` — catches "time-travel" indices | A10 |

#### Staking Rewards Precision

| Planned Property | Type | Description | Ref |
|---|---|---|---|
| `echidna_cssv_transfer_settles_both` | Always | After `onCSSVTransfer(from, to, amount)`, both `userIndex[from]` and `userIndex[to]` equal `accEthPerShare` — catches reward smuggling via transfer | A15 |
| `echidna_claim_payout_precision` | Always | Any successful claim `payout` satisfies `payout % ETH_DEDUCTED_DIGITS == 0` — catches precision bypass | A17 |
| `echidna_no_free_rewards_on_transfer` | Candidate | cSSV transfer does not move already-accrued rewards from sender to receiver — catches reward smuggling (needs 2-actor before/after tracking) | C3 |

#### EB Snapshot Safety

| Planned Property | Type | Description | Ref |
|---|---|---|---|
| `echidna_eb_snapshot_block_lte_current` | Always | `clusterEB[id].lastUpdateBlock <= block.number` — catches future-dated EB snapshots | A18 |
| `echidna_eb_snapshot_root_monotonic` | Always | `clusterEB[id].lastRootBlockNum` never decreases per cluster — catches stale proof replay | A19 |

#### EB Update Correctness

| Planned Property | Type | Description | Ref |
|---|---|---|---|
| `echidna_eb_update_requires_root` | Conditional | `updateClusterBalance(blockNum, ...)` succeeds only if `ebRoots[blockNum] != 0` | B3 |
| `echidna_eb_update_requires_latest_root` | Conditional | `updateClusterBalance(blockNum, ...)` with a valid but non-latest committed root must revert | SSV-17 |
| `echidna_eb_update_frequency` | Conditional | Same cluster cannot update twice within `minBlocksBetweenUpdates` — second update reverts | B4 |
| `echidna_eb_update_staleness` | Conditional | Successful update requires `blockNum > lastRootBlockNum` for that cluster | B5 |

#### Fee Settlement Correctness

| Planned Property | Type | Description | Ref |
|---|---|---|---|
| `echidna_fee_index_current_after_settle` | Conditional | After ETH cluster fee settlement, stored fee indices equal protocol "current" indices | B9 |
| `echidna_fee_uses_old_vunits_on_eb_change` | Conditional | When EB update changes vUnits, fees for elapsed period use old vUnits, not new | B11 |

#### Liquidation Completeness

| Planned Property | Type | Description | Ref |
|---|---|---|---|
| `echidna_liquidation_pays_exact_balance` | Conditional | ETH paid to liquidator equals cluster balance at liquidation time — catches over/underpayment | B14 |

### Medium Priority — New Invariants

Requires more harness bookkeeping or complex setup (Merkle builder, multi-actor tracking).

> **FUZZ-3 complete**: B6, B7, B8 → `SSVEBProofEchidna.sol`; B17 → `SSVOperatorsEchidna.sol`; B19 → `SSVOperatorFeeGovEchidna.sol`; B15 → `SSVLegacyClustersEchidna.sol`; C4 → `SSVDAOEchidna.sol`.

### Lower Priority — Heavy Harness Required

Significant implementation effort. Requires custom delta-block simulators, per-cluster tracking arrays, or boundary-probing helpers.

#### vUnit Aggregation

| Planned Property | Type | Description | Ref |
|---|---|---|---|
| `echidna_dao_vunits_equals_sum` | Candidate | `daoTotalEthVUnits == Σ(cluster baseline) ± Σ(cluster deviations)` — catches vUnit drift | C5 |
| `echidna_operator_vunits_matches_clusters` | Candidate | Per-operator vUnits equals sum of their cluster deviations — catches earnings misallocation | C6 |

#### Overflow / Extreme Value

| Planned Property | Type | Description | Ref |
|---|---|---|---|
| `echidna_eth_accrual_no_overflow` | Candidate | With max fee, max validators, max EB, simulating 5 years of blocks: all ETH balances + indices remain within type bounds | X4 |
| `echidna_ssv_accrual_no_overflow` | Candidate | Same as above for SSV scaling factor and fee math | X5 |
| `echidna_intermediate_mul_no_overflow` | Candidate | For worst-case params, `fee * vUnits * deltaBlocks` stays `< type(uint256).max` | X6 |
| `echidna_pack_reverts_on_overflow` | Candidate | Packing `uint256 → uint64` reverts (not truncates) when value exceeds range | X7 |

### Harness Requirements for Planned Invariants

To make the above invariants exercisable, the following harness features are needed:

| Harness Feature | Required By | Description |
|---|---|---|
| **Prev-value tracking** | A8, A9, A18, A19 | Store `prevIndex`, `prevEarnings`, `prevBlock` in harness to assert monotonicity |
| **Touched-key arrays** | A4, A5, B1 | Track `bytes32[] touchedCommitmentKeys` since mappings aren't iterable |
| **Per-claim delta tracking** | A16, C2 | Wrap `claimEthRewards` to capture before/after pool balances |
| **2-actor reward tracking** | A15, C3 | Track accrued rewards for both sender/receiver around cSSV transfers |
| **Merkle tree builder** | B6, B7, B8 | Tiny in-harness Merkle builder for valid proof happy paths |
| **Delta-block simulator** | X4, X5, X6 | Test-only function that applies fee accrual math with explicit `deltaBlocks` input |
| **Per-cluster EB tracking** | C5, C6 | Arrays tracking baseline and deviation per cluster for global sum verification |
| **Max-param configurator** | X4, X5, X6, X7 | Helpers to set operator fee = max, validators = max, EB = max bound |
