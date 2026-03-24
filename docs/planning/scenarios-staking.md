# Staking / Rewards Scenarios (ST-001 – ST-080)

> Generated from: `SSVStaking.sol`, `SSVStorageStaking.sol`, `ProtocolLib.sol`, `SPEC.md §3`, `FLOWS.md §5`

## Tag Legend

| Key | Values | Meaning |
|-----|--------|---------|
| `entry` | functionName | Contract entry point under test |
| `version` | `eth` / `ssv` / `both` | Fee version context |
| `eb` | `implicit` / `explicit` | Effective-balance mode (implicit = default 32 ETH) |
| `cluster` | `active` / `liquidated` / `migrated` / `none` | Cluster state required for fee generation |
| `ops` | `4` / `7` / `10` / `13` / `parametric` | Operator count |
| `remove_mode` | `real` / `mock_zero` / `mock_payout` / `none` | Validator-removal mock mode |
| `revert` | `yes` / `no` | Whether scenario expects a revert |

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| ST-001 | `stake(MINIMAL_STAKING_AMOUNT)` | Stake exact minimum amount; verify cSSV minted 1:1 | `entry:stake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:43-60 |
| ST-002 | `stake(MINIMAL_STAKING_AMOUNT - 1)` | Stake below minimum; expect `StakeTooLow` revert | `entry:stake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:44-46 |
| ST-003 | `stake(0)` | Stake zero amount; expect `StakeTooLow` revert | `entry:stake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:44-46 |
| ST-004 | `stake(1e24)` — large amount | Stake very large SSV amount; verify cSSV minted correctly, no overflow | `entry:stake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:43-60 |
| ST-005 | `stake` → verify `Staked` event | Stake and verify event parameters match amount and user | `entry:stake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:59 |
| ST-006 | `stake` → verify `RewardsSettled` event | First stake emits `RewardsSettled(user, 0, 0, 0)` (no prior balance) | `entry:stake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:51, 209-228 |
| ST-007 | `stake` without SSV approval | Stake when user has not approved SSV transfer; expect `TokenTransferFailed` revert | `entry:stake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:53-55 |
| ST-008 | `stake` with insufficient SSV balance | Stake more than user's SSV balance; expect transfer revert | `entry:stake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:53-55 |
| ST-009 | Two users `stake` → verify independent cSSV balances | Two users stake different amounts; each receives correct 1:1 cSSV | `entry:stake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:43-60 |
| ST-010 | `stake` twice by same user → cSSV additive | Same user stakes twice; cSSV balance = sum of both stakes | `entry:stake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:43-60 |
| ST-011 | `syncFees` with active clusters → `accEthPerShare` increases | Register cluster with validators, advance blocks, call `syncFees`; verify `accEthPerShare > 0` | `entry:syncFees; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:183-207, ProtocolLib.sol:84-89 |
| ST-012 | `syncFees` with no active clusters | No validators registered; `syncFees` updates `stakingEthPoolBalance` but `accEthPerShare` unchanged | `entry:syncFees; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:191-194 |
| ST-013 | `syncFees` with `totalStaked == 0` (no cSSV supply) | Fees accrue to DAO but `accEthPerShare` not updated (division by zero guarded); fees lost to stakers (BUG-6) | `entry:syncFees; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:199-203 |
| ST-014 | `syncFees` idempotent within same block | Two `syncFees` calls in same block; second is no-op (no new earnings) | `entry:syncFees; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:191-194 |
| ST-015 | `syncFees` → `FeesSynced` event emitted with correct values | Verify `FeesSynced(newFeesWei, accEthPerShare)` matches computed delta | `entry:syncFees; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:206 |
| ST-016 | `stake` → `syncFees` → `claimEthRewards` (full happy path) | Stake, register cluster, advance blocks, sync, claim; verify ETH received | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:113-151 |
| ST-017 | `stake` → advance many blocks → `claimEthRewards` | Stake, advance 1000 blocks with active cluster, claim; verify proportional rewards | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:113-151 |
| ST-018 | `claimEthRewards` with zero accrued | No fees accrued; expect `NothingToClaim` revert | `entry:claimEthRewards; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:120 |
| ST-019 | `claimEthRewards` — dust below `ETH_DEDUCTED_DIGITS`, user holds cSSV | Accrued < 100,000 wei, user has cSSV; `payout == 0`, revert `NothingToClaim`, remainder preserved | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:124-131 |
| ST-020 | `claimEthRewards` — dust below `ETH_DEDUCTED_DIGITS`, user has NO cSSV | Accrued < 100,000 wei, user has 0 cSSV; dust forfeited, `RewardsClaimed(user, 0)` emitted | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:124-131 |
| ST-021 | `claimEthRewards` — payout truncation correctness | Accrued = 1,234,567 wei → payout = 1,200,000 (truncated), remainder = 34,567 preserved | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:122, SPEC §3 |
| ST-022 | `claimEthRewards` — payout > 0, user has cSSV → remainder preserved | After claim, `accrued[user] == claimable - payout` (non-zero remainder kept) | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:144-145 |
| ST-023 | `claimEthRewards` — payout > 0, user has 0 cSSV → remainder zeroed | After full unstake + claim, any sub-100K remainder is forfeited | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:145 |
| ST-024 | `claimEthRewards` — `InsufficientBalance` on pool | Claim amount exceeds `stakingEthPoolBalance`; expect `InsufficientBalance` revert | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:137-139 |
| ST-025 | `claimEthRewards` — `InsufficientBalance` on `ethDaoBalance` | Claim amount exceeds `sp.ethDaoBalance`; expect `InsufficientBalance` revert | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:140-141 |
| ST-026 | `claimEthRewards` decrements both `stakingEthPoolBalance` and `ethDaoBalance` | After successful claim, verify both pool and DAO balances reduced by `packed(payout)` | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:146-147 |
| ST-027 | `claimEthRewards` twice — second claim reflects new accrual only | Claim once, advance blocks, claim again; second payout = fees accrued between claims | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:113-151 |
| ST-028 | `requestUnstake(amount)` — basic unstake request | Stake → requestUnstake; cSSV burned, `UnstakeRequest` created, `UnstakeRequested` event emitted | `entry:requestUnstake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:65-93 |
| ST-029 | `requestUnstake(0)` — zero amount revert | Expect `ZeroAmount` revert | `entry:requestUnstake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:66-68 |
| ST-030 | `requestUnstake` exceeding cSSV balance | Unstake more than cSSV balance; expect `UnstakeAmountExceedsBalance` revert | `entry:requestUnstake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:77-79 |
| ST-031 | `requestUnstake` — partial unstake | Stake 1000, unstake 400; verify cSSV balance = 600, unstake request amount = 400 | `entry:requestUnstake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:65-93 |
| ST-032 | `requestUnstake` — full unstake | Stake 1000, unstake 1000; verify cSSV balance = 0, rewards stop accruing | `entry:requestUnstake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:65-93 |
| ST-033 | `requestUnstake` settles rewards BEFORE burn | Verify settlement uses pre-burn cSSV balance; accrued reflects full staking period | `entry:requestUnstake; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:74-76, FLOWS §5.2 |
| ST-034 | `requestUnstake` — `unlockTime` = `block.timestamp + cooldownDuration` | Verify unlock time matches expected cooldown offset | `entry:requestUnstake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:87-88 |
| ST-035 | `requestUnstake` multiple times (up to 2000) | Create exactly 2000 unstake requests; all succeed without revert | `entry:requestUnstake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:81-85 |
| ST-036 | `requestUnstake` — 2001st request reverts | After 2000 pending requests, 2001st reverts with `MaxRequestsAmountReached` | `entry:requestUnstake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:83-85 |
| ST-037 | `requestUnstake` → withdraw some → request again under limit | Create 2000, withdraw some (freeing slots), request again; succeeds | `entry:requestUnstake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:81-85 |
| ST-038 | `withdrawUnlocked` — after cooldown expires | Stake → requestUnstake → advance past cooldown → withdrawUnlocked; SSV returned 1:1 | `entry:withdrawUnlocked; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:98-108 |
| ST-039 | `withdrawUnlocked` — before cooldown expires | Stake → requestUnstake → withdrawUnlocked immediately; expect `NothingToWithdraw` revert | `entry:withdrawUnlocked; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:101 |
| ST-040 | `withdrawUnlocked` — no pending requests | Call withdrawUnlocked with no requests; expect `NothingToWithdraw` revert | `entry:withdrawUnlocked; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:101 |
| ST-041 | `withdrawUnlocked` — mixed matured and immature requests | 3 requests: 2 matured, 1 immature; only matured amounts withdrawn, immature remains | `entry:withdrawUnlocked; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:230-245 |
| ST-042 | `withdrawUnlocked` — swap-and-pop does not skip entries | Create 5 requests with staggered cooldowns; mature 3; verify all 3 collected and 2 remain | `entry:withdrawUnlocked; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:230-245 |
| ST-043 | `withdrawUnlocked` — all requests matured | All pending requests past cooldown; total SSV returned, array emptied | `entry:withdrawUnlocked; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:230-245 |
| ST-044 | `withdrawUnlocked` — `UnstakedWithdrawn` event with correct amount | Verify event `UnstakedWithdrawn(user, totalAmount)` matches sum of matured requests | `entry:withdrawUnlocked; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:107 |
| ST-045 | Full lifecycle: `stake` → `requestUnstake` → wait → `withdrawUnlocked` | End-to-end: SSV in, cSSV minted, cSSV burned, wait cooldown, SSV out; balances conserved | `entry:withdrawUnlocked; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:43-108 |
| ST-046 | `onCSSVTransfer` — cSSV transfer settles both parties | Alice transfers cSSV to Bob; both `RewardsSettled` events emitted with correct indices | `entry:onCSSVTransfer; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:173-181 |
| ST-047 | `onCSSVTransfer` — sender's accrued rewards preserved after transfer | Alice earns rewards, transfers all cSSV to Bob; Alice's accrued stays non-zero and claimable | `entry:onCSSVTransfer; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:173-181, FLOWS §5.6 |
| ST-048 | `onCSSVTransfer` — receiver starts accruing from transfer block | Bob receives cSSV; only earns rewards from transfer block forward, not retroactively | `entry:onCSSVTransfer; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:173-181, FLOWS §5.6 |
| ST-049 | `onCSSVTransfer` — not called for mint/burn | During `stake` and `requestUnstake`, the hook is skipped (internal mint/burn); verify no double-settlement | `entry:onCSSVTransfer; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | FLOWS §5.6 |
| ST-050 | `onCSSVTransfer` — caller must be cSSV contract | Direct call to `onCSSVTransfer` from non-cSSV address; expect `NotCSSV` revert | `entry:onCSSVTransfer; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:174 |
| ST-051 | `onCSSVTransfer` — transfer between two existing stakers | Both hold cSSV and have accrued rewards; transfer settles both before balances change | `entry:onCSSVTransfer; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:173-181 |
| ST-052 | `rescueERC20` — rescue accidentally sent random ERC20 | Send random token to contract, rescue to recipient; verify balances | `entry:rescueERC20; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:156-168 |
| ST-053 | `rescueERC20` — cannot rescue SSV token | Attempt to rescue SSV; expect `InvalidToken` revert | `entry:rescueERC20; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:158-159 |
| ST-054 | `rescueERC20` — cannot rescue cSSV token | Attempt to rescue cSSV; expect `InvalidToken` revert | `entry:rescueERC20; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:158-159 |
| ST-055 | `rescueERC20` — zero address for token reverts | `token == address(0)`; expect `ZeroAddress` revert | `entry:rescueERC20; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:157 |
| ST-056 | `rescueERC20` — zero address for `to` reverts | `to == address(0)`; expect `ZeroAddress` revert | `entry:rescueERC20; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:157 |
| ST-057 | `rescueERC20` — zero amount reverts | `amount == 0`; expect `ZeroAmount` revert | `entry:rescueERC20; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:161-163 |
| ST-058 | `rescueERC20` — `ERC20Rescued` event emitted | Verify event parameters (token, to, amount) | `entry:rescueERC20; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:167 |
| ST-059 | `accEthPerShare` monotonicity invariant | Multiple `syncFees` calls across various states; `accEthPerShare` never decreases | `entry:syncFees; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:202, SPEC §7 |
| ST-060 | Two stakers — proportional reward distribution | Alice stakes 3x, Bob stakes 1x; after fee accrual, Alice gets 75%, Bob gets 25% | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:113-151, 209-228 |
| ST-061 | Three stakers — one exits, remaining two share future fees | A/B/C stake equally; C unstakes; future fees split 50/50 between A and B only | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:65-93, 113-151 |
| ST-062 | Large stake → tiny fee accrual → precision test | Stake 1e24 SSV, accrue 1 wei of fees; verify `accEthPerShare` rounds down, pending = 0 | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:202, 219-224 |
| ST-063 | Tiny stake → large fee accrual → precision test | Stake `MINIMAL_STAKING_AMOUNT`, accrue large fees; verify no overflow in `accEthPerShare` | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:202 |
| ST-064 | SSV pool balance conservation invariant | After stake, unstake, claim cycle: `contract SSV balance == Σ(staked - withdrawn)` | `entry:withdrawUnlocked; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:43-108, FLOWS §Global Invariants |
| ST-065 | cSSV supply accounting invariant | `cSSV.totalSupply() == Σ(staked) - Σ(unstake-requested)` at all points | `entry:requestUnstake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SPEC §6, FLOWS §Global Invariants |
| ST-066 | Cooldown duration change mid-unstake — existing requests unaffected | Owner changes `cooldownDuration` after request; existing request keeps original `unlockTime` | `entry:requestUnstake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:87-88 |
| ST-067 | Cooldown duration change — new requests use new duration | After owner updates cooldown, new requestUnstake uses new duration | `entry:requestUnstake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:87-88 |
| ST-068 | Stake → EB update changes fee flow → claim rewards | Stake, register ETH cluster, oracle updates EB (explicit), more blocks, claim; rewards reflect changed fee rate | `entry:claimEthRewards; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:113-151, ProtocolLib.sol:84-89 |
| ST-069 | `syncFees` when `current <= previous` (no new earnings) | Pool already up-to-date or DAO earnings unchanged; `accEthPerShare` unchanged, `stakingEthPoolBalance = current` | `entry:syncFees; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:191-194 |
| ST-070 | Staker claims after cluster liquidation | Cluster liquidated → no more fee accrual → staker claims whatever was accrued before liquidation | `entry:claimEthRewards; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:113-151, ProtocolLib.sol:84-89 |
| ST-071 | Multiple stakers, one liquidated cluster → proportional distribution correctness | Fee accrual stops at liquidation; staker rewards frozen at last `syncFees` before liquidation | `entry:claimEthRewards; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:113-151 |
| ST-072 | Reentrancy guard on `stake` | Attempt reentrant `stake` call; expect revert from `nonReentrant` | `entry:stake; version:eth; eb:implicit; cluster:none; ops:parametric; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:43 |
| ST-073 | Reentrancy guard on `claimEthRewards` | Attempt reentrant `claimEthRewards` call during ETH transfer callback; expect revert | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:113 |
| ST-074 | `requestUnstake` → `claimEthRewards` — partial unstake preserves remainder | Unstake half, claim rewards; remainder in `accrued` preserved because `balanceOf > 0` | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:145, FLOWS §5.2 |
| ST-075 | `requestUnstake` → `claimEthRewards` — full unstake forfeits dust | Unstake all, claim rewards; any sub-100K remainder zeroed because `balanceOf == 0` | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:145, FLOWS §5.2 |
| ST-076 | `stake` → `syncFees` with `totalStaked == 0` → `stake` again → claim | Fees accrued while `totalStaked == 0` are lost; second staker cannot claim those lost fees | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:199-203, SPEC BUG-6 |
| ST-077 | `_settle` idempotent — calling twice in same block is no-op | Two settle calls same block; second has `idx == userIdx`, pending = 0 | `entry:stake; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:214-228 |
| ST-078 | Concurrent stakers — verify `userIndex` tracks per-user correctly | 5 users stake at different blocks; each `userIndex` reflects their entry point | `entry:stake; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVStaking.sol:226 |
| ST-079 | Network fee update → `syncFees` → claim reflects new rate | Owner changes ETH network fee; subsequent `syncFees` uses new fee; staker claims at new rate | `entry:claimEthRewards; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | ProtocolLib.sol:40-46, SSVStaking.sol:183-207 |
| ST-080 | ETH transfer failure on `claimEthRewards` — `CoreLib.transferBalance` reverts | Recipient contract rejects ETH; expect revert | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVStaking.sol:149 |

