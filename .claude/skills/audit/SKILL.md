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
4. `ssv-review/Internal - [DIP-X] SSV Staking.txt` — DIP-X proposal (source of truth for requirements)

## Scope
[SCOPE_FILES]

## Checks

### 1. Spec Compliance
- [ ] Every function matches its specification in SPEC.md
- [ ] Event signatures and parameters match SPEC.md
- [ ] Error conditions and reverts match SPEC.md
- [ ] State mutations match FLOWS.md
- [ ] Invariants from FLOWS.md hold after every state transition
- [ ] DIP-X requirements satisfied — use claim-by-claim comparison with verdicts: MATCH / PARTIAL / MISMATCH / GAP / EXTRA

### 2. Memory/Storage Safety (CRITICAL — caught our worst bug)
- [ ] **Stale memory copy detection:** For each function that reads a struct into `memory`, check: does any subsequent call modify the same struct in `storage`? If so, does the memory copy get written back, overwriting the storage change?
- [ ] **Storage→memory→storage roundtrip audit:** List every `Type memory x = s.something; ...; s.something = x;` pattern. Verify no storage-modifying functions are called between the read and write-back.
- [ ] **Flag every explicit downcast** (`uint64()`, `uint128()`, `uint192()`) — is there overflow checking?

### 3. Entity Lifecycle State Machine (caught multiple HIGH bugs)
- [ ] **Operator lifecycle:** Map full state machine (registered → active → fee-changing → removed). For each state, list which fields are non-zero/zero. Check every function that interacts with operators — does it detect the state correctly?
- [ ] **Cluster lifecycle:** Map (created → active → liquidated → reactivated → migrated). For each transition, verify what state is cleaned up and what persists.
- [ ] **"Removed" detection consistency:** Grep for EVERY check that determines if an operator/cluster is removed/dead. Verify ALL checks use the same condition.
- [ ] **State resurrection:** Can any function unintentionally make a dead entity appear alive? (e.g., setting a zeroed field back to non-zero)

### 4. Double-Accounting Prevention (caught HIGH bug)
- [ ] **Resource cleanup tracing:** For every counter/balance cleaned up on lifecycle transitions (liquidation, removal, migration), trace ALL code paths that modify it. Verify no path assumes another hasn't run.
- [ ] **Sequential operation analysis:** For critical pairs (liquidate → remove validators, EB update → liquidate, register → EB update), trace state changes and verify no double-counting or double-subtraction.

### 5. Reentrancy
- [ ] **Completeness audit:** List EVERY `external`/`public` function across ALL modules. For each: has `nonReentrant`? Makes external calls? Document justification for any missing guard.
- [ ] **Shared slot verification:** Verify all modules use the same reentrancy guard storage slot via `SSVStorageReentrancy`.

### 6. Access Control
- [ ] Owner-only at proxy level (`onlyOwner` modifier on SSVNetwork.sol)
- [ ] Operator owner: `operator.checkOwner()` in every operator management function
- [ ] Cluster owner: keyed by `keccak256(owner, operatorIds)`
- [ ] Oracle-only: `oracleIdOf[msg.sender] != 0` in `commitRoot`
- [ ] cSSV-only: `msg.sender == CSSV_ADDRESS` in `onCSSVTransfer`

### 7. Cross-Module State Dependencies
- [ ] **State dependency graph:** Identify storage variables read by one module and written by another. Any variable with cross-module read/write without synchronization?
- [ ] **Coupled state variables:** Identify pairs that must stay synchronized (e.g., `ethDaoBalance` ↔ `stakingEthPoolBalance`). Verify all mutating functions maintain the coupling.

