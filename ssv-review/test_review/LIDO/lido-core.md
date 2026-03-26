# Lido Core — Test Strategy Analysis

## Overview

Lido Core (`lido-on-ethereum` v3.0.1) is the largest Ethereum liquid staking protocol. Its test suite is one of the most sophisticated in DeFi, spanning **142 test files** across two frameworks (Hardhat + Foundry), three integration modes (scratch, mainnet fork, upgrade simulation), and a rich library of handler-based invariant tests. The repo serves multiple Solidity compiler versions (0.4.24, 0.6.12, 0.8.9, 0.8.25) and includes deeply structured protocol context management for integration tests.

## Frameworks & Stack

| Component | Technology |
|---|---|
| Primary test runner | Hardhat 2.26.1 + Mocha + Chai |
| Secondary (Solidity) | Foundry (forge-std) |
| Language | TypeScript (.test.ts) + Solidity (.t.sol) |
| Coverage | solidity-coverage (Istanbul) |
| Gas reporting | hardhat-gas-reporter |
| Static analysis | Slither + Slitherin (CI) |
| Tracing | hardhat-tracer |
| BLS crypto | @chainsafe/blst |

## Detected Test Types

| Type | Status | Evidence |
|---|---|---|
| **Unit** | Present | 100+ `.test.ts` files under `test/0.4.24/`, `test/0.6.12/`, `test/0.8.9/`, `test/0.8.25/` |
| **Integration** | Present | `test/integration/core/` (17 files) + `test/integration/vaults/` (33+ files) |
| **Fork** | Present | `MODE=forking` tests against mainnet and Hoodi; 3 CI workflows |
| **Fuzz** | Present | Foundry `testFuzz_*` in `.t.sol` files + TypeScript BLS fuzz (`bls.blst.e2e.fuzz.test.ts`) |
| **Invariant** | Present | Foundry `invariant_*` with handlers in `withdrawalQueue.t.sol`, `beaconChainDepositor.t.sol`, `minFirstAllocationStrategy.t.sol` |
| **Scenario** | Present | `test/integration/vaults/scenario/` (7 files: happy paths, PDG flows, lazy oracle) |
| **Differential** | Present | `NaiveMinFirstAllocationStrategy` reference impl vs optimized `MinFirstAllocationStrategy` in `minFirstAllocationStrategy.t.sol` |
| **Regression** | Maybe | Some upgrade finalize tests (`nor.initialize.upgrade.test.ts`, `accountingOracle.upgrade.test.ts`) test backwards-compat but no explicit regression suite |
| **Upgrade** | Present | `accountingOracle.upgrade.test.ts`, `nor.initialize.upgrade.test.ts`, `V3Template_Harness.sol`, `test:integration:upgrade` CI command |
| **Gas** | Present | `validator-exit-bus-oracle.gas.test.ts` + `hardhat-gas-reporter` globally enabled |

## Advanced Testing Techniques

### 1. Handler-Based Invariant Testing (Foundry)

**Files:** `test/0.8.9/withdrawalQueue.t.sol`, `test/0.8.9/beaconChainDepositor.t.sol`, `test/common/minFirstAllocationStrategy.t.sol`

The repo uses the canonical Foundry invariant pattern with dedicated handler contracts:

- **WQHandler** (`withdrawalQueue.t.sol`): Wraps `request()`, `finalize()`, and `claim()` operations with ghost variables (`ghost_totalRequestedEth`, `ghost_totalRequestNum`, `ghost_totalLockedEth`, `ghost_totalClaimedEth`). Six invariants verified including queue stETH consistency, locked ETH monotonicity, and claim/finalize state coherence.

- **BCDepositorHandler** (`beaconChainDepositor.t.sol`): Tracks `ghost_totalDeposits`, `ghost_totalETHDeposited`, and a full `ghost_DepositEvents` array. Three invariants verify: exactly 32 ETH per deposit, coherent deposit count, and deposit data integrity (no corruption through the depositor).

- **MinFirstAllocationStrategyAllocateHandler** (`minFirstAllocationStrategy.t.sol`): Runs fuzzed allocation through both the optimized and naive implementations simultaneously. Five invariants verified including output correctness, capacity bounds, sum preservation, and completeness.

All handlers use `targetSelector()` and `targetContract()` for guided fuzzing, with inline config annotations like:
```
forge-config: default.invariant.runs = 256
forge-config: default.invariant.depth = 256
forge-config: default.invariant.fail-on-revert = true
```

### 2. Differential Testing via Naive Reference Implementation

**File:** `test/common/minFirstAllocationStrategy.t.sol:279-302`

The `NaiveMinFirstAllocationStrategy` library provides a simple O(n*m) brute-force implementation of the allocation algorithm that allocates one unit at a time. The invariant test runs the optimized `MinFirstAllocationStrategy.allocate()` and the naive version in parallel, then asserts output equivalence. This is a textbook differential testing pattern.

