# SSV Network — Test Strategy Analysis

## Overview

SSV Network uses `Hardhat` + `Mocha` + `Chai` as the main test stack (`package.json`, `hardhat.config.ts`). `Foundry` is also present (`foundry.toml`, `forge-std` in `package.json`), but the repo evidence points to it being used primarily as tooling support for `Echidna` rather than as a separate `forge test` runner. The suite is broad: 63 unit files, 11 integration files, 32 e2e scenario files, 7 sanity/regression files, 2 fork-test entrypoints, 13 Echidna harnesses, 7 Solidity harness contracts, 22 Solidity mocks, and 7 CI workflows.

The repo is not just “many tests.” It has real test infrastructure: shared deployment fixtures in `test/setup/fixtures.ts`, module-specific harness contracts in `contracts/test/harness/`, gas-budget tooling in `test/helpers/gas-usage.ts` and `scripts/gas-compare.ts`, dedicated fork orchestration in `scripts/common/fork-test.ts` and `scripts/run-forked-tests.ts`, and a custom Monte Carlo simulation engine under `test/simulation/`.

## Evidence Map

| Area | Evidence | Notes |
|---|---|---|
| Core runner/config | `package.json`, `hardhat.config.ts`, `foundry.toml`, `.solcover.js` | Hardhat is the primary runner; Foundry config exists; coverage is enabled through Hardhat |
| CI workflows | `.github/workflows/tests.yaml`, `.github/workflows/tests-forked.yaml`, `.github/workflows/echidna.yaml`, `.github/workflows/code-coverage.yaml`, `.github/workflows/slither.yaml` | Separate CI for general tests, fork tests, Echidna, coverage, and static analysis |
| Unit suites | `test/unit/**` | 63 unit files across `SSVClusters`, `SSVDAO`, `SSVOperators`, `SSVStaking`, `SSVValidator`, `SSVViews` |
| Integration suites | `test/integration/**` | Includes `test/integration/SSVNetwork.test.ts`, `test/integration/SSVNetworkPreMigration.test.ts`, and subsystem-specific integration files |
| E2E/scenario suites | `test/e2e/**`, `test/e2e/COVERAGE-REPORT.md` | Structured by lifecycle/domain; scenario coverage is explicitly mapped and audited |
| Regression/sanity | `test/sanity/**`, `test/unit/SSVValidator/bug4-double-deviation-liquidated.test.ts`, `test/e2e/migration/migration-double-payment.test.ts` | Explicit bug- and sanity-oriented tests exist |
| Fork tests | `test/forked/v2.0.0/fullIntegrationForked.test.ts`, `test/test-forked/v2.0.0/fullIntegrationForked.test.ts`, `test/setup/fork.ts`, `test/forked/v2.0.0/config.ts` | Dedicated fork network, fixtures, and config hydration |
| Fuzz/invariant | `test/echidna/*.sol`, `test/echidna/echidna.yaml`, `test/echidna/README.md`, `.github/workflows/echidna.yaml` | 13 Echidna harnesses, auto-discovered in CI |
| Simulation/custom engine | `test/simulation/monte-carlo.test.ts`, `test/simulation/types.ts`, `test/simulation/rng.ts`, `test/simulation/weight-schedule.ts`, `test/simulation/actions/*`, `test/simulation/invariants.ts`, `test/simulation/state-discovery.ts`, `test/simulation/sim-logger.ts` | Deterministic workload generator, action registry, state discovery, and invariant checking |
| Harnesses/mocks | `contracts/test/harness/*.sol`, `contracts/test/mocks/*.sol` | Storage-level harnesses and targeted malicious/mock contracts |
| Upgrade replay fixtures | `test/setup/artifacts/*Legacy.json`, `test/setup/fixtures.ts`, `contracts/test/SSVNetworkUpgrade.sol`, `contracts/test/SSVNetworkReinitializable.sol` | Archived legacy artifacts are replayed inside tests |
| Gas tooling | `test/helpers/gas-usage.ts`, `test/helpers/gas.ts`, `test/helpers/v1-gas-report.json`, `scripts/gas-compare.ts` | Per-operation gas ceilings, report generation, and baseline comparison |
| Deployment/fork config | `deployments/**/*.json`, `scripts/common/fork-test.ts`, `scripts/run-forked-tests.ts`, `Justfile` | Fork tests consume deployment artifacts and environment-derived protocol params |

