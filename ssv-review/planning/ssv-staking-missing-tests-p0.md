# P0 — Security Critical (22)

Missing tests that could expose value extraction, accounting corruption, or liveness failures.

---

## Stress / Max-Parameter Accounting

### S-1. Max parameters stress test — 13 operators, 3000 validators, EB=2048, 5 years
- **Path:** All modules — SSVValidators, SSVClusters, SSVOperators, OperatorLib, ClusterLib, ProtocolLib
- **Test:**
  1. Register 13 operators at max fee (`operatorMaxFee = 5,326,394,735` wei/block packed)
  2. Register 3000 validators to a single cluster using all 13 operators, deposit large amount (e.g., 10,000 ETH)
  3. Call `updateClusterBalance()` with EB = 2048 * 3000 = 6,144,000 ETH total (max EB per validator × max validators). This gives `vUnits = 3000 * 640000 = 1,920,000,000`
  4. Mine ~1,314,000 blocks (≈ 5 years at 12s/block)
  5. **Assert cluster balance:** call view/getter for cluster balance. Verify it equals `deposit - totalFees` where `totalFees = blocks * (13 * operatorFee + networkFee) * vUnits / VUNITS_PRECISION * ETH_DEDUCTED_DIGITS`. Check for uint64/uint128 overflow in the intermediate calculations
  6. **Assert operator balance:** call getter for one operator's earnings. Verify it equals `blocks * operatorFee * effectiveVUnits / VUNITS_PRECISION * ETH_DEDUCTED_DIGITS` where `effectiveVUnits = 3000 * VUNITS_PRECISION + operatorEthVUnits`
  7. **Self-liquidate:** owner calls `liquidate()` on their own cluster. Verify the returned ETH matches the computed remaining cluster balance exactly
  8. **Operator withdraw:** call `withdrawAllOperatorEarnings()` for one operator. Verify the ETH received matches the computed operator earnings exactly
  9. **Conservation invariant:** verify `deposit == liquidation_payout + sum(all_13_operator_withdrawals) + dao_network_earnings`. No wei lost or created.
- **Risk:** This test exercises every arithmetic path at maximum values simultaneously:
  - `effectiveVUnits = 3000*10000 + operatorEthVUnits` → could overflow uint64 if stored incorrectly
  - `delta = blockDiffEthFee * effectiveVUnits / VUNITS_PRECISION` → with max fee and 1.9B effectiveVUnits, delta per block is huge. Over 1.3M blocks, `uint64` balance could overflow (max uint64 ≈ 18.4E18, but packed ETH divides by 100,000)
  - `cluster.balance` subtraction over 5 years with 64x multiplier × 13 operators at max fee — total fees could exceed deposit
  - Integer division truncation compounds over 1.3M blocks — verify dust is bounded
  - `isLiquidatableWithEB` threshold calculation with vUnits=1.9B could overflow uint256 intermediate
- **Severity:** Critical — this single test would catch overflow bugs, precision loss accumulation, and accounting mismatches that only manifest at scale.

---

## SSVClusters

### C-1. `UpdateTooFrequent` revert has zero test coverage
- **Path:** `_verifyEBUpdateFrequency` (SSVClusters.sol:430-434)
- **Test:** Call `updateClusterBalance()` twice without advancing past `minBlocksBetweenUpdates`. First should succeed, second should revert with `UpdateTooFrequent`. Advance blocks, third call should succeed.
- **Risk:** Rate limiting is the anti-manipulation control for EB updates. If accidentally removed, an attacker could rapidly oscillate EB values.
- **Severity:** High

### C-2. `updateClusterBalance()` on a liquidated cluster modifies EB snapshot
- **Path:** `_updateClusterBalanceInternal` — `_updateEBSnapshot` runs unconditionally even when `cluster.active == false`
- **Test:** Liquidate a cluster, then call `updateClusterBalance()` with valid proof. Verify EB snapshot is updated but operator/DAO vUnits are NOT (guarded by `cluster.active`). Verify reactivation uses the new snapshot.
- **Risk:** Modifying EB snapshot on inactive clusters could affect reactivation economics — the stored vUnits determine reactivation solvency requirements.
- **Severity:** High

