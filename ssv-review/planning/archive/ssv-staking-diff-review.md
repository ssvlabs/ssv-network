# SSV Staking Diff Review — Consolidated Report

**Branch diff:** `main..ssv-staking` | **Commit:** `e362e4d`
**Date:** 2026-02-11
**Scope:** Full diff — contracts, libraries, interfaces, tests/echidna, scripts/deployment
**Method:** 5 parallel diff-review workers (Opus 4.6) + manual verification of all HIGH/MEDIUM findings against source code
**Builds on:** [ssv-staking-final-audit-v3.md](./ssv-staking-final-audit-v3.md) (3 audit rounds)

---

## Executive Summary

Five workers reviewed the complete diff between `main` and `ssv-staking`. After deduplication, false-positive filtering, and manual code verification, the consolidated findings are:

| Category | HIGH | MEDIUM | LOW | INFO |
|----------|------|--------|-----|------|
| Contract (new) | 1 | 6 | 14 | 10 |
| Contract (confirmed from v3) | 0 | 4 | 3 | 0 |
| Tests & Echidna | 3 | 8 | 5 | 0 |
| Scripts & Deployment | 0 | 1 | 2 | 3 |
| **Total** | **4** | **19** | **24** | **13** |
| False positives filtered | 3 | 1 | 0 | 0 |
| Acknowledged by design | — | — | — | 4 |

**Top finding:** DR-H1 — validators can become permanently stuck in liquidated clusters with EB tracking due to a double deviation cleanup between `_executeLiquidation` and `_bulkRemoveValidator`.

---

## CONTRACT FINDINGS — NEW

### HIGH

#### DR-H1: Double Deviation Cleanup Blocks Validator Removal from Liquidated Clusters

**Files:** `SSVClusters.sol:575-594` (`_executeLiquidation`) and `SSVValidators.sol:218-236` (`_bulkRemoveValidator`)
**Verified:** Manually confirmed as REAL BUG

**Root cause:** When a cluster with EB deviation is liquidated:
1. `_executeLiquidation` subtracts the deviation from `operatorEthVUnits[opId]` and `daoTotalEthVUnits` (lines 575-594)
2. But `ebSnapshot.vUnits` is **NOT zeroed** during liquidation
3. When the user later removes validators from the inactive cluster, `_bulkRemoveValidator` sees `ebSnapshot.vUnits > 0` and tries to clean up deviation **again** (lines 218-236)
4. The subtraction `operatorEthVUnits[opId] -= remainingVUnits` underflows because the deviation was already removed in step 1
5. **Revert** — validators are permanently stuck

**Preconditions:** Only affects ETH clusters (post-migration) that have received an oracle EB update with deviation from baseline. SSV-only clusters are unaffected (no EB tracking). Clusters where all validators have exactly 32 ETH EB (no deviation) are also unaffected. Post-Pectra with variable effective balances, deviation will be the norm.

**Impact:** Validators in affected liquidated clusters cannot be removed. The user can work around this by calling `reactivate` first (depositing enough ETH), then removing validators through the active path. However, whether the reactivation path correctly handles the stale `ebSnapshot.vUnits` (deviation cleaned at operator level but not at cluster level) needs verification — it may cause fee miscalculation.

**Concrete example:**

```
Setup: ETH cluster, 4 operators (op1-op4), 2 validators
VUNITS_PRECISION = 10,000
Baseline = 2 validators × 10,000 = 20,000
```

**Step 1 — Oracle EB update** (validators have 34 ETH each = 68 ETH total):
```
ebSnapshot.vUnits            = 21,250  (ebToVUnits(68))
deviation                    = 21,250 - 20,000 = 1,250
operatorEthVUnits[op1..op4] += 1,250 each
daoTotalEthVUnits           += 1,250
```