## Detected Test Types

| Type | Status | Evidence | Assessment |
|---|---|---|---|
| Unit | Present | `test/unit/**`, `test/unit/run-tests.sh`, `package.json` (`test:unit`) | Clear module-level unit coverage with harness-backed storage assertions |
| Integration | Present | `test/integration/SSVNetwork.test.ts`, `test/integration/SSVNetworkPreMigration.test.ts`, `test/integration/SSVNetwork/*.test.ts` | Covers multi-module integration and upgrade/migration behavior |
| Fork | Present | `hardhat.config.ts` (`hardhat_forked`), `test/setup/fork.ts`, `test/forked/**`, `test/test-forked/**`, `.github/workflows/tests-forked.yaml` | Dedicated fork runner and fork-only fixtures |
| Fuzz | Present | `test/echidna/*.sol`, `test/echidna/echidna.yaml`, `.github/workflows/echidna.yaml` | External stateful property fuzzing via Echidna |
| Invariant | Present | `test/echidna/*.sol`, `test/simulation/invariants.ts`, `test/unit/SSVStaking/solvencyInvariant.test.ts` | Both Echidna property invariants and TypeScript-driven invariants are present |
| Scenario | Present | `test/e2e/**`, `test/e2e/COVERAGE-REPORT.md`, `test/e2e/cross-cutting/full-lifecycle.test.ts` | Explicit lifecycle and cross-cutting scenario coverage |
| Differential | Maybe Present | `test/e2e/migration/migration-double-payment.test.ts`, `test/simulation/bookkeeping.ts`, `test/simulation/invariants.ts`, several Echidna harnesses with shadow bookkeeping | There are formula-backed and shadow-model comparisons, but no clear dedicated two-implementation or reference-implementation suite |
| Regression | Present | `test/sanity/**`, `test/unit/SSVValidator/bug4-double-deviation-liquidated.test.ts`, `test/e2e/migration/migration-double-payment.test.ts` | Explicit regression/sanity testing, not just incidental bug coverage |
| Upgrade | Present | `test/setup/fixtures.ts`, `test/setup/artifacts/*Legacy.json`, `test/integration/SSVNetworkPreMigration.test.ts`, `test/e2e/migration/*.test.ts`, fork upgrade helpers | Upgrade and post-upgrade migration paths are a major part of the suite |
| Gas | Present | `test/helpers/gas-usage.ts`, `scripts/gas-compare.ts`, `test/helpers/v1-gas-report.json`, `.github/workflows/tests.yaml` | Gas is treated as an enforceable contract, not just observed output |

## Advanced Testing Techniques

### 1. Stateful Echidna harnesses with embedded actors

Evidence: `test/echidna/SSVAccountingEchidna.sol`, `test/echidna/SSVClustersEchidna.sol`, `test/echidna/SSVOperatorsEchidna.sol`, `test/echidna/SSVStakingEchidna.sol`, `test/echidna/SSVDAOEchidna.sol`, `test/echidna/SSVMigrationEchidna.sol`, `test/echidna/SSVEBProofEchidna.sol`.

This repo does not use trivial single-function Echidna properties. The harnesses expose many `action_*` mutators and pair them with `echidna_*` properties. They also instantiate helper actors such as `ClusterUser`, `OperatorUser`, `MigrationClusterUser`, `MigrationOperatorUser`, and `StakingUser` so the fuzzer can exercise owner-only and cross-user flows without collapsing everything into `msg.sender == address(this)`.

Reusable idea:
- Build fuzz harnesses around realistic actors plus local shadow records, not around raw direct calls only.

### 2. Shadow-model invariants inside the fuzz harnesses

Evidence: `test/echidna/SSVAccountingEchidna.sol`, `test/echidna/SSVOperatorsEchidna.sol`, `test/echidna/SSVMigrationEchidna.sol`.

Several Echidna harnesses keep local records such as `ClusterRecord`, tracked operator owners, migrated-cluster sets, removed-operator frozen indices, expected balances, and sticky boolean failure latches. This is closer to model-based stateful fuzzing than to simple postconditions. For example:

- `test/echidna/SSVAccountingEchidna.sol` tracks ETH/SSV inflows, outflows, unallocated balances, migrated cluster ids, and local cluster maps to check conservation and one-way migration properties.
- `test/echidna/SSVMigrationEchidna.sol` explicitly tracks removed operators and their frozen SSV index to verify migration accounting around BUG-14 class behavior.
- `test/echidna/SSVOperatorsEchidna.sol` tracks expected ETH and SSV balances per operator and verifies payout and removal cleanup semantics.

Reusable idea:
- Keep a lightweight shadow ledger inside the harness so invariants can speak in business-level terms, not only storage-level terms.

### 3. Fork fixture with strict preflight and fallback upgrade replay

Evidence: `hardhat.config.ts`, `test/setup/fork.ts`, `test/setup/fixtures.ts`, `test/forked/v2.0.0/config.ts`, `scripts/common/fork-test.ts`, `scripts/run-forked-tests.ts`.

The fork strategy is more advanced than “set RPC URL and run tests.” The repo has:

- A dedicated `hardhat_forked` network in `hardhat.config.ts`.
- Explicit `chainDescriptors` for local fork history so historical calls work under Hardhat EDR even when Anvil forks use chain id `31337`.
- `FORK_CONFIG_PATH` and deployment-json hydration via `test/forked/v2.0.0/config.ts` and `scripts/common/fork-test.ts`.
- `preflightSourceRpc()` in `scripts/common/fork-test.ts`, which validates that the deployed fork state is readable before tests trust it.
- A fallback path in `test/setup/fixtures.ts` that abandons unreadable deployed state and performs the upgrade inside the test fixture instead.

Reusable idea:
- Treat fork state as untrusted input; preflight it and have a deterministic fallback instead of assuming the fork is always correct.

### 4. Legacy-artifact replay for upgrade and migration tests

Evidence: `test/setup/artifacts/SSVNetworkLegacy.json`, `test/setup/artifacts/SSVNetworkViewsLegacy.json`, `test/setup/artifacts/SSVClustersLegacy.json`, `test/setup/artifacts/SSVOperatorsLegacy.json`, `test/setup/artifacts/SSVDAOLegacy.json`, `test/setup/artifacts/SSVOperatorsWhitelistLegacy.json`, `test/setup/artifacts/SSVViewsLegacy.json`, `test/setup/fixtures.ts`, `test/integration/SSVNetworkPreMigration.test.ts`, `test/e2e/migration/*.test.ts`.

The repo can reconstruct a pre-upgrade system from archived artifacts, deploy it inside the test, and then run the upgrade path to the current version. This is significantly stronger than mocking an “old state” with a few setters, because the legacy code itself is involved in the setup.

Reusable idea:
- Archive old ABIs/artifacts and build replay fixtures around them; this makes upgrade tests much more credible.

### 5. Custom Monte Carlo simulation engine

Evidence: `test/simulation/monte-carlo.test.ts`, `test/simulation/types.ts`, `test/simulation/rng.ts`, `test/simulation/weight-schedule.ts`, `test/simulation/actions/index.ts`, `test/simulation/bookkeeping.ts`, `test/simulation/invariants.ts`, `test/simulation/state-discovery.ts`, `test/simulation/sim-logger.ts`.

This is the strongest repo-specific technique. The simulation layer includes:

- A deterministic seeded RNG (`test/simulation/rng.ts`).
- A weighted action schedule that changes over simulated time (`test/simulation/weight-schedule.ts`).
- An action registry and dispatch layer (`test/simulation/actions/index.ts`).
- Event scanning on a mainnet fork to discover active operators and seed real state (`test/simulation/state-discovery.ts`).
- Local state books for clusters, operators, stakers, and ETH/SSV totals (`test/simulation/types.ts`, `test/simulation/bookkeeping.ts`).
- Periodic and final invariants (`test/simulation/invariants.ts`).
- A structured action logger with per-action revert accounting (`test/simulation/sim-logger.ts`).

This is a custom scenario engine, not just a long test file.

Reusable idea:
- If a protocol has a migration window or long-lived state transitions, use a deterministic workload simulator with periodic invariants instead of relying only on hand-written happy paths.

### 6. Harness contracts expose internal state and synthetic edge paths

Evidence: `contracts/test/harness/SSVClustersHarness.sol`, `contracts/test/harness/SSVValidatorsHarness.sol`, `contracts/test/harness/SSVOperatorsHarness.sol`, `contracts/test/harness/SSVDAOHarness.sol`, `contracts/test/harness/SSVStakingHarness.sol`, `contracts/test/harness/SSVViewsHarness.sol`, `contracts/test/harness/PackedLibHarness.sol`.