---

## Detailed Scenario Blocks (12 Most Complex)

### ST-016: Full Happy Path — Stake → SyncFees → ClaimEthRewards

**Flow:** `stake` → register ETH cluster → advance blocks → `syncFees` → `claimEthRewards`

**Preconditions:**
- User A has approved and holds sufficient SSV tokens (>= `MINIMAL_STAKING_AMOUNT`)
- ETH network fee is set to a non-zero value
- At least one active ETH cluster exists with validators (to generate `networkTotalEarnings`)

**Steps:**
1. User A calls `stake(10_000_000_000)` (10 gwei SSV)
2. Verify `cSSV.balanceOf(A) == 10_000_000_000`
3. Register an ETH cluster with 4 operators and 1 validator (generates network fee accrual)
4. Advance 100 blocks via `vm.roll(block.number + 100)`
5. Call `syncFees()`
6. Verify `accEthPerShare > 0`
7. Verify `FeesSynced` event with correct `newFeesWei` and `accEthPerShare`
8. Call `claimEthRewards()`
9. Verify `RewardsClaimed(A, payout)` where `payout` is truncated to 100K-wei precision
10. Verify User A's ETH balance increased by `payout`
11. Verify `stakingEthPoolBalance` decreased by `packed(payout)`
12. Verify `sp.ethDaoBalance` decreased by `packed(payout)`