### 8. Accounting Correctness
- [ ] **Per-operation balance flow:** For each operation (deposit, withdraw, liquidate, reactivate, migrate, register, remove, claimEthRewards, withdrawOperatorEarnings), trace what increases/decreases `contract.balance` and each accounting bucket. Do both sides match?
- [ ] **Cross-pool isolation:** Can any code path cause ETH to flow from operator pool to staking pool or vice versa?
- [ ] **vUnit math:** ceiling for ETH→vUnits (`ebToVUnits`), floor for vUnits→ETH (`vUnitsToEB`), BPS_DENOMINATOR = 10_000
- [ ] **Packed types:** non-divisible values revert with MaxPrecisionExceeded
- [ ] **Liquidation threshold:** vUnit-weighted burn rate correctly computed

### 9. Accumulator Edge Analysis
- [ ] **Zero-supply state:** What happens when cSSV totalSupply is 0? Are rewards lost, deferred, or correctly handled?
- [ ] **Regression state:** Can `accEthPerShare` decrease? If so, what happens to users whose index is higher?
- [ ] **Dust analysis:** Maximum dust per operation? Where does it accumulate? Can it be recovered?
- [ ] **First-staker advantage:** Can the first staker after a gap capture undistributed rewards?

### 10. Governance Parameter Validation
- [ ] **For every governance setter:** What is min/max valid value? Is there bounds validation? What breaks at 0 or max?
- [ ] **Single-block attack chains:** Can governance execute a dangerous sequence in one tx? (e.g., updateQuorumBps(0) → replaceOracle → commitRoot)
- [ ] **Timelock presence:** Which critical governance functions lack a timelock?

### 11. UUPS Proxy Safety
- [ ] `_disableInitializers()` called in implementation constructor
- [ ] `_authorizeUpgrade()` is `onlyOwner`
- [ ] `reinitializer(N)` version correct for target chain (current: N=3)
- [ ] No storage slot collisions across 5 storage libraries (verify keccak256 strings are unique)
- [ ] Fallback function routes correctly to SSVViews
- [ ] `msg.sender` and `msg.value` preserved correctly through delegatecall
- [ ] No module uses `address(this)` expecting implementation address

### 12. Merkle Tree Security
- [ ] Double-hash convention verified (prevents second preimage attack)
- [ ] Cross-cluster proof substitution impossible (leaf includes clusterID)
- [ ] Proof replay across root transitions blocked (staleness + monotonicity)
- [ ] Zero/empty leaf handling

### 13. Oracle Security
- [ ] Vote weight consistency across voting window (totalStaked can change between votes)
- [ ] Oracle replacement mid-vote (pending votes from replaced oracle persist)
- [ ] Multi-root voting (same oracle, conflicting roots, same block)
- [ ] Quorum unreachability (100% quorum + integer division)
- [ ] Oracle liveness failure handling

### 14. Flash Loan Resistance
- [ ] Can flash-loaned SSV affect oracle voting weight? (check cooldown enforcement)
- [ ] Can flash-loaned ETH manipulate cluster balance checks?
- [ ] Are governance-sensitive calculations resistant to same-block manipulation?

### 15. ERC20 Interaction Safety
- [ ] SSV token confirmed as standard ERC20 (no callbacks, no fee-on-transfer)
- [ ] Return values checked on all token transfers
- [ ] `rescueERC20` correctly blocks SSV and cSSV

### 16. Event Completeness
- [ ] Every state change emits a corresponding event
- [ ] No ambiguous event reuse (same event for semantically different operations)
- [ ] Events provide enough data for off-chain state reconstruction (oracle, liquidator bot)

### 17. Guard Consistency
- [ ] For operations with parallel implementations (normal liquidation vs auto-liquidation, SSV vs ETH paths), compare conditions side by side. Flag any inconsistency.

## Output Format

Write findings to `ssv-review/planning/verified/audit-security-[SCOPE]-[DATE].md`

Before reporting, check `ssv-review/planning/MAINNET-READINESS.md` — skip already-tracked items.

Include a **Verified Safe** section documenting areas investigated and confirmed correct.

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
5. Echidna tests if relevant: `test/echidna/`

## Checks

