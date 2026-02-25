---
name: ssv-test-writer
description: Generates comprehensive tests for SSV Network v2.0.0 smart contracts. Use when task involves writing unit tests, integration tests, invariant tests, or achieving coverage goals. Handles ETH/SSV dual clusters, effective balance accounting, packed types, reentrancy scenarios, and complex multi-module flows. Use for tasks with TEST-, COV-, or SPEC- prefixes.
metadata:
  author: SSV Network
  version: 1.0.0
  category: testing
  task-types: [TEST-, COV-, SPEC-]
  project: ssv-network-v2.0.0
---

# SSV Test Writer — Comprehensive Test Generation

## Purpose

Generate high-quality, comprehensive tests for SSV Network smart contracts that:
- Achieve 95%+ coverage (statements, branches, functions, lines)
- Verify protocol invariants hold across all operations
- Test edge cases, boundary values, and revert conditions
- Prove code matches SPEC.md formulas
- Enable confident refactoring and upgrades

## Workflow: 7-Step Test Generation Process

### Step 1: Understand What to Test

**Read the specification:**
- `docs/SPEC.md` — Function signatures, formulas, parameter ranges
- `docs/FLOWS.md` — Step-by-step state mutations for each operation
- `MAINNET-READINESS.md` — Task description and acceptance criteria

**Identify test scope:**
```
Task: "TEST-042: Write tests for updateClusterBalance oracle function"

Scope identified:
- Module: SSVClusters.sol
- Function: updateClusterBalance(address, uint64[], Cluster, bytes32[], uint256)
- Dependencies: SSVDAO (oracle management), SSVStorageEB (merkle roots)
- Invariants: vUnits bounds, balance non-negative, monotonic block numbers
```

**Key questions to answer:**
1. What is the happy path? (normal successful execution)
2. What are the revert conditions? (invalid inputs, auth failures)
3. What are the edge cases? (zero values, max values, boundary conditions)
4. What invariants must hold? (before/after state consistency)
5. What events should be emitted? (with what parameters)

### Step 2: Identify Test Categories

Categorize tests into types (aim for comprehensive coverage):

#### A. Happy Path Tests
- Normal operation with valid inputs
- Typical user scenarios
- Expected state changes occur
- Events emitted correctly

#### B. Revert Tests
- Invalid inputs (out of range, wrong type)
- Authorization failures (wrong caller)
- State precondition failures (cluster inactive, insufficient balance)
- Business logic violations (below minimum, exceeds limit)

#### C. Edge Case Tests
- Boundary values (0, max uint64, max uint256)
- Empty arrays, single element arrays
- Minimum viable inputs
- Maximum allowed inputs
- First operation in system (initialization)
- Last operation (cleanup, finalization)

#### D. State Transition Tests
- Multi-step flows (register → update → withdraw → remove)
- State machine transitions (active → liquidated → reactivated)
- Concurrent operations (multiple validators, multiple clusters)

#### E. Invariant Tests
- Protocol invariants hold before and after operation
- Balance conservation (ETH, SSV tokens)
- Index monotonicity (fee indices always increase)
- vUnits bounds (min 32 ETH, max 2048 ETH per validator)

#### F. Integration Tests
- Multi-module interactions
- End-to-end user journeys
- Upgrade scenarios
- Oracle integration

#### G. Gas Tests
- Benchmark critical operations
- Verify gas doesn't exceed block limit
- Compare gas costs before/after optimization

### Step 3: Generate Test Plan

Create a structured test plan before writing code:

```markdown
## Test Plan: updateClusterBalance

### Happy Path (4 tests)
1. Oracle successfully updates cluster EB with valid merkle proof
2. Cluster transitions from implicit to explicit vUnits mode
3. Multiple validators' EB updated in single call
4. EB increase causes fee recalculation

### Revert Cases (7 tests)
1. Non-oracle caller reverts with Unauthorized
2. Invalid merkle proof reverts with InvalidProof
3. EB below minimum (32 ETH/validator) reverts with EBBelowMinimum
4. EB above maximum (2048 ETH/validator) reverts with EBAboveMaximum
5. Stale block number reverts with StaleBlockNumber
6. Inactive cluster reverts with ClusterNotActive
7. Empty operator array reverts with InvalidOperatorIds

### Edge Cases (5 tests)
1. EB exactly at minimum (32 ETH per validator)
2. EB exactly at maximum (2048 ETH per validator)
3. Single validator cluster
4. Large cluster (13 validators, max operators)
5. EB update with zero fee accrual (same block)

### State Consistency (3 tests)
1. Cluster balance decreases by correct fee amount
2. Operator earnings increase by correct amounts
3. DAO balance increases by network fee

### Invariants (4 tests)
1. vUnits stays within bounds [validatorCount * 10k, validatorCount * 640k]
2. Cluster balance never goes negative
3. Block number monotonically increases
4. Total ETH conserved (cluster + operators + DAO = initial)

### Events (2 tests)
1. ClusterBalanceUpdated event emitted with correct params
2. Event parameters match final cluster state

Total: 25 tests
Coverage target: 100% of updateClusterBalance function
```