**Step 2 — Cluster gets liquidated** (`_executeLiquidation`, line 554):
```
vUnitsCluster  = ebSnapshot.vUnits     = 21,250
baselineVUnits = 2 × 10,000           = 20,000
deviation      = 21,250 - 20,000      = 1,250
moreThanBaseline = true

sp.daoTotalEthVUnits -= 1,250          ← deviation cleaned ✓
operatorEthVUnits[op1..op4] -= 1,250   ← deviation cleaned ✓ (all now = 0)

ebSnapshot.vUnits = still 21,250       ← NEVER ZEROED (the bug)
cluster.active = false
```

**Step 3 — User removes both validators** (`_bulkRemoveValidator`, line 194):
```
cluster.active == false → skip operator updates (line 194)
cluster.validatorCount = 2 - 2 = 0     (line 209)

EB cleanup (line 218):
  ebSnapshot.vUnits > 0?  → YES (21,250)
  deltaClusterVUnits = 2 × 10,000 = 20,000
  ebSnapshot.vUnits -= 20,000 → 1,250

  cluster.validatorCount == 0?  → YES
  remainingVUnits = 1,250              ← this is the deviation

  DOUBLE CLEANUP ATTEMPT:
  operatorEthVUnits[op1] -= 1,250      ← 0 - 1,250 → UNDERFLOW REVERT 💥
```

**Result:** Transaction reverts. The 2 validators are permanently stuck.

**Note:** Removing validators one at a time works until the last one — the deviation cleanup only triggers when `validatorCount` reaches 0. So the user can remove all but the last validator, but the final one is stuck.

**Fix:** Either zero `ebSnapshot.vUnits` in `_executeLiquidation`, or skip EB cleanup in `_bulkRemoveValidator` when the cluster is inactive.

---

### MEDIUM

#### DR-M1: Missing `nonReentrant` on `deposit`, `reactivate`, `migrateClusterToETH`

**File:** `SSVClusters.sol`

Three `payable` functions lack `nonReentrant` while similar functions (`liquidate`, `withdraw`, `updateClusterBalance`) have it. `migrateClusterToETH` is most concerning — it calls `CoreLib.transferTokenBalance` (ERC-20 transfer to `msg.sender`) which could allow re-entry if the SSV token has callbacks.

**Fix:** Add `nonReentrant` to all three.

#### DR-M2: `reactivate` Does Not Re-verify Operator Existence

**File:** `SSVClusters.sol:151-158`

Clusters can be reactivated even if operators have been removed since liquidation. The cluster burns less than expected (removed operator contributes zero fee) while `ethDaoValidatorCount` is still incremented.

**Fix:** Verify all operators are active during reactivation, or prevent reactivation when any operator has been removed.

#### DR-M3: `_syncFees` Drops Rewards on DAO Balance Regression

**File:** `SSVStaking.sol:187-189`

When `ethDaoBalance` decreases (e.g., from external withdrawal), `stakingEthPoolBalance = current` advances past previously distributed fees. Future fee increments measured from this lower baseline could double-count.

**Fix:** Ensure `ethDaoBalance` never decreases below `stakingEthPoolBalance`, or track a separate allocation counter.

#### DR-M4: Missing ETH DAO Earnings Withdrawal Function

**File:** `SSVDAO.sol`

`withdrawNetworkSSVEarnings` exists for SSV, but no `withdrawNetworkETHEarnings`. ETH DAO earnings not allocated to staking rewards could become permanently locked.

**Fix:** Add withdrawal function or confirm staking module is the exclusive ETH consumer.

#### DR-M5: `replaceOracle` Does Not Invalidate Pending Votes

**File:** `SSVDAO.sol:205-229`

When an oracle is replaced, `hasVoted[commitmentKey][oracleId]` entries from the old oracle persist. If replacement was due to compromise, the old oracle's votes on pending commitments remain counted.

**Fix:** Add epoch/nonce to invalidate pending votes on replacement.

#### DR-M6: `getBurnRateSSV` Truncates uint128 to uint64

**File:** `SSVViews.sol:357`

