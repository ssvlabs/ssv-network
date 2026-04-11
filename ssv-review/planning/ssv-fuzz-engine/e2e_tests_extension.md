# E2E Test Cases — CTO Extension Batch 1

Extends [e2e_tests (1).MD](./e2e_tests%20(1).MD) using the concrete scenario inventory in [CTOs_e2e_scenarios.csv](./CTOs_e2e_scenarios.csv).

This batch is intentionally additive. It does not restate CATs that already exist in the base plan. It identifies the highest-signal CTO scenario families that are not yet first-class in the current fuzz-engine planning and converts them into CAT-style entries in the same format.

**Convention:** `-> expect revert` means the action must revert. `-> expect success` means it must succeed. `✓ INV` means check all invariants (INV-1..INV-8). Advance N blocks is written as `⏩ N blocks`.

---

## Missing Families From CTO PR

- Operator fee timing and overwrite matrix.
  Representative CTO scenarios: OF-010, OF-024, OF-034, OF-049, OF-050, OF-051, OF-053, OF-054, OF-055.
  Gap: current CAT-4 covers declare/execute/reduce paths, but not the full boundary matrix around approval windows, overwrite semantics, mid-flight DAO parameter changes, and shared-cluster settlement.

- Shared-operator fee propagation across multiple clusters.
  Representative CTO scenarios: XO-021, XO-038, XO-039, XO-040, XO-047, XO-049, XO-053, XF-022.
  Gap: current CAT-4/CAT-5 do not yet make multi-cluster shared-operator fee propagation a dedicated family.

- Removed-operator plus EB plus liquidation plus reactivation chain stress.
  Representative CTO scenarios: XL-011..XL-020, XO-016..XO-024, RMA-022, RMA-023, RMC-001..RMC-020, XF-023, XF-024, XF-036, XF-050.
  Gap: this is the densest bug-regression surface in the CTO PR and deserves dedicated fuzz families rather than only generic removed-operator coverage.

- Long-horizon, same-block, and bulk-topology lifecycle extremes.
  Representative CTO scenarios: XF-010, XF-011, XF-012, XF-013, XF-014, XF-015, XF-016.
  Gap: the current plan has lifecycle coverage, but not a dedicated family for 1M-block drift, same-block zero-fee behavior, or bulk 100-validator cascades.

- Migration to staking and reward-distribution cross-product.
  Representative CTO scenarios: XG-001..XG-025.
  Gap: current CAT-PM focuses on migrated clusters, but not on migrated-cluster interactions with staking entry timing, syncFees, claims, cSSV transfers, unstake, and zero-supply periods.

- Governance and oracle transitions under live load.
  Representative CTO scenarios: XF-020, XF-033, XF-034, XF-044, XF-049, XF-054, XF-055, XF-058, DA-063, DA-088, DA-107.
  Gap: current CAT-6 covers isolated governance changes, but not enough live-round, cross-module, or all-parameters-at-once scenarios.

- Validator-count and EB-interleaving lifecycle.
  Representative CTO scenarios: XV-009, XV-010, XV-011, XV-018, XV-019, XV-020, XV-036, XV-039, XV-041, XV-057, XF-042.
  Gap: current CAT-3 covers EB changes and CAT-2 covers validator lifecycle, but not a dedicated family for their interleaving.

- ETH cluster precision and payout edge matrix.
  Representative CTO scenarios: CL-006, CL-007, CL-030, CL-036, CL-041, CL-048, CL-049, CL-052, CL-054, CL-055.
  Gap: current CAT-2 covers the lifecycle, but not a dedicated precision/boundary matrix for deposits, withdrawals, stale balances, and payout failures.

---

## CAT-2 Extensions

### CAT-2-10: ETH cluster deposit/withdraw precision and payout edge matrix

```
Setup:
  Operators: O1 x {4, 7, 10, 13}
  Cluster: active ETH cluster with configurable validator count and optional explicit EB
  Owner variant: EOA or contract that rejects ETH receipts

Phase 1 (baseline setup):
  - Register operators and cluster -> expect success
  - Optionally set explicit EB > baseline -> expect success
  - ✓ INV

Phase 2 (deposit edges):
  - deposit 0 ETH -> expect success
  - large deposit near packing / accounting boundary -> expect success
  - repeated large deposits -> expect success
  - deposit into cluster with one removed operator -> expect success
  - deposit into liquidated cluster by non-owner -> expect success
  - deposit into migrated cluster -> expect success
  - deposit into SSV-version cluster -> expect revert (IncorrectClusterVersion)
  - ✓ INV

Phase 3 (withdraw edges):
  - partial withdraw leaving balance exactly at liquidation threshold -> expect success
  - withdraw using stale pre-settlement balance where post-settlement balance is insufficient -> expect revert
  - withdraw 0 when post-settlement balance is below liquidation threshold -> expect revert
  - deposit -> EB update -> withdraw under higher threshold -> expect revert or reduced max withdraw
  - withdraw from owner contract that rejects ETH -> expect revert (ETHTransferFailed)
  - ✓ INV

Phase 4 (post-conditions):
  - Verify balance accounting exactness after each edge case
  - Verify no overflow or truncation surprises from repeated large deposits
  - Verify operator and DAO earnings are unchanged by failed payout paths
  - ✓ INV

Fuzzing: operator count, validator count, explicit-EB on/off, owner type, deposit amount, withdraw amount, block advancement
```

---

## CAT-3 Extensions

### CAT-3-11: Validator-count changes interleaved with explicit EB updates