### Step 4: Set Up Test File

Follow SSV test structure and naming conventions:

**File location:**
```
test/
├── unit/                          # Module-specific tests
│   └── SSVClusters/
│       └── update-cluster-balance.test.ts
├── integration/                   # Cross-module tests
│   └── oracle-eb-flow.test.ts
└── invariant/                     # Invariant/fuzzing tests
    └── cluster-balance.invariant.ts
```

**Test file template:**

```typescript
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import {
  ssvNetwork,
  registerOperators,
  bulkRegisterValidators,
  DEFAULT_OPERATOR_IDS,
  DataGenerator,
  CONFIG
} from '../../helpers/contract-helpers';
import { trackGas, GasGroup } from '../../helpers/gas-usage';

describe('SSVClusters: updateClusterBalance', () => {
  let ssvNetworkContract: any;
  let owner: any;
  let oracle: any;
  let operators: any[];

  beforeEach(async () => {
    const fixture = await loadFixture(deployFixture);
    ssvNetworkContract = fixture.network;
    owner = fixture.owner;
    oracle = fixture.oracle;
    operators = fixture.operators;
  });

  async function deployFixture() {
    const signers = await ethers.getSigners();
    const [owner, oracle, ...operators] = signers;

    const network = await ssvNetwork();
    await registerOperators(4, network);

    // Register oracle
    await network.registerOracle(oracle.address, 1);

    return {
      network,
      owner,
      oracle,
      operators,
      signers
    };
  }

  describe('Happy Path', () => {
    it('should update cluster EB with valid merkle proof', async () => {
      // Test implementation
    });
  });

  describe('Revert Cases', () => {
    it('should revert when non-oracle calls function', async () => {
      // Test implementation
    });
  });

  describe('Edge Cases', () => {
    it('should handle minimum EB (32 ETH per validator)', async () => {
      // Test implementation
    });
  });

  describe('State Consistency', () => {
    it('should decrease cluster balance by correct fee amount', async () => {
      // Test implementation
    });
  });

  describe('Invariants', () => {
    it('should keep vUnits within bounds', async () => {
      // Test implementation
    });
  });

  describe('Events', () => {
    it('should emit ClusterBalanceUpdated with correct params', async () => {
      // Test implementation
    });
  });
});
```

### Step 5: Implement Tests Using Patterns

Use established SSV test patterns (see `references/test-patterns.md` for details):

**Pattern 1: Arrange-Act-Assert**
```typescript
it('should update cluster EB correctly', async () => {
  // Arrange: Set up initial state
  const publicKey = ethers.hexlify(ethers.randomBytes(48));
  await ssvNetworkContract.registerValidator(
    publicKey,
    DEFAULT_OPERATOR_IDS,
    ethers.randomBytes(256),
    0,
    { value: ethers.parseEther('10') }
  );

  const newEB = ethers.parseEther('64'); // 64 ETH
  const { root, proof, clusterID } = await generateMerkleProof(
    owner.address,
    DEFAULT_OPERATOR_IDS,
    newEB
  );

  await ssvNetworkContract.connect(oracle).commitRoot(root, 1000);

  // Act: Execute the operation
  const clusterBefore = await ssvNetworkContract.getCluster(
    owner.address,
    DEFAULT_OPERATOR_IDS
  );

  await ssvNetworkContract.connect(oracle).updateClusterBalance(
    owner.address,
    DEFAULT_OPERATOR_IDS,
    clusterBefore,
    proof,
    newEB
  );

  // Assert: Verify expected state
  const clusterAfter = await ssvNetworkContract.getCluster(
    owner.address,
    DEFAULT_OPERATOR_IDS
  );

  const expectedVUnits = (newEB * 10_000n) / ethers.parseEther('32');
  expect(clusterAfter.ebSnapshot.vUnits).to.equal(expectedVUnits);
});
```

