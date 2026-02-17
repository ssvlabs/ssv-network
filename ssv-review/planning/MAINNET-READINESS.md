# SSV Network v2.0.0 — Mainnet Readiness Checklist

**Generated:** 2026-02-17
**Updated:** 2026-02-17 (DIP-X review findings folded in)
**Sources:** Verified bug report, verified test coverage gap analysis, verified scripts & ops audit, DIP-X vs implementation review reports (ETH Payments, Effective Balance, SSV Staking)
**Branch:** `ssv-staking` (base for all feature branches)

---

## Priority Summary

| ID | Task | Type | Priority | Effort |
|----|------|------|----------|--------|
| BUG-1 | ~~`ensureETHDefaults` overwritten by stale memory copy~~ | Critical Bug Fix | P0 | ✅ Fixed |
| BUG-2 | `_resetOperatorState` doesn't clear `operator.owner` | Critical Bug Fix | P0 | S |
| BUG-3 | `ensureETHDefaults` resurrects removed operators | Critical Bug Fix | P0 | M |
| BUG-4 | Double deviation cleanup on liquidated cluster validator removal | Critical Bug Fix | P0 | M |
| BUG-5 | `_liquidateAfterEBUpdateIfNeeded` condition too strict for ETH-only operators | Critical Bug Fix | P1 | S |
| BUG-6 | Rewards lost when `totalStaked == 0` in staking `_syncFees` | Critical Bug Fix | P1 | S |
| BUG-7 | `DEFAULT_OPERATOR_ETH_FEE` value deviates from DIP-X spec | Critical Bug Fix | P1 | S |
| BUG-8 | Cooldown duration uses `block.timestamp` but DIP specifies blocks | Critical Bug Fix | P1 | S |
| SEC-1 | `setQuorumBps(0)` allows zero-threshold oracle commits | Security Hardening | P0 | S |
| SEC-2 | `quorumBps` not initialized during upgrade — zero by default | Security Hardening | P0 | S |
| SEC-3 | `replaceOracle` doesn't invalidate pending votes | Security Hardening | P1 | M |
| SEC-4 | `setUnstakeCooldownDuration` allows zero cooldown | Security Hardening | P1 | S |
| SEC-5 | `totalStaked` changes between oracle votes (front-running) | Security Hardening | P1 | L |
| SEC-6 | Add `nonReentrant` to `migrateClusterToETH` | Security Hardening | P2 | S |
| SEC-7 | Add `nonReentrant` to `onCSSVTransfer` | Security Hardening | P2 | S |
| SEC-8 | `reactivate` not emitting warning for removed operators | Security Hardening | P2 | S |
| SEC-9 | `operatorMaxFee` function signature differs from DIP-X spec | Security Hardening | P2 | S |
| SEC-10 | cSSV token lacks governance/voting extensions (ERC20Votes) | Security Hardening | P2 | M |
| TEST-1 | Validator register/remove with non-zero operator fees | Unit Test Completeness | P0 | M |
| TEST-2 | EB-weighted operator earnings accumulation | Unit Test Completeness | P0 | M |
| TEST-3 | Balance delta assertions in liquidation paths | Unit Test Completeness | P0 | M |
| TEST-4 | `updateClusterBalance` on liquidated clusters | Unit Test Completeness | P0 | S |
| TEST-5 | Oracle quorum edge cases | Unit Test Completeness | P0 | M |
| TEST-6 | EB decrease scenarios | Unit Test Completeness | P0 | M |
| TEST-7 | Reentrancy in staking functions | Unit Test Completeness | P0 | S |
| TEST-8 | Forbid creating clusters with removed operators | Unit Test Completeness | P0 | S |
| TEST-9 | Migration balance accounting verification | Unit Test Completeness | P1 | M |
| TEST-10 | Operator fee change + EB burn rate interaction | Unit Test Completeness | P1 | M |
| TEST-11 | Network fee update impact on active clusters | Unit Test Completeness | P1 | S |
| TEST-12 | Multi-staker reward fairness | Unit Test Completeness | P1 | M |
| TEST-13 | Liquidation + reactivation multi-cycle accounting | Unit Test Completeness | P1 | M |
| TEST-14 | Reactivation with EB deviation solvency check | Unit Test Completeness | P1 | S |
| TEST-15 | SSV cluster operations completeness | Unit Test Completeness | P1 | M |
| TEST-16 | View function coverage (SSVViews) | Unit Test Completeness | P1 | M |
| TEST-17 | Staking rewards from EB-weighted cluster fees | Unit Test Completeness | P1 | S |
| TEST-18 | `withdrawNetworkETHEarnings` (DAO ETH withdrawal) | Unit Test Completeness | P1 | S |
| TEST-19 | Operator removal impact on active ETH clusters | Unit Test Completeness | P1 | S |
| TEST-20 | Cooldown duration changes affecting pending requests | Unit Test Completeness | P1 | S |
| TEST-21 | EB boundary values (min/max per validator) | Unit Test Completeness | P2 | S |
| TEST-22 | Dust/precision edge cases | Unit Test Completeness | P2 | S |
| TEST-23 | Max operator count (13) with EB | Unit Test Completeness | P2 | S |
| TEST-24 | Idempotency and double-operation checks | Unit Test Completeness | P2 | S |
| TEST-25 | Upgrade path (reinitializer) tests | Unit Test Completeness | P2 | S |
| TEST-26 | Zero-validator cluster operations | Unit Test Completeness | P2 | S |
| TEST-27 | Operator at max validator limit | Unit Test Completeness | P2 | S |
| ITEST-1 | `commitRoot` → `updateClusterBalance` E2E flow | Integration / E2E Tests | P1 | L |
| ITEST-2 | Migration with multiple EB updates E2E | Integration / E2E Tests | P1 | M |
| DEPLOY-1 | Fix `deploy-all.ts` broken signature and constructor args | Deployment & Scripts | P0 | S |
| DEPLOY-2 | Verify `liquidationThresholdPeriod` config vs spec mismatch | Deployment & Scripts | P1 | S |
| DEPLOY-3 | Verify `ethNetworkFee` rounding in config | Deployment & Scripts | P2 | S |
| DEPLOY-4 | Remove unused error declarations in `ISSVNetworkCore.sol` | Deployment & Scripts | P2 | S |
| DEPLOY-5 | Document `operatorMinFee` governance parameter in DIP-X | Deployment & Scripts | P2 | S |
| DEPLOY-6 | DIP-X unstaking description doesn't match implementation | Deployment & Scripts | P2 | S |
| OPS-1 | Create mainnet deployment runbook | Operational Readiness | P1 | M |
| OPS-2 | Create emergency rollback procedure | Operational Readiness | P1 | M |
| OPS-3 | Update `.env.example` for v2.0.0 | Operational Readiness | P2 | S |
| FUZZ-1 | Strengthen 5 partially-covered echidna invariants | Echidna Invariant Suite | P1 | M |
| FUZZ-2 | Add 16 high-priority new echidna invariants (oracle/EB/fees/liquidation/staking) | Echidna Invariant Suite | P1 | L |
| FUZZ-3 | Add 8 medium-priority echidna invariants (Merkle proof, operator fee gov, legacy SSV) | Echidna Invariant Suite | P2 | L |
| FUZZ-4 | Add 6 lower-priority echidna invariants (vUnit aggregation, migration, overflow) | Echidna Invariant Suite | P2 | XL |

---

## Critical Bug Fix

### [BUG-1] `ensureETHDefaults` overwritten by stale memory copy
- **Type:** Critical Bug Fix
- **Priority:** P0
- **Status:** Fixed (verified on `ssv-staking`)
- **Owner:** (resolved)
- **Timeline:** (complete)
- **Github Link:** (empty)

**Requirement:**
Fix `updateClusterOperatorsOnRegistration` so that the memory copy of an operator is taken AFTER `ensureETHDefaults` writes to storage, not before. The stale memory copy currently overwrites the ETH defaults that were just set.

**Context:**
In `OperatorLib.sol:185`, the operator is loaded into memory. At line 201, `ensureETHDefaults` correctly writes to storage. But at line 239, `s.operators[operatorId] = operator` overwrites storage with the stale memory copy where `ethFee == 0` and `ethSnapshot.block == 0`. For pre-v2 operators that never had ETH fields initialized, this means they silently get zero ETH fees and cluster liquidation thresholds use an incorrect burn rate. This is the highest-severity bug in the codebase.

**Resolution:**
Code refactored on `ssv-staking` — the function now uses a storage reference (`operatorSt`), calls `ensureOperatorExist` and `ensureETHDefaults` on it, and only then copies to memory. See `OperatorLib.sol:197-201`.

**Acceptance Criteria:**
- [x] Operator loaded into memory AFTER `ensureETHDefaults` is called, or `ensureETHDefaults` is called on the memory copy and then written back
- [x] Pre-v2 operators get correct `ethFee` (default ETH fee) after first validator registration
- [x] Pre-v2 operators get correct `ethSnapshot.block` (current block) after first registration
- [x] `cumulativeFee` accumulates correctly (not zero) for clusters with pre-v2 operators
- [ ] Existing unit tests still pass
- [ ] New unit test covers registering a validator with a pre-v2 operator and verifying `ethFee != 0`

**Agent Instructions:**
1. Read `contracts/libraries/OperatorLib.sol` fully, focusing on `updateClusterOperatorsOnRegistration` (line 162).
2. The fix: Move the memory copy (`Operator memory operator = s.operators[operatorId]` at line 185) to AFTER the `ensureETHDefaults(s.operators[operatorId])` call at line 201. Alternatively, call `ensureETHDefaults` on the storage reference first, then load into memory.
3. Ensure the loop structure still works — `ensureETHDefaults` must be called on the storage reference, and then the memory copy should reflect the updated storage.
4. Do NOT change the `ensureETHDefaults` function itself.
5. Do NOT change `updateClusterOperators` or `updateClusterOperatorsOnReactivation` — they are separate code paths.
6. Add a unit test in `test/unit/SSVValidator/` that registers a validator using operators whose `ethFee` and `ethSnapshot.block` are both zero (simulating pre-v2 state), then verifies:
   - `operator.ethFee` is set to the default ETH fee after registration
   - `operator.ethSnapshot.block` is the current block
   - The cluster's cumulative fee correctly includes the operator's ETH fee
7. Run `npm run test:unit` to verify all tests pass.

#### Sub-items:
- [ ] Sub-task 1: Reorder memory load to after `ensureETHDefaults` in `updateClusterOperatorsOnRegistration`
- [ ] Sub-task 2: Write unit test for pre-v2 operator ETH fee initialization during validator registration
- [ ] Sub-task 3: Run full unit test suite and verify no regressions

---

### [BUG-2] `_resetOperatorState` doesn't clear `operator.owner`
- **Type:** Critical Bug Fix
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
When an operator is removed via `removeOperator`, the `_resetOperatorState` function must also clear `operator.owner` to ensure removed operators are consistently detectable across all code paths.

