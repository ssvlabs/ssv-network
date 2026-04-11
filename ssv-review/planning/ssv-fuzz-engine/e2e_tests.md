# E2E Test Cases — Step 2

Test cases organized by the categories defined in [Step 1](./step_1.MD). Each scenario composes operator, cluster, and EB archetypes from Axis 1, follows the action sequence template, and checks invariants at every transition.

**Convention:** `-> expect revert` means the action must revert. `-> expect success` means it must succeed. `✓ INV` means check all invariants (INV-1..INV-8). Advance N blocks is written as `⏩ N blocks`.

---

## CAT-1: Upgrade & Migration

### CAT-1-1: Healthy cluster, normal operators — full migration

```
Setup:
  Operators: O1 × 4 (normal, SSV fee > 0)
  Cluster: C1 (active, 3 validators, well-funded)

Phase 1 (pre-upgrade):
  - Register 4 operators with SSV fee
  - Register 3 validators on cluster
  - ⏩ 100 blocks (fees accrue)

Phase 2 (upgrade):
  - Execute v2.0.0 upgrade
  - ✓ INV

Phase 3 (blocked SSV operations):
  - registerValidator on SSV cluster -> expect revert (IncorrectClusterVersion)
  - deposit SSV on cluster -> expect revert (IncorrectClusterVersion)
  - reactivate SSV cluster -> expect revert (IncorrectClusterVersion)
  - withdraw SSV from cluster -> expect revert (IncorrectClusterVersion)
  - removeValidator on SSV cluster -> expect success
  - re-register the removed validator so count is back to 3 -> expect revert (IncorrectClusterVersion)

Phase 4 (migration):
  - migrateClusterToETH with sufficient ETH -> expect success
  - Verify SSV refund sent to owner (remaining SSV balance after fee settlement)
  - Verify cluster now in ethClusters, deleted from clusters
  - Verify each operator: validatorCount decreased, ethValidatorCount increased
  - Verify ensureETHDefaults triggered for all 4 operators (ethFee = DEFAULT_OPERATOR_ETH_FEE)
  - ✓ INV (especially INV-5 version exclusivity, INV-6 dual tracking)

Phase 5 (post-migration ETH operations):
  - ⏩ 50 blocks
  - registerValidator (ETH) -> expect success
  - deposit ETH -> expect success
  - withdraw ETH (partial) -> expect success
  - ✓ INV

Fuzzing: SSV balance amount, ETH deposit amount, block advancement
```

### CAT-1-2: Liquidated cluster — migration reactivates

```
Setup:
  Operators: O1 × 4
  Cluster: C3 (liquidated pre-upgrade)

Phase 1 (pre-upgrade):
  - Register operators and validators
  - ⏩ enough blocks to deplete balance
  - liquidate cluster -> expect success
  - Verify cluster.active == false

Phase 2 (upgrade):
  - Execute v2.0.0 upgrade
  - ✓ INV

Phase 3 (migration of liquidated cluster):
  - migrateClusterToETH with sufficient ETH -> expect success
  - Verify ClusterReactivated event emitted (in addition to ClusterMigratedToETH)
  - Verify cluster.active == true
  - Verify SSV refund == 0 (balance was 0 at liquidation)
  - Verify operator SSV validatorCount NOT decremented again (was already decremented at liquidation)
  - Verify operator ethValidatorCount incremented
  - ✓ INV

Phase 4 (operate as ETH cluster):
  - ⏩ 100 blocks
  - registerValidator -> expect success
  - ✓ INV

Fuzzing: ETH deposit amount (minimum viable to max), block gap between liquidation and migration
```

### CAT-1-3: Cluster with 1 removed operator — migration skips removed op

```
Setup:
  Operators: O1 × 3 + O4 × 1 (3 normal + 1 removed)
  Cluster: C5 (active, 1 of 4 operators removed)

Phase 1 (pre-upgrade):
  - Register 4 operators, register validators
  - removeOperator on operator #4
  - ⏩ 50 blocks

Phase 2 (upgrade):
  - Execute v2.0.0 upgrade
  - ✓ INV

Phase 3 (migration):
  - migrateClusterToETH with sufficient ETH -> expect success
  - Verify removed operator skipped: no ethValidatorCount increment, no ensureETHDefaults
  - Verify 3 active operators: ethValidatorCount incremented, ethFee set
  - Verify burn rate excludes removed operator's fee
  - Verify minimum ETH calculation uses only 3 operators' fees + network fee
  - ✓ INV

Phase 4 (post-migration operations):
  - registerValidator -> expect success (cluster operates with 3/4 operators)
  - ⏩ 200 blocks
  - withdraw partial ETH -> expect success
  - Verify fee accrual only from 3 operators
  - ✓ INV

Fuzzing: Which operator position is removed (1st, 2nd, 3rd, 4th), ETH deposit amount
```

### CAT-1-4: Cluster with ALL operators removed

```
Setup:
  Operators: O4 × 4 (all removed)
  Cluster: C6 (active, all operators removed)

Phase 1 (pre-upgrade):
  - Register 4 operators, register validators
  - removeOperator on all 4
  - ⏩ 50 blocks

Phase 2 (upgrade):
  - Execute v2.0.0 upgrade
  - ✓ INV

Phase 3 (migration):
  - migrateClusterToETH with minimumLiquidationCollateral ETH -> expect success
  - Verify all operators skipped
  - Verify burn rate == networkFee only (no operator fees)
  - ✓ INV

Phase 4 (post-migration):
  - Cluster has 0 effective burn rate from operators
  - ⏩ 1000 blocks
  - Verify cluster balance only decreases by network fee portion
  - ✓ INV

Fuzzing: ETH deposit amount
```

### CAT-1-5: Zero-fee operators cluster — migration

```
Setup:
  Operators: O2 × 4 (SSV fee = 0)
  Cluster: C7 (all zero-fee operators)

Phase 1 (pre-upgrade):
  - Register 4 operators with fee = 0
  - Register validators, deposit SSV for network fee runway

Phase 2 (upgrade):
  - Execute v2.0.0 upgrade
  - ✓ INV

Phase 3 (migration):
  - migrateClusterToETH -> expect success
  - Verify ensureETHDefaults sets ethFee = 0 (because SSV fee was 0)
  - Verify burn rate == networkFee only
  - Verify minimum ETH = max(minimumLiquidationCollateral, networkFee-based threshold)
  - ✓ INV

Phase 4 (verify zero operator fees persist):
  - ⏩ 500 blocks
  - Verify operator ETH earnings == 0
  - Verify cluster balance only decreased by network fee
  - withdrawAllOperatorEarnings -> expect revert or 0 ETH
  - ✓ INV

Fuzzing: ETH deposit amount, number of validators
```

### CAT-1-6: Max-fee operators cluster — migration

```
Setup:
  Operators: O3 × 4 (SSV fee = max)
  Cluster: C8 (all max-fee operators)

Phase 1 (pre-upgrade):
  - Register 4 operators at operatorMaxFeeSSV
  - Register validators, heavily fund with SSV

Phase 2 (upgrade):
  - Execute v2.0.0 upgrade
  - ✓ INV

Phase 3 (migration):
  - migrateClusterToETH with large ETH deposit -> expect success
  - Verify ensureETHDefaults sets ethFee = DEFAULT_OPERATOR_ETH_FEE (not max)
  - Verify operators can later declare+execute higher ETH fees
  - ✓ INV

Phase 4 (high burn rate operations):
  - ⏩ 100 blocks
  - Verify cluster balance decreasing at expected rate (4 × DEFAULT_ETH_FEE + networkFee) × vUnits
  - ✓ INV

Fuzzing: ETH deposit amount, block advancement, number of validators
```

### CAT-1-7: Mixed-fee operators cluster — migration

