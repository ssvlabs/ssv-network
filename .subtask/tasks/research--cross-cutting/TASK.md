---
title: 'Scenario discovery: Cross-cutting flows + synthesis'
base-branch: scenario-tests-design
schema: 2
model: claude-opus-4-6
---

You are performing the **final synthesis** of the scenario-discovery process for SSV Network v2.0.0. Three research tasks have already produced scenario documents for individual partitions. Your job is to:

1. **Read all partition outputs** and identify gaps
2. **Generate cross-module scenarios** that no individual partition could cover
3. **Compile everything into the final `docs/SCENARIO-TESTS.md`**

## Required Reading (in order)

1. `CLAUDE.md` — Architecture overview
2. `docs/SPEC.md` — Full technical specification
3. `docs/FLOWS.md` — All flows with invariants (especially the Global Invariants at the bottom)
4. **Partition outputs** (read ALL of these):
   - `docs/scenarios/operators-validators.md`
   - `docs/scenarios/clusters-migration.md`
   - `docs/scenarios/eb-staking.md`
5. **Then read actual Solidity** for any cross-module paths you need to trace:
   - Focus on the boundaries between modules — where one module writes state that another reads

## Your Mission

### Part 1: Gap Analysis

Read all three partition documents. Identify:
- Scenarios that reference other partitions but weren't fully specified
- Flows that span 3+ modules and weren't covered
- Invariants that require checking across partitions
- Any inconsistencies between partition findings

### Part 2: Cross-Cutting Scenarios

Generate scenarios that test interactions between modules. These are the highest-value scenarios because no individual module test catches them.

**Required cross-cutting scenarios** (at minimum — add more that you identify):

1. **Full Economic Conservation Law**
   - Register operators, register validators, stake SSV, advance N blocks
   - Verify: `contract.ETH_balance >= Σ(active ETH cluster balances) + Σ(operator ETH earnings) + staking_pool_balance`
   - Verify: `contract.SSV_balance >= Σ(active SSV cluster balances) + Σ(operator SSV earnings) + staked_SSV`
   - This is the master invariant — if this fails, money was created or destroyed

2. **Register → Advance → Verify Full Economics**
   - 4 public operators (default fee)
   - Register 1 validator, deposit 10 ETH
   - Advance 100 blocks
   - Verify ALL of these with exact numbers:
     - Each operator's ETH earnings
     - Cluster balance
     - DAO ETH earnings (network fee portion)
     - Sum of all = initial deposit (conservation)

3. **Migration → Register → EB Update → Fee Change → Liquidation**
   - Start with SSV cluster (4 operators, 2 validators)
   - Migrate to ETH (verify SSV refund + ETH cluster creation)
   - Register 3rd validator on same cluster
   - Oracle updates EB to 128 ETH (4× default)
   - Operator declares fee change, executes after timelock
   - Advance until cluster approaches liquidation threshold
   - Third-party liquidates → verify bounty is exact
   - Operator withdraws all earnings → verify total

4. **Multi-Staker Revenue Distribution Through State Changes**
   - User A stakes 100 SSV at block 0
   - Cluster generates revenue blocks 0-50
   - User B stakes 300 SSV at block 50
   - Cluster generates revenue blocks 50-100
   - EB update doubles fees at block 100
   - Cluster generates revenue blocks 100-150
   - User A claims at block 150
   - Verify: A gets 100% of blocks 0-50 + 25% of blocks 50-150
   - Verify: B gets 75% of blocks 50-150
   - Show exact math

5. **Operator Serving Multiple Clusters with Different EBs**
   - Operator O serves cluster A (2 validators, EB=64) and cluster B (3 validators, EB=96)
   - O's effective vUnits = `(2×10_000 + deviation_A) + (3×10_000 + deviation_B)`
   - Where deviation_A = `ebToVUnits(64) - 2×10_000` and deviation_B = `ebToVUnits(96) - 3×10_000`
   - Advance 100 blocks → verify O's earnings = `fee × 100 × totalEffectiveVUnits / VUNITS_PRECISION × ETH_DEDUCTED_DIGITS`
   - Cluster A gets liquidated → O's effective vUnits decrease
   - Advance 100 more blocks → verify O's earnings rate changed correctly

6. **Staking Rewards Through Liquidation Event**
   - Staker earns from network fees
   - Cluster gets liquidated → ETH bounty goes to liquidator
   - But network fees were accruing to DAO → which feeds staking rewards
   - After liquidation, fewer validators → less revenue → staking rewards decrease
   - Verify the transition is clean (no lost or phantom rewards)

7. **Migration Race: Two Clusters, Same Operators**
   - Cluster A (SSV) and Cluster B (SSV) share operators 1-4
   - Cluster A migrates to ETH → operators get `ensureETHDefaults()` → ethValidatorCount increases
   - Cluster B migrates to ETH → operators already have ETH state → no `ensureETHDefaults()`, just ETH snapshot update
   - Verify: operator state is correct after both migrations
   - Verify: no double-counting of validators