### 3. Cross-Framework BLS12-381 E2E Fuzz

**File:** `test/common/bls.blst.e2e.fuzz.test.ts`

A sophisticated cross-framework fuzz test that:
1. Generates random BLS keypairs using `@chainsafe/blst` (TypeScript native binding)
2. Computes deposit signatures and Y-coordinate decompression
3. Calls the Solidity `BLS12_381` library via a `BLS12_381__Harness` contract
4. Verifies Solidity precompile results match the native TypeScript verification
5. Tests mutation/corruption detection (bit flips, truncation, extension)

Runs are configurable via `BLS_BLST_FUZZ_RUNS` env variable (default: 50). Timeout extended to 180s due to expensive pairing precompile calls.

### 4. Three-Mode Integration Infrastructure

**Files:** `lib/protocol/context.ts`, `lib/protocol/discover.ts`, `lib/protocol/provision.ts`, `hardhat.helpers.ts`

The integration test suite supports three deployment modes via the `MODE` environment variable:

| Mode | Description | Mechanism |
|---|---|---|
| `scratch` | Fresh protocol deploy from zero | `deployScratchProtocol()` + provision with operators, oracles, ETH |
| `forking` | Fork from live mainnet/hoodi | `hardhat_forking` + contract discovery from `deployed-*.json` |
| `upgrade` | Fork + apply upgrade template | Fork + `deployUpgrade()` + mock voting execution |

The `getProtocolContext()` function auto-detects the mode and returns a unified `ProtocolContext` object with all contract references and a `getSigner()` helper that impersonates addresses. The `discover()` function reads a `deployed-*.json` state file to locate all contracts via the `LidoLocator` pattern.

### 5. Protocol Provisioning for Scratch Mode

**File:** `lib/protocol/provision.ts`

After a scratch deploy, the `provision()` function bootstraps the protocol to a testable state by:
- Deploying EIP precompile stubs (4788, 7002, 7251)
- Setting up hash consensus initial epoch and oracle committee (5 members, quorum 4)
- Unpausing staking and withdrawal queue
- Registering NOR and SDVT operators with signing keys
- Seeding initial TVL (10,000 ETH)
- Configuring DSM guardians

### 6. Bail-On-Failure Sequential Scenarios

**File:** `test/suite/bail.ts`

The `bailOnFailure` function is used as a `beforeEach` hook in scenario tests to skip all remaining tests in a suite if any prior test has failed. This allows writing dependent sequential test chains (e.g., stake -> oracle report -> withdrawal request -> finalization -> claim) where each step depends on the previous.

### 7. Custom Chai Assertions

**Files:** `test/hooks/assertion/equalStETH.ts`, `test/hooks/assertion/revertedWithOZAccessControlError.ts`

Two custom Chai assertions are globally registered via Mocha root hooks:
- `equalStETH(expected)`: Compares stETH values within a 5 wei rounding margin (accounts for share rounding)
- `revertedWithOZAccessControlError(address, role)`: Asserts OZ AccessControl revert with specific account and role

### 8. Snapshot-Based State Isolation

**File:** `test/suite/snapshot.ts`

A `Snapshot` class wraps `evm_snapshot` / `evm_revert` for state management. The `resetState()` function attaches `beforeAll`/`afterAll` hooks to a Mocha suite for automatic state isolation. Used pervasively across both unit and integration tests.

### 9. Solidity-Version-Partitioned Test Organization

The test directory is organized by Solidity compiler version:
```
test/
├── 0.4.24/    # Lido, StETH, NOR (legacy Aragon)
├── 0.6.12/    # WstETH
├── 0.8.9/     # Oracles, Withdrawal Queue, Staking Router, DSM
├── 0.8.25/    # Vaults (v3 contracts)
├── common/    # Cross-version (BLS, math, signatures, ERC standards)
├── integration/
└── tooling/
```

Each version directory has its own `contracts/` subdirectory for mocks and harnesses specific to that compiler version. This prevents compiler version conflicts in a multi-version codebase.

### 10. Extensive Harness and Mock Infrastructure

**Pattern:** `Contract__Harness` (exposes internal functions) and `Contract__MockForX` (test doubles scoped to a specific consumer)

The repo contains 60+ harness and mock contracts. The naming convention `__MockForX` scopes each mock to exactly one consumer, preventing shared mock drift. Examples:
- `Lido__MockForAccounting` vs `Lido__MockForElRewardsVault` vs `Lido__MockForDepositSecurityModule` (3 different Lido mocks for different consumers)
- `VaultHub__MockForVaultHub` vs `VaultHub__MockForDashboard` vs `VaultHub__MockForLazyOracle`

## Complexity Management Patterns

