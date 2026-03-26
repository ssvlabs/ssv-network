# Uniswap v4-Core — Test Strategy Analysis

## Overview

Uniswap v4-core has one of the most sophisticated test infrastructures in DeFi. It combines Foundry unit/fuzz testing, Echidna stateful property testing, FFI-based cross-language validation, differential testing against the deployed V3 codebase, and gas regression tracking — all with tiered fuzz depth across development stages.

The repo contains ~48 Solidity test files under `test/` and ~30 test support contracts under `src/test/`, split across library-level unit tests, full integration tests, differential fuzz suites, Echidna property contracts, and gas-snapshotted scenario tests.

**Framework:** Foundry (forge-std) + Echidna
**Solidity:** 0.8.26, EVM target: Cancun
**Maturity:** Very Advanced

---

## Detected Test Types

| Type | Status | Evidence |
|------|--------|----------|
| Unit | **Present** | `test/libraries/*.t.sol` — 18 library-level test files (TickMath, BitMath, FullMath, SqrtPriceMath, SafeCast, etc.) |
| Integration | **Present** | `test/PoolManager.t.sol`, `test/PoolManagerInitialize.t.sol`, `test/CustomAccounting.t.sol`, `test/Sync.t.sol` — full lifecycle tests through PoolManager |
| Fork | **Not found** | No fork test files, no mainnet RPC configuration, no `vm.createSelectFork` usage |
| Fuzz | **Present** | Pervasive across the suite. `Fuzzers.sol` helper, inline `forge-config` overrides, 3 Echidna test contracts, V3 differential fuzz |
| Invariant | **Present** | 3 Echidna property contracts: `TickMathEchidnaTest.sol`, `SqrtPriceMathEchidnaTest.sol`, `TickOverflowSafetyEchidnaTest.sol` |
| Scenario | **Present** | Hook-based scenario tests: `CustomAccounting.t.sol`, `DynamicFees.t.sol`, `DynamicReturnFees.t.sol`, `SkipCallsTestHook.t.sol` |
| Differential | **Present** | `test/PoolManager.swap.t.sol` — V3Fuzzer deploys V3 factory from bytecode and compares swap outputs; `ModifyLiquidity.t.sol` compares against JS reference |
| Regression | **Maybe** | Gas snapshots in `snapshots/` (20 JSON files) serve as regression guards; no dedicated regression test directory |
| Upgrade | **Not found** | v4-core is a non-upgradeable singleton — no proxy upgrade tests needed |
| Gas | **Present** | `vm.snapshotGasLastCall()` and `vm.snapshotValue()` across all major test files; 20 JSON snapshot files in `snapshots/`; CI enforces `FORGE_SNAPSHOT_CHECK=true` |

---

## Advanced Testing Techniques

### 1. FFI Cross-Language Oracle Validation (High Complexity, Reusable)

**Files:** `test/utils/JavascriptFfi.sol`, `test/js-scripts/src/*.ts`, `test/ModifyLiquidity.t.sol`, `test/libraries/TickMath.t.sol`

The repo runs JavaScript/TypeScript implementations of core math functions as an independent oracle via Foundry's FFI. The `JavascriptFfi.sol` contract calls `npm run` scripts that execute TypeScript computations and return ABI-encoded results.

```
Solidity test → vm.ffi() → npm run script → TypeScript math → ABI-encoded result → assertion
```

This is used for:
- **TickMath validation:** `getSqrtPriceAtTick` and `getTickAtSqrtPrice` compared against TS implementation
- **ModifyLiquidity validation:** Liquidity delta calculations cross-checked with JS reference

The pattern allows testing against a mathematically independent implementation, catching Solidity-specific precision or overflow bugs that would be invisible to same-language tests.

**Reusable idea:** Any protocol with complex fixed-point math can maintain a JS/Python reference implementation and validate the Solidity version via FFI.