**Context:**
`SSVOperators.sol:326-337` resets most operator fields but leaves `owner` intact. Some code paths detect removed operators via `snapshot.block == 0 && ethSnapshot.block == 0` (correct), but `updateClusterOperatorsOnRegistration` at `OperatorLib.sol:196` uses `operator.owner == address(0)` — which passes for removed operators since owner is still set. This inconsistency is the root cause enabling BUG-1 and BUG-3. The recent fix (#410) to forbid creating clusters with removed operators added a check using `snapshot.block`, but the owner field inconsistency remains.

**Acceptance Criteria:**
- [ ] `_resetOperatorState` sets `operator.owner = address(0)`
- [ ] All code paths that check operator existence agree on how to detect removed operators
- [ ] `checkOwner` in `OperatorLib.sol` still correctly reverts for removed operators
- [ ] Existing tests for `removeOperator` still pass
- [ ] New unit test verifies that after removal, `operator.owner == address(0)`

**Agent Instructions:**
1. Read `contracts/modules/SSVOperators.sol`, focus on `_resetOperatorState` (line 326).
2. Read `contracts/libraries/OperatorLib.sol`, focus on `checkOwner` (line 131) and `updateClusterOperatorsOnRegistration` (line 162, particularly line 196).
3. Add `operator.owner = address(0);` to `_resetOperatorState` after the existing field resets.
4. Verify that `checkOwner` at `OperatorLib.sol:131` handles `owner == address(0)` correctly — it should already revert via `OperatorDoesNotExist` when both `snapshot.block` and `ethSnapshot.block` are 0.
5. Check if any other code relies on `operator.owner` being set after removal (grep for `operator.owner` across all contract files).
6. Do NOT change the `whitelisted` field behavior — it's separate.
7. Run `npm run test:unit` to verify.

#### Sub-items:
- [ ] Sub-task 1: Add `operator.owner = address(0)` to `_resetOperatorState`
- [ ] Sub-task 2: Audit all `operator.owner` references for compatibility
- [ ] Sub-task 3: Add unit test verifying owner is cleared after removal
- [ ] Sub-task 4: Run full test suite

---

### [BUG-3] `ensureETHDefaults` resurrects removed operators
- **Type:** Critical Bug Fix
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
`ensureETHDefaults` must not set `ethSnapshot.block` on removed operators. Add a guard to skip operators that have been removed.

**Context:**
`OperatorLib.sol:142-150`: A removed operator has `ethSnapshot.block == 0` (reset by `_resetOperatorState`). When `ensureETHDefaults` is called, line 143 checks `ethSnapshot.block == 0` → true → sets `ethSnapshot.block = currentBlock`. This partially resurrects the operator's ETH snapshot, putting it in an invalid half-alive state. If BUG-2 is fixed (owner cleared), the guard can simply check `operator.owner != address(0)`. Otherwise, use `operator.snapshot.block == 0 && operator.ethSnapshot.block == 0`.

**Acceptance Criteria:**
- [ ] `ensureETHDefaults` does not modify removed operators
- [ ] Removed operators keep `ethSnapshot.block == 0` after any call path
- [ ] New validators cannot be registered to clusters containing removed operators (already enforced by #410, verify still works)
- [ ] Existing migration and registration tests still pass

**Agent Instructions:**
1. Read `contracts/libraries/OperatorLib.sol`, focus on `ensureETHDefaults` (line 142).
2. If BUG-2 is already fixed (owner cleared on removal), add `if (operator.owner == address(0)) return;` as the first line of `ensureETHDefaults`.
3. If BUG-2 is NOT yet fixed, use the alternative guard: `if (operator.snapshot.block == 0 && operator.ethSnapshot.block == 0 && operator.fee.eq(PACKED_SSV_ZERO)) return;` — this detects fully-reset operators.
4. Coordinate with BUG-2 — ideally fix BUG-2 first so the guard in BUG-3 is clean.
5. Add a unit test that calls a code path triggering `ensureETHDefaults` on a removed operator and verifies `ethSnapshot.block` remains 0.
6. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Add removed-operator guard to `ensureETHDefaults`
- [ ] Sub-task 2: Write unit test for `ensureETHDefaults` on removed operator
- [ ] Sub-task 3: Run full test suite

---

### [BUG-4] Double deviation cleanup on liquidated cluster validator removal
- **Type:** Critical Bug Fix
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Fix `_bulkRemoveValidator` so that when removing the last validators from a liquidated cluster with explicit EB tracking, deviation is not double-subtracted from `operatorEthVUnits` and `daoTotalEthVUnits`.

**Context:**
In `SSVValidators.sol:164-247`, when a cluster is liquidated (`!cluster.active`), the `if (cluster.active)` guard at line 194 skips the operator update. However, the EB deviation cleanup block at lines 211-240 still runs. If the cluster had explicit EB tracking and was liquidated, the deviation was already cleaned up during `_executeLiquidation` (`SSVClusters.sol:554-614`). When `_bulkRemoveValidator` subtracts deviation again at lines 230 and 233, this double-subtracts from `operatorEthVUnits` and `daoTotalEthVUnits`, potentially causing underflow and reverting — which blocks validator removal entirely.

**Acceptance Criteria:**
- [ ] Removing validators from a liquidated cluster with explicit EB tracking does NOT double-subtract deviation
- [ ] `operatorEthVUnits` and `daoTotalEthVUnits` are correct after removing validators from a liquidated cluster
- [ ] Removing validators from a liquidated cluster without explicit EB tracking still works
- [ ] Removing validators from an active cluster is unchanged
- [ ] New test: liquidate a cluster with explicit EB → remove validators → verify no revert and correct deviation values

**Agent Instructions:**
1. Read `contracts/modules/SSVValidators.sol`, focus on `_bulkRemoveValidator` (line 164), particularly the EB deviation cleanup block at lines 211-240.
2. Read `contracts/modules/SSVClusters.sol`, focus on `_executeLiquidation` (line 554) to understand what deviation cleanup liquidation already performs.
3. The fix: Add a guard in the deviation cleanup block (around line 218-237) that skips the `operatorEthVUnits` and `daoTotalEthVUnits` subtraction when `!cluster.active`. The `ebSnapshot.vUnits` zeroing can remain (it's per-cluster and not double-counted).
4. Alternatively, wrap the deviation cleanup in `if (cluster.active || ...)` to only clean up deviation for active clusters.
5. Follow the existing pattern in the codebase where `cluster.active` guards are used.
6. Add a test in `test/unit/SSVValidator/` that: creates a cluster with EB tracking → liquidates it → removes validators → verifies `operatorEthVUnits` and `daoTotalEthVUnits` are correct (not underflowed).
7. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Add `cluster.active` guard around deviation cleanup in `_bulkRemoveValidator`
- [ ] Sub-task 2: Write test for validator removal from liquidated cluster with explicit EB
- [ ] Sub-task 3: Run full test suite

---

### [BUG-5] `_liquidateAfterEBUpdateIfNeeded` condition too strict for ETH-only operators
- **Type:** Critical Bug Fix
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Fix the condition at `SSVClusters.sol:543` so that `ethValidatorCount` is decremented for ETH-only operators (those with `ethSnapshot.block != 0` but `snapshot.block == 0`).

**Context:**
In `_liquidateAfterEBUpdateIfNeeded` at `SSVClusters.sol:521-552`, line 543 checks `op.ethSnapshot.block != 0 && op.snapshot.block != 0` before decrementing `ethValidatorCount`. Operators registered after the v2.0.0 migration may have `snapshot.block == 0` (never had SSV activity), so the decrement is skipped — leaving `ethValidatorCount` inflated.

**Acceptance Criteria:**
- [ ] `ethValidatorCount` is decremented for operators with `ethSnapshot.block != 0` regardless of `snapshot.block`
- [ ] Operators with `ethSnapshot.block == 0` (removed) are still skipped
- [ ] No change to the `_executeLiquidation` call

**Agent Instructions:**
1. Read `contracts/modules/SSVClusters.sol`, focus on `_liquidateAfterEBUpdateIfNeeded` (line 521).
2. Change the condition at line 543 from `op.ethSnapshot.block != 0 && op.snapshot.block != 0` to just `op.ethSnapshot.block != 0`.
3. Verify this doesn't break the removed-operator skip (removed operators have `ethSnapshot.block == 0` after `_resetOperatorState`).
4. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Fix condition in `_liquidateAfterEBUpdateIfNeeded`
- [ ] Sub-task 2: Add test for EB auto-liquidation with ETH-only operators
- [ ] Sub-task 3: Run full test suite

---

### [BUG-6] Rewards lost when `totalStaked == 0` in staking `_syncFees`
- **Type:** Critical Bug Fix
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)
- **DIP-X Review Source:** SSV Staking review findings DIP-18, DIP-19

**Requirement:**
When `totalStaked == 0` in `_syncFees`, ETH rewards must not be silently lost. Either accumulate them for the next sync when stakers exist, or redirect them to the DAO.

**Context:**
`SSVStaking.sol:179-203`: When `totalStaked == 0`, line 196 skips the `accEthPerShare` increment but line 201 still advances `stakingEthPoolBalance`. The fees earned during the zero-staked period are permanently locked in the contract — they can never be distributed to future stakers.

**Additional context from DIP-X review (DIP-19):** The `_syncFees` function also has a related edge case when `current <= previous` (DAO earnings decrease). At `SSVStaking.sol:187-190`, if `current.lte(previous)`, the function silently updates `stakingEthPoolBalance` to the lower value and returns without distributing. This can happen after reward claims reduce `sp.ethDaoBalance`. While `claimEthRewards` reduces both `stakingEthPoolBalance` and `sp.ethDaoBalance` by the same packed amount (so `current == previous` after normal claims), this edge case acts as a safety valve. The fix for BUG-6 should also consider this interaction to ensure no fees are lost in either direction.

**Acceptance Criteria:**
- [ ] ETH rewards earned while `totalStaked == 0` are not permanently lost
- [ ] Choose one strategy: (a) defer the pool balance update so next sync catches the fees, or (b) send unclaimed fees to DAO
- [ ] New test: accrue network fees while no SSV is staked, then stake and verify fees are either distributable or in DAO
- [ ] Existing staking tests pass

**Agent Instructions:**
1. Read `contracts/modules/SSVStaking.sol`, focus on `_syncFees` (line 179).
2. Recommended fix (simplest): When `totalStaked == 0`, do NOT advance `stakingEthPoolBalance`. Simply return early. The next `_syncFees` call when `totalStaked != 0` will pick up the accumulated fees.
3. Specifically: move `s.stakingEthPoolBalance = current;` (line 201) inside the `if (totalStaked != 0)` block.
4. Add a unit test in `test/unit/SSVStaking/` that: deploys, accrues network fees with no stakers, then stakes SSV, then syncs fees — verify `accEthPerShare` includes the previously-accrued fees.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Move pool balance update inside the `totalStaked != 0` check
- [ ] Sub-task 2: Write unit test for fee accrual during zero-staked period
- [ ] Sub-task 3: Run full test suite

---

### [BUG-7] `DEFAULT_OPERATOR_ETH_FEE` value deviates from DIP-X spec
- **Type:** Critical Bug Fix
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)
- **DIP-X Review Source:** ETH Payments review findings ETH-7, ETH-14

**Requirement:**
The `DEFAULT_OPERATOR_ETH_FEE` constant is set to `1,770,000,000` wei (1.77 gwei) but the DIP-X specifies `0.000000001775464912 ETH` (1,775,464,912 wei = 1.775464912 gwei). The DIP value is not packable (not divisible by `ETH_DEDUCTED_DIGITS = 100,000`), so a rounded value must be used. The implementation chose `1,770,000,000` which is further from the spec than necessary. The closest packable value rounding up is `1,775,500,000`.

**Context:**
`SSVCoreTypes.sol:14`: `DEFAULT_OPERATOR_ETH_FEE = 1770_000_000`. The DIP value `1,775,464,912 % 100,000 = 64,912` (not divisible), so it would revert with `MaxPrecisionExceeded`. The closest valid values are `1,775,400,000` (rounding down) or `1,775,500,000` (rounding up). The current value under-delivers by ~0.31% on the stated fee. Per-block difference: 5,464,912 wei. Annual impact per validator: ~0.0000143 ETH less than DIP target.

**Acceptance Criteria:**
- [ ] `DEFAULT_OPERATOR_ETH_FEE` updated to `1_775_500_000` (closest packable value rounding up) or team explicitly documents acceptance of the current rounded value
- [ ] Value is verified to be divisible by `ETH_DEDUCTED_DIGITS` (100,000)
- [ ] DIP-X document updated to note the rounding constraint if current value is kept
- [ ] Existing unit tests still pass with updated constant

**Agent Instructions:**
1. Read `contracts/libraries/SSVCoreTypes.sol`, find the `DEFAULT_OPERATOR_ETH_FEE` constant.
2. Verify `1_775_500_000 % 100_000 == 0` (it is).
3. Change `DEFAULT_OPERATOR_ETH_FEE = 1770_000_000` to `DEFAULT_OPERATOR_ETH_FEE = 1_775_500_000`.
4. Run `npx hardhat compile` to verify compilation.
5. Run `npm run test:unit` to verify no regressions.
6. If tests fail due to hardcoded expectations, update test constants to match.

#### Sub-items:
- [ ] Sub-task 1: Update `DEFAULT_OPERATOR_ETH_FEE` constant or document acceptance of current value
- [ ] Sub-task 2: Verify packability and run tests
- [ ] Sub-task 3: Update DIP-X if needed

---

### [BUG-8] Cooldown duration uses `block.timestamp` but DIP specifies blocks
- **Type:** Critical Bug Fix
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)
- **DIP-X Review Source:** SSV Staking review finding DIP-8

**Requirement:**
The DIP-X governance table explicitly states `cooldownDuration` is "in blocks" with initial value "50120 (7 days)" and setter `setUnstakeCooldownDuration(uint64 blocks)`. However, the implementation uses `block.timestamp` (seconds-based), not `block.number`. This creates a critical configuration risk: if `cooldownDuration` is initialized to 50120 thinking it's blocks, the actual cooldown would be ~13.9 hours instead of 7 days.