### C-3. Auto-liquidation balance goes to `msg.sender`, not cluster owner
- **Path:** `_executeLiquidation` → `CoreLib.transferBalance(msg.sender, ...)`
- **Test:** As `otherAccount`, call `updateClusterBalance()` with an EB increase that triggers auto-liquidation. Verify `otherAccount` receives the remaining cluster balance. Verify the exact transfer amount.
- **Risk:** Permissionless EB submitters can claim liquidation rewards. This is the economic incentive for the auto-liquidation system — must be tested explicitly.
- **Severity:** High

### C-4. Fee settlement underflow protection in `_applyClusterFeeUpdates`
- **Path:** `_applyClusterFeeUpdates` — `cluster.balance = 0` when fees exceed balance (SSVClusters.sol:487)
- **Test:** Register with tiny deposit, set EB to 2048, mine blocks until fees >> balance, call `updateClusterBalance()`. Verify balance is clamped to 0 (not reverted), then auto-liquidation fires.
- **Risk:** If the underflow guard were removed, `updateClusterBalance()` would revert for insolvent clusters, making auto-liquidation impossible.
- **Severity:** High

---

## SSVValidators

### V-1. Registration with non-zero operator fees — fee settlement not tested
- **Path:** `_bulkRegisterValidator` → `updateClusterOnRegistration` → `updateBalanceWithEB`
- **Test:** Deploy with operators at fee=1e10. Register validator 1. Mine 100 blocks. Register validator 2 with deposit. Assert `cluster.balance == deposit1 + deposit2 - (opFee * vUnits * blockDiff / VUNITS_PRECISION) - (netFee * vUnits * blockDiff / VUNITS_PRECISION)`.
- **Risk:** ALL existing tests use fee=0. The EB-weighted fee calculation during registration is the core economic path and has zero coverage.
- **Severity:** Critical

### V-2. Registration with non-zero fees AND explicit EB snapshot (non-baseline vUnits)
- **Path:** `_bulkRegisterValidator` → `updateBalanceWithEB` → `getVUnits` (reads explicit snapshot)
- **Test:** Deploy with non-zero fees. Register validator 1. Set EB to 3x baseline via mock. Mine blocks. Register validator 2. Assert fee deduction used 3x vUnits, not baseline.
- **Risk:** Clusters with high EB could pay the same fees as baseline clusters if `getVUnits()` is wrong.
- **Severity:** Critical

### V-3. Remove last validators — deviation cleanup with non-zero operatorEthVUnits
- **Path:** `_bulkRemoveValidator` — empty-cluster cleanup (lines 223-235)
- **Test:** Register 2 validators. Set EB snapshot to 4x baseline (deviation=20000). Set `operatorEthVUnits` for each operator to 20000. Remove both validators. Verify `ebSnapshot.vUnits=0`, `operatorEthVUnits` decreased by 20000 each, `daoTotalEthVUnits` decreased by 20000.
- **Risk:** Existing test sets vUnits where deviation=0, so cleanup code is never exercised. Failing to clean up deviation on last-validator removal permanently inflates operator earnings.
- **Severity:** Critical

### V-4. Remove validator with non-zero fees — fee settlement not tested
- **Path:** `_bulkRemoveValidator` → `updateClusterOperators` → `updateClusterData` → `updateBalanceWithEB`
- **Test:** Deploy with non-zero fees. Register 2 validators. Mine blocks. Remove 1. Assert cluster balance reflects fee deduction at correct vUnits rate.
- **Risk:** Same as V-1 — zero-fee tests mean removal fee settlement has zero coverage.
- **Severity:** Critical

---

## SSVOperators

### O-1. EB-weighted earnings — zero unit test coverage
- **Path:** `OperatorLib.updateSnapshotSt()` — `effectiveVUnits = baseline + storedDeviation`
- **Test:** Set operator `ethValidatorCount=5`, `operatorEthVUnits=50000`. Advance 100 blocks. Withdraw earnings. Verify amount = `100 * feeRaw * (5*10000 + 50000) / 10000 * ETH_DEDUCTED_DIGITS`.
- **Risk:** The entire EB-weighted settlement model is the core new feature. No unit test verifies operator earnings are proportional to effective vUnits.
- **Severity:** Critical

