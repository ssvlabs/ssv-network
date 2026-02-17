---
title: 'Scenario discovery: Clusters + Migration'
base-branch: scenario-tests-design
schema: 2
model: claude-opus-4-6
---

You are performing deep scenario-discovery on the **Cluster** and **Migration** flows of SSV Network v2.0.0. Your goal: produce implementation-ready test scenarios that verify the system is economically correct after realistic multi-step flows.

## Why This Matters

Existing tests check "did the function succeed/revert?" but NOT "is the state economically correct after N blocks?" We need scenarios that test deposit → advance → withdraw → verify exact balance. Liquidation → verify exact bounty. Migration → verify SSV refund is exactly right AND post-migration ETH fees accrue correctly.

## Required Reading (in order)

1. `CLAUDE.md` — Architecture, storage patterns, key constants
2. `docs/SPEC.md` — Accounting formulas (sections 1, 6, 10, 12, 13)
3. `docs/FLOWS.md` — Sections 1.1–1.8 (cluster flows), 2.1 (migration)
4. **Then read the actual Solidity:**
   - `contracts/modules/SSVClusters.sol` — ALL functions
   - `contracts/libraries/ClusterLib.sol` — balance update, liquidation check, hashing
   - `contracts/libraries/OperatorLib.sol` — snapshot updates (both SSV and ETH paths)
   - `contracts/libraries/ProtocolLib.sol` — DAO accounting, fee indices
   - `contracts/libraries/SSVPackedLib.sol` — packing precision
   - `contracts/libraries/storage/SSVStorage.sol` — `clusters` vs `ethClusters`
   - `contracts/libraries/storage/SSVStorageProtocol.sol` — DAO counters, fee indices

## What You Must Do

For each function, **read the actual code line by line**. Trace every `sstore`, every internal call, every state mutation.

### A. ETH Cluster Lifecycle

1. **Create cluster** (via registerValidator with EMPTY_CLUSTER)
   - What gets stored in `ethClusters[key]`?
   - What are the initial values for `cluster.index`, `cluster.networkFeeIndex`?
   - Trace `ClusterLib.hashClusterData` to verify hash computation

2. **Deposit ETH** — exact flow:
   - Operator snapshots updated (why? what changes?)
   - Fee settlement before deposit (how much is deducted?)
   - Balance increase = exactly `msg.value`
   - New hash stored

