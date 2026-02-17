---
title: SSV Staking System Deep Audit

---

# SSV Staking System Deep Audit: cSSV Token, Rewards & Fee Flow

**Branch:** ssv-staking (commit a613f61)
**Scope:** `SSVStaking.sol`, `CSSVToken.sol`, `SSVStorageStaking.sol`, reward accumulator, unstake queue, E2E fee flow
**Date:** 2026-02-12
**Workers:** 4 parallel audit streams (reward economics, cSSV token safety, unstake queue, fee flow E2E)

---

## Executive Summary

Deep audit of the staking subsystem — the Synthetix-style `accEthPerShare` reward accumulator, cSSV token mechanics, unstake queue, and end-to-end fee flow from cluster operations to staker claims.

**Solvency: PROVEN SAFE.** The invariant `contract.balance = Σ(cluster_balances) + Σ(operator_balances) + staker_network_fees` holds across all operations. Operators and stakers draw from separate accounting buckets and cannot drain each other.

**Unstake Queue: VERIFIED CORRECT.** The swap-and-pop implementation in `calculateTotalUnfrozenBalance` handles all edge cases correctly. Balance accounting is properly ordered (settle before burn). The contract maintains solvency invariants across stake/unstake/withdraw flows.

**1 HIGH, 4 MEDIUM, 10 LOW, 9 INFORMATIONAL findings.** The primary concern is rewards permanently lost during zero-staker periods (HIGH). The `onCSSVTransfer` missing `nonReentrant` guard (MEDIUM) is the most important fix. Fee frontrunning was initially flagged HIGH but downgraded to LOW given the 7-day default cooldown.

---

## Findings

### S-H1: Rewards Lost Forever When Fees Accrue with `totalStaked == 0`

**Severity:** HIGH
**Location:** `SSVStaking.sol:195-201`
**Workers:** reward-economics, fee-flow-e2e (both flagged independently)