```
Setup:
  Operators: O2 × 1 + O1 × 2 + O3 × 1 (zero + normal + normal + max)
  Cluster: C9

Phase 1 (pre-upgrade):
  - Register operators with varying SSV fees
  - Register validators

Phase 2 (upgrade):
  - Execute v2.0.0 upgrade
  - ✓ INV

Phase 3 (migration):
  - migrateClusterToETH -> expect success
  - Verify O2 (zero-fee): ethFee = 0
  - Verify O1 (normal): ethFee = DEFAULT_OPERATOR_ETH_FEE
  - Verify O3 (max-fee): ethFee = DEFAULT_OPERATOR_ETH_FEE
  - ✓ INV

Phase 4 (verify mixed burn rates):
  - ⏩ 200 blocks
  - Verify operator earnings: O2 earned 0 ETH, O1 and O3 earned DEFAULT rate, all proportional
  - withdrawOperatorEarnings for each -> verify amounts
  - ✓ INV

Fuzzing: Fee values for the "normal" operators, validator count
```

### CAT-1-8: Near-liquidation cluster — migration with minimum ETH

```
Setup:
  Operators: O1 × 4
  Cluster: C2 (near-liquidation, barely funded)

Phase 1 (pre-upgrade):
  - Register cluster with minimal SSV
  - ⏩ blocks until balance is barely above SSV liquidation threshold

Phase 2 (upgrade):
  - Execute v2.0.0 upgrade
  - ✓ INV

Phase 3 (migration edge cases):
  - migrateClusterToETH with ETH = minimumLiquidationCollateral - 1 wei -> expect revert (InsufficientBalance)
  - migrateClusterToETH with ETH = exact minimum required -> expect success
  - Verify SSV refund is small (most SSV was consumed by fees)
  - ✓ INV

Fuzzing: Exact balance at migration time, ETH deposit amount around the minimum threshold
```

### CAT-1-9: Zero-validators cluster — migration

```
Setup:
  Operators: O1 × 4
  Cluster: C4 (active, 0 validators, residual SSV balance)

Phase 1 (pre-upgrade):
  - Register operators and validators
  - Remove all validators
  - Verify cluster.validatorCount == 0, cluster still active

Phase 2 (upgrade):
  - Execute v2.0.0 upgrade
  - ✓ INV

Phase 3 (migration):
  - migrateClusterToETH with minimumLiquidationCollateral -> expect success
  - Verify SSV refund (no fees accrued since no validators)
  - Verify ethDaoValidatorCount unchanged (0 validators moved)
  - ✓ INV

Phase 4 (add validators post-migration):
  - registerValidator on migrated ETH cluster -> expect success
  - ✓ INV

Fuzzing: Residual SSV balance, ETH deposit amount
```

### CAT-1-10: Large cluster (13 operators) — migration

```
Setup:
  Operators: O1 × 10 + O2 × 2 + O4 × 1 (10 normal + 2 zero-fee + 1 removed)
  Cluster: C10 (13 operators, 10 validators)

Phase 1 (pre-upgrade):
  - Register 13 operators, register 10 validators
  - Remove operator #13
  - ⏩ 200 blocks

Phase 2 (upgrade):
  - Execute v2.0.0 upgrade
  - ✓ INV

Phase 3 (migration):
  - migrateClusterToETH with sufficient ETH -> expect success
  - Verify 12 operators processed (removed one skipped)
  - Verify 10 operators got DEFAULT_OPERATOR_ETH_FEE, 2 got ethFee = 0
  - Verify correct SSV refund for 10 validators × 12 active ops × 200 blocks
  - ✓ INV

Fuzzing: Number of validators (1-20), which operators are removed, fee distribution
```

### CAT-1-11: Private operators cluster — migration + post-migration whitelist

```
Setup:
  Operators: O5 × 4 (all private/whitelisted)
  Cluster: C1 variant (healthy, using private operators)

Phase 1 (pre-upgrade):
  - Register 4 private operators
  - Whitelist cluster owner
  - Register validators

Phase 2 (upgrade):
  - Execute v2.0.0 upgrade
  - ✓ INV

Phase 3 (migration):
  - migrateClusterToETH -> expect success
  - ✓ INV

Phase 4 (whitelist enforcement post-migration):
  - Non-whitelisted user tries registerValidator with these operators -> expect revert
  - Whitelisted user registerValidator -> expect success
  - ✓ INV

Fuzzing: Number of private vs public operators in the set
```

### CAT-1-12: Operator with pending fee declaration — migration interaction

```
Setup:
  Operators: O6 × 2 + O1 × 2 (2 with pending fee + 2 normal)
  Cluster: C1

Phase 1 (pre-upgrade):
  - Register operators, register validators
  - declareOperatorFee for operators 1 and 2

Phase 2 (upgrade):
  - Execute v2.0.0 upgrade
  - ✓ INV

Phase 3 (fee execution blocked):
  - executeOperatorFee for operators 1 and 2 -> expect revert (approvalBeginTime <= UPGRADE_TIMESTAMP)
  - Verify pre-upgrade declarations are dead

Phase 4 (migration):
  - migrateClusterToETH -> expect success
  - Verify ensureETHDefaults used, not the pending fee
  - ✓ INV

Phase 5 (new fee declaration post-upgrade):
  - declareOperatorFee with new value -> expect success
  - ⏩ declareOperatorFeePeriod
  - executeOperatorFee -> expect success
  - ✓ INV

Fuzzing: Fee values declared pre and post upgrade
```

---

## CAT-2: Post-Upgrade Cluster Lifecycle

### CAT-2-1: Fresh ETH cluster — full lifecycle

```
Setup:
  Operators: O7 × 4 (post-upgrade new, ETH-only)

Phase 1 (create):
  - Register 4 operators with ETH fees
  - registerValidator with ETH deposit -> expect success
  - Verify cluster created in ethClusters
  - Verify operator.ethValidatorCount == 1 for each
  - ✓ INV

Phase 2 (grow):
  - bulkRegisterValidator (add 4 more) with ETH -> expect success
  - Verify validatorCount == 5
  - ✓ INV

Phase 3 (deposit + withdraw):
  - ⏩ 100 blocks
  - deposit ETH -> expect success
  - withdraw partial ETH -> expect success
  - Verify cluster not liquidatable after withdrawal
  - ✓ INV

Phase 4 (shrink):
  - removeValidator -> expect success
  - bulkRemoveValidator (remove 2) -> expect success
  - Verify validatorCount == 2
  - ✓ INV

Phase 5 (liquidation):
  - ⏩ enough blocks to make cluster liquidatable
  - Non-owner calls liquidate -> expect success
  - Verify bounty transferred to liquidator
  - Verify cluster.active == false, balance == 0
  - Verify operator.ethValidatorCount decremented
  - ✓ INV

Phase 6 (reactivation):
  - reactivate with sufficient ETH -> expect success
  - Verify cluster.active == true
  - Verify operator.ethValidatorCount re-incremented
  - ✓ INV

Fuzzing: Operator fees, validator counts, deposit/withdraw amounts, blocks between ops
```

### CAT-2-2: Liquidation and withdrawal from liquidated cluster

```
Setup:
  Operators: O7 × 4
  Cluster: ETH cluster, 3 validators

Phase 1 (setup + liquidate):
  - Create cluster, register 3 validators
  - ⏩ until liquidatable
  - liquidate -> expect success
  - ✓ INV

Phase 2 (deposit to liquidated cluster):
  - deposit ETH to liquidated cluster -> expect success
  - Verify balance increased, cluster still inactive
  - ✓ INV

Phase 3 (withdraw from liquidated cluster):
  - withdraw partial ETH -> expect success (no fee settlement, no liquidation check)
  - withdraw all remaining ETH -> expect success
  - Verify balance == 0
  - ✓ INV

Phase 4 (deposit again + reactivate):
  - deposit ETH -> expect success
  - reactivate with more ETH -> expect success
  - Verify total balance = deposit + reactivation msg.value
  - ✓ INV

Fuzzing: Deposit amounts, withdrawal amounts, timing
```

### CAT-2-3: Self-liquidation (owner liquidates own cluster)

```
Setup:
  Operators: O7 × 4
  Cluster: ETH cluster, well-funded, 2 validators

Phase 1 (self-liquidate while solvent):
  - Owner calls liquidate on own cluster -> expect success (self-liquidation always allowed)
  - Verify bounty sent to owner (full remaining balance)
  - Verify cluster.active == false
  - ✓ INV

Phase 2 (reactivate):
  - reactivate with ETH -> expect success
  - ✓ INV

Fuzzing: Cluster balance at self-liquidation time
```

