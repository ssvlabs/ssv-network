# Consolidated Audit Findings — SSV Network v2.0.0

**Generated:** 2026-03-17
**Sources:** 9 independent audit scans (state invariant, behavioral state, input/arithmetic safety, semantic guard, SCV cheatsheet, staking rewards, oracle/flash loan, DoS/griefing, external call safety)
**Branch:** `ssv-staking`
**Cross-reference:** `ssv-review/planning/MAINNET-READINESS.md`

---

## Priority Summary

| ID | Description | Type | Severity | Resolution |
|----|-------------|------|----------|------------|
| CA-01 | Silent uint64 truncation in `networkTotalEarnings` DAO earnings | Arithmetic Safety | Medium-High | Already fixed (ref MAINNET-READINESS QUALITY-12) |
| CA-02 | Fees permanently lost when `totalStaked == 0` in `_syncFees` | Staking Rewards | Medium | Open (ref BUG-6 — mitigated by deployment sequencing) |
| CA-03 | Aggregate vs per-cluster rounding conservation law violation | Arithmetic Safety | Medium | Closed (ref BUG-19 — accepted known behavior) |
| CA-04 | Unsafe uint128 to uint64 cast in operator earnings accumulation | Arithmetic Safety | Medium | Already fixed (ref MAINNET-READINESS QUALITY-12) |
| CA-05 | uint64 overflow in `blockDiffEthFee` operator snapshot DoS | Arithmetic Safety | Medium | Open |
| CA-06 | Oracle quorum can be set to zero | Oracle Security | Medium | Already fixed (ref MAINNET-READINESS SEC-20) |
| CA-07 | Oracle weight assumes all delegation slots active | Oracle Security | Medium | Open |
| CA-08 | `migrateClusterToETH` missing `nonReentrant` modifier | Reentrancy | Medium | Already closed (ref MAINNET-READINESS SEC-6) |
| CA-09 | `accEthPerShare` precision loss at scale | Staking Rewards | Medium | Closed (ref BUG-18 — accepted as part of accumulator model) |
| CA-10 | Staking reward dilution via flash loan | Flash Loan | Medium | Mitigated by design (settlement ordering + 7-day cooldown) |
| CA-11 | `withdrawUnlocked` gas scales with pending request count | DoS / Griefing | Medium | Open (self-DoS only, capped at 2000) |
| CA-12 | External whitelisting contract can DoS validator registration | DoS / Griefing | Medium | Open (operator self-DoS only) |
| CA-13 | `onCSSVTransfer` hook can block all cSSV transfers | DoS / Griefing | Medium | Open (governance upgrade risk only) |
| CA-14 | `onCSSVTransfer` missing `nonReentrant` modifier | Reentrancy | Low | Already closed (ref MAINNET-READINESS SEC-7) |
| CA-15 | `commitRoot` accepts zero merkle root | Input Validation | Low | Already closed (ref MAINNET-READINESS SEC-14) |
| CA-16 | `removeOperator` doesn't clear `operatorEthVUnits` | State Cleanup | Low | Already fixed (ref MAINNET-READINESS QUALITY-10) |
| CA-17 | Dust trapped on reward claim with zero cSSV balance | Staking Rewards | Low | Already fixed (ref MAINNET-READINESS SEC-16b) |
| CA-18 | Governance fee params lack min/max bounds | Input Validation | Low | Open (ref MAINNET-READINESS SEC-17) |
| CA-19 | uint64 overflow in unstake unlock time calculation | Arithmetic Safety | Low | Open |
| CA-20 | Zero-value deposit/withdrawal accepted | Input Validation | Low | Already closed (ref MAINNET-READINESS SEC-16) |
| CA-21 | Oracle quorum weight manipulation via cSSV supply | Oracle Security | Low | Mitigated by design (equal-weight model) |
| CA-22 | No staleness check on committed root age | Oracle Security | Low | Open (informational) |
| CA-23 | Raw transfer/transferFrom instead of SafeERC20 | External Call Safety | Low | Open (no current risk, SSV is standard ERC20) |
| CA-24 | External whitelisting contract call without gas cap | External Call Safety | Low | Open (same root cause as CA-12) |
| CA-25 | Operator fee execution window block stuffing | DoS / Griefing | Low | Open (economically infeasible on L1) |
| CA-26 | Competing oracle proposals leave ghost state | State Cleanup | Low | Open |
| CA-27 | `ClusterBalanceUpdated` emitted for SSV clusters with unchanged state | Event Correctness | Low | Open |
| CA-28 | `claimEthRewards` dual balance check redundancy | Code Quality | Low | Open |
| CA-29 | Dead code in `_executeLiquidation` wrong accounting direction | Code Quality | Info | Open |
| CA-30 | `rescueERC20` no module-level access control | Access Control | Info | Open (proxy-level `onlyOwner` sufficient) |
| CA-31 | CLAUDE.md stale docs on `reactivate` nonReentrant | Documentation | Info | Open |
| CA-32 | No SafeCast used anywhere (systemic) | Arithmetic Safety | Info | Open |
| CA-33 | Rounding direction analysis | Arithmetic Safety | Info | No vulnerability |
| CA-34 | `_syncFees` defensive `current < previous` path | Code Quality | Info | Open |
| CA-35 | `onCSSVTransfer` virtual modifier override risk | Upgrade Safety | Info | Open |
| CA-36 | Flash loan attack surface — core cluster operations | Flash Loan | Info | No vulnerability |
| CA-37 | No circular price dependencies | Oracle Security | Info | No vulnerability |
| CA-38 | Oracle replacement mid-round voting edge case | Oracle Security | Info | Correctly handled |
| CA-39 | ETH transfer pattern (push payments) | External Call Safety | Info | Correctly implemented |
| CA-40 | `delegatecall` usage — trusted targets only | External Call Safety | Info | Correctly implemented |
| CA-41 | No approve race conditions | External Call Safety | Info | No vulnerability |
| CA-42 | Fee-on-transfer / rebasing token compatibility | External Call Safety | Info | Not applicable |
| CA-43 | Oracle `hasVoted` storage never cleaned | State Cleanup | Info | By design, acceptable growth |