**Context:**
`SSVStaking.sol:88`: `uint64 unlockTime = uint64(block.timestamp + s.cooldownDuration)`. The `UnstakeRequest` struct field is named `unlockTime` (timestamp-like), and `SSVStaking.sol:232` checks `requests[i].unlockTime <= block.timestamp`. Using `block.timestamp` is actually more reliable for user-facing cooldowns (block times can vary), so the implementation choice is reasonable — but the DIP/spec and the initial value must align. If using seconds, the correct 7-day value is 604,800, not 50,120.

**Acceptance Criteria:**
- [ ] Either: DIP-X updated to say "in seconds" and initial value changed to `604800` (7 days in seconds)
- [ ] Or: implementation changed to use `block.number` instead of `block.timestamp` to match DIP
- [ ] The upgrade initializer sets the correct value for whichever unit is chosen
- [ ] `setUnstakeCooldownDuration` parameter is documented with correct units
- [ ] Existing tests verified to use the correct unit

**Agent Instructions:**
1. Read `contracts/modules/SSVStaking.sol`, focus on `requestUnstake` (line 66) and `calculateTotalUnfrozenBalance` (line 226).
2. Read `contracts/modules/SSVDAO.sol`, focus on `setUnstakeCooldownDuration` (line 245).
3. Read `contracts/upgrades/stage/hoodi/SSVNetworkSSVStakingUpgrade.sol` for the initial value set during upgrade.
4. Recommended fix (simpler): Keep `block.timestamp` usage (it's better UX), but:
   a. Update the DIP-X governance table to say "in seconds" instead of "in blocks"
   b. Ensure the upgrade initializer sets `cooldownDuration = 604800` (7 days in seconds)
   c. Update `setUnstakeCooldownDuration` parameter name from `blocks` to `duration` in the interface
5. Check deployment configs (`hoodi-fork.config.json`) for the cooldown value and verify it matches the chosen unit.
6. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Decide on units (seconds vs blocks) and align implementation + DIP
- [ ] Sub-task 2: Verify upgrade initializer sets correct value for chosen unit
- [ ] Sub-task 3: Update interface parameter name if needed
- [ ] Sub-task 4: Run full test suite

---

## Security Hardening

### [SEC-1] `setQuorumBps(0)` allows zero-threshold oracle commits
- **Type:** Security Hardening
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add a minimum quorum validation to `setQuorumBps`. A quorum of 0 allows a single oracle vote to commit any root.

**Context:**
`SSVDAO.sol:234-239`: The function only checks `quorum > BPS_DENOMINATOR` (max bound). Setting `quorumBps = 0` makes the threshold in `commitRoot` (line 186) equal to 0, meaning any single oracle can unilaterally commit roots. Combined with SEC-2 (quorum defaults to 0 after upgrade), this is an immediate post-upgrade vulnerability.

**Acceptance Criteria:**
- [ ] `setQuorumBps(0)` reverts with `InvalidQuorum()`
- [ ] A reasonable minimum is enforced (e.g., `quorum >= 2500` for 25%, or at minimum `quorum > 0`)
- [ ] Existing tests for `setQuorumBps` updated to reflect new validation
- [ ] New test: call `setQuorumBps(0)` → expect revert

**Agent Instructions:**
1. Read `contracts/modules/SSVDAO.sol`, focus on `setQuorumBps` (line 234).
2. Add `if (quorum == 0) revert InvalidQuorum();` before the existing check. Consider also adding a minimum like `if (quorum < 2500)` for stronger safety.
3. Read `test/unit/SSVDAO/setQuorumBps.test.ts` for existing test patterns.
4. Add a test case for `setQuorumBps(0)` expecting `InvalidQuorum` revert.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Add minimum quorum validation to `setQuorumBps`
- [ ] Sub-task 2: Update/add unit tests for quorum boundary
- [ ] Sub-task 3: Run full test suite

---

### [SEC-2] `quorumBps` not initialized during upgrade — zero by default
- **Type:** Security Hardening
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Set `quorumBps` during the upgrade initializer (`reinitializer(3)`) to prevent a window where any oracle can unilaterally commit roots.

**Context:**
`SSVNetworkSSVStakingUpgrade.sol` (line 8) initializes `cooldownDuration` and `defaultOracleIds` but NOT `quorumBps`. After upgrade, `quorumBps` is 0 in storage until the DAO manually calls `setQuorumBps()`. During this window, combined with SEC-1, a single oracle can commit arbitrary Merkle roots. `staking-upgrade.ts` also does not set quorum (only `upgrade-fork.ts` does, via config).

**Acceptance Criteria:**
- [ ] `quorumBps` is set during the upgrade initializer to a safe default (7500 = 75% per DIP-X spec)
- [ ] OR: the mainnet deployment runbook explicitly documents that `setQuorumBps()` MUST be called in the same transaction batch as the upgrade
- [ ] Post-upgrade verification confirms `quorumBps != 0`

**Agent Instructions:**
1. Read `contracts/upgrades/stage/hoodi/SSVNetworkSSVStakingUpgrade.sol` (line 8).
2. Option A (preferred): Add `SSVStorageStaking.load().quorumBps = 7500;` to the `initializeSSVStaking` function. Also add `quorumBps` as a parameter: `initializeSSVStaking(uint64 cooldownDuration, uint32[4] memory defaultOracleIds, uint16 quorumBps)`. Update the function signature in `scripts/staking-upgrade.ts` and `scripts/upgrade-fork.ts` accordingly.
3. Option B (simpler): Add a hardcoded `SSVStorageStaking.load().quorumBps = 7500;` directly in the initializer without adding a parameter.
4. Emit `QuorumUpdated(7500)` event after setting.
5. Update the initializer ABI references in deploy scripts.
6. Run `npm run test:unit` and `npm run test:integration`.

#### Sub-items:
- [ ] Sub-task 1: Add `quorumBps` initialization to upgrade initializer
- [ ] Sub-task 2: Update deploy scripts to match new signature (if adding parameter)
- [ ] Sub-task 3: Add test verifying `quorumBps` is set after upgrade
- [ ] Sub-task 4: Run full test suite

---

### [SEC-3] `replaceOracle` doesn't invalidate pending votes
- **Type:** Security Hardening
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
When an oracle is replaced, invalidate any pending votes cast by the old oracle for uncommitted commitments, OR document this as accepted behavior with explicit risks.

**Context:**
`SSVDAO.sol:205-229`: When `replaceOracle` is called, the old oracle's address is removed from `oracleIdOf` but the `oracleId` stays the same. The `hasVoted` mapping uses `oracleId`, so: (1) the old oracle's votes persist and count toward quorum, (2) the new oracle cannot re-vote on pending commitments since `hasVoted[commitmentKey][oracleId]` is already true. A compromised oracle replaced mid-vote still influences quorum.

**Acceptance Criteria:**
- [ ] Either: pending votes for the replaced oracleId are reset when `replaceOracle` is called
- [ ] Or: this behavior is explicitly documented with risk analysis, and a mechanism exists to clear stale votes if needed
- [ ] Test: replace oracle mid-vote → verify new oracle can vote on pending commitments

**Agent Instructions:**
1. Read `contracts/modules/SSVDAO.sol`, focus on `replaceOracle` (line 205) and `commitRoot` (line 155).
2. Read the `SSVStorageEB` storage struct to understand the `hasVoted` and `commitmentWeight` mappings.
3. To reset pending votes: after replacing the oracle, iterate over pending commitments and clear `hasVoted[commitmentKey][oracleId]` and subtract the old oracle's weight from `commitmentWeight[commitmentKey]`. However, this requires tracking pending commitments, which may not be stored.
4. Simpler alternative: add a `voteNonce` per oracleId. Increment it on replacement. Use `keccak256(commitmentKey, oracleId, voteNonce)` for the hasVoted key. This invalidates all old votes automatically.
5. Ensure the fix doesn't break the quorum mechanism for non-replaced oracles.
6. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Design vote invalidation mechanism
- [ ] Sub-task 2: Implement in `replaceOracle` and `commitRoot`
- [ ] Sub-task 3: Write tests for oracle replacement mid-vote
- [ ] Sub-task 4: Run full test suite

---

### [SEC-4] `setUnstakeCooldownDuration` allows zero cooldown
- **Type:** Security Hardening
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add a minimum cooldown duration to prevent instant unstaking which undermines the staking security model.

**Context:**
`SSVDAO.sol:245-248`: No minimum check. Zero cooldown allows stake/vote/unstake in one block, defeating the economic security mechanism. An attacker could stake, earn oracle voting rights, manipulate a vote, and immediately unstake.

**Acceptance Criteria:**
- [ ] `setUnstakeCooldownDuration(0)` reverts
- [ ] A reasonable minimum is enforced (e.g., 1 day = 86400 seconds)
- [ ] Existing tests updated

**Agent Instructions:**
1. Read `contracts/modules/SSVDAO.sol`, focus on `setUnstakeCooldownDuration` (line 245).
2. Add `if (duration == 0) revert InvalidCooldownDuration();` (define new error in `ISSVNetworkCore.sol` if needed, or reuse an existing generic error).
3. Consider adding a minimum like `if (duration < 86400) revert ...;` for 1-day minimum.
4. Update `test/unit/SSVDAO/setUnstakeCooldownDuration.test.ts`.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Add minimum cooldown validation
- [ ] Sub-task 2: Update/add unit tests
- [ ] Sub-task 3: Run full test suite

---

### [SEC-5] `totalStaked` changes between oracle votes (front-running risk)
- **Type:** Security Hardening
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Snapshot `totalStaked` at the start of a voting round (first proposal) and use the snapshotted value for all subsequent votes in that round, preventing front-running via stake/unstake between votes.

**Context:**
`SSVDAO.sol:155-200` (`commitRoot`): Each oracle vote reads `totalStaked` fresh (line 172). Between votes, `totalStaked` can change via stake/unstake. This makes the quorum threshold inconsistent within a single voting round — someone could front-run oracle votes with large stake/unstake operations to either block legitimate quorum or force premature quorum.

**Acceptance Criteria:**
- [ ] `totalStaked` is captured once per voting round and used for all votes in that round
- [ ] Weight calculation and threshold calculation use the same snapshotted value
- [ ] Test: oracle A votes, large stake change, oracle B votes → quorum uses consistent weight

**Agent Instructions:**
1. Read `contracts/modules/SSVDAO.sol`, focus on `commitRoot` (line 155).
2. Read `contracts/libraries/storage/SSVStorageEB.sol` to understand what state is tracked per commitment.
3. Design: Add a `snapshotTotalStaked` field to the commitment state. On first vote for a new commitmentKey, snapshot `totalStaked`. On subsequent votes, use the snapshot instead of re-reading.
4. Store the snapshot in `SSVStorageEB` alongside `commitmentWeight`.
5. When a commitment is finalized (root committed), clean up the snapshot.
6. This is a more involved change — be careful not to break existing oracle voting logic.
7. Run `npm run test:unit` and `npm run test:integration`.

#### Sub-items:
- [ ] Sub-task 1: Add `snapshotTotalStaked` to commitment state in SSVStorageEB
- [ ] Sub-task 2: Snapshot on first vote, use snapshot for subsequent votes
- [ ] Sub-task 3: Clean up snapshot on commitment finalization
- [ ] Sub-task 4: Write tests for consistent weight across votes
- [ ] Sub-task 5: Run full test suite

---

### [SEC-6] Add `nonReentrant` to `migrateClusterToETH`
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add the `nonReentrant` modifier to `migrateClusterToETH` for defense-in-depth. The function calls `CoreLib.transferTokenBalance` (SSV ERC20 transfer) at line 341.

**Context:**
`SSVClusters.sol:264`: While the SSV token is a standard ERC20 without transfer hooks (so reentrancy via token callback is unlikely), adding `nonReentrant` follows the codebase's established pattern for functions that make external calls. State changes happen before the transfer (checks-effects-interactions), but the modifier provides an additional safety layer.

**Acceptance Criteria:**
- [ ] `migrateClusterToETH` has the `nonReentrant` modifier
- [ ] Existing migration tests still pass

**Agent Instructions:**
1. Read `contracts/modules/SSVClusters.sol`, focus on `migrateClusterToETH` (line 264).
2. Add `nonReentrant` modifier to the function signature, following the pattern used by `liquidate`, `withdraw`, etc.
3. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Add `nonReentrant` modifier to `migrateClusterToETH`
- [ ] Sub-task 2: Run full test suite

---

### [SEC-7] Add `nonReentrant` to `onCSSVTransfer`
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add `nonReentrant` modifier to `onCSSVTransfer` for defense-in-depth consistency.

**Context:**
`SSVStaking.sol:169`: The function makes external calls to `ICSSVToken.totalSupply()` and `ICSSVToken.balanceOf()`. While the cSSV token is trusted (deployed by the protocol), the modifier provides protection if cSSV is ever upgraded or replaced. All other staking functions already have `nonReentrant`.

**Acceptance Criteria:**
- [ ] `onCSSVTransfer` has the `nonReentrant` modifier
- [ ] Existing staking tests still pass

**Agent Instructions:**
1. Read `contracts/modules/SSVStaking.sol`, focus on `onCSSVTransfer` (line 169).
2. Add `nonReentrant` modifier. Import `SSVReentrancyGuard` if not already imported.
3. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Add `nonReentrant` modifier to `onCSSVTransfer`
- [ ] Sub-task 2: Run full test suite

---

### [SEC-8] `reactivate` not emitting warning for removed operators
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
When a cluster is reactivated and one or more of its operators have been removed, emit an event indicating which operators are inactive so users and off-chain systems are aware.

**Context:**
`SSVClusters.sol:133-185`: `reactivate` calls `updateClusterOperatorsOnReactivation` (line 151), which skips removed operators at `OperatorLib.sol:311`. The cluster is reactivated with fewer active operators, but no event signals this. Users may not realize their cluster is running with reduced operator coverage.

**Acceptance Criteria:**
- [ ] A new event (e.g., `InactiveOperatorInCluster(uint64 operatorId)`) is emitted for each removed operator during reactivation
- [ ] OR: existing `ClusterReactivated` event includes information about skipped operators
- [ ] Test: reactivate a cluster with a removed operator → verify event emission

**Agent Instructions:**
1. Read `contracts/modules/SSVClusters.sol`, focus on `reactivate` (line 133).
2. Read `contracts/libraries/OperatorLib.sol`, focus on `updateClusterOperatorsOnReactivation` (line 295), particularly the `ethSnapshot.block != 0` check at line 311.
3. Add return data from `updateClusterOperatorsOnReactivation` that indicates which operators were skipped, or emit events directly from the library function.
4. Define the new event in `ISSVClusters.sol`.
5. Add test in `test/unit/SSVClusters/reactivate.test.ts`.
6. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Define and emit inactive operator event
- [ ] Sub-task 2: Write test for reactivation with removed operator event
- [ ] Sub-task 3: Run full test suite

---

### [SEC-9] `operatorMaxFee` function signature differs from DIP-X spec
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)
- **DIP-X Review Source:** ETH Payments review finding ETH-13