### CAT-2-4: Third-party liquidation — must be liquidatable

```
Setup:
  Operators: O7 × 4
  Cluster: ETH cluster, 3 validators

Phase 1 (not liquidatable):
  - Third party calls liquidate -> expect revert (ClusterNotLiquidatable)
  - ✓ INV

Phase 2 (make liquidatable):
  - ⏩ enough blocks to deplete balance below threshold
  - Third party calls liquidate -> expect success
  - ✓ INV

Fuzzing: Block advancement amount (just below/at/just above threshold)
```

### CAT-2-5: Reactivation with removed operators

```
Setup:
  Operators: O7 × 4

Phase 1 (create, operate, liquidate):
  - Create ETH cluster, register validators
  - ⏩ until liquidatable, liquidate

Phase 2 (remove operator while liquidated):
  - removeOperator on operator #2
  - ✓ INV

Phase 3 (reactivate with reduced operator set):
  - reactivate with ETH -> expect success
  - Verify removed operator skipped in updateClusterOperatorsOnReactivation
  - Verify only 3 operators' ethValidatorCount incremented
  - Verify burn rate uses 3 operators' fees (not 4)
  - ✓ INV

Phase 4 (operate with 3/4 operators):
  - ⏩ 100 blocks
  - registerValidator -> expect success
  - Verify fee accrual from 3 operators only
  - ✓ INV

Fuzzing: Which operators removed (1, 2, or 3 of 4), ETH deposit amount
```

### CAT-2-6: Register validator with insufficient ETH — liquidation check

```
Setup:
  Operators: O7 × 4 (high ETH fees)

Phase 1:
  - registerValidator with 0 ETH -> expect revert (InsufficientBalance)
  - registerValidator with barely-below-threshold ETH -> expect revert
  - registerValidator with exactly-at-threshold ETH -> expect success
  - ✓ INV

Fuzzing: ETH amounts around the liquidation threshold boundary
```

### CAT-2-7: Withdraw ETH — post-withdrawal liquidation check

```
Setup:
  Operators: O7 × 4
  Cluster: ETH cluster, 3 validators, well-funded

Phase 1:
  - ⏩ 50 blocks (fees accrue)
  - Calculate exact amount that would make cluster liquidatable
  - withdraw(amount - 1) -> expect success (still above threshold)
  - withdraw(1) -> expect revert (InsufficientBalance — would become liquidatable)
  - ✓ INV

Phase 2 (withdraw after removing all validators):
  - bulkRemoveValidator (all 3)
  - Verify validatorCount == 0
  - withdraw entire balance -> expect success (no liquidation check when 0 validators)
  - ✓ INV

Fuzzing: Withdrawal amounts near the boundary
```

### CAT-2-8: Multiple clusters sharing operators

```
Setup:
  Operators: O7 × 7 (operators 1-4 shared, 5-7 unique to cluster B)

Phase 1 (create two clusters sharing operators 1-4):
  - Cluster A: operators [1,2,3,4], 3 validators
  - Cluster B: operators [1,2,3,5], 2 validators
  - Verify op1.ethValidatorCount == 5, op2 == 5, op3 == 5, op4 == 3, op5 == 2
  - ✓ INV

Phase 2 (liquidate cluster A):
  - ⏩ until A is liquidatable
  - liquidate A -> expect success
  - Verify op1.ethValidatorCount == 2, op4 == 0
  - Verify cluster B unaffected
  - ✓ INV

Phase 3 (operate cluster B normally):
  - registerValidator on B -> expect success
  - ✓ INV

Fuzzing: Validator counts per cluster, which operators are shared
```

### CAT-2-9: Cluster with zero-fee operators (ETH)

```
Setup:
  Operators: O7 × 4 (all registered with fee = 0)
  Cluster: ETH, 3 validators

Phase 1:
  - registerValidator with ETH deposit -> expect success
  - ⏩ 500 blocks
  - Verify cluster balance only decreased by network fee (no operator fees)
  - Verify all operator ETH earnings == 0
  - ✓ INV

Phase 2 (liquidation threshold):
  - Verify liquidation threshold based on networkFee only
  - ⏩ until liquidatable
  - liquidate -> expect success
  - ✓ INV

Fuzzing: Block advancement, deposit amount
```

---

## CAT-3: Effective Balance (Oracle + EB Updates)

### CAT-3-1: Implicit EB → explicit EB via oracle update

```
Setup:
  Operators: O7 × 4
  Cluster: ETH, 3 validators, implicit EB (E1)

Phase 1 (verify implicit EB):
  - ⏩ 100 blocks
  - Verify fee accrual uses validatorCount × BPS_DENOMINATOR as vUnits
  - ✓ INV

Phase 2 (oracle commits root):
  - 3 of 4 oracles call commitRoot(merkleRoot, blockNum) -> quorum reached
  - Verify RootCommitted event
  - ✓ INV

Phase 3 (updateClusterBalance with EB = 32 × 3 = 96 ETH):
  - updateClusterBalance(proof, 96 ETH) -> expect success (E2: no deviation, same as implicit)
  - Verify clusterEB.vUnits == 30000 (3 × 10000)
  - Verify no change in operatorEthVUnits (deviation == 0)
  - ✓ INV

Phase 4 (update again with higher EB = 128 ETH for 3 validators):
  - New oracle root commit
  - updateClusterBalance(proof, 128 ETH) -> expect success (E3: positive deviation)
  - Verify clusterEB.vUnits == 40000 (ceil(128 × 10000 / 32))
  - Verify operatorEthVUnits increased by 10000 for each operator
  - Verify daoTotalEthVUnits increased by 10000
  - Verify future fee accrual uses new vUnits
  - ✓ INV (especially INV-4)

Fuzzing: EB values (96-6144 for 3 validators), timing between updates
```

### CAT-3-2: EB increase triggers auto-liquidation

```
Setup:
  Operators: O7 × 4 (moderate ETH fees)
  Cluster: ETH, 2 validators, funded just above threshold for implicit EB

Phase 1 (oracle update doubles EB):
  - Commit root with EB = 128 ETH (2 validators × 64 ETH each)
  - updateClusterBalance -> expect success
  - Verify auto-liquidation triggered (cluster was funded for 32 ETH/val, now 64 ETH/val)
  - Verify ClusterBalanceUpdated event followed by ClusterLiquidated event
  - Verify bounty sent to caller (the updateClusterBalance caller gets the liquidation bounty)
  - ✓ INV

Fuzzing: EB multiplier (1.5x to 64x), initial cluster funding level
```

### CAT-3-3: EB decrease — cluster becomes over-collateralized

```
Setup:
  Operators: O7 × 4
  Cluster: ETH, 4 validators, explicit EB = 256 ETH (64 ETH/validator, E3)

Phase 1 (EB decreases to 128 ETH):
  - Oracle commits new root
  - updateClusterBalance(proof, 128 ETH) -> expect success
  - Verify vUnits decreased
  - Verify operatorEthVUnits decreased for each operator
  - Verify cluster now has more runway (lower burn rate)
  - ✓ INV

Fuzzing: EB decrease magnitude
```

### CAT-3-4: Max EB (2048 ETH/validator)

```
Setup:
  Operators: O7 × 4
  Cluster: ETH, 1 validator, heavily funded

Phase 1 (set EB to max):
  - Oracle commit + updateClusterBalance(proof, 2048 ETH) -> expect success (E4)
  - Verify vUnits == 640000 (ceil(2048 × 10000 / 32))
  - Verify massive deviation in operatorEthVUnits
  - ✓ INV

Phase 2 (verify high burn rate):
  - ⏩ 50 blocks
  - Verify cluster balance decreased significantly
  - ✓ INV

Fuzzing: Validator count at max EB
```

### CAT-3-5: EB update on SSV cluster (pre-migration) — stores snapshot only

