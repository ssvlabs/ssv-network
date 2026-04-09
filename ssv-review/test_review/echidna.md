# Echidna Suite Review

## Executive Conclusions

The current Echidna suite is materially useful and stronger than the README suggests. The Solidity harnesses currently expose 155 `echidna_` properties across 15 harnesses, with especially good coverage in ETH/SSV accounting, cluster lifecycle/accounting, DAO root-commit behavior, staking reward accounting, targeted migration/regression scenarios, and the first batch of private-operator registration paths.

The main weaknesses are not basic correctness gaps in the existing accounting harnesses, but the remaining uncovered product surfaces: whitelist-removal and multi-private authorization combinations, owner/admin negative-path access control, and fee-recipient and network-withdraw maintenance paths.

The harness code should be treated as the source of truth. [README.md](../../test/echidna/README.md) is stale in several places: per-harness counts no longer match, the "planned invariants" section still lists already-implemented properties, and at least one property description no longer matches the actual Solidity code.

The current config is a good baseline and is operational with Echidna 2.3.2. Short smoke runs for `CSSVTokenEchidna` and `SSVClustersEchidna` both passed. The main config shortcomings are reproducibility and artifact retention, not basic correctness.

## Issue Tracker

| ID | Description | Status |
|---|---|---|
| ECHIDNA-1 | Removed the disabled `echidna_liquidation_clears_eb_snapshot` property from `SSVClustersEchidna.sol` and deleted its stale README references. | ✅ Fixed |
| ECHIDNA-2 | Added coverage for the `MustUseLatestRoot` rule so `updateClusterBalance` must use `blockNum == latestCommittedBlock`, not merely an existing committed root. | ✅ Fixed |
| ECHIDNA-3 | Reworked the cluster coverage assessment to map `SSVClusters.sol` function-by-function to the harnesses that exercise it, instead of relying on raw file-level coverage alone. | ✅ Fixed |
| ECHIDNA-4 | Added migration-harness coverage for `migrateClusterToETH` when the legacy SSV cluster is already liquidated (`isLiquidated == true`). | ✅ Fixed |
| ECHIDNA-5 | Added `SSVClustersEchidna` coverage for successful `updateClusterBalance` on inactive/liquidated ETH clusters, asserting the call updates only the EB snapshot and does not mutate accounting or cluster state. | ✅ Fixed |
| ECHIDNA-6 | Added `SSVMigrationEchidna` coverage for the legacy `VERSION_SSV` branch of `updateClusterBalance`, asserting the call updates only the EB snapshot and does not mutate SSV cluster, DAO, or operator accounting state. | ✅ Fixed |
| ECHIDNA-7 | Added `bulkRegisterValidator` action support to `SSVValidatorsEchidna`, so existing validator/cluster/operator-count invariants now exercise both single and bulk registration paths. | ✅ Fixed |
| ECHIDNA-8 | Added `bulkRemoveValidator` action support to `SSVValidatorsEchidna`, so the existing validator, cluster, and operator-count invariants now also exercise bulk removal paths. | ✅ Fixed |
| ECHIDNA-9 | Added `bulkExitValidator` and unauthorized bulk-exit action support to `SSVValidatorsEchidna`, so the existing owner-only-exit and validator-consistency invariants now also exercise bulk exit paths. | ✅ Fixed |
| ECHIDNA-10 | Added `SSVWhitelistValidatorsEchidna` to cover batch-1 private-operator registration scenarios: mixed public/private clusters with a zero-fee private operator, whitelist-contract registration, and legacy SSV private operators initialized into ETH logic while preserving whitelist rules. | ✅ Fixed |
| ECHIDNA-11 | Extended `SSVWhitelistValidatorsEchidna` so the same private-operator authorization and accounting checks now also exercise `bulkRegisterValidator` for direct whitelist, whitelist-contract, and legacy-private ETH-init flows. | ✅ Fixed |
| ECHIDNA-12 | Added `SSVAccountingEchidna` coverage for `withdrawNetworkSSVEarnings` in nonzero-accrual states, asserting exact `daoBalance` decrement, `daoIndexBlockNumber` checkpoint reset, and over-withdraw reverts; the real token-outflow path remains covered in `SSVDAOEchidna` via an external caller. | ✅ Fixed |
| ECHIDNA-13 | Added a targeted `migrateClusterToETH` regression test showing the production SSV refund path does not invoke owner callbacks: a contract owner with a reverting `receive()` still migrates successfully and receives the SSV refund. This closes the receiver-side reentrancy concern for migration without modeling non-production tokens. | ✅ Fixed |
| ECHIDNA-14 | Added `SSVLegacyValidatorRemovalEchidna` to cover the legacy `VERSION_SSV` remove surface from the spec and flows: seeded active and already-liquidated `removeValidator` / `bulkRemoveValidator` states, exact SSV operator/DAO count settlement on active removal, and the rule that liquidated-cluster removal must not decrement counts twice after liquidation. | ✅ Fixed |
| ECHIDNA-15 | Extended `SSVOperatorsEchidna` with direct coverage for the legacy `reduceOperatorFee -> ensureETHDefaults()` branch and for `withdrawAllVersionOperatorEarnings`, reusing the existing reduce/withdraw invariants to check ETH-default initialization, DAO minimum-fee respect, dual-balance zeroing, and combined ETH+SSV payout accounting. | ✅ Fixed |
| ECHIDNA-16 | Extended `SSVWhitelistValidatorsEchidna` with private-operator follow-on flows after first use: whitelist mutation plus fee change on an in-use private operator, and public/private privacy toggles on an in-use private operator, asserting authorization updates take effect without breaking validator-count or cluster-hash accounting. | ✅ Fixed |

