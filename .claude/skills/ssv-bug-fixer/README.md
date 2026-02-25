# SSV Bug Fixer Skill

A specialized Claude skill for fixing security vulnerabilities and bugs in SSV Network v2.0.0 smart contracts.

## Purpose

This skill provides a comprehensive, security-first workflow for identifying, analyzing, fixing, and testing bugs in the SSV Network protocol. It implements progressive disclosure to minimize context usage while providing deep domain knowledge when needed.

## When to Use

Use this skill when working on:
- Security vulnerabilities (SEC- prefix)
- Logic bugs (BUG- prefix)
- Bug fixes (FIX- prefix)
- Issues in MAINNET-READINESS.md

The skill is optimized for SSV-specific patterns:
- Diamond storage management
- ETH/SSV dual clusters
- Packed type precision
- vUnits calculations
- Reentrancy protection
- Oracle integration

## Structure

```
.claude/skills/ssv-bug-fixer/
├── SKILL.md                           # Main skill definition (9-step workflow)
├── README.md                          # This file
├── references/                        # Deep-dive guides (loaded as needed)
│   ├── storage-patterns.md            # Diamond storage & EIP-2535
│   ├── reentrancy-guards.md           # Custom reentrancy protection
│   ├── packed-types-guide.md          # ETH vs SSV precision systems
│   ├── vunits-calculations.md         # Effective balance accounting
│   ├── security-checklist.md          # Pre-flight & validation checks
│   └── test-examples.md               # Test templates for common bugs
└── scripts/
    └── validate-fix.sh                # Automated quality gate (8 checks)
```

## Workflow Overview

The skill implements a 9-step workflow:

1. **Understand the Task** - Read MAINNET-READINESS.md, identify category
2. **Locate Affected Code** - Use FLOWS.md & SPEC.md, read contracts
3. **Root Cause Analysis** - Systematically identify the bug
4. **Design the Fix** - Minimal upstream fix principle
5. **Validate Against Security Rules** - Pre-implementation checklist
6. **Implement the Fix** - Match code style, use Edit tool
7. **Write Test** - Prove bug is fixed, test edge cases
8. **Quality Gate** - Run validation script
9. **Update Task Status** - Mark complete in MAINNET-READINESS.md

## Core Principles

### Security First

**Non-negotiable rules:**
- ❌ NEVER add storage variables to modules (use diamond storage)
- ❌ NEVER change event signatures (breaks oracle/indexer)
- ❌ NEVER reorder struct fields (append only)
- ✅ ALWAYS use `nonReentrant` on ETH/token transfers
- ✅ ALWAYS use correct packed type precision constants
- ✅ ALWAYS follow checks-effects-interactions pattern

### Progressive Disclosure

The skill loads reference materials only when needed:
- **Level 1**: SKILL.md (core workflow, ~460 lines)
- **Level 2**: Category-specific reference (~500-1000 lines)
- **Level 3**: Related references if needed

This minimizes token usage while providing depth when required.

### Minimal Changes

- One-line fix if possible
- No refactoring unless necessary
- Preserve existing code style
- Don't "improve" unrelated code

## Reference Guides

### [storage-patterns.md](references/storage-patterns.md)
**When to use**: Storage bugs, upgrade issues, struct modifications

**Topics**:
- Diamond storage pattern (EIP-2535)
- Storage slot computation
- Append-only struct rule
- Common storage mistakes
- Verification tools

**Key rule**: NEVER add storage variables to module contracts - all state goes through diamond storage at deterministic slots.

### [reentrancy-guards.md](references/reentrancy-guards.md)
**When to use**: ETH/token transfers, external calls, state management

**Topics**:
- SSV's custom reentrancy guard
- Functions requiring protection
- Checks-effects-interactions pattern
- Testing for reentrancy
- Common pitfalls

**Key rule**: ALL functions transferring ETH or tokens MUST use `nonReentrant` modifier.

### [packed-types-guide.md](references/packed-types-guide.md)
**When to use**: Fee calculations, precision issues, overflow bugs

**Topics**:
- Two precision systems (SSV vs ETH)
- PackedSSV (DEDUCTED_DIGITS = 10_000_000)
- PackedETH (ETH_DEDUCTED_DIGITS = 100_000)
- Common bug patterns
- SSVPackedLib usage

**Key rule**: Never mix precision constants - ETH uses 100,000 divisor, SSV uses 10,000,000.

### [vunits-calculations.md](references/vunits-calculations.md)
**When to use**: Effective balance bugs, fee calculation errors, oracle updates

**Topics**:
- vUnits model overview
- Implicit vs explicit EB
- Fee calculations with vUnits
- Ceiling vs floor division
- Operator vUnits accounting

**Key rule**: Use ceiling division for EB→vUnits to prevent underpayment.

### [security-checklist.md](references/security-checklist.md)
**When to use**: Before ANY code changes, during pre-commit review

**Topics**:
- Pre-implementation security gate
- Protocol invariants
- Code review checklist
- Category-specific checks
- Common security pitfalls

**Key rule**: Run through entire checklist before proposing a fix.

### [test-examples.md](references/test-examples.md)
**When to use**: Writing tests for bug fixes