```
Setup:
  Operators: O1 x {4, 7}
  Cluster: active ETH cluster, starts at implicit EB baseline

Phase 1 (initial expansion):
  - Register initial validator set -> expect success
  - updateClusterBalance to explicit EB -> expect success
  - Verify deviation stored on cluster, operators, and DAO
  - ✓ INV

Phase 2 (interleaving):
  - remove subset of validators -> expect success
  - register additional validators -> expect success
  - second updateClusterBalance with new validator count -> expect success
  - Verify vUnits change is based on current validator count and prior explicit state
  - ✓ INV

Phase 3 (cleanup paths):
  - serial single removals until one validator remains -> expect success
  - optional bulk remove all validators -> expect success
  - Verify deviation is preserved while cluster remains non-empty
  - Verify deviation is fully cleaned when cluster becomes empty
  - Verify returning to implicit EB after full cleanup leaves no stranded deviation
  - ✓ INV

Phase 4 (round-trip):
  - register new validators into formerly empty cluster -> expect success
  - optional explicit EB update again -> expect success
  - Verify second explicit cycle starts from a clean slate
  - ✓ INV

Fuzzing: operator count, initial validator count, remove/register order, EB values across updates, bulk vs serial removal, block advancement between steps
```

---

## CAT-4 Extensions

### CAT-4-9: Operator fee declaration window, overwrite, and boundary matrix

```
Setup:
  Operators: at least 1 active operator serving 1 or more ETH clusters
  Cluster: active ETH cluster with enough runway for fee changes to matter
  DAO params: configurable operatorMaxFee, minimumOperatorEthFee, approveOperatorFeePeriod

Phase 1 (declaration boundaries):
  - declareOperatorFee exactly at operatorMaxFee -> expect success
  - declareOperatorFee with zero-width approval window case -> expect success if supported by config, else expect revert
  - declare fee from zero-fee operator to non-zero when forbidden -> expect revert
  - ✓ INV

Phase 2 (execute boundaries):
  - executeOperatorFee exactly at approvalEndTime -> expect success
  - executeOperatorFee after approval window expires -> expect revert
  - Verify declaration alone does not change current fee
  - Verify successful execute changes current fee only once
  - ✓ INV

Phase 3 (overwrite and cancel):
  - declare a second fee while first request is pending -> expect overwrite semantics
  - overwrite after approval window expiry -> expect latest request semantics only
  - cancel pending request while open -> expect success
  - non-owner cancel -> expect revert
  - ✓ INV

Phase 4 (mid-flight governance changes):
  - DAO raises operatorMaxFee between declare and execute
  - DAO raises minimumOperatorEthFee between declare and execute
  - execute original request -> expect success or revert according to frozen/current rule
  - Verify cluster burn rate and earnings reflect the contract's actual rule, not stale assumptions
  - ✓ INV

Fuzzing: current fee, declared fee, approval period, overwrite timing, DAO fee bounds before/after declaration, block advancement
```

### CAT-4-10: Shared-operator fee propagation across multiple clusters

```
Setup:
  Operators: one shared operator S used by 2 clusters, plus distinct companion operators per cluster
  Clusters: C1 and C2 both active; optional explicit EB on one or both

Phase 1 (shared baseline):
  - Register C1 and C2 with shared operator S -> expect success
  - Advance blocks so both clusters accrue fees at the initial rate
  - ✓ INV

Phase 2 (shared fee change):
  - declareOperatorFee / executeOperatorFee on shared operator S -> expect success
  - Withdraw from C1 and C2 after the change -> expect success or bounded revert based on runway
  - Verify both clusters settle pre-change accrual at the old fee and post-change accrual at the new fee
  - ✓ INV

Phase 3 (compound effects):
  - optional EB increase on one cluster -> expect success
  - optional second operator fee change on another shared operator -> expect success
  - Verify one cluster may become liquidatable before the other due to balance / EB differences
  - Verify operator earnings are not double-counted across clusters
  - ✓ INV

Phase 4 (extreme variants):
  - reduce shared operator fee to zero -> expect success
  - remove shared operator after declaration but before execute -> expect execute revert
  - Verify liquidation-reactivation does not erase the applied fee change for surviving operators
  - ✓ INV

Fuzzing: shared vs unshared operator topology, fee deltas, explicit-EB on/off, block advancement, cluster balances, liquidation timing
```

---

## CAT-5 Extensions

### CAT-5-7: Removed-operator plus EB plus liquidation plus reactivation chain stress

```
Setup:
  Operators: O1 x {4, 7, 10, 13}, with 1..N operators removed over time
  Cluster: explicit-EB ETH cluster with enough balance to survive at least one full chain
  Optional: second cluster sharing one or more of the removed operators

Phase 1 (pre-bug-state):
  - Register cluster and set explicit EB -> expect success
  - Remove one operator -> expect success
  - Optional second EB update -> expect success
  - ✓ INV

Phase 2 (liquidation chain):
  - Trigger manual liquidation OR auto-liquidation via EB increase -> expect success
  - Reactivate cluster with sufficient ETH -> expect success
  - Optional post-reactivation EB update -> expect success
  - ✓ INV

Phase 3 (interleaving):
  - Remove more operators between EB updates
  - deposit / withdraw after removals -> expect success where valid
  - removeValidator / bulkRemoveValidator after the chain -> expect success where valid
  - Verify removed operators never regain active fee participation or stranded vUnits
  - Verify no underflow, resurrection, or double-cleanup occurs
  - ✓ INV

Phase 4 (shared-cluster variants):
  - Update or liquidate a second cluster sharing a removed operator
  - Verify unaffected clusters remain unaffected except for legitimately shared operator state
  - ✓ INV

Fuzzing: operator count, removal order, number of removals, EB sequence, manual vs auto liquidation, shared-cluster topology, validator count, block advancement
```

### CAT-5-8: Long-horizon, same-block, and bulk-topology lifecycle extremes