## Inventory Reality Check

Actual property counts from the Solidity harnesses:

| Harness | Properties |
|---|---:|
| `CSSVTokenAccessControlEchidna.sol` | 3 |
| `CSSVTokenEchidna.sol` | 10 |
| `SSVAccountingEchidna.sol` | 11 |
| `SSVClustersEchidna.sol` | 24 |
| `SSVDAOEchidna.sol` | 28 |
| `SSVEBProofEchidna.sol` | 3 |
| `SSVEdgeCasesEchidna.sol` | 7 |
| `SSVLegacyClustersEchidna.sol` | 2 |
| `SSVLegacyValidatorRemovalEchidna.sol` | 3 |
| `SSVMigrationEchidna.sol` | 6 |
| `SSVOperatorFeeGovEchidna.sol` | 1 |
| `SSVOperatorsEchidna.sol` | 24 |
| `SSVStakingEchidna.sol` | 20 |
| `SSVWhitelistValidatorsEchidna.sol` | 5 |
| `SSVValidatorsEchidna.sol` | 8 |
| **Total** | **155** |

Implications:

- The README inventory is stale and should not be used to assess current coverage depth.
- The README "Planned Invariants (Remaining)" section is also stale. Several items listed there are already implemented in code, including `echidna_finalized_weight_cleared`, `echidna_commitment_weight_lte_supply`, `echidna_finalization_implies_quorum`, `echidna_dao_earnings_monotonic`, `echidna_dao_index_block_lte_current`, `echidna_cssv_transfer_settles_both`, `echidna_claim_payout_precision`, `echidna_eb_snapshot_block_lte_current`, `echidna_eb_snapshot_root_monotonic`, and `echidna_operator_vunits_matches_clusters`.
- The older stale `echidna_liquidation_clears_eb_snapshot` property was a good example of this drift. After review, it was removed from both the harness and the README, but the broader documentation-maintenance problem remains.

## Domain Review

### cSSV Token / Staking Token

The token-focused harnesses are mostly correct, simple, and low maintenance. `CSSVTokenEchidna` checks supply accounting, zero-address behavior, immutables, and supply/backing bounds. `CSSVTokenAccessControlEchidna` covers the narrow access-control surface well enough for its scope.

This area has low refactor priority. It is not where the suite is missing meaningful protocol risk.

### Operators

`SSVOperatorsEchidna` plus the new `SSVWhitelistValidatorsEchidna` are one of the more useful operator-domain combinations. Together they meaningfully cover:

