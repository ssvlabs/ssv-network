# SSV Network — Verified Test Coverage Gap Analysis

**Date:** 2026-02-17
**Branch:** `verify/test-coverage`
**Commit:** `6a19659`

---

## 1. Test Suite Inventory

### 1.1 Unit Tests (`test/unit/`)

| Directory | Files | Test Cases | Summary |
|-----------|-------|------------|---------|
| SSVOperators/ | 11 files | ~55 | registerOperator, removeOperator, declareOperatorFee, cancelDeclaredOperatorFee, executeOperatorFee, reduceOperatorFee, operatorPrivacy, withdrawOperatorEarnings (ETH), withdrawOperatorEarningsSSV, withdrawAllVersionOperatorEarnings, reentrancy |
| SSVClusters/ | 9 files | ~65 | deposit, ebAutoLiquidation, ebSettlement, liquidate, liquidateSSV, migrateClusterToETH, reactivate, updateClusterBalance, withdraw |
| SSVValidator/ | 6 files | ~64 | registerValidator, removeValidator, bulkRegisterValidator, bulkRemoveValidator, exitValidator, bulkExitValidator |
| SSVDAO/ | 14 files | ~75 | commitRoot, replaceOracle, setQuorumBps, setUnstakeCooldownDuration, updateDeclareOperatorFeePeriod, updateExecuteOperatorFeePeriod, updateLiquidationThresholdPeriod, updateMaximumOperatorFee, updateMinimumLiquidationCollateral, updateMinimumOperatorEthFee, updateNetworkFee, updateNetworkFeeSSV, updateOperatorFeeIncreaseLimit, withdrawNetworkSSVEarnings |
| SSVStaking/ | 7 files | ~60 | claimEthRewards, onCSSVTransfer, requestUnstake, rescueERC20, stake, syncFees, withdrawUnlocked |
| packedLib.test.ts | 1 file | ~75 | PackedETHLib + PackedSSVLib pack/unpack/arithmetic/comparison + constants |

### 1.2 Integration Tests (`test/integration/`)

| File | Test Cases | Summary |
|------|------------|---------|
| SSVNetwork.test.ts | ~120 | Full integration: operators, whitelists, validators, clusters, staking, DAO governance |
| SSVNetwork/clusters.test.ts | ~19 | Balance deltas, burn rate, invariant checks, liquidation boundaries, lifecycle |
| SSVNetwork/legacy-ssv.test.ts | ~15 | SSV vs ETH cluster differentiation, network fee independence, version checks |
| SSVNetwork/operators.test.ts | ~33 | Operator fee boundaries, earnings accrual, balance consistency, fee lifecycle |
| SSVNetwork/staking.test.ts | ~20 | Token movements, reward accrual, proportional distribution, invariants, lifecycle |

### 1.3 Sanity Tests (`test/sanity/`)

| File | Test Cases | Summary |
|------|------------|---------|
| effective-balance.ts | 11 | EB→vUnits→EB roundtrip conversions (0, 1, 31, 32, 33, 63, 64, 100, 515, 1000, 2048 ETH) |
| removed-operator.test.ts | 1 | Liquidation of cluster with previously removed operator |

### 1.4 Echidna Fuzzing (`test/echidna/`)

| File | Invariants | Summary |
|------|------------|---------|
| CSSVTokenAccessControlEchidna.sol | 3 | Mint/burn access control |
| CSSVTokenEchidna.sol | 9 | ERC20 supply invariants, metadata immutability |
| SSVClustersEchidna.sol | 8 | Hash consistency, balance accounting, withdraw limits, liquidation/reactivation |
| SSVAccountingEchidna.sol | 5 | ETH/SSV conservation, solvency, vUnits deviation consistency |
| SSVDAOEchidna.sol | 13 | Fee index monotonicity, parameter bounds, DAO balance, oracle commit rules |
| SSVOperatorsEchidna.sol | 19 | Unique pubkeys, fee bounds, declare/execute latency, withdraw limits, earnings monotonicity |
| SSVEdgeCasesEchidna.sol | 4 | Yoyo liquidation, reactivation vUnits, validator spam, fee index overflow |
| SSVStakingEchidna.sol | 12 | syncFees robustness, cSSV supply matching, pool/DAO balance sync, reward bounds |
| SSVValidatorsEchidna.sol | 8 | Validator/cluster hash consistency, validator/operator counts, balance accounting, access control |