```
Setup:
  Operators: O1 × 4
  Cluster: SSV (not migrated), 3 validators

Phase 1 (upgrade + oracle update):
  - Upgrade to v2.0.0
  - Oracle commits root including this SSV cluster
  - updateClusterBalance(proof, 128 ETH) -> expect success
  - Verify clusterEB.vUnits stored
  - Verify NO fee/accounting updates (SSV cluster uses validatorCount)
  - Verify NO operatorEthVUnits changes
  - ✓ INV

Phase 2 (migrate with explicit EB):
  - migrateClusterToETH -> expect success
  - Verify migration uses the stored EB snapshot for vUnits
  - Verify deviation vUnits added to operators and DAO on migration
  - ✓ INV

Fuzzing: EB value, timing between oracle update and migration
```

### CAT-3-6: EB boundary validation

```
Setup:
  Operators: O7 × 4
  Cluster: ETH, 3 validators

Phase 1 (below minimum):
  - Oracle commit root
  - updateClusterBalance(proof, 95 ETH) -> expect revert (95 < 3 × 32 = 96 minimum)

Phase 2 (above maximum):
  - updateClusterBalance(proof, 6145 ETH) -> expect revert (6145 > 3 × 2048 = 6144 maximum)

Phase 3 (exact boundaries):
  - updateClusterBalance(proof, 96 ETH) -> expect success (exact minimum)
  - New root: updateClusterBalance(proof, 6144 ETH) -> expect success (exact maximum)
  - ✓ INV

Fuzzing: EB values around boundaries
```

### CAT-3-7: Stale root rejection (must use latest root)

```
Setup:
  Operators: O7 × 4
  Cluster: ETH, 2 validators

Phase 1 (commit two roots):
  - Oracle commits root A at blockNum = 100
  - Oracle commits root B at blockNum = 200
  - Verify latestCommittedBlock == 200

Phase 2 (try stale root):
  - updateClusterBalance using root A (blockNum = 100) -> expect revert (MustUseLatestRoot)
  - updateClusterBalance using root B (blockNum = 200) -> expect success
  - ✓ INV

Fuzzing: Gap between root commits
```

### CAT-3-8: Oracle quorum — partial votes, failed quorum, re-voting

```
Setup:
  Oracles: 4 registered
  Cluster: ETH, 2 validators

Phase 1 (partial vote — no commit):
  - Oracle 1 calls commitRoot(rootA, blockNum=100) -> WeightedRootProposed
  - Oracle 2 calls commitRoot(rootA, blockNum=100) -> WeightedRootProposed
  - Verify no RootCommitted (2/4 = 50% < 75% quorum)

Phase 2 (quorum reached):
  - Oracle 3 calls commitRoot(rootA, blockNum=100) -> RootCommitted (3/4 = 75%)
  - Verify ebRoots[100] == rootA
  - ✓ INV

Phase 3 (re-vote prevention):
  - Oracle 1 calls commitRoot(rootA, blockNum=100) again -> expect revert (AlreadyVoted)

Phase 4 (competing roots):
  - Oracle 1 calls commitRoot(rootB, blockNum=200) -> WeightedRootProposed
  - Oracle 2 calls commitRoot(rootC, blockNum=200) -> WeightedRootProposed (different root, same block)
  - Verify rootB and rootC tracked separately
  - Oracle 3 + 4 vote for rootB -> RootCommitted for rootB
  - ✓ INV

Fuzzing: Which oracles vote, vote ordering, competing root values
```

### CAT-3-9: EB update on liquidated cluster — snapshot stored, no accounting

```
Setup:
  Operators: O7 × 4
  Cluster: ETH, liquidated, had explicit EB (E5)

Phase 1:
  - Oracle commits root that includes the liquidated cluster (unusual but contract supports it)
  - updateClusterBalance -> expect success
  - Verify clusterEB.vUnits updated
  - Verify NO fee settlement (cluster inactive)
  - Verify NO operatorEthVUnits changes (skipped for inactive)
  - Verify NO auto-liquidation check
  - ✓ INV

Fuzzing: EB value
```

### CAT-3-10: Multiple clusters with different EBs sharing operators

```
Setup:
  Operators: O7 × 5
  Cluster A: operators [1,2,3,4], 3 validators, implicit EB
  Cluster B: operators [1,2,3,5], 2 validators, implicit EB

Phase 1 (update cluster A to high EB):
  - updateClusterBalance for A with EB = 192 ETH (64/val) -> vUnits = 60000
  - Verify operatorEthVUnits[1,2,3] += 30000 (deviation), op4 += 30000
  - Verify op5 unchanged
  - ✓ INV (especially INV-4)

Phase 2 (update cluster B to low EB):
  - updateClusterBalance for B with EB = 64 ETH (32/val) -> vUnits = 20000 (no deviation)
  - Verify operatorEthVUnits unchanged (no new deviation)
  - ✓ INV

Phase 3 (liquidate cluster A):
  - ⏩ until A liquidatable, liquidate
  - Verify operatorEthVUnits[1,2,3] -= 30000, op4 -= 30000
  - Verify cluster B unaffected
  - ✓ INV

Fuzzing: EB values per cluster, operator overlap patterns
```

---

## CAT-4: Operator Lifecycle

### CAT-4-1: Legacy operator fee transition through ensureETHDefaults

```
Setup:
  Operators: O1 × 2 + O2 × 2 (2 with SSV fee > 0, 2 with SSV fee = 0)

Phase 1 (pre-upgrade):
  - Register operators, register validators
  - ⏩ 100 blocks

Phase 2 (upgrade + trigger ensureETHDefaults):
  - Upgrade
  - migrateClusterToETH (triggers ensureETHDefaults for all 4)
  - Verify O1: ethFee = DEFAULT_OPERATOR_ETH_FEE
  - Verify O2: ethFee = 0 (SSV fee was 0 -> ETH fee = 0)
  - Verify OperatorFeeExecuted emitted only for O1 operators
  - ✓ INV

Fuzzing: SSV fee values for O1 operators
```

### CAT-4-2: Operator fee declare → execute → cluster impact

```
Setup:
  Operators: O7 × 4
  Cluster: ETH, 3 validators

Phase 1 (declare):
  - declareOperatorFee(op1, newFee) -> expect success
  - Verify OperatorFeeDeclared event
  - ⏩ blocks (fee not yet effective)
  - Verify cluster still using old fee

Phase 2 (execute too early):
  - executeOperatorFee(op1) -> expect revert (not in approval window)

Phase 3 (execute in window):
  - ⏩ declareOperatorFeePeriod
  - executeOperatorFee(op1) -> expect success
  - Verify operator snapshot settled at old fee, then new fee stored
  - ✓ INV

Phase 4 (verify new fee applies):
  - ⏩ 100 blocks
  - Verify cluster fee accrual reflects new operator fee
  - ✓ INV

Fuzzing: New fee value, timing of execution within window
```

### CAT-4-3: Operator fee reduce — immediate, no timelock

```
Setup:
  Operators: O7 × 4
  Cluster: ETH, 3 validators

Phase 1:
  - reduceOperatorFee(op1, lowerFee) -> expect success (immediate)
  - Verify snapshot settled at old fee
  - Verify new fee effective immediately
  - ⏩ 100 blocks
  - Verify cluster burn rate uses lower fee for op1
  - ✓ INV

Phase 2 (reduce to zero):
  - reduceOperatorFee(op1, 0) -> expect success
  - ⏩ 100 blocks
  - Verify op1 earnings == 0
  - ✓ INV

Fuzzing: Reduction amount
```

### CAT-4-4: Operator removal — earnings withdrawal + cluster impact

```
Setup:
  Operators: O7 × 4
  Cluster: ETH, 3 validators, explicit EB (E3)

Phase 1 (accrue earnings):
  - ⏩ 200 blocks
  - ✓ INV

Phase 2 (remove operator):
  - removeOperator(op2) -> expect success
  - Verify final SSV and ETH snapshots settled
  - Verify all earnings auto-withdrawn to operator owner
  - Verify operator fields zeroed (except owner)
  - ✓ INV

Phase 3 (cluster continues with 3/4 operators):
  - ⏩ 100 blocks
  - Verify fee accrual from 3 operators only
  - Verify removed op has 0 earnings
  - ✓ INV

Phase 4 (cluster operations with removed operator):
  - registerValidator -> expect success (3/4 operators active)
  - ✓ INV

Fuzzing: Which operator is removed, blocks of accrual before removal
```

