# Staking Test Progress

Local tracking sheet for Venimir's `MR-3` staking test slice.

Source plan:
- `ssv-review/planning/STAKING-TEST-PLAN.md`

Notes:
- IDs are local-only for this tracking sheet.
- Scope here is `Claim Rewards` and `Withdraw Unlocked`.

| ID | Section | Task | Status |
|---:|---|---|---|
| 1 | Claim Rewards | Basic claim | Todo |
| 2 | Claim Rewards | Claim multiple times | Todo |
| 3 | Claim Rewards | Claim after cSSV transfer (sender) | Todo |
| 4 | Claim Rewards | Claim after partial unstake | Todo |
| 5 | Claim Rewards | Multiple claims from multiple users | Todo |
| 6 | Claim Rewards | Claim with no rewards reverts | Todo |
| 7 | Claim Rewards | Claim when accrued is zero reverts | Todo |
| 8 | Claim Rewards | Claim twice in same block | Todo |
| 9 | Claim Rewards | Claim with sub-precision dust reverts | Todo |
| 10 | Claim Rewards | Payout truncated to `ETH_DEDUCTED_DIGITS` | Todo |
| 11 | Claim Rewards | Dust forfeited when cSSV balance is zero | Todo |
| 12 | Claim Rewards | Dust preserved when cSSV balance `> 0` | Todo |
| 13 | Claim Rewards | Exact precision amount | Todo |
| 14 | Claim Rewards | `FeesSynced` emitted | Todo |
| 15 | Claim Rewards | `RewardsSettled` emitted | Todo |
| 16 | Claim Rewards | `RewardsClaimed` emitted with payout | Todo |
| 17 | Claim Rewards | `RewardsClaimed` emitted with zero on dust forfeit | Todo |
| 18 | Withdraw Unlocked | Basic withdraw | Todo |
| 19 | Withdraw Unlocked | Withdraw multiple matured at once | Todo |
| 20 | Withdraw Unlocked | Withdraw only matured, immature remain | Todo |
| 21 | Withdraw Unlocked | Withdraw at exact unlock time | Todo |
| 22 | Withdraw Unlocked | Withdraw long after maturity | Todo |
| 23 | Withdraw Unlocked | Multiple withdraw calls over time | Todo |
| 24 | Withdraw Unlocked | Withdraw after all cSSV burned | Todo |
| 25 | Withdraw Unlocked | No requests reverts | Todo |
| 26 | Withdraw Unlocked | All immature reverts | Todo |
| 27 | Withdraw Unlocked | Withdraw one block before unlock | Todo |
| 28 | Withdraw Unlocked | SSV returned to user | Todo |
| 29 | Withdraw Unlocked | SSV deducted from contract | Todo |
| 30 | Withdraw Unlocked | cSSV supply unchanged | Todo |
| 31 | Withdraw Unlocked | Two users withdraw independently | Todo |
| 32 | Withdraw Unlocked | One user's withdraw doesn't affect another | Todo |
| 33 | Withdraw Unlocked | `UnstakedWithdrawn` emitted | Todo |