### 2. V3-vs-V4 Differential Fuzzing (High Complexity, Reusable)

**Files:** `test/PoolManager.swap.t.sol` (V3Fuzzer, V3SwapTests), `test/utils/V3Helper.sol`

The `V3Fuzzer` abstract contract deploys the actual Uniswap V3 factory from stored bytecode (`test/bin/v3Factory.bytecode`), creates identical pools in both V3 and V4, performs the same operations on both, and asserts the deltas match exactly (diff == 0).

```solidity
// V3Helper.sol — deploys real V3 factory from bytecode
bytes memory bytecode = vm.readFileBinary("test/bin/v3Factory.bytecode");
assembly { deployedAddr := create(0, add(bytecode, 0x20), mload(bytecode)) }
```

The `V3SwapTests` contract fuzzes:
- Pool parameters (fee, tick spacing, sqrtPrice)
- Liquidity positions (single and multiple)
- Swap parameters (amount, direction)

And asserts `amount0Diff == 0 && amount1Diff == 0` — perfect behavioral equivalence.

**Reusable idea:** When building a V(N+1), deploy V(N) from bytecode and fuzz-compare. This catches subtle behavioral regressions across protocol versions.

### 3. Bounded Fuzz Parameter Generation Library (Medium Complexity, Reusable)

**File:** `src/test/Fuzzers.sol`

Rather than letting the fuzzer waste runs on invalid inputs (which `vm.assume` would reject), the `Fuzzers` contract provides domain-aware bounding functions:

| Function | Purpose |
|----------|---------|
| `boundTicks()` | Rounds to tick spacing, ensures lower < upper, handles min/max boundaries |
| `boundLiquidityDelta()` | Caps to `tickSpacingToMaxLiquidityPerTick` and amount-based maximum |
| `boundLiquidityDeltaTightly()` | Stricter bound for multi-position tests (divides by maxPositions) |
| `createFuzzyLiquidityParams()` | Composes tick bounding + liquidity bounding into valid parameters |
| `createRandomSqrtPriceX96()` | Generates valid price from random tick seed |

This library is inherited by test contracts (e.g., `ModifyLiquidityTest is Fuzzers`) and dramatically improves fuzz efficiency by ensuring every generated input is protocol-valid.

**Reusable idea:** Build a domain-specific `Fuzzers.sol` for any protocol with constrained input spaces.

### 4. Echidna Stateful Property Contracts (High Complexity)

**Files:** `src/test/TickMathEchidnaTest.sol`, `src/test/SqrtPriceMathEchidnaTest.sol`, `src/test/TickOverflowSafetyEchidnaTest.sol`

Three dedicated Echidna property contracts test deep mathematical invariants:

**TickMathEchidnaTest** — Validates monotonicity and bounds:
```solidity
assert(getSqrtPriceAtTick(tick - 1) < price && price < getSqrtPriceAtTick(tick + 1)); // monotonic
assert(price >= MIN_SQRT_PRICE && price <= MAX_SQRT_PRICE); // bounded
```

**SqrtPriceMathEchidnaTest** — 9 property functions covering:
- `mulDivRoundingUp` rounding correctness (diff < 2, modular arithmetic check)
- `getNextSqrtPriceFromInput/Output` directional invariants
- `getAmount0/1Delta` symmetry (commutativity of args) and rounding direction
- `getAmount0DeltaEquivalency` — asserts chained division equals full-precision computation
- In-range and out-of-range mint invariants

**TickOverflowSafetyEchidnaTest** — A *stateful* Echidna contract that:
- Maintains a `Pool.State` with tick positions and liquidity
- Initializes `feeGrowthGlobal` at `type(uint256).max / 2` (half the overflow boundary)
- Provides `setPosition()`, `moveToTick()`, `increaseFeeGrowthGlobal()` as callable functions
- Echidna can sequence these calls to find overflow conditions during tick crossing

This is the most sophisticated invariant pattern in the repo — it models real pool state transitions and targets the fee growth overflow edge case.