When `_syncFees` runs with no cSSV in circulation (`totalSupply == 0`), the code skips the `accEthPerShare` increment (correct — can't divide by zero) but **still advances** `stakingEthPoolBalance = current`. This means the fee delta is acknowledged but credited to nobody. Those ETH rewards are permanently stranded.

```solidity
uint256 totalStaked = ICSSVToken(CSSV_ADDRESS).totalSupply();
if (totalStaked != 0) {
    newFeesWei = PackedETHLib.unpack(packedNewFees);
    s.accEthPerShare += uint128((newFeesWei * PRECISION) / totalStaked);
}
s.stakingEthPoolBalance = current;  // ← advances even when totalStaked == 0
```

**Scenario:**
1. All stakers unstake. `totalStaked == 0`.
2. Network fees continue accruing (validators still paying). Say 7 ETH over a week.
3. `_syncFees` fires → `stakingEthPoolBalance` jumps by 7 ETH, `accEthPerShare` unchanged.
4. Alice stakes. Her `userIndex = accEthPerShare` (unchanged). She cannot claim those 7 ETH.
5. The 7 ETH are permanently locked in the contract.

**Impact:** Permanent loss of protocol revenue during any zero-staker window. Includes the bootstrap phase before the first staker and any gap between the last unstake and next stake.

**Fix:** Only advance `stakingEthPoolBalance` when fees are actually distributed:
```solidity
if (totalStaked != 0) {
    newFeesWei = PackedETHLib.unpack(packedNewFees);
    s.accEthPerShare += uint128((newFeesWei * PRECISION) / totalStaked);
    s.stakingEthPoolBalance = current;  // only advance when distributed
}
// else: leave stakingEthPoolBalance unchanged so fees carry forward
```

#### Resolution:

Clarification: Zero-Staker Fee Accrual Semantics

Under the current implementation:

- If `totalStaked == 0`, `_syncFees`:
  - Advances `stakingEthPoolBalance`
  - Does **not** update `accEthPerShare`
- As a result:
  - ETH fees accrued during this period are **not distributed**
  - Future stakers **cannot claim** those past rewards
  - The ETH remains in the contract but is economically unassigned

This includes:
- The bootstrap phase after upgrade (before the first staker joins)
- Any period where all stakers fully unstake and fees continue accruing

Importantly:

> The first staker who joins after a zero-staker window does **not** receive past rewards.

They only begin accruing rewards from the moment they stake.

The suggested fix (not advancing `stakingEthPoolBalance` when `totalStaked == 0`) would cause accrued fees to remain pending.

When staking resumes, the first staker(s) would receive the entire backlog.

This creates:

- A **first-staker windfall**
- Incentive misalignment
- Reward semantics inconsistent with “earn from the moment you stake”

**Recommended Resolution**

To preserve the intended rule:

> Rewards accrue only to participants who are actively staking at the time fees are generated.

We propose introducing a **separate unallocated fees bucket**, governed by the DAO.

Proposed Behavior

When `_syncFees` runs:

```solidity
if (totalStaked != 0) {
    s.accEthPerShare += ...
} else {
    s.unallocatedFees += newFeesWei;
}

s.stakingEthPoolBalance = current;
```

Benefits:
- Preserves non-retroactive reward semantics
- Prevents first-staker windfalls
- Avoids permanently stranded ETH
- Makes zero-staker handling explicit and transparent
- Allows DAO governance over unallocated funds and:
    - Transfer to DAO treasury 
    - Use as a protocol insurance buffer
    - Burn or redistribute 

---

### S-M1: `onCSSVTransfer` Missing `nonReentrant` Guard

**Severity:** MEDIUM
**Location:** `SSVStaking.sol:169-177`
**Workers:** reward-economics, cssv-token-safety (both flagged independently)

`onCSSVTransfer()` is the **only** external state-mutating function in SSVStaking without `nonReentrant`. Every other function (`stake`, `requestUnstake`, `withdrawUnlocked`, `claimEthRewards`, `syncFees`, `rescueERC20`) has it. The reentrancy guard uses a shared storage slot (`SSVStorageReentrancy`), meaning `nonReentrant` protects across all module delegatecalls — but `onCSSVTransfer` is explicitly opted out.

**Concrete attack path analyzed:**
1. Attacker calls `claimEthRewards()` → `nonReentrant` lock acquired
2. `_settle` runs, `accrued[attacker]` credited, `userIndex` updated
3. `CoreLib.transferBalance` sends ETH via raw `.call{value:}("")`
4. Attacker's `receive()` triggers cSSV `transfer()` → `_beforeTokenTransfer` → `onCSSVTransfer`
5. `onCSSVTransfer` enters freely (no `nonReentrant`)
6. `_settle(attacker)` runs again — but `userIndex` was already updated, so `pending = 0`

**Currently safe by accident** — the ordering of state updates prevents double-claim in this specific path. But this is a defense-in-depth failure:
- Future code changes altering settlement ordering would be immediately exploitable
- Cross-function reentrancy with other modules (delegatecall shares storage) could open new vectors
- The reentrancy guard pattern is broken for this one function

**Fix:** Add `nonReentrant` to `onCSSVTransfer`. Verify no legitimate flow calls `onCSSVTransfer` while the lock is held (none should — `claimEthRewards` sends ETH, and recipients shouldn't need to transfer cSSV in the callback).


#### Resolution:

Let's add the `nonReentrant` modifier.

---

### S-M2: Governance Can Set Cooldown to Zero

**Severity:** MEDIUM
**Location:** `SSVDAO.sol:245-248`, `SSVStaking.sol:88`

`setUnstakeCooldownDuration` accepts any `uint64` value including 0. A zero cooldown makes unstake requests instantly withdrawable, which:
1. Eliminates the economic security the cooldown provides
2. Enables risk-free fee frontrunning (S-L1 becomes HIGH if cooldown == 0)
3. Removes the commitment signal staking is meant to provide

```solidity
// SSVDAO.sol:245
function setUnstakeCooldownDuration(uint64 duration) external override {
    SSVStorageStaking.load().cooldownDuration = duration;  // no minimum enforced
}
```

Note: Existing pending requests retain their original `unlockTime`. Only new requests get the zero cooldown.

**Fix:** Enforce a minimum:
```solidity
uint64 private constant MIN_COOLDOWN = 1 days;
if (duration < MIN_COOLDOWN) revert CooldownTooShort();
```

#### Resolution:

This has reduced scope because only the DAO can call this function but anyway we are in the process of putting guards on DAO-governed functions.

---

### S-M3: `PRECISION` Declared as `uint64` — Maintenance Footgun

**Severity:** MEDIUM
**Location:** `SSVStaking.sol:22, 198`

`PRECISION` is `uint64 private constant PRECISION = 1e18`. While `1e18` fits in `uint64`, declaring it as `uint64` is misleading. The real risk is the `uint128` cast on the accumulator delta:

```solidity
s.accEthPerShare += uint128((newFeesWei * PRECISION) / totalStaked);
```

If the result exceeds `type(uint128).max` (~3.4e38), it silently truncates. With `MINIMAL_STAKING_AMOUNT = 1e9`:
- `newFeesWei = 1e18` (1 ETH): `1e18 * 1e18 / 1e9 = 1e27` — safe
- `newFeesWei = 340e18` (340 ETH): `3.4e29` — safe but margin tightens over protocol lifetime

Under current parameters, overflow is impractical. But declaring `PRECISION` as `uint64` is a code-quality footgun — a future refactoring to use `PRECISION` in a `uint64`/`uint128` context would silently truncate.

**Fix:** Change `PRECISION` to `uint256`. Add overflow check on the `uint128` cast.

#### Resolution:

That's fair, let's increase the type of PRECISION.

---

### S-M4: Dual-Tracking Fragility (`ethDaoBalance` ↔ `stakingEthPoolBalance`)

**Severity:** MEDIUM
**Location:** `SSVStaking.sol:139-141`, `SSVStaking.sol:179-203`

`ethDaoBalance` and `stakingEthPoolBalance` are independently tracked but must remain synchronized. `claimEthRewards` decrements both by the same payout amount. `_syncFees` sets both to `networkTotalEarnings()`.

The `current - previous` delta in `_syncFees` is algebraically correct:
```
new_current = (old_ethDaoBalance - claimed) + new_unsettled
new_previous = old_stakingEthPoolBalance - claimed
delta = new_current - new_previous = new_unsettled  (claim amounts cancel)
```

But this creates a tight invariant: any future code path that modifies `ethDaoBalance` without correspondingly updating `stakingEthPoolBalance` breaks the delta computation. Currently all paths maintain this, but it's fragile.

**Related:** There is no `withdrawNetworkETHEarnings` function — 100% of ETH network fees flow to stakers. This is intentional. But if DAO ETH extraction is ever added, it must coordinate with `stakingEthPoolBalance`.

**Fix:** Document the coupling invariant prominently. Consider eliminating dual-tracking by computing rewards purely from `networkTotalEarnings()` delta.

#### Resolution:

Checking the code, I'm 90% sure we can use only 1 of them.

Proposed changes:
- Remove `stakingEthPoolBalance` from `SSVStorageStaking` (deprecate on testnet)
- Update all references to use `ethDaoBalance` directly
- Delta calulation:

```solidity
function _syncFees(StorageStaking storage s) internal {
    StorageProtocol storage sp = SSVStorageProtocol.load();
    PackedETH current = sp.networkTotalEarnings();
    PackedETH previous = sp.ethDaoBalance;  // Current becomes previous
    
    sp.ethDaoBalance = current;
    sp.ethDaoIndexBlockNumber = uint32(block.number);
    
    if (current.lte(previous)) {
        return;  // No new fees
    }
    
    PackedETH packedNewFees = current.sub(previous);
    // ... rest of logic
}
```

---

### S-L1: Fee Frontrunning via Just-in-Time Staking

**Severity:** LOW (downgraded from HIGH — see note)
**Location:** `SSVStaking.sol:34-61, 66-94, 114-145`
**Workers:** reward-economics, cssv-token-safety, unstake-queue (all flagged)

An attacker can frontrun a large `syncFees` transaction to capture a disproportionate share of fees:
1. Observe pending fee accumulation (read `networkTotalEarnings()` vs `stakingEthPoolBalance`)
2. Frontrun: `stake(large_amount)` → inflates share of `totalSupply`
3. `syncFees` distributes fees proportionally to attacker's inflated share
4. `claimEthRewards()` → extract ETH
5. `requestUnstake()` → burn cSSV and start cooldown

**Numeric example:** With 1M cSSV existing and 10 ETH pending, attacker stakes 9M SSV → captures 9 ETH (90%) of rewards that should go to long-term stakers.

**Severity downgrade rationale:** The default `cooldownDuration` is 604,800 seconds (7 days). The attacker's SSV capital is locked for 7 days after unstaking, making the opportunity cost significant. At current SSV prices, tying up 9M SSV for 7 days to capture a few ETH is uneconomical. The attack only becomes viable if:
- Cooldown is reduced to 0 by governance (see S-M2)
- Fee accumulations are extremely large (many blocks since last sync)

If S-M2 is fixed (minimum cooldown enforced), this finding is effectively mitigated.

**Fix (defense in depth):** Consider a warmup period — stakers don't earn rewards for the first N blocks after staking. Or implement time-weighted average balance for reward calculations.

#### Resolution:

Rewards already reflected in `accEthPerShare` cannot be captured by late entrants (no retroactive rewards).

They can capture the delta:
```
current - stakingEthPoolBalance
```

That is fees generated since the last sync not yet attributed to anyone.

If a large fee delta exists, then whoever stakes right before the sync shares it.

So the scenario to test is:

1M stakers exist
10 ETH has accrued since last sync (because nobody interacted)
Attacker stakes 9M right before a sync-triggering call
sync runs → attacker gets ~90%


How realistic is this ?

Because `_syncFees()` runs on every action, the pending window is small.

So this becomes:
A theoretical MEV edge only meaningful if:
- fees spike suddenly
- staking activity is low
- attacker can time entry before the next sync

The cooldown also makes it expensive.

---

### S-L2: `_syncFees` Silently Discards on Balance Regression

**Severity:** LOW
**Location:** `SSVStaking.sol:186-189`

When `current <= previous`, the function sets `stakingEthPoolBalance = current` and returns — potentially **decreasing** the pool balance without distributing fees and without emitting a warning.

Under current code, this only triggers legitimately (claim reduces both balances in lockstep). But the silent handler creates a future risk — any new code path that decreases `ethDaoBalance` without coordinating `stakingEthPoolBalance` would silently drop rewards.

**Fix:** Emit a distinct event on `current < previous` (strict inequality — not ≤):
```solidity
if (current.lt(previous)) emit UnexpectedBalanceRegression(current, previous);
```

---

### S-L3: Silent `uint192` Downcast in `requestUnstake`

**Severity:** LOW
**Location:** `SSVStaking.sol:89`

The `amount` parameter is `uint256` but stored as `uint192` in `UnstakeRequest`:
```solidity
requests.push(UnstakeRequest({amount: uint192(amount), unlockTime: unlockTime}));
```

If `amount > type(uint192).max` (~6.27e57), the cast silently truncates. The user's cSSV would be burned for the full amount but the withdrawal request records only the truncated value — permanent loss.

**Practical impact:** Near-zero. SSV total supply is ~11M tokens (11e24 wei), far below `type(uint192).max`.

**Fix:** Add checked cast: `if (amount > type(uint192).max) revert AmountTooLarge();`

#### Resolution

No changes, impractical

---

### S-L4: No Minimum Unstake Amount

**Severity:** LOW
**Location:** `SSVStaking.sol:66-94`

`stake()` enforces `MINIMAL_STAKING_AMOUNT = 1_000_000_000` but `requestUnstake()` only checks for zero. A user could create 1-wei unstake requests (up to MAX_PENDING_REQUESTS = 10 per address).

**Impact:** Minimal — the MAX_PENDING_REQUESTS cap prevents meaningful gas griefing.

#### Resolution

Not related to this, but need to upgrade to set `MAX_PENDING_REQUESTS = 2000`

---

### S-L5: Rounding Dust Systematically Lost in `accEthPerShare`

**Severity:** LOW
**Location:** `SSVStaking.sol:198`
**Workers:** reward-economics, cssv-token-safety, fee-flow-e2e (all noted)

Integer division truncation in `(newFeesWei * PRECISION) / totalStaked` means `stakingEthPoolBalance` reports more ETH than can ever be claimed. The loss per sync is at most `totalStaked - 1` precision units — negligible in absolute terms (~1 wei/sync with 3 cSSV, ~7200 wei/day at 12s blocks).

Creates an accounting discrepancy where the last claimant might face `InsufficientBalance` even with theoretical entitlement.

#### Resolution

Valid. Consider a DAO-governed function to recover the dust?

---

### S-L6: Unclaimed Dust Below `ETH_DEDUCTED_DIGITS` Permanently Trapped

**Severity:** LOW
**Location:** `SSVStaking.sol:119-127`

Payout rounds down to 100,000 wei multiples: `payout = claimable - (claimable % ETH_DEDUCTED_DIGITS)`. Dust stays in `accrued[user]` and compounds with future rewards. But if a user unstakes all cSSV with < 100,000 wei remaining, that dust is permanently trapped — no future rewards to push it above the threshold.

~50,000 wei ≈ $0.000002 at $40/ETH per user. Negligible individually, but aggregate across thousands of users could be non-trivial.

#### Resolution

Measure real numbers. Consider a DAO-governed function to recover the dust?

---

### S-L7: `userIndex` Storage Type Mismatch

**Severity:** LOW
**Location:** `SSVStorageStaking.sol:23`, `SSVStaking.sol:211-222`

`accEthPerShare` is `uint128` but `userIndex` is `mapping(address => uint256)`. The upper 128 bits of `userIndex` are always zero — wastes a full storage slot.

#### Resolution

No gas or storage savings when downgrading value type for `userIndex` to `uint128`.

---

### S-L8: CSSVToken Deployment Configuration Critical

**Severity:** LOW
**Location:** `CSSVToken.sol:14, 27`

CSSVToken's `ssvStaking` immutable must be the **SSVNetwork proxy address** (not the SSVStaking implementation). If misconfigured:
- The `msg.sender != ssvStaking` skip condition would fail during mint/burn
- `onCSSVTransfer` would fire during mint/burn operations, corrupting settlement

This is a deployment-time concern, not a runtime bug.

**Fix:** Add deployment validation (or test) ensuring `CSSVToken.ssvStaking == SSVNetwork proxy`.

#### Resolution

Ok let´s add it.

---

### S-L9: `rescueERC20` Missing Access Control on Implementation

**Severity:** LOW
**Location:** `SSVStaking.sol:150` vs `SSVNetwork.sol:225`

The proxy gates `rescueERC20` with `onlyOwner`, but the SSVStaking implementation only has `nonReentrant`. If someone calls the implementation directly, there's no owner check. However, the implementation contract shouldn't hold any tokens in practice.

#### Resolution

SSV modules are intended to work in the context of the SSVNetwork proxy.

---

### S-L10: Transfer to Staking/Token Contract — Unrecoverable cSSV

**Severity:** LOW
**Location:** `CSSVToken.sol:26-29`, `SSVStaking.sol:150-164`

cSSV transferred to the SSVNetwork proxy or CSSVToken contract is permanently lost:
- `rescueERC20` explicitly blocks cSSV rescue (`token == CSSV_ADDRESS` check)
- CSSVToken has no rescue function
- The proxy would "earn" ETH rewards that nobody can claim, diluting other stakers

**Fix:** Add recipient check in `_beforeTokenTransfer`:
```solidity
if (to == address(this) || to == ssvStaking) revert InvalidRecipient();
```

#### Resolution

Valid issue, we should implement the fix.


---

### S-I1: Swap-and-Pop Queue Logic — VERIFIED CORRECT

**Severity:** Informational
**Location:** `SSVStaking.sol:226-241`

Verified all edge cases of `calculateTotalUnfrozenBalance`:

| Scenario | Result |
|----------|--------|
| Single request, unlocked | Correct: removes, returns amount |
| Multiple requests, first unlocked | Correct: swaps last in, re-checks at same index |
| All unlocked | Correct: processes all, returns sum |
| None unlocked | Correct: returns 0 |
| Swapped-in element also unlocked | Correct: `i` not incremented, re-checked |

Key design: `i` only increments in the `else` branch. Swapped-in elements are always re-checked.

---

### S-I2: Balance Accounting Ordering — VERIFIED CORRECT

**Severity:** Informational
**Location:** `SSVStaking.sol:66-94`

`requestUnstake` ordering is correct:
1. `_syncFees` → update global `accEthPerShare`
2. `_settleWithBalance(user, bal)` → credit rewards using **pre-burn** cSSV balance
3. `requests.push(...)` → record unstake request
4. `burn(user, amount)` → burn cSSV, reducing `totalSupply`

The burn does NOT trigger `_beforeTokenTransfer` hook (`to == address(0)` guard). No double-settlement.

---

### S-I3: Contract Solvency — PROVEN SAFE

**Severity:** Informational
**Location:** `SSVStaking.sol` (multiple), `SSVClusters.sol`, `OperatorLib.sol`, `ProtocolLib.sol`

**Proven invariant:**
```
contract.balance = Σ(cluster_balances) + Σ(operator_balances) + staker_network_fees
```

**Proof by invariant maintenance across all operations:**
- **ETH deposit:** `contract.balance += msg.value`, `cluster.balance += msg.value`
- **Fee accrual:** Zero-sum internal transfer (cluster → operator + DAO)
- **Cluster withdrawal:** Both sides decrease equally
- **Operator withdrawal:** Both sides decrease equally
- **Staker claim:** Both sides decrease equally
- **Liquidation:** Fees settled first, residual to liquidator

**Operators cannot drain staker ETH. Stakers cannot drain operator ETH.** They draw from separate accounting buckets that sum to ≤ `contract.balance`.

Additionally verified:
- No double-counting between operator and network fee indices (independently maintained, never overlap)
- `rescueERC20` blocks SSV and cSSV tokens
- Liquidation properly settles fees before paying liquidator

---

### S-I4: Pre-Transfer Settlement — CORRECT BY DESIGN

**Severity:** Informational
**Location:** `CSSVToken.sol:26-29`, `SSVStaking.sol:169-177`

The `_beforeTokenTransfer` hook fires before ERC20 balance updates (OpenZeppelin design). `onCSSVTransfer` settles both `from` and `to` with pre-transfer balances. This is **correct**: Alice earns rewards on tokens she held up to this point, Bob starts earning on new tokens from this point forward.

---

### S-I5: Reward Flow After Full Unstake — VERIFIED CORRECT

**Severity:** Informational

Verified: `requestUnstake(all) → claimEthRewards → withdrawUnlocked`:
1. `requestUnstake`: `_settle` credits rewards on full balance, burns all cSSV. `accrued[user]` has all earned rewards.
2. `claimEthRewards`: `_settle` runs with `bal = 0` → `pending = 0`. Claims from `accrued[user]`. Correct.
3. `withdrawUnlocked`: Returns SSV tokens. No reward interaction.

Between `requestUnstake` and `withdrawUnlocked`, user earns no additional rewards (cSSV balance = 0). The cooldown is purely a time-lock, not continued staking.

---

### S-I6: MAX_PENDING_REQUESTS Gas Griefing Prevention — VERIFIED

**Severity:** Informational
**Location:** `SSVStaking.sol:23, 84`

`MAX_PENDING_REQUESTS = 10` ensures `calculateTotalUnfrozenBalance` iterates at most 10 elements (bounded gas).

---

### S-I7: cSSV Transfer Hook Settlement — VERIFIED CORRECT

**Severity:** Informational
**Location:** `CSSVToken.sol:26-31`

The `_beforeTokenTransfer` hook correctly fires for user-to-user transfers but NOT for mint/burn:
- Mint (`from == address(0)`): skipped — settlement handled explicitly in `stake()`
- Burn (`to == address(0)`): skipped — settlement handled explicitly in `requestUnstake()`
- Self-transfer (`from == to`): skipped — no balance change, mathematically safe
- Transfer from staking module (`msg.sender == ssvStaking`): skipped — prevents re-entry during mint/burn via delegatecall

---

### S-I8: `accEthPerShare` Overflow — Theoretical Only

**Severity:** Informational

With `MINIMAL_STAKING_AMOUNT = 1e9` and realistic fees of ~1 ETH/sync:
- Delta per sync: `1e18 * 1e18 / 1e9 = 1e27`
- Syncs to overflow `uint128`: `3.4e38 / 1e27 = 3.4e11` ≈ 340 billion syncs
- At 1 sync/block, 12s/block: ~130,000 years

Not exploitable under any realistic scenario.

---

### S-I9: Redundant SSTORE and Event on No-Op Settle

**Severity:** Informational
**Location:** `SSVStaking.sol:205-224`

When `idx == userIdx`, `_settleWithBalance` still writes `s.userIndex[user] = idx` (same value) and emits `RewardsSettled` with `pending = 0`. Wastes ~5000 gas per redundant SSTORE + log emission.

**Fix:** Add early return: `if (idx == userIdx) return;`

#### Resolution

Test and consider adding it.

---

## Summary Table

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| **S-H1** | **HIGH** | Rewards lost forever when `totalStaked == 0` | Open — real bug |
| **S-M1** | **MEDIUM** | `onCSSVTransfer` missing `nonReentrant` | Open — most important fix |
| **S-M2** | **MEDIUM** | Governance can set cooldown to 0 | Open |
| **S-M3** | **MEDIUM** | `PRECISION` as `uint64` + unsafe `uint128` cast | Open |
| **S-M4** | **MEDIUM** | Dual-tracking fragility (`ethDaoBalance` ↔ `stakingEthPoolBalance`) | Open |
| S-L1 | Low | Fee frontrunning (mitigated by 7-day cooldown) | Open |
| S-L2 | Low | `_syncFees` silently discards on regression | Open |
| S-L3 | Low | Silent `uint192` downcast in `requestUnstake` | Open |
| S-L4 | Low | No minimum unstake amount | Open |
| S-L5 | Low | Rounding dust systematically lost | Open |
| S-L6 | Low | Unclaimed dust permanently trapped | Open |
| S-L7 | Low | `userIndex` type mismatch (uint256 vs uint128) | Open |
| S-L8 | Low | CSSVToken deployment configuration critical | Open |
| S-L9 | Low | `rescueERC20` access control on implementation | Open |
| S-L10 | Low | Transfer to staking/token → unrecoverable cSSV | Open |
| S-I1 | Info | Swap-and-pop queue logic | Verified Correct |
| S-I2 | Info | Balance accounting ordering | Verified Correct |
| S-I3 | Info | Contract solvency invariant | Proven Safe |
| S-I4 | Info | Pre-transfer settlement design | Correct by Design |
| S-I5 | Info | Reward flow after full unstake | Verified Correct |
| S-I6 | Info | MAX_PENDING_REQUESTS gas protection | Verified |
| S-I7 | Info | cSSV transfer hook settlement | Verified Correct |
| S-I8 | Info | `accEthPerShare` overflow (theoretical) | Not Exploitable |
| S-I9 | Info | Redundant SSTORE on no-op settle | Gas Optimization |

---

## Priority Recommendations

### P0 — Fix Before Mainnet

1. **S-H1: Don't advance `stakingEthPoolBalance` when `totalStaked == 0`** — Move `stakingEthPoolBalance = current` inside the `if (totalStaked != 0)` block. This prevents permanent loss of rewards during zero-staker windows.

2. **S-M1: Add `nonReentrant` to `onCSSVTransfer`** — One-line fix that closes the only reentrancy surface in the staking module. Currently safe by accident, but any future change to settlement ordering makes this exploitable.

### P1 — Strongly Recommended

3. **S-M2: Enforce minimum cooldown** — Add `MIN_COOLDOWN` constant (e.g., 1 day). Without this, governance setting cooldown to 0 makes fee frontrunning (S-L1) risk-free.

4. **S-M3: Change `PRECISION` to `uint256`** — Prevents maintenance footguns. Add overflow check on `uint128` cast.

5. **S-L8: Validate CSSVToken deployment config** — Ensure `CSSVToken.ssvStaking == SSVNetwork proxy` (not implementation). Add a deployment test.

### P2 — Good to Have

6. **S-M4: Document dual-tracking invariant** — Add prominent comments explaining `ethDaoBalance` ↔ `stakingEthPoolBalance` coupling.

7. **S-L1: Consider warmup period** — Time-weighted balance for reward calculation prevents fee frontrunning regardless of cooldown.

8. **S-L3 / S-L4: Input validation** — Checked `uint192` cast, minimum unstake amount.

9. **S-L10: Block cSSV transfers to known-bad addresses** — Prevent accidental permanent loss.

10. **S-I9: Early return on no-op settle** — Gas optimization, ~5000 gas saved per redundant call.

### P3 — Informational / Accept

11. **S-L5, S-L6: Dust accounting** — Accept and document the sub-wei precision loss and per-user dust trap. Negligible financial impact.

12. **S-L7: `userIndex` type** — Accept or refactor in future upgrade.

---

## Verified Safe Properties

These areas were specifically investigated and confirmed correct:

1. **Solvency invariant** — Proven across all operations (deposit, fee accrual, withdrawal, liquidation, staker claim)
2. **No double-counting** — Operator and network fee indices are independently maintained and disjoint
3. **Swap-and-pop queue** — All edge cases verified, no element-skipping bug
4. **Balance ordering** — Settle-before-burn, settle-before-mint patterns are correct
5. **Transfer hook** — Correctly skips mint/burn/self-transfer, settles both parties on regular transfers
6. **Liquidation fees** — Properly settled before residual goes to liquidator
7. **No DAO ETH extraction** — 100% of ETH network fees flow to stakers (by design)
8. **PackedETH truncation** — Both sides of cluster/operator/DAO accounting use identical truncation, no micro-leaks