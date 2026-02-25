# SSV Test Writer Skill

A specialized Claude skill for generating comprehensive, high-coverage tests for SSV Network v2.0.0 smart contracts.

## Purpose

This skill provides a systematic workflow for writing production-quality tests that:
- Achieve 95%+ code coverage across all metrics
- Verify protocol invariants and state consistency
- Test happy paths, edge cases, and revert conditions
- Prove implementation matches SPEC.md formulas
- Enable confident mainnet deployment

## When to Use

Use this skill when working on:
- Writing new test suites (TEST- prefix)
- Improving code coverage (COV- prefix)
- Verifying specification compliance (SPEC- prefix)
- Adding tests for new features
- Regression testing after bug fixes

## Structure

```
.claude/skills/ssv-test-writer/
├── SKILL.md                           # Main skill definition (7-step workflow)
├── README.md                          # This file
├── references/                        # Test pattern library
│   └── test-patterns.md               # 15 production-ready test patterns
└── scripts/
    └── validate-tests.sh              # Automated quality checks (6 checks)
```

## Workflow Overview

The skill implements a 7-step systematic test generation process:

1. **Understand What to Test** - Read SPEC.md, FLOWS.md, identify scope
2. **Identify Test Categories** - Happy path, reverts, edges, state, invariants, integration, gas
3. **Generate Test Plan** - Create structured plan before writing code
4. **Set Up Test File** - Follow SSV conventions, use fixtures
5. **Implement Tests Using Patterns** - Use established patterns from library
6. **Verify Coverage** - Run tests, check coverage metrics
7. **Quality Assurance** - Run validation script, verify checklist

## Test Categories

### A. Happy Path Tests
Normal operation with valid inputs, expected state changes, events emitted correctly.

### B. Revert Tests
Invalid inputs, authorization failures, state precondition failures, business logic violations.

### C. Edge Case Tests
Boundary values (0, max), empty/single element arrays, min/max viable inputs, first/last operations.

### D. State Transition Tests
Multi-step flows, state machine transitions, concurrent operations.

### E. Invariant Tests
Protocol invariants before/after, balance conservation, index monotonicity, vUnits bounds.

### F. Integration Tests
Multi-module interactions, end-to-end journeys, upgrade scenarios, oracle integration.

### G. Gas Tests
Benchmark critical operations, verify gas limits, compare before/after optimization.

## Test Pattern Library

The skill includes 15 production-ready test patterns:

| Pattern | Description | Use Case |
|---------|-------------|----------|
| **Pattern 1** | Basic Test File Structure | Starting point for any test file |
| **Pattern 2** | Arrange-Act-Assert | Standard test structure |
| **Pattern 3** | Fixture with Validator | Pre-registered validator setup |
| **Pattern 4** | Complete Lifecycle | register → deposit → update → withdraw → remove |
| **Pattern 5** | Bulk Registration | Multiple validators in single tx |
| **Pattern 6** | Fee Declaration Flow | declare → wait → execute |
| **Pattern 7** | Operator Earnings | Accumulate and withdraw |
| **Pattern 8** | Staking Flow | stake → earn → unstake → claim |
| **Pattern 9** | Reward Accumulator | Test accumulator math |
| **Pattern 10** | Oracle EB Update | Merkle proof verification |
| **Pattern 11** | Liquidation Flow | Liquidate → reactivate |
| **Pattern 12** | Fee Calculation | Verify against SPEC.md |
| **Pattern 13** | Event Testing | Exact parameter matching |
| **Pattern 14** | Revert Testing | Comprehensive error cases |
| **Pattern 15** | Balance Invariants | Total ETH conservation |

See [references/test-patterns.md](references/test-patterns.md) for complete code examples.

## Validation Script

The `validate-tests.sh` script performs 6 automated checks:

1. ✅ **All Tests Pass** - No test failures
2. ✅ **No .only or .skip** - No focused/skipped tests
3. ✅ **Naming Conventions** - Tests follow 'should' pattern
4. ✅ **Coverage Thresholds** - Meets all coverage goals:
   - Statements: ≥95%
   - Branches: ≥90%
   - Functions: ≥95%
   - Lines: ≥95%