### 5. Gas Snapshot Regression System (Medium Complexity, Reusable)

**Directory:** `snapshots/` (20 JSON files)

The repo uses `vm.snapshotGasLastCall("snapshot name")` to record gas costs for critical operations. Snapshots are stored as JSON:

```json
{
  "simple addLiquidity": "161276",
  "swap with hooks": "132165",
  "poolManager bytecode size": "24009"
}
```

CI enforces `FORGE_SNAPSHOT_CHECK=true`, which fails the build if gas costs change. This prevents unintentional performance regressions.

**Coverage:** Pool initialization, swap (various configurations), liquidity operations, hook calls, claims, donations, protocol fees, bytecode size.

### 6. Callback Router Test Contracts (Medium Complexity, Reusable)

**Files:** `src/test/PoolSwapTest.sol`, `src/test/PoolModifyLiquidityTest.sol`, `src/test/PoolDonateTest.sol`, `src/test/PoolTakeTest.sol`, `src/test/PoolClaimsTest.sol`, `src/test/ActionsRouter.sol`, `src/test/PoolNestedActionsTest.sol`

v4-core's unlock/callback pattern requires all pool operations to happen inside a callback. Rather than repeating callback boilerplate in every test, the repo provides dedicated router contracts that:
- Accept test parameters
- Call `manager.unlock()` with encoded action data
- Execute the requested operation inside `unlockCallback()`
- Return deltas to the test

The `ActionsRouter` is a generic version that accepts a sequence of `Actions` enum values and executes them in order — enabling complex multi-step scenarios without new contracts.

### 7. Hook Permutation Testing (Medium Complexity)

**Files:** `test/SkipCallsTestHook.t.sol`, `test/CustomAccounting.t.sol`, various hook implementations in `src/test/`

Hooks are deployed to specific addresses using `vm.etch()` to match their permission bitmask. The test suite covers:
- Custom pricing curves (1:1 linear curve via `CustomCurveHook`)
- Dynamic fee overrides (`DynamicFeesTestHook`, `DynamicReturnFeeTestHook`)
- Fee-taking hooks (`FeeTakingHook`, `LPFeeTakingHook`)
- Delta modification hooks (`DeltaReturningHook`)
- No-op/skip hooks (`SkipCallsTestHook`)

This creates scenario-level coverage of the entire hook API surface.

### 8. Tiered Fuzz Profiles (Low Complexity, Reusable)

**File:** `foundry.toml`

```toml
[profile.default.fuzz] runs = 1000, seed = '0x4444'
[profile.pr.fuzz]      runs = 10000
[profile.ci.fuzz]       runs = 100000
[profile.debug.fuzz]   runs = 100
```

Plus inline per-test overrides:
```solidity
/// forge-config: default.fuzz.runs = 10
/// forge-config: ci.fuzz.runs = 500
function test_ffi_fuzz_addLiquidity(...) public { ... }
```

This balances developer iteration speed (100-1000 runs) with merge-gate confidence (100K runs). FFI-heavy tests use lower counts even in CI (500) due to performance cost.

---

## Complexity Management Patterns

### Fuzz Complexity

The primary complexity management tool is `Fuzzers.sol`, which transforms raw fuzzed inputs into protocol-valid parameters. This is complemented by:

1. **`vm.assume()` avoidance** — Instead of rejecting invalid inputs, the bounding functions transform them into valid ones, preserving fuzz throughput.
2. **Tight bounding for multi-position tests** — `boundLiquidityDeltaTightly()` divides the max liquidity by the number of positions to prevent tick overflow.
3. **`Logger.sol`** — Logs unbounded parameters before bounding, making fuzz failures reproducible.
4. **Deterministic seed** — `seed = '0x4444'` ensures local reproducibility across dev machines.

### Invariant Complexity