- ETH/SSV earnings separation.
- Fee declaration/execute/reduce behavior.
- Settlement ordering around fee changes.
- Withdraw bounds and conservation.
- Removal-state cleanup and owner preservation.
- `ensureETHDefaults()` behavior for legacy operators transitioning into ETH logic.
- Direct-address whitelisting on private operators during single and bulk validator registration.
- Whitelist-contract authorization during single and bulk validator registration.
- Mixed clusters containing fee-paying public operators plus a zero-fee private operator.
- Legacy SSV private operators that initialize ETH defaults before joining a new ETH cluster.

The properties here are mostly correct. Some are true state invariants, while others are "no tested action ever succeeded in violating X" flags, but that is acceptable for this surface because many relevant behaviors are revert-sensitive and action-specific.

Function-by-function, `SSVOperators.sol` is in reasonably good shape on registration, fee changes, earnings withdrawal, legacy-operator ETH initialization, and removal-state cleanup. The right way to read operator coverage is by function ownership across harnesses:

| `SSVOperators.sol` function | Harnesses that exercise it | Coverage assessment |
|---|---|---|
| `registerOperator` | `SSVOperatorsEchidna` | Good. Covers unique pubkeys, monotonically increasing IDs, nonzero owners, max-fee bounds, minimum-fee enforcement at registration time, and both zero-fee and nonzero-fee registrations. The `setPrivate` flag is exercised as an input, but this harness does not make privacy-state assertions beyond successful registration. |
| `removeOperator` | `SSVOperatorsEchidna` | Strong. Covers owner-only removal, full ETH/SSV payout on removal, state cleanup, preservation of owner identity after removal, and the invariant that no settled earnings remain trapped after the remove path succeeds. |
| `declareOperatorFee` | `SSVOperatorsEchidna` | Strong. Covers owner-only access, declare-from-zero rejection, the invariant that declaration does not mutate the active fee immediately, the staging of fee changes into the approval-window flow, and the legacy-operator `ensureETHDefaults()` bridge via the dedicated `action_trigger_ensure_eth_defaults` path. |
| `executeOperatorFee` | `SSVOperatorsEchidna` | Strong. Covers valid-window execution, invalid-window rejection, max-fee/min-fee rejection at execution time, fee-latency behavior, and the key “settle earnings before changing fee” ordering rule. |
| `cancelDeclaredOperatorFee` | none | Uncovered in Echidna. This is now one of the clearest remaining operator-core gaps. |
| `reduceOperatorFee` | `SSVOperatorsEchidna` | Strong. Covers owner-only access, monotonic decrease, minimum-fee bounds, cancellation of pending declarations, settlement-before-change ordering on the direct reduce path, and the legacy-operator `ensureETHDefaults()` bridge before reducing from an SSV-only operator state. |
| `setOperatorsPrivateUnchecked` | `SSVWhitelistValidatorsEchidna` | Good behavioral coverage downstream. The whitelist harness now toggles an in-use private operator back to private after a public phase and checks that unauthorized registration fails again while whitelisted registration still succeeds. This is still not a direct operator-module harness, but the entrypoint is no longer unexercised. |
| `setOperatorsPublicUnchecked` | `SSVWhitelistValidatorsEchidna` | Good behavioral coverage downstream. The whitelist harness now toggles an in-use private operator public and verifies a previously unauthorized caller can register successfully. As with the private toggle, this is behavioral rather than direct accounting-focused coverage. |
| `withdrawOperatorEarnings` | `SSVOperatorsEchidna`, `SSVAccountingEchidna` | Strong. Covers partial ETH withdrawals, over-withdraw rejection, exact balance conservation, payout deltas, and the invariant that ETH withdrawals do not disturb legacy SSV balances. |
| `withdrawAllOperatorEarnings` | `SSVOperatorsEchidna` | Good to strong. Covers full ETH withdrawal-to-zero, payout accounting, and storage isolation from SSV balances. |
| `withdrawAllVersionOperatorEarnings` | `SSVOperatorsEchidna` | Good. Now covered directly through a dual-balance sweep action that checks both ETH and legacy SSV balances are zeroed and both owner/contract payout deltas match the pre-withdraw settled balances. |
| `withdrawOperatorEarningsSSV` | `SSVOperatorsEchidna`, `SSVAccountingEchidna` | Strong. Covers partial SSV withdrawals, over-withdraw rejection, exact balance conservation, payout deltas, and the invariant that SSV withdrawals do not disturb ETH balances. |
| `withdrawAllOperatorEarningsSSV` | `SSVOperatorsEchidna` | Good to strong. Covers full SSV withdrawal-to-zero, payout accounting, and storage isolation from ETH balances. |

