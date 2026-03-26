# Utility Layer PoC — Implementation Plan

## Context

SSV Network's test suite is already very advanced (Hardhat+Mocha+Echidna+Monte Carlo), but scenario discovery is bounded by manual ideation. After comparing 5 major DeFi protocols' test strategies, 4 improvements were identified that mechanically expand reachable state space without adding a new test framework:

1. **Bounded parameter generators** — transform seeds into protocol-valid parameters
2. **TypeScript reference model** — independent accounting oracle for assertions
3. **Global afterEach invariant sweep** — automatic property checking on every test
4. **Coverage-guided state tags** — track which (state, action) combos the simulation has explored

The PoC delivers working implementations of all 4, integrated into the existing Hardhat stack, with a pilot test demonstrating them together.

---

## Deliverables

| # | File | Purpose |
|---|------|---------|
| 1 | `test/helpers/generators.ts` | Bounded parameter generators for 9 scenario axes |
| 2 | `test/helpers/reference-model.ts` | Pure-function accounting oracle (builds on fee.ts) |
| 3 | `test/helpers/invariant-sweep.ts` | Lightweight invariant pack for afterEach |
| 4 | `test/hooks/invariant-sweep-hook.ts` | Mocha root hook plugin wiring |
| 5 | `test/simulation/coverage-tracker.ts` | State tags + coverage reporting for simulation |
| 6 | `test/e2e/pilot-utility-layer.test.ts` | Pilot test demonstrating all 3 components together |
| 7 | `hardhat.config.ts` | Single-line mocha `require` addition |
| 8 | `test/helpers/index.ts` | Re-export new modules |

---

## File 1: `test/helpers/generators.ts`

**Reuses:** `test/common/constants.ts` (all protocol constants)

Pure functions that transform `seed: bigint` into protocol-valid parameters. Never rejects — always clamps/modulates.

### Functions

```typescript
// Cluster size: picks from [4, 7, 10, 13]
genClusterSize(seed: bigint): number

// EB per validator: maps into [32, 64, 128, 256, 512, 1024, 2048] ETH
genEffectiveBalancePerValidator(seed: bigint): bigint

// Continuous EB range: [32*valCount, 2048*valCount]
genEffectiveBalanceRange(seed: bigint, validatorCount: bigint): bigint

// Operator fee: within governance bounds, rounded to ETH_DEDUCTED_DIGITS
genOperatorFee(seed: bigint, constraints?: { minFee?, maxFee?, precision? }): bigint

// Withdrawal: [1, balance - liquidationThreshold]
genWithdrawalAmount(seed: bigint, clusterBalance: bigint, liquidationThreshold: bigint): bigint

// Unsafe withdrawal: would cause liquidation (for edge case testing)
genUnsafeWithdrawalAmount(seed: bigint, clusterBalance: bigint, liquidationThreshold: bigint): bigint

// Block advancement: 'same'|'short'|'long'|'threshold' categories
genBlockAdvancement(seed: bigint, category?: string): bigint

// Operator removal: deterministic subset selection (none/one/many/all)
genOperatorRemovalSubset(seed: bigint, operatorIds: bigint[]): bigint[]

// Fee declare timing: before-window / in-window / after-window
genFeeDeclareTiming(seed: bigint): { blocksAfterDeclare: bigint; category: string }

// Staking: 'minimum'|'normal'|'large'|'precision-boundary'
genStakingAmount(seed: bigint, category?: string): bigint

// Deposit: guaranteed to pass liquidation check
genDepositAmount(seed: bigint, operatorFees: bigint[], networkFee: bigint, vUnits: bigint, minBlocks: bigint): bigint
```

### Design

- Each generator uses `seed % N` to pick a bucket, `seed / BigInt(N)` for within-bucket value
- Fee values are rounded to precision multiples to avoid `MaxPrecisionExceeded`
- Internal helper: `clampBigInt(value, min, max)`

---

## File 2: `test/helpers/reference-model.ts`

**Reuses:** `test/helpers/fee.ts` (all existing calc functions), `test/common/constants.ts`