The harnesses are not just getters. They actively seed storage, fake legacy conditions, and create targeted paths that production code cannot reach directly. Examples:

- `contracts/test/harness/SSVClustersHarness.sol` has helpers like `mockRemoveOperatorAndPayout`, `mockSetEBRoot`, and direct snapshot getters.
- `contracts/test/harness/SSVStakingHarness.sol` seeds user indices, accrued balances, withdrawal queues, oracle ids, and pool balances.
- `contracts/test/harness/SSVViewsHarness.sol` registers ETH and SSV clusters directly in storage and exposes raw fee/snapshot state.

Reusable idea:
- Put storage seeding and synthetic edge-path helpers in dedicated harness contracts instead of scattering special-case setup across TypeScript tests.

### 7. Gas budgets are versioned and CI-enforced

Evidence: `test/helpers/gas-usage.ts`, `test/helpers/v1-gas-report.json`, `scripts/gas-compare.ts`, `.github/workflows/tests.yaml`.

Gas tracking is first-class:

- `test/helpers/gas-usage.ts` defines a large `GasGroup` enum and per-operation ceilings, including cardinality variants like 4/7/10/13 operator flows.
- Gas stats are recorded during normal tests and can fail tests when `NO_GAS_ENFORCE` is not set.
- `scripts/gas-compare.ts` compares current results to a baseline report in `test/helpers/v1-gas-report.json`.
- CI uploads the reports and comments the comparison on PRs.

Reusable idea:
- Treat gas as a benchmark suite with named operations and baselines, not as a single post-run aggregate number.

### 8. Scenario coverage is explicitly documented and audited

Evidence: `test/e2e/COVERAGE-REPORT.md`.

The e2e report does more than count tests. It maps files to scenario ids, records missing scenarios, documents discrepancy annotations between specification and implementation, and even notes where weak assertions were strengthened.

Reusable idea:
- A scenario matrix becomes far more valuable when it also records spec mismatches and assertion-quality audits.

## Complexity Management Patterns

### Fork tests

- `hardhat.config.ts` defines a dedicated `hardhat_forked` network, fork block selection, and explicit chain history for local forks.
- `test/setup/fork.ts` and `test/setup/fixtures.ts` centralize fork connection and fixture construction, instead of letting individual tests build their own forks.
- `test/forked/v2.0.0/config.ts`, `scripts/common/fork-test.ts`, and `deployments/**/*.json` let tests hydrate addresses and protocol parameters from deployment outputs.
- `scripts/common/fork-test.ts` preflights the source RPC before trusting deployed upgraded state.
- `test/setup/fixtures.ts` can fall back from deployed-state mode to an in-test upgrade path.
- `scripts/common/impersonation.ts` and direct `hardhat_impersonateAccount` / `hardhat_setBalance` calls are used to seed DAO/users/operators on forks.
- `test/simulation/state-discovery.ts` scans real fork logs in chunks to discover operators before sampling them into the simulation.

### Fuzzing

- `.github/workflows/echidna.yaml` and `test/echidna/run-echidna.sh` auto-discover every `test/echidna/*Echidna.sol` harness; new harnesses join the matrix without manual CI edits.
- `test/echidna/echidna.yaml` standardizes the run shape with `testMode: property`, `prefix: "echidna_"`, `seqLen: 200`, shrinking, and parallel workers.
- The dominant pattern is stateful action/property fuzzing, not purely stateless preconditions.
- Many harnesses construct helper actors to make permissions and payout flows fuzzable.
- Bug-focused harnesses such as `test/echidna/SSVMigrationEchidna.sol`, `test/echidna/SSVEBProofEchidna.sol`, `test/echidna/SSVOperatorFeeGovEchidna.sol`, and `test/echidna/SSVLegacyClustersEchidna.sol` isolate fragile behaviors instead of forcing one giant universal harness.

### Invariants