**Pattern 2: Revert Testing**
```typescript
it('should revert when non-oracle calls function', async () => {
  await expect(
    ssvNetworkContract.connect(owner).updateClusterBalance(
      owner.address,
      DEFAULT_OPERATOR_IDS,
      cluster,
      proof,
      newEB
    )
  ).to.be.revertedWithCustomError(ssvNetworkContract, 'CallerNotOracle');
});
```

**Pattern 3: Event Testing**
```typescript
it('should emit ClusterBalanceUpdated event', async () => {
  await expect(
    ssvNetworkContract.connect(oracle).updateClusterBalance(
      owner.address,
      DEFAULT_OPERATOR_IDS,
      cluster,
      proof,
      newEB
    )
  )
    .to.emit(ssvNetworkContract, 'ClusterBalanceUpdated')
    .withArgs(
      owner.address,
      DEFAULT_OPERATOR_IDS,
      expectedVUnits,
      expectedBalance
    );
});
```

**Pattern 4: Balance Invariant Testing**
```typescript
it('should conserve total ETH', async () => {
  const totalBefore =
    (await ssvNetworkContract.getCluster(owner.address, DEFAULT_OPERATOR_IDS)).balance +
    (await ssvNetworkContract.getOperator(1)).ethEarnings +
    (await ssvNetworkContract.getDAOBalance());

  await ssvNetworkContract.connect(oracle).updateClusterBalance(
    owner.address,
    DEFAULT_OPERATOR_IDS,
    cluster,
    proof,
    newEB
  );

  const totalAfter =
    (await ssvNetworkContract.getCluster(owner.address, DEFAULT_OPERATOR_IDS)).balance +
    (await ssvNetworkContract.getOperator(1)).ethEarnings +
    (await ssvNetworkContract.getDAOBalance());

  expect(totalAfter).to.equal(totalBefore); // Total ETH conserved
});
```

**Pattern 5: Gas Benchmarking**
```typescript
it('should track gas usage for updateClusterBalance', async () => {
  const tx = await ssvNetworkContract.connect(oracle).updateClusterBalance(
    owner.address,
    DEFAULT_OPERATOR_IDS,
    cluster,
    proof,
    newEB
  );

  await trackGas(tx, GasGroup.ORACLE_UPDATE);

  const receipt = await tx.wait();
  console.log(`Gas used: ${receipt.gasUsed}`);

  // Optional: assert gas doesn't exceed threshold
  expect(receipt.gasUsed).to.be.lessThan(500_000);
});
```

**Pattern 6: Exact Formula-Based Assertions (CRITICAL)**

**❌ FORBIDDEN — Never use loose comparators:**
```typescript
// WRONG: Using greaterThan for fee calculations
it('should accumulate operator earnings', async () => {
  const earningsBefore = await network.getOperatorEarnings(operatorId);
  
  await network.registerValidator(publicKey, operatorIds, shares, cluster, { value: deposit });
  await networkHelpers.mine(100);
  
  const earningsAfter = await network.getOperatorEarnings(operatorId);
  
  // ❌ FORBIDDEN: Loose comparator
  expect(earningsAfter).to.be.greaterThan(earningsBefore);
});

// WRONG: Using greaterThanOrEqual for balance checks
it('should deduct fees from cluster balance', async () => {
  const balanceBefore = cluster.balance;
  
  await network.removeValidator(publicKey, operatorIds, cluster);
  
  const balanceAfter = (await network.getCluster(owner, operatorIds)).balance;
  
  // ❌ FORBIDDEN: Loose comparator
  expect(balanceAfter).to.be.lessThan(balanceBefore);
});
```