### CAT-4-5: Operator removal while multiple clusters use it

```
Setup:
  Operators: O7 × 5
  Cluster A: operators [1,2,3,4], 3 validators
  Cluster B: operators [1,2,3,5], 2 validators

Phase 1 (remove shared operator):
  - removeOperator(op1) -> expect success
  - Verify op1.ethValidatorCount zeroed (was 5)
  - ✓ INV

Phase 2 (both clusters affected):
  - Both clusters now have 3/4 active operators
  - ⏩ 100 blocks
  - Verify fee accrual excludes op1 for both clusters
  - Verify each cluster can still register/remove validators
  - ✓ INV

Fuzzing: Which shared operator is removed
```

### CAT-4-6: Operator ETH + SSV earnings withdrawal

```
Setup:
  Operators: O8 × 4 (legacy, ETH-initialized via previous migration)
  Cluster SSV: was active pre-upgrade (accrued SSV earnings)
  Cluster ETH: migrated (accruing ETH earnings)

Phase 1 (withdraw ETH earnings):
  - ⏩ 100 blocks
  - withdrawOperatorEarnings(op1, amount) -> expect success
  - Verify ETH transferred
  - ✓ INV

Phase 2 (withdraw SSV earnings):
  - withdrawOperatorEarningsSSV(op1, amount) -> expect success
  - Verify SSV token transferred
  - ✓ INV

Phase 3 (withdraw all of both):
  - withdrawAllVersionOperatorEarnings(op1) -> expect success
  - Verify both ETH and SSV earnings withdrawn
  - ✓ INV

Phase 4 (ETH-only operator tries SSV withdrawal):
  - Register new operator O7 (ETH-only)
  - withdrawOperatorEarningsSSV(newOp) -> expect revert (InsufficientBalance)
  - ✓ INV

Fuzzing: Earnings amounts, withdrawal timing
```

### CAT-4-7: Operator fee declare overwrite (multiple declarations)

```
Setup:
  Operators: O7 × 4

Phase 1:
  - declareOperatorFee(op1, fee_A) -> expect success
  - ⏩ some blocks (but still in declare period)
  - declareOperatorFee(op1, fee_B) -> expect success (overwrites fee_A)
  - ⏩ declareOperatorFeePeriod (from second declaration)
  - executeOperatorFee(op1) -> expect success
  - Verify op1.ethFee == fee_B (not fee_A)
  - ✓ INV

Fuzzing: fee_A and fee_B values, timing between declarations
```

### CAT-4-8: Operator fee increase limit enforcement

```
Setup:
  Operators: O7 × 1 (registered with fee = 1,000,000,000)

Phase 1 (within increase limit):
  - Calculate maxAllowed = currentFee + (currentFee * operatorMaxFeeIncrease / 10000)
  - declareOperatorFee(op1, maxAllowed) -> expect success
  - ✓ INV

Phase 2 (exceeds increase limit):
  - declareOperatorFee(op1, maxAllowed + 1) -> expect revert
  - ✓ INV

Fuzzing: Current fee, increase percentage
```

---

## CAT-5: Concurrent Mixed Operations

### CAT-5-1: Multiple owners, multiple clusters, interleaved operations

```
Setup:
  Operators: O7 × 8
  Owner A: Cluster A1 (ops [1,2,3,4], 3 val), Cluster A2 (ops [5,6,7,8], 2 val)
  Owner B: Cluster B1 (ops [1,2,3,5], 4 val)

Phase 1 (concurrent operations):
  - ⏩ 50 blocks
  - Owner A: deposit ETH to A1
  - Owner B: registerValidator on B1
  - ⏩ 30 blocks
  - Owner A: removeValidator from A2
  - Third party: liquidate B1 (if liquidatable)
  - Owner A: withdraw from A1
  - ⏩ 50 blocks
  - ✓ INV after each operation

Phase 2 (operator shared between clusters):
  - Verify op1 earnings reflect validators from both A1 and B1
  - Verify op5 earnings reflect validators from both A2 and B1
  - withdrawAllOperatorEarnings for shared ops
  - ✓ INV

Fuzzing: Operation order, amounts, block gaps, which clusters are affected
```

### CAT-5-2: Migration race — two SSV clusters migrating in same block

```
Setup:
  Operators: O1 × 8 (4 shared between clusters)
  Cluster X: operators [1,2,3,4], SSV
  Cluster Y: operators [1,2,3,5], SSV

Phase 1 (both migrate):
  - Upgrade
  - migrateClusterToETH for X -> expect success
  - migrateClusterToETH for Y in same block -> expect success
  - Verify ensureETHDefaults called only once per operator (ops [1,2,3] shared)
  - Verify correct SSV refunds for both
  - ✓ INV (especially INV-6 dual tracking)

Fuzzing: Migration order, ETH amounts
```

### CAT-5-3: Operator removal during active cluster operations

```
Setup:
  Operators: O7 × 4
  Cluster: ETH, 5 validators

Phase 1 (interleave removal with cluster ops):
  - ⏩ 50 blocks
  - Owner A: starts withdraw from cluster (tx1)
  - Operator owner: removeOperator(op2) (tx2)
  - Owner A: registerValidator (tx3)
  - Verify all succeed and accounting is consistent
  - ✓ INV after each

Fuzzing: Operation ordering permutations
```

### CAT-5-4: EB update + liquidation + reactivation in rapid succession

```
Setup:
  Operators: O7 × 4
  Cluster: ETH, 2 validators, funded near threshold, implicit EB

Phase 1 (EB update triggers auto-liquidation):
  - Oracle commits root with high EB (128 ETH for 2 validators)
  - updateClusterBalance -> auto-liquidation triggered
  - Verify cluster liquidated
  - ✓ INV

Phase 2 (immediate reactivation with high funding):
  - reactivate with large ETH deposit -> expect success
  - Verify reactivation uses stale EB snapshot (E5) from the update
  - ✓ INV

Phase 3 (new EB update post-reactivation):
  - New oracle root
  - updateClusterBalance -> expect success
  - Verify cluster survives (well-funded now)
  - ✓ INV

Fuzzing: EB values, funding amounts, block gaps
```

### CAT-5-5: Concurrent SSV legacy operations + ETH cluster operations

```
Setup:
  Operators: O1 × 4 (shared between SSV and ETH clusters)
  Cluster SSV: pre-upgrade, not yet migrated
  Cluster ETH: post-upgrade, fresh

Phase 1 (operate both):
  - Upgrade
  - Register new ETH cluster on same operators
  - ⏩ 100 blocks
  - removeValidator from SSV cluster -> expect success
  - registerValidator on ETH cluster -> expect success
  - Verify operator dual tracking: validatorCount (SSV) + ethValidatorCount (ETH)
  - ✓ INV (especially INV-6)

Phase 2 (migrate SSV while ETH cluster active):
  - migrateClusterToETH for SSV cluster -> expect success
  - Verify operator.validatorCount decremented (SSV)
  - Verify operator.ethValidatorCount incremented (ETH migration) — adds to existing ETH count
  - ✓ INV

Fuzzing: Validator counts, operation interleaving
```

### CAT-5-6: Multiple liquidations in same block

```
Setup:
  Operators: O7 × 8
  Cluster A: operators [1,2,3,4], near liquidation
  Cluster B: operators [5,6,7,8], near liquidation

Phase 1:
  - ⏩ until both liquidatable
  - liquidate A -> expect success
  - liquidate B in same block -> expect success
  - Verify ETH conservation: total bounties == sum of cluster balances
  - ✓ INV

Fuzzing: Relative funding levels, shared vs unique operators
```

---

## CAT-PM: Post-Migration Cross-Product (Migrated Archetype × Operation)

These scenarios take clusters that were **migrated from SSV** (with their original operator archetypes intact) and run them through full post-migration operations: liquidation, EB updates, reactivation, and continued cluster management. This fills the gap where CAT-1 only tested migration itself and CAT-2/3 only tested fresh O7 clusters.

### CAT-PM-1: Migrated mixed-fee cluster — liquidation