5. ✅ **File Organization** - Tests in correct directories
6. ✅ **Event Assertions** - State changes include event checks

### Usage

```bash
./.claude/skills/ssv-test-writer/scripts/validate-tests.sh
```

**Output**: Color-coded pass/fail for each check, coverage summary, actionable fix suggestions.

## Coverage Targets

| Metric | Target | Critical Threshold |
|--------|--------|--------------------|
| Statements | 95% | 90% |
| Branches | 90% | 85% |
| Functions | 95% | 90% |
| Lines | 95% | 90% |

**Rationale**:
- High coverage catches regressions early
- Proves code is thoroughly tested
- Enables confident refactoring
- Required for mainnet deployment

## Test File Organization

```
test/
├── unit/                          # Module-specific isolated tests
│   ├── SSVClusters/
│   │   ├── deposit.test.ts
│   │   ├── withdraw.test.ts
│   │   ├── liquidate.test.ts
│   │   └── update-cluster-balance.test.ts
│   ├── SSVOperators/
│   ├── SSVDAO/
│   ├── SSVStaking/
│   └── SSVValidators/
├── integration/                   # Multi-module end-to-end tests
│   ├── validator-lifecycle.test.ts
│   ├── cluster-migration.test.ts
│   ├── oracle-eb-updates.test.ts
│   └── staking-rewards.test.ts
├── invariant/                     # Property-based invariant tests
│   ├── balance-conservation.invariant.ts
│   ├── fee-index-monotonicity.invariant.ts
│   └── vunits-bounds.invariant.ts
├── sanity/                        # Regression tests
├── helpers/                       # Test utilities
└── common/                        # Constants, errors, events
```

## SSV-Specific Helpers

The skill leverages existing helpers from `test/helpers/contract-helpers.ts`:

```typescript
// Setup
ssvNetwork()                           // Deploy SSV network
registerOperators(count, network)      // Register N operators
bulkRegisterValidators(count, ...)     // Register N validators
depositToCluster(amount, ...)          // Deposit ETH
generateMerkleProof(clusterID, eb)     // Oracle proof

// Assertions
expectClusterBalance(owner, ops, bal)  // Assert cluster balance
expectOperatorEarnings(opId, earnings) // Assert operator earnings
expectEvent(tx, eventName, ...args)    // Assert event emission
expectRevert(promise, errorName)       // Assert revert

// Gas
trackGas(tx, group)                    // Track gas by category

// Data
DataGenerator.publicKey()              // Generate pubkey
DataGenerator.operators(count)         // Generate operator array
DataGenerator.cluster(params)          // Generate cluster struct
```

## Quick Start Example

```typescript
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { ssvNetwork, registerOperators, DEFAULT_OPERATOR_IDS } from '../../helpers/contract-helpers';

describe('SSVClusters: deposit', () => {
  async function deployFixture() {
    const [owner, ...operators] = await ethers.getSigners();
    const network = await ssvNetwork();
    await registerOperators(4, network);

    // Pre-register validator
    const publicKey = ethers.hexlify(ethers.randomBytes(48));
    await network.registerValidator(
      publicKey,
      DEFAULT_OPERATOR_IDS,
      ethers.randomBytes(256),
      0,
      { value: ethers.parseEther('5') }
    );

    return { network, owner, operators, publicKey };
  }

  it('should increase cluster balance when depositing ETH', async () => {
    const { network, owner } = await loadFixture(deployFixture);

    // Arrange
    const depositAmount = ethers.parseEther('5');
    const clusterBefore = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);

    // Act
    await network.deposit(owner.address, DEFAULT_OPERATOR_IDS, depositAmount, {
      value: depositAmount
    });

    // Assert
    const clusterAfter = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    expect(clusterAfter.balance).to.equal(clusterBefore.balance + depositAmount);
  });

  it('should revert when deposit amount does not match msg.value', async () => {
    const { network, owner } = await loadFixture(deployFixture);

    await expect(
      network.deposit(owner.address, DEFAULT_OPERATOR_IDS, ethers.parseEther('5'), {
        value: ethers.parseEther('3') // Mismatch!
      })
    ).to.be.revertedWithCustomError(network, 'InsufficientBalance');
  });

  it('should emit ClusterDeposited event', async () => {
    const { network, owner } = await loadFixture(deployFixture);

    const depositAmount = ethers.parseEther('5');

    await expect(
      network.deposit(owner.address, DEFAULT_OPERATOR_IDS, depositAmount, {
        value: depositAmount
      })
    )
      .to.emit(network, 'ClusterDeposited')
      .withArgs(owner.address, DEFAULT_OPERATOR_IDS, depositAmount);
  });
});
```