8. **cSSV Transfer Mid-Revenue-Accrual**
   - User A has 100 cSSV, User B has 0
   - Revenue accrues for 50 blocks
   - A transfers 50 cSSV to B (triggers `onCSSVTransfer`)
   - Revenue accrues for 50 more blocks
   - Both claim → verify: A got 100% of first 50 blocks + 50% of next 50 blocks, B got 50% of next 50 blocks
   - Verify: `_beforeTokenTransfer` correctly settled both sides

9. **Governance Parameter Change Mid-Operation**
   - Update network fee while clusters are running
   - Verify: old fee used up to change block, new fee after
   - Update liquidation threshold → cluster that was safe is now liquidatable
   - Update minimum operator fee → operator can't reduce below it

10. **Full System Lifecycle (End-to-End)**
    - Register 4 operators
    - Register validator (creates ETH cluster)
    - Stake SSV (creates stakers)
    - Advance 100 blocks
    - Oracle commits EB root → update cluster balance (EB = 48 ETH)
    - Advance 100 blocks
    - Operator declares fee increase, advances through timelock, executes
    - Advance 100 blocks
    - Register 2nd validator on same cluster
    - Advance 100 blocks
    - User A claims staking rewards
    - Remove 1st validator
    - Advance 100 blocks
    - Withdraw from cluster
    - Remove operator (after removing all validators)
    - Final verification: all balances add up, all earnings withdrawn, conservation law holds

### Part 3: Compile Final Document

Merge all partition outputs + your cross-cutting scenarios into `docs/SCENARIO-TESTS.md` with this structure:

```markdown
# SSV Network v2.0.0 — Scenario Test Plan

## How to Read This Document

Each scenario is a specific sequence of contract interactions with exact expected outcomes.
Tests will be implemented in `test/e2e/` using Hardhat + ethers v6 + Chai.

### Scenario Format
- **Preconditions**: Exact contract state before the scenario starts
- **Action Sequence**: Step-by-step with block numbers and expected state changes
- **Assertions**: Exact formulas with actual numbers — not "balance is correct" but the full calculation
- **Edge Variations**: Boundary conditions and tweaks on the same scenario

## All Discrepancies (Code vs FLOWS.md)
[Aggregate from all partitions + any new ones you found]
**EACH MUST BE REVIEWED BY HUMAN BEFORE IMPLEMENTING TESTS**

### DISC-N: [Title]
- **Source partition:** OV / CM / ES / CC (cross-cutting)
- **FLOWS.md says:** ...
- **Code does:** ... (file:line)
- **Likely correct:** Code / FLOWS.md
- **Impact:** ...

## Global Invariants (Check in EVERY cross-cutting test)

1. **ETH Conservation**: `contract.ETH >= Σ(active ETH cluster balances) + Σ(operator ETH earnings) + staking_pool_balance`
2. **SSV Conservation**: `contract.SSV >= Σ(active SSV cluster balances) + Σ(operator SSV earnings) + staked_SSV`
3. **Validator Count**: `ethDaoValidatorCount == Σ(active cluster validator counts)`
4. **vUnit Consistency**: `daoTotalEthVUnits == ethDaoValidatorCount × VUNITS_PRECISION + Σ(cluster EB deviations)`
5. **Cluster Hash Integrity**: stored hash matches `hashClusterData()` of actual state
6. **cSSV Supply**: `cSSV.totalSupply() == Σ(staked SSV) - Σ(unstake-requested SSV)`
7. **Accumulator Monotonicity**: `accEthPerShare` only increases
8. **Oracle Monotonicity**: `latestCommittedBlock` only increases
9. **Cluster Version Exclusivity**: cluster key in EITHER `clusters` OR `ethClusters`, never both

## Part 1: Operators + Validators
[Include full content from docs/scenarios/operators-validators.md]

## Part 2: Clusters + Migration
[Include full content from docs/scenarios/clusters-migration.md]

## Part 3: Effective Balance + Staking
[Include full content from docs/scenarios/eb-staking.md]

## Part 4: Cross-Cutting Flows
[Your new scenarios from Part 2 above]

### CC-N: [Descriptive Name]
[Same format as other partitions]
```

## Rules

1. **Every assertion = exact formula with actual numbers.**
2. **Read the code for any cross-module path you trace.** Don't assume.
3. **No priorities — everything is critical.**
4. **The cross-cutting scenarios are the most valuable.** They test what unit tests can't.
5. **If partition outputs conflict with each other or with the code, flag it.**
6. **The final document must be self-contained** — someone implementing tests shouldn't need to read the partition files separately.