---

## Detailed Findings

---

### MEDIUM-HIGH

---

#### CA-01: Silent uint64 Truncation in `networkTotalEarnings()` — DAO Earnings Lost

**Severity:** Medium-High
**Type:** Arithmetic Safety
**Location:** `contracts/libraries/ProtocolLib.sol:84-90`
**Resolution:** Already fixed (ref MAINNET-READINESS QUALITY-12)

**Source:** STATE-INVARIANT-REPORT.md (SIV-01)
**Cross-references:** z_input_arithmetic_safety_scan.md (Finding 2), z_behavioral_state.md (F-3), z_staking_audit_report.md (Finding #2)

**Description:**

The `networkTotalEarnings()` function computes `earningsUnits` as `uint128` but then truncates to `uint64` via `PackedETH.wrap(uint64(earningsUnits))`. In Solidity 0.8, explicit narrowing casts silently truncate without reverting. If the product `blockDelta * networkFee_raw * totalVUnits / BPS_DENOMINATOR` exceeds `type(uint64).max` (~1.844e19), the result wraps silently.

```solidity
uint128 earningsUnits = (idx * PackedETH.unwrap(sp.ethNetworkFee) * units) / BPS_DENOMINATOR;
return sp.ethDaoBalance.add(PackedETH.wrap(uint64(earningsUnits)));
//                                        ^^^^^^^^^^^^^^^^^^^^^^^^
//                          Silent truncation if earningsUnits > type(uint64).max
```

**Root Cause:** `updateNetworkFee()` does not enforce an upper bound on `ethNetworkFee`. The only constraint is `PackedETHLib.pack(fee)` not reverting, which allows fees up to `type(uint64).max * ETH_DEDUCTED_DIGITS`. Combined with even modest `daoTotalEthVUnits`, the product overflows `uint64`.

**Impact:**
- DAO earnings silently truncated — `ethDaoBalance` understated
- `stakingEthPoolBalance` (synced from `ethDaoBalance`) also understated — staking rewards distributed are less than earned
- The "lost" ETH stays in the contract but can never be claimed by stakers
- Requires malicious/negligent governance to set extreme fee values — not exploitable by external actors

**Practical reachability:** With current proposed parameters (`fee_packed ~ 35,509`, `daoTotalEthVUnits ~ 1e9`, `blockDelta ~ 2.5e6`), `earningsUnits ~ 8.87e15` — fits in `uint64`. Overflow requires either extreme governance-set fee values or decades without DAO earnings settlement.

**Recommendation:** Apply `SafeCast.toUint64(earningsUnits)` to revert on overflow, or add an upper bound in `updateNetworkFee()`.

**Fix (QUALITY-12):** A lightweight `_safeUint64(uint128)` helper was added to `SSVCoreTypes.sol` with a custom `SafeCastOverflow` error. The unsafe cast in `ProtocolLib.sol:89` was replaced with `_safeUint64(earningsUnits)`.

---

### MEDIUM

---

#### CA-02: Fees Permanently Lost When `totalStaked == 0` in `_syncFees`

**Severity:** Medium
**Type:** Staking Rewards
**Location:** `contracts/modules/SSVStaking.sol:165-184`
**Resolution:** Open (ref MAINNET-READINESS BUG-6 — mitigated by deployment sequencing)

**Source:** STATE-INVARIANT-REPORT.md (SIV-04)
**Cross-references:** z_staking_audit_report.md (Finding #3), z_behavioral_state.md (F-1)

**Description:**

When `totalStaked == 0` (no cSSV exists), `_syncFees` skips the `accEthPerShare` update but still advances `stakingEthPoolBalance` to `current`. Fees accrued during the zero-supply period are permanently lost — they've been debited from `ethDaoBalance` but never reach stakers.

```solidity
uint256 totalStaked = ICSSVToken(CSSV_ADDRESS).totalSupply();
if (totalStaked != 0) {
    newFeesWei = PackedETHLib.unpack(packedNewFees);
    s.accEthPerShare += uint128((newFeesWei * PRECISION) / totalStaked);
}
s.stakingEthPoolBalance = current;  // Advanced regardless!
```

**Impact:** Network fees earned during periods with zero cSSV supply are permanently non-distributable. Relevant during protocol bootstrap or black swan events where all SSV is unstaked.

**Recommendation:** Either (a) defer `stakingEthPoolBalance` advancement when `totalStaked == 0`, or (b) initialize `stakingEthPoolBalance = sp.networkTotalEarnings()` at staking module initialization so the first `_syncFees` only distributes fees from that point forward. Note: option (a) gives all accumulated fees to the first staker, which could incentivize front-running.

---

#### CA-03: Aggregate vs Per-Cluster Rounding Conservation Law Violation

**Severity:** Medium
**Type:** Arithmetic Safety
**Location:** `contracts/libraries/OperatorLib.sol:52-72`, `contracts/libraries/ProtocolLib.sol:84-90`, `contracts/libraries/ClusterLib.sol:306-321`
**Resolution:** Closed (ref MAINNET-READINESS BUG-19 — accepted known behavior)

**Source:** STATE-INVARIANT-REPORT.md (SIV-02)

**Description:**

Each cluster pays fees proportional to its own `vUnits` (floor division), but operators earn proportional to their aggregate `effectiveVUnits` across ALL clusters (also floor division). Due to the mathematical property `floor(a*x/n) + floor(a*y/n) <= floor(a*(x+y)/n)`, operators and the DAO virtually earn slightly more than clusters collectively pay, creating a slow insolvency drift.

**Bounded magnitude:** Per settlement: at most `(numClusters - 1) * ETH_DEDUCTED_DIGITS` wei = `(N-1) * 100,000 wei`. Per year (2.5M blocks) with 1,000 clusters: ~0.00025 ETH/year.

**Recommendation:** Document as a known accepted issue. No code change required unless operating at extreme scale.

---

#### CA-04: Unsafe uint128 to uint64 Cast in Operator Earnings Accumulation

**Severity:** Medium
**Type:** Arithmetic Safety
**Location:** `contracts/libraries/OperatorLib.sol:68-69, 93-94, 306-307`
**Resolution:** Already fixed (ref MAINNET-READINESS QUALITY-12)

**Source:** z_input_arithmetic_safety_scan.md (Finding 1)
**Cross-references:** z_scv-scan.md (SCV-05)

**Description:**

The operator earnings delta is computed as `uint128` but silently truncated to `uint64` when stored via `PackedETH.wrap(uint64(delta))`. If `delta` exceeds `type(uint64).max`, operator earnings are permanently lost with no revert.

```solidity
uint128 delta = (uint128(blockDiffEthFee) * uint128(effectiveVUnits)) / BPS_DENOMINATOR;
operator.ethSnapshot.balance = operator.ethSnapshot.balance.add(PackedETH.wrap(uint64(delta)));
```

**Practical reachability:** With realistic parameters (50,400 blocks/week, packed fee ~35,500, 2,000 validators at max EB): `delta ~ 2.29e14` — fits in `uint64`. Overflow requires pathological conditions (decades without snapshot updates or extreme fee values).

**Recommendation:** Use `SafeCast.toUint64(delta)` to fail loudly on overflow instead of silently truncating.

**Fix (QUALITY-12):** The `_safeUint64(uint128)` helper added to `SSVCoreTypes.sol` replaced all 3 unsafe casts in `OperatorLib.sol` (lines 69, 94, 307). Overflow now reverts with `SafeCastOverflow`.

---

#### CA-05: uint64 Overflow in `blockDiffEthFee` — Operator Snapshot DoS

**Severity:** Medium
**Type:** Arithmetic Safety
**Location:** `contracts/libraries/OperatorLib.sol:58, 85`
**Resolution:** Open

**Source:** z_behavioral_state.md (F-2)

**Description:**

```solidity
uint64 blockDiffEthFee = (currentBlock - operator.ethSnapshot.block) * PackedETH.unwrap(operator.ethFee);
```

The multiplication of `uint32 blockDiff * uint64 ethFee` produces `uint64`. Solidity 0.8 checked arithmetic reverts on overflow. Overflow occurs when `fee_packed > ~4.28e9`, corresponding to an actual fee > ~1,100 ETH/year per vUnit. While absurdly high for a real operator, `operatorMaxFee` has no upper-bound check against this threshold.

**Impact:** If governance sets `operatorMaxFee` to an extreme value and an operator adopts it, any call to `updateSnapshotSt`/`updateSnapshot` reverts with arithmetic overflow. All cluster operations involving this operator are permanently blocked. Recovery via `reduceOperatorFee` also fails because it calls `updateSnapshot` internally.

**Recommendation:** Upcast before multiplication: `uint128 blockDiffEthFee = uint128(currentBlock - operator.ethSnapshot.block) * uint128(PackedETH.unwrap(operator.ethFee))`. Also add an absolute cap in `updateMaximumOperatorFee`.

---

#### CA-06: Oracle Quorum Can Be Set to Zero

**Severity:** Medium
**Type:** Oracle Security
**Location:** `contracts/modules/SSVDAO.sol:252-258`
**Resolution:** Already fixed (ref MAINNET-READINESS SEC-20)

**Source:** z_scv-scan.md (SCV-01)
**Cross-references:** z_input_arithmetic_safety_scan.md (Finding 3)

**Description:**

The `updateQuorumBps` function allowed `quorumBps = 0`. With zero quorum, `threshold = 0` in `commitRoot()`, so any single oracle vote immediately commits a root, bypassing multi-oracle consensus. A compromised oracle could commit a fraudulent Merkle root containing arbitrary effective balances.

**Resolution:** Fixed via MAINNET-READINESS SEC-20 — `quorumBps` now validates `!= 0 && <= 10_000`.

---

#### CA-07: Oracle Weight Assumes All Delegation Slots Are Active

**Severity:** Medium
**Type:** Oracle Security
**Location:** `contracts/modules/SSVDAO.sol:199`
**Resolution:** Open

**Source:** z_scv-scan.md (SCV-02)

**Description:**

The oracle weight calculation divides `totalStaked` by `s.defaultOracleIds.length`, which is always 4 (fixed-size array `uint32[MAX_DELEGATION_SLOTS]`). If fewer than 4 oracle slots are populated, active oracles cannot reach quorum. For example, with 2 oracles and 75% quorum: `2 * (totalStaked/4) = 50%` — never reaches 75%.

**Impact:** The EB root commitment system becomes permanently stuck until all 4 slots are filled.

**Recommendation:** Track the count of active oracle slots and use that for weight calculation, or count non-zero entries in `defaultOracleIds` dynamically.

---

#### CA-08: `migrateClusterToETH` Missing `nonReentrant` Modifier

**Severity:** Medium
**Type:** Reentrancy
**Location:** `contracts/modules/SSVClusters.sol:259`
**Resolution:** Already closed (ref MAINNET-READINESS SEC-6 — no callback risk)

**Source:** z_semantic_guard_scan.md (SGA-01)
**Cross-references:** z_scv-scan.md (SCV-06)

**Description:**

`migrateClusterToETH` modifies cluster state, operator state, DAO accounting, and EB deviation accounting, then performs an external ERC20 token transfer via `CoreLib.transferTokenBalance` — all without `nonReentrant`. 10 of 11 functions with external transfers are protected.

**Mitigating factors:** The SSV token is a standard ERC20 without transfer callbacks. CEI pattern is followed — all state updates complete before the transfer. The SSV cluster hash is deleted before the transfer, so re-migration would revert.

**Resolution:** Closed — no callback risk with standard ERC20 SSV token.

---

#### CA-09: `accEthPerShare` Precision Loss at Scale

**Severity:** Medium
**Type:** Staking Rewards
**Location:** `contracts/modules/SSVStaking.sol:202`
**Resolution:** Closed (ref MAINNET-READINESS BUG-18 — accepted as part of accumulator model)

**Source:** z_staking_audit_report.md (Finding #1)
**Cross-references:** z_scv-scan.md (SCV-04), z_input_arithmetic_safety_scan.md (Finding 9)

**Description:**

The `accEthPerShare` accumulator increment can round to zero when `newFeesWei * PRECISION < totalStaked`:

```solidity
s.accEthPerShare += uint128((newFeesWei * PRECISION) / totalStaked);
```

If `totalStaked > 1e23` (100,000 SSV tokens) and `newFeesWei` is at the minimum packed increment (100,000 wei), the increment rounds to zero. Those fees are absorbed into `stakingEthPoolBalance` but never distributed — permanently orphaned.

**Impact:** Low economic impact under current parameters, but fees are permanently lost from the staker pool. Over extended operation, orphaned fees accumulate silently.

**Recommendation:** Defer `stakingEthPoolBalance` advancement when `accEthPerShare` increment rounds to zero, so small fees accumulate to the next sync.

---

#### CA-10: Staking Reward Dilution via Flash Loan

**Severity:** Medium
**Type:** Flash Loan
**Location:** `contracts/modules/SSVStaking.sol:183`
**Resolution:** Mitigated by design

**Source:** z_oracle_flashloan_scan.md (Finding 2)

**Description:**

An attacker could attempt to dilute staking rewards by flash-borrowing SSV, calling `stake()` to inflate cSSV supply, then claiming rewards.

**Why this is mitigated:**
1. Settlement ordering in `stake()`: `_syncFees()` runs at OLD `totalSupply`, then `_settle()` at OLD balance, THEN cSSV is minted. Attacker only earns rewards from fees accruing after their stake.
2. The 7-day unstaking cooldown prevents flash-loan-in-single-tx exploitation.
3. Residual risk is economic dilution inherent to any pro-rata staking system, not a contract bug.

---

#### CA-11: `withdrawUnlocked` Gas Scales with Pending Request Count

**Severity:** Medium
**Type:** DoS / Griefing
**Location:** `contracts/modules/SSVStaking.sol:230`
**Resolution:** Open (self-DoS only, capped at 2000)

**Source:** z_dos_griefing_scan.md (Finding 1)

**Description:**

`calculateTotalUnfrozenBalance` iterates over the user's entire `withdrawalRequests[]` array. While capped at `MAX_PENDING_REQUESTS = 2000`, a user who accumulates many small unstake requests faces high gas costs. Worst case (all 2000 unlocked): ~11M gas — within block limit but expensive.

**Impact:** Self-inflicted only — each `requestUnstake` requires burning cSSV. User's own funds locked behind expensive withdrawal. Cannot withdraw in smaller batches.

**Recommendation:** Consider adding a paginated withdrawal function that limits how many requests are processed per call.

---

#### CA-12: External Whitelisting Contract Can DoS Validator Registration

**Severity:** Medium
**Type:** DoS / Griefing
**Location:** `contracts/libraries/OperatorLib.sol:167, 203-204`
**Resolution:** Open (operator self-DoS only)

**Source:** z_dos_griefing_scan.md (Finding 2)
**Cross-references:** z_external_call_scan.md (Finding 2)

**Description:**

During validator registration, if an operator has a whitelisting contract set, the function calls `ISSVWhitelistingContract(whitelistedAddress).isWhitelisted(msg.sender, operatorId)`. If this external contract reverts unconditionally, consumes excessive gas, or enters an infinite loop, no one can register validators with that operator.

**Mitigating factors:** Only the operator owner can set a whitelisting contract. The operator can remove it at any time. Existing validators are unaffected.

**Recommendation:** Consider wrapping the external `isWhitelisted` call in a try/catch with a gas limit.

---

#### CA-13: `onCSSVTransfer` Hook Can Block All cSSV Transfers

**Severity:** Medium
**Type:** DoS / Griefing
**Location:** `contracts/modules/SSVStaking.sol:173`
**Resolution:** Open (governance upgrade risk only)

**Source:** z_dos_griefing_scan.md (Finding 3)

**Description:**

The cSSV token calls `onCSSVTransfer(from, to, amount)` on every transfer. If the staking module is upgraded to a buggy version where `_syncFees` reverts, all cSSV transfers are blocked — creating a single point of failure that freezes the entire cSSV token economy.

**Mitigating factors:** This is an admin/upgrade risk, not an external attacker vector. The proxy upgrade pattern means the DAO can deploy a fix.

**Recommendation:** Consider adding a circuit breaker or try/catch wrapper in the cSSV token for the `onCSSVTransfer` hook.

---

### LOW

---

#### CA-14: `onCSSVTransfer` Missing `nonReentrant` Modifier

**Severity:** Low
**Type:** Reentrancy
**Location:** `contracts/modules/SSVStaking.sol:173`
**Resolution:** Already closed (ref MAINNET-READINESS SEC-7 — trusted cSSV contract)

**Source:** z_semantic_guard_scan.md (SGA-02)
**Cross-references:** z_external_call_scan.md (Finding 3)

**Description:**

`onCSSVTransfer` modifies staking accumulator state without `nonReentrant`, while 5 of 6 other accumulator-modifying staking functions are protected. Currently safe because the function is only callable by the immutable `CSSV_ADDRESS` and cSSV is a standard ERC20 with no callbacks.

---

#### CA-15: `commitRoot` Accepts Zero Merkle Root

**Severity:** Low
**Type:** Input Validation
**Location:** `contracts/modules/SSVDAO.sol:168`
**Resolution:** Already closed (ref MAINNET-READINESS SEC-14 — coordinated oracles)

**Source:** z_semantic_guard_scan.md (SGA-03)
**Cross-references:** z_input_arithmetic_safety_scan.md (Finding 7), z_scv-scan.md (SCV-07b)

**Description:**

No check that `merkleRoot != bytes32(0)`. A zero root committed by quorum would be permanently unusable since `_verifyEBRoots` treats zero as non-existent. `latestCommittedBlock` would advance past this block, blocking EB updates until a new root is committed.

---

#### CA-16: `removeOperator` Doesn't Clear `operatorEthVUnits`

**Severity:** Low
**Type:** State Cleanup
**Location:** `contracts/modules/SSVOperators.sol:344-355`
**Resolution:** Already fixed (ref MAINNET-READINESS QUALITY-10)

**Source:** STATE-INVARIANT-REPORT.md (SIV-03)

**Description:**

`_resetOperatorState()` resets `ethValidatorCount`, `ethSnapshot`, `ethFee`, etc., but does not clear `operatorEthVUnits[operatorId]` from `SSVStorageEB`. No functional impact since `updateSnapshotSt()` is skipped for removed operators, but off-chain analytics would see stale values.

---

#### CA-17: Dust Trapped on Reward Claim with Zero cSSV Balance

**Severity:** Low
**Type:** Staking Rewards
**Location:** `contracts/modules/SSVStaking.sol:109-139`
**Resolution:** Already fixed (ref MAINNET-READINESS SEC-16b, BUG-20)

**Source:** STATE-INVARIANT-REPORT.md (SIV-05)
**Cross-references:** z_staking_audit_report.md (Finding #4b)

**Description:**

When a user has zero cSSV and a sub-precision remainder (`< ETH_DEDUCTED_DIGITS = 100,000 wei`), the remainder is deleted from `accrued` but not returned to the pool. Maximum dust per user: 99,999 wei (~0.0000001 ETH).

---

#### CA-18: Governance Fee Parameters Lack Min/Max Bounds

**Severity:** Low
**Type:** Input Validation
**Location:** `contracts/modules/SSVDAO.sol:85-96, 263-266`
**Resolution:** Open (tracked as MAINNET-READINESS SEC-17)

**Source:** z_scv-scan.md (SCV-03)
**Cross-references:** z_input_arithmetic_safety_scan.md (Finding 4)

**Description:**

Three governance parameters can be set to zero with no validation: `declareOperatorFeePeriod`, `executeOperatorFeePeriod`, `cooldownDuration`. A misconfiguration or governance attack could eliminate time-based protections. Additionally, no upper bounds exist — `cooldownDuration` could be set to `type(uint64).max`, permanently locking all unstaked tokens.

**Recommendation:** Enforce both minimum and maximum value constants for each parameter.

---

#### CA-19: uint64 Overflow in Unstake Unlock Time Calculation

**Severity:** Low
**Type:** Arithmetic Safety
**Location:** `contracts/modules/SSVStaking.sol:87-88`
**Resolution:** Open

**Source:** z_input_arithmetic_safety_scan.md (Finding 5)

**Description:**

The unlock time is computed as `uint64(block.timestamp + s.cooldownDuration)`. If `cooldownDuration` is set to a value close to `type(uint64).max`, the addition result (in `uint256`) silently truncates when cast to `uint64`, wrapping to a small value — allowing immediate withdrawal.

**Note:** Requires an admin to set `cooldownDuration` to an extreme value (see CA-18).

**Recommendation:** Use `SafeCast.toUint64()` or validate before casting.

---

#### CA-20: Zero-Value Deposit and Withdrawal Accepted

**Severity:** Low
**Type:** Input Validation
**Location:** `contracts/modules/SSVClusters.sol:186, 206`
**Resolution:** Already closed (ref MAINNET-READINESS SEC-16)

**Source:** z_input_arithmetic_safety_scan.md (Finding 6)

**Description:**

Both `deposit()` and `withdraw()` accept zero-value operations. A zero deposit updates the cluster hash and emits events with `value = 0`. A zero withdrawal triggers balance checks, operator index reads, and a 0-wei ETH transfer. No fund-loss impact but pollutes event logs.

---

#### CA-21: Oracle Quorum Weight Manipulation via cSSV Supply

**Severity:** Low
**Type:** Oracle Security
**Location:** `contracts/modules/SSVDAO.sol:191-197`
**Resolution:** Mitigated by design

**Source:** z_oracle_flashloan_scan.md (Finding 1)

**Description:**

If an attacker front-runs the first oracle vote and inflates cSSV supply (via flash loan + `stake()`), the quorum threshold increases. However, the equal-weight model (`weight = totalStaked / oracleCount`) means inflating supply increases both threshold AND each oracle's weight proportionally — the ratio stays the same. With 4 oracles and 75% quorum, 3 votes always suffice regardless of supply.

---

#### CA-22: No Staleness Check on Committed Root Age

**Severity:** Low
**Type:** Oracle Security
**Location:** `contracts/modules/SSVClusters.sol:348, 434-442`
**Resolution:** Open (informational)

**Source:** z_oracle_flashloan_scan.md (Finding 3)

**Description:**

There is no check on how old the latest committed root is relative to the current block. If oracles stop committing roots, `latestCommittedBlock` could be hundreds of blocks old. Clusters would operate with outdated effective balance values. Oracle liveness is a governance assumption, not a contract-level guarantee.

**Recommendation:** Consider adding a `MAX_ROOT_AGE` parameter: `if (block.number - ctx.blockNum > MAX_ROOT_AGE) revert RootTooOld()`.

---

#### CA-23: Raw `transfer`/`transferFrom` Instead of SafeERC20

**Severity:** Low
**Type:** External Call Safety
**Location:** `contracts/libraries/CoreLib.sol:46`, `contracts/modules/SSVStaking.sol:53, 103`
**Resolution:** Open (no current risk)

**Source:** z_external_call_scan.md (Finding 1)

**Description:**

`SSVStaking` imports `SafeERC20` and declares `using SafeERC20 for IERC20`, but only uses it for `rescueERC20`. The SSV token's own `transfer`/`transferFrom` calls use the raw ERC20 interface. Currently safe because SSV is a standard OZ ERC20, but inconsistent with the imported library.

---

#### CA-24: External Whitelisting Contract Call Without Gas Cap

**Severity:** Low
**Type:** External Call Safety
**Location:** `contracts/libraries/OperatorLib.sol:203-204`
**Resolution:** Open (same root cause as CA-12)

**Source:** z_external_call_scan.md (Finding 2)

**Description:**

The `isWhitelisted()` call to operator-chosen external contracts forwards all remaining gas. A malicious contract could consume excessive gas (gas bomb) or return large data. See CA-12 for full analysis.

---

#### CA-25: Operator Fee Execution Window Block Stuffing

**Severity:** Low
**Type:** DoS / Griefing
**Location:** `contracts/modules/SSVOperators.sol:146, 158-162`
**Resolution:** Open (economically infeasible on L1)

**Source:** z_dos_griefing_scan.md (Finding 4)

**Description:**

`executeOperatorFee` must be called within the time window `[approvalBeginTime, approvalEndTime]`. A well-funded attacker could theoretically stuff blocks to prevent execution. With `executeOperatorFeePeriod` set to 24+ hours, block stuffing costs ~$10M+ on Ethereum mainnet. The operator can re-declare the fee if the window is missed.

---

#### CA-26: Competing Oracle Proposals Leave Ghost State

**Severity:** Low
**Type:** State Cleanup
**Location:** `contracts/modules/SSVDAO.sol:168-218`
**Resolution:** Open

**Source:** z_behavioral_state.md (F-4)

**Description:**

When two oracles propose competing roots for the same `blockNum`, if root A reaches quorum first, the `rootCommitments[key_B]` and `roundFrozenSupply[key_B]` entries for root B are never cleaned up — they persist in storage indefinitely. No fund loss or security impact, only storage bloat proportional to oracle disagreement frequency.

---

#### CA-27: `ClusterBalanceUpdated` Emitted for SSV Clusters With Unchanged State

**Severity:** Low
**Type:** Event Correctness
**Location:** `contracts/modules/SSVClusters.sol:411-416`
**Resolution:** Open

**Source:** z_behavioral_state.md (F-5)

**Description:**

In `_updateClusterBalanceInternal`, for `VERSION_SSV` clusters only the EB snapshot is updated — no fee accounting occurs. The `ClusterBalanceUpdated` event fires unconditionally with the unmodified `cluster` struct. The SSV oracle subscribes to this event and receiving it for an SSV cluster with unchanged balance could confuse off-chain indexers.

---

#### CA-28: `claimEthRewards` Dual Balance Check Redundancy

**Severity:** Low
**Type:** Code Quality
**Location:** `contracts/modules/SSVStaking.sol:137-141`
**Resolution:** Open

**Source:** z_staking_audit_report.md (Finding #4)

**Description:**

`claimEthRewards` checks payout against both `stakingEthPoolBalance` AND `ethDaoBalance`. After `_syncFees`, these values should be equal. If they diverge (transient cross-module interaction), legitimate claims could be blocked — though divergence is self-correcting on next `_syncFees` call.

---

### INFO

---

#### CA-29: Dead Code in `_executeLiquidation` Wrong Accounting Direction

**Severity:** Info
**Type:** Code Quality
**Location:** `contracts/modules/SSVClusters.sol:552, 573-591`
**Resolution:** Open

**Source:** z_semantic_guard_scan.md (SGA-04)

**Description:**

The deviation accounting block handles `vUnitsCluster < baselineVUnits` by ADDING deviation to `daoTotalEthVUnits` and `operatorEthVUnits` — wrong direction. This case is unreachable because `_verifyEBLimits` enforces `effectiveBalance >= 32 ETH/validator`, so `vUnitsCluster >= baselineVUnits` always holds. If the code were ever reached due to future EB limit changes, accounting would be incorrect.

**Recommendation:** Remove the dead `else` branch.

---

#### CA-30: `rescueERC20` No Module-Level Access Control

**Severity:** Info
**Type:** Access Control
**Location:** `contracts/modules/SSVStaking.sol:156`
**Resolution:** Open (proxy-level `onlyOwner` sufficient)

**Source:** z_semantic_guard_scan.md (SGA-05)

**Description:**

`rescueERC20` relies exclusively on the proxy-level `onlyOwner` modifier. The delegatecall architecture means calling the module directly operates on the module's own empty storage, not the proxy's — direct module calls cannot drain proxy assets.

---

#### CA-31: CLAUDE.md Stale Docs on `reactivate` nonReentrant

**Severity:** Info
**Type:** Documentation
**Location:** CLAUDE.md, Security Rules section
**Resolution:** Open

**Source:** z_semantic_guard_scan.md (SGA-06)

**Description:**

CLAUDE.md states `reactivate` is "Intentionally NOT protected" but in the code at `SSVClusters.sol:132`, `reactivate` IS protected with `nonReentrant`. Documentation is stale and could mislead auditors.

---

#### CA-32: No SafeCast Library Used Anywhere

**Severity:** Info
**Type:** Arithmetic Safety
**Location:** Multiple (~50+ casts across codebase)
**Resolution:** Open

**Source:** z_input_arithmetic_safety_scan.md (Finding 8)

**Description:**

The codebase performs ~50+ explicit downcasts without using OpenZeppelin's SafeCast. Most casts are safe due to value constraints (e.g., `uint32(block.number)` won't overflow for ~1,600 years), but the absence of SafeCast means future changes widening value ranges could silently introduce truncation bugs. The most concerning casts (`uint128 -> uint64` in OperatorLib and ProtocolLib) are covered by CA-01 and CA-04.

---

#### CA-33: Rounding Direction Analysis

**Severity:** Info
**Type:** Arithmetic Safety
**Resolution:** No vulnerability

**Source:** z_input_arithmetic_safety_scan.md (Finding 10)

**Description:**

All rounding directions were verified. Cluster fee deductions round down (user-favorable). Staking rewards and DAO earnings round down (protocol-favorable). `ebToVUnits` rounds up (protocol-favorable). This asymmetry is standard and the rounding dust is immaterial.

---

#### CA-34: `_syncFees` Defensive `current < previous` Path

**Severity:** Info
**Type:** Code Quality
**Location:** `contracts/modules/SSVStaking.sol:191-194`
**Resolution:** Open

**Source:** z_staking_audit_report.md (Finding #5)

**Description:**

If `current < previous` (which shouldn't happen under normal invariants), the pool balance is silently reduced without reverting. This path is unreachable under correct protocol operation, but if triggered by a bug in another module, staker rewards would be silently lost.

**Recommendation:** Add a revert when `current < previous` to fail loudly.

---

#### CA-35: `onCSSVTransfer` Virtual Modifier Override Risk

**Severity:** Info
**Type:** Upgrade Safety
**Location:** `contracts/modules/SSVStaking.sol:173`
**Resolution:** Open

**Source:** z_staking_audit_report.md (Finding #6)

**Description:**

The `virtual` keyword allows overriding in derived contracts. If a future upgrade overrides `onCSSVTransfer` without proper reward settlement, it could break the accumulator pattern. The unused `amount` parameter may confuse future developers.

---

#### CA-36 through CA-43: Informational Non-Findings

The following were verified as safe or not applicable:

| ID | Description | Source | Verdict |
|----|-------------|--------|---------|
| CA-36 | Flash loan attack surface on core cluster operations | z_oracle_flashloan_scan.md (F4) | No vulnerability — no market-price oracles |
| CA-37 | Circular price dependencies | z_oracle_flashloan_scan.md (F5) | None exist |
| CA-38 | Oracle replacement mid-round voting | z_oracle_flashloan_scan.md (F6) | Correctly handled |
| CA-39 | ETH transfer pattern (push payments) | z_external_call_scan.md (F4) | Correctly implemented with CEI + nonReentrant |
| CA-40 | `delegatecall` usage | z_external_call_scan.md (F5) | Trusted targets only, owner-controlled |
| CA-41 | No approve race conditions | z_external_call_scan.md (F6) | Clean |
| CA-42 | Fee-on-transfer / rebasing token compatibility | z_external_call_scan.md (F7) | Not applicable — only known tokens |
| CA-43 | Oracle `hasVoted` storage never cleaned | z_dos_griefing_scan.md (F5) | By design, acceptable growth (~1,460 slots/year) |

---

## Cross-Reference Index

This table maps each consolidated finding back to its source report(s) for traceability.

| CA ID | STATE-INVARIANT | behavioral_state | input_arithmetic | scv-scan | semantic_guard | staking_audit | oracle_flashloan | dos_griefing | external_call |
|-------|----------------|-----------------|-----------------|----------|---------------|--------------|-----------------|-------------|--------------|
| CA-01 | SIV-01 | F-3 | Finding 2 | — | — | Finding #2 | — | — | — |
| CA-02 | SIV-04 | F-1 | — | — | — | Finding #3 | — | — | — |
| CA-03 | SIV-02 | — | — | — | — | — | — | — | — |
| CA-04 | — | — | Finding 1 | SCV-05 | — | — | — | — | — |
| CA-05 | — | F-2 | — | — | — | — | — | — | — |
| CA-06 | — | — | Finding 3 | SCV-01 | — | — | — | — | — |
| CA-07 | — | — | — | SCV-02 | — | — | — | — | — |
| CA-08 | — | — | — | SCV-06 | SGA-01 | — | — | — | — |
| CA-09 | — | — | Finding 9 | SCV-04 | — | Finding #1 | — | — | — |
| CA-10 | — | — | — | — | — | — | Finding 2 | — | — |
| CA-11 | — | — | — | — | — | — | — | Finding 1 | — |
| CA-12 | — | — | — | — | — | — | — | Finding 2 | Finding 2 |
| CA-13 | — | — | — | — | — | — | — | Finding 3 | — |
| CA-14 | — | — | — | — | SGA-02 | — | — | — | Finding 3 |
| CA-15 | — | — | Finding 7 | — | SGA-03 | — | — | — | — |
| CA-16 | SIV-03 | — | — | — | — | — | — | — | — |
| CA-17 | SIV-05 | — | — | — | — | Finding #4b | — | — | — |
| CA-18 | — | — | Finding 4 | SCV-03 | — | — | — | — | — |
| CA-19 | — | — | Finding 5 | — | — | — | — | — | — |
| CA-20 | — | — | Finding 6 | — | — | — | — | — | — |
| CA-21 | — | — | — | — | — | — | Finding 1 | — | — |
| CA-22 | — | — | — | — | — | — | Finding 3 | — | — |
| CA-23 | — | — | — | — | — | — | — | — | Finding 1 |
| CA-24 | — | — | — | — | — | — | — | — | Finding 2 |
| CA-25 | — | — | — | — | — | — | — | Finding 4 | — |
| CA-26 | — | F-4 | — | — | — | — | — | — | — |
| CA-27 | — | F-5 | — | — | — | — | — | — | — |
| CA-28 | — | — | — | — | — | Finding #4 | — | — | — |

---

## Statistics

| Severity | Total | Open | Already Fixed/Closed | Mitigated by Design |
|----------|-------|------|---------------------|-------------------|
| Medium-High | 1 | 0 | 1 | 0 |
| Medium | 12 | 5 | 5 | 2 |
| Low | 15 | 8 | 4 | 1 |
| Info | 15 | 6 | 0 | 0 |
| **Total** | **43** | **19** | **10** | **3** |

**Unique actionable findings (Open, Medium or above):** 5
