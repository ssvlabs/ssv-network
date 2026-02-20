# WORK_PROMPT — Standard Claude Task Briefing

Use this template when assigning a MAINNET-READINESS task to Claude.
Copy the block below, fill in the placeholders, then send it.

---

## Template

```
You are working on the SSV Network v2.0.0 smart contracts (`ssv-staking` branch).

**Task:** [TASK_ID] — [TASK_DESCRIPTION]

**Before doing anything, read these in order:**
1. `CLAUDE.md` — project conventions, storage patterns, security rules, key constants.
2. `docs/SPEC.md` §[RELEVANT_SECTION] — specification for the feature you are modifying.
3. `docs/FLOWS.md` §[RELEVANT_SECTION] — step-by-step state mutations for the affected flow.
4. `docs/SOLIDITY_BEST_PRACTICES.md` §[RELEVANT_SECTIONS] — applicable security patterns.
5. `ssv-review/planning/MAINNET-READINESS.md` §[TASK_ID] — full task: Context, Requirement,
   Acceptance Criteria, Agent Instructions.

**Quality bar:**
- Minimal upstream fix — if one line fixes it, use one line. No over-engineering.
- Match existing code style exactly. No new comments unless the task asks for them.
- All new code paths must have test coverage.
- No storage variables outside diamond storage structs (see CLAUDE.md §Storage Pattern).
- No events added or renamed without checking CLAUDE.md §Backward Compatibility.
- No imports from test files in deploy scripts.

**Deliverables:**
1. Code change (if applicable) with a one-paragraph explanation of the root cause and fix.
2. Test(s) in `test/unit/` or `test/integration/` using existing Mocha + Chai + ethers v6
   patterns from `test/helpers/contract-helpers.ts`.
3. All sub-item checkboxes in the MAINNET-READINESS.md §[TASK_ID] section checked off.
4. Task Status line updated to ✅ Fixed or ✅ Closed.
```

---

## SOLIDITY_BEST_PRACTICES.md Section Guide

| Task type | Relevant sections |
|-----------|-------------------|
| New validation / input guard | §5 Access Control, §4 Arithmetic Safety |
| New ETH or token transfer | §6 Reentrancy & External Interactions, §8 Token Integration |
| Storage struct modification | §3 Upgradeability & Proxy Patterns |
| New or changed event | §7 Event Logging & Monitoring |
| Writing unit tests | §9 Testing Strategy, §12 Security Properties & Invariants |
| Writing echidna invariants | §11 Fuzzing with Echidna |
| Pre-merge self-review | §13 Code Maturity Checklist, §15 Pre-Audit Checklist |

---

## SPEC.md / FLOWS.md Section Guide

| Feature area | SPEC.md | FLOWS.md |
|-------------|---------|----------|
| Operator management | §2 Operators | §2 Operator flows |
| ETH cluster lifecycle | §3 ETH Clusters | §3 Cluster flows |
| EB / oracle | §4 Oracle System | §4 Oracle / EB flows |
| Staking / unstaking | §5 SSV Staking | §5 Staking flows |
| DAO governance | §11 Governance Parameters | §6 Governance flows |
| Liquidation | §3.5 Liquidation | §3.4 Liquidation flow |
| Migration SSV→ETH | §3.6 Migration | §3.5 Migration flow |

---

## Example — SEC-19

```
You are working on the SSV Network v2.0.0 smart contracts (`ssv-staking` branch).

**Task:** SEC-19 — `minBlocksBetweenUpdates` never initialized — EB update rate limit silently disabled

**Before doing anything, read these in order:**
1. `CLAUDE.md`
2. `docs/SPEC.md` §4 Oracle System (EB update frequency constraints)
3. `docs/FLOWS.md` §4 updateClusterBalance flow
4. `docs/SOLIDITY_BEST_PRACTICES.md` §3 Upgradeability & Proxy Patterns, §5 Access Control
5. `ssv-review/planning/MAINNET-READINESS.md` §SEC-19

[quality bar and deliverables as above]
```

---

## Example — TEST-5

```
You are working on the SSV Network v2.0.0 smart contracts (`ssv-staking` branch).

**Task:** TEST-5 — Oracle quorum edge cases

**Before doing anything, read these in order:**
1. `CLAUDE.md`
2. `docs/SPEC.md` §4 Oracle System (quorum, commitRoot, stake weights)
3. `docs/FLOWS.md` §4 commitRoot / proposeRoot flow
4. `docs/SOLIDITY_BEST_PRACTICES.md` §9 Testing Strategy, §12 Security Properties
5. `ssv-review/planning/MAINNET-READINESS.md` §TEST-5

[quality bar and deliverables as above]
```