**Postconditions:**
- `accrued[A] == claimable - payout` (remainder, if any)
- `userIndex[A] == accEthPerShare`
- `contract.ETH_balance` decreased by `payout`

**Invariants:**
- `accEthPerShare` only increased
- `cSSV.totalSupply()` unchanged (no burn)

**File References:** `SSVStaking.sol:43-60, 113-151, 183-207`, `ProtocolLib.sol:84-89`

---

### ST-035: Max Pending Unstake Requests (2000 Limit)

**Flow:** `stake` large amount → loop 2000x `requestUnstake(1)`

**Preconditions:**
- User A holds at least 2000 units of cSSV (i.e., staked at least 2000 SSV wei above minimum)
- No prior pending unstake requests

**Steps:**
1. User A calls `stake(2_000_000_000_000)` — enough for 2000 requests of amount 1_000_000_000
2. Verify `cSSV.balanceOf(A) == 2_000_000_000_000`
3. Loop `i = 0..1999`: call `requestUnstake(1_000_000_000)`
4. After each: verify `withdrawalRequests[A].length == i + 1`
5. After 2000th: verify `cSSV.balanceOf(A) == 0`
6. Verify `cSSV.totalSupply() == 0`

**Postconditions:**
- `withdrawalRequests[A].length == 2000`
- All requests have `unlockTime == block.timestamp + cooldownDuration` (same block)
- cSSV fully burned

