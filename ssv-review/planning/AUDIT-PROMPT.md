# SSV Network — Continuous Audit Prompt

Reusable prompt for running standardized security/correctness audits on any scope (PR, module, branch diff, full codebase). Outputs findings in MAINNET-READINESS.md format so they can be directly merged.

---

## Usage

### Run on a specific module
```bash
subtask draft audit/clusters --base-branch ssv-staking --title "Audit SSVClusters module" <<'EOF'
<paste the full prompt below, set SCOPE = "contracts/modules/SSVClusters.sol + contracts/libraries/ClusterLib.sol">
EOF
subtask send audit/clusters "Go ahead."
```

### Run on a PR diff
```bash
subtask draft audit/pr-NNN --base-branch ssv-staking --title "Audit PR #NNN" <<'EOF'
<paste the full prompt below, set SCOPE = "git diff ssv-staking...HEAD">
EOF
subtask send audit/pr-NNN "Go ahead."
```

### Run full codebase sweep
```bash
subtask draft audit/full-sweep --base-branch ssv-staking --title "Full codebase audit sweep" <<'EOF'
<paste the full prompt below, set SCOPE = "all contracts/">
EOF
subtask send audit/full-sweep "Go ahead."
```

---

## Audit Prompt

```
You are performing a security and correctness audit on SSV Network v2.0.0 smart contracts.

## Scope
[SCOPE_DESCRIPTION]
- Files: [LIST_FILES_OR_PATTERN]
- Focus: [SPECIFIC_AREA_OR_ALL]

## Required Reading (before auditing)

Read these first to understand the system:
1. `CLAUDE.md` — Project architecture, storage pattern, security rules, key constants
2. `docs/SPEC.md` — Full technical specification (source of truth for behavior)
3. `docs/FLOWS.md` — Contract flows with invariants and state mutations

## Audit Checklist

Run every check below against the scoped code. For each check, document:
- What you checked
- What you found (PASS / ISSUE)
- If ISSUE: severity, file:line, description

### 1. Spec Compliance
- [ ] Every function in scope matches its specification in SPEC.md
- [ ] Event signatures and parameters match SPEC.md
- [ ] Error conditions match SPEC.md (correct reverts for invalid inputs)
- [ ] State mutations match the flows described in FLOWS.md
- [ ] Invariants from FLOWS.md hold after every state transition
- [ ] DIP-X proposal requirements are satisfied (read `ssv-review/Internal - [DIP-X] SSV Staking.txt`)

### 2. Security Analysis
- [ ] **Reentrancy:** Any function making external calls (ETH transfer, token transfer, delegatecall) has `nonReentrant` modifier
- [ ] **Access control:** Owner-only functions gated at proxy level, operator/cluster owner checks enforced, oracle checks enforced
- [ ] **Integer overflow/underflow:** Packed type conversions are safe, no unchecked math on user inputs
- [ ] **Precision loss:** Fee calculations use correct packing/unpacking, vUnit conversions use ceiling/floor correctly
- [ ] **Storage safety:** No direct storage variables on modules, diamond storage only, append-only structs
- [ ] **Front-running:** Can the order of transactions change the outcome unfavorably? (MEV risks)
- [ ] **Denial of service:** No unbounded loops, no griefing vectors, no state that can make functions permanently revert
- [ ] **Oracle manipulation:** Can oracle data be spoofed? Can quorum be gamed? Are block numbers monotonic?

### 3. Accounting Correctness
- [ ] **Fee settlement:** Operator fees settle correctly on register/remove/deposit/withdraw/liquidate/reactivate
- [ ] **Balance conservation:** `contract.balance == sum(cluster_balances) + sum(operator_earnings) + dao_earnings + staking_pool`
- [ ] **vUnit math:** `ebToVUnits` uses ceiling division, `vUnitsToEB` uses floor division, VUNITS_PRECISION = 10_000
- [ ] **Packed types:** Values not divisible by precision factor revert with MaxPrecisionExceeded
- [ ] **Liquidation threshold:** Correctly computed with vUnit-weighted burn rate
- [ ] **Staking accumulator:** `accEthPerShare` increments correctly, rewards settle on every state change
- [ ] **Operator earnings:** EB-weighted earnings accumulate correctly for ETH clusters, validator-count-weighted for SSV clusters
- [ ] **DAO earnings:** Network fees flow correctly to DAO balance (ETH and SSV tracked separately)

### 4. Edge Cases
- [ ] **Zero values:** What happens with 0 validators, 0 balance, 0 fees, 0 operators, 0 staked?
- [ ] **Max values:** 13 operators, 3000 validators per operator, EB=2048 ETH, uint64 max
- [ ] **Boundary conditions:** Exactly at liquidation threshold, exactly at min/max EB, exactly at cooldown expiry
- [ ] **Empty/removed state:** Removed operators, liquidated clusters, empty clusters, 0 cSSV supply
- [ ] **Ordering:** Does the order of operations matter? (register before deposit, migrate before add validators, etc.)
- [ ] **Concurrent operations:** Two clusters sharing operators, EB update + withdraw in same block, stake + oracle vote

### 5. Unit Test Coverage
- [ ] Read all test files in `test/unit/` related to the scoped code
- [ ] Identify scenarios that ARE tested
- [ ] Identify scenarios that are NOT tested (gaps)
- [ ] For gaps: estimate severity (P0=security, P1=correctness, P2=edge case)
- [ ] Check test quality: do tests assert balance deltas, not just events? Do tests use non-zero fees?

### 6. Code Quality
- [ ] **Dead code:** Unused functions, events, errors, imports, structs
- [ ] **Misleading names:** Variable/function names that don't match behavior
- [ ] **Missing NatSpec:** Public/external functions without documentation
- [ ] **Inconsistent patterns:** Does the code follow the same patterns as the rest of the codebase?
- [ ] **Gas optimization:** Obvious gas waste (redundant SLOADs, unnecessary memory copies, etc.)
- [ ] **Commented-out code:** Should be removed, not left in
- [ ] **TODO/FIXME/HACK:** Flag any found

## Output Format

Write your findings to a file named `audit-[SCOPE_NAME]-[DATE].md` in the `ssv-review/planning/verified/` directory.

### Structure

Start with a summary:
```markdown
# Audit: [SCOPE_NAME]
**Date:** YYYY-MM-DD
**Scope:** [files audited]
**Commit:** [hash]