### Fork Tests
- **Multi-mode infrastructure**: Same integration tests run against scratch, mainnet fork, and hoodi fork via environment variables
- **State file discovery**: `deployed-*.json` files provide contract addresses; `LidoLocator` is the root discovery point
- **CI parallelization**: Separate CI workflows for each fork target with 120-minute timeout and 7.2GB heap
- **Docker-based scratch node**: `ghcr.io/lidofinance/hardhat-node:2.26.0-scratch` image for CI scratch mode

### Fuzzing
- **Inline per-test config**: `forge-config: default.fuzz.runs = 2048` annotation per function
- **Bounded input generation**: `bound()` used consistently in handlers to constrain fuzzed inputs to valid ranges
- **Cross-framework fuzz**: TypeScript BLS fuzz generates random keys with native crypto, verifies against Solidity precompile

### Invariants
- **Ghost variable pattern**: Handlers maintain shadow state for cross-checking against contract state
- **Differential oracle**: Naive reference implementation compared against optimized algorithm
- **Multi-invariant suites**: 5-7 invariants per contract covering different aspects (sums, bounds, ordering, state coherence)
- **Inline config**: Configurable runs (32-512) and depth (16-256) per invariant suite

## Key Files

| File | Purpose |
|---|---|
| `test/0.8.9/withdrawalQueue.t.sol` | Handler-based invariant tests for WithdrawalQueue (6 invariants) |
| `test/0.8.9/beaconChainDepositor.t.sol` | Handler-based invariant tests for BeaconChainDepositor (3 invariants) |
| `test/common/minFirstAllocationStrategy.t.sol` | Differential invariant tests with naive reference (5 invariants) |
| `test/common/bls.blst.e2e.fuzz.test.ts` | Cross-framework BLS12-381 E2E fuzz test |
| `test/common/math256.t.sol` | Foundry fuzz tests for math library |
| `test/integration/core/happy-path.integration.ts` | Protocol-wide integration happy path |
| `test/integration/vaults/scenario/` | Vault lifecycle scenario tests |
| `lib/protocol/context.ts` | Protocol context factory (scratch/fork/upgrade) |
| `lib/protocol/discover.ts` | Contract discovery from state files |
| `lib/protocol/provision.ts` | Scratch mode protocol provisioning |
| `test/suite/snapshot.ts` | EVM snapshot state isolation |
| `test/suite/bail.ts` | Bail-on-failure sequential test chains |
| `test/hooks/assertion/equalStETH.ts` | Custom stETH rounding-tolerant assertion |
| `test/hooks/assertion/revertedWithOZAccessControlError.ts` | Custom OZ access control assertion |
| `test/0.8.9/oracle/validator-exit-bus-oracle.gas.test.ts` | Gas benchmark for VEB oracle |
| `test/upgrade/V3Template_Harness.sol` | Upgrade template test harness |
| `foundry.toml` | Foundry config with compilation restrictions |
| `.solcover.js` | Coverage config with Foundry-covered file exclusions |
| `.github/workflows/tests-unit.yml` | CI: unit + Foundry fuzz/invariant |
| `.github/workflows/tests-integration-mainnet.yml` | CI: mainnet fork integration |
| `.github/workflows/tests-integration-scratch.yml` | CI: scratch deploy integration |
| `.github/workflows/analyse.yml` | CI: Slither static analysis |
| `.github/workflows/coverage.yml` | CI: coverage with 95% threshold |

## Final Assessment

**Maturity: Very Advanced**

Lido Core's test suite is one of the most comprehensive and well-architected in the Ethereum DeFi ecosystem. Key differentiators:

1. **Dual-framework synergy**: Hardhat handles TypeScript integration/scenario tests while Foundry handles Solidity fuzz/invariant tests, with the BLS fuzz test bridging both frameworks.

2. **Handler-based invariants with differential testing**: The withdrawal queue, beacon chain depositor, and allocation strategy all have proper handler contracts with ghost variables and multi-invariant suites. The allocation strategy additionally uses a naive reference implementation for differential verification.

3. **Three-mode integration infrastructure**: The same test suite runs against scratch deploys, mainnet forks, and upgrade simulations with unified protocol context management. This is a rare level of deployment-mode flexibility.

4. **Domain-specific tooling**: Custom Chai assertions for stETH rounding, bail-on-failure for sequential scenarios, and per-version test organization show mature engineering practices.

5. **CI depth**: Six CI workflows covering unit, Foundry fuzz/invariant, mainnet fork, hoodi fork, scratch, and coverage with 95% threshold enforcement.

**Reusable ideas for other protocols:**
- Handler + ghost variable pattern for invariant testing
- Differential testing with naive reference implementations
- Multi-mode integration infrastructure (scratch/fork/upgrade)
- Bail-on-failure for dependent sequential test chains
- Scoped mock naming (`__MockForX`) to prevent shared mock drift
- Cross-framework fuzz testing (TypeScript crypto + Solidity precompile)
- Inline forge-config annotations for per-test fuzz parameters