**Edge Cases:**
- Gas cost of 2000-iteration `withdrawUnlocked` call (swap-and-pop on full array)
- State consistency if some requests created in different blocks

**File References:** `SSVStaking.sol:65-93, 81-85`

---

### ST-036: 2001st Unstake Request Reverts

**Flow:** After 2000 pending requests → `requestUnstake` → revert

**Preconditions:**
- User A has 2000 pending unstake requests (none withdrawn)
- User A still holds some cSSV (staked more than was unstaked)

**Steps:**
1. Setup: User A stakes enough, creates exactly 2000 requests (see ST-035)
2. Stake additional `MINIMAL_STAKING_AMOUNT` to have cSSV for the 2001st request
3. Call `requestUnstake(1)`
4. Expect revert with `MaxRequestsAmountReached`

**Postconditions:**
- `withdrawalRequests[A].length` still 2000
- No cSSV burned on revert
- User can still `withdrawUnlocked` to clear matured requests, then request again

**File References:** `SSVStaking.sol:83-85`

---

### ST-042: Swap-and-Pop Correctness for Mixed Matured/Immature Requests

**Flow:** Create 5 requests with staggered cooldowns → advance partially → `withdrawUnlocked`

**Preconditions:**
- User A stakes enough for 5 separate unstake requests
- `cooldownDuration` set to 100 seconds for testability