```
Setup:
  Operators: enough operators to build 10 clusters and shared-operator topologies
  Clusters: up to 10 clusters, total validator population up to 100, optional explicit EB on a subset

Phase 1 (same-block behavior):
  - perform register / deposit / withdraw / fee change / EB update in the same block where supported -> expect success
  - Verify zero or minimal fee accrual when blockDiff == 0
  - ✓ INV

Phase 2 (rapid-fire behavior):
  - repeat all operations with 1 block between each -> expect success
  - Verify tiny but non-zero accrual is exact and monotonic
  - ✓ INV

Phase 3 (time-lapse behavior):
  - ⏩ very large block gap (for example 1M blocks)
  - deposit and withdraw after the gap -> expect success or bounded liquidation behavior
  - Verify accounting, burn rate, and overflow-sensitive math remain exact
  - ✓ INV

Phase 4 (bulk cascades):
  - cascade operator fee changes across many clusters
  - cascade liquidation conditions across many clusters
  - Verify operator, cluster, and DAO accounting remains coherent under wide fan-out
  - ✓ INV

Fuzzing: cluster count, validator distribution, shared-operator density, EB values, block gaps, batch ordering, same-block vs multi-block sequencing
```

---

## CAT-PM Extensions

### CAT-PM-13: Migration with staking and reward-distribution lifecycle

```
Setup:
  Stakers: S1 and S2, where one may enter before migration and one after migration
  Cluster set: 1..N SSV clusters eligible for migration, with optional explicit EB and optional removed operators

Phase 1 (pre-migration staking state):
  - stake before migration -> expect success
  - advance blocks and syncFees if relevant -> expect success
  - ✓ INV

Phase 2 (migration):
  - migrate one or more SSV clusters to ETH -> expect success
  - optional updateClusterBalance after migration -> expect success
  - optional second staker enters after migration -> expect success
  - ✓ INV

Phase 3 (reward realization):
  - syncFees -> expect success
  - claimEthRewards for all stakers -> expect success
  - optional cSSV transfer between stakers -> expect success
  - optional requestUnstake / withdrawUnlocked -> expect success
  - Verify only post-migration ETH earnings are claimable as ETH rewards
  - Verify proportional split across pre- and post-migration entrants
  - ✓ INV

Phase 4 (cluster lifecycle after migration):
  - deposit / withdraw / liquidate / reactivate migrated cluster -> expect success where valid
  - syncFees and claim again
  - Verify reward rate tracks live ETH earning state through the full lifecycle
  - ✓ INV

Fuzzing: number of stakers, pre/post migration entry timing, number of migrated clusters, explicit-EB on/off, removed-operator on/off, stake sizes, block advancement
```

### CAT-PM-14: Migration with zero-supply staking and removed-operator reward divergence

```
Setup:
  Stakers: enough stakers to drive cSSV supply to zero and back
  Cluster: migrated ETH cluster with optional removed operator and optional explicit EB

Phase 1 (normal reward flow):
  - stake -> migrate -> syncFees -> claim -> expect success
  - ✓ INV

Phase 2 (zero-supply window):
  - all stakers requestUnstake and withdraw so cSSV supply reaches 0 -> expect success
  - advance blocks while migrated clusters still generate ETH fees
  - syncFees during zero-supply period -> expect success or explicit zero-supply handling
  - restake after zero-supply period -> expect success
  - ✓ INV

Phase 3 (removed-operator / explicit-EB variant):
  - remove operator from migrated cluster -> expect success
  - optional updateClusterBalance to explicit EB -> expect success
  - syncFees -> claimEthRewards -> expect success
  - Verify staking reward accounting follows actual distributable ETH and does not mint free rewards
  - Verify removed-operator burn-rate differences do not corrupt staking indices
  - ✓ INV

Phase 4 (stress variant):
  - liquidate and reactivate cluster after zero-supply window -> expect success where valid
  - syncFees and claim again
  - Verify zero-supply gaps and lifecycle changes do not cross-contaminate each other
  - ✓ INV

Fuzzing: zero-supply duration, removed-operator count, EB values, restake timing, claim timing, block advancement
```

---

## CAT-6 Extensions

### CAT-6-8: Oracle replacement and quorum transitions during a live round

```
Setup:
  Oracles: active committee with one slot that may be replaced mid-round
  Cluster: active ETH cluster eligible for updateClusterBalance
  DAO params: configurable quorumBps

Phase 1 (start live round):
  - commitRoot with partial votes below quorum -> expect success for vote storage but no finalization
  - Verify round is live and pending
  - ✓ INV

Phase 2 (governance transition):
  - replaceOracle while round is live -> expect success
  - old oracle attempts another vote -> expect revert
  - new oracle casts vote -> expect success if valid under the new committee rules
  - optional updateQuorumBps while round is pending -> expect success
  - ✓ INV

Phase 3 (resolution):
  - attempt updateClusterBalance before round is truly finalized -> expect revert
  - reach quorum under the protocol's actual frozen/current-supply rule -> expect success
  - updateClusterBalance using the finalized root -> expect success
  - Verify committee mapping, accumulated weight, and finalized-round cleanup are all correct
  - ✓ INV

Fuzzing: replaced oracle slot, timing of replacement, quorum bps before/after change, vote ordering, block advancement
```

### CAT-6-9: DAO parameter bundle changes with no cross-contamination

