---
title: 'Scenario Test Discovery: full codebase flow analysis'
base-branch: scenario-tests-design
schema: 2
model: claude-opus-4-6
---

You are performing a deep scenario-discovery analysis on SSV Network v2.0.0 smart contracts. Your goal is to produce a comprehensive, implementation-ready test plan that covers every realistic multi-step flow through the system.

## Why This Matters

Existing tests verify individual function calls succeed or revert. They do NOT verify that the **system state is economically correct after realistic sequences of operations**. Example of what we missed: registering a validator on a public operator succeeded, but the operator's default ETH fee was zero — the test checked "registration worked" but not "fees accrue correctly over N blocks." This class of bug requires scenario-based testing.

## Your Mission

For every module and every cross-module flow in the system:
1. **Read the actual Solidity code** — trace each function line by line
2. **Read FLOWS.md** — compare the documented flow against the actual code. If they disagree, **flag it as a DISCREPANCY** (code vs docs) and note which one you believe is correct and why. Do NOT silently assume docs are right.
3. **Map every storage mutation** — for each function, list every storage slot that changes
4. **Identify economic invariants** — what must be true after N blocks of operation?
5. **Generate scenarios** — specific sequences of actions with specific assertions at each step
6. **Think adversarially** — what ordering of operations could break an invariant?

## Required Reading (in order)

1. `CLAUDE.md` — Architecture, storage patterns, security rules
2. `docs/SPEC.md` — Technical specification with accounting formulas
3. `docs/FLOWS.md` — Contract flows with state mutations and invariants
4. Then read the actual contract code for each module you're analyzing

## Research Partitions

Analyze the system in these partitions. For each, produce a section in the output document.

### Partition 1: Operator Lifecycle
**Code to read:** `contracts/modules/SSVOperators.sol`, `contracts/libraries/OperatorLib.sol`
**Flows to verify:** FLOWS.md sections 4.1–4.7

Cover:
- Register operator (public vs private)
- Fee declaration → execution → reduction cycle with block advancement
- Operator earnings accumulation over time (SSV and ETH)
- Operator removal with final earnings withdrawal
- What happens when operator fee changes while clusters are running
- `ensureETHDefaults()` behavior — when does it trigger, what does it set?
- Interaction between SSV fee (frozen) and ETH fee

### Partition 2: Cluster Lifecycle (ETH)
**Code to read:** `contracts/modules/SSVClusters.sol`, `contracts/libraries/ClusterLib.sol`
**Flows to verify:** FLOWS.md sections 1.1–1.6, 1.8

Cover:
- Create new cluster via registerValidator → deposit → advance blocks → verify balances
- Deposit additional ETH → verify balance increase is exact
- Withdraw ETH → verify liquidation check, balance decrease, ETH transfer
- Liquidation by third party → verify bounty, operator counts, DAO counts
- Self-liquidation → verify always allowed regardless of balance
- Reactivation → verify all state correctly restored
- Cluster with multiple validators → verify fee scaling
- Cluster approaching liquidation threshold → exact boundary testing

### Partition 3: Cluster Lifecycle (SSV Legacy)
**Code to read:** Same as above, SSV-specific code paths
**Flows to verify:** FLOWS.md section 1.7, legacy paths

Cover:
- SSV cluster operations that are still allowed (self-liquidate, migrate, exit)
- SSV cluster operations that should be blocked (add validator, deposit, reactivate)
- SSV fee accrual continues correctly until migration or liquidation

### Partition 4: Migration (SSV → ETH)
**Code to read:** `contracts/modules/SSVClusters.sol` — `migrateClusterToETH`
**Flows to verify:** FLOWS.md section 2.1

Cover:
- Full migration flow: operator state transition (SSV counts down, ETH counts up)
- SSV refund calculation accuracy
- Post-migration: cluster operates correctly under ETH rules
- Migration of liquidated cluster (special case: SSV counts should NOT decrease)
- Migration with operators that already have ETH validators vs first ETH interaction
- EB deviation sync during migration
- Post-migration: register new validator on same cluster → verify fees correct

### Partition 5: Validator Lifecycle
**Code to read:** `contracts/modules/SSVValidators.sol`, `contracts/libraries/ValidatorLib.sol`
**Flows to verify:** FLOWS.md sections 1.1–1.3

Cover:
- Register single validator → advance N blocks → verify operator earnings = fee × N × vUnits
- Register multiple validators (bulk) → verify per-operator accounting
- Remove validator → verify operator counts decrease, fees settle correctly
- Register on public operator (default fee) vs private operator (declared fee) — verify different fee rates
- Register validator that creates NEW cluster vs adding to EXISTING cluster
- Validator registration when operator already has ETH validators vs first time

### Partition 6: Effective Balance (EB) System
**Code to read:** `contracts/modules/SSVClusters.sol` — `updateClusterBalance`, `contracts/modules/SSVDAO.sol` — `commitRoot`
**Flows to verify:** FLOWS.md sections 3.1–3.2

Cover:
- Oracle commit flow: single oracle, quorum reached, quorum not reached
- EB update: implicit (default 32 ETH) → explicit (oracle-set) transition
- EB increase → verify future fees increase proportionally
- EB decrease → verify future fees decrease proportionally
- Auto-liquidation on EB increase (balance now insufficient for higher burn rate)
- vUnit math: ceiling division ETH→vUnits, floor division vUnits→ETH
- Operator vUnit deviation tracking accuracy across multiple clusters
- DAO total vUnit consistency: `daoTotalEthVUnits == ethDaoValidatorCount * VUNITS_PRECISION + Σ(deviations)`

