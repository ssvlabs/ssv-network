---
name: audit
description: "Run a standardized security and correctness audit on SSV Network contracts. Use when the user wants to audit a module, PR, branch diff, or the full codebase. Outputs findings in MAINNET-READINESS.md format."
argument-hint: "[scope: module name, pr number, 'full', or file path]"
---

# SSV Network — Contract Audit Skill

Run a standardized audit against SSV Network v2.0.0 smart contracts. Dispatches parallel subtask workers to check spec compliance, security, accounting correctness, edge cases, test coverage, and code quality.

## Scope Resolution

Parse `$ARGUMENTS` to determine the audit scope:

| Input | Scope | Files |
|-------|-------|-------|
| `clusters` | SSVClusters module | `contracts/modules/SSVClusters.sol`, `contracts/libraries/ClusterLib.sol` |
| `operators` | SSVOperators module | `contracts/modules/SSVOperators.sol`, `contracts/libraries/OperatorLib.sol`, `contracts/modules/SSVOperatorsWhitelist.sol` |
| `validators` | SSVValidators module | `contracts/modules/SSVValidators.sol`, `contracts/libraries/ValidatorLib.sol` |
| `staking` | SSVStaking module | `contracts/modules/SSVStaking.sol`, `contracts/token/CSSVToken.sol`, `contracts/libraries/storage/SSVStorageStaking.sol` |
| `dao` | SSVDAO module | `contracts/modules/SSVDAO.sol`, `contracts/libraries/ProtocolLib.sol` |
| `views` | SSVViews module | `contracts/modules/SSVViews.sol` |
| `pr <number>` | Pull request diff | Run `gh pr diff <number>` to get files |
| `full` | Full codebase | All `contracts/` files |
| `<file path>` | Specific file | The given file |

If no argument provided, ask the user what to audit.

## Execution

Use `subtask` to dispatch **3 parallel workers**, each handling a different audit dimension. All workers must use `--base-branch` matching the current branch.

**IMPORTANT:** Unset CLAUDECODE before running subtask commands: `unset CLAUDECODE && subtask ...`

### Worker 1: Security & Spec Compliance

```bash
unset CLAUDECODE && subtask draft audit/security-[SCOPE] --base-branch [BRANCH] --title "Security audit: [SCOPE]" <<'TASK'
You are performing a security and spec compliance audit on SSV Network v2.0.0.

## Required Reading
1. `CLAUDE.md` — Architecture, storage pattern, security rules
2. `docs/SPEC.md` — Technical specification (source of truth)
3. `docs/FLOWS.md` — Contract flows with invariants

## Scope
[SCOPE_FILES]

## Checks

### Spec Compliance
- Every function matches its specification in SPEC.md
- Event signatures and parameters match SPEC.md
- Error conditions and reverts match SPEC.md
- State mutations match FLOWS.md
- Invariants from FLOWS.md hold after every state transition
- DIP-X requirements satisfied (read `ssv-review/Internal - [DIP-X] SSV Staking.txt`)

### Security
- **Reentrancy:** External calls (ETH/token transfer, delegatecall) have `nonReentrant`
- **Access control:** Owner at proxy, operator/cluster/oracle checks enforced
- **Integer overflow:** Packed type conversions safe, no unchecked math on user inputs
- **Precision loss:** Fee calculations use correct pack/unpack, vUnit ceiling/floor correct
- **Storage safety:** Diamond storage only, append-only structs, no module storage vars
- **Front-running:** Can tx ordering change outcomes? MEV risks?
- **DoS:** No unbounded loops, no griefing, no permanent reverts
- **Oracle manipulation:** Quorum gaming, stale data, block monotonicity

### Accounting
- Fee settlement correct on register/remove/deposit/withdraw/liquidate/reactivate
- Balance conservation: `contract.balance == sum(clusters) + sum(operators) + dao + staking`
- vUnit math: ceiling for ETH→vUnits, floor for vUnits→ETH
- Packed types: non-divisible values revert with MaxPrecisionExceeded
- Liquidation threshold: vUnit-weighted burn rate
- Staking accumulator: accEthPerShare correct, settles on every state change

## Output
Write findings to `ssv-review/planning/verified/audit-security-[SCOPE]-[DATE].md`

Before reporting, check `ssv-review/planning/MAINNET-READINESS.md` — skip already-tracked items.

For each NEW issue use this format:
### [NEW-N] Title
- **Type:** Critical Bug Fix / Security Hardening / etc.
- **Priority:** P0 / P1 / P2
- **Status:** Open

**Requirement:** <what to fix>
**Context:** <file:line, why it matters>
**Acceptance Criteria:**
- [ ] criterion

**Agent Instructions:** <steps for AI to fix>
TASK
```

### Worker 2: Test Coverage & Edge Cases