**Requirement:**
The DIP-X governance table specifies `updateMaximumOperatorFee(uint64 maxFee)` but the implementation uses `updateMaximumOperatorFee(uint256 maxFee)`. While the `uint256` parameter is more user-friendly (users pass the full wei value, packing handles conversion), the DIP and implementation should be aligned.

**Context:**
`SSVDAO.sol:138`: `function updateMaximumOperatorFee(uint256 maxFee)`. The `uint256` value is packed into `PackedETH` (uint64) internally via `PackedETHLib.pack(maxFee)`. This is a cosmetic interface difference, not a functional issue. The `uint256` parameter prevents users from needing to pre-pack their values. However, ABIs and documentation should be consistent.

**Acceptance Criteria:**
- [ ] Either: DIP-X updated to document `uint256` parameter type (recommended — matches implementation's user-friendly design)
- [ ] Or: implementation changed to `uint64` to match DIP (not recommended — less user-friendly)
- [ ] ABI documentation updated to match

**Agent Instructions:**
1. This is primarily a documentation alignment task.
2. Read `contracts/modules/SSVDAO.sol`, focus on `updateMaximumOperatorFee` (line 138).
3. Read `contracts/interfaces/ISSVDAO.sol` for the interface declaration.
4. Update the DIP-X governance table to specify `uint256` instead of `uint64`.
5. No code change needed if DIP is updated.

#### Sub-items:
- [ ] Sub-task 1: Align DIP-X and implementation on parameter type
- [ ] Sub-task 2: Update ABI documentation

---

### [SEC-10] cSSV token lacks governance/voting extensions (ERC20Votes)
- **Type:** Security Hardening
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)
- **DIP-X Review Source:** SSV Staking review finding DIP-10

**Requirement:**
The DIP-X states: "Staked SSV, represented by cSSV, retains full governance and voting power. Holding cSSV does not reduce a user's ability to participate in DAO governance compared to holding unstaked SSV." However, `CSSVToken.sol` is a plain `ERC20` with no `ERC20Votes` or delegation mechanism. Whether governance rights are preserved depends entirely on off-chain configuration (e.g., Snapshot strategy).

**Context:**
`CSSVToken.sol:10`: `contract CSSVToken is ERC20`. No `ERC20Votes`, no `ERC20VotesComp`, no delegation mechanism. The SSV DAO uses Snapshot (off-chain governance), which can be configured to count cSSV balances. If the Snapshot strategy includes cSSV, the DIP claim holds. If on-chain governance is ever needed, cSSV holders would lose voting power compared to SSV holders.

**Acceptance Criteria:**
- [ ] Decision documented: is off-chain governance (Snapshot) the permanent governance mechanism?
- [ ] If yes: verify the Snapshot strategy is updated to include cSSV balances before mainnet launch
- [ ] If on-chain governance is planned: add `ERC20Votes` extension to `CSSVToken`
- [ ] DIP-X updated to clarify governance mechanism (on-chain vs off-chain)

**Agent Instructions:**
1. Read `contracts/token/CSSVToken.sol` fully.
2. This is primarily a governance/product decision, not a pure code fix.
3. If the team confirms Snapshot is the permanent mechanism:
   a. Ensure the Snapshot space strategy counts cSSV
   b. Document this in the DIP and deployment runbook
4. If on-chain governance is needed:
   a. Add `ERC20Votes` to `CSSVToken` inheritance
   b. Override `_afterTokenTransfer` (or `_update` in OZ v5) to call `_transferVotingUnits`
   c. Add `clock()` and `CLOCK_MODE()` overrides
   d. This requires careful upgrade planning since `CSSVToken` is not upgradeable
5. Flag this for team decision before proceeding.

#### Sub-items:
- [ ] Sub-task 1: Get team decision on governance mechanism
- [ ] Sub-task 2: Implement chosen approach (Snapshot config update or ERC20Votes addition)
- [ ] Sub-task 3: Update DIP-X governance section

---

## Unit Test Completeness

### [TEST-1] Validator register/remove with non-zero operator fees
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add unit tests for validator registration and removal with operators that have non-zero ETH fees. Currently ALL SSVValidator tests use operators with `fee=0` (the default), leaving the entire fee settlement mechanism untested.

**Context:**
This is the #1 systemic test gap. The fee settlement mechanism (`updateClusterOperators` / `settleClusterBalance`) during register/remove has zero real coverage with actual fee deductions. If fee settlement is wrong, clusters are overcharged or undercharged on every register/remove. The EB-weighted fee model (`vUnits`) makes this even more critical.

**Acceptance Criteria:**
- [ ] Test: Register validator with 4 operators each charging different ETH fees → verify cluster balance deduction = `blocksDelta * sum(operatorFees) * vUnits / VUNITS_PRECISION * ETH_DEDUCTED_DIGITS`
- [ ] Test: Register second validator after N blocks → verify fees from first validator settled correctly before adding second
- [ ] Test: Remove validator with non-zero fees → verify operator earnings accumulated match expected
- [ ] Test: Bulk register 10 validators with non-zero fees → verify total deduction
- [ ] All new tests pass

**Agent Instructions:**
1. Read `test/unit/SSVValidator/registerValidator.test.ts` to understand existing patterns and test helpers.
2. Read `test/helpers/contract-helpers.ts` to understand how operators are registered and fees are set. Look for `registerOperator` helper and how `declareOperatorFee` / `executeOperatorFee` work.
3. Read `test/common/constants.ts` for fee-related constants.
4. Create a new test file or add a describe block to existing files. Use the existing `CONFIG` fixture pattern.
5. For each test:
   - Register operators with non-zero ETH fees (use `declareOperatorFee` → advance blocks → `executeOperatorFee`)
   - Register validators
   - Advance blocks with `mine(N)`
   - Perform the operation (register/remove)
   - Calculate expected fees independently: `blocksDelta * sum(PackedETH.unwrap(fee)) * vUnits / VUNITS_PRECISION * ETH_DEDUCTED_DIGITS`
   - Assert cluster balance = initial deposit - expected fees
   - Assert operator earnings match expected accumulation
6. Use `ethers.provider.getBalance` for ETH balance checks and the SSVViews contract for cluster/operator balance queries.
7. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Register validator with non-zero operator fees — verify cluster balance deduction
- [ ] Sub-task 2: Sequential validator registration with fee settlement verification
- [ ] Sub-task 3: Remove validator with non-zero fees — verify operator earnings
- [ ] Sub-task 4: Bulk register with non-zero fees — verify total deduction

---

### [TEST-2] EB-weighted operator earnings accumulation
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add unit tests verifying that operators earn proportionally more when serving clusters with higher effective balance. The EB settlement tests check fee deductions from the cluster side but don't verify operator earnings.

**Context:**
The vUnit model is the core economic change in v2.0.0. If operator earnings don't scale with EB, the entire incentive model is broken. No unit test currently verifies the operator earnings side of EB-weighted accounting.

**Acceptance Criteria:**
- [ ] Test: Operator serves two clusters, EB=32 and EB=64 → after N blocks, verify operator earnings = `(blocks * fee * 10000 + blocks * fee * 20000) / VUNITS_PRECISION * ETH_DEDUCTED_DIGITS`
- [ ] Test: Operator fee change after EB update → verify earnings split correctly at boundary
- [ ] Test: `withdrawOperatorEarnings` after EB-weighted accrual → verify exact ETH withdrawn matches expected

**Agent Instructions:**
1. Read `test/unit/SSVClusters/ebSettlement.test.ts` to understand EB test patterns.
2. Read `test/unit/SSVOperators/withdrawOperatorEarnings.test.ts` for withdrawal test patterns.
3. Read `contracts/libraries/OperatorLib.sol`, focus on `updateSnapshot` to understand how operator earnings accumulate with vUnits.
4. Create tests that:
   - Register an operator
   - Create two clusters with different EBs (use `updateClusterBalance` with Merkle proofs to set EB)
   - Advance blocks
   - Verify operator earnings via `SSVViews.getOperatorEarnings(operatorId)`
   - Withdraw and verify exact ETH amount
5. Use the Merkle proof helpers in `test/helpers/` to create valid proofs for EB updates.
6. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Operator earning from two clusters with different EBs
- [ ] Sub-task 2: Operator fee change boundary with EB-weighted clusters
- [ ] Sub-task 3: Withdraw operator earnings after EB-weighted accrual

---

### [TEST-3] Balance delta assertions in liquidation paths
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add balance delta assertions to liquidation tests. Current tests check events and state transitions but do not assert actual ETH/SSV token transfer amounts.

**Context:**
A liquidation could emit the correct event but transfer the wrong amount (or nothing). Without balance delta assertions, incorrect transfer logic is invisible to the test suite.

**Acceptance Criteria:**
- [ ] Test: Liquidate ETH cluster → assert `liquidator.balance.after - liquidator.balance.before == cluster.remainingBalance` (accounting for gas)
- [ ] Test: Liquidate SSV cluster → assert `SSVToken.balanceOf(liquidator).after - before == cluster.remainingSSVBalance`
- [ ] Test: Liquidate cluster with 0 remaining balance → assert no ETH transferred
- [ ] Test: Self-liquidation → assert owner receives remaining balance

**Agent Instructions:**
1. Read `test/unit/SSVClusters/liquidate.test.ts` and `test/unit/SSVClusters/liquidateSSV.test.ts`.
2. Add balance capture before/after each liquidation call:
   ```typescript
   const balanceBefore = await ethers.provider.getBalance(liquidator.address);
   const tx = await ssvNetwork.connect(liquidator).liquidate(...);
   const receipt = await tx.wait();
   const gasCost = receipt.gasUsed * receipt.gasPrice;
   const balanceAfter = await ethers.provider.getBalance(liquidator.address);
   expect(balanceAfter - balanceBefore + gasCost).to.equal(expectedReward);
   ```
3. For SSV token liquidations, use `SSVToken.balanceOf()` instead of native balance.
4. Calculate expected remaining balance independently using the cluster balance formula.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: ETH liquidation balance delta assertions
- [ ] Sub-task 2: SSV liquidation balance delta assertions
- [ ] Sub-task 3: Zero-balance liquidation
- [ ] Sub-task 4: Self-liquidation balance check

---

### [TEST-4] `updateClusterBalance` on liquidated clusters
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests for calling `updateClusterBalance` (EB oracle update) on an already-liquidated cluster.

**Context:**
No test exists for this path. If the contract doesn't handle it, oracle updates on liquidated clusters could corrupt accounting or revert unexpectedly.

