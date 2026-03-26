# External Protocol Test Techniques → SSV Network Integration Analysis

Generated: 2026-03-25

## Purpose

This document cross-references the test strategies of five major Ethereum protocols (Aave V4, CSM, Lido Core, Rocket Pool, Uniswap v4) against SSV Network's current test infrastructure. The goal is to identify **techniques that expand the space of reachable states** beyond what hand-written scenarios can cover — directly addressing the bottleneck of being limited by the scenarios we ideate.

Each protocol is compared against SSV's current capabilities (documented in `SSV/ssv-network.yaml` and `SSV/ssv-network.md`). Only techniques that SSV **does not already have** and that would provide **concrete coverage gains** are included.

### SSV's Current Position

- **Maturity:** Very advanced (Hardhat + Mocha + Chai + Echidna + Foundry tooling + Monte Carlo simulation)
- **Strengths:** Stateful Echidna harnesses with actor contracts, shadow bookkeeping, fork preflight + fallback, legacy artifact replay, Monte Carlo engine, gas budgets, scenario coverage matrix
- **Current bottleneck:** Scenario coverage is bounded by manual ideation. VUNITS-SCENARIOS.md has ~20 ❌ gaps and ~25 ⚠️ partials across 100+ scenarios, concentrated in combinatorial areas (multi-cluster × operator removal × EB update × cluster size)
- **Key gaps per self-assessment:** No Foundry-native `invariant_*` suites, no dedicated differential implementation, no mutation testing, coverage is Hardhat-only

---

## Protocol-by-Protocol Comparison

### 1. Lido Core → SSV

**Lido maturity:** Very advanced | **Stack:** Hardhat + Foundry dual-framework

#### 1a. Handler-Based Foundry Invariant Testing ⭐ HIGHEST IMPACT

**What Lido has:**
Handler contracts (`WQHandler`, `BCDepositorHandler`, `MinFirstAllocationStrategyAllocateHandler`) that wrap protocol functions and maintain ghost variables (`ghost_totalRequestedEth`, `ghost_totalLockedEth`, `ghost_totalClaimedEth`, etc.). Foundry's `invariant_*` engine calls handler functions in random sequences and checks invariants after every step. Uses `targetSelector()` and `targetContract()` for guided exploration with inline config annotations (`forge-config: default.invariant.runs = 256`).

**What SSV has instead:**
Echidna harnesses with `action_*` mutators and `echidna_*` properties. These are stateful and use actor contracts, but require pre-defined action patterns. The fuzzer explores within those patterns, not across arbitrary protocol-wide sequences. No Foundry `invariant_*` tests exist.

**Gap this fills:**
Foundry handler-based invariants discover action sequences **the team hasn't thought of**. This directly addresses the combinatorial gaps in VUNITS-SCENARIOS.md:
- §7 (Multi-Cluster): MC-02 through MC-10 — shared operator removal across clusters
- §9 (DAO Invariants): D-06, D-07 — global vUnit consistency after complex flows
- §13 (Cluster Sizes): CS-33, CS-34 — cross-size DAO invariants

A single `ClusterHandler` that randomly calls `registerValidator`, `removeValidator`, `deposit`, `withdraw`, `liquidate`, `reactivate`, `updateClusterBalance`, `migrateClusterToETH` with bounded inputs would mechanically explore the multi-cluster × operator-removal × EB-update × cluster-size product space.

**Reference files:**
- `test/0.8.9/withdrawalQueue.t.sol` — WQHandler with 6 invariants, ghost variables
- `test/0.8.9/beaconChainDepositor.t.sol` — BCDepositorHandler with deposit integrity invariants
- `test/common/minFirstAllocationStrategy.t.sol` — Differential handler with naive reference

**Effort:** Medium-high (1-2 weeks). Foundry is already in SSV's toolchain. Harness contracts exist. Main work is writing the handler + ghost state + invariant assertions in Solidity.

**Prerequisite:** SSVFuzzers.sol bounding library (see §3 below).

---

#### 1b. Differential Testing via Naive Reference Implementation ⭐ HIGH IMPACT

**What Lido has:**
`NaiveMinFirstAllocationStrategy` — a brute-force O(n) implementation alongside the optimized one. The invariant handler runs both in parallel and asserts output equivalence on every fuzz step.

**What SSV has instead:**
Shadow-model and formula-backed checks in TypeScript (simulation bookkeeping, helper assertions). No dedicated dual-implementation harness where an alternative implementation serves as the expected-value oracle.