Burn rate is computed as `uint128` but cast to `uint64` via `PackedSSV.wrap(uint64(burnRate))`. For large clusters, this silently truncates, returning incorrect view data.

**Fix:** Add overflow check or return the raw uint256 value.

---

### LOW

#### DR-L1: `uint64(delta)` Truncation in Operator ETH Earnings

**File:** `OperatorLib.sol:68,95`

The `uint128` delta is cast to `uint64`. With 3,000 validators at max EB (2048 ETH) and default fee, overflow at ~2.1 years without snapshot update. At 5x fee: ~5.5 months.

#### DR-L2: `uint64` Truncation in `networkTotalEarnings`

**File:** `ProtocolLib.sol:68-72`

Same pattern. Safe in practice (~62 years to overflow with max parameters).

#### DR-L3: `requestUnstake` Truncates uint256 to uint192 Without Check

**File:** `SSVStaking.sol:89`

Explicit casts don't revert in Solidity 0.8.x. `type(uint192).max ~ 6.27 x 10^57` far exceeds any realistic token supply, so likelihood is negligible.

#### DR-L4: Missing `override` Keywords on Staking/DAO Functions

**Files:** `SSVNetwork.sol:202-226, 363`, `SSVDAO.sol:110,130`

Staking functions and `updateLiquidationThresholdPeriodSSV`/`updateMinimumLiquidationCollateralSSV` lack `override`. Function selector matching still works, but inconsistent with rest of contract.

#### DR-L5: `Delegation` Struct and `DelegationUpdated` Event Are Dead Code

**File:** `SSVStorageStaking.sol:16-21`, `ISSVStaking.sol:98-104`

Defined but never used in production. Increases bytecode size.

#### DR-L6: `getOracleWeight` Returns Equal Weight for All Oracle IDs

**File:** `SSVViews.sol:621`

Always returns `totalStaked / MAX_DELEGATION_SLOTS` regardless of oracleId validity. Misleading view function.

#### DR-L7: ABI/Selector Breaking Changes in Error Types

**File:** `ISSVNetworkCore.sol`

`ClusterDoesNotExists` renamed to `ClusterDoesNotExist` (selector change), `ExceedValidatorLimit`/`ExceedValidatorLimitWithData` selectors swapped, `CallerNotOwnerWithData` selector changed. Off-chain code needs updating.

#### DR-L8: `reduceOperatorFee` Memory Write-Back Race

**File:** `SSVOperators.sol:189-196`

Reads operator to memory, calls `updateSnapshot` (ETH only), modifies `ethFee`, writes entire struct back — could overwrite concurrent SSV snapshot changes in same block.

#### DR-L9: `removeOperator` Does Not Delete `operatorFeeChangeRequests`

**File:** `SSVOperators.sol:73-94`

Pending fee changes survive removal. Not exploitable (`checkOwner` blocks execution) but wastes storage.

#### DR-L10: Same `OperatorWithdrawn` Event for ETH and SSV Withdrawals

**File:** `SSVOperators.sol`

Off-chain systems cannot distinguish withdrawal type.

#### DR-L11: `commitRoot` Accepts Zero Merkle Root

**File:** `SSVDAO.sol:155`

No validation that `merkleRoot != bytes32(0)`.

#### DR-L12: Governance Setters Lack Bounds Validation

**File:** `SSVDAO.sol`

`updateDeclareOperatorFeePeriod`, `updateExecuteOperatorFeePeriod` can be 0. `setUnstakeCooldownDuration` can be 0 (enables flash-stake reward sniping) or extremely high.

#### DR-L13: `_applyClusterFeeUpdates` Silently Floors Balance to Zero

**File:** `SSVClusters.sol:483-487`

When fees exceed balance, operators lose owed fees silently.

#### DR-L14: `OperatorFeeChangeRequest.fee` Loses PackedETH Type Safety

**File:** `ISSVNetworkCore.sol:49`

Round-trip through raw `uint64` drops type information.

---

### INFORMATIONAL