### 1. Test Coverage Mapping
- [ ] Read every test file for the scoped module
- [ ] List what IS tested (scenarios covered)
- [ ] List what is NOT tested (gaps)
- [ ] For gaps, classify: P0 (security), P1 (correctness), P2 (edge case)

### 2. Systemic Blind Spot Detection (caught our worst test gaps)
- [ ] **Parameter coverage matrix:** For each test file, check: do tests use non-zero operator fees? Non-baseline EB? Multiple operators? Multiple validators? If ANY major parameter is always zero/default across ALL tests, flag as P0.
- [ ] **Fee path coverage:** Every function that settles fees must be tested with concrete non-zero fees and verified against manual calculation.
- [ ] **EB path coverage:** Every function that uses vUnits must be tested with non-baseline EB (e.g., EB=1000, vUnits=312500).

### 3. Balance Delta Assertions
- [ ] Every function that transfers ETH or SSV must have a test checking `balance_before - balance_after == expected_amount`.
- [ ] Check contract.balance, not just user balance.
- [ ] Liquidation: verify liquidator receives correct residual.
- [ ] Operator withdrawal: verify exact ETH/SSV amount.
- [ ] Staking claims: verify exact reward payout.

### 4. Test Quality Deep Checks
- [ ] **Mock fidelity:** Do mock contracts faithfully reproduce production behavior? Check MockCSSV has `onCSSVTransfer` callback.
- [ ] **Commented-out assertions:** Search for assertions inside `/* */` or after `//` — flag immediately as P0.
- [ ] **Echidna invariant correctness:** Read each property: (a) assertion direction correct? (b) no identical properties? (c) helper functions bug-free?
- [ ] **View function verification:** Do tests call view functions after state changes to verify state?
- [ ] **Revert testing:** Are reverts tested with exact custom error names, not just generic revert?

### 5. Specific Missing Test Patterns
- [ ] **Full lifecycle test:** register → EB update → fee accrual → liquidate → reactivate → EB update → withdraw → operator withdraw — with concrete balance verification at each step.
- [ ] **Sequential operation tests:** liquidate then remove validators, EB update then withdraw, register then EB decrease.
- [ ] **Stress test:** 13 operators, max fee, 3000 validators, EB=2048, 5-year block advance — verify no overflow.
- [ ] **Cross-module E2E:** commitRoot → updateClusterBalance → fee recalculation with concrete verification.

### 6. Edge Cases
- [ ] Zero values: 0 validators, 0 balance, 0 fees, 0 operators, 0 staked
- [ ] Max values: 13 operators, 3000 validators/operator, EB=2048
- [ ] Boundaries: exact liquidation threshold, exact min/max EB, exact cooldown expiry
- [ ] Empty/removed: removed operators, liquidated clusters, 0 cSSV supply
- [ ] Ordering: does operation order matter? (register before deposit, migrate before add)
- [ ] Concurrency: shared operators, same-block operations, EB update + withdraw

### 7. Write Specific Test Descriptions
For each gap found, write a concrete test description including:
- Test name: `it('should [behavior] when [condition]')`
- Setup: what state to create
- Action: what function to call with what params
- Assertions: what to check (specific values, not just "should work")

## Output Format

Write findings to `ssv-review/planning/verified/audit-tests-[SCOPE]-[DATE].md`

Check `ssv-review/planning/MAINNET-READINESS.md` first — skip already-tracked items.

Include a **Well-Covered Areas** section documenting what IS tested adequately.

Use MAINNET-READINESS.md format: [NEW-N] with Type, Priority, Requirement, Context, Acceptance Criteria, Agent Instructions.
TASK
```

### Worker 3: Code Quality & Best Practices

```bash
unset CLAUDECODE && subtask draft audit/quality-[SCOPE] --base-branch [BRANCH] --title "Code quality audit: [SCOPE]" <<'TASK'
You are auditing code quality and best practices for SSV Network v2.0.0.