```
Setup:
  Operators: include at least one pending fee declaration and one active ETH operator
  Clusters: active ETH cluster plus optional legacy SSV cluster still pre-migration
  Staking: at least one pending unstake request

Phase 1 (baseline state):
  - create live cluster, pending operator fee request, and active staking position -> expect success
  - ✓ INV

Phase 2 (parameter bundle):
  - updateMinimumLiquidationCollateral -> expect success
  - updateMaximumOperatorFee -> expect success
  - updateMinimumOperatorEthFee -> expect success
  - updateNetworkFee ETH and/or SSV -> expect success
  - updateUnstakeCooldownDuration -> expect success
  - optionally perform all updates in the same block -> expect success
  - ✓ INV

Phase 3 (live fallout):
  - execute pending operator fee request -> expect success or revert according to the actual post-update rule
  - withdraw from cluster that was safe before but may now be unsafe -> expect success or revert according to the new threshold
  - withdrawUnlocked for old and new unstake requests -> verify old request keeps old semantics, new request uses new semantics
  - if a legacy SSV cluster exists, verify ETH fee updates do not mutate SSV fee behavior and vice versa
  - ✓ INV

Phase 4 (bundle isolation checks):
  - Verify no parameter update contaminates unrelated modules
  - Verify two-phase accrual is exact when network fee changes mid-lifecycle
  - Verify simultaneous updates do not corrupt oracle, cluster, operator, or staking state
  - ✓ INV

Fuzzing: parameter values, update ordering, same-block vs staggered execution, pending declaration timing, old/new unstake request timing, presence of SSV legacy cluster
```

---

## CAT-3 Extensions (Batch 2)

### CAT-3-12: Shared-root, same-block, and precision-boundary EB update matrix

```
Setup:
  Clusters: C1 and C2 active ETH clusters, optionally sharing operators
  Validators: configurable counts, including 0-validator and high-validator cases
  Oracle state: one committed root may contain leaves for multiple clusters in the same block

Phase 1 (root commit baseline):
  - commitRoot containing proofs for C1 and C2 -> expect success
  - Verify root finalized once, with no duplicate-weight contamination
  - ✓ INV

Phase 2 (same-root / same-block updates):
  - updateClusterBalance(C1) using committed root -> expect success
  - updateClusterBalance(C2) using the same committed root and same block -> expect success
  - Verify per-cluster snapshots advance independently while sharing the same committed root
  - Verify operator and DAO deviation stacking is exact for shared-operator topologies
  - ✓ INV

Phase 3 (precision boundaries):
  - update EB at exact baseline (32 ETH / validator) -> expect success with no deviation
  - update EB by the minimum precision step above baseline -> expect success
  - update EB at maximum allowed value -> expect success
  - attempt below-minimum EB -> expect revert
  - attempt above-maximum EB -> expect revert
  - Verify vUnits round-trip and packing behavior match protocol precision assumptions
  - ✓ INV

Phase 4 (state / staleness edges):
  - replay older root after a newer committed root exists -> expect revert
  - attempt update with non-existent cluster -> expect revert
  - attempt update with stale / incorrect cluster struct -> expect revert
  - if cluster is a liquidated SSV cluster, verify update stores snapshot only and does not mutate ETH deviation state
  - ✓ INV

Fuzzing: validator counts, shared-operator topology, root block ordering, EB values, same-block vs cross-block execution, liquidated / active cluster state
```

---

## CAT-5 Extensions (Batch 2)

### CAT-5-9: Progressive removed-operator cascade with EB oscillation

```
Setup:
  Operators: O1 x {4, 7, 13}
  Cluster: explicit-EB ETH cluster with enough runway to survive multiple transitions
  Removal plan: remove 1..N operators one-by-one with EB updates interleaved between removals

Phase 1 (seed explicit state):
  - Register validators and set explicit EB above baseline -> expect success
  - Verify non-zero deviation exists on cluster, operators, and DAO
  - ✓ INV

Phase 2 (cascade):
  - remove first operator -> expect success
  - updateClusterBalance with higher EB -> expect success
  - remove second operator -> expect success
  - updateClusterBalance with lower or oscillating EB -> expect success
  - repeat until only a subset of original operators remains
  - ✓ INV

Phase 3 (forced terminal path):
  - trigger liquidation manually or through auto-liquidation -> expect success
  - attempt reactivation with sufficient ETH -> expect success when semantically reachable
  - optional post-reactivation EB update -> expect success
  - Verify removed operators never regain deviation, fee participation, or active validator counts
  - Verify no underflow, resurrection, or double-subtraction occurs during cleanup
  - ✓ INV

Phase 4 (validator cleanup after cascade):
  - removeValidator / bulkRemoveValidator after the cascade -> expect success where valid
  - Verify cleanup respects the final live-operator set only
  - ✓ INV

Fuzzing: operator count, number and order of removals, EB oscillation sequence, manual vs auto liquidation path, validator count, block advancement between every step
```

### CAT-5-10: Dual-cluster shared removed-operator divergence

```
Setup:
  Clusters: C1 and C2 share at least one operator O4
  Operators: companion operators differ so one cluster is only partially overlapping with the other
  State: one cluster may be explicit-EB while the other remains implicit or uses a different EB path

Phase 1 (shared baseline):
  - Register C1 and C2 with shared operator O4 -> expect success
  - Optional explicit EB update on one or both clusters -> expect success
  - ✓ INV

Phase 2 (shared-operator removal):
  - removeOperator(O4) -> expect success
  - deposit / withdraw on both clusters -> expect success where valid
  - updateClusterBalance on both clusters -> expect success where valid
  - Verify both clusters now settle at the reduced live-operator burn rate
  - ✓ INV

Phase 3 (cluster divergence):
  - liquidate only C1 -> expect success
  - keep C2 active and continue deposits / withdrawals / EB updates -> expect success
  - reactivate C1 -> expect success if sufficiently funded
  - Verify O4 removal does not contaminate operators or clusters that do not actually share O4
  - Verify C2 remains operational even while C1 takes the full liquidation-reactivation path
  - ✓ INV

Phase 4 (cross-cluster invariants):
  - attempt to register a new cluster using removed O4 -> expect revert
  - Verify shared-operator accounting only propagates through legitimate shared topology
  - ✓ INV

Fuzzing: overlap graph between clusters, explicit-EB on/off per cluster, liquidation side, deposit / withdraw ordering, number of remaining live operators, block advancement
```