### O-2. uint64 overflow in operator earnings balance accumulation
- **Path:** `OperatorLib.updateSnapshotSt()` line 69: `PackedETH.wrap(uint64(delta))`
- **Test:** Set max fee (`76528650000000` packed), 3000 validators, EB=2048. `effectiveVUnits = 3000*10000 + 189_000_000 = 219_000_000`. Advance N blocks until `uint128(delta) > type(uint64).max`. Verify behavior — silent truncation loses earnings or `PackedETH.add` reverts.
- **Risk:** Silent `uint64` truncation would lose operator earnings without any error.
- **Severity:** High

---

## SSVDAO + SSVStaking

### D-1. `commitRoot` double-read totalSupply (F-1 reproduction)
- **Path:** `commitRoot` lines 172 and 185 — two separate `totalSupply()` reads
- **Test:** Deploy with 3 oracles, quorum 67%. Mint 1000 cSSV. Oracle1 votes (weight=333). Stake 1000 more SSV (totalSupply→2000). Oracle2 votes (weight=666). Accumulated=999. Threshold=(2000*6700)/10000=1340. Quorum NOT reached despite 2/3 oracles voting.
- **Risk:** Staking/unstaking between oracle votes creates inconsistent weight vs threshold. Can make quorum unreachable or trivially reachable.
- **Severity:** High

### D-2. Integer division truncation makes 100% quorum unreachable
- **Path:** `commitRoot` line 181: `weight = totalStaked / defaultOracleIds.length`
- **Test:** Deploy with 3 oracles, quorum 100%. totalSupply=10. weight=10/3=3. All 3 vote: accumulated=9. threshold=10. Quorum NEVER reachable even with 100% participation.
- **Risk:** Permanent liveness failure — no root can ever be committed. All EB updates blocked forever.
- **Severity:** Critical

### D-3. `setQuorumBps(0)` allows single oracle to commit any root
- **Path:** `setQuorumBps` → `commitRoot` threshold = 0
- **Test:** Set quorum to 0 bps. Single oracle submits arbitrary root. Verify it commits instantly. threshold = (totalSupply * 0) / 10000 = 0, any weight > 0 passes.
- **Risk:** Governance misconfiguration enables rogue oracle to manipulate all EB values. Single oracle could set arbitrary effective balances for any cluster.
- **Severity:** Critical

### D-4. `rescueERC20` has no module-level access control
- **Path:** `SSVStaking.rescueERC20` — no `onlyOwner` modifier in module code
- **Test:** Send random ERC20 tokens to the staking contract. Call `rescueERC20(token, attacker_address, amount)` from a non-owner, non-admin address. Check if proxy layer blocks it or if anyone can drain stuck tokens to any address.
- **Risk:** If unintended, any user can drain accidentally sent ERC20 tokens. Module blocks SSV/cSSV but allows all others.
- **Severity:** High

---

## Cross-Module E2E

### E-1. EB update + immediate withdraw exploits stale liquidation check
- **Path:** `withdraw` → `isLiquidatableWithEB` → `updateClusterBalance`
- **Test:** Cluster at EB=32 with 10 ETH deposit. Oracle commits root with EB=2048. User front-runs with `withdraw(9.99 ETH)` — succeeds because `isLiquidatableWithEB` uses current stored vUnits (baseline). Then `updateClusterBalance()` fires, cluster auto-liquidated with 0.01 ETH remaining. Compare total fees paid vs what would have been paid if EB was updated first.
- **Risk:** Users can extract value by timing withdrawals before EB increases. Even though auto-liquidation fires, the user dodged the higher burn rate.
- **Severity:** High

### E-2. Remove all validators from EB-tracked cluster — deviation cleanup
- **Path:** `removeValidator` → cleanup → `operatorEthVUnits`
- **Test:** Register 2 validators on operators [1,2,3,4], set EB=500 (vUnits=156250, deviation=156250-20000=136250). Remove validator 1 (vUnits→146250). Remove validator 2 (validatorCount→0). Verify: `ebSnapshot.vUnits=0`, remaining deviation (146250) subtracted from each `operatorEthVUnits`, `daoTotalEthVUnits` reduced by same. Re-register a new validator, verify baseline operation (no stale deviation).
- **Risk:** Permanently inflated `operatorEthVUnits` would cause all other cluster owners sharing those operators to overpay fees indefinitely.
- **Severity:** Critical