## Required Reading
1. `CLAUDE.md` — Code conventions, architecture
2. The scoped contract files: [SCOPE_FILES]
3. `ssv-review/Internal - [DIP-X] SSV Staking.txt` — DIP-X proposal

## Checks

### 1. Memory/Storage Patterns (CRITICAL — caught our worst bug)
- [ ] **Flag every `Type memory x = s.field; ...; s.field = x;` pattern** as potentially dangerous. Check if any storage-modifying function is called between read and write-back.
- [ ] **Flag every explicit downcast** (`uint64()`, `uint128()`, `uint192()`) — is there overflow risk?
- [ ] **Flag every `unchecked` block** — is the arithmetic truly safe?

### 2. Dead Code
- [ ] Unused functions, events, errors, imports, structs
- [ ] Commented-out code (should be removed)
- [ ] TODO/FIXME/HACK comments

### 3. Code Quality
- [ ] Naming: variables/functions match behavior
- [ ] Patterns: consistent with rest of codebase
- [ ] Duplication: repeated logic that should be shared
- [ ] Gas: redundant SLOADs, unnecessary memory copies, storage→memory→storage roundtrips
- [ ] NatSpec: public/external functions documented

### 4. Guard Consistency
- [ ] For operations with parallel implementations (normal liquidation vs auto-liquidation, SSV vs ETH paths), compare conditions side by side. Flag any inconsistency.
- [ ] Check that all "is entity removed/dead?" checks use the same condition across all functions.

### 5. Dead State Cleanup
- [ ] On operator removal: list every storage field. Is each cleared? If not, can it cause issues?
- [ ] On cluster liquidation: what state persists? Can it cause issues on reactivation?
- [ ] Pending operations (fee change requests, unstake requests) — cleaned up on entity removal?
- [ ] Whitelist state — cleaned up on operator removal?

### 6. Backward Compatibility
- [ ] Event signature changes (breaks oracle: ValidatorAdded, ClusterLiquidated, etc.)
- [ ] Function signature changes (breaks SDK/webapp)
- [ ] Cluster struct changes (breaks everything)
- [ ] Check against oracle ABI dependencies

### 7. DIP Compliance
- [ ] **Claim-by-claim comparison:** For each DIP section in scope, enumerate every claim. Verdict: MATCH / PARTIAL / MISMATCH / GAP / EXTRA.
- [ ] **Precision/packability validation:** Every DIP-specified numeric value — is it storable in the packed type? (divisible by ETH_DEDUCTED_DIGITS or DEDUCTED_DIGITS)
- [ ] **Check for EXTRA behavior:** Code does more than spec says — is it intentional and safe?

### 8. Compiler & Dependency Safety
- [ ] Compiler version pinned (not floating `^`)
- [ ] Optimizer settings documented and appropriate
- [ ] OpenZeppelin version current, no known CVEs
- [ ] Import paths match package versions

### 9. Deployment Script Validation
- [ ] Script function signatures match contract ABIs
- [ ] Constructor arguments correct for all contracts
- [ ] Initializer parameters complete (check quorumBps, defaultOracleIds, cooldownDuration)
- [ ] No hardcoded addresses that differ per chain
- [ ] Scripts don't import from test files

### 10. Deployment Readiness
- [ ] Contract sizes under 24KB (which are close to limit?)
- [ ] Constructor args correct
- [ ] Initializer version correct (reinitializer(3))
- [ ] Governance parameters match DIP-X spec

## Output Format

Write findings to `ssv-review/planning/verified/audit-quality-[SCOPE]-[DATE].md`

Check `ssv-review/planning/MAINNET-READINESS.md` first — skip already-tracked items.

Include a **Already Correct** section documenting areas verified as clean.

Use MAINNET-READINESS.md format for new findings.
TASK
```

## After Workers Complete

1. Read all 3 output files from `ssv-review/planning/verified/`
2. Present a summary to the user:
   - Total new findings by severity
   - Key highlights
   - Items already tracked in MAINNET-READINESS.md (skipped)
   - Verified-safe areas
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