---

## CAT-PM Extensions (Batch 2)

### CAT-PM-15: Sequential multi-cluster migration with shared operators and staggered staking entry

```
Setup:
  Clusters: 2..N SSV clusters, with at least two sharing one or more operators
  Stakers: S1 enters before any migration; S2 and S3 may enter between migration waves
  Optional: one cluster starts near liquidation or with explicit EB snapshot on the SSV side

Phase 1 (pre-migration staking baseline):
  - stake from S1 -> expect success
  - advance blocks on the legacy configuration
  - ✓ INV

Phase 2 (sequential migration waves):
  - migrate first cluster -> expect success
  - syncFees -> expect success
  - second staker enters after first migration -> expect success
  - migrate second / third cluster with shared operators -> expect success
  - optional post-migration deposit / withdraw / EB update on the earliest migrated cluster -> expect success
  - ✓ INV

Phase 3 (shared-operator divergence after migration):
  - liquidate one migrated cluster while another shared-operator cluster remains active -> expect success
  - syncFees -> expect success
  - claimEthRewards for all stakers -> expect success
  - Verify reward-rate changes follow the actual active ETH-earning set, not historical cluster membership
  - ✓ INV

Phase 4 (late entry / transfer / unstake):
  - late staker enters after most migrations are complete -> expect success
  - optional cSSV transfer between stakers -> expect success
  - partial requestUnstake and withdrawUnlocked -> expect success
  - Verify claims remain proportional across pre- and post-migration entrants and transfer boundaries
  - ✓ INV

Fuzzing: number of clusters, migration ordering, shared-operator graph, pre/post migration staker entry timing, stake sizes, liquidation timing, explicit-EB on/off, block advancement
```

### CAT-PM-16: Staking precision, zero-supply, and payout-failure matrix under live ETH accrual

```
Setup:
  Stakers: at least 2 users plus one malicious / edge-case recipient contract
  Cluster set: at least one migrated ETH cluster generating claimable rewards
  Optional: removed-operator or explicit-EB migrated variant to alter reward-rate dynamics

Phase 1 (precision baseline):
  - stake large amount -> expect success
  - stake tiny amount -> expect success
  - syncFees after small and large earning periods -> expect success
  - Verify rounding never overpays and smallest non-zero payouts behave as expected
  - ✓ INV

Phase 2 (same-block / idempotence / transfer):
  - perform two staking actions in the same block -> expect success
  - syncFees with no new earnings -> expect success and no state corruption
  - cSSV transfer between users -> expect success
  - Verify sender and receiver settle at pre-transfer balances only
  - ✓ INV

Phase 3 (zero-supply window):
  - fully unstake all users until cSSV supply reaches zero -> expect success
  - advance blocks while migrated clusters still accrue ETH fees
  - syncFees during zero-supply window -> expect success or explicit zero-supply behavior
  - restake after the gap -> expect success
  - Verify no free rewards are minted across the zero-supply interval
  - ✓ INV

Phase 4 (payout failure and adversarial recipients):
  - claimEthRewards to contract that rejects ETH -> expect revert
  - simulate insufficient contract ETH or accounting mismatch -> expect revert or bounded failure
  - attempt cross-function reentrancy via receive hook into stake / requestUnstake -> expect revert
  - ✓ INV

Fuzzing: stake sizes, claim sizes, zero-supply duration, recipient type, removed-operator on/off, EB on/off, same-block vs cross-block execution
```

---

## CAT-6 Extensions (Batch 2)

### CAT-6-10: DAO precision, packing, and admin-guard matrix

```
Setup:
  DAO-governed values: ETH network fee, SSV network fee, operatorMaxFee, minimumOperatorEthFee, minimum liquidation collaterals, module addresses, fee recipient
  Protocol state: at least one live ETH cluster, one pending operator fee declaration, and optional legacy SSV cluster

Phase 1 (precision / packing boundaries):
  - set ETH and SSV fee parameters to values not divisible by protocol precision -> expect revert
  - set values at exact divisibility boundaries -> expect success
  - set values above uint64 packing range -> expect revert
  - set max / min operator fee exactly at equality boundary -> expect success
  - ✓ INV

Phase 2 (isolation checks):
  - update SSV fee only -> expect success
  - verify ETH fee accounting unchanged
  - update ETH fee only -> expect success
  - verify SSV fee accounting unchanged
  - ✓ INV

Phase 3 (admin guards and module wiring):
  - non-owner DAO update -> expect revert
  - updateModule to valid contract -> expect success
  - updateModule to EOA or zero address -> expect revert
  - set fee recipient to zero address if allowed -> expect success with expected event semantics
  - ✓ INV

Phase 4 (live-system fallout):
  - execute pending operator fee request after DAO boundary updates -> expect success or revert according to current rule
  - verify two-phase accrual remains exact when network fee changed mid-lifecycle
  - ✓ INV

Fuzzing: parameter values, divisibility boundaries, packed max values, admin caller identity, update ordering, presence of live pending protocol state
```

---

## CAT-1 Extensions (Batch 3)

### CAT-1-13: Legacy SSV cluster guard and exact settlement matrix