### Partition 7: Staking System
**Code to read:** `contracts/modules/SSVStaking.sol`, `contracts/token/CSSVToken.sol`
**Flows to verify:** FLOWS.md sections 5.1–5.5

Cover:
- Stake SSV → earn ETH rewards over N blocks → claim → verify exact amounts
- Multiple stakers: verify pro-rata distribution is correct
- Unstake request → cooldown → withdraw → verify SSV returned
- cSSV transfer → verify rewards settle for both sender and receiver
- Accumulator math: `accEthPerShare` only increases
- Dust/precision: maximum dust per operation, where does it accumulate
- First staker after gap: can they capture undistributed rewards?
- Zero cSSV supply state transitions (edge case)
- MAX_PENDING_REQUESTS enforcement

### Partition 8: Cross-Cutting Flows (CRITICAL)
**Code to read:** All modules, trace interactions between them

This is the most important partition. Generate scenarios that cross module boundaries:

- **Register → Advance → Verify Economics**: Register validator, advance 100 blocks, verify: operator ETH earnings = `fee × 100 × vUnits / VUNITS_PRECISION × ETH_DEDUCTED_DIGITS`. Verify: cluster balance = `deposit - Σ(operator fees) - network fees`. Verify: DAO earnings = `networkFee × 100 × vUnits / VUNITS_PRECISION × ETH_DEDUCTED_DIGITS`

- **Migration → Register → Verify**: Migrate SSV cluster to ETH, register new validator on same cluster, advance blocks, verify all fees use ETH model

- **EB Update → Liquidation**: Cluster has borderline balance, EB increases via oracle, verify auto-liquidation triggers

- **Fee Change → Earnings**: Operator declares new fee, advances through timelock, executes, register new validator — verify old validators use old fee snapshot, new state uses new fee

- **Staking → Liquidation → Rewards**: Stake SSV, clusters generate revenue, liquidation reduces DAO earnings flow, verify staking rewards reflect the change

- **Multi-Cluster Operator**: Same operator serves clusters A (3 validators) and B (2 validators). Verify operator earnings = fee × (3+2) × vUnits. Cluster A gets liquidated — operator earnings recalculate with only 5→2 validator change. Verify no double-counting.

- **Full Lifecycle**: Register operator → register validator → advance blocks → update EB → advance more blocks → declare fee change → execute fee change → advance → remove validator → withdraw operator earnings → verify everything sums to zero

- **Conservation Law**: After any sequence of operations: `contract.ETH_balance >= Σ(active cluster balances) + Σ(operator ETH earnings) + staking_pool_balance`

## Output Format

Write to `docs/SCENARIO-TESTS.md` with this structure:

```markdown
# SSV Network v2.0.0 — Scenario Test Plan

## How to Read This Document
[Brief guide on the format]

## Global Invariants
[List invariants that should be checked in EVERY scenario]

## Discrepancies Found (Code vs FLOWS.md)
[Any differences found between actual code and documentation]
[For each: what the code does, what FLOWS.md says, which is correct, impact]
**FLAG FOR HUMAN REVIEW** — do not resolve these yourself

## Partition N: [Name]

### Scenario N.M: [Descriptive Name]

**Modules Touched:** [list]
**Covers Bug Class:** [what type of bug this catches — e.g., "default fee not applied", "double-counting on liquidation"]

#### Preconditions
- [Exact setup: operators registered, fees set, cluster state, etc.]

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | Register 4 operators (public, default fee) | 0 | Each operator: ethFee=0, ethValidatorCount=0 |
| 2 | Register validator with ops [1,2,3,4], deposit 10 ETH | 1 | ethFee should be DEFAULT_OPERATOR_ETH_FEE via ensureETHDefaults |
| 3 | Advance 100 blocks | 101 | — |
| 4 | Check operator 1 earnings | 101 | earnings = DEFAULT_FEE × 100 × 10000 / 10000 × 100000 |
| ... | ... | ... | ... |

#### Assertions (verify ALL at each relevant step)
- [ ] `operator[i].ethSnapshot.balance == expectedEarnings` (show formula with actual numbers)
- [ ] `cluster.balance == 10 ETH - totalFeesBurned` (show calculation)
- [ ] `contract.balance >= cluster.balance + Σ(operator.earnings) + daoEarnings`
- [ ] `ethDaoValidatorCount == expectedCount`

#### Edge Variations
- [Same scenario with tweaks that test boundary conditions]
```

## Rules

1. **Every assertion must include the exact formula with actual numbers.** Not "balance should be correct" but "balance should be `10000000000000000000 - (1770000000 × 100 × 10000 / 10000 × 100000) × 4 - (3000000000 × 100 × 10000 / 10000 × 100000) = 9991920000000000000`"

2. **Always trace the actual code path.** Don't assume — read `SSVValidators.sol:registerValidator`, follow every internal call, note every `sstore`.

3. **Compare against FLOWS.md at every step.** Flag any discrepancy immediately in the Discrepancies section.

4. **Think about what happens BETWEEN steps.** Block advancement means fees accrue. State from step 1 affects step 3.

5. **Include negative scenarios.** What should revert? What happens if you try operations in the wrong order?

6. **No priorities — everything is critical.** These are mainnet contracts handling real money. Every scenario matters.

7. **For the test folder**: Tests will live in `test/e2e/` — keep this in mind when referencing test helpers and imports. Note existing helpers in `test/common/helpers.ts` and `test/setup/fixtures.ts` that can be reused.