- **I-1:** `MINIMAL_LIQUIDATION_THRESHOLD` reduced from 100,800 to 21,480 (~14 days to ~3 days) — intentional parameter change
- **I-2:** `hasVoted` storage never cleaned after root commitment — intentional safety measure
- **I-3:** `_resetOperatorState` returns unused `Operator memory` — wasted gas
- **I-4:** Anyone can trigger auto-liquidation via `updateClusterBalance` with valid Merkle proof — by design (MEV opportunity)
- **I-5:** `onCSSVTransfer` settles rewards for `address(0)` during mint/burn — wastes gas
- **I-6:** Fees accrued while no cSSV staked are permanently lost — design decision, should be documented
- **I-7:** `SSVValidators._bulkRegisterValidator` and `_bulkRemoveValidator` are `virtual` — allows derived contracts to override
- **I-8:** `Ownable2Step` upgrade from `Ownable` — security improvement, correct initialization
- **I-9:** Storage layout is upgrade-compatible — all changes append-only, verified
- **I-10:** `PackedSSVLib` missing `gte`/`lte` operators vs `PackedETHLib` — asymmetric API

---

## CONTRACT FINDINGS — CONFIRMED FROM V3

These findings from the v3 audit report were verified as still present in the diff:

| ID | Severity | Description | v3 ID |
|----|----------|-------------|-------|
| **M-1** | MEDIUM | `ensureETHDefaults` resurrects removed operators in existing clusters | v3 M-1 |
| **M-2** | MEDIUM | No timelock on governance parameters | v3 M-2 |
| **M-3** | MEDIUM | `totalStaked` changes between oracle votes | v3 M-3 |
| **M-4** | MEDIUM | `rescueERC20` lacks direct access control (proxy-protected) | v3 M-4 |
| **L-1** | LOW | Guard inconsistency between liquidation paths (single vs double AND) | v3 L-1 |
| **L-2** | LOW | `ensureETHDefaults` on storage overwritten by memory write-back (coincidentally correct) | v3 L-2 |
| **L-3** | LOW | `operatorEthVUnits` not cleared on operator removal | v3 L-3 |

---

## TEST & ECHIDNA FINDINGS

### HIGH (3)

#### TE-H1: Echidna Accounting Invariants Have Critical Bugs

**File:** `SSVAccountingEchidna.sol`

Three bugs in Echidna property tests render critical invariants useless:

| Bug | Line | Issue | Effect |
|-----|------|-------|--------|
| `echidna_eth_conservation` | 531 | Uses `>=` instead of `==` | ETH creation from nothing undetectable |
| `echidna_ssv_conservation` / `echidna_ssv_solvency` | 535-545 | Byte-for-byte identical | SSV leakage undetectable |
| `_fastForward` | 817-820 | `.eq(PACKED_ETH_ZERO)` instead of `.neq()` | ETH DAO earnings never accumulated |

#### TE-H2: SSV Reentrancy Test Assertions Commented Out

**File:** `reentrancy.test.ts:101-107`

SSV reentrancy assertions are wrapped in `/* ... */`. The test passes regardless of whether reentrancy protection works.

#### TE-H3: `onCSSVTransfer` Critically Under-Tested

**Files:** `onCSSVTransfer.test.ts`, `MockCSSV.sol`

Only 2 test cases for a function called on every cSSV transfer. Self-transfer (double settlement), mint/burn paths, and sync interactions are all untested. MockCSSV omits the `onCSSVTransfer` callback entirely, so the mock path never exercises staking reward settlement.

---

### MEDIUM (8)