```
Setup:
  Operators: legacy SSV-fee operators with configurable fee mix
  Cluster: active SSV cluster with configurable validator count, including near-zero-balance edge cases
  Optional: cluster may already be liquidated or may carry an SSV-side EB snapshot only

Phase 1 (legacy accrual baseline):
  - Register legacy operators and validators -> expect success
  - ⏩ fixed accrual window
  - Verify exact SSV fee deduction against independent calculation
  - Verify DAO SSV earnings match expected network-fee share
  - ✓ INV

Phase 2 (legacy-only semantics):
  - updateClusterBalance on SSV cluster -> expect success
  - Verify only the EB snapshot is updated and no ETH-side deviation or settlement is applied
  - self-liquidate active SSV cluster -> expect success
  - Verify returned SSV matches post-settlement balance, including near-zero path where payout floors to 0
  - second liquidation on already-liquidated SSV cluster -> expect revert
  - ✓ INV

Phase 3 (version guards):
  - attempt ETH deposit on SSV cluster -> expect revert (IncorrectClusterVersion)
  - attempt ETH withdraw on SSV cluster -> expect revert (IncorrectClusterVersion)
  - attempt ETH reactivation on SSV cluster -> expect revert (IncorrectClusterVersion)
  - attempt ETH-only lifecycle operations on the SSV cluster -> expect revert
  - ✓ INV

Phase 4 (migration handoff readiness):
  - migrateClusterToETH from a valid SSV cluster -> expect success
  - Verify legacy-only semantics held up to the migration boundary with no leaked ETH-side state
  - ✓ INV

Fuzzing: SSV fees, validator count, legacy balance amount, near-zero edge distance, block advancement, liquidated vs active start state
```

### CAT-1-14: Migration threshold, refund, removed-operator, and post-migration continuity matrix

```
Setup:
  Cluster: SSV cluster prepared for migration, with variants for 4 / 7 / 10 operators
  Operator mix: all active, one removed, multiple removed, zero-fee, mixed-fee, explicit-EB, liquidated, and zero-validator variants
  Optional: two clusters may share the same operators and migrate sequentially

Phase 1 (migration threshold edges):
  - migrate with ETH deposit exactly at liquidation threshold -> expect success
  - migrate with ETH deposit 1 wei below threshold -> expect revert
  - migrate with ETH deposit 0 -> expect revert
  - non-owner migration attempt -> expect revert
  - migration with stale cluster struct -> expect revert
  - ✓ INV

Phase 2 (economic correctness):
  - migrate healthy cluster -> expect success
  - Verify exact SSV refund against independent fee-settlement calculation
  - Verify DAO settles both SSV and ETH-side earnings correctly at migration time
  - Verify post-migration accrual uses ETH fees only, never legacy SSV fees
  - ✓ INV

Phase 3 (removed-operator / explicit-EB variants):
  - migrate cluster with removed operator(s) -> expect success
  - Verify removed operators stay inactive, keep zero ethValidatorCount, and are skipped by ETH setup
  - Verify frozen SSV snapshot/index contributes only to the legacy refund side where appropriate
  - if explicit EB exists, verify deviation handoff follows actual protocol semantics and does not revive dead operators
  - ✓ INV

Phase 4 (continuity after migration):
  - immediately call updateClusterBalance after migration -> expect success
  - remove operator after migration, then updateClusterBalance again -> expect success where valid
  - liquidate and reactivate migrated cluster -> expect success when sufficiently funded
  - if two clusters share operators and migrate sequentially, verify no cumulative-index corruption across migrations
  - ✓ INV

Fuzzing: operator count, removed-operator count and removal timing, ETH deposit at / around threshold, explicit-EB on/off, liquidated vs healthy start state, shared-operator topology, block advancement
```

---

## CAT-2 Extensions (Batch 3)

### CAT-2-11: Validator registration guard, whitelist, and funding matrix

```
Setup:
  Operators: combinations of public, private, zero-fee, removed, and large operator sets (4 / 7 / 10 / 13)
  Cluster: new ETH cluster creation path and existing ETH cluster registration path
  Caller variants: owner, non-owner, legacy-whitelisted caller, bitmap-whitelisted caller, non-whitelisted caller

Phase 1 (input-shape guards):
  - bulk register with empty public keys -> expect revert
  - bulk register with mismatched key/share arrays -> expect revert
  - register with invalid public key length -> expect revert
  - register with <4 operator IDs -> expect revert
  - register with invalid cardinality such as 5 or 14 operator IDs -> expect revert
  - register with unsorted operator IDs -> expect revert
  - register with duplicate operator IDs -> expect revert
  - ✓ INV

Phase 2 (state / ownership guards):
  - register already-registered validator -> expect revert
  - register with stale / incorrect initial cluster struct -> expect revert
  - register against existing legacy SSV cluster that has not yet migrated -> expect revert
  - register with active=false in initial cluster struct -> expect revert
  - register using removed operator -> expect revert
  - ✓ INV

Phase 3 (whitelist and funding matrix):
  - register using private operators with non-whitelisted caller -> expect revert
  - register using legacy whitelist path -> expect success
  - register using bitmap whitelist path across slot boundaries -> expect success
  - register with msg.value exactly at required threshold -> expect success
  - register with msg.value 1 wei below threshold -> expect revert
  - register with msg.value 0 -> expect revert
  - ✓ INV

Phase 4 (successful registration variants):
  - register validator on 13-operator cluster -> expect success
  - register on zero-fee operators -> expect success with zero operator-fee accrual
  - add validator to explicit-EB cluster -> expect success, with baseline vUnits increase only
  - register operators and validator in the same block -> expect success
  - bulk register 50 / 100 validators where limits allow -> expect success
  - verify cluster balance == msg.value for new cluster and operator/DAO counts update exactly once
  - ✓ INV

Fuzzing: operator topology, caller whitelist mode, validator count, msg.value around threshold, same-block vs cross-block registration, explicit-EB on/off
```