**Gap this fills:**
SSV's vUnit accounting (`ebToVUnits`, deviation add/remove, settlement, packed-type operations) is complex. A reference implementation would:
- Serve as the "expected value" oracle for every scenario test, eliminating manual math in assertions
- Catch precision/rounding bugs invisible to same-implementation testing
- Directly address §11 (Precision and Rounding) gaps: P-02, P-03, P-05

**Two implementation paths:**

**Path A — TypeScript reference (lower friction):**
```
calculateVUnits(eb, validatorCount) → expected vUnits
calculateSettlement(oldIndex, newIndex, vUnits) → expected fees
calculateLiquidationThreshold(vUnits, networkFee, operatorFees, ...) → expected threshold
```
Used as the expected-value oracle in existing Hardhat tests.

**Path B — Solidity naive implementation (stronger, for Foundry):**
`NaiveVUnitAccounting.sol` that does the same math without packed types. Used in Foundry differential fuzz tests via the handler pattern from §1a.

**Reference files:**
- `test/common/minFirstAllocationStrategy.t.sol:279-302` — NaiveMinFirstAllocationStrategy

**Effort:** Medium (1 week). The math is already documented in the SSV codebase.

---

#### 1c. Ghost Variable Pattern in Handlers

**What Lido has:**
Handlers maintain cumulative shadow state (`ghost_totalDeposits`, `ghost_totalETHDeposited`, `ghost_DepositEvents[]`) that tracks what the handler has done. Invariants compare ghost state against contract state.

**What SSV has instead:**
Shadow bookkeeping in Echidna harnesses (ClusterRecord, tracked operator owners, migrated cluster sets) and TypeScript simulation state. The pattern is equivalent in concept but doesn't run in Foundry's handler engine.

**Gap this fills:**
If SSV adopts Foundry handler invariants (§1a), ghost variables are the mechanism for tracking expected state. SSV-specific ghosts would include:
- `ghost_daoTotalEthVUnits` — expected DAO total
- `ghost_operatorVUnits[opId]` — expected per-operator vUnits
- `ghost_clusterBalance[clusterId]` — expected cluster balance
- `ghost_removedOperators[opId]` — set of removed operators (for skip assertions)

**Effort:** Included in §1a effort.

---

#### 1d. Three-Mode Integration Infrastructure (scratch / fork / upgrade)

**What Lido has:**
Same integration tests run against scratch deploys, mainnet forks, and upgrade simulations via a `MODE` environment variable. `getProtocolContext()` auto-detects mode and returns a unified `ProtocolContext` object.

**What SSV has instead:**
Fork tests and upgrade tests exist but as separate entrypoints (`test/forked/`, `test/test-forked/`). The SSV analysis notes: "Fork test entrypoints are split across test/forked/ and test/test-forked/, and the files are not identical."

**Gap this fills:**
Unifying fork/scratch/upgrade into a single mode-switched infrastructure would eliminate the split-entrypoint maintenance risk and ensure every integration test runs against all three modes.

**Effort:** Medium. Architectural refactor of fork test infrastructure.

**Priority:** Lower than §1a-§1c for mainnet readiness. The current split works; the risk is maintenance, not coverage.

---

#### 1e. Bail-On-Failure Sequential Scenario Chains

**What Lido has:**
`bailOnFailure` function used as `beforeEach` hook — skips remaining tests in a suite if any prior test failed. Enables dependent sequential chains (stake → report → request → finalize → claim).

**What SSV has instead:**
Independent test cases. Scenario tests in `test/e2e/` exercise multi-step flows but each test is self-contained.

**Gap this fills:**
Would enable writing longer dependent scenario chains without the overhead of full fixture reconstruction per step. Directly useful for the longer §5 (Liquidation + Reactivation) and §6 (Migration) sequences.

**Effort:** Very low (hours). Single utility function.

---

#### 1f. Custom Chai Assertions for Domain-Specific Rounding

**What Lido has:**
`equalStETH(expected)` — compares stETH values within a 5 wei rounding margin. Globally registered via Mocha root hooks.

**What SSV has instead:**
`test/helpers/invariants.ts` has reusable assertion helpers, but no domain-specific rounding-tolerant comparisons.

**Gap this fills:**
SSV's packed-type arithmetic and ETH_DEDUCTED_DIGITS truncation create rounding margins. A custom `equalWithPrecision(expected, digits)` Chai assertion would make dust/rounding assertions cleaner across the suite.

**Effort:** Very low (hours).

---