For the internal helpers, the coverage picture is:

- `_withdrawOperatorEarnings` is exercised well on both the `VERSION_ETH` and `VERSION_SSV` branches through partial and full withdrawals in `SSVOperatorsEchidna`, plus live-accounting ETH/SSV withdrawal actions in `SSVAccountingEchidna`.
- `_resetOperatorState`, `_transferOperatorBalanceUnsafe`, and `_transferOperatorTokenBalanceUnsafe` are exercised transitively through `removeOperator`.
- The invalid-version branch inside `_withdrawOperatorEarnings` is not modeled, which is acceptable because no public entrypoint exposes arbitrary version selection.

So the remaining operator-domain gaps are now narrower and more precise:

- direct coverage for `cancelDeclaredOperatorFee`
- whitelist-mutation/removal flows in the separate `SSVOperatorsWhitelist.sol` module
- multi-private clusters where one caller must satisfy multiple independent whitelist conditions

### Clusters / EB / Liquidation

`SSVClustersEchidna` and `SSVEBProofEchidna` cover high-value logic and are broadly correct. The suite does a good job exercising:

- cluster hash/accounting consistency
- liquidation and reactivation reachability
- liquidated-cluster deposit/withdraw behavior
- EB proof validity and bounds
- EB update frequency and staleness checks
- fee settlement with old vUnits on EB changes
- implicit-EB default behavior

This domain mixes three property styles:

- state invariants, like cluster hash consistency
- conditional postconditions, like fee indices after settlement
- action-driven witness flags, like "a forbidden path never succeeded"

That mixed style is fine, but the report and README should label it explicitly because not every property here is an unconditional invariant over all reachable states.

Function-by-function, `SSVClusters.sol` is in better shape than the raw line-coverage percentage suggests. The right way to read cluster coverage is by function ownership across harnesses:

| `SSVClusters.sol` function | Harnesses that exercise it | Coverage assessment |
|---|---|---|
| `liquidate` | `SSVClustersEchidna`, `SSVEdgeCasesEchidna`, `SSVAccountingEchidna` | Strong. Covers owner-triggered liquidation, third-party liquidation, dust/liquidatability reachability, and repeated liquidate/reactivate cycles. |
| `liquidateSSV` | `SSVLegacyClustersEchidna`, `SSVAccountingEchidna` | Good for active legacy SSV liquidation and payout/reset accounting. |
| `reactivate` | `SSVClustersEchidna`, `SSVEdgeCasesEchidna`, `SSVAccountingEchidna` | Strong for ETH-cluster reactivation, removed-operator cases, and vUnits-related reactivation behavior. |
| `deposit` | `SSVClustersEchidna`, `SSVAccountingEchidna` | Good. Includes liquidated-cluster deposit behavior. |
| `withdraw` | `SSVClustersEchidna`, `SSVAccountingEchidna` | Strong. Includes successful withdraws, over-withdraw, unauthorized withdraw, and liquidated-cluster withdraw behavior. |
| `migrateClusterToETH` | `SSVMigrationEchidna`, `SSVAccountingEchidna` | Good. Covers active-cluster migration, removed-operator migration accounting, validator-count shifts, and the already-liquidated legacy-cluster branch. |
| `updateClusterBalance` | `SSVClustersEchidna`, `SSVEBProofEchidna`, `SSVMigrationEchidna` | Strong for valid active-cluster updates, inactive/liquidated ETH snapshot-only updates, legacy `VERSION_SSV` snapshot-only updates, missing-root rejection, latest-root rejection, frequency/staleness checks, proof validation, bounds enforcement, old-vUnits settlement, and auto-liquidation-after-update. |

For the internal helpers, the coverage picture is:

- `_updateClusterBalanceInternal`, `_verifyEBRoots`, `_verifyEBUpdateFrequency`, `_verifyEBStaleness`, `_verifyMerkleProof`, `_verifyEBLimits`, `_applyClusterFeeUpdates`, `_updateOperatorVUnits`, `_updateEBSnapshot`, and `_liquidateAfterEBUpdateIfNeeded` are all exercised transitively through the `updateClusterBalance` harnesses.
- `_executeLiquidation` is exercised transitively through both `liquidate` and auto-liquidation after EB updates.

So the real issue is not “most of `SSVClusters.sol` is uncovered”. The major public-function branches are now modeled across the suite, even though line coverage still looks only moderate when the entire module is viewed as one file.

This is why the raw source-line coverage for the full module looks lower than expected: one Solidity file bundles ETH cluster lifecycle, legacy SSV liquidation, migration, and EB update logic across both cluster versions, while the harnesses are intentionally domain-specialized.

### Global Accounting

`SSVAccountingEchidna` is one of the strongest parts of the suite. It covers the most important protocol-level formulas from [SPEC.md](../../docs/SPEC.md):

- ETH conservation
- SSV conservation
- ETH solvency
- operator vUnits vs cluster deviations
- DAO validator count consistency
- cluster version exclusivity
- operator dual validator tracking
- validator lifecycle consistency
- migration one-way behavior
- SSV accrual overflow regression
- DAO total vUnits consistency

This is the best overall "protocol correctness" harness in the suite. If the goal is confidence in the accounting model rather than raw property count, this harness carries a large share of that value.

### Validators

`SSVValidatorsEchidna` covers the single-validator lifecycle well:

- validator state hashing
- cluster hash consistency
- cluster and operator validator counts
- no duplicate validators
- owner-only remove/exit

It now also drives `bulkRegisterValidator`, `bulkRemoveValidator`, and `bulkExitValidator`, reusing the existing validator, cluster, and operator-count invariants instead of introducing a second bulk-specific property surface. Given how often bulk paths diverge from single-item logic in real audits, this is a meaningful improvement.

Function-by-function, `SSVValidators.sol` is in good shape on the active ETH validator lifecycle, but not every branch the module exposes in the spec is covered equally. Per [SPEC.md](../../docs/SPEC.md) and [FLOWS.md](../../docs/FLOWS.md), registration is ETH-only while remove paths must handle both ETH and legacy SSV clusters, and exit paths are pure signal operations.

| `SSVValidators.sol` function | Harnesses that exercise it | Coverage assessment |
|---|---|---|
| `registerValidator` | `SSVValidatorsEchidna`, `SSVWhitelistValidatorsEchidna`, `SSVAccountingEchidna` | Strong for ETH registration. Covers validator storage, cluster hash/balance accounting, operator/DAO count deltas, duplicate registration rejection, and private-operator authorization variants including legacy-private ETH initialization. Legacy SSV registration is blocked by design, so the lack of an SSV registration branch in Echidna is not a gap. |
| `bulkRegisterValidator` | `SSVValidatorsEchidna`, `SSVWhitelistValidatorsEchidna` | Good to strong for ETH batch registration. Covers reused validator/cluster/operator-count invariants, shared-deposit semantics, and private-operator authorization on mixed, contract-whitelisted, and legacy-private paths. The harnesses are less explicit about malformed batch payload edge cases than they are about state consistency after successful registration. |
| `removeValidator` | `SSVValidatorsEchidna`, `SSVAccountingEchidna`, `SSVLegacyValidatorRemovalEchidna` | Strong overall. ETH coverage remains good through the lifecycle harnesses, and the new legacy SSV harness now exercises both active and liquidated SSV removal, including exact DAO/operator count settlement and the post-liquidation no-double-decrement rule from the spec. |
| `bulkRemoveValidator` | `SSVValidatorsEchidna`, `SSVLegacyValidatorRemovalEchidna` | Good to strong. ETH batch removal remains covered through reused validator/cluster/operator-count invariants, and the legacy SSV harness now covers both active and liquidated bulk removal with exact SSV DAO/operator settlement expectations. |
| `exitValidator` | `SSVValidatorsEchidna`, `SSVAccountingEchidna` | Strong for the intended pure-signal semantics. Covers owner-only exit and the invariant that exit does not mutate cluster/operator/DAO counts or delete the validator record. |
| `bulkExitValidator` | `SSVValidatorsEchidna` | Good. Covers authorized and unauthorized bulk exit on live validators, reusing the same lifecycle consistency checks rather than introducing a separate event-count property surface. Empty-list and event-specific postconditions are not modeled directly. |