### 1.5 Fork Tests (`test/test-forked/`)

| File | Summary |
|------|---------|
| fullIntegrationForked.test.ts | Mirrors SSVNetwork.test.ts against actual mainnet deploy (conditional on RUN_FORK=true) |

---

## 2. What IS Tested (by module)

### SSVOperators
- Register: fee bounds (min/max/zero/precision), duplicate pubkey, event emission
- Fee lifecycle: declare, cancel, execute (timing windows, fee increase limits, owner-only), reduce
- Withdrawal: ETH partial/full/zero, SSV partial/full/zero, dual-version withdrawal, precision checks
- Privacy: single/batch toggle, access control
- Reentrancy: ETH withdrawal reentrancy blocked (SSV reentrancy test exists but assertions commented out)
- Integration: fee boundary conditions (exact min/max), earnings accrual over blocks, equal operator splits, fee change workflow

### SSVClusters
- Deposit: balance updates, third-party deposits, EB snapshot immutability during deposit
- Withdraw: balance updates, insufficient balance, uint64 overflow in usageUnits, version check
- Liquidate (ETH): owner/third-party, EB snapshot handling, operatorEthVUnits updates, gas for 7/10/13 ops
- LiquidateSSV: owner/third-party, SSV token transfer, EB isolation from ETH
- Reactivate: sufficient balance, EB deviation, liquidated SSV→ETH migration, daoTotalEthVUnits consistency
- Migration: SSV→ETH with refund, EB snapshot preservation, mixed operator states, removed operator handling, fee settlement
- EB Auto-Liquidation: EB increase triggers liquidation, reentrancy guard during callback
- EB Settlement: Fee weighting with vUnits (32/1000 ETH), baseline fallback, zero validators
- UpdateClusterBalance: merkle proof validation, EB bounds (32-2048), stale/future block, SSV isolation
- Integration: balance conservation invariant, burn rate per block, liquidation boundaries, full lifecycle

### SSVValidators
- Register: new/existing cluster, EB snapshot tracking (with/without), 4/7/10/13 operators, no-deposit, gas tracking
- Remove: state updates, EB snapshot consistency, EB cleanup on last validator, 7/10/13 operators
- BulkRegister: 2/10 validators, EB tracking, new/existing clusters, gas tracking
- BulkRemove: partial/complete removal, EB snapshot cleanup, gas tracking
- Exit/BulkExit: event emission, EB immutability during exit, gas tracking
- Input validation: pubkey length, operator sorting/uniqueness, liquidated cluster, duplicate keys

### SSVDAO
- CommitRoot: oracle access control, block number validation (stale/future), quorum voting, weight accumulation, double-vote prevention
- ReplaceOracle: replacement, storage updates, reverse mapping, uniqueness, zero address/ID
- Governance params: All parameter setters tested for storage, events, bounds (where applicable)
- WithdrawNetworkSSVEarnings: balance validation, precision check, event, complete withdrawal

### SSVStaking
- Stake: SSV→cSSV minting, user index update, minimum stake, allowance/balance checks, multiple stakes, fee settlement between stakes
- RequestUnstake: cSSV burn, unlock time, zero/max-request/over-balance reverts, fee settlement before unstake
- WithdrawUnlocked: post-cooldown withdrawal, partial unlock, multi-request batch, access control
- ClaimEthRewards: reward payout, precision remainder handling, fee sync before claim, multi-claim, user isolation
- OnCSSVTransfer: access control (cSSV-only), settlement for sender+receiver
- SyncFees: accEthPerShare formula, natural accrual, no-fee no-op, current<previous handling, zero staked
- RescueERC20: token rescue, protected tokens (SSV/cSSV), zero checks

### PackedLib
- Comprehensive pack/unpack, arithmetic (add/sub with overflow/underflow), comparisons, constants, ETH vs SSV scaling

---

## 3. MISSING Tests — Grouped by Priority

### P0 — Security-Critical (value extraction, accounting corruption, liveness)

