# Staking Test Progress

Local tracking sheet for `MR-3` staking test slice.

Source plan:
- `ssv-review/planning/STAKING-TEST-PLAN.md`

Notes:
- IDs are local-only for this tracking sheet.
- This tracker was seeded from scenarios marked `NOT COVERED` or `Partially` in the source plan and keeps completed rows for local history.
- Based on the current source plan, the remaining open backlog is `36` tasks total: `33` `NOT COVERED` and `3` `Partially`.
- `Plan Ref` uses `<section>.<case>` from `STAKING-TEST-PLAN.md`.

| ID | Plan Ref | Section | Task | Plan Status | Local Status |
|---:|---:|---|---|---|---|
| 1 | 1.13 | Staking | ~~Stake without approval reverts~~ | Covered | Done |
| 2 | 1.17 | Staking | ~~Stake exactly 1 above minimum~~ | Covered | Done |
| 3 | 2.7 | Earning Rewards | ~~Rewards with 1 wei cSSV~~ | Covered | Done |
| 4 | 2.9 | Earning Rewards | Two equal stakers split 50/50 | Partially | Todo |
| 5 | 2.11 | Earning Rewards | Three stakers, one unstakes mid-period | NOT COVERED | Todo |
| 6 | 2.13 | Earning Rewards | Rewards increase after fee raise | NOT COVERED | Todo |
| 7 | 2.14 | Earning Rewards | Rewards decrease after fee reduction | NOT COVERED | Todo |
| 8 | 2.15 | Earning Rewards | Rewards stop after fee set to zero | NOT COVERED | Todo |
| 9 | 2.17 | Earning Rewards | Multiple fee changes across staking period | NOT COVERED | Todo |
| 10 | 2.18 | Earning Rewards | Rewards unaffected by cooldown increase | NOT COVERED | Todo |
| 11 | 2.19 | Earning Rewards | Rewards unaffected by cooldown decrease | NOT COVERED | Todo |
| 12 | 2.20 | Earning Rewards | Rewards accrue normally after cooldown change and unstake | NOT COVERED | Todo |
| 13 | 2.22 | Earning Rewards | Stake after partial unstake | NOT COVERED | Todo |
| 14 | 2.25 | Earning Rewards | Stake-transfer-stake cycle | NOT COVERED | Todo |
| 15 | 2.26 | Earning Rewards | Self-transfer doesn't double rewards | Partially | Todo |
| 16 | 4.7 | Request Unstake | Unstake after cSSV transfer receive | NOT COVERED | Todo |
| 17 | 4.10 | Request Unstake | Unstake with no cSSV reverts | Partially | Todo |
| 18 | 4.14 | Request Unstake | Cooldown duration change affects new requests only | NOT COVERED | Todo |
| 19 | 4.15 | Request Unstake | Cooldown increase - old request uses old cooldown | NOT COVERED | Todo |
| 20 | 4.16 | Request Unstake | Cooldown increase - new request uses new cooldown | NOT COVERED | Todo |
| 21 | 4.17 | Request Unstake | Cooldown decrease - pending not accelerated | NOT COVERED | Todo |
| 22 | 4.18 | Request Unstake | Cooldown decrease - new request uses shorter | NOT COVERED | Todo |
| 23 | 5.5 | Withdraw Unlocked | Withdraw long after maturity | NOT COVERED | Todo |
| 24 | 5.13 | Withdraw Unlocked | cSSV supply unchanged | NOT COVERED | Todo |
| 25 | 7.1 | Multisig Accounts | Multisig stakes SSV | NOT COVERED | Todo |
| 26 | 7.2 | Multisig Accounts | Multisig stakes multiple times | NOT COVERED | Todo |
| 27 | 7.3 | Multisig Accounts | Multisig earns rewards | NOT COVERED | Todo |
| 28 | 7.4 | Multisig Accounts | Multisig claims rewards | NOT COVERED | Todo |
| 29 | 7.5 | Multisig Accounts | Multisig claims with dust | NOT COVERED | Todo |
| 30 | 7.6 | Multisig Accounts | Multisig transfers cSSV to EOA | NOT COVERED | Todo |
| 31 | 7.7 | Multisig Accounts | EOA transfers cSSV to multisig | NOT COVERED | Todo |
| 32 | 7.8 | Multisig Accounts | Multisig transfers cSSV to another multisig | NOT COVERED | Todo |
| 33 | 7.9 | Multisig Accounts | Multisig requests unstake | NOT COVERED | Todo |
| 34 | 7.10 | Multisig Accounts | Multisig creates multiple unstake requests | NOT COVERED | Todo |
| 35 | 7.11 | Multisig Accounts | Multisig requests unstake after earning | NOT COVERED | Todo |
| 36 | 7.12 | Multisig Accounts | Multisig withdraws unlocked SSV | NOT COVERED | Todo |
| 37 | 7.13 | Multisig Accounts | Multisig withdraws multiple matured requests | NOT COVERED | Todo |
| 38 | 7.14 | Multisig Accounts | Multisig complete flow | NOT COVERED | Todo |
| 39 | 7.15 | Multisig Accounts | Mixed EOA and multisig interaction | NOT COVERED | Todo |
