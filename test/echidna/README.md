# Echidna Invariant Testing — SSV Network v2

Fuzz testing for SSV Network v2 smart contracts using [Echidna](https://github.com/crytic/echidna).

## Quick Start (macOS)

```bash
bash test/echidna/run-echidna.sh
```

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
```

## Files

```
test/echidna/
├── CSSVTokenEchidna.sol              # Core invariants (9 tests)
├── CSSVTokenAccessControlEchidna.sol # Access control (3 tests)
├── SSVOperatorsEchidna.sol           # Operators invariants (19 tests)
├── SSVClustersEchidna.sol            # Clusters invariants (9 tests)
├── SSVAccountingEchidna.sol          # System accounting invariants (4 tests)
├── SSVEdgeCasesEchidna.sol           # Edge-case invariants (4 tests)
├── SSVValidatorsEchidna.sol          # Validators invariants (8 tests)
├── SSVStakingEchidna.sol             # Staking invariants (12 tests)
├── SSVDAOEchidna.sol                 # DAO invariants (13 tests)
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

## SSVOperatorsEchidna (19 Invariants)

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

## SSVClustersEchidna (9 Invariants)

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

## SSVAccountingEchidna (4 Invariants)

| Property | Description |
|----------|-------------|
| `echidna_eth_conservation` | ETH conservation across clusters/operators/DAO |
| `echidna_ssv_conservation` | SSV conservation across clusters/operators/DAO |
| `echidna_eth_solvency` | ETH solvency for all tracked balances |
| `echidna_ssv_solvency` | SSV solvency for all tracked balances |

## SSVEdgeCasesEchidna (4 Invariants)

| Property | Description |
|----------|-------------|
| `echidna_yoyo_liquidation_reactivates` | Repeated liquidate/reactivate remains reachable |
| `echidna_reactivation_restores_vunits` | Reactivation restores EB-weighted vUnits |
| `echidna_validator_spam_safe` | High validator counts do not corrupt snapshots |
| `echidna_fee_index_overflow_protected` | Fee index overflow paths revert safely |

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

## SSVStakingEchidna (12 Invariants)

| Property | Description |
|----------|-------------|
| `echidna_sync_fees_handles_decrease` | Sync fees does not fail when earnings decrease |
| `echidna_sync_fees_never_fails` | Sync fees never fails or mismatches |
| `echidna_invalid_stake_reverts` | Invalid stake amounts are rejected |
| `echidna_invalid_unstake_reverts` | Invalid unstake requests are rejected |
| `echidna_invalid_withdraw_reverts` | Withdraw with no unlocked balance is rejected |
| `echidna_cssv_supply_matches_users` | cSSV supply matches tracked user balances |
| `echidna_ssv_balance_matches_staked_plus_pending` | Contract SSV balance equals staked plus pending |
| `echidna_pool_matches_dao_balance` | ETH pool balance matches DAO balance |
| `echidna_pending_requests_bounded` | Withdrawal request count stays within bounds |
| `echidna_user_index_leq_acc` | User index never exceeds global accumulator |
| `echidna_accrued_within_pool` | Accrued rewards stay within pool balance |
| `echidna_oracle_weights_match_supply` | Oracle weights sum equals cSSV supply |

## SSVDAOEchidna (13 Invariants)

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
| `echidna_oracle_mapping_consistent` | Oracle ID mappings remain consistent |

---

## Planned Invariants (Not Yet Implemented)

Evaluated from `ssv-review/planning/SSVNetwork — Enrich Invariant Suite.md` against the 73 existing invariants above. Only invariants that are **not already covered** are listed below. Grouped by priority.

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
| `echidna_commitment_weight_lte_supply` | Always | For each tracked `commitmentKey`, `rootCommitments[key] <= cSSV.totalSupply()` — catches quorum overflow | A5 |
| `echidna_finalization_implies_quorum` | Conditional | At finalization time, accumulated weight >= `threshold(totalSupply, quorumBps)` — catches quorum bypass | B1 |

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
| `echidna_eb_update_requires_latest_root` | Conditional | `updateClusterBalance(blockNum, ...)` with non-latest committed root must always revert (SSV-17 latest-root-only rule) | SSV-17 |
| `echidna_eb_update_requires_root` | Conditional | `updateClusterBalance(blockNum, ...)` succeeds only if `ebRoots[blockNum] != 0` | B3 |
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
| `echidna_liquidation_clears_eb_snapshot` | Conditional | After liquidation, `clusterEB[clusterId].vUnits == 0` — catches stale EB after liquidation | B13 |
| `echidna_liquidation_pays_exact_balance` | Conditional | ETH paid to liquidator equals cluster balance at liquidation time — catches over/underpayment | B14 |

### Medium Priority — New Invariants

Requires more harness bookkeeping or complex setup (Merkle builder, multi-actor tracking).

#### EB Proof Verification

| Planned Property | Type | Description | Ref |
|---|---|---|---|
| `echidna_eb_merkle_proof_verified` | Conditional | Successful EB update implies `MerkleProof.verify(proof, root, leaf) == true` for expected leaf encoding | B6 |
| `echidna_eb_bounds_enforced` | Conditional | Successful EB update has `effectiveBalance` within protocol bounds (min 32 ETH/validator, max 2048 ETH/validator) | B7 |
| `echidna_eb_snapshot_fields_exact` | Conditional | After successful update: `vUnits == ebToVUnits(effectiveBalance)`, `lastRootBlockNum == blockNum`, `lastUpdateBlock == block.number` | B8 |

#### Operator Fee Governance

| Planned Property | Type | Description | Ref |
|---|---|---|---|
| `echidna_declare_fee_from_zero_reverts` | Conditional | If operator legacy fee = 0 and ETH fee = 0, declaring non-zero ETH fee reverts (if enforced) | B17 |
| `echidna_execute_rejects_legacy_declarations` | Conditional | `executeOperatorFee` rejects declarations timestamped before `UPGRADE_TIMESTAMP` | B19 |

#### Legacy SSV

| Planned Property | Type | Description | Ref |
|---|---|---|---|
| `echidna_ssv_liquidation_resets_and_pays` | Conditional | `liquidateSSV()` success → cluster inactive, indexes zeroed, remaining SSV transferred to liquidator | B15 |

#### DAO Earnings Formula

| Planned Property | Type | Description | Ref |
|---|---|---|---|
| `echidna_dao_earnings_matches_formula` | Candidate | `networkTotalEarnings()` equals `daoBalance + (blockDelta * ethNetworkFee * daoTotalEthVUnits / precision)` — catches packing/rounding/checkpoint errors | C4 |

### Lower Priority — Heavy Harness Required

Significant implementation effort. Requires custom delta-block simulators, per-cluster tracking arrays, or boundary-probing helpers.

#### vUnit Aggregation

| Planned Property | Type | Description | Ref |
|---|---|---|---|
| `echidna_dao_vunits_equals_sum` | Candidate | `daoTotalEthVUnits == Σ(cluster baseline) ± Σ(cluster deviations)` — catches vUnit drift | C5 |
| `echidna_operator_vunits_matches_clusters` | Candidate | Per-operator vUnits equals sum of their cluster deviations — catches earnings misallocation | C6 |

#### Migration

| Planned Property | Type | Description | Ref |
|---|---|---|---|
| `echidna_migration_one_way` | Candidate | After `migrateClusterToETH`: ETH mode active, SSV balance returned, legacy operations revert — catches partial migration / stuck funds | C7 |

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