```
Setup:
  Operators: O2 × 1 + O1 × 2 + O3 × 1 (zero + normal + normal + max SSV fee)
  Cluster: C9 (mixed-fee), 3 validators

Phase 1 (pre-upgrade + migrate):
  - Register operators with varying SSV fees, register validators
  - ⏩ 100 blocks
  - Upgrade to v2.0.0
  - migrateClusterToETH with moderate ETH -> expect success
  - Verify: O2 ethFee=0, O1s ethFee=DEFAULT, O3 ethFee=DEFAULT
  - ✓ INV

Phase 2 (accrue fees, then liquidate):
  - ⏩ enough blocks to deplete balance below threshold
  - Third party calls liquidate -> expect success
  - Verify fee settlement: O2 earned 0 ETH, O1s and O3 earned proportionally
  - Verify operator.ethValidatorCount decremented for all 4 (including zero-fee op)
  - Verify vUnit cleanup for all 4 operators (even zero-fee)
  - Verify bounty = remaining cluster balance
  - ✓ INV (especially INV-3, INV-4, INV-6)

Phase 3 (reactivate):
  - reactivate with sufficient ETH -> expect success
  - Verify all 4 operators' ethValidatorCount re-incremented
  - Verify burn rate calculation includes O2 at 0 + O1s at DEFAULT + O3 at DEFAULT
  - ✓ INV

Fuzzing: SSV fee values for O1 ops, ETH deposit amount, blocks to liquidation
```

### CAT-PM-2: Migrated cluster with removed operator — liquidation + reactivation

```
Setup:
  Operators: O1 × 3 + O4 × 1 (3 normal + 1 removed pre-migration)
  Cluster: C5, 4 validators

Phase 1 (pre-upgrade + migrate):
  - Register 4 operators, register 4 validators
  - removeOperator(op4)
  - ⏩ 50 blocks
  - Upgrade
  - migrateClusterToETH -> expect success (removed op skipped)
  - ✓ INV

Phase 2 (liquidate — removed operator in the set):
  - ⏩ until liquidatable
  - liquidate -> expect success
  - Verify removed op4: ethValidatorCount stays 0, no snapshot update, no vUnit cleanup
  - Verify active ops 1-3: ethValidatorCount decremented, vUnits cleaned
  - Verify bounty correct (burn rate was from 3 ops only)
  - ✓ INV

Phase 3 (reactivate with removed operator still in set):
  - reactivate with ETH -> expect success
  - Verify op4 skipped again in updateClusterOperatorsOnReactivation
  - Verify only ops 1-3 ethValidatorCount incremented
  - Verify solvency check uses 3 operators' fees (not 4)
  - ✓ INV

Phase 4 (register new validator post-reactivation):
  - registerValidator -> expect success
  - Verify op4 still skipped in fee accrual
  - ⏩ 100 blocks
  - Verify earnings only from 3 active operators
  - ✓ INV

Fuzzing: Which operator is removed (position 1-4), ETH deposit amounts
```

### CAT-PM-3: Migrated cluster with ALL operators removed — liquidation edge case

```
Setup:
  Operators: O4 × 4 (all removed pre-migration)
  Cluster: C6, 2 validators

Phase 1 (pre-upgrade + migrate):
  - Register 4 operators, register 2 validators
  - Remove all 4 operators
  - Upgrade
  - migrateClusterToETH with minimumLiquidationCollateral -> expect success
  - ✓ INV

Phase 2 (liquidation with only network fee burn):
  - ⏩ enough blocks (only network fee drains balance)
  - liquidate -> expect success
  - Verify no operator vUnit or earnings changes (all removed)
  - Verify bounty = remaining balance (drained by network fee only)
  - ✓ INV

Phase 3 (reactivate — all operators still removed):
  - reactivate with ETH -> expect success
  - Verify all 4 operators skipped
  - Verify solvency check uses 0 operator fees + network fee
  - ✓ INV

Fuzzing: ETH amounts, block advancement
```

### CAT-PM-4: Migrated zero-fee cluster — EB update + auto-liquidation

```
Setup:
  Operators: O2 × 4 (SSV fee = 0 → ETH fee = 0 after migration)
  Cluster: C7, 3 validators

Phase 1 (pre-upgrade + migrate):
  - Upgrade
  - migrateClusterToETH with moderate ETH -> expect success
  - Verify all operators ethFee = 0
  - ✓ INV

Phase 2 (EB update — only network fee applies):
  - Oracle commit + updateClusterBalance(proof, 192 ETH) -> expect success (E3: 64 ETH/val)
  - Verify vUnits increased
  - Verify operatorEthVUnits deviation added (even though operator fees are 0)
  - Verify burn rate increase is from network fee × higher vUnits only
  - ✓ INV (especially INV-4)

Phase 3 (EB increase triggers auto-liquidation via network fee):
  - ⏩ blocks to drain balance
  - Oracle commit with even higher EB (or just wait)
  - updateClusterBalance -> auto-liquidation if undercollateralized
  - Verify liquidation cleanup: vUnit deviations removed from all 4 ops and DAO
  - Verify operator ETH earnings == 0 (fees were 0 the whole time)
  - ✓ INV

Fuzzing: EB values, block advancement, ETH deposit amount
```

### CAT-PM-5: Migrated max-fee cluster — EB update + reactivation cycle

```
Setup:
  Operators: O3 × 4 (SSV max fee → ethFee = DEFAULT after migration)
  Cluster: C8, 2 validators

Phase 1 (pre-upgrade + migrate):
  - Upgrade
  - migrateClusterToETH with large ETH deposit
  - ✓ INV

Phase 2 (increase fees to actual max via declare/execute):
  - For each operator: declareOperatorFee(op, operatorMaxFee)
  - ⏩ declareOperatorFeePeriod
  - For each operator: executeOperatorFee(op)
  - Verify all operators now at operatorMaxFee
  - ✓ INV

Phase 3 (EB update at max fees — rapid drain):
  - Oracle commit + updateClusterBalance(proof, 128 ETH) -> explicit EB (E3)
  - ⏩ small number of blocks (high burn rate: 4 × maxFee × vUnits)
  - Verify cluster balance draining rapidly
  - ✓ INV

Phase 4 (liquidation at max fees):
  - ⏩ until liquidatable
  - liquidate -> expect success
  - Verify large bounty (high fees accrued, but cluster had large balance)
  - Verify operator earnings reflect max fee × vUnits × blocks
  - ✓ INV

Phase 5 (reactivate at max fees — large ETH required):
  - reactivate with ETH -> expect success
  - Verify minimum ETH threshold is high (4 × maxFee burn rate)
  - ✓ INV

Fuzzing: Operator max fee values, EB values, deposit amounts
```

### CAT-PM-6: Migrated large cluster (13 ops, mixed) — liquidation + EB update

```
Setup:
  Operators: O1 × 8 + O2 × 3 + O4 × 2 (8 normal + 3 zero-fee + 2 removed)
  Cluster: C10, 10 validators

Phase 1 (pre-upgrade + migrate):
  - Register 13 operators, 10 validators
  - Remove operators 12 and 13
  - Upgrade
  - migrateClusterToETH -> expect success
  - Verify 11 operators processed (2 removed skipped)
  - Verify 8 got DEFAULT ethFee, 3 got 0 ethFee
  - ✓ INV

Phase 2 (EB update on large cluster):
  - Oracle commit + updateClusterBalance(proof, 640 ETH) -> 64 ETH/val
  - Verify vUnit deviation applied to all 11 active operators
  - Verify removed ops 12, 13 unchanged
  - Verify daoTotalEthVUnits updated correctly
  - ✓ INV (especially INV-4)

Phase 3 (liquidation of large cluster):
  - ⏩ until liquidatable
  - liquidate -> expect success
  - Verify 11 operators' ethValidatorCount decremented by 10 each
  - Verify vUnit deviation cleaned from 11 operators + DAO
  - Verify removed ops untouched
  - ✓ INV

Phase 4 (reactivation):
  - reactivate with large ETH
  - Verify 11 operators re-incremented (2 removed skipped)
  - Verify solvency check uses 8 operators' fees + network fee (3 zero-fee contribute 0)
  - ✓ INV

Fuzzing: Operator count (4-13), removed count, fee distribution, EB values
```