### 2. Uniswap v4 → SSV

**Uni v4 maturity:** Very advanced | **Stack:** Foundry + Echidna

#### 2a. Domain-Specific Fuzz Bounding Library (`Fuzzers.sol`) ⭐ HIGH IMPACT

**What Uni has:**
`src/test/Fuzzers.sol` — a reusable library with `boundTicks()`, `boundLiquidityDelta()`, `createFuzzyLiquidityParams()`, `createRandomSqrtPriceX96()`. Transforms raw fuzz inputs into protocol-valid parameters without `vm.assume()` rejections. Inherited by test contracts.

**What SSV has instead:**
Echidna harnesses use hand-tuned ranges in `action_*` functions. No shared Foundry-side bounding library.

**Gap this fills:**
If SSV adopts Foundry handler invariants (§1a), a bounding library is essential. Without it, the fuzzer wastes 90%+ of runs on invalid inputs. SSV's input space has hard constraints (cluster sizes 4/7/10/13, EB ranges 32–2048, operator fee governance bounds, valid operator ID sets) that need domain-aware bounding.

**Concrete `SSVFuzzers.sol` design:**

| Function | Purpose |
|----------|---------|
| `boundClusterSize(uint256 seed)` | Returns 4, 7, 10, or 13 |
| `boundEffectiveBalance(uint256 seed, uint32 validatorCount)` | Valid EB in [32*n, 2048*n], multiple of validatorCount |
| `boundOperatorFee(uint256 seed)` | Within governance min/max |
| `boundWithdrawAmount(uint256 seed, uint256 balance, uint256 threshold)` | Valid withdrawal that respects liquidation threshold |
| `createFuzzyCluster(uint256 seed)` | Composes size + EB + operators into valid registration params |
| `boundEBUpdate(uint256 seed, uint256 currentEB, uint32 validatorCount)` | Valid new EB for updateClusterBalance |
| `selectRandomOperator(uint256 seed, uint64[] operatorIds)` | Picks from existing operator set |

**Reference files:**
- `src/test/Fuzzers.sol` in Uniswap v4

**Effort:** Low-medium (3-5 days). Standalone library, no infra changes. Also useful for Echidna harnesses.

---

#### 2b. V(N) vs V(N+1) Differential Fuzzing

**What Uni has:**
`V3Fuzzer` deploys the real V3 factory from stored bytecode (`test/bin/v3Factory.bytecode`), creates identical pools in V3 and V4, performs the same operations, and asserts `amount0Diff == 0 && amount1Diff == 0`.

**What SSV has instead:**
Legacy artifact replay (`test/setup/artifacts/*Legacy.json`) for upgrade tests. These replay the upgrade path but don't fuzz-compare pre/post behavior.

**Gap this fills:**
Fuzz the migration path: deploy legacy SSV from stored artifacts, perform random operations on the SSV-side cluster, migrate to ETH, and assert that post-migration state matches the reference model. This mechanically covers §6 migration gaps (M-06, M-07).

**Reference files:**
- `test/PoolManager.swap.t.sol` (V3Fuzzer, V3SwapTests)
- `test/utils/V3Helper.sol`

**Effort:** Medium-high. SSV has the legacy artifacts; the fuzz harness is new work.

---

#### 2c. FFI Cross-Language Reference Oracle

**What Uni has:**
`test/utils/JavascriptFfi.sol` calls TypeScript math implementations via `vm.ffi()`. Foundry fuzz tests validate Solidity results against an independent TypeScript oracle.

**What SSV has instead:**
TypeScript helpers and simulation bookkeeping exist but are called from Hardhat tests, not from Foundry fuzz tests.

**Gap this fills:**
If SSV builds TypeScript reference implementations (§1b Path A), FFI lets Foundry fuzz tests call them on every run — cross-language differential testing at fuzz scale.

**Reference files:**
- `test/utils/JavascriptFfi.sol`
- `test/js-scripts/src/*.ts`

**Effort:** Medium. Requires Foundry test adoption (§1a) + TypeScript reference (§1b).

---

#### 2d. Tiered Fuzz Profiles (dev/PR/CI)

**What Uni has:**
```toml
[profile.default.fuzz] runs = 1000
[profile.pr.fuzz]      runs = 10000
[profile.ci.fuzz]      runs = 100000
```
Plus inline per-test overrides via `/// forge-config: default.fuzz.runs = 10`.

**What SSV has instead:**
Echidna config with `seqLen: 200` and parallel workers. No Foundry fuzz profiles.