**Acceptance Criteria:**
- [ ] Test: Call `updateClusterBalance` with valid proof on a liquidated cluster → verify defined behavior (revert or update EB without settling fees)
- [ ] Test: EB update that makes a liquidated cluster even more insolvent → verify no state corruption

**Agent Instructions:**
1. Read `test/unit/SSVClusters/updateClusterBalance.test.ts` for existing patterns.
2. Create a cluster, liquidate it, then call `updateClusterBalance` with a valid Merkle proof.
3. Verify behavior: does it revert? Does it update EB? Does it try to settle fees?
4. Read `contracts/modules/SSVClusters.sol` to trace the `updateClusterBalance` code path for liquidated clusters.
5. Add assertions based on actual contract behavior.
6. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: `updateClusterBalance` on liquidated cluster — basic behavior
- [ ] Sub-task 2: EB increase on already-insolvent liquidated cluster

---

### [TEST-5] Oracle quorum edge cases
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add comprehensive edge case tests for the oracle quorum mechanism in `commitRoot`.

**Context:**
Only basic quorum tests exist. Missing: boundary conditions, weight manipulation, oracle replacement during voting, quorum parameter changes mid-vote.

**Acceptance Criteria:**
- [ ] Test: Quorum at exactly 100% — all 4 oracles must vote
- [ ] Test: Quorum at 1 bps — single oracle vote commits
- [ ] Test: Oracle replaced between proposing and committing — verify vote behavior
- [ ] Test: Quorum changed between votes — verify consistent threshold
- [ ] Test: Oracles propose different roots for same block number — verify correct root wins

**Agent Instructions:**
1. Read `test/unit/SSVDAO/commitRoot.test.ts` for existing patterns.
2. Read `contracts/modules/SSVDAO.sol`, focus on `commitRoot` (line 155) for the voting/quorum logic.
3. Add tests for each scenario. For oracle replacement mid-vote, call `replaceOracle` between two `commitRoot` calls for the same block number.
4. Use `setQuorumBps` to set boundary values before testing.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: 100% quorum boundary test
- [ ] Sub-task 2: Minimal quorum (1 bps) test
- [ ] Sub-task 3: Oracle replacement mid-vote
- [ ] Sub-task 4: Quorum change mid-vote
- [ ] Sub-task 5: Conflicting root proposals

---

### [TEST-6] EB decrease scenarios
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add unit tests for effective balance decreases. All current EB tests only cover increases (32→higher). Validators can have EB decrease due to penalties.

**Context:**
If EB decreases aren't handled correctly, vUnits could be wrong, operators could be overpaid, or liquidation thresholds could be miscalculated. EB decrease is a completely untested code path.

**Acceptance Criteria:**
- [ ] Test: EB decrease from 64 ETH to 32 ETH → verify vUnits decrease, operator fees decrease, liquidation threshold recalculated
- [ ] Test: EB decrease below 32 ETH → should revert with `EBBelowMinimum`
- [ ] Test: EB decrease while cluster is near liquidation threshold → verify decrease triggers liquidation if below threshold
- [ ] Test: Operator deviation negative after EB decrease → verify `daoTotalEthVUnits` updated correctly

**Agent Instructions:**
1. Read `test/unit/SSVClusters/ebSettlement.test.ts` and `test/unit/SSVClusters/updateClusterBalance.test.ts`.
2. Create test scenarios where EB starts high and is updated to a lower value via `updateClusterBalance` with a Merkle proof for the lower EB.
3. Use the Merkle tree helpers to generate proofs for decreased EB values.
4. Verify vUnits, deviation, burn rate, and liquidation threshold after decrease.
5. For the below-32-ETH case, verify the contract reverts with the correct error.
6. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: EB decrease from 64→32 ETH — vUnits and fee verification
- [ ] Sub-task 2: EB below minimum (< 32 ETH) — revert test
- [ ] Sub-task 3: EB decrease triggering liquidation
- [ ] Sub-task 4: Negative deviation after EB decrease

---

### [TEST-7] Reentrancy in staking functions
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add reentrancy tests for SSVStaking functions that transfer ETH or tokens. These functions are marked `nonReentrant` but no test verifies the protection works.

**Context:**
`claimEthRewards`, `withdrawUnlocked`, `stake`, `requestUnstake` all handle ETH or SSV token transfers. Reentrancy via a `receive()` hook could theoretically drain rewards. The `nonReentrant` modifier should prevent this, but it's untested. The existing SSVOperators reentrancy test (`test/unit/SSVOperators/reentrancy.test.ts`) can serve as a pattern.

**Acceptance Criteria:**
- [ ] Test: Attacker contract with `receive()` hook calls `claimEthRewards` reentrantly → verify reverts
- [ ] Test: Attacker calls `withdrawUnlocked` reentrantly during SSV token transfer → verify reverts
- [ ] All reentrancy tests use a custom attacker contract deployed in the test

**Agent Instructions:**
1. Read `test/unit/SSVOperators/reentrancy.test.ts` for the existing reentrancy test pattern.
2. Read the attacker contract used (look for a reentrant test helper contract in `contracts/` or `test/`).
3. Create similar reentrancy tests for `claimEthRewards` and `withdrawUnlocked`.
4. Deploy a contract that: receives ETH → calls back into `claimEthRewards` → expect revert with reentrancy error.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: `claimEthRewards` reentrancy test
- [ ] Sub-task 2: `withdrawUnlocked` reentrancy test

---

### [TEST-8] Forbid creating clusters with removed operators
- **Type:** Unit Test Completeness
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add explicit tests for PR #410 (forbid creating clusters with removed operators). Verify both `registerValidator` and `bulkRegisterValidator` revert when given a removed operator ID.

**Context:**
PR #410 added a fix but no explicit test exists for this scenario. Creating clusters with removed operators would result in stuck funds with no one to service the validator.

**Acceptance Criteria:**
- [ ] Test: Register validator using operatorIds where one operator was previously removed → should revert
- [ ] Test: Bulk register where one of the operator IDs belongs to a removed operator → should revert

**Agent Instructions:**
1. Read `test/unit/SSVValidator/registerValidator.test.ts` and `test/unit/SSVValidator/bulkRegisterValidator.test.ts`.
2. Add a test that: registers 4 operators, removes one, then tries to register a validator with all 4 operator IDs → expect revert.
3. Add the same for bulk registration.
4. Identify the specific error that the contract reverts with (likely `OperatorDoesNotExist` — check `contracts/libraries/OperatorLib.sol`).
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: `registerValidator` with removed operator → revert test
- [ ] Sub-task 2: `bulkRegisterValidator` with removed operator → revert test

---

### [TEST-9] Migration balance accounting verification
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests that verify exact SSV refund amounts and ETH deposit amounts during migration, calculated independently from contract logic.

**Context:**
Migration tests verify events and state but don't verify exact token transfer amounts against independently calculated values.

**Acceptance Criteria:**
- [ ] Test: Migrate after 1000 blocks → verify SSV refund = `initial_deposit - (blocks * sum(ssv_fees) * validatorCount) * DEDUCTED_DIGITS`
- [ ] Test: Migrate with partial SSV balance remaining → verify exact token transfer amount
- [ ] Test: Migrate cluster where operators have both SSV and ETH fees set → verify ETH side correctly initialized

**Agent Instructions:**
1. Read `test/unit/SSVClusters/migrateClusterToETH.test.ts` for existing patterns.
2. Add independent balance calculations using JavaScript BigInt arithmetic matching the contract's formula.
3. Assert `SSVToken.balanceOf(owner).after - SSVToken.balanceOf(owner).before == expectedRefund`.
4. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Exact SSV refund after N blocks
- [ ] Sub-task 2: Migration with partial balance
- [ ] Sub-task 3: Migration with dual SSV/ETH fees

---

### [TEST-10] Operator fee change + EB burn rate interaction
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests combining operator fee changes (declare/execute/reduce) with EB-weighted clusters.

**Context:**
No tests combine operator fee changes with EB-weighted clusters. The burn rate depends on both operator fee and vUnits, and fee changes must properly settle the old rate before applying the new one.

**Acceptance Criteria:**
- [ ] Test: Operator increases fee while serving EB=64 cluster → verify burn rate doubles
- [ ] Test: Operator reduces fee with EB-weighted cluster → verify savings reflected
- [ ] Test: Fee execution changes mid-block for EB-weighted cluster → verify boundary accounting

**Agent Instructions:**
1. Read `test/unit/SSVOperators/declareOperatorFee.test.ts` and `test/unit/SSVOperators/executeOperatorFee.test.ts`.
2. Read `test/unit/SSVClusters/ebSettlement.test.ts`.
3. Create combined tests: register operator with fee, create cluster with EB, change fee, verify cluster balance reflects correct burn rate split.
4. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Fee increase with EB-weighted cluster
- [ ] Sub-task 2: Fee reduction with EB-weighted cluster
- [ ] Sub-task 3: Fee change boundary accounting

---

### [TEST-11] Network fee update impact on active clusters
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests verifying that `updateNetworkFee` changes the actual burn rate for existing active clusters.

**Context:**
DAO parameter tests verify storage changes but not enforcement on active clusters.

**Acceptance Criteria:**
- [ ] Test: Increase ETH network fee with active ETH cluster → verify cluster burns faster
- [ ] Test: Decrease ETH network fee → verify cluster burn rate decreases
- [ ] Test: Update network fee with EB-weighted cluster → verify vUnit scaling applied

**Agent Instructions:**
1. Read `test/unit/SSVDAO/updateNetworkFee.test.ts`.
2. Create cluster, advance blocks, check balance, then update network fee, advance more blocks, check balance again.
3. Verify the balance difference in each period matches the respective fee rates.
4. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Network fee increase enforcement
- [ ] Sub-task 2: Network fee decrease enforcement
- [ ] Sub-task 3: Network fee with EB scaling

---

### [TEST-12] Multi-staker reward fairness
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add comprehensive multi-staker scenarios testing proportional reward distribution and cSSV transfer settlement.

**Context:**
`onCSSVTransfer` has only 2 tests. Staking integration tests have basic proportional distribution but don't test complex scenarios with multiple stakers entering/exiting at different times or transferring cSSV.

**Acceptance Criteria:**
- [ ] Test: 3 stakers with different amounts → each receives exactly proportional rewards
- [ ] Test: Staker A stakes, rewards accrue, staker B stakes → A gets both periods, B gets only second
- [ ] Test: cSSV transfer from A to B → verify reward settlement for both, B earns at higher rate
- [ ] Test: Sequential cSSV transfers A→B→C → verify accumulated rewards at each step

**Agent Instructions:**
1. Read `test/unit/SSVStaking/claimEthRewards.test.ts` and `test/unit/SSVStaking/onCSSVTransfer.test.ts`.
2. Read `test/integration/SSVNetwork/staking.test.ts` for integration patterns.
3. Use the `accEthPerShare` formula: `pendingReward = cSSVBalance * (accEthPerShare - userIndex) / 1e18`.
4. Calculate expected rewards independently and assert exact values (accounting for precision loss).
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Three-staker proportional distribution
- [ ] Sub-task 2: Time-weighted staking (A early, B late)
- [ ] Sub-task 3: cSSV transfer settlement
- [ ] Sub-task 4: Sequential cSSV transfer chain

---

### [TEST-13] Liquidation + reactivation multi-cycle accounting
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests for multiple liquidation/reactivation cycles to verify no accounting drift accumulates.

**Context:**
Only single liquidation/reactivation cycles are tested. Over multiple cycles, rounding errors or state leakage could accumulate.

**Acceptance Criteria:**
- [ ] Test: Liquidate → reactivate → operate → liquidate → reactivate → verify cumulative balances, no drift
- [ ] Test: Operator earnings across multiple liquidation cycles → verify no double-counting

**Agent Instructions:**
1. Read `test/unit/SSVClusters/liquidate.test.ts` and `test/unit/SSVClusters/reactivate.test.ts`.
2. Create a test that performs 3+ full cycles: deposit → advance blocks → liquidate → reactivate with deposit → repeat.
3. Track operator earnings and cluster balance at each step, verify consistency.
4. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Multi-cycle liquidation/reactivation accounting
- [ ] Sub-task 2: Operator earnings across cycles

---

### [TEST-14] Reactivation with EB deviation solvency check
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Test that reactivation solvency checks account for EB-weighted burn rate.

**Context:**
Reactivate tests don't verify that the minimum deposit scales with vUnits. A cluster with EB=2048 has 64x the burn rate and should require a proportionally higher deposit.

**Acceptance Criteria:**
- [ ] Test: Reactivate cluster with EB=64 → verify minimum deposit requirement scales with 2x vUnits
- [ ] Test: Reactivate with EB=2048 → verify high deposit requirement enforced