- Invariants are enforced at several layers: Echidna properties, helper assertions in TypeScript, dedicated invariant-style unit tests like `test/unit/SSVStaking/solvencyInvariant.test.ts`, and periodic/final simulation checks.
- `test/helpers/invariants.ts` centralizes reusable TypeScript invariants such as ETH conservation, validator-count consistency, cSSV supply consistency, accumulator monotonicity, and operator-vUnits checks.
- `test/simulation/invariants.ts` works against a tracked state model instead of only raw on-chain storage.
- The Echidna harnesses usually keep sticky violation flags and expose them through `echidna_*` views, which makes debugging and post-mortem inspection easier.
- Important nuance: no repo evidence was found for Foundry-native handler invariants (`invariant_*`, `targetContract`, `targetSelector`). The invariant maturity is still high, but the pattern is Echidna/state-model centric rather than Foundry-handler centric.

## Key Files

| File | Why it matters |
|---|---|
| `package.json` | Main test commands, gas commands, coverage command, fork test command |
| `hardhat.config.ts` | Hardhat networks, fork config, local-fork chain descriptor, long Mocha timeout |
| `foundry.toml` | Confirms Foundry toolchain presence |
| `.github/workflows/tests.yaml` | Main CI run with gas report generation and PR comment |
| `.github/workflows/tests-forked.yaml` | Dedicated fork-test CI job |
| `.github/workflows/echidna.yaml` | Auto-discovered Echidna matrix in CI |
| `test/setup/fixtures.ts` | Core deployment, legacy replay, upgrade, and fork fixtures |
| `test/setup/artifacts/*Legacy.json` | Archived artifacts used for realistic upgrade replay |
| `contracts/test/harness/SSVClustersHarness.sol` | Storage-seeding and synthetic accounting helpers |
| `contracts/test/harness/SSVStakingHarness.sol` | Direct staking-state setup and inspection |
| `contracts/test/harness/SSVViewsHarness.sol` | Storage seeding for view-layer tests |
| `test/helpers/gas-usage.ts` | Gas group registry, enforcement, and report generation |
| `scripts/gas-compare.ts` | Baseline-vs-current gas regression comparison |
| `test/echidna/README.md` | Index of 13 harnesses and declared invariant sets |
| `test/echidna/SSVAccountingEchidna.sol` | Large stateful accounting harness with shadow bookkeeping |
| `test/echidna/SSVDAOEchidna.sol` | Governance/oracle quorum and accounting properties |
| `test/echidna/SSVMigrationEchidna.sol` | Targeted migration fuzz harness for removed-operator edge cases |
| `test/simulation/monte-carlo.test.ts` | Long-horizon Monte Carlo simulation entrypoint |
| `test/simulation/state-discovery.ts` | Fork log scanning and operator sampling |
| `test/simulation/weight-schedule.ts` | Time-varying action distribution model |
| `test/e2e/COVERAGE-REPORT.md` | Scenario inventory, discrepancy audit, and assertion-quality notes |
| `test/sanity/removed-operator-with-deviated-cluster.test.ts` | Sanity/regression bucket for fragile edge behavior |
| `test/unit/SSVValidator/bug4-double-deviation-liquidated.test.ts` | Bug-specific regression test |
| `test/e2e/migration/migration-double-payment.test.ts` | Regression-style migration accounting checks |

## Final Assessment

**Classification:** very advanced

This repo uses a layered strategy rather than a single runner style. Hardhat/Mocha/Chai covers the bulk of unit, integration, e2e, upgrade, and gas-enforced testing. Echidna provides stateful property fuzzing with realistic actor models and shadow bookkeeping. Fork testing is treated as a managed environment with config hydration, preflight validation, impersonation, and fallback upgrade replay. On top of that, the repo adds a custom Monte Carlo simulation engine for long-horizon migration stress tests.

The most reusable ideas are:

- Stateful Echidna harnesses built around actor contracts plus local shadow ledgers.
- Fork fixtures that validate deployed state first and fall back to deterministic in-test upgrade replay.
- Archived legacy-artifact replay for realistic upgrade tests.
- A deterministic Monte Carlo engine with weighted actions and periodic invariants.
- A named gas-budget registry with baseline diffing and PR feedback.
- Scenario coverage reports that also capture spec discrepancies and assertion-quality improvements.

Conservative caveats:

- Differential testing is only **maybe present**. The repo has shadow-model and formula-backed checks, but not a clear alternative-implementation/reference suite.
- Foundry is present in tooling/config, but there is no strong repo evidence of `forge test`, `testFuzz_*`, or `invariant_*` suites.
- Fork entrypoints are split across `test/forked/` and `test/test-forked/`, and those files are not identical, which is a maintenance risk rather than a strength.