**Gap this fills:**
If SSV adopts Foundry fuzz/invariant tests, tiered profiles balance developer speed (100-1K runs) with merge-gate confidence (10K-100K runs).

**Effort:** Very low. Configuration only.

---

#### 2e. Echidna Stateful Boundary-Value Pattern

**What Uni has:**
`TickOverflowSafetyEchidnaTest` initializes `feeGrowthGlobal` at `type(uint256).max / 2` and provides `setPosition()`, `moveToTick()`, `increaseFeeGrowthGlobal()` as callable functions. Echidna sequences these to find overflow conditions.

**What SSV has instead:**
Targeted Echidna harnesses with shadow bookkeeping. No harness specifically initializes state near overflow/underflow boundaries.

**Gap this fills:**
SSV's packed types have overflow/underflow risks at extreme values. An Echidna harness that starts vUnits, operator indices, or cluster balances near boundary values (max EB × max validators × max operators) would target the exact class of bugs that caused the operator-removal underflows documented in §3 (R-01 through R-08).

**Effort:** Low-medium. Extension of existing Echidna harness patterns.

---

#### 2f. Gas Snapshot Regression System

**What Uni has:**
20 JSON snapshot files in `snapshots/`, CI enforces `FORGE_SNAPSHOT_CHECK=true`.

**What SSV has instead:**
`test/helpers/gas-usage.ts` with `GasGroup` enum, per-operation ceilings, `scripts/gas-compare.ts` baseline comparison. SSV's gas system is already strong.

**Gap this fills:**
Minimal. SSV's gas infrastructure is comparable. The only gap is that Foundry-native `vm.snapshotGasLastCall()` snapshots would complement the Hardhat gas system if Foundry tests are adopted.

**Priority:** Low. SSV already has this covered.

---

### 3. Community Staking Module (CSM) → SSV

**CSM maturity:** Advanced | **Stack:** Foundry

#### 3a. Inline `assertInvariants` Modifier ⭐ MEDIUM-HIGH IMPACT (quick win)

**What CSM has:**
Every test function decorated with `assertInvariants` modifier that runs 10 property checks after execution. Gas metering paused during checks. Different test suites compose different subsets of the 10 available assertions:
1. `assertCSMKeys` — validator key state monotonicity
2. `assertCSMEnqueuedCount` — deposit queue linked-list consistency
3. `assertCSMUnusedStorageSlots` — backward-compat storage slots zeroed
4. `assertAccountingTotalBondShares` — bond shares sum consistency
5. `assertAccountingBurnerApproval` — burner allowance floor
6–10. Additional storage, Merkle, and distribution assertions

**What SSV has instead:**
`test/helpers/invariants.ts` with reusable TypeScript invariant helpers (conservation, supply, monotonicity, vUnits). Called explicitly in specific tests, not automatically after every test.

**Gap this fills:**
An automatic post-test invariant sweep would catch accounting drift in **every existing test** — including the 126 staking tests in STAKING-TEST-PLAN.md that don't currently check DAO-level vUnit consistency. This is the lowest-effort, highest-breadth improvement available.

**Two implementation paths:**

**Path A — Hardhat/TypeScript global hook (immediate):**
Add to the test setup:
```typescript
afterEach(async function () {
  if (this.currentTest?.state === 'passed') {
    await assertConservation();
    await assertDaoVUnitsConsistency();
    await assertOperatorVUnitsSum();
    await assertNoRemovedOperatorDeviation();
  }
});
```

**Path B — Foundry modifier (if adopting §1a):**
```solidity
modifier assertInvariants() {
    _;
    vm.pauseGasMetering();
    assertDaoVUnitsConsistent();
    assertOperatorVUnitsSumCorrect();
    assertNoRemovedOperatorDeviation();
    assertClusterBalanceConservation();
    vm.resumeGasMetering();
}
```

**Reference files:**
- `test/helpers/InvariantAsserts.sol` in CSM
- Applied in `test/CSModule.t.sol`, `test/CSAccounting.t.sol`, `test/fork/integration/StakingRouter.t.sol`

**Effort:** Low (1-3 days). Leverages existing SSV invariant helpers.

---

#### 3b. Conditional Invariant Execution by CI Profile

**What CSM has:**
`skipInvariants()` gates expensive invariant checks on `FOUNDRY_PROFILE == ci` and active fork existence. Local dev runs fast; CI runs thorough.

**What SSV has instead:**
No conditional gating on invariant checks.

