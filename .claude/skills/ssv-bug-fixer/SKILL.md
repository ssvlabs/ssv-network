---
name: ssv-bug-fixer
description: Fixes bugs in SSV Network v2.0.0 smart contracts with security-first approach. Use when task involves fixing vulnerabilities, logic errors, state inconsistencies, reentrancy issues, or packed type precision bugs in SSV staking contracts. Handles diamond storage patterns, ETH/SSV dual clusters, effective balance accounting, and Oracle integration. Use for tasks with SEC-, BUG-, or FIX- prefixes.
metadata:
  author: SSV Network
  version: 1.0.0
  category: security
  task-types: [SEC-, BUG-, FIX-]
  project: ssv-network-v2.0.0
---

# SSV Bug Fixer

Expert assistant for fixing bugs in SSV Network smart contracts with security-first principles and proper testing.

## Core Principles

**CRITICAL**: Before making ANY code changes, understand these non-negotiable rules:

1. **Storage Safety**: NEVER add storage variables to module contracts - use diamond storage only
2. **Backward Compatibility**: NEVER change event signatures - breaks oracle/indexer integration
3. **Reentrancy**: ALL functions with ETH/token transfers MUST use `nonReentrant` modifier
4. **Packed Types**: Use correct precision constants (ETH_DEDUCTED_DIGITS vs DEDUCTED_DIGITS)
5. **Minimal Changes**: Apply smallest possible fix - no refactoring unless explicitly required

## Workflow

### Step 1: Understand the Task

Read the task description from `ssv-review/planning/MAINNET-READINESS.md`:

1. Search for your task ID (e.g., `SEC-001`, `BUG-042`)
2. Read the full description and acceptance criteria
3. Identify which category this falls into:
   - **Storage bug** → Struct layout, diamond storage, slot conflicts
   - **Reentrancy** → Missing guards on ETH/token transfers
   - **Packed types** → Precision loss, overflow, incorrect constants
   - **Oracle/EB** → Merkle proof, vUnits calculation, balance updates
   - **Staking** → Rewards accumulator, cSSV logic, unstaking
   - **Cluster logic** → Balance calculation, fee accounting, liquidation
   - **Operator logic** → Fee changes, earnings, validator count

**Action**: Based on category, load the appropriate reference document:
- Storage issues → Read `references/storage-patterns.md`
- Reentrancy → Read `references/reentrancy-guards.md`
- Packed types → Read `references/packed-types-guide.md`
- General security → Read `references/security-checklist.md`

### Step 2: Locate Affected Code

1. **Read FLOWS.md first**: Check `docs/FLOWS.md` for the relevant operation flow
   - Understand state mutations
   - Identify which modules are involved
   - Note preconditions and postconditions

2. **Check SPEC.md for details**: Read `docs/SPEC.md` for:
   - Function signatures
   - Expected behavior
   - Fee calculation formulas
   - Storage layout

3. **Read the actual contract code**:
   - Start with the main entry point in `contracts/modules/`
   - Follow the call chain to libraries in `contracts/libraries/`
   - Check storage structs in `contracts/libraries/storage/`
   - Consider `contracts/SSVNetwork.sol` as the proxy for the modules.

**CRITICAL PRE-FLIGHT CHECKS** before reading full files:
- Is this modifying a storage struct? → Check append-only rule
- Does it involve ETH/token transfers? → Verify reentrancy guard
- Does it use packed types? → Check precision constants
- Does it emit events? → Verify backward compatibility

### Step 3: Root Cause Analysis

**Analyze the bug systematically**:

1. **What is the actual behavior?**
   - What does the code currently do?
   - What values/states are produced?

2. **What is the expected behavior?**
   - What should it do according to SPEC.md?
   - What values/states are expected?

3. **Why is there a discrepancy?**
   - Logic error? (wrong formula, missing check)
   - State management? (incorrect storage update)
   - Edge case? (overflow, underflow, zero case)
   - Precision loss? (packed type issue)
   - Race condition? (reentrancy, ordering)

