---
title: 'Scenario discovery: Effective Balance + Staking'
base-branch: scenario-tests-design
schema: 2
model: claude-opus-4-6
---

You are performing deep scenario-discovery on the **Effective Balance (EB)** and **Staking** systems of SSV Network v2.0.0. Your goal: produce implementation-ready test scenarios that verify the system is economically correct after realistic multi-step flows.

## Why This Matters

These are the newest and most complex subsystems in v2.0.0. The EB system introduces vUnit-weighted fee calculations and oracle-driven balance updates. The Staking system introduces a reward accumulator that must correctly distribute ETH revenue to cSSV holders. Bugs here mean either lost funds or unfair distribution.

## Required Reading (in order)

1. `CLAUDE.md` — Architecture, storage patterns, key constants
2. `docs/SPEC.md` — Sections 2 (EB), 3 (Staking), 4 (Oracle), 10 (formulas), 13 (constants)
3. `docs/FLOWS.md` — Sections 3.1–3.2 (EB flows), 5.1–5.5 (staking flows), 6.1–6.2 (DAO governance)
4. **Then read the actual Solidity:**
   - `contracts/modules/SSVDAO.sol` — `commitRoot`, governance setters
   - `contracts/modules/SSVClusters.sol` — `updateClusterBalance`
   - `contracts/modules/SSVStaking.sol` — ALL functions
   - `contracts/token/CSSVToken.sol` — mint, burn, `_beforeTokenTransfer` hook
   - `contracts/libraries/ClusterLib.sol` — vUnit calculations, `ebToVUnits`, `vUnitsToEB`
   - `contracts/libraries/OperatorLib.sol` — `updateETHSnapshot` (vUnit-weighted earnings)
   - `contracts/libraries/ProtocolLib.sol` — `networkTotalEarnings`, `updateDAO`
   - `contracts/libraries/storage/SSVStorageEB.sol`
   - `contracts/libraries/storage/SSVStorageStaking.sol`

## What You Must Do

For each function, **read the actual code line by line**. Trace every storage mutation, every calculation.

### A. Oracle System

1. **Single oracle commit** — trace `commitRoot` in SSVDAO.sol:
   - Weight calculation: `totalCSSVSupply / defaultOracleIds.length`
   - Accumulation: `rootCommitments[commitmentKey] += weight`
   - Quorum check: `accumulated >= (totalCSSVSupply * quorumBps) / 10_000`
   - Events: `WeightedRootProposed` vs `RootCommitted`

2. **Quorum reached (3 of 4 oracles, 75% quorum)**:
   - Oracle 1 commits → weight = 25% → no quorum
   - Oracle 2 commits same root → weight = 50% → no quorum
   - Oracle 3 commits same root → weight = 75% → quorum reached → root stored
   - Verify: `ebRoots[blockNum] == merkleRoot`, `latestCommittedBlock == blockNum`

3. **Conflicting roots**:
   - Oracle 1 commits root A for block 100
   - Oracle 2 commits root B for block 100
   - Oracle 3 commits root A for block 100 → quorum for A
   - Verify: root B's accumulated weight is separate, doesn't interfere

4. **Oracle replacement mid-vote**:
   - Oracle 1 votes for root A
   - Owner replaces oracle 1 with oracle 5
   - Oracle 5 votes for root A → does oracle 1's previous vote still count?

5. **Edge cases**:
   - `blockNum > latestCommittedBlock` enforcement (monotonic)
   - `blockNum <= block.number` enforcement (not future)
   - `cSSV.totalSupply() == 0` → revert `OracleHasZeroWeight`
   - Same oracle double-votes → revert `AlreadyVoted`

### B. Effective Balance Updates

1. **First EB update (implicit → explicit)**:
   - Cluster with 2 validators, no prior EB update
   - `effectiveOldVUnits = validatorCount × VUNITS_PRECISION = 20_000`
   - Oracle commits root with EB = 64 ETH (1 val at 32, 1 at 32) → same as implicit
   - Verify: no deviation change
   - Second update: EB = 96 ETH (1 val at 32, 1 at 64) → newVUnits = `ceil(96 × 10_000 / 32) = 30_000`
   - Deviation = 30_000 - 20_000 = 10_000
   - Verify: operator vUnits and DAO vUnits updated

2. **EB increase → higher fee burn rate**:
   - Cluster at EB = 32 → default vUnits
   - Update to EB = 64 → double vUnits
   - Advance 100 blocks → verify fees are 2× what they were before
   - Show exact calculation

3. **EB decrease → lower fee burn rate**:
   - Cluster at EB = 64 → 20_000 vUnits
   - Update to EB = 32 → 10_000 vUnits
   - Advance blocks → verify fees halved

4. **Auto-liquidation on EB increase**:
   - Cluster has borderline balance (just above threshold for 10_000 vUnits)
   - EB update increases to 20_000 vUnits → threshold doubles
   - Balance now below threshold → auto-liquidation
   - Verify: bounty goes to `msg.sender` (the updater), cluster deactivated

5. **Fee settlement uses OLD vUnits**:
   - Before updating vUnits, fees are settled with current (old) vUnits
   - Then vUnits change
   - Future fees use new vUnits
   - Verify: no gap or double-count at the transition point

6. **Operator vUnit tracking across multiple clusters**:
   - Operator serves cluster A (vUnits = 10_000) and cluster B (vUnits = 20_000)
   - `operatorEthVUnits[op]` = deviation for op across all clusters
   - Cluster A updates EB to double → deviation increases
   - Verify: operator earnings reflect combined effective vUnits