| ID | Finding | Location |
|----|---------|----------|
| TE-M1 | `echidna_oracle_weights_match_supply` documented in README but missing from code | SSVStakingEchidna.sol |
| TE-M2 | `echidna_accrued_within_pool` permanently disabled after any fee decrease | SSVStakingEchidna.sol:323 |
| TE-M3 | Echidna actions bypass production code paths (direct storage manipulation) | SSVAccountingEchidna.sol |
| TE-M4 | All operator fees zero in validator Echidna tests | SSVValidatorsEchidna.sol |
| TE-M5 | Missing reentrancy tests for `liquidateSSV`, `claimEthRewards`, `withdrawUnlocked` | Mocks directory |
| TE-M6 | Known test gaps still unaddressed: operator resurrection, removed op + auto-liquidation | Multiple |
| TE-M7 | No `migrateClusterToETH` integration test | Integration tests |
| TE-M8 | No end-to-end staking rewards verification test | Integration tests |

### LOW (5)

| ID | Finding | Location |
|----|---------|----------|
| TE-L1 | 5/9 CSSVToken Echidna properties trivially true | CSSVTokenEchidna.sol |
| TE-L2 | Encoding bugs in SSVNetworkUpgrade test contract | SSVNetworkUpgrade.sol |
| TE-L3 | No deployment guard on harness contracts | Harness contracts |
| TE-L4 | 200-block event scanning window in test helpers | test/common/helpers.ts |
| TE-L5 | Missing `await` on some `expect().to.emit()` assertions | Multiple test files |

---

## SCRIPTS & DEPLOYMENT FINDINGS

### MEDIUM (1)

#### SD-M1: `reinitializer(3)` Version Gap Needs Chain-Specific Verification

**File:** `contracts/upgrades/stage/hoodi/SSVNetworkSSVStakingUpgrade.sol:11`

Uses `reinitializer(3)` but only one prior `initializer` is visible. If no version 2 was deployed on target chain, this still works (OpenZeppelin allows jumping). **Requires confirmation that target deployment has gone through exactly 2 prior initializations.**

### LOW (2)

| ID | Finding | Location |
|----|---------|----------|
| SD-L1 | `staking-upgrade.ts` hardcodes `defaultOracles = [1,2,3,4]` | scripts/staking-upgrade.ts:21 |
| SD-L2 | `upgrade-fork.ts` base SSVNetwork upgrade is commented out | scripts/upgrade-fork.ts:338-339 |

### INFO (3)

- **SD-I1:** Major framework migration Hardhat v2 → v3, ESM, `viaIR: true` compiler flag
- **SD-I2:** `deploy-all.ts` is NOT production-ready (signature mismatches, missing constructor args) — only for local testing
- **SD-I3:** No secrets or hardcoded keys in any script files

---

## ACKNOWLEDGED BY DESIGN

The following were confirmed acceptable by the team:

| Finding | Reason |
|---------|--------|
| `setQuorumBps(0)` allows zero quorum | DAO governance decision — DAO is trusted to set values |
| Oracle multi-root voting (`hasVoted` keyed by root) | Intentional design for the oracle voting mechanism |
| `deploy-all.ts` signature mismatches | Script not used for production deployment |
| `quorumBps` not set in reinitializer | DAO manually sets post-upgrade |

---

## FALSE POSITIVES FILTERED

These findings were flagged by workers but confirmed as false positives during manual code verification:

### ~~H-4~~: `declareOperatorFee` Silently Assigns Default ETH Fee

**Worker claim:** Calling `declareOperatorFee` triggers `ensureETHDefaults` which immediately sets a default ETH fee, bypassing the declaration/approval process.

**Why false:** If `ethSnapshot.block == 0`, **no ETH cluster is using this operator**. All cluster entry points (`registerValidator`, `bulkRegisterValidator`) call `ensureETHDefaults` themselves before the operator participates in any cluster. The default fee assignment in `declareOperatorFee` has zero economic impact.

### ~~M-9~~: Underflow in EB Snapshot Subtraction During Validator Removal

**Worker claim:** `ebSnapshot.vUnits -= deltaClusterVUnits` could underflow if EB oracle reduced vUnits below baseline.