4. **What are the implications?**
   - Can this be exploited? (security impact)
   - Does it affect accounting? (balance discrepancies)
   - Will it brick the protocol? (liveness impact)

**Document your findings** in your response before proposing a fix.

### Step 4: Design the Fix

**Apply the minimal upstream fix principle**:

1. **One-line fix if possible** - Don't refactor unless necessary
2. **Use existing patterns** - Look for similar code elsewhere
3. **Preserve code style** - Match indentation, naming, comments
4. **No unnecessary changes** - Don't "improve" unrelated code

**Common fix patterns**:

#### Storage Bug Fix
```solidity
// ❌ WRONG - Adding storage variable to module
contract SSVOperators {
    uint256 public newField; // NEVER!
}

// ✅ CORRECT - Use diamond storage
function s() private pure returns (SSVStorage storage $) {
    assembly { $.slot := SSV_STORAGE_SLOT }
}
// Add field to SSVStorage struct (append only!)
```

#### Reentrancy Bug Fix
```solidity
// ❌ WRONG - ETH transfer without guard
function withdraw() external {
    payable(msg.sender).transfer(amount);
}

// ✅ CORRECT - Add nonReentrant modifier
function withdraw() external nonReentrant {
    payable(msg.sender).transfer(amount);
}
```

#### Packed Type Bug Fix
```solidity
// ❌ WRONG - Using wrong precision constant
uint64 packed = fee / DEDUCTED_DIGITS; // SSV constant used for ETH!

// ✅ CORRECT - Use correct constant
uint64 packed = fee / ETH_DEDUCTED_DIGITS;
```

#### Logic Bug Fix
```solidity
// ❌ WRONG - Incorrect fee calculation
uint256 fee = blocks * rate * validators; // Missing vUnits

// ✅ CORRECT - Use vUnits model
uint256 fee = blocks * rate * vUnits / VUNITS_PRECISION;
```

### Step 5: Validate Against Security Rules

**Before proposing your fix, run this checklist**:

- [ ] **Storage Safety**: No new storage variables in modules?
- [ ] **Reentrancy**: All ETH/token transfers have `nonReentrant`?
- [ ] **Packed Types**: Using correct precision constants?
- [ ] **Event Compatibility**: No changes to event signatures?
- [ ] **Storage Layout**: Only appending to structs, not reordering?
- [ ] **Access Control**: Owner-only, oracle-only checks preserved?
- [ ] **Integer Safety**: No overflow/underflow risks?
- [ ] **Edge Cases**: Handles zero, max, min values correctly?

**If ANY check fails**, revise your fix before proceeding.

### Step 6: Implement the Fix

**Write the fix following these rules**:

1. **Use Edit tool for existing functions** - Never rewrite entire files
2. **Match existing code style exactly**:
   - 4-space indentation
   - No trailing whitespace
   - Existing comment style
3. **Update all affected locations** - Bug might exist in multiple places
4. **Update interfaces if needed** - Keep `contracts/interfaces/` in sync

**Example implementation**:

```solidity
// In SSVClusters.sol
function updateClusterBalance(
    address owner,
    uint64[] calldata operatorIds,
    Cluster calldata cluster,
    bytes32[] calldata proof,
    uint256 effectiveBalance
) external nonReentrant onlyOracle {
    // ... existing code ...

    // FIX: Use ceiling division for vUnits calculation
    uint256 vUnits = (effectiveBalance * VUNITS_PRECISION + DEFAULT_EB_PER_VALIDATOR - 1)
                     / DEFAULT_EB_PER_VALIDATOR;

    // ... rest of function ...
}
```

### Step 7: Write Test

**CRITICAL**: Every fix MUST include a test that proves the bug is fixed.

**Test structure**:
1. **Unit test** in `test/unit/[module]/` for isolated function behavior
2. **Integration test** in `test/integration/` for multi-module flows
3. Follow existing test patterns from `test/helpers/contract-helpers.ts`