**✅ REQUIRED — Calculate exact expected values using SPEC.md formulas:**
```typescript
// CORRECT: Calculate exact operator earnings using SPEC.md formula
it('should accumulate exact operator earnings per formula', async () => {
  const operatorFee = 2_000_000n; // wei per block per validator
  
  const txRegister = await network.registerValidator(
    publicKey,
    operatorIds,
    shares,
    EMPTY_CLUSTER,
    { value: DEFAULT_ETH_REGISTER_VALUE }
  );
  const receiptRegister = await txRegister.wait();
  const blockRegister = receiptRegister!.blockNumber;
  
  await networkHelpers.mine(100);
  
  const txTrigger = await network.deposit(operatorIds, cluster, { value: 1n });
  const receiptTrigger = await txTrigger.wait();
  const blockTrigger = receiptTrigger!.blockNumber;
  
  // Calculate expected earnings using SPEC.md formula:
  // earnings = blocksDelta * packedFee * vUnits / VUNITS_PRECISION
  const blocksDelta = BigInt(blockTrigger - blockRegister);
  const vUnits = 1n * VUNITS_PRECISION; // 1 validator = 10,000 vUnits
  const packedFee = operatorFee / ETH_DEDUCTED_DIGITS; // 20
  const expectedEarnings = (blocksDelta * packedFee * vUnits) / VUNITS_PRECISION;
  
  const [, , actualEarnings] = await network.getOperatorEthSnapshot(operatorIds[0]);
  
  // ✅ CORRECT: Exact equality assertion
  expect(actualEarnings).to.equal(expectedEarnings);
});

// CORRECT: Calculate exact cluster balance deduction using SPEC.md formula
it('should deduct exact fees from cluster balance per formula', async () => {
  const operatorFee = 2_000_000n;
  const networkFee = NETWORK_FEE; // From constants
  
  const txRegister = await network.registerValidator(
    publicKey,
    operatorIds,
    shares,
    EMPTY_CLUSTER,
    { value: DEFAULT_ETH_REGISTER_VALUE }
  );
  const receiptRegister = await txRegister.wait();
  const blockRegister = receiptRegister!.blockNumber;
  const clusterAfterRegister = parseClusterFromEvent(network, receiptRegister, Events.VALIDATOR_ADDED);
  
  await networkHelpers.mine(50);
  
  const txRemove = await network.removeValidator(publicKey, operatorIds, clusterAfterRegister);
  const receiptRemove = await txRemove.wait();
  const blockRemove = receiptRemove!.blockNumber;
  const clusterAfterRemove = parseClusterFromEvent(network, receiptRemove, Events.VALIDATOR_REMOVED);
  
  // Calculate expected balance deduction using SPEC.md formula:
  // totalFees = blocksDelta * (sum(operatorFees) + networkFee) * vUnits / VUNITS_PRECISION
  const blocksDelta = BigInt(blockRemove - blockRegister);
  const vUnits = 1n * VUNITS_PRECISION;
  const totalFeeRate = (operatorFee * BigInt(operatorIds.length) + networkFee) / ETH_DEDUCTED_DIGITS;
  const expectedFeeDeduction = (blocksDelta * totalFeeRate * vUnits) / VUNITS_PRECISION;
  
  const expectedBalance = DEFAULT_ETH_REGISTER_VALUE - expectedFeeDeduction;
  
  // ✅ CORRECT: Exact equality assertion
  expect(clusterAfterRemove.balance).to.equal(expectedBalance);
});

// CORRECT: Verify network fee accounting with exact formula
it('should credit exact network fees to DAO balance per formula', async () => {
  const networkFee = NETWORK_FEE;
  const daoBalanceBefore = await network.getDAOBalance();
  
  const txRegister = await network.registerValidator(
    publicKey,
    operatorIds,
    shares,
    EMPTY_CLUSTER,
    { value: DEFAULT_ETH_REGISTER_VALUE }
  );
  const receiptRegister = await txRegister.wait();
  const blockRegister = receiptRegister!.blockNumber;
  const clusterAfterRegister = parseClusterFromEvent(network, receiptRegister, Events.VALIDATOR_ADDED);
  
  await networkHelpers.mine(75);
  
  const txRemove = await network.removeValidator(publicKey, operatorIds, clusterAfterRegister);
  const receiptRemove = await txRemove.wait();
  const blockRemove = receiptRemove!.blockNumber;
  
  // Calculate expected network fees using SPEC.md formula
  const blocksDelta = BigInt(blockRemove - blockRegister);
  const vUnits = 1n * VUNITS_PRECISION;
  const packedNetworkFee = networkFee / ETH_DEDUCTED_DIGITS;
  const expectedNetworkFees = (blocksDelta * packedNetworkFee * vUnits) / VUNITS_PRECISION;
  
  const daoBalanceAfter = await network.getDAOBalance();
  const actualNetworkFees = daoBalanceAfter - daoBalanceBefore;
  
  // ✅ CORRECT: Exact equality assertion
  expect(actualNetworkFees).to.equal(expectedNetworkFees);
});
```

**Key principles for exact assertions:**
1. **Always reference SPEC.md or FLOWS.md** for the exact formula
2. **Calculate expected values** using the same math as the contract
3. **Use `.to.equal()`** for all financial/state comparisons
4. **Track block numbers** to calculate `blocksDelta` precisely
5. **Use constants** (`VUNITS_PRECISION`, `ETH_DEDUCTED_DIGITS`) from the codebase
6. **Never approximate** — if the contract uses exact math, tests must too