```bash
unset CLAUDECODE && subtask draft audit/tests-[SCOPE] --base-branch [BRANCH] --title "Test coverage audit: [SCOPE]" <<'TASK'
You are auditing test coverage for SSV Network v2.0.0.

## Required Reading
1. `CLAUDE.md` — Test conventions, helpers, patterns
2. The scoped contract files: [SCOPE_FILES]
3. ALL test files related to this scope in `test/unit/`, `test/integration/`, `test/sanity/`
4. Test helpers: `test/helpers/contract-helpers.ts`, `test/common/constants.ts`, `test/common/errors.ts`, `test/common/events.ts`

## Checks

### Test Coverage
- Read every test file for the scoped module
- List what IS tested (scenarios covered)
- List what is NOT tested (gaps)
- For gaps, classify: P0 (security), P1 (correctness), P2 (edge case)

### Test Quality
- Do tests assert balance deltas (not just events)?
- Do tests use non-zero operator fees? (critical gap if all fees=0)
- Do tests check state via view functions after operations?
- Are revert cases tested with exact error names?
- Are boundary values tested (0, 1, max)?

### Edge Cases
- Zero values: 0 validators, 0 balance, 0 fees, 0 operators, 0 staked
- Max values: 13 operators, 3000 validators/operator, EB=2048
- Boundaries: exact liquidation threshold, exact min/max EB, exact cooldown
- Empty/removed: removed operators, liquidated clusters, 0 cSSV supply
- Ordering: does operation order matter?
- Concurrency: shared operators, same-block operations

## Output
Write findings to `ssv-review/planning/verified/audit-tests-[SCOPE]-[DATE].md`

Check `ssv-review/planning/MAINNET-READINESS.md` first — skip already-tracked items.

Use same format: [NEW-N] with Type, Priority, Requirement, Context, Acceptance Criteria, Agent Instructions.
TASK
```

### Worker 3: Code Quality & Best Practices

```bash
unset CLAUDECODE && subtask draft audit/quality-[SCOPE] --base-branch [BRANCH] --title "Code quality audit: [SCOPE]" <<'TASK'
You are auditing code quality for SSV Network v2.0.0.

## Required Reading
1. `CLAUDE.md` — Code conventions, architecture
2. The scoped contract files: [SCOPE_FILES]

## Checks

### Dead Code
- Unused functions, events, errors, imports, structs
- Commented-out code (should be removed)
- TODO/FIXME/HACK comments

### Code Quality
- Naming: variables/functions match behavior
- Patterns: consistent with rest of codebase
- Duplication: repeated logic that should be shared
- Gas: redundant SLOADs, unnecessary memory copies, storage→memory→storage roundtrips
- NatSpec: public/external functions documented

### Backward Compatibility
- Event signature changes (breaks oracle: ValidatorAdded, ClusterLiquidated, etc.)
- Function signature changes (breaks SDK/webapp)
- Cluster struct changes (breaks everything)
- Check against oracle ABI: `github.com/ssvlabs/ssv-oracle`

### Deployment Readiness
- Contract sizes under 24KB limit
- Constructor args correct
- Initializer version correct (reinitializer(3))
- Governance parameters match DIP-X spec

## Output
Write findings to `ssv-review/planning/verified/audit-quality-[SCOPE]-[DATE].md`

Check `ssv-review/planning/MAINNET-READINESS.md` first — skip already-tracked items.

Use same format for new findings.
TASK
```

## After Workers Complete

1. Read all 3 output files from `ssv-review/planning/verified/`
2. Present a summary to the user:
   - Total new findings by severity
   - Key highlights
   - Items already tracked in MAINNET-READINESS.md (skipped)
3. Ask the user if they want to merge new findings into MAINNET-READINESS.md
4. If yes, dispatch a merge worker:

```bash
unset CLAUDECODE && subtask draft merge/audit-[SCOPE] --base-branch [BRANCH] --title "Merge audit findings for [SCOPE]" <<'TASK'
Read the 3 audit output files:
- ssv-review/planning/verified/audit-security-[SCOPE]-[DATE].md
- ssv-review/planning/verified/audit-tests-[SCOPE]-[DATE].md
- ssv-review/planning/verified/audit-quality-[SCOPE]-[DATE].md

Read the current: ssv-review/planning/MAINNET-READINESS.md

For each NEW finding (not already in MAINNET-READINESS.md):
1. Assign a real ID (continue from highest existing: BUG-N, SEC-N, TEST-N, etc.)
2. Append to the correct Type section in MAINNET-READINESS.md
3. Add to the Priority Summary table

Do NOT remove or rewrite existing items. Only ADD.
Commit the changes.
TASK
```

## PR Audit Variant

When auditing a PR, get the diff first:
```bash
gh pr diff [NUMBER] --name-only
```
Then use those files as the scope for all 3 workers. Also include:
```bash
gh pr view [NUMBER] --json title,body,commits
```
as context in each worker's task description.