For the internal helpers, the coverage picture is:

- `_bulkRegisterValidator` is exercised through both single and bulk registration wrappers, including private-operator authorization paths from `SSVWhitelistValidatorsEchidna`.
- `_bulkRemoveValidator` is now exercised on both the ETH and legacy SSV branches. The dedicated legacy harness covers the active-settlement path and the liquidated no-double-decrement path that were previously only documented in unit tests and the spec.
- `_validateExistingValidator` is exercised transitively through remove, bulkRemove, exit, bulkExit, and the unauthorized-owner negative paths.

So for this module, the previously material gap has now been closed: the legacy SSV remove surface from [SPEC.md](../../docs/SPEC.md) and [FLOWS.md](../../docs/FLOWS.md) is modeled directly in Echidna, including active-vs-liquidated removal, SSV operator/DAO count settlement, and the “no double decrement after liquidation” rule. The remaining validator-domain gaps are narrower and lower priority than that branch-specific accounting surface.

### Staking

`SSVStakingEchidna` is strong and more nuanced than the README suggests. It covers:

- stake/unstake/withdraw invalid-path behavior
- cSSV supply accounting
- SSV backing
- DAO pool synchronization
- same-block claim behavior
- user index bounds
- transfer settlement
- claim precision
- no free rewards on transfer
- unstake stopping accrual
- dust and zero-balance edge cases
- batch withdraw behavior

Several of these are implemented through witness flags or tracked deltas rather than pure invariants, but they are still meaningful and correctly targeted for this kind of accumulator-based reward system.

Function-by-function, `SSVStaking.sol` is in good shape on the core staking and reward-accounting paths. The right way to read staking coverage is by function ownership across harnesses:

| `SSVStaking.sol` function | Harnesses that exercise it | Coverage assessment |
|---|---|---|
| `syncFees` | `SSVStakingEchidna` | Strong. Covers both increase and decrease paths, pool/DAO synchronization, accumulator updates, and repeated settlement through direct calls plus transitively through other staking actions. |
| `stake` | `SSVStakingEchidna`, `SSVClustersEchidna` | Strong. Covers valid and invalid stake amounts, cSSV mint accounting, SSV backing bounds, and reward settlement on entry. |
| `requestUnstake` | `SSVStakingEchidna` | Strong. Covers zero/excess invalid requests, pending-request bounds, cSSV burn accounting, and the key regression that unstaking stops future accrual on the unstaked amount. |
| `withdrawUnlocked` | `SSVStakingEchidna` | Strong. Covers zero-withdrawable rejection, mixed unlocked/locked request batches, swap-and-pop request deletion behavior, and conservation of SSV backing during payout. |
| `claimEthRewards` | `SSVStakingEchidna`, `SSVClustersEchidna` | Strong. Covers exact ETH payout deltas, same-block second-claim behavior, payout precision, dust/zero-balance behavior, and pool/DAO balance coupling. |
| `rescueERC20` | none | Uncovered in Echidna. This remains a maintenance/admin smoke-test gap rather than a core staking-accounting gap. |
| `onCSSVTransfer` | `SSVStakingEchidna` | Good. Covers sender/receiver settlement on transfer, user-index updates, and the “no free rewards on transfer” invariant through the real cSSV hook path. |

For the internal helpers, the coverage picture is:

- `_syncFees`, `_settle`, and `_settleWithBalance` are exercised transitively through `syncFees`, `stake`, `requestUnstake`, `claimEthRewards`, and `onCSSVTransfer`.
- `calculateTotalUnfrozenBalance` is exercised transitively through `withdrawUnlocked`, including the batch-processing scenarios that depend on removing multiple matured requests correctly.

So the real staking gap is not the accumulator logic or payout math. The missing surface is still the owner/admin utility path around `rescueERC20`, plus any intentional negative-path access-control smoke coverage the team wants for governance-maintained settings around staking.