#### P0-1: Validator registration/removal with non-zero operator fees
**What's missing:** Every SSVValidator test uses operators with fee=0 (the default). The entire fee settlement mechanism (`updateClusterOperators` / `settleClusterBalance`) during register/remove has zero real coverage with actual fee deductions.
**Why critical:** If fee settlement is wrong, clusters are overcharged or undercharged on every register/remove. Operators could drain funds or lose earnings.
**Specific scenarios untested:**
- Register validator into cluster with 4 operators each charging different ETH fees, verify cluster balance deduction matches `blocksDelta * sum(operatorFees) * vUnits / VUNITS_PRECISION * ETH_DEDUCTED_DIGITS`
- Register second validator after N blocks, verify fees from first validator settled correctly before adding second
- Remove validator with non-zero fees, verify operator earnings accumulated match expected
- Bulk register 10 validators with non-zero fees, verify total deduction

#### P0-2: EB-weighted operator earnings accumulation
**What's missing:** No unit test verifies that operators earn more when their clusters have higher effective balance. The EB settlement tests check fee deductions from the cluster side but don't verify the operator earnings side.
**Why critical:** The vUnit model is the core economic change in v2.0.0. If operator earnings don't scale with EB, the entire incentive model is broken.
**Specific scenarios untested:**
- Operator serves two clusters: one with EB=32 (baseline), one with EB=64. After N blocks, verify operator earnings = (blocks * fee * 10000 + blocks * fee * 20000) / VUNITS_PRECISION * ETH_DEDUCTED_DIGITS
- Operator fee change after EB update, verify earnings split correctly at the boundary
- `withdrawOperatorEarnings` after EB-weighted accrual, verify exact ETH withdrawn matches expected

#### P0-3: Balance delta assertions in liquidation paths
**What's missing:** Liquidation tests check events and state transitions but do not assert actual ETH/SSV token transfer amounts.
**Why critical:** A liquidation could emit the correct event but transfer wrong amounts (or nothing).
**Specific scenarios untested:**
- Liquidate ETH cluster: assert `liquidator.balance.after - liquidator.balance.before == cluster.remainingBalance` (accounting for gas)
- Liquidate SSV cluster: assert `SSVToken.balanceOf(liquidator).after - SSVToken.balanceOf(liquidator).before == cluster.remainingSSVBalance`
- Liquidate cluster with 0 remaining balance: assert no ETH transferred
- Self-liquidation: assert owner receives remaining balance

#### P0-4: `updateClusterBalance` on liquidated clusters
**What's missing:** No test for calling `updateClusterBalance` (EB oracle update) on an already-liquidated cluster.
**Why critical:** If the contract doesn't handle this, oracle updates on liquidated clusters could corrupt accounting or revert unexpectedly.
**Specific scenarios untested:**
- Call `updateClusterBalance` with valid proof on a liquidated cluster, verify behavior (should it revert? update EB but not settle fees?)
- EB update that makes a liquidated cluster even more insolvent

#### P0-5: Oracle quorum edge cases
**What's missing:** Only basic quorum tests exist. Missing: boundary conditions, weight manipulation, oracle replacement during voting.
**Why critical:** Quorum is the security model for EB updates. Edge cases could allow premature root commitment or prevent legitimate updates.
**Specific scenarios untested:**
- Quorum set to exactly 100% — all 4 oracles must vote
- Quorum set to 1 bps — single oracle vote commits
- Oracle replaced between proposing and committing — does old oracle's vote count?
- Three oracles vote with quorum=75%, then quorum changed to 76% — does committed root still hold?
- Oracles propose different roots for same block number — verify highest-weight root wins or voting resets

#### P0-6: EB decrease scenarios
**What's missing:** All EB tests only cover EB increases (32→higher). No tests for EB decreasing.
**Why critical:** Validators can have effective balance decrease (e.g., penalties). If EB decreases aren't handled, vUnits could be wrong, operators could be overpaid, or liquidation thresholds miscalculated.
**Specific scenarios untested:**
- EB decreases from 64 ETH to 32 ETH: verify vUnits decrease, operator fees decrease, liquidation threshold recalculated
- EB decreases below 32 ETH: should revert with `EBBelowMinimum`
- EB decreases while cluster is near liquidation threshold — does decrease make it liquidatable?
- Operator deviation negative after EB decrease: verify `daoTotalEthVUnits` updated correctly

#### P0-7: Reentrancy in staking functions
**What's missing:** No reentrancy tests for SSVStaking functions (`claimEthRewards`, `withdrawUnlocked`, `stake`, `requestUnstake`).
**Why critical:** These functions transfer ETH/tokens and are marked `nonReentrant`. Reentrancy via receive() hook could drain rewards.
**Specific scenarios untested:**
- Attacker contract with receive() hook calls `claimEthRewards` during ETH transfer — verify reverts
- Attacker calls `withdrawUnlocked` reentrantly during SSV token transfer — verify reverts