**Steps:**
1. `requestUnstake(100)` at `t=0` → unlocks at `t=100`
2. `requestUnstake(200)` at `t=10` → unlocks at `t=110`
3. `requestUnstake(300)` at `t=20` → unlocks at `t=120`
4. `requestUnstake(400)` at `t=30` → unlocks at `t=130`
5. `requestUnstake(500)` at `t=40` → unlocks at `t=140`
6. Advance to `t=125`
7. Call `withdrawUnlocked()`
8. Expect total withdrawn = `100 + 200 + 300 = 600` (first 3 matured)
9. Verify remaining array length = 2 (requests for 400 and 500)
10. Verify remaining request amounts are {400, 500} (order may differ due to swap-and-pop)
11. Advance to `t=150`
12. Call `withdrawUnlocked()` again
13. Expect total withdrawn = `400 + 500 = 900`
14. Verify array is empty

**Key Verification:**
- Swap-and-pop does not cause any request to be skipped
- The `while` loop with index management handles correctly when `requests[i]` is swapped with the last element

**File References:** `SSVStaking.sol:230-245`

---

### ST-046: cSSV Transfer Triggers Reward Settlement for Both Parties

**Flow:** Alice and Bob stake → fees accrue → Alice transfers cSSV to Bob → both claim

**Preconditions:**
- Alice stakes 1000 SSV, Bob stakes 500 SSV
- Active ETH cluster generating fees
- Fees accrue over 100 blocks

**Steps:**
1. Alice calls `stake(1000e9)`, Bob calls `stake(500e9)`
2. Register ETH cluster with validators, advance 100 blocks
3. `syncFees()` — updates `accEthPerShare`
4. Alice transfers 500e9 cSSV to Bob (ERC-20 `transfer`)
5. Verify `onCSSVTransfer(Alice, Bob, 500e9)` called by cSSV token
6. Verify `RewardsSettled` emitted for Alice with `pending = 1000e9 * (accEthPerShare - 0) / 1e18`
7. Verify `RewardsSettled` emitted for Bob with `pending = 500e9 * (accEthPerShare - 0) / 1e18`
8. Verify `userIndex[Alice] == accEthPerShare` and `userIndex[Bob] == accEthPerShare`
9. Advance 50 more blocks, `syncFees()`
10. Alice calls `claimEthRewards()` — gets accrued from step 6 + rewards on remaining 500e9 cSSV
11. Bob calls `claimEthRewards()` — gets accrued from step 7 + rewards on 1000e9 cSSV (500 original + 500 received)

**Postconditions:**
- Alice's total reward = proportional to 1000e9 for 100 blocks + 500e9 for 50 blocks
- Bob's total reward = proportional to 500e9 for 100 blocks + 1000e9 for 50 blocks
- Sum of all rewards ≈ total fees accrued (minus packing precision loss)

**File References:** `SSVStaking.sol:173-181, 209-228`, `FLOWS.md §5.6`

---

### ST-060: Two Stakers — Proportional Reward Distribution

**Flow:** Alice stakes 3x, Bob stakes 1x → fees accrue → both claim proportionally

**Preconditions:**
- Active ETH cluster generating network fees
- Both users have sufficient SSV

**Steps:**
1. Alice calls `stake(3_000_000_000_000)` — gets 3T cSSV
2. Bob calls `stake(1_000_000_000_000)` — gets 1T cSSV
3. `cSSV.totalSupply() == 4T`
4. Register ETH cluster, advance 200 blocks
5. Call `syncFees()` — let `newFeesWei = X`
6. `accEthPerShare += (X * 1e18) / 4T`
7. Alice calls `claimEthRewards()`:
   - `pending = 3T * accEthPerShare / 1e18 ≈ 0.75 * X`
   - `payout = pending - (pending % 100_000)`
8. Bob calls `claimEthRewards()`:
   - `pending = 1T * accEthPerShare / 1e18 ≈ 0.25 * X`
   - `payout = pending - (pending % 100_000)`
9. Verify `Alice_payout + Bob_payout ≈ X` (within precision tolerance)
10. Verify `Alice_payout ≈ 3 * Bob_payout` (proportional)

**Postconditions:**
- `stakingEthPoolBalance` reduced by sum of both payouts
- Each user's `accrued` contains only the remainder (claimable - payout)

**File References:** `SSVStaking.sol:113-151, 209-228`

---

### ST-062: Large Stake → Tiny Fee Accrual → Precision

**Flow:** Massive stake amount, minimal fee accrual — test `accEthPerShare` precision floor

**Preconditions:**
- User stakes maximum practical amount (e.g., 1e24 SSV wei)
- ETH cluster produces minimal fees (1 block, low network fee)

**Steps:**
1. User calls `stake(1e24)` — mints 1e24 cSSV
2. Register minimal ETH cluster, advance 1 block
3. `syncFees()` — `newFeesWei` is very small (e.g., a few thousand wei)
4. Compute expected: `accEthPerShare += (newFeesWei * 1e18) / 1e24`
5. If `newFeesWei < 1e6`, then `accEthPerShare` increment rounds to 0 (integer division)
6. User calls `claimEthRewards()`:
   - `pending = 1e24 * 0 / 1e18 = 0`
   - Reverts with `NothingToClaim`
7. Advance more blocks until `newFeesWei * 1e18 / 1e24 >= 1`
8. Now `accEthPerShare` increments by at least 1
9. `pending = 1e24 * 1 / 1e18 = 1e6` — may still be below `ETH_DEDUCTED_DIGITS` (100K), in which case `payout == 0`