## Test Quality Checklist

Before marking tests complete:

- [ ] Test plan created covering all categories
- [ ] All tests pass locally and in CI
- [ ] Test names clearly describe scenarios
- [ ] Tests follow Arrange-Act-Assert pattern
- [ ] Tests are isolated (no order dependency)
- [ ] Exact values verified (not just >0)
- [ ] Events tested with exact parameters
- [ ] Revert tests use `.revertedWithCustomError()`
- [ ] Balance invariants checked before/after
- [ ] Edge cases explicitly tested (0, max, boundaries)
- [ ] Coverage targets met (≥95% statements)
- [ ] Gas benchmarks added for critical operations
- [ ] Integration tests cover multi-module flows
- [ ] No .only or .skip in committed tests
- [ ] Validation script passes all checks

## Common Pitfalls

### Problem: Low Coverage Despite Many Tests

**Cause**: Tests aren't hitting all branches (especially revert paths)

**Solution**:
1. View HTML coverage report: `open coverage/index.html`
2. Identify uncovered lines (highlighted in red)
3. Add tests for uncovered branches
4. Focus on revert conditions and edge cases

### Problem: Flaky Tests

**Cause**: Tests depend on execution order or have non-deterministic behavior

**Solution**:
1. Use `loadFixture` for clean state in each test
2. Use deterministic data generation
3. Await all async operations
4. Don't rely on absolute block numbers

### Problem: Slow Tests

**Cause**: Not using fixtures, re-deploying contracts repeatedly

**Solution**:
1. Use `loadFixture` instead of `beforeEach` deployments
2. Minimize unnecessary block mining
3. Parallelize independent tests
4. Pre-generate large datasets

## Integration with Project

This skill integrates with existing SSV documentation:

- **CLAUDE.md** - Project-level instructions
- **docs/SPEC.md** - Function signatures and formulas to verify
- **docs/FLOWS.md** - Step-by-step flows to test
- **test/helpers/contract-helpers.ts** - Existing test utilities

## Command Reference

```bash
# Run tests
just test                          # All tests
just test-unit                     # Unit tests only
just test-integration              # Integration tests only

# Coverage
just coverage                      # Generate coverage report
open coverage/index.html           # View HTML report

# Validation
./.claude/skills/ssv-test-writer/scripts/validate-tests.sh

# Gas profiling
REPORT_GAS=true just test          # Show gas usage report

# Watch mode (development)
npx hardhat test --watch           # Re-run on file changes
```

## Success Criteria

A test suite is complete when:

- [x] Test plan created covering all categories
- [x] All happy path scenarios tested
- [x] All revert conditions tested
- [x] All edge cases tested
- [x] State consistency verified
- [x] Protocol invariants verified
- [x] Events tested with exact params
- [x] Coverage targets met (≥95%)
- [x] All tests pass in CI
- [x] Validation script passes (6/6 checks)
- [x] No flaky or order-dependent tests
- [x] Integration tests cover key flows
- [x] Gas benchmarks added

## Related Skills

- **ssv-bug-fixer** - Fix bugs discovered by tests
- **ssv-security-auditor** (planned) - Security review
- **ssv-fuzzer** (planned) - Invariant fuzzing with Echidna

## Version

**Current version**: 1.0.0
**Target release**: SSV Network v2.0.0 (SSV Staking)
**Last updated**: 2026

---

**Goal: Tests so comprehensive you're confident shipping to mainnet.**
