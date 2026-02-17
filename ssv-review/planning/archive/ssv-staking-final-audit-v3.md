# SSV Staking Final Audit Review v3 — Consolidated Report

**Branch:** `ssv-staking` | **Commit:** `e362e4d` (includes PRs #410, #412, #413)
**Date:** 2026-02-11
**Scope:** All Solidity contracts, tests, deployment scripts in `ssv-network`
**Method:** 5 parallel audit workers (Opus 4.6), focused on: (1) PR verification, (2) oracle governance, (3) accounting invariants, (4) removed operator edge cases, (5) overflow/staking/quality

---

## Executive Summary

This is the third audit round, performed after PRs #410 (forbid clusters with removed operators), #412 (guard ethValidatorCount decrement), and #413 (nonReentrant on updateClusterBalance) were merged.

**All 3 PRs are correctly implemented.** The fixes work as intended and interact correctly with each other. The audit uncovered several remaining issues — most notably a new "operator resurrection" problem in the removed-operator handling for existing clusters.

Several oracle governance findings (quorum floor, multi-root voting, deploy script signature, quorumBps upgrade initialization) were reviewed with the team and **confirmed as accepted by design** — the DAO controls quorum settings and the oracle voting mechanism is intentional.

| Severity | Count | Status |
|----------|-------|--------|
| MEDIUM | 4 | All open |
| LOW | 8 | All open |
| INFO | 4 | — |
| ACKNOWLEDGED | 4 | Accepted by design (oracle/governance/deploy) |

---

## ACKNOWLEDGED BY DESIGN

The following items were reviewed with the team and confirmed as intentional design decisions:

### ~~C-1~~: `setQuorumBps(0)` — DAO Governance Decision

**File:** `SSVDAO.sol:234-240`. The DAO controls quorum settings. Allowing 0% quorum is an intentional capability — the DAO is trusted to set appropriate values.

### ~~H-1~~: Oracle Multi-Root Voting — By Design

**File:** `SSVDAO.sol:155-200`. `hasVoted` keyed by `(blockNum, merkleRoot)` is the intended design for the oracle voting mechanism.

### ~~H-2~~: `deploy-all.ts` Signature — Confirmed Fine

**File:** `scripts/deploy-all.ts`. Script handling confirmed acceptable by team.

### ~~M-3~~: `quorumBps` Upgrade Initialization — DAO Handles It

**File:** `SSVNetworkSSVStakingUpgrade.sol`. The DAO manually sets `quorumBps` post-upgrade as part of the deployment process.

---

## MEDIUM

### M-1: `ensureETHDefaults` Resurrects Removed Operators in Existing Clusters

**File:** `OperatorLib.sol:142-150, 201`

When `registerValidator` is called for an existing cluster containing a removed operator:
1. Existing-cluster guard only checks `operator.owner == address(0)` (line 196) — passes for removed operators (owner preserved)
2. `ensureETHDefaults` sets `ethSnapshot.block = block.number` — operator is "alive" again
3. `ethValidatorCount` gets incremented from 0

The resurrected operator has `ethFee = 0` (can't increase fees post-removal), so no direct value extraction. But it inflates `ethDaoValidatorCount`, `daoTotalEthVUnits`, and creates permanent `ethValidatorCount` drift after auto-liquidation.

**Fix:** In the existing-cluster path, skip removed operators during count/snapshot updates (detect via `ethSnapshot.block == 0 && snapshot.block == 0` BEFORE `ensureETHDefaults` runs), or use `continue` to skip them entirely while still adding their preserved index.

### M-2: No Timelock on Governance Parameters — STILL OPEN

**Files:** `SSVDAO.sol` — `setQuorumBps()`, `replaceOracle()`; `SSVNetwork.sol` — `updateModule()`

All governance-critical functions execute immediately. A compromised DAO key can: `setQuorumBps(0)` → `replaceOracle(id, attacker)` → `commitRoot(maliciousRoot)` — all in a single block.

**Fix:** Implement OpenZeppelin `TimelockController` with ≥48-hour delay for these functions.

### M-3: `totalStaked` Changes Between Oracle Votes

**File:** `SSVDAO.sol:155-200`

Each oracle vote reads `totalStaked = ICSSVToken(CSSV_ADDRESS).totalSupply()` at vote time. If staking/unstaking occurs between votes, weight and threshold use inconsistent bases. Early voters' weights are calculated against a stale `totalStaked`, while the threshold is computed against the current value.

**Fix:** Snapshot `totalStaked` at the first vote for a given commitment key and use that for all subsequent votes.

### M-4: `rescueERC20` Lacks Direct Access Control

**File:** `SSVStaking.sol`

The function has **no access control modifier**. It's protected via the proxy-level `onlyOwner` in `SSVNetwork.sol`, but if `SSVStaking` were ever called directly (standalone deployment, testing), it would be unprotected.

**Fix:** Add `onlyOwner` directly in `SSVStaking.rescueERC20()` for defense-in-depth.

---

## LOW

### L-1: Auto-Liquidation vs Regular Liquidation Guard Inconsistency

**Files:** `SSVClusters.sol:543` vs `OperatorLib.sol:267`

| Path | Guard | Condition |
|------|-------|-----------|
| `liquidate()` → `updateClusterOperators()` | `if (ethSnapshot.block != 0)` | Single check |
| `_liquidateAfterEBUpdateIfNeeded()` | `if (ethSnapshot.block != 0 && snapshot.block != 0)` | Double AND |

The AND condition is functionally correct for removed operators (both blocks are 0), but it creates a discrepancy for "resurrected" operators (`ethSnapshot.block != 0`, `snapshot.block == 0`). Regular liquidation would process them; auto-liquidation would skip them.

**Fix:** Unify to use the same guard in both paths.

### L-2: `ensureETHDefaults` on Storage Overwritten by Memory Write-Back

**File:** `OperatorLib.sol:185,201,239`

Operator is loaded into memory (line 185), then `ensureETHDefaults` modifies storage (line 201), then the memory copy is written back (line 239) — overwriting storage changes. Coincidentally correct because `updateSnapshot` also sets `ethSnapshot.block`, but fragile.

### L-3: `operatorEthVUnits` Not Cleared on Operator Removal

**File:** `SSVOperators.sol:84`, `SSVStorageEB.sol:20`

`_resetOperatorState` does not clear `seb.operatorEthVUnits[operatorId]`. This stale deviation persists and pollutes storage. If the operator is resurrected (M-1), `updateSnapshotSt` would compute incorrect `effectiveVUnits = storedDeviation + (ethValidatorCount * VUNITS_PRECISION)`. Currently harmless because `ethFee = 0` prevents earnings, but architecturally unclean.

**Fix:** Add `SSVStorageEB.load().operatorEthVUnits[operatorId] = 0` in `removeOperator`.

### L-4: `_updateOperatorVUnits` Modifies Removed Operator's Deviation

**File:** `SSVClusters.sol:493-511`

When an EB update changes vUnits for a cluster, all operators are modified — including removed ones. No guard for operator removal exists in this loop.

**Fix:** Add `if (s.operators[operatorId].ethSnapshot.block == 0) continue;` guard.

### L-5: `_executeLiquidation` Deviation Accounting with Removed Operators

**File:** `SSVClusters.sol:588-594`

The deviation subtraction loop iterates ALL operators without checking removal state. Could theoretically underflow `operatorEthVUnits` if multiple clusters sharing a removed operator are liquidated. Pre-existing issue, not introduced by the recent PRs.

### L-6: `accEthPerShare` (uint128) Theoretical Overflow

**File:** `SSVStaking.sol`

`accEthPerShare` is `uint128` and accumulates via `+=`. Worst case: `newFeesWei * PRECISION / totalStaked` could approach `1.8 × 10^33` per sync. After ~189,000 maximum-case syncs with minimum stakers, overflow is theoretically possible.

**Fix:** Consider using `uint256` for `accEthPerShare`.

### L-7: Rewards Lost When `totalStaked == 0`

**File:** `SSVStaking.sol`

When `_syncFees` is called with `totalStaked == 0`, fees update the pool balance but `accEthPerShare` doesn't increase. These fees are effectively gifted to the next staker, creating a front-running incentive.

### L-8: No Validation of `defaultOracleIds` Uniqueness

**File:** `SSVDAO.sol`

Duplicate entries in `defaultOracleIds` silently reduce the effective oracle set size while keeping the weight denominator unchanged, making quorum harder to reach. This is a DoS vector.

**Fix:** Validate uniqueness in the setter/initializer.

---

## INFORMATIONAL

### I-1: Dead Code Not Cleaned Up (5 items)

Still present: `Delegation` struct (`SSVStorageStaking.sol:15-20`), `DelegationUpdated` event (`ISSVStaking.sol:72-76`), `RootProposed` event (`ISSVDAO.sol:100`), `NotAuthorizedOracle` error (`ISSVNetworkCore.sol:315`), `ZeroInterval` error (`ISSVNetworkCore.sol:320`).

### I-2: `operatorsPKs` Permanently Locked After Removal

The `s.operatorsPKs[hashedPk]` mapping is NOT cleared by `removeOperator`. A removed operator's public key can never be re-registered. This is by design but should be documented.

### I-3: Whitelist Bitmap/Flag Persistence After Removal

`_resetOperatorState` does not clear `operator.whitelisted` or `addressWhitelistedForOperators` bitmaps. Only `operatorsWhitelist[operatorId]` (legacy) is deleted. For resurrected operators in existing clusters, the whitelist constraint is still enforced.

### I-4: Missing Test Coverage

| Area | Missing Test |
|------|-------------|
| PR #410 | Register new cluster with removed operator → should revert `OperatorDoesNotExist` |
| PR #410 | Add validator to existing cluster with removed operator → should still work |
| PR #412 | `_liquidateAfterEBUpdateIfNeeded` + removed operator specifically |
| Staking | `claimEthRewards()` dust accumulation, `onCSSVTransfer()` settlement, `totalStaked == 0`, `rescueERC20` with SSV/cSSV |

---

## PRs Verified — All Correct

### PR #413: `nonReentrant` on `updateClusterBalance` — VERIFIED

- Modifier present at `SSVClusters.sol:357`
- Uses shared diamond-storage reentrancy slot — cross-module protection confirmed
- Test coverage via `MaliciousUpdateClusterBalance.sol` mock validates end-to-end

### PR #412: Guard `ethValidatorCount` Decrement in Auto-Liquidation — VERIFIED

- Guard at `SSVClusters.sol:543`: `if (op.ethSnapshot.block != 0 && op.snapshot.block != 0)`
- `_resetOperatorState()` zeros both blocks, so removed operators are correctly skipped
- Minor: no dedicated test for `_liquidateAfterEBUpdateIfNeeded` + removed operator
- All 2 decrement sites in the codebase are now guarded

### PR #410: Forbid New Clusters with Removed Operators — VERIFIED

- New cluster check: `owner == address(0) || (ethSnapshot.block == 0 && snapshot.block == 0)` — catches both unregistered and removed operators
- Existing cluster check: only `owner == address(0)` — intentionally permissive
- Critical ordering verified: `ensureETHDefaults` runs AFTER the removed-operator check
- `_isClusterExisting` checks both `s.clusters` and `s.ethClusters`
- Parameter threading SSVValidators → ClusterLib → OperatorLib is clean

### Cross-cutting: All 3 Fixes Interact Correctly

Removed operator + EB update + auto-liquidation path: operator skipped in fee calc (OperatorLib guard) and in `ethValidatorCount` decrement (PR #412 guard), all under reentrancy protection (PR #413).

---

## Invariants Verified

- **Conservation of value** holds — cluster deductions correctly match operator + DAO earnings across all 8 fee paths
- **`daoTotalEthVUnits`** invariant holds across normal paths (register, remove, liquidate, reactivate, migrate)
- **Removed operator accounting** is correct for non-resurrected operators — frozen index stops new fee accrual on both cluster and operator sides
- **Oracle replacement** correctly uses `oracleId` (not address) for `hasVoted` — no double-counting on replacement

---

## Priority Ranking for Fixes

| Priority | Issue | Effort |
|----------|-------|--------|
| **P1** | M-1: Skip removed operators during existing-cluster registration | Medium |
| **P1** | M-2: Timelock on governance | Medium-High |
| **P2** | M-3: Snapshot totalStaked for oracle votes | Medium |
| **P2** | M-4: Add onlyOwner to rescueERC20 | Low |
| **P3** | L-1 through L-8 | Low each |
