---
title: 'Scenario discovery: Operators + Validators'
base-branch: scenario-tests-design
schema: 2
model: claude-opus-4-6
---

You are performing deep scenario-discovery on the **Operator** and **Validator** modules of SSV Network v2.0.0. Your goal: produce implementation-ready test scenarios that verify the system is economically correct after realistic multi-step flows.

## Why This Matters

Existing tests check "did the function succeed/revert?" but NOT "is the state economically correct after N blocks?" Example: registering a validator on a public operator succeeded, but the default ETH fee was zero — nobody checked that fees accrued correctly. We need scenarios that catch this class of bug.

## Required Reading (in order)

1. `CLAUDE.md` — Architecture, storage patterns, key constants
2. `docs/SPEC.md` — Accounting formulas (sections 6, 8, 10, 13)
3. `docs/FLOWS.md` — Sections 1.1–1.3 (validator flows) and 4.1–4.7 (operator flows)
4. **Then read the actual Solidity:**
   - `contracts/modules/SSVOperators.sol`
   - `contracts/modules/SSVValidators.sol`
   - `contracts/libraries/OperatorLib.sol`
   - `contracts/libraries/ValidatorLib.sol`
   - `contracts/libraries/SSVCoreTypes.sol` (Operator struct, Snapshot types)
   - `contracts/libraries/SSVPackedLib.sol` (packing/unpacking)
   - `contracts/libraries/storage/SSVStorage.sol`
   - `contracts/libraries/storage/SSVStorageProtocol.sol`

## What You Must Do

For each function, **read the actual code line by line**. Don't summarize from docs — trace every `sstore`, every internal call, every state mutation.

### A. Operator Lifecycle Scenarios

1. **Register operator** — public vs private. What gets stored? What are the initial values for all fields?
2. **`ensureETHDefaults()`** — CRITICAL. Read `OperatorLib.sol` and trace exactly when this is called, what it sets. What happens if SSV fee was 0? If SSV fee was > 0?
3. **Fee declaration → wait → execution** — trace the full timelock flow. What happens to existing clusters' economics when fee changes?
4. **Fee reduction** (immediate, no timelock) — verify snapshot updates correctly
5. **Operator earnings accumulation** — trace `updateETHSnapshot` in `OperatorLib.sol`. How does `ethSnapshot.balance` grow? Formula: `balance += blockDiff * ethFee * effectiveVUnits / VUNITS_PRECISION`
6. **Withdraw operator earnings** (ETH and SSV) — verify exact amounts, verify snapshot reset
7. **Remove operator** — full cleanup: what gets zeroed, what's preserved (owner), final earnings withdrawal. What checks prevent removal if validators still exist?

### B. Validator Lifecycle Scenarios

1. **Register validator — NEW cluster (no prior state)**
   - 4 public operators (never used in ETH before) → should trigger `ensureETHDefaults` for each
   - Verify: after registration, each operator's `ethFee` is correct (DEFAULT_OPERATOR_ETH_FEE or 0)
   - Verify: cluster is created with correct initial state
   - Advance 100 blocks → verify operator earnings = `DEFAULT_FEE × 100 × vUnits / VUNITS_PRECISION × ETH_DEDUCTED_DIGITS`
   - Verify cluster balance decreased by total fees

2. **Register validator — EXISTING cluster**
   - Already has 1 validator, fees have been accruing for 50 blocks
   - Register 2nd validator → verify fee settlement happens before adding
   - Advance 100 more blocks → verify new burn rate reflects 2 validators

3. **Register on private operators** — verify whitelist check, declared fee used (not default)

4. **Bulk register** — N validators in one call. Verify operator counts increment by N, single ETH deposit

5. **Remove validator** — verify operator counts decrement, fee settlement, cluster balance update
   - Remove from 2-validator cluster → verify burn rate adjusts
   - Remove last validator → verify cluster still exists with remaining balance

6. **Register → advance → remove → advance → verify** — full lifecycle with economics check at each step

### C. Cross-Module Interactions (Operator × Validator)

1. **Fee change during active cluster**: Operator has 3 validators, declares fee change, executes it. Verify: earnings before the change used old fee, earnings after use new fee. No gap, no double-count.

2. **Multi-cluster operator**: Operator serves cluster A (2 validators) and cluster B (3 validators). Verify: operator earnings = fee × 5 × vUnits/VUNITS_PRECISION. Cluster A removes all validators → operator earnings now = fee × 3 × vUnits/VUNITS_PRECISION. Verify no double-subtraction.

3. **Operator removal after all validators removed**: Register → remove all validators → remove operator → verify final earnings are correct and fully withdrawn.

## FLOWS.md Comparison

For EVERY scenario, compare your findings against `docs/FLOWS.md`:
- Does the code match the documented state mutations?
- Does the code match the documented postcondition invariants?
- If there's a discrepancy, document it clearly: what code does vs what FLOWS.md says, which you believe is correct, and why.

**Put all discrepancies in a dedicated section at the top of your output.**

## Output Format

Write to `docs/scenarios/operators-validators.md`:

```markdown
# Scenario Tests: Operators + Validators

## Discrepancies (Code vs FLOWS.md)
[Any differences found — FLAG FOR HUMAN REVIEW]

### DISC-OV-N: [Title]
- **FLOWS.md says:** ...
- **Code does:** ... (file:line)
- **Likely correct:** Code / FLOWS.md
- **Impact:** ...

## Global Invariants for This Partition
- After any operation: `Σ(operator.ethValidatorCount) == ethDaoValidatorCount`
- Operator earnings formula: `ethSnapshot.balance += blockDiff × ethFee × effectiveVUnits / VUNITS_PRECISION`
- ...

## Scenarios

### OV-1: [Descriptive Name]

**Modules Touched:** SSVOperators, SSVValidators
**Bug Class Covered:** [what bug pattern this catches]

#### Preconditions
- [Exact setup with specific values]

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | ... | ... | ... |

#### Assertions (with exact formulas and numbers)
- [ ] `operator[1].ethFee == 1_770_000_000` (DEFAULT_OPERATOR_ETH_FEE via ensureETHDefaults)
- [ ] `operator[1].ethSnapshot.balance == 1_770_000_000 × 100 × 10_000 / 10_000 × 100_000 = 17_700_000_000_000_000`
- [ ] ...

#### Edge Variations
- [boundary conditions, same scenario with tweaks]
```

## Rules

1. **Every assertion = exact formula with actual numbers.** Not "balance correct" but the full calculation.
2. **Read the code, not just FLOWS.md.** Trace `registerValidator` → `ValidatorLib.validateState` → `operator.updateETHSnapshot` → what changes in storage.
3. **No priorities — everything is critical.** Mainnet contracts, real money.
4. **Think adversarially.** What ordering breaks invariants? What edge case was never tested?
5. **Include revert scenarios.** What should fail? (e.g., register on removed operator, remove non-existent validator)