**Test template**:

```typescript
describe('[Bug Description]', () => {
  it('should fix [specific issue]', async () => {
    // Arrange: Set up conditions that trigger the bug
    const { ssvNetwork, operator, cluster } = await setupScenario();

    // Act: Execute the operation that was buggy
    const tx = await ssvNetwork.operationThatWasBuggy(params);

    // Assert: Verify the fix works
    expect(await ssvNetwork.getState()).to.equal(expectedValue);

    // Assert: Verify events emitted correctly
    await expect(tx)
      .to.emit(ssvNetwork, 'EventName')
      .withArgs(expectedArgs);

    // Assert: Verify invariants hold
    const balance = await ssvNetwork.getBalance(cluster);
    expect(balance).to.be.gte(0); // No negative balances
  });

  it('should handle edge case that caused the bug', async () => {
    // Test the specific edge case (zero, overflow, etc.)
  });
});
```

**Run the test**:
```bash
npm test -- --grep "[Bug Description]"
```

**If test fails**:
1. Read error message carefully
2. Check if setup matches actual contract state
3. Verify expected values are correct
4. Add console.log for debugging if needed
5. Iterate until test passes

### Step 8: Quality Gate

Run the validation script to ensure your fix meets all requirements:

```bash
./claude/skills/ssv-bug-fixer/scripts/validate-fix.sh
```

This automated check verifies:
- ✅ All contracts compile
- ✅ No new storage variables in modules
- ✅ All ETH transfers have reentrancy guards
- ✅ Your new test passes
- ✅ Existing tests still pass
- ✅ Coverage meets minimum threshold

**If validation fails**, fix the issues before proceeding.

### Step 9: Update Task Status

Update `ssv-review/planning/MAINNET-READINESS.md`:

1. Mark all sub-items as complete: `- [x] Item`
2. Update status line: `| [TASK-ID] | ✅ Fixed | ...`
3. Add reference to your test file
4. Note any remaining concerns or follow-ups

**Example**:
```markdown
### SEC-042: Reentrancy in withdraw function

**Status**: ✅ Fixed

**Fix**: Added `nonReentrant` modifier to `withdraw()` in SSVClusters.sol:234

**Test**: test/unit/SSVClusters/withdraw.ts - covers reentrancy attempt

**Verified**:
- [x] Modifier added
- [x] Test passes
- [x] No regression in other tests
- [x] Gas impact negligible (+2000 gas)
```

## Common Bug Patterns in SSV

### Pattern 1: Packed Type Precision Loss

**Symptom**: Amounts slightly wrong, dust accumulates, reverts on certain values

**Root cause**: Using wrong precision constant or not checking divisibility

**Fix approach**:
1. Identify if this is SSV or ETH packed type
2. Use correct constant: `DEDUCTED_DIGITS` (SSV) vs `ETH_DEDUCTED_DIGITS` (ETH)
3. Use library functions: `value.pack()` / `packed.unpack()`
4. Add precision check if user input

**See**: `references/packed-types-guide.md` for complete guide

### Pattern 2: Reentrancy on ETH Operations

**Symptom**: State changes after external call, unexpected behavior in callbacks

**Root cause**: Missing `nonReentrant` modifier on functions with ETH transfers

**Fix approach**:
1. Find all functions with: `transfer`, `send`, `call{value:}`
2. Add `nonReentrant` modifier
3. Verify state changes happen before external call
4. Test with reentrancy attempt

**See**: `references/reentrancy-guards.md` for patterns

### Pattern 3: Storage Layout Conflicts

**Symptom**: Wrong values read from storage, state corruption after upgrade

**Root cause**: Storage variable added to module or struct reordered

**Fix approach**:
1. NEVER add storage to modules - use diamond storage
2. NEVER reorder struct fields - only append
3. Verify slot computation matches pattern
4. Test with existing state from mainnet fork

**See**: `references/storage-patterns.md` for diamond pattern

### Pattern 4: vUnits Calculation Errors