**Key Insight:** With very large `totalStaked`, small fee amounts get precision-floored in `accEthPerShare`. The fees are effectively distributed across too many shares to track per-share. These fees remain in `stakingEthPoolBalance` but can never be claimed — a known precision loss.

**File References:** `SSVStaking.sol:199-203, 219-224`, `SSVCoreTypes.sol:PRECISION`

---

### ST-066: Cooldown Duration Change Mid-Unstake

**Flow:** Request unstake → owner changes cooldown → verify existing request unaffected

**Preconditions:**
- Initial `cooldownDuration = 604800` (7 days)
- User has staked and has cSSV

**Steps:**
1. User calls `requestUnstake(amount)` at `t = T0`
2. `unlockTime = T0 + 604800` stored in `UnstakeRequest`
3. Owner calls `updateUnstakeCooldownDuration(86400)` (change to 1 day)
4. Advance to `t = T0 + 86400` (1 day)
5. Call `withdrawUnlocked()`
6. Expect `NothingToWithdraw` revert — original request still locked until `T0 + 604800`
7. Advance to `t = T0 + 604800`
8. Call `withdrawUnlocked()`
9. Expect success — original request now matured at its stored `unlockTime`

**Steps (new request):**
10. User stakes again, calls `requestUnstake(amount)` at `t = T1`
11. `unlockTime = T1 + 86400` (uses new cooldown)
12. Advance 1 day, call `withdrawUnlocked()` — succeeds

**Key Insight:** `unlockTime` is stored per-request at creation time, not computed dynamically. Changing `cooldownDuration` is non-retroactive.

**File References:** `SSVStaking.sol:87-88`, `SSVNetwork.sol:388`

---

### ST-068: Stake → EB Update Changes Fee Flow → Claim Rewards

**Flow:** Stake → register cluster (implicit EB) → oracle updates EB → fees accrue at new rate → claim

**Preconditions:**
- User has staked and holds cSSV
- ETH cluster registered with default EB (32 ETH, vUnits = BPS_DENOMINATOR)
- Oracle infrastructure set up for EB updates

**Steps:**
1. User stakes, registers ETH cluster with 1 validator (default 32 ETH EB)
2. `daoTotalEthVUnits` includes this cluster's `BPS_DENOMINATOR` contribution
3. Advance 50 blocks, call `syncFees()`
4. Record `accEthPerShare_1` and `newFeesWei_1`
5. Oracle commits root, user calls `updateEB` to increase cluster EB (e.g., to 64 ETH)
6. `daoTotalEthVUnits` increases (higher vUnits for this cluster)
7. Network fee earnings per block increase (`earningsUnits` formula uses `daoTotalEthVUnits`)
8. Advance another 50 blocks, call `syncFees()`
9. Record `accEthPerShare_2` and `newFeesWei_2`
10. Verify `newFeesWei_2 > newFeesWei_1` (per 50-block period, higher vUnits = more fees)
11. User calls `claimEthRewards()`
12. Total payout reflects both fee rates

**Key Insight:** EB changes affect `daoTotalEthVUnits`, which changes the rate at which `networkTotalEarnings()` grows. This flows through to stakers via `syncFees`.

**File References:** `SSVStaking.sol:183-207`, `ProtocolLib.sol:84-89, 107-119, 142-150`

---

### ST-076: Fees Lost When totalStaked == 0 (BUG-6)

**Flow:** Stake → unstake all (cSSV supply = 0) → fees accrue → stake again → claim → lost fees

**Preconditions:**
- Active ETH cluster generating fees throughout
- Single staker initially

**Steps:**
1. User A stakes `MINIMAL_STAKING_AMOUNT`, gets cSSV
2. Advance 50 blocks, `syncFees()` — `accEthPerShare` increases normally
3. User A calls `requestUnstake(MINIMAL_STAKING_AMOUNT)` — cSSV supply drops to 0
4. Advance 100 blocks — fees accrue to DAO but `cSSV.totalSupply() == 0`
5. Call `syncFees()`:
   - `current > previous` is true (DAO earned fees)
   - But `totalStaked == 0`, so `accEthPerShare` is NOT updated
   - `stakingEthPoolBalance = current` (updated regardless)
6. User B stakes `MINIMAL_STAKING_AMOUNT`
7. Advance 50 blocks, `syncFees()` — `accEthPerShare` increases for new period only
8. User B calls `claimEthRewards()`:
   - Gets rewards only from step 7 period, NOT from step 4 period
9. The fees from step 4 are permanently locked in `stakingEthPoolBalance` but attributed to no one

**Key Insight:** This is known BUG-6. Fees accrued while `totalStaked == 0` inflate `stakingEthPoolBalance` without increasing `accEthPerShare`. These fees are unclaimable — they remain in the pool but no one's `pending` calculation will ever reference them. They effectively subsidize future claims by keeping the pool balance higher than the sum of all possible claims.

**File References:** `SSVStaking.sol:199-203`, `SPEC.md Q&A: syncFees with totalStaked == 0`

---

### ST-041: Mixed Matured and Immature Requests

**Flow:** Multiple requests with different cooldowns → partial withdrawal