**Agent Instructions:**
1. Read `test/unit/SSVClusters/reactivate.test.ts`.
2. Create clusters with different EBs, liquidate them, then try to reactivate with minimal deposits.
3. Verify that insufficient deposits for high-EB clusters revert.
4. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Reactivation solvency with EB=64
- [ ] Sub-task 2: Reactivation solvency with EB=2048

---

### [TEST-15] SSV cluster operations completeness
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add comprehensive tests for SSV-denominated cluster operations. Most tests focus on ETH clusters, leaving SSV cluster paths undertested.

**Context:**
The dual cluster system maintains parallel SSV and ETH records. SSV cluster operations should still work correctly during the transition period.

**Acceptance Criteria:**
- [ ] Test: Register/remove validators in SSV cluster with non-zero SSV fees → verify fee deductions
- [ ] Test: SSV cluster with non-zero network fee → verify fee deductions
- [ ] Test: Withdraw from SSV cluster → verify balance and token transfer

**Agent Instructions:**
1. Read existing SSV-related tests: `test/unit/SSVClusters/liquidateSSV.test.ts`, `test/integration/SSVNetwork/legacy-ssv.test.ts`.
2. Create tests that operate entirely in the SSV version (VERSION_SSV = 0).
3. Set non-zero SSV fees on operators before creating clusters.
4. Verify SSV token balance changes match expected fee deductions.
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: SSV validator registration with fees
- [ ] Sub-task 2: SSV cluster network fee deductions
- [ ] Sub-task 3: SSV cluster withdrawal

---

### [TEST-16] View function coverage (SSVViews)
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add dedicated unit tests for SSVViews functions. Currently view functions are tested only indirectly.

**Context:**
No dedicated unit test file exists for SSVViews. Functions like `getBalance`, `isLiquidatable`, `getBurnRate`, `getOperatorEarnings` are used as helpers in other tests but their correctness is never directly asserted.

**Acceptance Criteria:**
- [ ] Test: `getBalance` returns correct `(balance, ebBalance)` tuple
- [ ] Test: `getBalance` for liquidated cluster returns `(0, 0)`
- [ ] Test: `isLiquidatable` at exact boundary returns correct boolean
- [ ] Test: `getBurnRate` with EB-weighted cluster scales with vUnits
- [ ] Test: `getOperatorEarnings` for operator with both ETH and SSV balances
- [ ] Test: All view functions after migration — SSV views return 0, ETH views return correct values

**Agent Instructions:**
1. Read `contracts/modules/SSVViews.sol` to understand all view functions.
2. Create `test/unit/SSVViews/views.test.ts` (or similar) following existing test patterns.
3. Set up various cluster states (active, liquidated, migrated) and verify view function return values.
4. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: `getBalance` basic and edge cases
- [ ] Sub-task 2: `isLiquidatable` boundary tests
- [ ] Sub-task 3: `getBurnRate` with EB
- [ ] Sub-task 4: `getOperatorEarnings` dual-version
- [ ] Sub-task 5: View functions after migration

---

### [TEST-17] Staking rewards from EB-weighted cluster fees
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Test that EB-weighted clusters produce proportionally more staking rewards via the network fee.

**Context:**
Staking integration tests use basic network fees but don't verify that higher-EB clusters contribute proportionally more to the staking pool.

**Acceptance Criteria:**
- [ ] Test: Cluster with EB=64 generates 2x network fees vs EB=32 → verify staking pool receives 2x rewards
- [ ] Test: Multiple clusters with different EBs → verify cumulative staking rewards match sum of EB-weighted network fees

**Agent Instructions:**
1. Read `test/integration/SSVNetwork/staking.test.ts`.
2. Create two clusters with different EBs, advance blocks, sync fees, verify `accEthPerShare` increment matches EB-weighted expectation.
3. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: EB=64 vs EB=32 staking reward comparison
- [ ] Sub-task 2: Multi-cluster cumulative staking rewards

---

### [TEST-18] `withdrawNetworkETHEarnings` (DAO ETH withdrawal)
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add unit tests for DAO ETH earnings withdrawal. Only SSV DAO withdrawal (`withdrawNetworkSSVEarnings`) is currently tested.

**Context:**
There is no test for `withdrawNetworkETHEarnings`. The function should exist for withdrawing accumulated ETH network fees.

**Acceptance Criteria:**
- [ ] Test: Withdraw ETH network earnings → verify balance, event, access control
- [ ] Test: Withdraw more than available → verify revert
- [ ] Test: Withdraw after multiple clusters accrue fees → verify cumulative amount

**Agent Instructions:**
1. Read `test/unit/SSVDAO/withdrawNetworkSSVEarnings.test.ts` for the SSV withdrawal pattern.
2. Search for `withdrawNetworkETHEarnings` or similar function in `contracts/modules/SSVDAO.sol`.
3. Create equivalent tests for the ETH version.
4. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Basic ETH withdrawal test
- [ ] Sub-task 2: Over-withdrawal revert test
- [ ] Sub-task 3: Cumulative multi-cluster accrual test

---

### [TEST-19] Operator removal impact on active ETH clusters
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Test the impact of operator removal on active ETH clusters' fee calculations.

**Context:**
`removeOperator` tests don't test the downstream effect on active ETH clusters' fee calculations.

**Acceptance Criteria:**
- [ ] Test: Remove operator from set of 4 while cluster has active validators → verify fee calculation excludes removed operator
- [ ] Test: Verify removed operator stops earning from both ETH and SSV clusters

**Agent Instructions:**
1. Read `test/unit/SSVOperators/removeOperator.test.ts`.
2. Read `test/sanity/removed-operator.test.ts` for the existing removed operator scenario.
3. Create a cluster with 4 operators, remove one, advance blocks, verify cluster balance only decreases by 3 operators' fees.
4. Verify the removed operator's earnings are frozen (no new earnings after removal).
5. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Fee calculation after operator removal
- [ ] Sub-task 2: Removed operator earnings freeze

---

### [TEST-20] Cooldown duration changes affecting pending requests
- **Type:** Unit Test Completeness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Test how changes to `cooldownDuration` affect pending unstake withdrawal requests.

**Context:**
`setUnstakeCooldownDuration` is tested for storage but not for impact on existing pending requests.

**Acceptance Criteria:**
- [ ] Test: User requests unstake, DAO reduces cooldown → can user withdraw earlier?
- [ ] Test: User requests unstake, DAO increases cooldown → does user's original unlock time hold?

**Agent Instructions:**
1. Read `test/unit/SSVStaking/requestUnstake.test.ts` and `test/unit/SSVStaking/withdrawUnlocked.test.ts`.
2. Read `contracts/modules/SSVStaking.sol` to understand how `unlockTime` is stored (is it absolute timestamp or relative?).
3. Create tests: stake → request unstake → change cooldown → attempt withdraw → verify behavior.
4. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Cooldown reduction — earlier withdrawal test
- [ ] Sub-task 2: Cooldown increase — original unlock time test

---

### [TEST-21] EB boundary values (min/max per validator)
- **Type:** Unit Test Completeness
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add boundary tests for EB values at minimum (32 ETH) and maximum (2048 ETH) per validator.

**Context:**
Limited boundary testing exists. The sanity tests cover conversions but not the full cluster accounting at boundaries.

**Acceptance Criteria:**
- [ ] Test: EB exactly 32 ETH per validator (10000 vUnits) — baseline behavior
- [ ] Test: EB exactly 2048 ETH per validator (640000 vUnits) — max behavior
- [ ] Test: EB at 2049 per validator — verify revert

**Agent Instructions:**
1. Read `test/sanity/effective-balance.ts`.
2. Read `test/unit/SSVClusters/updateClusterBalance.test.ts`.
3. Add boundary-value tests using `updateClusterBalance` with Merkle proofs at exact boundaries.
4. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: EB=32 baseline test
- [ ] Sub-task 2: EB=2048 maximum test
- [ ] Sub-task 3: EB>2048 revert test

---

### [TEST-22] Dust/precision edge cases
- **Type:** Unit Test Completeness
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add precision edge case tests for packed type boundaries and tiny values.

**Acceptance Criteria:**
- [ ] Test: Withdraw amount of exactly 1 * ETH_DEDUCTED_DIGITS (minimum non-zero)
- [ ] Test: Cluster balance that rounds to 0 after fee deduction
- [ ] Test: Operator earnings of exactly 1 packed unit — verify withdrawable
- [ ] Test: accEthPerShare with tiny fee and large totalStaked — verify no rounding to zero

**Agent Instructions:**
1. Read `test/unit/packedLib.test.ts` for packed type patterns.
2. Create edge case tests using minimum possible values.
3. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Minimum withdrawal amount
- [ ] Sub-task 2: Zero-rounding cluster balance
- [ ] Sub-task 3: Minimum operator earnings
- [ ] Sub-task 4: Precision in accEthPerShare

---

### [TEST-23] Max operator count (13) with EB
- **Type:** Unit Test Completeness
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests for 13-operator clusters with high EB values to verify no overflow.

**Acceptance Criteria:**
- [ ] Test: 13 operators with EB=2048 — verify no overflow, correct accounting
- [ ] Test: Liquidation with 13 operators and high EB — verify threshold calculation

**Agent Instructions:**
1. Read existing gas tests for 13 operators in `test/unit/SSVValidator/`.
2. Create tests combining 13 operators with maximum EB.
3. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: 13 operators + EB=2048 accounting
- [ ] Sub-task 2: 13 operators + high EB liquidation

---

### [TEST-24] Idempotency and double-operation checks
- **Type:** Unit Test Completeness
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests verifying that double-calling operations either reverts or is safely idempotent.

**Acceptance Criteria:**
- [ ] Test: `exitValidator` twice on same validator → verify second reverts
- [ ] Test: `syncFees` twice in same block → verify no double-counting
- [ ] Test: `updateClusterBalance` with same proof twice → verify stale block revert

**Agent Instructions:**
1. Read relevant test files for each operation.
2. Call each operation twice and verify the second call either reverts with the correct error or is safely no-op.
3. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Double `exitValidator`
- [ ] Sub-task 2: Double `syncFees` in same block
- [ ] Sub-task 3: Double `updateClusterBalance` with same proof

---

### [TEST-25] Upgrade path (reinitializer) tests
- **Type:** Unit Test Completeness
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests for the upgrade initializer (`reinitializer(3)`) behavior.

**Acceptance Criteria:**
- [ ] Test: Call initializer with `reinitializer(3)` → verify new state set correctly
- [ ] Test: Call initializer again → verify reverts (already initialized)
- [ ] Test: Verify `UPGRADE_TIMESTAMP` immutable prevents pre-migration fee declarations

**Agent Instructions:**
1. Read `contracts/upgrades/stage/hoodi/SSVNetworkSSVStakingUpgrade.sol`.
2. Read `test/setup/` for how upgrades are performed in tests.
3. Create tests that upgrade the proxy and verify the initializer runs correctly, then fails on re-call.
4. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Successful reinitializer(3) execution
- [ ] Sub-task 2: Re-initialization revert
- [ ] Sub-task 3: UPGRADE_TIMESTAMP fee declaration guard

---

### [TEST-26] Zero-validator cluster operations
- **Type:** Unit Test Completeness
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add tests for clusters with 0 validators.

**Acceptance Criteria:**
- [ ] Test: Deposit into cluster with 0 validators → verify no fees accrue
- [ ] Test: Withdraw from cluster with 0 validators → verify full balance withdrawable
- [ ] Test: EB update on cluster with 0 validators → verify no vUnits change

**Agent Instructions:**
1. Read `test/unit/SSVClusters/deposit.test.ts` and `test/unit/SSVClusters/withdraw.test.ts`.
2. Create a cluster, remove all validators, then perform operations.
3. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Deposit with 0 validators
- [ ] Sub-task 2: Withdrawal with 0 validators
- [ ] Sub-task 3: EB update with 0 validators

---

### [TEST-27] Operator at max validator limit
- **Type:** Unit Test Completeness
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Test `VALIDATORS_PER_OPERATOR_LIMIT` (3000) boundary.

**Acceptance Criteria:**
- [ ] Test: Register validator pushing operator to limit+1 → verify revert
- [ ] Test: Remove validator then re-register at limit → verify succeeds

**Agent Instructions:**
1. Read `contracts/libraries/OperatorLib.sol` for the limit check.
2. This requires registering many validators. May need to use bulk registration.
3. Run `npm run test:unit`.

#### Sub-items:
- [ ] Sub-task 1: Exceed operator validator limit — revert
- [ ] Sub-task 2: Re-register at limit after removal

---

## Integration / E2E Tests