Independent TypeScript reimplementation of all accounting math as pure functions. Key insight from Solidity verification: the on-chain `updateBalanceWithEB` does two **separate** truncating divisions before adding:

```solidity
// ClusterLib.sol:317-319 — TWO separate divisions, not one combined
networkFeeUnits = (idxNet * units) / BPS_DENOMINATOR;       // truncates
usageUnits = (idxOp * units) / BPS_DENOMINATOR + networkFeeUnits;  // truncates, then adds
usage = usageUnits * ETH_DEDUCTED_DIGITS;
```

The reference model must replicate this exactly.

### Core settlement functions

```typescript
// Mirrors ClusterLib.updateBalanceWithEB exactly (two separate divisions)
settleETHClusterFees(
  cluster: Cluster,
  newClusterIndex: bigint,
  currentNetworkFeeIndex: bigint,
  vUnits: bigint,
): { updatedCluster: Cluster; totalFees: bigint }

// Mirrors ClusterLib.updateBalanceSSV
settleSSVClusterFees(
  cluster: Cluster,
  newClusterIndex: bigint,
  currentNetworkFeeIndex: bigint,
): { updatedCluster: Cluster; totalFees: bigint }
```

### Index computation helpers

```typescript
// Sum of (snapshot.index + blockDiff * fee) for each operator
computeClusterIndex(operatorSnapshots: OperatorSnapshot[], currentBlock: bigint): bigint

// storedIndex + (currentBlock - storedBlock) * networkFeeRaw
computeNetworkFeeIndex(storedIndex, storedBlock, currentBlock, networkFeeRaw): bigint
```

### High-level cluster predictions

```typescript
predictClusterAfterDeposit(cluster, depositAmount, newClusterIndex, currentNetworkFeeIndex, vUnits): PredictedCluster
predictClusterAfterWithdrawal(cluster, withdrawAmount, newClusterIndex, currentNetworkFeeIndex, vUnits): PredictedCluster
predictClusterAfterRegisterValidator(cluster, depositAmount, newClusterIndex, currentNetworkFeeIndex, vUnits, valCountDelta): PredictedCluster
predictClusterAfterRemoveValidator(cluster, newClusterIndex, currentNetworkFeeIndex, vUnits, valCountDelta): PredictedCluster
predictClusterAfterLiquidation(cluster, newClusterIndex, currentNetworkFeeIndex, vUnits): { cluster, bounty }
predictMigrationResult(ssvCluster, ssvClusterIndex, ssvNetworkFeeIndex, ethDeposit, ethClusterIndex, ethNetworkFeeIndex): MigrationResult
```

### Liquidation & EB helpers

```typescript
isLiquidatable(clusterBalance, vUnits, burnRate, networkFee, minBlocks, minCollateral): boolean
ebToVUnits(effectiveBalanceETH: bigint): bigint  // ceiling: (eb * BPS - 1) / 32 + 1 when > 0
vUnitsToEB(vUnits: bigint): bigint               // floor: (vUnits * 32) / BPS
predictVUnitsAfterEBUpdate(currentVUnits, newEB, validatorCount): { newVUnits, deviation }
```

### Staking & packing

```typescript
predictAccEthPerShareAfterFees(currentAcc, newFeesWei, totalCSSVSupply): bigint
predictStakerReward(cSSVBalance, accEthPerShare, userIndex): bigint
packETH(value): bigint   // value / ETH_DEDUCTED_DIGITS
unpackETH(raw): bigint   // raw * ETH_DEDUCTED_DIGITS
packSSV(value): bigint   // value / DEDUCTED_DIGITS
unpackSSV(raw): bigint   // raw * DEDUCTED_DIGITS
```

---

## File 3: `test/helpers/invariant-sweep.ts`

Lightweight invariant checks that run after ANY test. Reads only from chain via view calls. No pre-tracked state required.

### SweepConfig (passed in at registration)
```typescript
{ views: any | null, cssvToken: any | null, provider: any, networkAddress: string | null }
```

### SweepState (persists across tests, managed by hook)
```typescript
{ prevAccEthPerShare: bigint, prevLatestCommittedBlock: bigint, isFirstRun: boolean }
```