**Preconditions:**
- User has 3+ pending unstake requests with different `unlockTime` values
- Sufficient SSV in contract for withdrawal

**Steps:**
1. Set `cooldownDuration = 100` seconds
2. User stakes enough for 3 requests
3. At `t=1000`: `requestUnstake(100)` → unlockTime = 1100
4. At `t=1050`: `requestUnstake(200)` → unlockTime = 1150
5. At `t=1200`: `requestUnstake(300)` → unlockTime = 1300
6. Advance to `t=1160`
7. Call `withdrawUnlocked()`:
   - Request 1 (unlockTime=1100): **matured** ✓
   - Request 2 (unlockTime=1150): **matured** ✓
   - Request 3 (unlockTime=1300): **immature** ✗
8. Expect `UnstakedWithdrawn(user, 300)` (100 + 200)
9. Verify remaining array has 1 entry with amount=300
10. Verify SSV balance of user increased by 300

**Postconditions:**
- `withdrawalRequests[user].length == 1`
- Remaining request is the 300-amount one (unlockTime=1300)
- Can call `withdrawUnlocked()` again after `t=1300`

**File References:** `SSVStaking.sol:230-245`

---

### ST-047: Sender's Accrued Rewards Preserved After Full cSSV Transfer

**Flow:** Alice earns rewards → transfers ALL cSSV to Bob → Alice claims her accrued rewards

**Preconditions:**
- Alice has staked and earned rewards over multiple blocks
- Bob may or may not have existing cSSV
- Active fee-generating cluster

**Steps:**
1. Alice calls `stake(1000e9)` — gets 1000e9 cSSV
2. Advance 100 blocks with active cluster, `syncFees()`
3. Alice's pending = `1000e9 * accEthPerShare / 1e18` (unsettled)
4. Alice transfers ALL 1000e9 cSSV to Bob via `cSSV.transfer(Bob, 1000e9)`
5. `onCSSVTransfer` fires:
   - `_settle(Alice)`: `pending` calculated with Alice's 1000e9 balance (pre-transfer), added to `accrued[Alice]`
   - `_settle(Bob)`: if Bob had prior cSSV, his pending added to `accrued[Bob]`
6. After transfer: `cSSV.balanceOf(Alice) == 0`, `cSSV.balanceOf(Bob) == 1000e9`
7. Alice calls `claimEthRewards()`:
   - `_settle(Alice)`: `bal == 0`, no new pending
   - `accrued[Alice]` still holds rewards from step 5
   - `payout = accrued - (accrued % 100_000)`
   - If payout > 0: claim succeeds, remainder zeroed (because `balanceOf == 0`, dust forfeited)
   - If payout == 0: `RewardsClaimed(Alice, 0)` emitted, `accrued[Alice] = 0`
8. Verify Alice received her ETH
9. Advance more blocks — Alice earns nothing (no cSSV)
10. Bob calls `claimEthRewards()` — gets rewards from his original holding + Alice's transferred cSSV

**Key Insight:** `accrued[user]` is independent of `cSSV.balanceOf(user)`. A user with 0 cSSV can still claim previously accrued rewards. However, any sub-100K-wei dust is forfeited when `balanceOf == 0`.

**File References:** `SSVStaking.sol:173-181, 113-151, 144-145`, `FLOWS.md §5.6`

---

## Summary

- **Total scenarios:** 80 (ST-001 through ST-080)
- **Detailed blocks:** 12 (ST-016, ST-035, ST-036, ST-041, ST-042, ST-046, ST-047, ST-060, ST-062, ST-066, ST-068, ST-076)
- **Revert scenarios:** 17 (ST-002, ST-003, ST-007, ST-008, ST-018, ST-019, ST-024, ST-025, ST-029, ST-030, ST-036, ST-039, ST-040, ST-050, ST-053, ST-054–ST-057, ST-072, ST-073, ST-080)
- **Entry point coverage:** `stake` (10), `requestUnstake` (10), `withdrawUnlocked` (8), `claimEthRewards` (18), `syncFees` (6), `onCSSVTransfer` (6), `rescueERC20` (7), invariants/integration (15)
- **Known edge cases covered:** BUG-6 (zero supply fee loss), dust forfeiture, precision limits, swap-and-pop correctness, cooldown non-retroactivity, EB fee rate changes

---

## Audit Gaps (Added post-audit)