3. **Withdraw ETH** — exact flow:
   - Fee settlement before withdrawal
   - Liquidation check AFTER withdrawal (boundary: exact minimum balance that doesn't trigger)
   - ETH transfer to caller
   - Verify: `contract.balance` decreased by exactly `amount`

4. **Liquidation (third party)**:
   - Trace `isLiquidatable` in `ClusterLib.sol` — exact threshold formula with vUnits
   - Verify: bounty = remaining cluster balance after fee settlement
   - Verify: operator ethValidatorCount decremented for ALL operators
   - Verify: `ethDaoValidatorCount` decreased by `cluster.validatorCount`
   - Verify: cluster state = `{active: false, balance: 0, index: 0, networkFeeIndex: 0}`

5. **Self-liquidation**: Always allowed regardless of balance. Same state cleanup.

6. **Reactivation**:
   - From liquidated state: `active = false`
   - Deposit via msg.value
   - Operator counts re-incremented
   - Must pass liquidation check with new balance
   - Indices reset to current

7. **Boundary scenarios**:
   - Withdraw exactly to liquidation threshold → should succeed
   - Withdraw 1 wei past liquidation threshold → should revert
   - Deposit on inactive cluster → should revert
   - Liquidate a cluster that's exactly at threshold → should it liquidate or not?

### B. SSV Legacy Cluster Lifecycle

1. **Blocked operations** — verify these revert:
   - Register validator on SSV cluster
   - Deposit SSV
   - Reactivate SSV cluster

2. **Allowed operations**:
   - Self-liquidate SSV cluster → verify SSV balance returned
   - Exit validators → verify event emitted
   - Migrate to ETH (covered in section C)

3. **SSV fee accrual**: Existing SSV cluster continues burning fees. Advance N blocks, verify SSV balance decreased by exactly `(Σ operator fees + network fee) × validatorCount × N × DEDUCTED_DIGITS`

### C. Migration (SSV → ETH) — CRITICAL

This is one of the most complex flows. Trace `migrateClusterToETH` line by line.

1. **Full migration flow**:
   - Pre-state: SSV cluster with known balance, N validators
   - For each operator: SSV snapshot updated (final earnings), `validatorCount--` (SSV), `ensureETHDefaults()` or ETH snapshot update, `ethValidatorCount++`
   - SSV refund = remaining SSV balance after fee settlement
   - ETH cluster created with `balance = msg.value`
   - DAO: SSV count down, ETH count up + baseline vUnits
   - Verify: `s.clusters[key]` deleted, `s.ethClusters[key]` created

2. **Migration of liquidated SSV cluster** (special case):
   - If cluster was liquidated (`active == false`): SSV validatorCount should NOT be decremented (it was already decremented during liquidation)
   - Verify the code handles this correctly (check the conditional in `migrateClusterToETH`)

3. **Post-migration operations**:
   - After migration, register new validator on same cluster → should work as ETH cluster
   - Advance blocks → verify fees use ETH model, not SSV
   - Withdraw ETH → verify works

4. **Migration with EB deviation sync**:
   - If cluster had explicit EB snapshot from a previous `updateClusterBalance`
   - vUnits deviation must be synced to operator/DAO tracking
   - Trace the EB sync code path in `migrateClusterToETH`

5. **Migration with mixed operator state**:
   - Some operators already have ETH validators (from other clusters)
   - Some operators are ETH-new (first ETH interaction → `ensureETHDefaults`)
   - Verify both paths work correctly

6. **Economics verification post-migration**:
   - Migrate with msg.value = 10 ETH
   - Advance 100 blocks
   - Verify cluster balance = 10 ETH - ETH fees (not SSV fees!)
   - Verify operator ETH earnings = ETH fee × blocks × vUnits
   - Verify SSV refund was exactly correct (compute from SSV formulas)

### D. Conservation Laws

For every scenario, verify at the end:
- `contract.ETH >= Σ(active ETH cluster balances) + Σ(operator ETH earnings) + staking pool`
- `contract.SSV >= Σ(active SSV cluster balances) + Σ(operator SSV earnings) + staked SSV`
- `ethDaoValidatorCount == Σ(operator.ethValidatorCount)` (only if each operator serves exactly 1 cluster — otherwise this is per-cluster, not per-operator)
- `daoTotalEthVUnits == ethDaoValidatorCount × VUNITS_PRECISION + Σ(cluster deviations)`

## FLOWS.md Comparison

For EVERY scenario, compare against `docs/FLOWS.md`:
- Does the code match documented state mutations?
- Does the code match documented postcondition invariants?
- Any discrepancy → dedicated section, flagged for human review.

## Output Format

Write to `docs/scenarios/clusters-migration.md`:

```markdown
# Scenario Tests: Clusters + Migration

## Discrepancies (Code vs FLOWS.md)
[FLAG FOR HUMAN REVIEW]

### DISC-CM-N: [Title]
- **FLOWS.md says:** ...
- **Code does:** ... (file:line)
- **Likely correct:** Code / FLOWS.md
- **Impact:** ...

## Global Invariants for This Partition
[List invariants checked across all scenarios]

## Scenarios

### CM-1: [Descriptive Name]

**Modules Touched:** SSVClusters, ...
**Bug Class Covered:** [what this catches]

#### Preconditions
- [Exact setup]

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | ... | ... | ... |

#### Assertions (exact formulas with numbers)
- [ ] ...

#### Edge Variations
- ...
```

## Rules

1. **Every assertion = exact formula with actual numbers.**
2. **Read the code line by line.** Not just FLOWS.md.
3. **No priorities — everything is critical.**
4. **Pay special attention to migration.** This is the most complex flow and most likely to have bugs.
5. **Include revert scenarios.** What should fail?
6. **Block counting precision.** When asserting fee amounts, be exact about how many blocks elapsed between each operation.