### CAT-2-12: Validator removal, bulk removal, and exit lifecycle matrix

```
Setup:
  Clusters: active ETH cluster, liquidated ETH cluster, and optional legacy SSV cluster
  Variants: implicit EB, explicit EB, one or more removed operators, 2-validator to high-validator populations
  Ownership: owner and non-owner callers

Phase 1 (single remove semantics):
  - remove non-existent validator -> expect revert
  - remove by wrong owner -> expect revert
  - remove from active cluster -> expect success
  - remove then re-register same pubkey -> expect success where protocol allows
  - Verify fee settlement exactness and operator validator counts after removal
  - ✓ INV

Phase 2 (bulk remove semantics):
  - bulk remove with empty list -> expect revert
  - bulk remove subset of validators from non-empty cluster -> expect success
  - bulk remove all validators from explicit-EB cluster -> expect success where valid
  - verify cluster persists with remaining balance when last validator is removed
  - verify deviation cleanup is exact when cluster becomes empty
  - ✓ INV

Phase 3 (liquidated / removed-operator variants):
  - removeValidator from liquidated ETH cluster -> expect success or no-settlement semantics according to protocol
  - bulkRemoveValidator from liquidated cluster with explicit EB -> verify no double cleanup / stranded deviation
  - remove / bulk remove on cluster containing removed operators -> expect success where valid without underflow
  - ✓ INV

Phase 4 (exit semantics):
  - exitValidator on active cluster -> expect event only, no state mutation beyond allowed semantics
  - exitValidator on non-existent validator -> expect revert
  - exitValidator with wrong operator IDs -> expect revert
  - exitValidator from legacy SSV cluster -> expect event only, no illegal state mutation
  - bulkExitValidator by non-owner -> expect revert
  - bulkExitValidator from liquidated cluster -> expect event semantics only
  - ✓ INV

Fuzzing: validator population, bulk-remove size, explicit-EB on/off, removed-operator count, active vs liquidated cluster state, SSV vs ETH version, owner vs non-owner caller
```

---

## CAT-5 Extensions (Batch 4)

### CAT-5-11: Removed-operator EB-write bug reproduction matrix

```
Setup:
  Operators: clusters with 4 / 7 / 10 / 13 operators
  Cluster: ETH cluster with optional explicit EB baseline or non-baseline deviation
  Removal timing: remove one operator before the first explicit EB update or between sequential EB updates

Phase 1 (seed removal state):
  - Register cluster -> expect success
  - Remove one operator -> expect success
  - Verify removed operator has ethValidatorCount == 0, ethFee == 0, ethSnapshot.block == 0
  - ✓ INV

Phase 2 (EB-write matrix):
  - first EB increase after removal -> expect success or bug reproduction depending on implementation
  - first EB decrease after removal -> expect success or underflow bug reproduction depending on implementation
  - chained EB increase then partial decrease -> expect success or residual/underflow bug reproduction
  - case where newVUnits == storedVUnits -> expect no-op path with no removed-operator touch
  - ✓ INV

Phase 3 (cross-scale variants):
  - repeat on 7 / 10 / 13 operator topologies -> expect consistent semantics
  - remove second operator between EB updates -> expect success or bug reproduction depending on implementation
  - remove all operators before EB increase -> verify no ghost revival of deleted slots
  - ✓ INV

Phase 4 (cross-cluster contamination):
  - same removed operator shared by two clusters -> update both clusters
  - Verify stale / resurrected state does not propagate across clusters except through legitimate shared live operators
  - ✓ INV

Fuzzing: operator count, removed operator position, explicit-EB values, increase vs decrease sequence, number of removed operators, shared-cluster topology, block advancement
```

### CAT-5-12: Manual vs auto-liquidation divergence on removed-operator explicit-EB clusters

```
Setup:
  Cluster: explicit-EB ETH cluster with one or more removed operators
  Liquidation mode: manual liquidate(), auto-liquidation via EB increase, and exact-threshold boundary paths

Phase 1 (manual liquidation path):
  - remove operator after explicit EB is set -> expect success
  - drain or position balance to liquidation boundary -> expect success
  - call manual liquidate() -> expect success or bug reproduction depending on implementation
  - Verify removed operator is skipped for ethValidatorCount decrement and receives no payout-side resurrection
  - ✓ INV

Phase 2 (auto-liquidation path):
  - from equivalent state, increase EB to trigger auto-liquidation -> expect success or bug reproduction depending on implementation
  - Compare cleanup order and final state against manual liquidation path
  - Verify DAO deviation cleanup uses full cluster deviation and removed operators remain skipped
  - ✓ INV

Phase 3 (extreme variants):
  - large explicit EB (up to protocol max) -> expect success without overflow
  - multiple removed operators -> expect only live operators touched during cleanup
  - all operators removed -> liquidation still cleans cluster / DAO state without reviving any operator
  - ✓ INV

Phase 4 (post-liquidation continuity):
  - reactivate cluster with sufficient ETH -> expect success when semantically allowed
  - Verify removed operators still have zero ETH-side participation after reactivation
  - ✓ INV

Fuzzing: liquidation mode, threshold distance, explicit-EB value, removed-operator count, operator position, block advancement, reactivation funding
```

### CAT-5-13: Last-validator cleanup matrix on removed-operator clusters