### DAO / Oracle

`SSVDAOEchidna` is strong on targeted quorum/oracle behavior. It meaningfully covers:

- oracle-only root commits
- duplicate-vote prevention
- stale/future commit rejection
- committed block monotonicity
- dusty-round quorum behavior
- frozen-supply truncation behavior
- failed-quorum persistence
- voting on different roots for the same block
- finalized-weight cleanup
- commitment weight vs frozen supply
- finalization implying quorum
- DAO earnings monotonicity and formula checks

This is good coverage for root-commit logic and the arithmetic around DAO earnings.

The main missing piece is negative access-control fuzzing for owner-only governance/admin functions. The harness exercises several owner-only calls as the harness contract, but it does not systematically try unauthorized callers against that governance surface.

### Migration / Legacy SSV

`SSVMigrationEchidna`, `SSVLegacyClustersEchidna`, and `SSVOperatorFeeGovEchidna` are targeted regression harnesses and they do their job well. They are not broad protocol harnesses, but they capture specific bug classes that matter:

- removed-operator migration accounting
- frozen SSV index preservation
- validator-count shifts during migration
- legacy `VERSION_SSV` snapshot-only EB updates
- migration from already-liquidated legacy SSV clusters
- legacy SSV liquidation payout/reset behavior
- legacy declarations rejected after migration boundary

This part of the suite looks adequate for the bugs it is targeting.

## Incorrect, Stale, or Weak Properties

The major stale-property issue that originally stood out was the disabled `echidna_liquidation_clears_eb_snapshot` property in the cluster harness. That property has since been removed from the harness and the README. The broader lesson still stands: any README entry that no longer matches the harness code should be treated as documentation debt, not protocol coverage.

The suite also uses several properties that are better described as:

- state invariants
- conditional postconditions
- targeted regression probes
- witness-flag properties meaning "no tested action succeeded in violating X"

This is not a problem by itself, but the current documentation presents too many of these as if they were all the same kind of invariant.

## Missing Invariants Backlog

### High Priority

1. Whitelist-removal flows in `SSVOperatorsWhitelist.sol` and multi-private clusters with intersecting authorization conditions.
2. Negative access-control fuzzing for owner-only governance/admin actions.

### Medium Priority

1. `setFeeRecipientAddress` behavior and reward-routing invariants.
2. Wrapper-level access-control fuzzing for `withdrawNetworkSSVEarnings` and related governance maintenance paths.
3. `rescueERC20` and `updateModule` smoke invariants around authorization and basic safety.
4. Reentrancy-oriented harnesses for ETH-paying flows that actually invoke recipient callbacks, if reentrancy hardening is considered a review priority. `migrateClusterToETH` is excluded here because its production refund path uses standard SSV token transfers with no recipient callback surface.

### Low Priority / Optional

1. Swarm-style campaigns with alternative function allowlists.
2. Additional campaign profiles optimized for larger payable-state exploration.
3. More harness specialization for rarely hit edge combinations if coverage data shows persistent blind spots.

## Refactor Opportunities

### Documentation / Inventory

- Replace hand-maintained property counts in [README.md](../../test/echidna/README.md) with a generated summary or a lightweight script-based inventory.
- Remove or rewrite the stale "planned invariants" section so it only tracks genuinely missing work.

### Property Taxonomy

Split the suite language into three categories:

- `state invariants`
- `conditional postconditions`
- `targeted regression probes`

This would make the suite easier to reason about and reduce the current ambiguity around what each harness is actually proving.

### Dead / Residual Bookkeeping

- Remove residual bookkeeping or comments tied to stale README entries when they no longer contribute to coverage.
- Keep cluster-harness witness flags scoped to live properties only, so disabled checks do not silently leave dead state behind.

### Harness Pattern Reuse

There is clear repetition across harnesses in:

- actor helper contracts
- funding/setup helpers
- snapshot/checkpoint helpers
- root-commit bookkeeping

Some centralization would reduce maintenance cost. That said, the current explicit harness-local style is readable, so refactoring should only be done where it reduces duplication without hiding protocol intent.

## Config Assessment