### [ITEST-1] `commitRoot` → `updateClusterBalance` E2E flow
- **Type:** Integration / E2E Tests
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Create an end-to-end test connecting oracle voting → root commitment → cluster EB update → fee recalculation.

**Context:**
Unit tests for `commitRoot` and `updateClusterBalance` exist separately but no test connects the full flow. This is the core oracle→cluster pipeline.

**Acceptance Criteria:**
- [ ] Test: 3 oracles propose same root → root committed → cluster calls `updateClusterBalance` with proof from committed root → verify fees recalculated with new EB
- [ ] Test: Multiple clusters update EB from same root → verify independent accounting

**Agent Instructions:**
1. Read `test/unit/SSVDAO/commitRoot.test.ts` and `test/unit/SSVClusters/updateClusterBalance.test.ts`.
2. Read `test/integration/SSVNetwork.test.ts` for integration test patterns.
3. Create a new integration test file or add to existing.
4. Build the full flow: deploy, create cluster, stake SSV for oracle weight, commit oracle root with Merkle tree, then call `updateClusterBalance` with proof from the committed root.
5. Verify the cluster's EB is updated and fee calculations reflect the new EB.
6. Run `npm run test:integration`.

#### Sub-items:
- [ ] Sub-task 1: Full oracle → cluster EB update flow
- [ ] Sub-task 2: Multiple clusters from same root

---

### [ITEST-2] Migration with multiple EB updates E2E
- **Type:** Integration / E2E Tests
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Test migration of a cluster that has had multiple EB updates, verifying the latest snapshot is used.

**Context:**
Migration with EB snapshot is tested but edge cases with multiple prior EB updates are not.

**Acceptance Criteria:**
- [ ] Test: Migrate cluster that has had multiple EB updates → verify latest snapshot used
- [ ] Test: Migrate cluster where EB was set and then validators were added → verify vUnits calculated correctly

**Agent Instructions:**
1. Read `test/unit/SSVClusters/migrateClusterToETH.test.ts`.
2. Create a cluster, update EB multiple times via `updateClusterBalance`, then migrate to ETH.
3. Verify the migrated cluster uses the latest EB values.
4. Run `npm run test:integration`.

#### Sub-items:
- [ ] Sub-task 1: Migration after multiple EB updates
- [ ] Sub-task 2: Migration after EB set + validators added

---

## Deployment & Scripts

### [DEPLOY-1] Fix `deploy-all.ts` broken signature and constructor args
- **Type:** Deployment & Scripts
- **Priority:** P0
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Fix `scripts/deploy-all.ts` so that fresh deployments work. Currently has wrong `initializeSSVStaking` signature and missing constructor args for 3 modules.

**Context:**
`scripts/deploy-all.ts:102-110`: Uses `"initializeSSVStaking(address,uint64)"` with `[cssvTokenAddr, cooldown]`. Actual contract signature is `initializeSSVStaking(uint64,uint32[4])` with params `(cooldownDuration, defaultOracleIds)`. Also, lines 49-53: `SSVDAO`, `SSVViews`, `SSVStaking` all require `_cssv` address as constructor arg but are deployed without args.

**Acceptance Criteria:**
- [ ] `initializeSSVStaking` signature changed to `"initializeSSVStaking(uint64,uint32[4])"`
- [ ] Params changed to `[cooldown, defaultOracleIds]` where `defaultOracleIds = [1,2,3,4]`
- [ ] `CSSVToken` deployed before modules that need its address
- [ ] `SSVDAO`, `SSVViews`, `SSVStaking` deployed with `cssvTokenAddr` as constructor arg
- [ ] Script can run successfully against a local Hardhat node

**Agent Instructions:**
1. Read `scripts/deploy-all.ts` fully.
2. Read `scripts/upgrade-fork.ts` (lines 412-435) as the reference for correct deployment — it already has the right signature and constructor args.
3. Fix the three issues:
   a. Change the `initializeSSVStaking` call signature and parameters
   b. Deploy `CSSVToken` early enough to get its address
   c. Pass `cssvTokenAddr` as constructor arg to `SSVDAO`, `SSVViews`, `SSVStaking`
4. Match the pattern in `upgrade-fork.ts` but adapted for fresh deployment.
5. Test by running `npx hardhat run scripts/deploy-all.ts --network hardhat`.

#### Sub-items:
- [ ] Sub-task 1: Fix `initializeSSVStaking` call signature and params
- [ ] Sub-task 2: Fix constructor args for SSVDAO, SSVViews, SSVStaking
- [ ] Sub-task 3: Reorder CSSVToken deployment before modules
- [ ] Sub-task 4: Verify script runs against local Hardhat

---

### [DEPLOY-2] Verify `liquidationThresholdPeriod` config vs spec mismatch
- **Type:** Deployment & Scripts
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Resolve the mismatch between `liquidationThresholdPeriod` in `hoodi-fork.config.json` (35,800) and the DIP-X spec (50,190 blocks).

**Context:**
`deployments/hoodi-fork.config.json` sets `liquidationThresholdPeriod: 35800` but the DIP-X spec proposes 50,190 blocks (~7 days). This is a significant difference — 35,800 blocks is ~5 days. If this is intentional for the testnet, it should be documented. The mainnet config must use the correct value.

**Acceptance Criteria:**
- [ ] Decision documented: is 35,800 intentional for Hoodi testnet?
- [ ] Mainnet config (when created) uses 50,190 or the final DIP-X approved value
- [ ] Comment added to config explaining the discrepancy if intentional

**Agent Instructions:**
1. Read `deployments/hoodi-fork.config.json`.
2. Read `docs/SPEC.md` section 11 for the governance parameters.
3. If this is a testnet-specific value, add a comment. If it's a bug, update to 50,190.
4. This is primarily a decision item — flag it for team review if uncertain.

#### Sub-items:
- [ ] Sub-task 1: Verify intended value with team
- [ ] Sub-task 2: Update config or add documentation

---

### [DEPLOY-3] Verify `ethNetworkFee` rounding in config
- **Type:** Deployment & Scripts
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)
- **DIP-X Review Source:** ETH Payments review finding ETH-10

**Requirement:**
Verify whether the rounding of `ethNetworkFee` (config: 3,550,900,000 vs spec: 3,550,929,823) is acceptable or needs correction.

**Context:**
The config rounds to 3,550,900,000 while the spec says 3,550,929,823. The difference is ~30k wei, which over millions of blocks could accumulate to meaningful amounts.

**Additional context from DIP-X review (ETH-10):** The DIP-specified value `3,550,929,823 % 100,000 = 29,823` — it is NOT divisible by `ETH_DEDUCTED_DIGITS (100,000)`, so the exact DIP value cannot be stored in `PackedETH`. The closest packable values are `3,550,900,000` (rounding down) or `3,551,000,000` (rounding up). The DIP should be updated to note this packing constraint. The initial value is set at deployment/upgrade time (not hardcoded), so the contract itself has no validation that a specific initial value is used — this is a governance responsibility.

**Acceptance Criteria:**
- [ ] Decision documented: acceptable rounding or needs exact value
- [ ] If exact value needed, verify it passes `MaxPrecisionExceeded` check (divisible by ETH_DEDUCTED_DIGITS = 100,000)

**Agent Instructions:**
1. Check if 3,550,929,823 is divisible by 100,000 (ETH_DEDUCTED_DIGITS). It's not (remainder = 29,823), so it may need rounding.
2. Verify what the contract's precision check allows.
3. The closest valid value is either 3,550,900,000 or 3,551,000,000.
4. Document the decision.

#### Sub-items:
- [ ] Sub-task 1: Verify precision constraints
- [ ] Sub-task 2: Document accepted rounding

---

### [DEPLOY-4] Remove unused error declarations
- **Type:** Deployment & Scripts
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Remove unused error declarations `NotAuthorized()` and `InvalidContractAddress()` from `ISSVNetworkCore.sol`.

**Context:**
`contracts/interfaces/ISSVNetworkCore.sol`: `NotAuthorized()` (line 185) and `InvalidContractAddress()` (line 235) are declared but never used (never reverted with). Dead code.

**Acceptance Criteria:**
- [ ] Both unused errors removed from `ISSVNetworkCore.sol`
- [ ] No references to these errors exist in any contract
- [ ] Compilation succeeds

**Agent Instructions:**
1. Grep for `NotAuthorized` and `InvalidContractAddress` across all `.sol` files to confirm they're unused.
2. Remove the declarations from `contracts/interfaces/ISSVNetworkCore.sol`.
3. Run `npx hardhat compile`.

#### Sub-items:
- [ ] Sub-task 1: Verify errors are unused
- [ ] Sub-task 2: Remove declarations
- [ ] Sub-task 3: Verify compilation

---

### [DEPLOY-5] Document `operatorMinFee` governance parameter in DIP-X
- **Type:** Deployment & Scripts
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)
- **DIP-X Review Source:** ETH Payments review finding ETH-20

**Requirement:**
The DIP-X governance table leaves the `operatorMinFee` update function and initial value cells blank/empty. The implementation provides `updateMinimumOperatorEthFee(uint256 minFee)` as a fully-functional governance parameter (`SSVDAO.sol:147-150`), used for validation during operator registration and fee changes. The DIP should document this parameter completely.

**Context:**
`SSVDAO.sol:147`: `function updateMinimumOperatorEthFee(uint256 minFee)`. Used in: `SSVOperators.registerOperator()` line 38, `declareOperatorFee()` line 106, `reduceOperatorFee()` line 187. The parameter exists and is enforced but the DIP specification does not document its update function or initial value.

**Acceptance Criteria:**
- [ ] DIP-X governance table updated with: update function = `updateMinimumOperatorEthFee(uint256 minFee)`, initial value = (team to specify)
- [ ] Deployment config (`hoodi-fork.config.json`) verified to include a reasonable initial value

**Agent Instructions:**
1. Read `contracts/modules/SSVDAO.sol`, focus on `updateMinimumOperatorEthFee` (line 147).
2. Read `deployments/hoodi-fork.config.json` for current config value.
3. Update the DIP-X governance table to document the update function and initial value.
4. This is a documentation task — no code change needed.

#### Sub-items:
- [ ] Sub-task 1: Document `operatorMinFee` in DIP-X governance table
- [ ] Sub-task 2: Verify deployment config includes the parameter

---

### [DEPLOY-6] DIP-X unstaking description doesn't match implementation
- **Type:** Deployment & Scripts
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)
- **DIP-X Review Source:** SSV Staking review finding DIP-7

**Requirement:**
The DIP-X describes unstaking as "lock cSSV → wait → burn cSSV + return SSV", but the implementation does "burn cSSV + create withdrawal request → wait → return SSV". The economic effect is identical but the mechanism and user experience differ (users see cSSV balance decrease immediately on `requestUnstake`, not at `withdrawUnlocked`). The DIP should be updated to match the implementation.

**Context:**
`SSVStaking.sol:66-94` (`requestUnstake`): Burns cSSV immediately at line 91 via `ICSSVToken(CSSV_ADDRESS).burn(msg.sender, amount)`, then creates `UnstakeRequest{amount, unlockTime}` at line 89. The DIP says the request "locks the specified amount of cSSV" and that "The locked cSSV is burned" at finalization. The implementation is arguably better (simpler, no locked-cSSV tracking mechanism needed).

**Acceptance Criteria:**
- [ ] DIP-X unstaking section updated to describe the actual burn-first mechanism
- [ ] User-facing documentation (SDK docs, webapp) reflects the correct behavior
- [ ] No code change needed — the implementation is correct and simpler

**Agent Instructions:**
1. This is purely a documentation task.
2. Read `contracts/modules/SSVStaking.sol`, focus on `requestUnstake` (line 66) and `withdrawUnlocked` (line 99) to confirm the actual flow.
3. Update the DIP-X section on unstaking to describe:
   - Step 1: `requestUnstake(amount)` — burns cSSV immediately, creates withdrawal request with unlock time
   - Step 2: `withdrawUnlocked()` — after cooldown, returns SSV 1:1
