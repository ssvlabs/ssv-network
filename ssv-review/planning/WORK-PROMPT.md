# SSV Network — Issue Work Prompt

Use this prompt when working on any item from `MAINNET-READINESS.md`. Copy it, fill in the `[ITEM-ID]` section, and use it as your scope of work — whether you're a developer, QA, or an AI agent (subtask worker).

---

## Prompt Template

```
You are working on SSV Network v2.0.0 smart contracts — a mainnet-critical Solidity codebase.

## Your Assignment

Work on item **[ITEM-ID]** from the mainnet readiness checklist.

Read the full item details from: `ssv-review/planning/MAINNET-READINESS.md`
Read the project guide from: `CLAUDE.md`

## Mandatory Workflow

Follow every step below. Do not skip any step. Each step must be completed before moving to the next.

### Phase 1: Understand

1. **Read CLAUDE.md** — Understand the architecture, storage pattern, module system, security rules, and testing conventions.

2. **Read the item** from MAINNET-READINESS.md — understand the Requirement, Context, Acceptance Criteria, and Agent Instructions fully.

3. **Read all referenced source files** — Every file mentioned in the item's Context and Agent Instructions. Read them completely, not just the mentioned lines. Understand the surrounding code.

4. **Read related test files** — Find existing tests for the same module/function. Understand the test patterns, helpers used, fixture setup, and assertion style.

5. **Map the blast radius** — Before changing anything, identify:
   - Which other functions call the code you're changing?
   - Which tests exercise this code path?
   - Could your change affect other modules via shared storage?
   - Are there events that external systems (oracle, liquidator, SDK) depend on?

### Phase 2: Implement

6. **Create a feature branch** off `ssv-staking`:
   ```
   git checkout ssv-staking
   git pull origin ssv-staking
   git checkout -b fix/[ITEM-ID]-short-description
   ```

7. **Make the fix** following these rules:

   **Code Quality:**
   - Follow existing code style exactly (naming, spacing, comments pattern)
   - No dead code — remove anything you replace, don't comment it out
   - No duplication — if similar logic exists elsewhere, use or extend the existing pattern
   - Minimal diff — change only what's needed. Don't refactor surrounding code
   - Preserve backward compatibility — do NOT change function signatures, event signatures, or struct layouts unless the item explicitly requires it

   **Solidity-Specific:**
   - All state goes through diamond storage libraries — NEVER add storage variables to modules
   - Append-only for storage structs — NEVER reorder existing fields
   - Use the correct packed type (PackedSSV/PackedETH) for all fee values
   - Use `nonReentrant` on any function that makes external calls or transfers ETH/tokens
   - Check access control: owner-only at proxy level, operator.checkOwner() for operator functions
   - Integer math: use ceiling division for ETH→vUnits, floor for vUnits→ETH
   - Underflow protection: `max(0, balance - fees)` pattern for cluster balance

   **Security Checklist (verify before committing):**
   - [ ] No new reentrancy vectors introduced
   - [ ] No storage slot conflicts
   - [ ] No changes to event signatures (breaks oracle/SDK)
   - [ ] No changes to function signatures (breaks integrations)
   - [ ] No precision loss in fee calculations
   - [ ] Access control maintained (no privilege escalation)
   - [ ] No unbounded loops or gas griefing

### Phase 3: Test

8. **Write tests for your fix** — This is mandatory, not optional.

   **Test Requirements:**
   - Use Mocha + Chai + ethers v6 patterns matching existing tests
   - Use helpers from `test/helpers/contract-helpers.ts`
   - Use constants from `test/common/constants.ts`
   - Use error definitions from `test/common/errors.ts`
   - Use event definitions from `test/common/events.ts`

   **Test Coverage Checklist:**
   - [ ] **Happy path** — The fix works as intended under normal conditions
   - [ ] **Revert cases** — Invalid inputs, unauthorized callers, edge conditions revert with correct error
   - [ ] **Event emissions** — Verify exact event parameters
   - [ ] **Balance invariants** — Before/after balance checks (ETH, SSV, operator earnings, cluster balances, contract balance)
   - [ ] **State consistency** — Storage state is correct after the operation (check via view functions)
   - [ ] **Regression** — The original bug scenario is explicitly tested and passes
   - [ ] **Boundary values** — Test with 0, 1, max values where applicable

   **Test Structure:**
   ```typescript
   describe('[ITEM-ID]: Short description', () => {
     // Setup: use existing fixtures/helpers

     it('should [expected behavior] when [condition]', async () => {
       // Arrange — set up state
       // Act — perform the operation
       // Assert — verify results with expect()
     });

     it('should revert when [invalid condition]', async () => {
       await expect(operation).to.be.revertedWithCustomError(contract, 'ErrorName');
     });

     it('should emit [Event] with correct parameters', async () => {
       await expect(operation)
         .to.emit(contract, 'EventName')
         .withArgs(param1, param2);
     });

     it('should maintain balance invariant', async () => {
       const balanceBefore = await getBalance();
       await operation();
       const balanceAfter = await getBalance();
       expect(balanceAfter - balanceBefore).to.equal(expectedDelta);
     });
   });
   ```

### Phase 4: Verify

9. **Run the full test suite:**
   ```bash
   npx hardhat compile                    # Must compile cleanly
   npm run test:unit                      # All unit tests must pass
   npm run test:integration               # All integration tests must pass
   ```

10. **Check contract sizes** (if you added code):
    ```bash
    npx hardhat run scripts/contract-sizes.ts
    ```
    Verify no module exceeds 24KB Spurious Dragon limit.

11. **Self-review your diff:**
    ```bash
    git diff ssv-staking...HEAD
    ```
    Review every line. Ask yourself:
    - Is this change minimal and focused?
    - Did I introduce any new warnings during compilation?
    - Are my test names descriptive enough for someone else to understand?
    - Did I accidentally change anything outside the item's scope?

### Phase 5: Submit

12. **Commit with a descriptive message:**
    ```bash
    git add <specific-files>
    git commit -m "fix: [short description] ([ITEM-ID])

    [1-2 sentence explanation of what was wrong and how it's fixed]"
    ```

13. **Push and create PR** targeting `ssv-staking`:
    ```bash
    git push -u origin fix/[ITEM-ID]-short-description
    ```
    PR description must include:
    - Reference to MAINNET-READINESS.md item ID
    - What was the bug/gap
    - How it's fixed
    - What tests were added
    - Acceptance criteria checklist (copied from the item, checked off)

## Reference Files

| Purpose | Path |
|---------|------|
| Project guide | `CLAUDE.md` |
| Full specification | `docs/SPEC.md` |
| Contract flows | `docs/FLOWS.md` |
| Readiness checklist | `ssv-review/planning/MAINNET-READINESS.md` |
| Test helpers | `test/helpers/contract-helpers.ts` |
| Test constants | `test/common/constants.ts` |
| Test errors | `test/common/errors.ts` |
| Test events | `test/common/events.ts` |
| Deploy fixtures | `test/setup/` |

## For AI Agents (subtask workers)

When using this prompt with `subtask`, append:
- The full item text from MAINNET-READINESS.md
- Any additional context from the verified reports in `ssv-review/planning/verified/`
- Specify: "Create your fix on a feature branch, write tests, run the test suite, and report results."

Example:
```bash
subtask draft fix/BUG-1 --base-branch ssv-staking --title "Fix ensureETHDefaults stale memory copy" <<'EOF'
<paste this prompt with [ITEM-ID] = BUG-1>
<paste BUG-1 item text from MAINNET-READINESS.md>
EOF
subtask send fix/BUG-1 "Go ahead."
```
```