Echidna invariants are structured as standalone contracts (no base class, no Foundry dependencies) with:
- `assert()`-based properties (not `vm.expectRevert`)
- `require()` for preconditions (not `vm.assume`)
- Stateful contracts that maintain their own pool state for sequence-dependent properties

The `TickOverflowSafetyEchidnaTest` is notably sophisticated: it initializes fee growth at `type(uint256).max / 2` and provides functions that Echidna can call in any sequence to trigger overflows.

### Integration Complexity

The callback router pattern (`src/test/Pool*Test.sol` contracts) is the primary abstraction for managing the complexity of v4's unlock/callback architecture. Each router handles one operation type, and tests compose them:

```
Test contract → deploys routers in setUp()
             → calls router.swap() / router.modifyLiquidity()
             → router handles unlock callback internally
             → test asserts on returned deltas
```

---

## Key Files

| File | Role |
|------|------|
| `test/utils/Deployers.sol` | Base test contract: deploys PoolManager, all routers, tokens, and provides pool initialization helpers |
| `src/test/Fuzzers.sol` | Domain-aware fuzz parameter bounding library |
| `test/utils/JavascriptFfi.sol` | FFI bridge to JavaScript reference implementations |
| `test/utils/V3Helper.sol` | Deploys V3 factory from bytecode for differential testing |
| `test/PoolManager.swap.t.sol` | Differential fuzz tests (V3 vs V4) |
| `test/ModifyLiquidity.t.sol` | FFI-validated liquidity math fuzz tests |
| `src/test/TickMathEchidnaTest.sol` | Echidna property: tick↔price monotonicity and bounds |
| `src/test/SqrtPriceMathEchidnaTest.sol` | Echidna property: 9 sqrtPriceMath invariants |
| `src/test/TickOverflowSafetyEchidnaTest.sol` | Echidna stateful: fee growth overflow during tick crossing |
| `test/CustomAccounting.t.sol` | Hook-based custom accounting scenarios |
| `test/utils/Constants.sol` | Pre-computed sqrt price constants and test parameters |
| `foundry.toml` | Tiered fuzz profiles (default/pr/ci/debug) |
| `echidna.config.yml` | Echidna configuration (mostly defaults, checkAsserts enabled) |
| `snapshots/*.json` | 20 gas snapshot files for regression tracking |
| `.github/workflows/tests-pr.yml` | PR CI: 10K fuzz runs, snapshot enforcement |
| `.github/workflows/tests-merge.yml` | Merge CI: 100K fuzz runs |

---

## Final Assessment

**Maturity Level: Very Advanced**

Uniswap v4-core's testing strategy is one of the most thorough in DeFi, distinguished by:

1. **Multi-oracle validation** — Tests validate Solidity math against both JavaScript (FFI) and the deployed V3 codebase (bytecode-level differential testing). This two-oracle approach catches bugs that single-implementation testing cannot.

2. **Deep mathematical property testing** — The Echidna contracts don't just fuzz random inputs; they encode real mathematical invariants (monotonicity, commutativity, rounding direction, overflow safety) with stateful exploration of fee growth edge cases.

3. **Practical fuzz efficiency** — `Fuzzers.sol` demonstrates that domain-aware input generation is more effective than brute-force fuzzing with `vm.assume()` rejections. The tiered profile system (100→100K runs) shows mature CI economics.

4. **Gas regression infrastructure** — 20 snapshot files with CI enforcement make performance a first-class testing concern.

**Notable gaps** are the absence of fork testing (acceptable for a non-upgradeable singleton), no Forge-native handler-based invariant testing (all invariants use Echidna), and no upgrade tests (not applicable to v4-core's architecture).

**Most reusable patterns for other protocols:**
- `Fuzzers.sol` — domain-specific parameter bounding library
- FFI-based reference oracle validation
- Differential fuzzing against prior protocol version bytecode
- Tiered fuzz profiles with per-test overrides
- Gas snapshot regression tracking via CI
