# SSV Network v2.0.0 — 2-Week Sprint Plan

**Horizon:** 2026-02-20 → 2026-03-06  
**Target:** Mainnet deployment ready by end of sprint

---

## Document Roles

| File | Owner | Purpose |
|------|-------|---------|
| `docs/SPEC.md` | Marco | Source of truth — invariants, formulas, parameters |
| `docs/FLOWS.md` | Marco | Step-by-step state mutations per function |
| `docs/DISC.md` | Marco | Discrepancies between proposal, spec, and code |
| `ssv-review/planning/MAINNET-READINESS.md` | Devs | Task backlog with acceptance criteria |
| `ssv-review/planning/WORK_PROMPT.md` | Devs | Standard Claude briefing template per task |
| `docs/SPEC_GAPS.md` | Marco | NEW — boundary/cross-feature/negative/unspecified behaviors → feeds tests |
| `docs/SOLIDITY_BEST_PRACTICES.md` | Devs | Security patterns — referenced in WORK_PROMPT per task type |
| `CLAUDE.md` | - | Claude project briefing — conventions, storage, security rules |

---

## File Structure

**Keep SPEC.md and FLOWS.md monolithic. Do not split into domain-specific files.**

- `docs/SPEC_GAPS.md` — additive only, not a replacement. Captures what SPEC intentionally omits. You own this.
- `ssv-review/planning/WORK_PROMPT.md` — recreated. Standardizes Claude briefing per task.

---

## Process

### Phase 0 — Onboarding (½–1 day, all devs)

Before picking up any task, every dev reads:
1. `CLAUDE.md` — project conventions, storage rules, key constants
2. `docs/SPEC.md` — full specification (invariants, formulas, parameters)
3. `docs/FLOWS.md` — step-by-step state mutations per function

Goal: get familiar with the system. While reading, note anything that is unclear, missing, or contradicts the code — open a GitHub issue/PR tagged `spec-feedback`. Marco will triage these into `docs/SPEC_GAPS.md` or fix them in place.

### Phase 1 — Task Loop (devs, ongoing)

Task source: `ssv-review/planning/MAINNET-READINESS.md`. Pick by priority (P0 → P1 → P2).

For each task:
1. Open the task section in `MAINNET-READINESS.md` — read Context, Requirement, Acceptance Criteria
2. Copy the template from `ssv-review/planning/WORK_PROMPT.md`, fill in the task ID and relevant doc sections, send to Claude
3. Implement the fix or test following the quality bar in `WORK_PROMPT.md`
4. Deliver per Definition of Done below
5. All PRs off the `ssv-staking` branch

**Priority order from MAINNET-READINESS:**
- P0 first (CI blockers, critical fixes): TEST-28, SEC-19, SEC-17
- P1 next (pre-mainnet required): TEST-1–8, TEST-29–32, ITEST-1–2, OPS-1–2, FUZZ-1–2, DEPLOY-2
- P2 (if capacity): SEC-13, SEC-18, QUALITY items, OPS-3, FUZZ-3–4

### Phase 2 — SPEC Gap Analysis (Marco, parallel)

Goal: produce `docs/SPEC_GAPS.md` continuously during the sprint. New entries → new TEST tasks added to `MAINNET-READINESS.md` for devs to pick up.

---

## SPEC Gap Analysis — Format and Scope

### Dimensions to cover (per feature):

| Dimension | Examples |
|-----------|---------|
| **Boundary conditions** | MAX_PENDING_REQUESTS (2000) hit exactly; EB at exactly 32/2048 ETH/validator; quorumBps at 1 and 10000; zero validator count; single oracle |
| **Cross-feature interactions** | migrate + pending unstake; liquidate + oracle EB in same block; operator removal during active EB update; reactivate while cooldown changes |
| **Negative cases** | Map each custom error to its exact triggering condition (EBBelowMinimum, OracleHasZeroWeight, UpdateTooFrequent, etc.) |
| **Unspecified behaviors** | Accrued rewards after cSSV burns to 0; `updateClusterBalance` on never-staked cluster; oracle commit for cluster with 0 validators |

### Output format for SPEC_GAPS.md:

```
## [Feature] — [Dimension]
**Scenario:** (what happens)
**Expected:** (correct outcome or open question)
**Source:** code | derived | open question → Product
**Maps to:** TEST-XX or NEW
```

### Priority order for Marco's gap analysis:
1. Staking/unstaking (most complex, least covered)
2. Oracle/EB update flow (critical path, new feature)
3. Liquidation + reactivation cross-feature
4. Operator earnings (ETH vs SSV dual paths)

---

## How to Use WORK_PROMPT.md

`ssv-review/planning/WORK_PROMPT.md` — standard Claude task briefing. When picking up a task:
1. Copy the template
2. Fill in `[TASK_ID]` and the relevant SPEC.md / FLOWS.md section numbers
3. Add the applicable `SOLIDITY_BEST_PRACTICES.md` sections (guide table is in WORK_PROMPT.md)
4. Send to Claude — it will read CLAUDE.md, SPEC, FLOWS, and best practices before touching any code

⚠️ Always do human verification. Don't trust AI blindly.

---

## Definition of Done (per task)

1. `npx hardhat compile` passes
2. `npm run test:unit` (or `test:integration`) passes
3. All sub-item checkboxes in MAINNET-READINESS.md checked
4. Task Status updated to ✅ Fixed / ✅ Closed
5. PR number linked in MAINNET-READINESS.md
