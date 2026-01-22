# Echidna Security Testing for CSSVToken

Fuzz testing for CSSVToken using [Echidna](https://github.com/crytic/echidna).

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
echidna test/echidna/SSVValidatorsEchidna.sol --contract SSVValidatorsEchidna --config test/echidna/echidna.yaml
echidna test/echidna/SSVStakingEchidna.sol --contract SSVStakingEchidna --config test/echidna/echidna.yaml
echidna test/echidna/SSVDAOEchidna.sol --contract SSVDAOEchidna --config test/echidna/echidna.yaml
```

## Files

```
test/echidna/
├── CSSVTokenEchidna.sol              # Core invariants (9 tests)
├── CSSVTokenAccessControlEchidna.sol # Access control (3 tests)
├── SSVOperatorsEchidna.sol           # Operators invariants (15 tests)
├── SSVClustersEchidna.sol            # Clusters invariants (8 tests)
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

## SSVOperatorsEchidna (15 Invariants)

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
| `echidna_owner_only_actions` | Owner-only access enforced |
| `echidna_remove_cleans_state` | Removal zeroes operator state |
| `echidna_remove_pays_out` | Removal pays out and reduces holdings |

## SSVClustersEchidna (8 Invariants)

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