**Gap this fills:**
If §3a's global invariant sweep is expensive (walking all operators, clusters, DAO state), gating it to CI prevents slowdown in local development.

**Effort:** Very low. Single utility function.

---

#### 3c. `brutalizeMemory` Modifier for Memory Safety

**What CSM has:**
Modifier applied 40+ times in `test/CSModule.t.sol` that corrupts unused Solidity memory regions before test execution. Catches bugs where code reads from memory that was never explicitly written.

**What SSV has instead:**
No memory corruption testing.

**Gap this fills:**
SSV's `PackedLib` does bit manipulation that could theoretically read dirty memory. Low-cost, high-defensiveness addition for Foundry fuzz tests on packed-type operations.

**Effort:** Very low (hours). Copy the modifier, apply to packed-type fuzz tests.

---

#### 3d. Storage Slot Backward-Compatibility Assertions

**What CSM has:**
```solidity
function assertCSMUnusedStorageSlots(CSModule csm) internal view {
    bytes32 slot2 = vm.load(address(csm), bytes32(uint256(2)));
    assertEq(slot2, bytes32(0), "slot 2 not empty");
}
```
Uses `vm.load()` to verify deprecated storage slots remain empty after upgrades.

**What SSV has instead:**
Upgrade and migration tests exist, but no direct storage-slot inspection for backward compatibility.

**Gap this fills:**
SSV uses diamond storage and has undergone major upgrades (SSV → ETH migration). Direct slot assertions would catch accidental storage layout breaks. Particularly relevant for the diamond storage pattern where facet upgrades could corrupt shared state.

**Effort:** Low-medium. Requires identifying which slots must remain invariant across upgrades.

---

#### 3e. Multi-Fork Upgrade State Comparison

**What CSM has:**
Creates two Ethereum forks (pre-vote and post-vote blocks), switches between them with `vm.selectFork()`, compares field-by-field state across all node operators.

**What SSV has instead:**
Fork testing with preflight validation and fallback, but not a dual-fork before/after comparison.

**Gap this fills:**
For SSV's v2.0.0 upgrade, a dual-fork comparison would verify that the upgrade preserved expected state while applying expected mutations — stronger than testing the upgrade path in isolation.

**Effort:** Medium. Requires fork infrastructure changes.

---

### 4. Rocket Pool → SSV

**Rocket Pool maturity:** Advanced | **Stack:** Hardhat + Mocha (no fuzzing)

#### 4a. Post-Test Global Accounting Invariant Sweep ⭐ (reinforces §3a)

**What Rocket Pool has:**
`afterEach(checkInvariants)` in `test/rocket-pool-tests.js`. Every main-suite test is followed by a registry-wide accounting audit that walks all nodes, enumerates their minipools, and checks active/finalized/staking counts, deposit-size accounting, weighted average fee, and deposit pool balance.

**What SSV has instead:**
Same gap as §3a — invariant helpers exist but are called explicitly, not automatically.