7. **EB limits enforcement**:
   - Try EB < 32 × validatorCount → revert `EBBelowMinimum`
   - Try EB > 2048 × validatorCount → revert `EBExceedsMaximum`

8. **Merkle proof verification**:
   - Valid proof → accepted
   - Invalid proof → revert `InvalidProof`
   - Proof for wrong cluster → revert
   - Double-hash convention: `keccak256(keccak256(abi.encode(clusterId, eb)))`

9. **Update frequency and staleness**:
   - `block.number >= lastUpdateBlock + minBlocksBetweenUpdates`
   - `blockNum > lastRootBlockNum` (must use newer root)

### C. Staking System

1. **Basic stake → earn → claim cycle**:
   - Stake 10 SSV → receive 10 cSSV
   - Clusters operate for N blocks, generating network fee revenue
   - `syncFees()` → `accEthPerShare` increases
   - `claimEthRewards()` → exact ETH amount
   - Verify: payout = `(cSSVBalance × (accEthPerShare - userIndex)) / 1e18`, truncated to ETH_DEDUCTED_DIGITS

2. **Multiple stakers — pro-rata distribution**:
   - User A stakes 10 SSV, User B stakes 30 SSV
   - Revenue of X ETH generated
   - User A should get 25%, User B 75%
   - Show exact math with actual numbers

3. **Stake timing matters**:
   - User A stakes at block 0
   - Revenue generated blocks 0-100
   - User B stakes at block 50
   - Revenue blocks 0-50: 100% to A
   - Revenue blocks 50-100: 25/75 split (if A=10, B=30)
   - Verify exact amounts for both

4. **Unstake request → cooldown → withdraw**:
   - User stakes 10 SSV → has 10 cSSV
   - `requestUnstake(5)` → burns 5 cSSV, creates request with cooldown
   - Advance past cooldown
   - `withdrawUnlocked()` → gets 5 SSV back
   - Verify: rewards stopped accruing for the 5 unstaked cSSV at the moment of request

5. **cSSV transfer settles rewards**:
   - User A has 10 cSSV, User B has 0
   - Revenue accrues
   - A transfers 5 cSSV to B
   - `_beforeTokenTransfer` → calls `onCSSVTransfer(A, B, 5)`
   - Verify: A's rewards settled before transfer, B's index set to current
   - More revenue accrues → split 50/50
   - Verify exact amounts

6. **Accumulator edge cases**:
   - **Zero supply**: All cSSV burned via unstake. New revenue generated. Then someone stakes. Does new staker capture old revenue? (They shouldn't — `accEthPerShare` can't update when supply is 0, so those fees stay in the pool but can't be distributed)
   - **accEthPerShare monotonicity**: Verify it never decreases
   - **Dust**: `payout = accrued - (accrued % 100_000)`. Max dust per claim = 99_999 wei. Where does dust accumulate?

7. **MAX_PENDING_REQUESTS (10)**:
   - Make 10 unstake requests → should work
   - Try 11th → revert `MaxRequestsAmountReached`
   - Withdraw some → can make new requests again

8. **MINIMAL_STAKING_AMOUNT**:
   - Try staking less than 1_000_000_000 → revert `StakeTooLow`

9. **`syncFees()` public function**:
   - Anyone can call it to update accumulator
   - No user settlement happens
   - Verify `accEthPerShare` updated, `stakingEthPoolBalance` updated

### D. EB × Staking Interaction

1. **EB increase → higher network fees → more staking rewards**:
   - Cluster with EB = 32 ETH, staker earns X per block
   - EB update to 64 ETH → network fees double (vUnit-weighted)
   - Verify staking rewards per block approximately double
   - Show exact calculation through the full chain: EB update → vUnit change → higher network fee accrual → `accEthPerShare` increase

2. **Auto-liquidation reduces active clusters → less revenue for stakers**:
   - 3 clusters generating fees
   - 1 gets auto-liquidated via EB update
   - Verify: staking rewards reflect only 2 remaining clusters' fees

## FLOWS.md Comparison

For EVERY scenario, compare against `docs/FLOWS.md`:
- Does the code match documented state mutations?
- Does the code match documented postcondition invariants?
- Any discrepancy → dedicated section, flagged for human review.

## Output Format

Write to `docs/scenarios/eb-staking.md`:

```markdown
# Scenario Tests: Effective Balance + Staking

## Discrepancies (Code vs FLOWS.md)
[FLAG FOR HUMAN REVIEW]

### DISC-ES-N: [Title]
- **FLOWS.md says:** ...
- **Code does:** ... (file:line)
- **Likely correct:** Code / FLOWS.md
- **Impact:** ...

## Global Invariants for This Partition
- `accEthPerShare` only increases, never decreases
- `cSSV.totalSupply() == Σ(all staked - all unstake-requested)`
- `stakingEthPoolBalance` tracks total ETH pool for stakers
- `daoTotalEthVUnits == ethDaoValidatorCount × VUNITS_PRECISION + Σ(deviations)`
- ...

## Scenarios

### ES-N: [Descriptive Name]
[Same format as other partitions]
```

## Rules

1. **Every assertion = exact formula with actual numbers.**
2. **Read the code, not just FLOWS.md.**
3. **No priorities — everything is critical.**
4. **The accumulator math is the hardest part.** Triple-check every `accEthPerShare` calculation. Show each step.
5. **Trace the full chain**: cluster fees → DAO earnings → `networkTotalEarnings()` → `syncFees()` → `accEthPerShare` → user rewards.
6. **Include revert scenarios.**