### Checks (all Promise.all'd, ~50-100ms total)

| ID | Check | Notes |
|----|-------|-------|
| SWEEP-1 | Contract ETH balance >= 0 | Structural health |
| SWEEP-2 | accEthPerShare monotonically non-decreasing | Skips on first run; re-baselines if loadFixture reset detected |
| SWEEP-3 | Views contract accessible | `getVersion()` succeeds |
| SWEEP-4 | Network validator count non-negative | Catches underflow |
| SWEEP-5 | cSSV totalSupply non-negative | Catches mint/burn bugs |

### loadFixture handling

When `loadFixture` reverts EVM state, on-chain values jump back. For monotonicity checks (SWEEP-2): if `newValue < state.prevAccEthPerShare`, assume fixture reset and re-baseline (skip check for that test, update stored value to new value).

---

## File 4: `test/hooks/invariant-sweep-hook.ts`

Mocha root hook plugin. Exports `mochaHooks` object with `afterEach`.

```typescript
export function registerSweepConfig(config: SweepConfig): void  // call from test's before()
export function resetSweepState(): void                          // call when loadFixture resets

export const mochaHooks = {
  afterEach: async function() {
    if (process.env.SKIP_INVARIANT_SWEEP === '1') return;
    if (!sweepConfig?.views) return;  // silently skip if no SSV deployed
    const results = await runInvariantSweep(sweepConfig, sweepState);
    for (const r of results) if (!r.passed) throw new Error(`[${r.id}]: ${r.message}`);
  }
};
```

### Wiring in hardhat.config.ts

```typescript
test: {
  mocha: {
    timeout: 300_000,
    require: ['./test/hooks/invariant-sweep-hook.ts'],
  },
},
```

---

## File 5: `test/simulation/coverage-tracker.ts`

**Reuses:** `test/simulation/types.ts` (SimulationState, ClusterRecord)

### State tag axes

| Axis | Values |
|------|--------|
| ClusterSize | 4ops, 7ops, 10ops, 13ops |
| Balance | near-liq, low, medium, high |
| EB | implicit, explicit-32, explicit-high |
| Version | ssv, eth, liquidated |

Total: 4 x 4 x 3 x 3 = 144 state combinations x ~15 core actions = ~2,160 coverage targets.

### CoverageTracker class

```typescript
class CoverageTracker {
  tagCluster(record: ClusterRecord, state: SimulationState): StateTag
  recordAction(state: SimulationState, actionName: string, clusterKey?: string): void
  getUncoveredCombinations(): Array<{ tag: string; action: string }>
  computeCoverageBias(state: SimulationState): Record<string, number>
  formatReport(): string
  get coveragePercent(): number
}
```

### Integration into simulation loop

The monte-carlo.test.ts loop calls `tracker.recordAction(state, actionName, result.clusterKeyUpdated)` after each action. At simulation end, `tracker.formatReport()` is printed. No changes to `WeightedActionSelector` needed — the bias map is applied by the caller multiplying base weights.

---

## File 6: Pilot Test — `test/e2e/pilot-utility-layer.test.ts`

Demonstrates all 3 components working together on real cluster operations.

### Structure

```typescript
describe("Utility Layer PoC Pilot", () => {
  before(async () => {
    // Deploy SSVNetwork full fixture
    // registerSweepConfig({ views, cssvToken, provider, networkAddress })
  });

  describe("Generator + Reference Model: deposit()", () => {
    const seeds = [1n, 42n, 100n, 999n, 12345n];
    for (const seed of seeds) {
      it(`deposit with generated params (seed=${seed})`, async () => {
        // 1. genClusterSize, genDepositAmount, genBlockAdvancement
        // 2. Setup cluster with generated params
        // 3. predictClusterAfterDeposit → expected
        // 4. Execute on-chain deposit
        // 5. Assert on-chain result matches prediction
        // 6. afterEach sweep runs automatically
      });
    }
  });

  describe("Reference Model: withdraw()", () => {
    // Similar: genWithdrawalAmount + predictClusterAfterWithdrawal
  });

  describe("Reference Model: liquidation check", () => {
    // genBlockAdvancement('threshold') + isLiquidatable prediction
  });

  describe("Generator: operator fee governance timing", () => {
    // genFeeDeclareTiming → test in-window/before-window/after-window
  });
});
```