4. Note that rewards stop accruing immediately because cSSV is burned (reducing the user's share of `totalSupply`).

#### Sub-items:
- [ ] Sub-task 1: Update DIP-X unstaking section
- [ ] Sub-task 2: Verify user-facing documentation

---

## Operational Readiness

### [OPS-1] Create mainnet deployment runbook
- **Type:** Operational Readiness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Create a step-by-step runbook for the v2.0.0 mainnet upgrade, including pre-flight checks, deployment steps, post-deployment verification, and rollback triggers.

**Context:**
No mainnet deployment checklist exists. The upgrade involves UUPS proxy upgrades, new module deployments, CSSVToken deployment, initializer execution, and governance parameter setup. The existing `scripts/deployment.md` covers generic deployment but not the v2.0.0-specific flow.

**Acceptance Criteria:**
- [ ] Document includes pre-flight checks (contract sizes, gas estimates, parameter verification)
- [ ] Step-by-step deployment sequence matching `upgrade-fork.ts` flow
- [ ] Post-deployment verification checklist (all parameters set, quorumBps != 0, oracle addresses correct)
- [ ] Rollback triggers and procedure for each step
- [ ] Links to relevant scripts for each step

**Agent Instructions:**
1. Read `scripts/upgrade-fork.ts` (lines 400-600) for the deployment flow reference — this is the most complete script.
2. Read `scripts/staking-upgrade.ts` for the simpler upgrade flow.
3. Read `scripts/deployment.md` for existing documentation patterns.
4. Create `docs/MAINNET-UPGRADE-RUNBOOK.md` with:
   - Pre-flight checklist
   - Deployment sequence (numbered steps with exact commands)
   - Post-deployment verification queries (using SSVViews)
   - Rollback procedures
   - Emergency contacts / escalation paths (placeholder)
5. Ensure the runbook explicitly states: "Call `setQuorumBps(7500)` immediately after upgrade" (see SEC-2).

#### Sub-items:
- [ ] Sub-task 1: Write pre-flight checks section
- [ ] Sub-task 2: Write deployment sequence
- [ ] Sub-task 3: Write post-deployment verification
- [ ] Sub-task 4: Write rollback procedures

---

### [OPS-2] Create emergency rollback procedure
- **Type:** Operational Readiness
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Document how to downgrade/rollback modules if critical issues are found post-deployment.

**Context:**
The UUPS proxy pattern allows module replacement. If a bug is found in a deployed module, the DAO owner can replace it with a patched version. But there's no documented procedure for this.

**Acceptance Criteria:**
- [ ] Document covers: how to replace a module with a patched version
- [ ] Covers: how to pause operations if needed (does a pause mechanism exist?)
- [ ] Covers: which state is recoverable and which is not
- [ ] Covers: communication plan for operators/users

**Agent Instructions:**
1. Read `contracts/SSVNetwork.sol` to understand `updateModule` function.
2. Read `scripts/update-module.ts` for the module replacement script.
3. Document the rollback procedure for each module type.
4. Identify what state changes are irreversible (e.g., token transfers, oracle commits).

#### Sub-items:
- [ ] Sub-task 1: Document module replacement procedure
- [ ] Sub-task 2: Document irrecoverable state changes
- [ ] Sub-task 3: Document communication plan template

---

### [OPS-3] Update `.env.example` for v2.0.0
- **Type:** Operational Readiness
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Update `.env.example` with v2.0.0 parameter names and values.

**Context:**
`.env.example` still contains v1 values: `MINIMUM_BLOCKS_BEFORE_LIQUIDATION=100800`, `MINIMUM_LIQUIDATION_COLLATERAL=200000000` (SSV-denominated), `OPERATOR_MAX_FEE_INCREASE=3`, `QUORUM_BPS=6700`. Missing all ETH-specific params.

**Acceptance Criteria:**
- [ ] All v1-only params removed or updated
- [ ] ETH-specific params added: `NETWORK_FEE_ETH`, `MIN_OPERATOR_ETH_FEE`, `MAX_OPERATOR_ETH_FEE`, `DEFAULT_OPERATOR_ETH_FEE`
- [ ] Values match DIP-X spec defaults
- [ ] Comments explain each parameter

**Agent Instructions:**
1. Read `.env.example`.
2. Read `deployments/hoodi-fork.config.json` for reference values.
3. Update the file with v2.0.0 parameters and inline comments.

#### Sub-items:
- [ ] Sub-task 1: Update existing params
- [ ] Sub-task 2: Add ETH-specific params
- [ ] Sub-task 3: Add inline comments

---

## Echidna Invariant Suite

**Current state:** 73 invariants across 9 test contracts (see `test/echidna/README.md` for full master list).
**Source:** Evaluated from `ssv-review/planning/SSVNetwork — Enrich Invariant Suite.md` — cross-referenced all 50 proposed invariants against existing 73, identified 30 new + 5 strengthening items.

### [FUZZ-1] Strengthen 5 partially-covered echidna invariants
- **Type:** Echidna Invariant Suite
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Upgrade 5 existing invariants from partial to full coverage:
1. `echidna_network_fee_matches_expected` → add explicit monotonicity tracking (ref A8)
2. `echidna_cssv_supply_matches_users` → add per-operation mint/burn delta assertions (ref A11)
3. `echidna_user_index_leq_acc` → strengthen to exact equality after `_settle` (ref A14)
4. `echidna_pool_matches_dao_balance` → add per-claim delta tracking (ref A16)
5. `echidna_accrued_within_pool` → add cumulative payout tracking (ref C2)

**Acceptance Criteria:**
- [ ] Each upgraded invariant catches the class of bugs described in the ref
- [ ] All echidna tests still pass after modifications
- [ ] Harness bookkeeping added (prev-value tracking, per-claim deltas, cumulative payout counter)

---

### [FUZZ-2] Add 16 high-priority new echidna invariants
- **Type:** Echidna Invariant Suite
- **Priority:** P1
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add 16 new invariants covering critical gaps. Full list with descriptions in `test/echidna/README.md` under "High Priority — New Invariants". Summary:

**Oracle / EB Governance (3):** Finalized weight cleared (A4), commitment weight ≤ supply (A5), finalization implies quorum (B1)

**DAO Accounting (2):** DAO earnings monotonicity (A9), DAO index block ≤ current (A10)

**Staking Rewards Precision (3):** cSSV transfer settles both (A15), claim payout precision (A17), no free rewards on transfer (C3)

**EB Snapshot Safety (2):** Snapshot block ≤ current (A18), snapshot root monotonic per cluster (A19)

**EB Update Correctness (3):** Update requires root (B3), frequency enforced (B4), staleness enforced (B5)

**Fee Settlement (2):** Fee index current after settle (B9), fee uses old vUnits on EB change (B11)

**Liquidation Completeness (2):** Liquidation clears EB snapshot (B13), liquidation pays exact balance (B14)

**Acceptance Criteria:**
- [ ] All 16 invariants implemented and passing
- [ ] Harness features added: prev-value tracking, touched-key arrays, 2-actor reward tracking
- [ ] Each invariant documented in `test/echidna/README.md`

---

### [FUZZ-3] Add 8 medium-priority echidna invariants
- **Type:** Echidna Invariant Suite
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add 8 medium-priority invariants requiring more harness setup. Full list in `test/echidna/README.md` under "Medium Priority". Summary:

**EB Proof (3):** Merkle proof verified (B6), EB bounds enforced (B7), snapshot fields exact (B8)

**Operator Fee Gov (2):** Declare fee from zero reverts (B17), execute rejects legacy declarations (B19)

**Legacy SSV (1):** SSV liquidation resets and pays (B15)

**DAO Formula (1):** DAO earnings matches formula exactly (C4)

**Acceptance Criteria:**
- [ ] All 8 invariants implemented and passing
- [ ] Merkle tree builder added to harness for valid proof happy paths
- [ ] Each invariant documented in `test/echidna/README.md`

---

### [FUZZ-4] Add 6 lower-priority echidna invariants (heavy harness)
- **Type:** Echidna Invariant Suite
- **Priority:** P2
- **Status:** Open
- **Owner:** (unassigned)
- **Timeline:** (empty)
- **Github Link:** (empty)

**Requirement:**
Add 6 lower-priority invariants requiring significant harness work. Full list in `test/echidna/README.md` under "Lower Priority". Summary:

**vUnit Aggregation (2):** DAO vUnits = sum of clusters (C5), operator vUnits matches clusters (C6)

**Migration (1):** Migration one-way and returns SSV (C7)

**Overflow/Extreme (3):** ETH accrual no overflow (X4), SSV accrual no overflow (X5), intermediate mul no overflow (X6), pack reverts on overflow (X7)

**Acceptance Criteria:**
- [ ] All invariants implemented and passing
- [ ] Delta-block simulator added for overflow testing
- [ ] Max-parameter configurator added
- [ ] Per-cluster EB tracking arrays added
- [ ] Each invariant documented in `test/echidna/README.md`

---

## Changes from DIP-X Review

**Date:** 2026-02-17
**Sources:** `ssv-review/planning/verified/dip-review-eth-payments.md`, `ssv-review/planning/verified/dip-review-effective-balance.md`, `ssv-review/planning/verified/dip-review-ssv-staking.md`

### New Items Added (6)

| ID | Title | Source Finding | Rationale |
|----|-------|---------------|-----------|
| BUG-7 | `DEFAULT_OPERATOR_ETH_FEE` value deviates from DIP-X spec | ETH-7, ETH-14 | Implementation uses 1,770,000,000 wei but closest packable value to DIP spec is 1,775,500,000 wei (~0.31% deviation) |
| BUG-8 | Cooldown duration uses `block.timestamp` but DIP specifies blocks | DIP-8 | HIGH risk: if initial value set as 50120 (blocks), actual cooldown would be ~13.9 hours instead of 7 days |
| SEC-9 | `operatorMaxFee` function signature differs from DIP-X spec | ETH-13 | DIP says `uint64`, implementation uses `uint256`; cosmetic but should be aligned |
| SEC-10 | cSSV token lacks governance/voting extensions | DIP-10 | DIP claims cSSV retains governance power, but `CSSVToken` has no `ERC20Votes`; depends on off-chain Snapshot config |
| DEPLOY-5 | Document `operatorMinFee` governance parameter in DIP-X | ETH-20 | DIP leaves update function and initial value blank; implementation has `updateMinimumOperatorEthFee(uint256)` |
| DEPLOY-6 | DIP-X unstaking description doesn't match implementation | DIP-7 | DIP says "lock cSSV → burn later"; code does "burn immediately → return SSV later"; same economics, different UX |

### Existing Items Updated (2)

| ID | Change | Source Finding |
|----|--------|---------------|
| BUG-6 | Added DIP-X review source tag; added context about `_syncFees` behavior when DAO earnings decrease (`current <= previous` edge case) | DIP-18, DIP-19 |
| DEPLOY-3 | Added DIP-X review source tag; added context explaining why DIP value is not packable (`3,550,929,823 % 100,000 = 29,823`) and noting this is a governance responsibility | ETH-10 |

### DIP-X Findings Already Covered by Existing Items (4)

| DIP Finding | Already Covered By | Notes |
|---|---|---|
| EB-OBS-1 (auto-liquidation operator decrement condition) | BUG-5 | Same issue: `_liquidateAfterEBUpdateIfNeeded` condition `op.ethSnapshot.block != 0 && op.snapshot.block != 0` is too strict vs `updateClusterOperators` which only checks `ethSnapshot.block != 0` |
| ETH-19 (migrateClusterToETH lacks nonReentrant) | SEC-6 | Exact same recommendation |
| DIP-18 (zero totalStaked fee loss) | BUG-6 | Exact same issue and recommended fix |
| DIP-23/DIP-24 (no bounds on cooldown/quorum) | SEC-4, SEC-1 | Already covered with same recommendations |

### DIP-X Findings Not Requiring Action (informational only)

| DIP Finding | Verdict | Reason No Action Needed |
|---|---|---|
| ETH-1 through ETH-6 | MATCH | Implementation matches DIP specification |
| ETH-8, ETH-9, ETH-11, ETH-12 | MATCH | Implementation matches DIP specification |
| ETH-15, ETH-16, ETH-21, ETH-22 | MATCH | Implementation matches DIP specification |
| ETH-17, ETH-18, ETH-23 | EXTRA | Implementation adds beneficial features beyond DIP |
| ETH-24 | MATCH | Liquidation check correctly uses vUnit model |
| ETH-25 (no SSV cluster withdrawal) | GAP (minor) | More restrictive than DIP but aligns with migration intent; users can migrate or self-liquidate to recover SSV |
| EB-01 through EB-25 (excl. OBS-1) | MATCH | All core EB accounting claims implemented correctly |
| DIP-1, DIP-2, DIP-4–6 | MATCH | Staking core mechanics implemented correctly |
| DIP-3 (auto-delegation) | PARTIAL | By-design for initial phase; future per-user delegation requires upgrade |
| DIP-9 (min staking amount) | GAP | Implementation adds reasonable dust-prevention constraint not in DIP |
| DIP-11–13, DIP-15–17 | MATCH | Oracle and reward mechanics correct |
| DIP-14 (uint128 overflow) | PARTIAL | Theoretically possible but practically impossible for realistic scenarios |
| DIP-20 (flash-loan prevention) | MATCH | Not vulnerable in current permissioned oracle model |
| DIP-25–28 | MATCH | Revenue source, views, ordering, minting ratio all correct |