```
Setup:
  Cluster: ETH cluster with explicit EB or implicit EB, one or more removed operators, and 1..N validators
  Removal mode: single removeValidator and bulkRemoveValidator, including last-validator and non-last-validator paths

Phase 1 (non-terminal removals):
  - remove a validator while cluster still has remaining validators -> expect success
  - bulk remove a subset while cluster remains non-empty -> expect success
  - Verify no full deviation cleanup happens before the cluster becomes empty
  - ✓ INV

Phase 2 (terminal removals):
  - single removeValidator on the last validator -> expect success or bug reproduction depending on implementation
  - bulkRemoveValidator removing the final validator set -> expect success or bug reproduction depending on implementation
  - Verify ebSnapshot clearing, cluster cleanup, and live-operator deviation subtraction are exact
  - ✓ INV

Phase 3 (scale and topology variants):
  - repeat on 4 / 7 / 10 / 13 operator clusters
  - repeat with 2 or more removed operators
  - repeat with zero-deviation baseline EB path and with large explicit deviation path
  - ✓ INV

Phase 4 (cluster state variants):
  - liquidated cluster -> cleanup path should skip unsafe active-state assumptions
  - cross-cluster removed-operator contamination present on another cluster -> verify guard prevents corruption
  - ✓ INV

Fuzzing: operator count, validator count, single vs bulk remove, removed-operator count, explicit-EB on/off, liquidated vs active state, block advancement
```

### CAT-5-14: Removed-operator reactivation and all-operators-removed terminal matrix

```
Setup:
  Cluster: liquidated ETH cluster with variants for implicit EB, explicit EB, one removed operator, multiple removed operators, and all operators removed
  Funding: reactivation deposit sized from exact solvency threshold up to heavily overfunded

Phase 1 (reactivation with partial operator removal):
  - liquidate cluster after operator removal -> expect success or bounded bug path
  - reactivate with sufficient ETH -> expect success
  - Verify removed operators remain skipped while live operators regain active ETH participation
  - ✓ INV

Phase 2 (all-operators-removed path):
  - remove all operators -> expect success
  - reactivate with burnRate == 0 operator side -> expect success if only protocol solvency rules remain
  - Verify no operator receives ghost ETH fee, validator count, or vUnits on reactivation
  - ✓ INV

Phase 3 (deviation-bearing variants):
  - explicit EB with live deviation before liquidation -> reactivate -> verify deviation restored only to live operators
  - EB update while liquidated, then reactivate -> verify reactivation uses stored semantics without reviving dead operators
  - ✓ INV

Phase 4 (validator-limit and position variants):
  - active live operator already at validator limit -> reactivation should revert if protocol enforces the limit
  - removed operator in first / last / mixed positions -> guard must behave identically
  - ✓ INV

Fuzzing: removed-operator count, all-removed on/off, explicit-EB on/off, reactivation funding, validator-limit pressure, operator positions, block advancement
```

---

## CAT-INV: Invariant Meta-Scenarios

### CAT-INV-1: Removed-operator invariant checkpoints after every phase boundary

```
Setup:
  Clusters: one ETH cluster with removed-operator path, plus optional second cluster sharing the removed operator
  Invariants of interest: G11-style removed-operator cleanliness, version exclusivity, daoTotalEthVUnits integrity, clusterEB.vUnits invariants, and validator-count conservation

Phase 1 (register + remove):
  - Register cluster and remove operator -> expect success
  - Assert removed-operator ETH state is zeroed and DAO validator counts remain consistent
  - ✓ INV

Phase 2 (EB update / deposit / withdraw):
  - perform EB update, deposit, and withdraw in varied orders -> expect success where valid
  - After each step, assert removed-operator slots stay untouched and clusterEB.vUnits changes only when semantically justified
  - ✓ INV

Phase 3 (liquidation / reactivation):
  - liquidate and reactivate -> expect success or explicit known-bug classification
  - After each phase boundary, assert daoTotalEthVUnits and live-operator deviation match the active cluster set only
  - ✓ INV

Phase 4 (cross-cluster / migration continuation):
  - optional second cluster EB update or migration after the first cluster’s removed-operator path
  - Assert no cumulative stale data leaks into unrelated clusters
  - ✓ INV

Fuzzing: phase ordering, shared-cluster topology, explicit-EB values, liquidation mode, migration on/off, block advancement
```

### CAT-INV-2: Cross-version invariant chain through SSV -> ETH migration and mixed-cluster operation

```
Setup:
  Clusters: one legacy SSV cluster and one ETH cluster, optionally sharing operators
  Variants: legacy cluster may migrate mid-run; ETH cluster may undergo EB updates, removals, liquidation, and reactivation
  Invariants of interest: version exclusivity, daoTotalEthVUnits composition, clusterEB.vUnits zero/non-zero rules, and operator validator-count conservation across versions

Phase 1 (mixed-version baseline):
  - Operate legacy SSV cluster and ETH cluster in parallel -> expect success
  - Assert SSV-only operations do not mutate ETH-only accounting and vice versa
  - ✓ INV

Phase 2 (migration boundary):
  - migrate legacy cluster -> expect success
  - Assert version exclusivity immediately after migration
  - Assert migrated deviation and validator counts compose correctly with pre-existing ETH clusters
  - ✓ INV

Phase 3 (post-migration mixed lifecycle):
  - run EB update, removal, liquidation, and reactivation on one or both clusters -> expect success where valid
  - After every phase boundary, assert DAO, cluster, and operator accounting is the sum of live active ETH clusters only
  - ✓ INV

Phase 4 (terminal cleanup):
  - remove final validators or liquidate emptied clusters -> expect success where valid
  - Assert empty clusters clear deviation state and mixed-version invariants still hold globally
  - ✓ INV

Fuzzing: migration timing, shared-operator topology, explicit-EB on/off, removed-operator timing, number of active clusters per version, block advancement
```

---

## Next Batches

- DAO oracle-governance corner cases beyond the live-round replacements already captured here, only if you still want more depth after implementing the scenarios above.
- Optional pass to split the largest CATs in this file into implementation batches mapped one-to-one to future fuzz files.