> Identified by code-level branch analysis. These scenarios cover branches and edge conditions not addressed by the original ST-001 through ST-080 set.

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| ST-081 | syncFees | Verify `FeesSynced` event values: `newFeesWei` matches `(current - previous) * ETH_DEDUCTED_DIGITS`, `accEthPerShare` matches computed increment. Full event value validation. | `entry:syncFees; version:eth; eb:implicit; cluster:active; ops:4; revert:no` | [ ] | SSVStaking.sol:206 |
| ST-082 | stake | Reentrancy via malicious SSV token: if SSV token had a callback on transfer, verify `nonReentrant` prevents re-entering `stake`. | `entry:stake; version:eth; eb:implicit; cluster:none; ops:parametric; revert:yes` | [ ] | SSVStaking.sol:43, 53-55 |
| ST-083 | claimEthRewards | Reentrancy via ETH transfer callback: recipient contract attempts re-entry during `claimEthRewards` ETH transfer. Verify `nonReentrant` blocks it. | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; revert:yes` | [ ] | SSVStaking.sol:113, 149 |
| ST-084 | requestUnstake | Reentrancy via cSSV burn callback: if cSSV token had a callback on burn, verify `nonReentrant` prevents re-entering `requestUnstake`. | `entry:requestUnstake; version:eth; eb:implicit; cluster:none; ops:parametric; revert:yes` | [ ] | SSVStaking.sol:65 |
| ST-085 | stake | Boundary: stake exactly `MINIMAL_STAKING_AMOUNT` — verify this is accepted (not off-by-one `>` vs `>=`). | `entry:stake; version:eth; eb:implicit; cluster:none; ops:parametric; revert:no` | [ ] | SSVStaking.sol:44-46 |
| ST-086 | claimEthRewards | Boundary: accrued exactly equals `ETH_DEDUCTED_DIGITS` (100,000 wei) — payout == 100,000, remainder == 0. Smallest possible non-zero payout. | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; revert:no` | [ ] | SSVStaking.sol:122-131 |
| ST-087 | requestUnstake | Boundary: request unstake of exactly 1 (minimum non-zero amount) — verify accepted, cSSV burned, request stored. | `entry:requestUnstake; version:eth; eb:implicit; cluster:none; ops:parametric; revert:no` | [ ] | SSVStaking.sol:65-93 |
| ST-088 | withdrawUnlocked | Boundary: request at exactly cooldown expiry — `block.timestamp == unlockTime`. Verify accepted (test `>=` vs `>`). | `entry:withdrawUnlocked; version:eth; eb:implicit; cluster:none; ops:parametric; revert:no` | [ ] | SSVStaking.sol:230-245 |
| ST-089 | rescueERC20 | Access control: non-owner calls `rescueERC20` — verify revert with Ownable error. | `entry:rescueERC20; version:eth; eb:implicit; cluster:none; ops:parametric; revert:yes` | [ ] | SSVStaking.sol:156 |
| ST-090 | rescueERC20 | Transfer failure: rescued token's `transfer` returns false or reverts — verify `rescueERC20` propagates the failure. | `entry:rescueERC20; version:eth; eb:implicit; cluster:none; ops:parametric; revert:yes` | [ ] | SSVStaking.sol:164-166 |
| ST-091 | onCSSVTransfer | Edge: transfer to self (`from == to`) — verify settlement runs for same address, no double-counting or state corruption. | `entry:onCSSVTransfer; version:eth; eb:implicit; cluster:active; ops:4; revert:no` | [ ] | SSVStaking.sol:173-181 |
| ST-092 | onCSSVTransfer | Edge: transfer amount == 0 — verify settlement still runs for both parties, no revert. | `entry:onCSSVTransfer; version:eth; eb:implicit; cluster:active; ops:4; revert:no` | [ ] | SSVStaking.sol:173-181 |
| ST-093 | onCSSVTransfer | Edge: transfer to address with no prior staking history (`userIndex == 0`) — verify new user's index initialized correctly to current `accEthPerShare`. | `entry:onCSSVTransfer; version:eth; eb:implicit; cluster:active; ops:4; revert:no` | [ ] | SSVStaking.sol:173-181, 209-228 |
| ST-094 | _settle | Rounding: verify `(cSSVBalance * (idx - userIdx)) / PRECISION_FACTOR` rounding behavior — truncation toward zero, no rounding up. | `entry:stake; version:eth; eb:implicit; cluster:active; ops:4; revert:no` | [ ] | SSVStaking.sol:219-224 |
| ST-095 | claimEthRewards | ETH transfer failure: `CoreLib.transferBalance` fails due to insufficient contract ETH balance (mismatch between accounting and actual ETH). Verify revert with `ETHTransferFailed`. | `entry:claimEthRewards; version:eth; eb:implicit; cluster:active; ops:4; revert:yes` | [ ] | SSVStaking.sol:149, CoreLib.sol |
| ST-096 | syncFees | `syncFees` with negative delta (theoretical: `current < previous` due to rounding or bug). Verify the underflow is handled or cannot occur. | `entry:syncFees; version:eth; eb:implicit; cluster:active; ops:4; revert:no` | [ ] | SSVStaking.sol:191-194 |

---

## ask-codex Review Findings

### Additional Scenarios

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| ST-097 | claimEthRewards | _settleWithBalance: bal==0, idx!=userIdx → userIndex advances but no accrual. Distinct from same-index no-op. | `entry:claimEthRewards; revert:no` | [ ] | SSVStaking.sol:219, 226 |
| ST-098 | claimEthRewards | _settleWithBalance: bal!=0, idx!=userIdx, but pending==0 (rounding) → accrued unchanged despite index advance. | `entry:claimEthRewards; revert:no` | [ ] | SSVStaking.sol:221 |
| ST-099 | onCSSVTransfer | Self-transfer of cSSV token → hook must NOT fire. Tests gate condition at CSSVToken.sol:27. | `entry:onCSSVTransfer; revert:no` | [ ] | CSSVToken.sol:27 |
| ST-100 | onCSSVTransfer | Zero-amount cSSV transfer → hook must NOT fire. Tests gate condition at CSSVToken.sol:27. | `entry:onCSSVTransfer; revert:no` | [ ] | CSSVToken.sol:27 |