**Gap this fills:**
Same as §3a. Included here because Rocket Pool demonstrates the pattern in a Hardhat/Mocha stack (matching SSV's primary runner), while CSM demonstrates it in Foundry. SSV can adopt the Rocket Pool variant immediately without any Foundry dependency.

**Key detail from Rocket Pool:** Tests that intentionally break delegate configuration explicitly reset shared state before teardown so invariant checks remain usable. SSV would need similar discipline — tests that intentionally create broken states (e.g., removed-operator tests) should mark themselves as exempt or repair state before the sweep.

**Reference files:**
- `test/rocket-pool-tests.js` — `afterEach(checkInvariants)`
- `test/_helpers/invariants.js` — cross-contract invariant checks

**Effort:** Low. Direct adoption of the `afterEach` pattern with SSV's existing helpers.

---

#### 4b. Nested Snapshot Fixture Tree

**What Rocket Pool has:**
`globalSnapShot()` and `snapshotDescribe()` create expensive mid-state setups once, then open additional nested suites off those checkpoints. Used in `test/megapool/megapool-tests.js` for deep stateful scenarios.

**What SSV has instead:**
Shared deployment fixtures in `test/setup/fixtures.ts`. Each test uses the fixture but doesn't create intermediate snapshot branches.

**Gap this fills:**
SSV's combinatorial scenarios (e.g., "register validator → EB=64 → remove operator → {liquidate | withdraw | EB update | migrate}") share a long setup prefix. Snapshot branching would let each variant fork from the shared prefix without re-running it.

**Effort:** Low-medium. Utility function + test restructuring.

---

#### 4c. Scenario Action Modules with Embedded Balance-Delta Assertions

**What Rocket Pool has:**
`scenario-*.js` files that both perform the action **and** verify local invariants. `scenario-deposit.js` checks deposit pool, vault, and rETH balance changes. `scenario-stake.js` checks capital deltas and then re-runs megapool invariants.

**What SSV has instead:**
Scenario tests in `test/e2e/` that are self-contained test files, not composable action modules.

**Gap this fills:**
If SSV's scenario modules both performed the action and asserted local invariants, they could be composed into longer chains without duplicating assertion logic. Combined with §1e (bail-on-failure), this enables longer dependent sequences.

**Effort:** Low-medium. Refactoring existing scenario helpers.

---

#### 4d. Consensus-Proof Bypass with Real-Proof Spot Checks

**What Rocket Pool has:**
`BeaconStateVerifierMock.sol` can either forward to the real verifier or short-circuit. Proof verification is disabled in execution-path tests, tested directly in `test/util/verifier-tests.js`.

**What SSV has instead:**
Oracle/proof mocking exists in various tests. The pattern is similar but not explicitly separated.

**Gap this fills:**
Minimal for SSV. SSV already uses a similar approach with oracle mocking and direct proof tests. Included for completeness.

---

### 5. Aave V4 → SSV

**Aave V4 maturity:** Advanced | **Stack:** Foundry

#### 5a. Snapshot Sandboxes for "What-If" Branch Exploration

**What Aave has:**
`_getUserAccountData(...)` takes a full EVM snapshot, upgrades a live spoke proxy to a mock, calls extra calculation logic, restores the original, and reverts to snapshot. Enables testing hypothetical paths without rebuilding fixtures.

**What SSV has instead:**
No snapshot/revert sandboxing for temporary state exploration.

**Gap this fills:**
SSV's §14 (Stale Snapshot) scenarios — where you need to capture cluster state at one point, mutate, then try operations with the stale state — would be much easier to write with systematic snapshot/revert sandboxing. Specifically:
- ST-01 through ST-08 all require "capture state → mutate → retry with old state" flows
- A `withSnapshot()` utility that saves state, runs a mutation, captures the result, and reverts would make these trivial

**Effort:** Low. Pattern-level adoption in existing tests.

---

#### 5b. Layered Full-Protocol Fixture Hierarchy

**What Aave has:**
`tests/Base.t.sol` deploys the full environment (access manager, hub proxy, spoke proxies, treasury, rates, tokens, roles, balances). Specialized base contracts per subsystem (`SpokeBase.t.sol`, `HubBase.t.sol`).

**What SSV has instead:**
`test/setup/fixtures.ts` provides shared deployment. Module-specific harnesses exist in `contracts/test/harness/`. The pattern is similar.

**Gap this fills:**
Minimal. SSV's fixture architecture is comparable. The main difference is that Aave's hierarchy is Foundry-native, which becomes relevant only if SSV adopts Foundry tests.

---

#### 5c. Injected Reentrancy Adversary Mocks

**What Aave has:**
`MockReentrantCaller.sol` with `vm.mockFunction(...)` redirects internal calls into an attacker contract, simulating reentrancy from specific downstream integration points.

**What SSV has instead:**
`SSVReentrancyGuard.sol` abstract contract. Reentrancy tests exist (`test/unit/reentrancy.ts`).

**Gap this fills:**
If SSV's reentrancy tests only test external re-entry, Aave's `mockFunction` approach could test re-entry from internal callback points (e.g., during token transfers within liquidation bounty payouts). This is a narrow but real gap for the ETH-handling paths.

**Effort:** Low-medium.

---

#### 5d. SMT-Backed Property Proof Scripts (Z3)

**What Aave has:**
`tests/misc/z3/liquidation_logic.py` and `tests/misc/z3/max_withdraw_property.py` encode algebraic safety properties.

**What SSV has instead:**
No formal verification or SMT-backed proofs.

**Gap this fills:**
SSV's vUnit math (especially the packed-type operations in `PackedLib`) could benefit from Z3 proofs for overflow safety and conservation properties. However, this is high-effort and lower priority than the testing improvements above.

**Effort:** High. Requires formal methods expertise.

**Priority:** Low for mainnet readiness. High for long-term confidence.

---

## Consolidated Technique Matrix

| # | Technique | Source | SSV Has? | Impact on Gap Coverage | Effort | Priority |
|---|-----------|--------|----------|----------------------|--------|----------|
| 1 | Handler-based Foundry invariant testing | Lido | No | §7, §9, §13 combinatorial gaps (20+ scenarios) | Med-high | **P0** |
| 2 | `SSVFuzzers.sol` bounding library | Uni v4 | No | Prerequisite for #1; standalone value for Echidna | Low-med | **P0** |
| 3 | Global `afterEach` invariant sweep (TS) | CSM + Rocket Pool | Partial | Upgrades all 126+ existing tests with zero new scenarios | Low | **P0** |
| 4 | Naive reference implementation (TS or Sol) | Lido | No | §11 precision gaps (P-02, P-03, P-05); oracle for all assertions | Med | **P1** |
| 5 | V(N)→V(N+1) migration differential fuzz | Uni v4 | No | §6 migration gaps (M-06, M-07) | Med-high | **P1** |
| 6 | Snapshot sandboxes for stale-state tests | Aave V4 | No | §14 stale snapshot gaps (ST-01 through ST-08) | Low | **P1** |
| 7 | Nested snapshot fixture tree | Rocket Pool | No | Reduces setup cost for combinatorial scenarios | Low-med | **P2** |
| 8 | Tiered Foundry fuzz profiles | Uni v4 | No | CI economics for Foundry adoption | Very low | **P2** |
| 9 | `brutalizeMemory` modifier | CSM | No | PackedLib memory safety | Very low | **P2** |
| 10 | Storage slot backward-compat assertions | CSM | No | Diamond storage upgrade safety | Low-med | **P2** |
| 11 | Bail-on-failure sequential chains | Lido | No | Longer dependent scenario chains | Very low | **P2** |
| 12 | Custom Chai rounding assertions | Lido | No | Cleaner dust/precision assertions | Very low | **P2** |
| 13 | Conditional invariant gating (CI-only) | CSM | No | Dev speed when using #3 | Very low | **P2** |
| 14 | Multi-fork upgrade state comparison | CSM | No | v2.0.0 upgrade verification | Med | **P3** |
| 15 | FFI cross-language reference oracle | Uni v4 | No | Cross-language differential at fuzz scale | Med | **P3** |
| 16 | Boundary-value Echidna harnesses | Uni v4 | Partial | Packed-type overflow/underflow | Low-med | **P3** |
| 17 | Injected reentrancy from internal calls | Aave V4 | Partial | ETH-handling callback reentrancy | Low-med | **P3** |
| 18 | Z3/SMT property proofs | Aave V4 | No | Formal overflow/conservation proofs | High | **P4** |

---

## Recommended Adoption Plan

### Phase 1 — Immediate Wins (Week 1)

**Goal:** Upgrade every existing test with automatic invariant checking + prepare fuzz infrastructure.

| Task | Technique | Deliverable |
|------|-----------|-------------|
| Global invariant sweep | #3 (CSM + Rocket Pool) | `afterEach` hook in test setup calling existing `test/helpers/invariants.ts` helpers. Mark intentionally-broken-state tests as exempt. |
| Conditional gating | #13 (CSM) | `skipExpensiveInvariants()` check on `process.env.CI` for the expensive walks. |
| Bail-on-failure | #11 (Lido) | `bailOnFailure()` utility for e2e chains. |
| Custom Chai assertion | #12 (Lido) | `equalWithPrecision(expected, digits)` for dust-tolerant comparisons. |

**Expected coverage gain:** All 126 staking tests + all e2e tests gain DAO/vUnit/conservation invariant checking. Catches drift bugs in tests that currently only check local state.

### Phase 2 — Foundry Handler Infrastructure (Weeks 2-3)

**Goal:** Build the handler-based invariant testing foundation that mechanically explores combinatorial state space.

| Task | Technique | Deliverable |
|------|-----------|-------------|
| `SSVFuzzers.sol` | #2 (Uni v4) | Bounding library for cluster sizes, EB ranges, operator fees, withdrawal amounts. |
| `ClusterHandler.sol` | #1 (Lido) | Handler wrapping all cluster operations with ghost state tracking. |
| Invariant contract | #1 (Lido) | `invariant_daoVUnitsConsistent`, `invariant_operatorVUnitsSumCorrect`, `invariant_noRemovedOperatorDeviation`, `invariant_clusterBalanceConservation`. |
| Fuzz profiles | #8 (Uni v4) | `foundry.toml` profiles: 256 default, 2K PR, 10K CI. |
| `brutalizeMemory` | #9 (CSM) | Applied to PackedLib-touching fuzz tests. |

**Expected coverage gain:** Mechanically explores the §7 (multi-cluster), §9 (DAO invariants), §13 (cluster sizes) combinatorial space. Should surface any remaining operator-removal × EB-update × liquidation/reactivation interaction bugs.

### Phase 3 — Differential & Reference Testing (Weeks 3-4)

**Goal:** Eliminate manual math from assertions; catch precision/implementation bugs.

| Task | Technique | Deliverable |
|------|-----------|-------------|
| TypeScript reference model | #4 (Lido) | `test/helpers/reference-model.ts` with `calculateVUnits`, `calculateSettlement`, `calculateLiquidationThreshold`. |
| Snapshot sandboxes | #6 (Aave) | `withSnapshot()` utility for §14 stale-state tests. |
| Nested snapshot fixtures | #7 (Rocket Pool) | Snapshot branching for combinatorial scenario prefixes. |
| Storage slot assertions | #10 (CSM) | `vm.load()` checks for diamond storage invariants in upgrade tests. |

**Expected coverage gain:** §11 precision gaps, §14 stale-snapshot gaps, reduced test setup overhead for remaining §5/§6 gaps.

### Phase 4 — Advanced Differential (Weeks 4-6)

**Goal:** Migration differential fuzzing and cross-language validation.

| Task | Technique | Deliverable |
|------|-----------|-------------|
| Migration differential fuzz | #5 (Uni v4) | Deploy legacy SSV from artifacts, fuzz operations, migrate, assert against reference model. |
| FFI bridge (optional) | #15 (Uni v4) | TypeScript reference callable from Foundry fuzz tests. |
| Boundary-value Echidna | #16 (Uni v4) | Echidna harness initialized near max EB × max validators × max operators. |

**Expected coverage gain:** §6 migration gaps (M-06, M-07), cross-language validation at fuzz scale.

---

## Scenario Gap → Technique Mapping

This section maps each gap category from VUNITS-SCENARIOS.md to the technique(s) that would cover it.

| Gap Category | Gap IDs | Best Technique | Why |
|-------------|---------|---------------|-----|
| Multi-cluster shared-operator | MC-02, MC-06, MC-07, MC-08, MC-10 | #1 Handler invariants | Fuzzer discovers multi-cluster interaction sequences |
| Multi-cluster liquidation | MC-03, MC-04 | #1 Handler invariants | Ghost state tracks per-cluster deviation |
| DAO vUnit consistency | D-06, D-07 | #1 Handler invariants + #3 afterEach sweep | Global invariant checked after every step |
| Migration post-sequences | M-06, M-07 | #5 Migration differential fuzz | Fuzz explores post-migration paths |
| Precision/rounding | P-02, P-03, P-05 | #4 Reference model | Cross-implementation comparison |
| Cluster size variations | CS-01 to CS-08, CS-22 to CS-27, CS-30 to CS-34 | #1 Handler invariants + #2 SSVFuzzers.sol | `boundClusterSize()` ensures all sizes are explored |
| Stale snapshot replay | ST-02 to ST-08 | #6 Snapshot sandboxes | `withSnapshot()` utility makes capture-mutate-retry trivial |
| Fee change + EB interactions | F-02, F-03, F-05, F-06, F-07, F-08 | #1 Handler invariants | Fuzzer explores fee-change × EB-update orderings |
| Liquidation cycle combinations | L-05, L-06, L-07 | #1 Handler invariants + #7 Nested snapshots | Combinatorial branching from shared liquidation prefix |
| Edge case boundaries | EC-01, EC-10 | #16 Boundary-value Echidna | Initialize near extremes, let fuzzer find paths |

---

## Summary

SSV's test infrastructure is already very advanced. The highest-leverage improvements are not about adding more hand-written scenarios — they're about adopting **mechanical state-space exploration** techniques that other top-tier protocols use:

1. **Handler-based Foundry invariants** (from Lido) let the fuzzer discover action sequences you haven't thought of
2. **Domain-specific fuzz bounding** (from Uni v4) ensures the fuzzer explores valid SSV state space efficiently
3. **Global invariant sweeps** (from CSM + Rocket Pool) upgrade every existing test into a stronger consistency check
4. **Reference implementations** (from Lido) eliminate manual math and catch precision bugs

These four techniques, adopted in the order above, would mechanically cover the majority of the ~45 gaps and partial-gaps in VUNITS-SCENARIOS.md while simultaneously discovering scenarios that aren't in the catalog at all.