**Symptom**: Wrong fees charged, cluster balance drift, liquidation edge cases

**Root cause**: Not using ceiling division, wrong EB to vUnits conversion

**Fix approach**:
1. Use ceiling division: `(value + divisor - 1) / divisor`
2. Verify vUnits precision: multiply by `VUNITS_PRECISION` (10000)
3. Check both implicit EB (32 ETH) and explicit EB paths
4. Test with non-standard EB values (33, 2048 ETH)

**See**: `references/vunits-calculations.md` for formulas

### Pattern 5: Event Signature Changes

**Symptom**: Oracle stops working, indexer breaks, webapp doesn't update

**Root cause**: Event parameter added, removed, or reordered

**Fix approach**:
1. NEVER change existing event signatures
2. If new data needed, emit NEW event alongside old one
3. Check `CLAUDE.md` §Backward Compatibility for impacted events
4. Coordinate with oracle team if event change is unavoidable

**Critical events**: `ValidatorAdded`, `ValidatorRemoved`, `ClusterLiquidated`,
`ClusterReactivated`, `ClusterBalanceUpdated`, `RootCommitted`

### Pattern 6: Operator Fee Change Edge Cases

**Symptom**: Fees applied before allowed, fee change window exploited

**Root cause**: Not checking UPGRADE_TIMESTAMP, missing fee index snapshot

**Fix approach**:
1. Verify `block.timestamp >= UPGRADE_TIMESTAMP` check present
2. Ensure operator snapshot updates when fee changes
3. Check both SSV and ETH fee change paths
4. Test pre-migration vs post-migration behavior

### Pattern 7: Cluster Balance Underflow

**Symptom**: Revert on legitimate operations, cluster stuck

**Root cause**: Subtraction without checking balance >= fees

**Fix approach**:
1. Use `max(0, balance - fees)` pattern
2. Check liquidation thresholds before operations
3. Handle cluster with zero balance gracefully
4. Test with dust amounts and edge of liquidation

## Troubleshooting

### Issue: Can't find the bug location

**Solution**:
1. Start from `docs/FLOWS.md` - follow the call chain
2. Use grep to find function: `grep -r "functionName" contracts/`
3. Check libraries: Most logic is in `contracts/libraries/`
4. Look at recent commits: Bug might be in recent changes

### Issue: Fix causes other tests to fail

**Solution**:
1. Read the failing test - what invariant did you break?
2. Check if your fix is too narrow - does it handle all cases?
3. Look for similar code - is bug present elsewhere too?
4. Verify you didn't change event signatures accidentally

### Issue: Not sure if this is a bug or intended

**Solution**:
1. Check `docs/SPEC.md` - what's the intended behavior?
2. Look at test files - what cases are tested?
3. Check git history - was this changed intentionally?
4. Ask in your response - explain ambiguity and propose options

### Issue: Validation script fails

**Solution**:
1. Read the error message - which check failed?
2. Storage check fails → Review diamond storage rules
3. Reentrancy check fails → Add missing guards
4. Test fails → Debug your test or fix
5. Coverage fails → Add more test cases

## Performance Notes

- Take your time to understand the bug thoroughly before coding
- Quality is more important than speed
- Do not skip the validation checklist
- Write clear explanations of your reasoning
- If uncertain, explain your assumptions and ask for guidance

## Reference Files

Load these as needed based on bug category:

- **Storage issues**: `references/storage-patterns.md`
- **Reentrancy**: `references/reentrancy-guards.md`
- **Packed types**: `references/packed-types-guide.md`
- **vUnits**: `references/vunits-calculations.md`
- **Security**: `references/security-checklist.md`
- **Testing**: `references/test-examples.md`

## Success Criteria

Your fix is complete when:

- [x] Root cause clearly identified and explained
- [x] Fix implemented with minimal changes
- [x] Security checklist verified
- [x] Test written and passing
- [x] Validation script passes
- [x] Task status updated in MAINNET-READINESS.md
- [x] No regressions in existing tests