**Topics**:
- Test structure and templates
- Reentrancy testing
- Packed type testing
- vUnits testing
- Integration tests
- Helper functions

**Key rule**: Every bug fix MUST include a test proving the bug is fixed.

## Validation Script

The `validate-fix.sh` script runs 8 automated checks:

1. ✅ **Compilation** - All contracts compile
2. ✅ **Storage Safety** - No storage variables in modules
3. ✅ **Reentrancy Guards** - All ETH transfers protected
4. ✅ **Packed Types** - Correct precision constants used
5. ✅ **Storage Structs** - Only append operations (manual review)
6. ✅ **Unit Tests** - All unit tests pass
7. ✅ **Integration Tests** - All integration tests pass
8. ✅ **Coverage** - Meets minimum threshold (80%)

### Usage

```bash
./.claude/skills/ssv-bug-fixer/scripts/validate-fix.sh
```

If all checks pass, your fix is ready for review.

## Common Bug Patterns

The skill recognizes and provides guidance for 7 common bug categories:

1. **Packed Type Precision Loss**
   - Symptom: Amounts slightly wrong, dust accumulates
   - Fix: Use correct constant (ETH_DEDUCTED_DIGITS vs DEDUCTED_DIGITS)

2. **Reentrancy on ETH Operations**
   - Symptom: State changes after external call
   - Fix: Add `nonReentrant` modifier, reorder state updates

3. **Storage Layout Conflicts**
   - Symptom: Wrong values from storage, state corruption
   - Fix: Use diamond storage, append-only structs

4. **vUnits Calculation Errors**
   - Symptom: Wrong fees, balance drift, liquidation issues
   - Fix: Use ceiling division for EB→vUnits

5. **Event Signature Changes**
   - Symptom: Oracle stops working, indexer breaks
   - Fix: Never change existing events, emit new alongside old

6. **Operator Fee Change Edge Cases**
   - Symptom: Fees applied before allowed, exploitable window
   - Fix: Check UPGRADE_TIMESTAMP, update snapshot

7. **Cluster Balance Underflow**
   - Symptom: Revert on legitimate operations
   - Fix: Use max(0, balance - fees) pattern

## Integration with Project

This skill integrates with existing SSV documentation:

- **CLAUDE.md** - Project-level Claude instructions
- **docs/SPEC.md** - Full DIP-X specification
- **docs/FLOWS.md** - Step-by-step contract flows
- **ssv-review/planning/MAINNET-READINESS.md** - Task tracking

The skill references these documents and updates them as part of the workflow.

## Performance Optimization

The skill is designed for efficiency:

- **Progressive disclosure**: Load only what's needed
- **Targeted searches**: Use grep/glob before full file reads
- **Validation gates**: Catch errors early
- **Template reuse**: Consistent patterns reduce context

Typical token usage:
- Simple bug fix: ~10k-20k tokens
- Complex multi-module fix: ~30k-50k tokens
- Full workflow with references: ~50k-80k tokens

## Success Criteria

A bug fix is complete when:

- [x] Root cause identified and explained
- [x] Fix implemented with minimal changes
- [x] Security checklist verified
- [x] Test written and passing
- [x] Validation script passes (8/8 checks)
- [x] Task status updated in MAINNET-READINESS.md
- [x] No regressions in existing tests

## Contributing to This Skill

If you find patterns that should be added:

1. **New bug pattern**: Add to SKILL.md §Common Bug Patterns
2. **New security rule**: Add to references/security-checklist.md
3. **New test example**: Add to references/test-examples.md
4. **New validation check**: Add to scripts/validate-fix.sh

Keep the progressive disclosure principle: most common info in SKILL.md, deep-dives in references/.

## Example Usage

```bash
# Claude: I need to fix SEC-042: Reentrancy in withdraw function

# Skill activates automatically based on task-types: [SEC-, BUG-, FIX-]

# Step 1: Reads MAINNET-READINESS.md to understand task
# Step 2: Loads references/reentrancy-guards.md
# Step 3: Locates withdraw() in contracts/modules/SSVClusters.sol
# Step 4: Proposes adding nonReentrant modifier
# Step 5: Implements fix using Edit tool
# Step 6: Writes test in test/unit/SSVClusters/withdraw-reentrancy.ts
# Step 7: Runs ./scripts/validate-fix.sh
# Step 8: Updates MAINNET-READINESS.md status
```

## Related Skills

- **ssv-test-writer** (planned) - Specialized test generation
- **ssv-security-auditor** (planned) - Comprehensive security review
- **ssv-fuzzer** (planned) - Echidna/Foundry fuzzing campaigns

## Feedback

If this skill doesn't work as expected:
1. Check that task ID has SEC-, BUG-, or FIX- prefix
2. Verify MAINNET-READINESS.md has task description
3. Ensure reference documents are accessible
4. Report issues in project issue tracker

## Version

**Current version**: 1.0.0
**Target release**: SSV Network v2.0.0 (SSV Staking)
**Last updated**: 2026

---

**Remember**: Security is non-negotiable. Take your time, verify every change, and when in doubt, ask.
