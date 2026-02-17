---
title: 'Implement scenario tests from SCENARIO-TESTS.md'
base-branch: scenario-tests-design
schema: 2
model: claude-opus-4-6
---

You are implementing the scenario test suite defined in `docs/SCENARIO-TESTS.md`. Each scenario in that document must become a working test.

## Test Location & Structure

All tests go in `test/e2e/`. Create this directory structure:

```
test/e2e/
├── operators/                   # Partition 1: Operator lifecycle scenarios
│   └── operator-lifecycle.test.ts
├── clusters-eth/                # Partition 2: ETH cluster scenarios
│   └── cluster-eth-lifecycle.test.ts
├── clusters-ssv/                # Partition 3: SSV legacy scenarios
│   └── cluster-ssv-legacy.test.ts
├── migration/                   # Partition 4: Migration scenarios
│   └── migration-flows.test.ts
├── validators/                  # Partition 5: Validator lifecycle scenarios
│   └── validator-lifecycle.test.ts
├── effective-balance/           # Partition 6: EB system scenarios
│   └── eb-flows.test.ts
├── staking/                     # Partition 7: Staking scenarios
│   └── staking-flows.test.ts
├── cross-cutting/               # Partition 8: Cross-module scenarios
│   ├── economics.test.ts        # Fee accrual, conservation laws
│   ├── multi-step-flows.test.ts # Complex multi-action sequences
│   └── full-lifecycle.test.ts   # End-to-end lifecycle tests
└── helpers/
    └── e2e-helpers.ts           # Shared helpers specific to e2e tests
```

## Test Patterns

Follow the existing codebase patterns. Study these files before writing:
- `test/common/constants.ts` — All constants (fees, precision, thresholds)
- `test/common/helpers.ts` — Helper functions (registerOperators, getCurrentClusterState, merkle, etc.)
- `test/common/types.ts` — Type definitions (Cluster, etc.)
- `test/setup/deploy.ts` — Deployment helpers
- `test/setup/fixtures.ts` — Fixture patterns (ssvClustersHarnessFixture, etc.)
- `test/unit/SSVClusters/deposit.test.ts` — Example of existing test style

## How to Write Each Scenario

For each scenario in SCENARIO-TESTS.md, the test MUST:

### 1. Setup (Before block)
- Deploy fresh contracts via fixtures
- Register operators with specific fees
- Set governance parameters to known values
- Fund accounts

### 2. Execute (It block)
- Perform each action in the "Action Sequence" table, in order
- Use `hardhat_mine` to advance blocks between steps:
  ```ts
  await connection.ethers.provider.send("hardhat_mine", ["0x64"]); // 100 blocks
  ```

### 3. Assert EVERYTHING (within the It block)
- After each significant step, verify all assertions from the scenario
- **Always compute expected values using the same formulas from SPEC.md**
- **Always check actual vs expected with exact values, not "greater than zero"**

Example pattern:
```typescript
it("Scenario 2.1: Register validator on public operator — verify fee accrual", async () => {
  // Setup: 4 operators registered as public (no declared fee → default applies)
  const operatorIds = [];
  for (let i = 0; i < 4; i++) {
    const id = await network.connect(opOwner).registerOperator.staticCall(
      makeOperatorKey(i), 0n, false  // fee=0 means public, default will be applied
    );
    await network.connect(opOwner).registerOperator(makeOperatorKey(i), 0n, false);
    operatorIds.push(id);
  }

  // Step 1: Register validator, deposit 10 ETH
  const depositAmount = ethers.parseEther("10");
  await network.connect(clusterOwner).registerValidator(
    makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
    { value: depositAmount }
  );
  const clusterAfterRegister = await getCurrentClusterState(...);

  // Step 2: Advance 100 blocks
  await connection.ethers.provider.send("hardhat_mine", ["0x64"]);

  // Step 3: Verify operator earnings
  const DEFAULT_FEE = 1_770_000_000n;  // DEFAULT_OPERATOR_ETH_FEE
  const VUNITS = 10_000n;              // 1 validator × VUNITS_PRECISION
  const BLOCKS = 100n;
  const expectedPerOperator = DEFAULT_FEE * BLOCKS * VUNITS / 10_000n * 100_000n;

  for (const opId of operatorIds) {
    const [, fee, , , active] = await views.getOperatorById(opId);
    expect(fee).to.equal(DEFAULT_FEE * 100_000n, "Default ETH fee should be applied");

    const earnings = await views.getOperatorEarnings(opId);
    // ... verify earnings match expected
  }

  // Step 4: Verify cluster balance
  const networkFee = await views.getNetworkFee();
  const totalBurnPerBlock = (4n * DEFAULT_FEE + networkFee / 100_000n) * VUNITS / 10_000n * 100_000n;
  const expectedClusterBalance = depositAmount - totalBurnPerBlock * BLOCKS;
  // ... verify cluster balance

  // Step 5: Verify conservation law
  const contractBalance = await connection.ethers.provider.getBalance(network.target);
  // contract.balance >= Σ cluster balances + Σ operator earnings + DAO earnings
});
```

### 4. Edge Variations
Each "Edge Variation" from the scenario document should be a separate `it()` block in the same `describe()`.

## Critical Rules

1. **Use exact arithmetic.** Every expected value must be computed from the formulas in SPEC.md with actual numbers. No approximations.

2. **Assert at every step, not just the end.** If the scenario has 5 steps, check state after step 1, step 3, and step 5 — not just step 5.

3. **Use `BigInt` everywhere.** Never use `Number` for ETH/fee values. Precision loss from Number is a bug.

4. **Make tests independent.** Each `it()` block must set up its own state. Use `loadFixture()` for shared setup.

5. **Name tests descriptively.** The test name should describe the scenario AND what it verifies: `"Register on public operator → advance 100 blocks → operator earnings match DEFAULT_FEE formula"`

6. **Handle block counting carefully.** `registerValidator` happens at block N. `hardhat_mine 100` advances to N+100. Fee accrual = 100 blocks (not 101). Be precise about the block at which each action occurs.

7. **Test helper reuse.** Reuse existing helpers from `test/common/helpers.ts`. Create new helpers in `test/e2e/helpers/` only for e2e-specific patterns (like "advance N blocks and verify economics").

8. **Run your tests.** After implementing, run `npx hardhat test test/e2e/` to verify they pass. If a test fails and the code is correct, the scenario expectation may be wrong — flag it for review.

## Discrepancies

If `SCENARIO-TESTS.md` has a "Discrepancies Found" section, pay special attention to those areas. Where the document flags code-vs-docs disagreements, write tests that verify the **actual contract behavior** and add a comment noting the discrepancy.

## Completeness Check

Before finalizing, verify:
- [ ] Every scenario from SCENARIO-TESTS.md has a corresponding test
- [ ] Every assertion from each scenario is checked
- [ ] All global invariants are checked in cross-cutting tests
- [ ] All edge variations are implemented
- [ ] All tests pass