### CAT-PM-7: Migrated liquidated cluster (C3) — EB update with stale snapshot

```
Setup:
  Operators: O1 × 4
  Cluster: C3 (liquidated pre-upgrade), 3 validators

Phase 1 (pre-upgrade + migrate liquidated):
  - Liquidate cluster pre-upgrade
  - Upgrade
  - migrateClusterToETH (reactivates) with just-enough ETH
  - ✓ INV

Phase 2 (EB update increases EB):
  - Oracle commit + updateClusterBalance(proof, 192 ETH) -> 64 ETH/val
  - Verify increased burn rate may make cluster immediately undercollateralized
  - If auto-liquidated: verify cleanup correct
  - ✓ INV

Phase 3 (reactivate with EB-aware funding):
  - reactivate with ETH sufficient for the higher EB burn rate
  - Verify solvency check uses stored EB (now explicit, not stale)
  - ⏩ 100 blocks
  - Verify cluster survives (funded for actual EB)
  - ✓ INV

Fuzzing: EB value, funding amount at migration, funding at reactivation
```

### CAT-PM-8: Migrated near-liquidation cluster (C2) — immediate post-migration EB update

```
Setup:
  Operators: O1 × 4
  Cluster: C2 (near-liquidation, barely funded), 2 validators

Phase 1 (pre-upgrade + migrate at minimum):
  - ⏩ until near-liquidation SSV threshold
  - Upgrade
  - migrateClusterToETH with exact minimum ETH
  - ✓ INV

Phase 2 (EB update on tight-funded cluster):
  - Oracle commit + updateClusterBalance(proof, 64 ETH) -> no deviation (32/val)
  - Verify cluster survives (no EB change, just explicit confirmation of 32 ETH/val)
  - ✓ INV

Phase 3 (EB increase on tight-funded cluster — auto-liquidation):
  - Oracle commit + updateClusterBalance(proof, 128 ETH) -> doubled EB
  - Verify auto-liquidation (cluster was funded for 32 ETH/val EB, now 64)
  - ✓ INV

Phase 4 (reactivate with proper funding for higher EB):
  - reactivate with ETH sized for 64 ETH/val burn rate
  - ✓ INV

Fuzzing: Initial ETH deposit (around minimum), EB increase magnitude
```

### CAT-PM-9: Migrated private-operator cluster — liquidation + third-party interactions

```
Setup:
  Operators: O5 × 4 (all private/whitelisted)
  Cluster: C1 variant with private ops, 3 validators

Phase 1 (pre-upgrade + migrate):
  - Whitelist cluster owner, register validators
  - Upgrade
  - migrateClusterToETH -> expect success
  - ✓ INV

Phase 2 (third-party liquidation of private-op cluster):
  - ⏩ until liquidatable
  - Non-whitelisted third party calls liquidate -> expect success (liquidation is permissionless)
  - Verify bounty sent to third party
  - ✓ INV

Phase 3 (reactivation by owner):
  - Owner calls reactivate -> expect success
  - ✓ INV

Phase 4 (non-whitelisted party tries cluster operations):
  - Non-whitelisted party tries registerValidator -> expect revert (not whitelisted)
  - Non-whitelisted party tries deposit -> expect success (deposit is permissionless)
  - ✓ INV

Fuzzing: Whitelist configuration, which operations non-whitelisted users attempt
```

### CAT-PM-10: Migrated cluster with pending fee declaration — post-migration fee execute + liquidation

```
Setup:
  Operators: O6 × 2 + O1 × 2 (2 with pre-upgrade pending fee + 2 normal)
  Cluster: C1, 3 validators

Phase 1 (pre-upgrade + migrate):
  - Declare fees pre-upgrade for ops 1, 2
  - Upgrade
  - migrateClusterToETH -> expect success
  - Verify pre-upgrade declarations dead (UPGRADE_TIMESTAMP block)
  - ✓ INV

Phase 2 (new fee declarations post-migration):
  - declareOperatorFee(op1, highFee), declareOperatorFee(op2, highFee)
  - ⏩ declareOperatorFeePeriod
  - executeOperatorFee(op1), executeOperatorFee(op2) -> expect success
  - ✓ INV

Phase 3 (higher fees cause faster drain — liquidation):
  - ⏩ until liquidatable (faster now with higher fees)
  - liquidate -> expect success
  - Verify earnings settled at the new (higher) fee rates
  - ✓ INV

Phase 4 (reactivate — minimum ETH reflects new higher fees):
  - reactivate with ETH -> expect success
  - Verify minimum ETH threshold higher than it would have been at DEFAULT fee
  - ✓ INV

Fuzzing: Declared fee values, timing of execute, block advancement
```

### CAT-PM-11: Migrated mixed-fee cluster — EB update with operator removal mid-lifecycle

```
Setup:
  Operators: O2 × 1 + O1 × 2 + O3 × 1
  Cluster: C9, 3 validators

Phase 1 (pre-upgrade + migrate):
  - Upgrade
  - migrateClusterToETH -> expect success
  - ✓ INV

Phase 2 (EB update):
  - Oracle commit + updateClusterBalance(proof, 192 ETH) -> 64 ETH/val, E3
  - Verify deviation distributed to all 4 operators
  - ✓ INV

Phase 3 (remove one operator AFTER EB update):
  - removeOperator(op3, an O1-type) -> expect success
  - Verify op3 earnings settled including EB-weighted fees
  - Verify op3 fields zeroed
  - ✓ INV

Phase 4 (liquidation with removed op + explicit EB):
  - ⏩ until liquidatable
  - liquidate -> expect success
  - Verify removed op3 skipped in vUnit cleanup
  - Verify remaining 3 ops: vUnit deviation properly cleaned
  - Verify DAO vUnit tracking consistent
  - ✓ INV (especially INV-4)

Phase 5 (reactivation — 3 active operators, explicit EB):
  - reactivate with ETH -> expect success
  - Verify solvency check uses 3 ops' fees × stored EB vUnits
  - ✓ INV

Fuzzing: Which operator removed, EB value, timing
```

### CAT-PM-12: Migrated cluster — double liquidation-reactivation cycle

```
Setup:
  Operators: O1 × 4
  Cluster: C1, 4 validators

Phase 1 (pre-upgrade + migrate):
  - Upgrade
  - migrateClusterToETH -> expect success
  - ✓ INV

Phase 2 (first EB update):
  - Oracle commit + updateClusterBalance(proof, 256 ETH) -> 64 ETH/val, E3
  - ✓ INV

Phase 3 (first liquidation):
  - ⏩ until liquidatable
  - liquidate -> expect success
  - Verify vUnit deviation cleaned, operator counts decremented
  - ✓ INV

Phase 4 (first reactivation):
  - reactivate with ETH -> expect success
  - Verify vUnit deviation restored from stored EB snapshot (E5 → active again)
  - Verify operator counts re-incremented
  - ✓ INV

Phase 5 (second EB update — EB changes during active period):
  - Oracle commit + updateClusterBalance(proof, 128 ETH) -> 32 ETH/val (EB decreased)
  - Verify vUnit deviation decreased
  - ✓ INV

Phase 6 (second liquidation):
  - ⏩ until liquidatable
  - liquidate -> expect success
  - Verify cleanup uses UPDATED EB (not the old 256 ETH snapshot)
  - ✓ INV

Phase 7 (second reactivation):
  - reactivate -> expect success
  - Verify uses latest EB snapshot
  - ✓ INV

Fuzzing: EB values per cycle, funding amounts, blocks between cycles
```

---

## CAT-6: Governance Under Load

### CAT-6-1: Network fee change — impact on active clusters

```
Setup:
  Operators: O7 × 4
  Cluster: ETH, 3 validators, well-funded

Phase 1 (baseline):
  - ⏩ 100 blocks
  - Record cluster balance after settlement
  - ✓ INV

Phase 2 (increase network fee):
  - updateNetworkFee(newHigherFee) -> expect success (owner only)
  - Verify NetworkFeeUpdated event
  - ⏩ 100 blocks
  - Verify cluster balance decreased faster (higher network fee)
  - ✓ INV

Phase 3 (decrease network fee):
  - updateNetworkFee(newLowerFee)
  - ⏩ 100 blocks
  - Verify cluster balance decreased slower
  - ✓ INV

Fuzzing: Fee values, block gaps
```

