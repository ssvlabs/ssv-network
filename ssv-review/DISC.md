# Design Discussion Log

This file tracks open questions and unspecified behaviors identified during the SPEC review against the DIP-X proposal. Each item represents a gap where the proposal is silent, ambiguous, or where the implementation made a decision not explicitly documented.

**Format:** Each item has a `Resolution` column to be filled in by Product/Dev.

---

## Section 1 — ETH Payments / Cluster Migration

| # | Gap | Proposal | SPEC | Resolution |
|---|-----|----------|------|------------|
| 1.1 | Can a **liquidated** SSV cluster be migrated? | Silent | Notes it reactivates | ✅ Notes it reactivates |
| 1.2 | Can `migrateClusterToETH` be called by a **non-owner**? | Silent | Silent | ✅ Notes in Cluster Migration section |
| 1.3 | What if `msg.value == 0` on migration? Does it revert? What is the minimum ETH required? | "deposits sufficient ETH" | Silent | ✅ Notes in Cluster Migration section |
| 1.4 | What if the migrating cluster has **removed/inactive operators**? | Silent | Silent | ✅ Notes in Cluster Migration section |
| 1.5 | Can existing operators **declare a new ETH fee** before the upgrade goes live? Is there a blocking rule? | Silent | Mentions `UPGRADE_TIMESTAMP` | ✅ Notes in 4.3 Declare Operator Fee |

---

## Section 2 — Effective Balance Accounting

| # | Gap | Proposal | SPEC | Resolution |
|---|-----|----------|------|------------|
| 2.1 | What happens if `updateClusterBalance` is called on a **liquidated** cluster? Does it auto-liquidate again, revert, or succeed silently? | Silent | Silent | ✅ Succeeds: EB snapshot is always updated. Fee settlements, vUnit deviations, and auto-liquidation are all skipped (`!cluster.active` guard). `ClusterBalanceUpdated` is emitted. Documented in SPEC 4 and FLOWS 3.3. |
| 2.2 | What happens if an EB update results in **zero vUnits** (e.g. all validators exited but cluster not removed)? | Silent | Silent | ✅ Structurally impossible for active clusters: `_verifyEBLimits` enforces effectiveBalance >= validatorCount * 32, so vUnits >= validatorCount * 10,000. Zero vUnits only occurs if validatorCount == 0 (all validators exited), in which case ebToVUnits(0) = 0, which is the implicit-EB sentinel — harmless, resets the cluster to implicit mode. No accounting impact since baseline is also 0. |
| 2.3 | What is the **initial value** of `minBlocksBetweenUpdates`? Who can update it and via which function? | Silent | Not in governance params | ⚠️ **Bug**: never initialized (defaults to `0`) and no governance setter exists. Rate limit is completely inoperative — any caller can update cluster EB every block. Documented as a security mitigation in threat model but silently disabled. Tracked as SEC-19 in MAINNET-READINESS.md. |
| 2.4 | What happens to **operator vUnit deviations** when a cluster is liquidated? Are they cleaned up or left stale? | Silent | Not documented | ✅ Correctly cleaned up in `_executeLiquidation`: deviation (not baseline) is subtracted from `operatorEthVUnits` and `daoTotalEthVUnits`. Baseline is removed via `ethValidatorCount` decrement. Implicit clusters (no explicit EB) have no deviation to clean. Documented in SPEC 4. |
| 2.5 | **Stale EB on reactivation risk**: cluster is liquidated, EB updates are paused (oracles skip liquidated clusters). Real EB increases on beacon chain (owner consolidates validators). Owner reactivates with ETH sufficient for the stale (lower) EB. Next oracle update arrives with higher EB → burn rate jumps → cluster may be immediately undercollateralized and auto-liquidated. | Silent | Silent | |
| 2.6 | **Inverse stale EB risk**: cluster is liquidated, real EB decreases (slashing). Owner reactivates using stale (higher) EB for the solvency check → passes with less ETH than the next oracle update will require. Same outcome: auto-liquidation on next `updateClusterBalance`. | Silent | Silent | |

---

## Section 3 — SSV Staking

| # | Gap | Proposal | SPEC | Resolution |
|---|-----|----------|------|------------|
| 3.1 | `MINIMAL_STAKING_AMOUNT = 1,000,000,000` — what unit is this (SSV wei)? What is the rationale? | Silent | Documented as constant | ❓ Ask product |
| 3.2 | `MAX_PENDING_REQUESTS = 2000` — code currently has 10. Which is the intended value? | Silent | ⚠️ Updated to 2000 in docs, pending to update contracts | |
| 3.3 | Can a user **stake 0**? Which error is returned? | Silent | Silent | ✅ Reverts with `ZeroAmount`, Staking Errors updated in SPECS|
| 3.4 | What happens if a user **stakes before any oracle is initialized**? Does it revert or succeed? | Silent | `OracleHasZeroWeight` on `commitRoot` | ✅ `stake()` has no oracle dependency — succeeds regardless of oracle state. `OracleHasZeroWeight` is thrown by `commitRoot` (not `stake`) when `totalStaked == 0`. Oracles are bootstrapped at upgrade time via `initializeSSVStaking` (`s.defaultOracleIds = defaultOracleIds`), so they are always initialized before any user interaction. Documented in SPEC 4. |
| 3.5 | `withdrawUnlocked` — what if **no matured requests** exist? Does it revert (`NothingToWithdraw`) or no-op? | Silent | Referenced | ✅ Reverts with `NothingToWithdraw` — `calculateTotalUnfrozenBalance` returns 0 if no requests have passed `unlockTime`, and the zero-amount check fires immediately. |
| 3.6 | `withdrawUnlocked` — does it process **all** matured requests in one call, or just one? | Silent | Referenced | ✅ Processes **all** matured requests in one call — `calculateTotalUnfrozenBalance` iterates the full `withdrawalRequests` array, pops every entry where `unlockTime <= block.timestamp`, and returns the cumulative sum. Immature requests are left in place. |
| 3.7 | What happens to **accrued (but unclaimed) rewards** if a user's cSSV balance goes to 0 via transfer? Are they still claimable? | "rewards stay with original holder" | Covered | ✅ Rewards are stored in `accrued` independently of cSSV balance. |

---

## Section 4 — Oracle System

| # | Gap | Proposal | SPEC | Resolution |
|---|-----|----------|------|------------|
| 4.1 | Can an oracle vote **twice** for the same `(blockNum, merkleRoot)` pair? | Silent | `hasVoted` mapping prevents it | |
| 4.2 | Is `quorumBps == 0` a valid value? Is it validated on `setQuorumBps`? | Silent | Not validated per MAINNET-READINESS | ⚠️ `setQuorumBps` only rejects values `> 10000` — zero is accepted. Impact: `threshold = (totalStaked * 0) / 10000 = 0`, so `accumulatedWeight >= threshold` is always true → any single oracle vote immediately commits a root. `quorumBps` is also not initialized in the upgrade (defaults to 0). Tracked as SEC-2 (P0) in MAINNET-READINESS.md. |
| 4.3 | Is `quorumBps > 10000` rejected? | Silent | ✅ Yes with `InvalidQuorum` | |
| 4.4 | What happens to **pending/accumulated votes** for a commitment when an oracle is replaced mid-vote? | Silent | "Outstanding votes remain counted" per FLOWS | |
| 4.5 | `minBlocksBetweenUpdates` — who sets it, what is the initial value, and is there a governance function? | Silent | Not in governance params table | Referenced in SEC-19 |