## Summary
| Category | Pass | Issues | Critical | High | Medium | Low |
|----------|------|--------|----------|------|--------|-----|
| Spec Compliance | X | Y | ... |
| Security | ... |
| Accounting | ... |
| Edge Cases | ... |
| Test Coverage | ... |
| Code Quality | ... |
```

### For each issue, use MAINNET-READINESS.md format:

```markdown
### [NEW-ID] Issue Title
- **Type:** Critical Bug Fix / Security Hardening / Unit Test Completeness / etc.
- **Priority:** P0 / P1 / P2
- **Status:** Open
- **Owner:** (unassigned)

**Requirement:**
<what needs to be done>

**Context:**
<why it matters, file:line references>

**Acceptance Criteria:**
- [ ] <criterion 1>
- [ ] <criterion 2>

**Agent Instructions:**
<detailed steps for an AI agent to fix this>

#### Sub-items:
- [ ] Sub-task 1
- [ ] Sub-task 2
```

Use temporary IDs like `NEW-1`, `NEW-2` etc. These will be renumbered when merged into MAINNET-READINESS.md.

### At the end, include a merge section:

```markdown
## Items to Add to MAINNET-READINESS.md
| Temp ID | Suggested ID | Title | Priority |
|---------|-------------|-------|----------|
| NEW-1 | BUG-N | ... | P0 |
| NEW-2 | TEST-N | ... | P1 |
```

## Cross-Reference

Before reporting an issue, check if it already exists in:
- `ssv-review/planning/MAINNET-READINESS.md`

If it does, note "Already tracked as [ITEM-ID]" and skip it. Only report NEW findings.
```

---

## Merging Findings

After an audit run completes:

1. Review the output file in `ssv-review/planning/verified/`
2. For each new finding, assign a real ID (continue from the highest existing ID in each category)
3. Append to MAINNET-READINESS.md using the same format
4. Update the Priority Summary table
5. Commit and push

This can also be automated with a follow-up subtask worker:
```bash
subtask draft merge/audit-findings --base-branch claude-init --title "Merge audit findings" <<'EOF'
Read ssv-review/planning/verified/audit-[NAME]-[DATE].md
Read ssv-review/planning/MAINNET-READINESS.md
Add new items, update summary table, commit.
EOF
```