#### P0-8: `rescueERC20` access control
**What's missing:** Unit tests don't verify owner-only access on `rescueERC20`.
**Why critical:** If anyone can call rescueERC20, they could drain accidentally deposited tokens. (Note: the function is owner-gated via SSVNetwork proxy, but this is not tested at the module level.)
**Specific scenario untested:**
- Non-owner calls `rescueERC20` — should revert

#### P0-9: Forbid creating clusters with removed operators
**What's missing:** Although there's a recent fix (#410) for this, no explicit test exists for `registerValidator` with a removed operator in the operator set.
**Why critical:** Creating clusters with removed operators would result in stuck funds with no one to service the validator.
**Specific scenarios untested:**
- Register validator using operatorIds where one operator was previously removed — should revert
- Bulk register where one of the operator IDs belongs to a removed operator

---

### P1 — Correctness (wrong balances, broken lifecycles, untested state transitions)

#### P1-1: Migration balance accounting verification
**What's missing:** Migration tests verify events and state but don't verify exact SSV refund amounts or ETH deposit amounts against independently calculated values.
**Specific scenarios untested:**
- Migrate after 1000 blocks: verify SSV refund = initial_deposit - (blocks * sum(ssv_fees) * validatorCount) * DEDUCTED_DIGITS
- Migrate with partial SSV balance remaining: verify exact token transfer amount
- Migrate cluster where operators have both SSV and ETH fees set: verify ETH side correctly initialized

#### P1-2: Operator fee change + EB burn rate interaction
**What's missing:** No tests combine operator fee changes (declare/execute/reduce) with EB-weighted clusters.
**Specific scenarios untested:**
- Operator increases fee while serving EB=64 cluster: verify burn rate doubles (fee increase * 2x vUnits)
- Operator reduces fee with EB-weighted cluster: verify savings reflected in cluster balance
- Fee execution changes mid-block for EB-weighted cluster: verify boundary accounting

#### P1-3: Network fee update impact on active clusters
**What's missing:** DAO parameter tests verify storage changes but not enforcement. No test shows that `updateNetworkFee` changes the actual burn rate for existing clusters.
**Specific scenarios untested:**
- Increase ETH network fee with active ETH cluster: verify cluster burns faster after update
- Decrease ETH network fee: verify cluster burn rate decreases
- Update network fee with EB-weighted cluster: verify vUnit scaling applied to new fee

#### P1-4: Multi-staker reward fairness
**What's missing:** `onCSSVTransfer` has only 2 tests. Staking integration tests have basic proportional distribution but don't test complex scenarios.
**Specific scenarios untested:**
- 3 stakers with different amounts: verify each receives exactly proportional rewards (with precision accounting)
- Staker A stakes, rewards accrue, staker B stakes, more rewards accrue: verify A gets both periods, B gets only second period
- cSSV transfer from A to B: verify reward settlement for both parties, then verify B earns at higher rate going forward
- Sequential cSSV transfers: A→B→C, verify accumulated rewards at each step

#### P1-5: Liquidation + reactivation multi-cycle accounting drift
**What's missing:** Only single liquidation/reactivation cycles tested.
**Specific scenarios untested:**
- Liquidate → reactivate → operate → liquidate → reactivate: verify cumulative balances, no accounting drift
- Operator earnings across multiple liquidation cycles: verify earnings don't double-count or lose track

#### P1-6: Reactivation with stored EB deviation — solvency check
**What's missing:** Reactivate tests don't verify the solvency check accounts for EB-weighted burn rate.
**Specific scenarios untested:**
- Reactivate cluster with EB=64 (2x burn rate): verify minimum deposit requirement scales with vUnits
- Reactivate with EB=2048 (max, 64x burn rate): verify high deposit requirement enforced

#### P1-7: SSV cluster operations completeness
**What's missing:** Limited SSV-side testing. Most tests focus on ETH clusters.
**Specific scenarios untested:**
- Deposit into SSV cluster (is there even a deposit function for SSV clusters?)
- Withdraw from SSV cluster
- Register/remove validators in SSV cluster with non-zero SSV fees
- SSV cluster with non-zero network fee: verify fee deductions

#### P1-8: View function coverage (SSVViews)
**What's missing:** No dedicated unit test file for SSVViews. View functions are tested indirectly via other tests calling helper functions.
**Specific scenarios untested:**
- `getBalance` returns (balance, ebBalance) tuple — verify both values correct
- `getBalance` for liquidated cluster — verify returns (0, 0)
- `isLiquidatable` at exact boundary — verify returns correct boolean
- `getBurnRate` with EB-weighted cluster — verify scales with vUnits
- `getOperatorEarnings` for operator with both ETH and SSV balances
- All view functions after migration: verify SSV views return 0, ETH views return correct values

#### P1-9: Staking rewards from EB-weighted cluster fees
**What's missing:** Staking integration tests use basic network fees but don't test that EB-weighted clusters produce proportionally more staking rewards.
**Specific scenarios untested:**
- Cluster with EB=64 generates 2x network fees vs EB=32: verify staking pool receives 2x rewards
- Multiple clusters with different EBs: verify cumulative staking rewards match sum of EB-weighted network fees

#### P1-10: `commitRoot` + `updateClusterBalance` E2E flow
**What's missing:** Unit tests for commitRoot and updateClusterBalance exist separately, but no E2E test connects oracle voting → root commitment → cluster EB update → fee recalculation.
**Specific scenarios untested:**
- Full oracle flow: 3 oracles propose same root → root committed → cluster calls updateClusterBalance with proof → verify fees recalculated with new EB
- Multiple clusters update EB from same root: verify independent accounting

#### P1-11: `withdrawNetworkETHEarnings` (DAO ETH withdrawal)
**What's missing:** Only SSV DAO withdrawal is tested (`withdrawNetworkSSVEarnings`). No test for ETH DAO earnings withdrawal.
**Specific scenarios untested:**
- Withdraw ETH network earnings: verify balance, event, access control
- Withdraw more than available ETH: verify revert
- Withdraw after multiple clusters accrue fees: verify cumulative amount

#### P1-12: Migration of cluster with EB snapshot
**What's missing:** Migration with EB snapshot is tested, but edge cases are not.
**Specific scenarios untested:**
- Migrate cluster that has had multiple EB updates: verify latest snapshot used
- Migrate cluster where EB was set and then validators were added: verify vUnits calculated correctly

#### P1-13: Operator removal with active ETH validators
**What's missing:** `removeOperator` tests don't test the impact on active ETH clusters' fee calculations.
**Specific scenarios untested:**
- Remove operator from set of 4 while cluster has active validators: verify fee calculation excludes removed operator
- Verify removed operator stops earning from both ETH and SSV clusters

#### P1-14: Cooldown duration changes affecting pending requests
**What's missing:** `setUnstakeCooldownDuration` is tested for storage but not for impact on pending withdrawal requests.
**Specific scenarios untested:**
- User requests unstake, then DAO reduces cooldown: can user withdraw earlier?
- User requests unstake, then DAO increases cooldown: does user's original unlock time hold?

---

### P2 — Edge Cases (boundaries, dust, defensive checks)

#### P2-1: Minimum/maximum EB values per validator at boundaries
**What's missing:** Limited boundary testing for EB values.
**Specific scenarios untested:**
- EB exactly 32 ETH per validator (10000 vUnits) — verify baseline behavior
- EB exactly 2048 ETH per validator (640000 vUnits) — verify max behavior
- EB at 32 * validatorCount (e.g., 320 ETH for 10 validators) — verify per-validator check
- EB at 2049 * validatorCount — verify revert

#### P2-2: Dust/precision edge cases
**What's missing:** Limited testing at packed type precision boundaries.
**Specific scenarios untested:**
- Withdraw amount of exactly 1 * ETH_DEDUCTED_DIGITS (minimum non-zero withdrawal)
- Cluster balance that rounds to 0 after fee deduction: verify behavior
- Operator earnings of exactly 1 packed unit: verify withdrawable
- accEthPerShare with tiny fee and large totalStaked: verify no rounding to zero

#### P2-3: Max operator count (13) with EB
**What's missing:** Gas tests exist for 13 operators but no EB-weighted tests with 13 operators.
**Specific scenarios untested:**
- 13 operators with EB=2048 (max vUnits): verify no overflow, correct accounting
- Liquidation with 13 operators and high EB: verify threshold calculation doesn't overflow

#### P2-4: Idempotency and double-operation checks
**What's missing:** Limited double-operation testing.
**Specific scenarios untested:**
- Call `exitValidator` twice on same validator — verify second reverts
- Call `syncFees` twice in same block — verify no double-counting
- Call `updateClusterBalance` with same proof twice — verify stale block revert

#### P2-5: Upgrade path (reinitializer)
**What's missing:** No test for the upgrade initializer (reinitializer(3)) behavior.
**Specific scenarios untested:**
- Call initialize with reinitializer(3) — verify new state set correctly
- Call initialize again — verify reverts (already initialized)
- Verify `UPGRADE_TIMESTAMP` immutable prevents pre-migration fee declarations

#### P2-6: Zero-validator cluster operations
**What's missing:** Limited testing for clusters with 0 validators.
**Specific scenarios untested:**
- Deposit into cluster with 0 validators — verify no fees accrue
- Withdraw from cluster with 0 validators — verify full balance withdrawable
- EB update on cluster with 0 validators — verify no vUnits change

#### P2-7: Operator at max validator limit
**What's missing:** `VALIDATORS_PER_OPERATOR_LIMIT` (3000) is defined but edge cases untested.
**Specific scenarios untested:**
- Register validator that would push operator to limit+1 — verify revert
- Remove validator then re-register at limit — verify succeeds

---

## 4. Coverage Report Cross-Reference

The `ssv-review/SSV Staking Mainnet Readiness - Coverage Report.csv` shows many categories at 0% coverage that align with our findings:

| CSV Category | Current Status | Key Gaps |
|---|---|---|
| Liquidate / Reactivate | 0% in CSV, now partially covered | Balance assertions still missing (P0-3) |
| Balances Cluster | 0% in CSV, now partially covered | Register with non-zero fees untested (P0-1) |
| Migrate Balances Cluster | 0% in CSV, partially covered in unit tests | Exact accounting verification missing (P1-1) |
| Migrate Balances Operator | 0% in CSV, partially covered | EB-weighted transitions untested (P0-2) |
| Balances Operator | 0% in CSV, partially covered via integration | Before/after migration balance verification weak (P1-13) |
| Liquidate / Reactivate Balances | 0% in CSV, not covered | ETH/SSV transfer amounts unverified (P0-3) |
| Update Root | 0% in CSV, now covered in unit tests | E2E flow with EB update missing (P1-10) |
| Update Cluster Balance | 0% in CSV, now covered in unit tests | Liquidated cluster + boundary cases missing (P0-4) |
| Staking Deposits | 0% in CSV, now covered | Happy path covered, edge cases remain (P2-2) |
| Staking Accruance | 0% in CSV, now partially covered | Multi-staker fairness missing (P1-4) |
| Staking Removal | 0% in CSV, now covered | Deposit during removal phase untested (P1-14) |
| Edge Cases | 0% in CSV, minimal coverage | Broad gaps remain (P2-1 through P2-7) |
| Edge Case Balances | 0% in CSV, not covered | liquidate-self → remove → reactivate untested |

---

## 5. Summary Statistics

| Category | Count |
|---|---|
| P0 (Security-critical) | 9 findings, ~25 specific scenarios |
| P1 (Correctness) | 14 findings, ~40 specific scenarios |
| P2 (Edge cases) | 7 findings, ~20 specific scenarios |
| **Total missing** | **30 findings, ~85 specific scenarios** |

### Top 5 Systemic Gaps (unchanged from prior analysis, confirmed by actual test review)

1. **Every SSVValidator test uses operators with fee=0** — the entire fee settlement mechanism during register/remove has zero real coverage
2. **EB-weighted operator earnings have zero unit test coverage** — the economic core of the EB feature is untested on the operator side
3. **No balance delta assertions in liquidation paths** — events are checked but actual ETH/SSV transfers are not
4. **EB decrease scenarios are completely untested** — only increases are covered
5. **Staking reentrancy is untested** — SSVStaking functions transfer ETH but no reentrancy test exists for them

### What's Well-Covered

- Packed type library (comprehensive)
- Input validation and access control (broad coverage across modules)
- EB settlement on the cluster side (ebSettlement.test.ts, ebAutoLiquidation.test.ts)
- Migration happy path with complex operator states
- Oracle commitRoot access control and quorum basics
- Staking accumulator math (syncFees.test.ts is thorough)
- Echidna fuzzing provides good invariant coverage for accounting conservation and access control