### Step 6: Verify Coverage

Run tests and check coverage metrics:

```bash
# Run tests
just test-unit

# Generate coverage report
just coverage

# Check coverage report
open coverage/index.html
```

**Coverage targets:**
- **Statements**: ≥ 95%
- **Branches**: ≥ 90%
- **Functions**: ≥ 95%
- **Lines**: ≥ 95%

**If coverage is insufficient:**
1. Identify uncovered lines in coverage report
2. Determine why they're uncovered:
   - Missing edge case test?
   - Missing revert condition test?
   - Unreachable code (dead code - remove it)?
3. Add targeted tests for uncovered paths
4. Re-run coverage until targets met

### Step 7: Quality Assurance

Before marking tests complete, run the test quality checklist:

**Test Quality Checklist:**
- [ ] All tests pass
- [ ] Test names clearly describe what's being tested
- [ ] Tests follow Arrange-Act-Assert pattern
- [ ] Tests are isolated (no execution order dependency)
- [ ] Tests use descriptive variable names
- [ ] **CRITICAL: Tests use exact formula-based assertions (NEVER use `greaterThan`, `lessThan`, `greaterThanOrEqual`, `lessThanOrEqual`)**
- [ ] **All financial calculations verified against SPEC.md/FLOWS.md formulas with `.to.equal()` assertions**
- [ ] Tests verify exact values (not just "greater than zero")
- [ ] Events verified with exact parameter matching
- [ ] Revert tests use `.revertedWithCustomError()` with error name
- [ ] Balance invariants checked before and after operations
- [ ] Edge cases explicitly tested (0, max, boundaries)
- [ ] No copy-pasted tests with wrong descriptions
- [ ] No hardcoded addresses or magic numbers (use constants)
- [ ] Gas benchmarks added for critical operations
- [ ] Integration tests cover multi-module flows
- [ ] Test file has clear structure with `describe` blocks

**Run validation script:**
```bash
./.claude/skills/ssv-test-writer/scripts/validate-tests.sh
```

## Common Test Patterns for SSV

### Pattern Library (Quick Reference)

See `references/test-patterns.md` for full details. Common patterns:

1. **Cluster lifecycle**: register → deposit → update → withdraw → remove
2. **Liquidation flow**: underfunded → liquidate → reactivate
3. **Fee change flow**: declare → wait approval period → execute
4. **Migration flow**: SSV cluster → migrate → ETH cluster
5. **EB update flow**: implicit vUnits → oracle update → explicit vUnits
6. **Staking flow**: stake SSV → receive cSSV → accrue rewards → unstake
7. **Multi-validator flow**: register multiple → bulk operations
8. **Operator earnings**: validators pay fees → operator accumulates → withdraw

### SSV-Specific Test Helpers

Use existing helpers from `test/helpers/contract-helpers.ts`:

```typescript
// Setup helpers
ssvNetwork()                              // Deploy SSV network
registerOperators(count, network)         // Register N operators
bulkRegisterValidators(count, ...)        // Register N validators
depositToCluster(amount, ...)             // Deposit ETH to cluster
generateMerkleProof(clusterID, eb)        // Generate oracle proof

// Assertion helpers
expectClusterBalance(owner, ops, balance) // Assert cluster balance
expectOperatorEarnings(opId, earnings)    // Assert operator earnings
expectEvent(tx, eventName, ...args)       // Assert event emission
expectRevert(promise, errorName)          // Assert revert with error

// Gas tracking
trackGas(tx, group)                       // Track gas usage by category

// Data generation
DataGenerator.publicKey()                 // Generate validator pubkey
DataGenerator.operators(count)            // Generate operator array
DataGenerator.cluster(params)             // Generate cluster struct
```

## Test Categories Reference

### Unit Tests (test/unit/)

**Purpose**: Test individual functions in isolation

**Characteristics:**
- Single function under test
- Minimal dependencies
- Fast execution (<10ms per test)
- Mock external dependencies if needed
- High coverage (aim for 100% of function)