[echidna.yaml](../../test/echidna/echidna.yaml) and [echidna-ci.yaml](../../test/echidna/echidna-ci.yaml) are structurally sound.

What is good:

- `testMode: property` is correct for this suite.
- `prefix: "echidna_"` is correct.
- `filterBlacklist: false` plus explicit `filterFunctions` is the right allowlist pattern for inherited-module harnesses.
- Separate local and CI budgets are reasonable.
- The configs run successfully with Echidna 2.3.2 in this repo.

What should improve:

- Add `corpusDir`, and optionally `coverageDir`, so successful campaigns retain useful artifacts.
- Make reproducibility explicit. The Echidna docs note that `seed` may not guarantee reproducibility when multiple `workers` are used. Either pin `seed` for selected CI jobs or document that local multi-worker runs are intentionally non-deterministic.
- Re-evaluate whether `workers: 7` is worth the determinism/noise tradeoff for local runs. It is fine for throughput, but not ideal for reproducible debugging.
- Consider explicit `balanceAddr` / `maxValue` settings if the goal is to push larger payable-state exploration, rather than relying on defaults.

Overall assessment: the config is good enough to fuzz this suite today, but it is tuned more for "run it" than for "reproduce and preserve campaign state".

## Test / Validation Notes

Static review inputs:

- [SPEC.md](../../docs/SPEC.md)
- [FLOWS.md](../../docs/FLOWS.md)
- Echidna docs/config references under `/Users/marco/ssv/repos/building-secure-contracts/program-analysis/echidna`

Runtime validation performed during this review:

- `CSSVTokenEchidna` short smoke run: passed.
- `SSVClustersEchidna` short smoke run: passed.
- Updated `SSVClustersEchidna` smoke run with `echidna_inactive_eb_update_skips_accounting`: passed.
- `SSVMigrationEchidna` short smoke run: passed.
- Updated `SSVMigrationEchidna` smoke run with `echidna_ssv_eb_update_only_snapshot`: passed.
- Updated `SSVValidatorsEchidna` smoke run with `bulkRegisterValidator` action support: passed.
- Updated `SSVValidatorsEchidna` smoke run with `bulkRemoveValidator` action support: passed.
- Updated `SSVValidatorsEchidna` smoke run with `bulkExitValidator` action support: passed.
- Updated `SSVOperatorsEchidna` smoke run with direct `reduceOperatorFee -> ensureETHDefaults()` coverage and direct `withdrawAllVersionOperatorEarnings` coverage: no falsified properties through 70,706 calls before manual stop.
- `SSVWhitelistValidatorsEchidna` short smoke run with single-register and bulk-register private-operator scenarios: passed.
- Updated `SSVWhitelistValidatorsEchidna` smoke run with in-use whitelist-mutation/fee-change and privacy-toggle follow-on flows: no falsified properties observed through 107,228 calls.
- `SSVLegacyValidatorRemovalEchidna` smoke run for active and already-liquidated legacy SSV remove/bulk-remove accounting invariants: passed through 99,304 calls with no falsified properties before manual stop.

These conclusions are scoped to code review plus short smoke runs. They should not be read as a statement that every harness has been validated under full-campaign settings.

Coverage interpretation note:

- A single `SSVClustersEchidna` campaign can show only moderate file-level coverage for [SSVClusters.sol](../../contracts/modules/SSVClusters.sol), because that one module contains ETH lifecycle logic, legacy SSV liquidation, SSV-to-ETH migration, and EB update logic.
- The more reliable view is the function-to-harness map above. On that basis, no major public `SSVClusters.sol` function is completely uncovered.

## Final Assessment

The suite is already valuable and meaningfully exercises the protocol's hardest accounting and oracle logic. Its main problem is not lack of effort or lack of good invariants; it is that the documentation has fallen behind the harness code and several operationally important surfaces remain outside the fuzz model.

If only a small amount of follow-up work is funded, the highest-return additions are:

1. extend whitelist coverage into removal flows and multi-private intersecting-authorization paths,
2. add unauthorized-caller coverage for owner/admin surfaces,
3. add fee-recipient and network-withdraw maintenance coverage,
4. keep the README synchronized with the actual harness inventory.