### CAT-6-2: Liquidation threshold change — cluster state transitions

```
Setup:
  Operators: O7 × 4
  Cluster: ETH, 3 validators, balance just above current threshold

Phase 1 (increase threshold — cluster becomes liquidatable):
  - updateLiquidationThresholdPeriod(higherBlocks) -> expect success
  - Verify cluster is now liquidatable (threshold crossed retroactively)
  - Third party liquidates -> expect success
  - ✓ INV

Fuzzing: Threshold values, cluster balance relative to old/new thresholds
```

### CAT-6-3: Minimum liquidation collateral change

```
Setup:
  Operators: O7 × 4
  Cluster: ETH, 3 validators

Phase 1 (raise minimum collateral):
  - updateMinimumLiquidationCollateral(newHigherValue)
  - Verify cluster that was above old minimum but below new minimum is now liquidatable
  - ✓ INV

Fuzzing: Collateral values
```

### CAT-6-4: Operator max fee change — impact on pending declarations

```
Setup:
  Operators: O7 × 1

Phase 1 (declare within current max):
  - declareOperatorFee(op1, fee close to operatorMaxFee) -> expect success
  - ⏩ declareOperatorFeePeriod

Phase 2 (lower the max before execution):
  - updateMaximumOperatorFee(newLowerMax) where newLowerMax < declared fee
  - executeOperatorFee(op1) -> expect revert (fee now exceeds max)
  - ✓ INV

Fuzzing: Max fee values, declared fee values
```

### CAT-6-5: Oracle replacement under active voting

```
Setup:
  Oracles: 4 registered
  Active voting round in progress

Phase 1 (partial quorum):
  - Oracle 1 votes for rootA at blockNum 100
  - Oracle 2 votes for rootA at blockNum 100 (50% accumulated)

Phase 2 (replace oracle 3):
  - replaceOracle(3, newOracleAddress) -> expect success

Phase 3 (new oracle completes quorum):
  - New oracle 3 votes for rootA at blockNum 100 -> quorum reached
  - Verify RootCommitted
  - ✓ INV

Phase 4 (replaced oracle cannot vote):
  - Old oracle 3 tries commitRoot for new block -> expect revert
  - ✓ INV

Fuzzing: Which oracle is replaced, timing relative to voting
```

### CAT-6-6: Minimum operator ETH fee change — impact on existing operators

```
Setup:
  Operators: O7 × 4 (various fees)

Phase 1 (raise minimum):
  - updateMinimumOperatorEthFee(newHigherMin)
  - Existing operators with fee < newHigherMin: their fee is NOT retroactively changed
  - But they cannot reduce fee (already below new minimum, reduction would go further down)
  - New declarations must be >= newHigherMin
  - ✓ INV

Phase 2 (verify enforcement):
  - declareOperatorFee(op1, belowNewMin) -> expect revert
  - declareOperatorFee(op1, aboveNewMin) -> expect success
  - reduceOperatorFee(op1, belowNewMin) -> expect revert (unless 0)
  - reduceOperatorFee(op1, 0) -> expect success (0 is always allowed)
  - ✓ INV

Fuzzing: Minimum fee values, operator current fees
```

### CAT-6-7: Network fee change with SSV legacy clusters still running

```
Setup:
  SSV Cluster: active, not migrated
  ETH Cluster: active

Phase 1 (change both SSV and ETH network fees):
  - updateNetworkFee(newETHFee) -> affects ETH clusters
  - updateNetworkFeeSSV(newSSVFee) -> affects SSV clusters
  - ⏩ 100 blocks
  - Verify SSV cluster balance uses SSV network fee
  - Verify ETH cluster balance uses ETH network fee
  - Verify no cross-contamination
  - ✓ INV

Fuzzing: Fee values for both types
```

---

## Summary Matrix

| Category | Scenarios | Primary Archetypes Covered |
|---|---|---|
| CAT-1: Upgrade & Migration | 12 | C1-C10, O1-O6, O8 |
| CAT-2: Cluster Lifecycle | 9 | O7, E1 (implicit) |
| CAT-3: Effective Balance | 10 | E1-E5, O7 |
| CAT-PM: Post-Migration Cross-Product | 12 | C1-C10 × {liquidate, EB update, reactivate}, O1-O6 mixed |
| CAT-4: Operator Lifecycle | 8 | O7, O8, O1, O2 |
| CAT-5: Concurrent Ops | 6 | All operator types, mixed clusters |
| CAT-6: Governance | 7 | O7, mixed clusters |
| **Total** | **64** | |

### Cross-Reference: Archetype Coverage

| Archetype | Scenarios |
|---|---|
| O1 (Normal) | CAT-1-1,2,3,8,9, CAT-4-1, CAT-5-2,5, CAT-PM-2,7,8,11,12 |
| O2 (Zero-fee) | CAT-1-5,7,10, CAT-4-1, CAT-PM-1,4,6,11 |
| O3 (Max-fee) | CAT-1-3,6,7, CAT-PM-1,5,11 |
| O4 (Removed) | CAT-1-3,4,10, CAT-PM-2,3,6 |
| O5 (Private) | CAT-1-11, CAT-PM-9 |
| O6 (Fee-pending) | CAT-1-12, CAT-PM-10 |
| O7 (Post-upgrade new) | CAT-2-*, CAT-3-*, CAT-4-2,3,4,5,7,8, CAT-5-*, CAT-6-* |
| O8 (ETH-initialized) | CAT-4-6 |
| C1 (Healthy) | CAT-1-1,11,12, CAT-PM-9,10,12 |
| C2 (Near-liquidation) | CAT-1-8, CAT-PM-8 |
| C3 (Liquidated) | CAT-1-2, CAT-PM-7 |
| C4 (Zero-validators) | CAT-1-9 |
| C5 (One-op-removed) | CAT-1-3, CAT-PM-2 |
| C6 (All-ops-removed) | CAT-1-4, CAT-PM-3 |
| C7 (Zero-fee-ops) | CAT-1-5, CAT-PM-4 |
| C8 (Max-fee-ops) | CAT-1-6, CAT-PM-5 |
| C9 (Mixed-fee-ops) | CAT-1-7, CAT-PM-1,11 |
| C10 (Large) | CAT-1-10, CAT-PM-6 |
| E1 (Implicit) | CAT-3-1,2,6, CAT-5-4 |
| E2 (Explicit-min) | CAT-3-1, CAT-PM-8 |
| E3 (Explicit-high) | CAT-3-1,3,10, CAT-4-4, CAT-PM-4,5,6,11,12 |
| E4 (Explicit-max) | CAT-3-4 |
| E5 (Stale) | CAT-3-9, CAT-5-4, CAT-PM-7,12 |

### Post-Migration Cross-Product Coverage Matrix

Shows which cluster archetypes are now tested against which post-migration operations:

| Cluster Archetype | Liquidate | EB Update | Reactivate | Multi-Cycle | Op Removal Mid-Life |
|---|---|---|---|---|---|
| C1 (Healthy) | PM-9,10,12 | PM-12 | PM-9,10,12 | PM-12 | — |
| C2 (Near-liquidation) | PM-8 | PM-8 | PM-8 | — | — |
| C3 (Liquidated) | PM-7 | PM-7 | PM-7 | — | — |
| C5 (One-op-removed) | PM-2 | — | PM-2 | — | — |
| C6 (All-ops-removed) | PM-3 | — | PM-3 | — | — |
| C7 (Zero-fee-ops) | PM-4 | PM-4 | — | — | — |
| C8 (Max-fee-ops) | PM-5 | PM-5 | PM-5 | — | — |
| C9 (Mixed-fee-ops) | PM-1,11 | PM-11 | PM-1 | — | PM-11 |
| C10 (Large) | PM-6 | PM-6 | PM-6 | — | — |