**Example structure:**
```
test/unit/
├── SSVClusters/
│   ├── deposit.test.ts
│   ├── withdraw.test.ts
│   ├── liquidate.test.ts
│   └── update-cluster-balance.test.ts
├── SSVOperators/
│   ├── register-operator.test.ts
│   ├── declare-operator-fee.test.ts
│   └── withdraw-operator-earnings.test.ts
└── SSVStaking/
    ├── stake.test.ts
    ├── unstake.test.ts
    └── claim-rewards.test.ts
```

### Integration Tests (test/integration/)

**Purpose**: Test multi-module interactions and end-to-end flows

**Characteristics:**
- Multiple modules involved
- Realistic user journeys
- Tests cross-module invariants
- Longer execution time (100ms-1s per test)
- Fewer tests, higher value

**Example structure:**
```
test/integration/
├── validator-lifecycle.test.ts     # Register → operate → exit
├── cluster-migration.test.ts       # SSV → ETH migration flow
├── oracle-eb-updates.test.ts       # Oracle EB update full flow
├── staking-rewards.test.ts         # Stake → earn → claim
└── liquidation-recovery.test.ts    # Liquidate → reactivate
```

### Invariant Tests (test/invariant/)

**Purpose**: Verify protocol invariants hold across all operations

**Characteristics:**
- Property-based testing
- Random transaction sequences
- Verify invariants never violated
- Use Echidna or custom harness
- Long running (minutes to hours)

**Example structure:**
```
test/invariant/
├── balance-conservation.invariant.ts
├── fee-index-monotonicity.invariant.ts
├── vunits-bounds.invariant.ts
└── access-control.invariant.ts
```

## Troubleshooting

### Problem: Test passes locally but fails in CI

**Possible causes:**
- Time-dependent test (using `block.timestamp`)
- Hardcoded addresses (different on CI)
- Missing await on async operation
- Race condition in parallel tests

**Fix:**
- Use `block.number` instead of `block.timestamp`
- Use fixtures to generate addresses
- Ensure all async operations are awaited
- Make tests isolated and deterministic

### Problem: Low coverage despite many tests

**Possible causes:**
- Tests aren't hitting edge cases
- Tests aren't testing revert paths
- Tests aren't testing error conditions
- Dead code exists (should be removed)

**Fix:**
- Review coverage report (HTML output)
- Add tests for uncovered branches
- Test all revert conditions explicitly
- Remove unreachable code

### Problem: Tests are slow (>1 second per test)

**Possible causes:**
- Not using fixtures (re-deploying contracts)
- Mining too many blocks
- Large data generation
- Not using loadFixture

**Fix:**
- Use `loadFixture` for fast snapshots
- Minimize block mining
- Pre-generate large datasets
- Parallelize independent tests

### Problem: Tests are flaky (pass/fail randomly)

**Possible causes:**
- Tests depend on execution order
- Shared state between tests
- Non-deterministic data generation
- Race conditions

**Fix:**
- Make each test fully isolated
- Use `beforeEach` to reset state
- Use deterministic random seeds
- Ensure sequential operations are awaited

## Summary

### Test Writing Checklist

Before submitting tests:

- [ ] Test plan created with all categories covered
- [ ] Happy path tests implemented
- [ ] All revert conditions tested
- [ ] Edge cases tested (0, max, boundaries)
- [ ] State consistency verified (before/after)
- [ ] Protocol invariants verified
- [ ] Events tested with exact params
- [ ] Coverage targets met (≥95% statements)
- [ ] All tests pass locally
- [ ] All tests pass in CI
- [ ] Tests follow SSV patterns and conventions
- [ ] Gas benchmarks added for critical paths
- [ ] Integration tests cover multi-module flows
- [ ] Test names clearly describe scenarios
- [ ] No flaky or order-dependent tests
- [ ] Validation script passes

### Quick Command Reference

```bash
# Run tests
just test-unit                    # Unit tests only
just test-integration             # Integration tests only
just test                         # All tests

# Coverage
just coverage                     # Generate coverage report
open coverage/index.html          # View HTML report

# Validation
./.claude/skills/ssv-test-writer/scripts/validate-tests.sh

# Gas profiling
REPORT_GAS=true just test        # Show gas report
```

### When to Reference Deeper Guides

- **Test patterns**: See `references/test-patterns.md` for complete pattern library
- **Mock strategies**: See `references/mocking-guide.md` for complex dependencies
- **Invariant testing**: See `references/invariant-testing.md` for property-based tests
- **Gas optimization**: See `references/gas-testing.md` for benchmarking patterns
- **Integration flows**: See `references/integration-patterns.md` for multi-module scenarios

**Goal: Comprehensive tests that give confidence to ship to mainnet.**