---

## File 7: `hardhat.config.ts` change

Single line addition at line 97:

```diff
  test: {
    mocha: {
      timeout: 300_000,
+     require: ['./test/hooks/invariant-sweep-hook.ts'],
    },
  },
```

---

## File 8: `test/helpers/index.ts` update

Add re-exports for new modules:

```typescript
export * from './generators.ts';
export * from './reference-model.ts';
export { registerSweepConfig, resetSweepState } from '../hooks/invariant-sweep-hook.ts';
```

---

## Implementation Order

| Phase | Files | Dependencies | Parallel? |
|-------|-------|-------------|-----------|
| 1a | generators.ts | constants only | Yes |
| 1b | reference-model.ts | fee.ts + constants | Yes |
| 1c | invariant-sweep.ts | constants only | Yes |
| 2a | invariant-sweep-hook.ts | invariant-sweep.ts | After 1c |
| 2b | coverage-tracker.ts | simulation/types.ts | After 1a |
| 3 | hardhat.config.ts + index.ts | After 2a |
| 4 | pilot-utility-layer.test.ts | After all above |

Phase 1 files are all independent pure-function modules — can be written in parallel.

---

## Verification

1. **Generators**: Write 3-5 property tests asserting output is always within valid protocol bounds for 1000 random seeds
2. **Reference model**: Validate `settleETHClusterFees` matches on-chain behavior for known test scenarios (reuse values from existing passing e2e tests)
3. **Invariant sweep**: Run `just test-unit` with sweep enabled — all existing tests must still pass. Measure overhead (target < 100ms/test avg)
4. **Coverage tracker**: Run short simulation (100 blocks), verify coverage report shows non-zero coverage and identifies uncovered combinations
5. **Pilot test**: `npx hardhat test test/e2e/pilot-utility-layer.test.ts` — all tests pass, afterEach sweep runs visibly (check with `SKIP_INVARIANT_SWEEP=0`)

### Smoke test sequence
```bash
# 1. Compile
just build

# 2. Run pilot test in isolation
npx hardhat test test/e2e/pilot-utility-layer.test.ts

# 3. Run full unit suite with sweep enabled (check no regressions)
just test-unit

# 4. Run with sweep disabled (measure baseline timing)
SKIP_INVARIANT_SWEEP=1 just test-unit

# 5. Compare timing — sweep overhead should be < 10%
```

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Reference model doesn't exactly match Solidity truncation | False test failures | Verified the exact two-division pattern from ClusterLib.sol:317-319. Pilot test validates against on-chain results. |
| Mocha root hook loading with Hardhat V3 | Sweep doesn't activate | Test with single file first. Fallback: add `--require` flag to Justfile commands. |
| loadFixture reverts invalidate monotonicity | False sweep failures | Re-baseline when value decreases (treat as fixture reset). |
| Performance overhead > 10% | Slow CI | 5 parallel RPC calls ~50-100ms. Budget is ~30s on 300s suite. `SKIP_INVARIANT_SWEEP=1` opt-out. |
| Coverage tracker combinatorial explosion | Noise in reporting | Keep axes coarse (max 4 values each). 2,160 total combinations is manageable. |

---

## Critical Files to Read/Modify

| File | Action |
|------|--------|
| `test/helpers/fee.ts` | READ — foundation for reference model |
| `test/common/constants.ts` | READ — all protocol constants |
| `contracts/libraries/ClusterLib.sol:306-321` | READ — exact settlement math to replicate |
| `contracts/libraries/ClusterLib.sol:366-371` | READ — ebToVUnits ceiling division |
| `test/simulation/types.ts` | READ — types for coverage tracker |
| `test/simulation/actions/index.ts` | READ — action names for coverage tracker |
| `hardhat.config.ts:95-99` | MODIFY — add mocha require |
| `test/helpers/index.ts` | MODIFY — add re-exports |