### E-3. Auto-liquidation + staker reward accounting
- **Path:** `updateClusterBalance` (auto-liquidate) → `syncFees` → `claimEthRewards`
- **Test:** Staker stakes 1000 SSV. Register cluster with 1 validator, deposit 0.01 ETH. EB at baseline, mine 50 blocks. Call `syncFees` — staker's reward index updates. EB update to 2048 triggers auto-liquidation. Verify: `daoValidatorCount` decremented, `networkTotalEarnings()` stops accruing for this cluster, staker can claim rewards for pre-liquidation period, no phantom rewards accrue after.
- **Risk:** If validator count isn't decremented on auto-liquidation, `networkTotalEarnings()` keeps growing → stakers claim more than actual ETH in contract → insolvency.
- **Severity:** Critical

### E-4. EB-weighted network fees vs DAO earnings accounting mismatch
- **Path:** `_applyClusterFeeUpdates` (clusters pay EB-weighted) vs `networkTotalEarnings()` (uses `daoValidatorCount` or `daoTotalEthVUnits`?)
- **Test:** Cluster at EB=320 (10x multiplier, vUnits=100000). Mine 1000 blocks. Compute cluster's actual network fee payment: `networkFeeIndex * vUnits / VUNITS_PRECISION * ETH_DEDUCTED_DIGITS`. Compare with `networkTotalEarnings()` growth. Verify they match — or if they diverge, document where the difference goes.
- **Risk:** Systemic accounting mismatch — if clusters pay 10x but DAO tracks 1x, the staking pool is underfunded. If reversed, the pool is overfunded and claims could revert.
- **Severity:** Critical

### E-5. Operator removal while EB-tracked cluster is active
- **Path:** `removeOperator` → `_resetOperatorState` (doesn't clean up `operatorEthVUnits`) → cluster liquidation → `_executeLiquidation` tries to subtract deviation
- **Test:** Register cluster on operators [1,2,3,4], set EB=100 (deviation=21250 per operator). Operator 3 calls `removeOperator(3)` — zeroes ethValidatorCount, fees, snapshot. Verify `operatorEthVUnits[3]` still has 21250 (NOT cleaned up). Mine blocks, liquidate cluster. Verify `_executeLiquidation` correctly handles the removed operator — `operatorEthVUnits[3]` subtracted by 21250 without underflow.
- **Risk:** Potential underflow in `operatorEthVUnits` for removed operators could revert `liquidate()` transactions, making clusters unliquidatable. Or stale deviation inflates other clusters' costs.
- **Severity:** High

### E-6. `commitRoot` quorum manipulation via stake/unstake timing
- **Path:** `stake` → `commitRoot` (inflated weight) → `requestUnstake` → `commitRoot` (lowered threshold)
- **Test:** 3 oracles, quorum 75%, mint 1000 cSSV. Oracle1 votes: weight=1000/3=333 (33.3%). User unstakes 500 (totalSupply→500). Oracle2 votes: weight=500/3=166. Accumulated=333+166=499. Threshold=500*75%=375. 499 >= 375 — quorum reached! But oracle weights were computed under different totalSupply values.
- **Risk:** Oracle governance attack — an attacker (or MEV bot) can stake before first votes (inflating per-oracle weight) then unstake before final vote (lowering threshold), manipulating which roots get committed.
- **Severity:** High

### E-7. EB update + immediate deposit/withdraw balance consistency
- **Path:** `updateClusterBalance` → `deposit` → `withdraw` in same block
- **Test:** Register cluster, deposit 10 ETH. Set EB from 32→2048 (64x). In same block: deposit 5 ETH (total ~15 ETH minus fees). Withdraw 14 ETH. Verify `isLiquidatableWithEB` uses NEW vUnits (64x) for the post-withdrawal check. The withdrawal should revert because 1 ETH remaining can't cover liquidation threshold at 64x burn rate. Reduce withdraw to 5 ETH — should succeed.
- **Risk:** If deposit/withdraw after EB update doesn't use updated vUnits for the solvency check, users could drain clusters below the EB-weighted threshold.
- **Severity:** High