**Why false:** `_verifyEBLimits` (ClusterLib.sol:452-458) enforces `effectiveBalance >= cluster.validatorCount * DEFAULT_EB_PER_VALIDATOR` (32 ETH). This guarantees `ebSnapshot.vUnits >= validatorCount * VUNITS_PRECISION` at all times, preventing underflow during single-validator removal.

### ~~H-5~~: `onCSSVTransfer` Reentrancy via `claimEthRewards`

**Worker claim:** Attacker triggers cSSV transfer during `claimEthRewards` after ETH is sent but before state finalization.

**Why false:** `claimEthRewards` follows checks-effects-interactions pattern — `s.accrued[msg.sender] = 0` is set **before** the ETH transfer via `CoreLib.transferBalance`. There is no stale state to exploit. Additionally, the cSSV token's `_beforeTokenTransfer` skips the callback for staking contract calls (`msg.sender != ssvStaking`), so mint/burn from within staking functions don't trigger `onCSSVTransfer`.

### ~~H-1 (core)~~: Auto-Liquidation Skips `ethValidatorCount` for "ETH-Only" Operators

**Worker claim:** The double AND guard `(ethSnapshot.block != 0 && snapshot.block != 0)` could skip non-removed operators.

**Why false:** This IS the PR #412 fix, intentionally guarding against removed operators (both blocks are 0). The only scenario where `ethSnapshot.block != 0` but `snapshot.block == 0` is operator resurrection via M-1, which is already a separate finding.

---

## PRIORITY RANKING

### P0 — Fix Before Deployment

| Issue | Effort | Impact |
|-------|--------|--------|
| **DR-H1:** Double deviation cleanup → validators stuck | Medium | Permanent fund lock |
| **DR-M1:** Add `nonReentrant` to `deposit`/`reactivate`/`migrateClusterToETH` | Low | Reentrancy risk |
| **TE-H1:** Fix Echidna accounting invariants (3 bugs) | Low | Broken test safety net |
| **TE-H2:** Uncomment SSV reentrancy assertions | Trivial | False-positive test |

### P1 — High Priority

| Issue | Effort |
|-------|--------|
| **M-1 (v3):** Skip removed operators in existing-cluster registration | Medium |
| **DR-M2:** Verify operator existence during reactivation | Medium |
| **M-2 (v3):** Timelock on governance | Medium-High |
| **DR-M5:** Invalidate pending oracle votes on replacement | Medium |
| **TE-H3:** Add `onCSSVTransfer` test coverage + fix MockCSSV | Medium |

### P2 — Should Fix

| Issue | Effort |
|-------|--------|
| **DR-M3:** Handle `_syncFees` DAO balance regression | Medium |
| **DR-M4:** Add ETH DAO earnings withdrawal | Low |
| **DR-M6:** Fix `getBurnRateSSV` truncation | Low |
| **M-3 (v3):** Snapshot totalStaked for oracle votes | Medium |
| **M-4 (v3):** Add `onlyOwner` to `rescueERC20` | Low |
| **DR-L1:** Overflow check on `uint64(delta)` cast | Low |

### P3 — Nice to Have

All remaining LOW and INFO findings.

---

## APPENDIX: Worker Coverage Map

| Worker | Scope | Findings (raw) | After Filtering |
|--------|-------|----------------|-----------------|
| Core Modules | SSVClusters, SSVOperators, SSVDAO, SSVValidators, SSVStaking | 5H, 10M, 9L, 8I | 1H, 6M, 7L, 7I |
| Libraries | OperatorLib, ClusterLib, ProtocolLib, PackedLib, Storage | 1H, 1M, 2L, 10I | 0H, 1M, 2L, 10I |
| Interfaces & Network | Interfaces, SSVNetwork, Views, Token | 2H, 5M, 7L, 7I | 0H, 1M, 4L, 3I |
| Tests & Echidna | test/, contracts/test/ | 7H, 14M, 10L | 3H, 8M, 5L |
| Scripts & Deploy | scripts/, upgrades/, config | 3C, 3H, 4M, 4L | 0H, 1M, 2L, 3I |
