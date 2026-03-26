# Rocket Pool Test Strategy Analysis

All paths below are relative to `/Users/marco/ssv/repos/rocketpool`.

## Evidence Map

- Framework and runner config:
  - `package.json`
  - `hardhat-common.config.js`
  - `hardhat.config.js`
  - `hardhat-deploy.config.js`
  - `hardhat-fork.config.js`
  - `hardhat-upgrade.config.js`
- CI and automation:
  - `.github/workflows/CI.yml`
  - `azure-pipelines.yml`
  - `scripts/upgrade-test.sh`
  - `.gitmodules`
- Test entrypoints:
  - `test/rocket-pool-tests.js`
  - `test-fork/rocket-fork-tests.js`
  - `test-upgrade/rocket-upgrade-tests.js`
- Main test layout found from the repo tree:
  - 27 main `*-tests.js` files under `test/**`
  - 55 `scenario-*.js` files under `test/**`
  - 4 upgrade suite files under `test-upgrade/tests/`
  - 18 helper files under `test/_helpers/`
  - 9 utility files under `test/_utils/`
  - 5 upgrade helper files under `test-upgrade/_helpers/`
- Core harness layers:
  - `test/_helpers/deployment.js`
  - `test/_helpers/deployer.js`
  - `test/_utils/artifacts.js`
  - `test/_utils/snapshotting.js`
  - `test/_helpers/invariants.js`
  - `test/_utils/testing.js`
- Test-only contracts and mocks:
  - `contracts/contract/helper/BeaconStateVerifierMock.sol`
  - `contracts/contract/helper/StorageHelper.sol`
  - `contracts/contract/helper/StakeHelper.sol`
  - `contracts/contract/helper/MegapoolUpgradeHelper.sol`
  - `contracts/contract/helper/SnapshotTest.sol`
  - `contracts/contract/helper/SnapshotTimeTest.sol`
  - `contracts/contract/helper/PenaltyTest.sol`

## Overview

Rocket Pool uses a Hardhat + Mocha test stack with a strongly scenario-driven architecture. The checked-in suite is broad across protocol domains and deep in stateful lifecycle testing: node registration, deposits, minipools, megapools, DAO governance, rewards, snapshots, token behavior, and upgrades are all represented.

The dominant testing style is not fuzzing. Instead, the repo leans on:
- reusable scenario modules,
- a custom staged full-protocol deployer,
- snapshot-based fixture layering,
- a storage-backed artifact loader for upgrade flows,
- deterministic post-test invariant checks.

The repo does contain fork infrastructure and upgrade automation, but those are not equally mature. Upgrade testing is substantial. Fork testing is only scaffolded in the checked-in tree. Gas reporting is present, but I did not find gas thresholds or snapshot-style gas regression files.

Framework evidence:
- `package.json` uses `hardhat`, `mocha`, `hardhat-gas-reporter`, and `solidity-coverage`.
- `hardhat-common.config.js` sets Mocha as the runner and points tests at `./test`.
- `hardhat-fork.config.js` switches the test path to `./test-fork` and enables Hardhat forking.
- `hardhat-upgrade.config.js` switches the test path to `./test-upgrade`.

## Detected Test Types

| Type | Status | Evidence |
|---|---|---|
| Unit | Present | Narrow utility-focused suites exist in `test/util/util-tests.js`, `test/util/verifier-tests.js`, and `test/network/network-snapshots-tests.js`. These test isolated helper/storage/proof behavior rather than broad end-to-end flows. |
| Integration | Present | `test/rocket-pool-tests.js` deploys the whole protocol with `deployRocketPool()` and then runs all domain suites against the deployed system. Representative multi-contract suites include `test/minipool/minipool-tests.js`, `test/dao/dao-protocol-tests.js`, `test/node/node-staking-tests.js`, and `test/megapool/megapool-tests.js`. |
| Fork | Maybe present | Fork infrastructure exists in `hardhat-fork.config.js` and `package.json` (`test-fork` script), but `test-fork/rocket-fork-tests.js` contains only an empty `describe('Fork Mainnet', ...)` block and no `it(...)` cases. |
| Fuzz | Not found | I found no fuzz framework, no property fuzzer, no Echidna/Forge/Foundry setup, and no fuzz harness files. The repo-wide search for fuzz-related terms only surfaced invariant helper naming and unrelated package-lock entries. |
| Invariant | Present | `test/rocket-pool-tests.js` runs `afterEach(checkInvariants)`. The invariant logic lives in `test/_helpers/invariants.js`, and several megapool scenario helpers also call `checkMegapoolInvariants()` directly, for example `test/megapool/scenario-stake.js` and `test/megapool/scenario-exit.js`. This is real invariant checking, but deterministic and post-scenario rather than randomized invariant fuzzing. |
| Scenario | Present | The repo has 55 `scenario-*.js` files. Examples: `test/minipool/scenario-stake.js`, `test/dao/scenario-dao-security.js`, `test/megapool/scenario-exit.js`, `test/network/scenario-submit-prices.js`, `test/rewards/scenario-submit-rewards.js`. |
| Differential | Not found | I found no side-by-side comparator against another implementation, previous version, external oracle, or alternate math engine. |
| Regression | Maybe present | There is no dedicated bug-regression directory or issue-specific regression labeling. However, the upgrade suites in `test-upgrade/tests/*.js` explicitly validate backward-compatible behavior for pre-upgrade state, which is regression-like coverage. |
| Upgrade | Present | `scripts/upgrade-test.sh`, `test-upgrade/rocket-upgrade-tests.js`, `test-upgrade/_helpers/upgrade.js`, and the four suites in `test-upgrade/tests/` form a real upgrade test harness. |
| Gas | Present | `package.json` defines `test-gas`, and both `hardhat.config.js` and `hardhat-deploy.config.js` enable `gasReporter` when `REPORT_GAS=1` is set. |

## Advanced Testing Techniques

### 1. Storage-backed artifact rehydration from the on-chain registry

**Files:** `test/_utils/artifacts.js`, `test/_utils/contract.js`, `test-upgrade/_helpers/upgrade.js`

This repo does not treat deployed contracts as static Hardhat artifacts only. `Artifacts.loadFromDeployment()` in `test/_utils/artifacts.js` reads contract addresses and compressed ABIs out of Rocket Storage, decompresses them, and rebuilds contract instances dynamically. That becomes critical in upgrade tests, where `executeUpgrade()` in `test-upgrade/_helpers/upgrade.js` upgrades the system and then reloads the artifact map from storage.

Reusable idea:
- If a protocol keeps contract metadata in an on-chain registry, tests can rehydrate the live ABI/address map after upgrades instead of hard-coding deployment assumptions.

### 2. Staged full-protocol deployer reused by tests and deployment scripts

**Files:** `test/_helpers/deployer.js`, `test/_helpers/deployment.js`, `scripts/deploy.js`

`RocketPoolDeployer` is a substantial custom harness. It builds a `contractPlan`, groups actions into ordered stages via `addStage(...)`, deploys the full protocol, writes addresses and compressed ABIs into storage, initializes contracts, and locks storage at the end. `test/_helpers/deployment.js` extends the plan with test-specific helpers and mocks. `scripts/deploy.js` then reuses the same deployer for actual deployments.

Reusable idea:
- A single staged deployer can serve both tests and live deployment if the protocol depends on a contract registry and many cross-linked addresses.

### 3. Nested snapshot fixture tree

**Files:** `test/_utils/snapshotting.js`, `test/node/node-staking-tests.js`, `test/megapool/megapool-tests.js`

The suite uses snapshots at three levels:
- `beforeEach(startSnapShot)` / `afterEach(endSnapShot)` in `test/rocket-pool-tests.js`
- `globalSnapShot()` inside large suite-level `before(...)` blocks
- `snapshotDescribe(...)` in `test/_utils/snapshotting.js` for nested fixture branches

This is used heavily in large stateful files such as:
- `test/node/node-staking-tests.js`
- `test/megapool/megapool-tests.js`

Those files create expensive mid-state setups once, then open additional nested suites off those checkpoints.

Reusable idea:
- For slow stateful protocols, nested snapshot fixtures are a strong alternative to redeploying or replaying long setup sequences for every branch.

### 4. Post-test global accounting invariant sweep

**Files:** `test/rocket-pool-tests.js`, `test/_helpers/invariants.js`, `test/minipool/minipool-tests.js`

Every test in the main suite is followed by `checkInvariants()` from `test/_helpers/invariants.js`. That helper walks all nodes, enumerates their minipools, and checks:
- active/finalized/staking counts,
- deposit-size-specific staking counts,
- weighted average node fee,
- megapool borrowed/bonded accounting,
- deposit pool node balance against summed queued bond.

This is a meaningful invariant layer, even though it is not a fuzz engine.

The repo also shows deliberate maintenance of this layer. In `test/minipool/minipool-tests.js`, tests that intentionally poison delegate state explicitly reset it afterward with comments like "Reset the delegate to working contract to prevent invariant tests from failing."

Reusable idea:
- A global post-test invariant sweep can upgrade ordinary scenario suites into stronger state-consistency tests without adopting a full invariant runner.

### 5. Scenario action modules with embedded balance-delta assertions

**Files:** `test/deposit/scenario-deposit.js`, `test/megapool/scenario-stake.js`, `test/minipool/scenario-withdraw-validator-balance.js`

The `scenario-*.js` files are not just thin transaction wrappers. Many of them gather before/after state, execute the action, and assert balance or accounting deltas internally. For example:
- `test/deposit/scenario-deposit.js` checks deposit pool, vault, and rETH balance changes.
- `test/megapool/scenario-stake.js` checks node/user capital and queued capital deltas, validator flags, and then re-runs megapool invariants.

Reusable idea:
- Small scenario modules that both perform the action and verify local invariants reduce repetition and keep domain suites readable.

### 6. Legacy-to-current upgrade compatibility harness

**Files:** `scripts/upgrade-test.sh`, `.gitmodules`, `test-upgrade/_helpers/upgrade.js`, `test-upgrade/tests/minipool-tests.js`, `test-upgrade/tests/staking-tests.js`, `test-upgrade/tests/rewards-tests.js`, `test-upgrade/tests/misc-tests.js`

The upgrade flow is more than "deploy new code and call upgrade." The harness:
- expects an `old` repo submodule (`.gitmodules`)
- starts a local Hardhat node (`scripts/upgrade-test.sh`)
- compiles and deploys the old system
- deploys the new implementation set with `deployUpgrade(...)`
- executes the upgrade
- reloads live contract metadata from Rocket Storage
- validates both migrated settings and post-upgrade behavior on legacy-created state

The individual upgrade suites test flows like:
- nodes created before upgrade can still create/use megapools,
- legacy minipool behavior after upgrade,
- reward behavior after upgrade,
- settings migration correctness.

Reusable idea:
- Model upgrades against real legacy state, then rebind test handles to the live upgraded registry.

### 7. Test-only helper contracts for unreachable protocol states

**Files:** `contracts/contract/helper/BeaconStateVerifierMock.sol`, `contracts/contract/helper/MegapoolUpgradeHelper.sol`, `contracts/contract/helper/StakeHelper.sol`, `contracts/contract/helper/SnapshotTest.sol`, `contracts/contract/helper/SnapshotTimeTest.sol`, `contracts/contract/helper/StorageHelper.sol`

This repo uses purpose-built helper contracts to reach states that would otherwise be hard or slow to create:
- bypassing or simulating beacon proof behavior,
- forcing delegate-upgrade conditions,
- manipulating RPL lock/legacy stake state,
- exercising snapshot libraries,
- editing storage directly for setup.

Reusable idea:
- For deeply stateful protocols, a small set of intentionally non-production helper contracts can dramatically simplify edge-case setup.

### 8. Consensus-proof bypass with real-proof spot checks

**Files:** `contracts/contract/helper/BeaconStateVerifierMock.sol`, `test/util/verifier-tests.js`, `test/_utils/beacon.js`, `test/megapool/megapool-tests.js`

The suite separates two concerns:
- proof correctness, tested directly in `test/util/verifier-tests.js`
- protocol logic that depends on proof success, simplified elsewhere by `BeaconStateVerifierMock.sol`

`BeaconStateVerifierMock.sol` can either forward to the real verifier or short-circuit verification when disabled. In `test/megapool/megapool-tests.js`, proof verification is explicitly disabled to focus on megapool execution paths. In `test/util/verifier-tests.js`, real slot/validator/withdrawal proofs are checked directly.

Reusable idea:
- Split consensus-proof validation from downstream accounting logic so stateful execution tests do not need to carry full proof complexity.

### 9. Compiler-mode-aware revert assertion helper

**Files:** `test/_utils/testing.js`, `hardhat-deploy.config.js`, `hardhat-upgrade.config.js`

`shouldRevert(...)` in `test/_utils/testing.js` explicitly handles the case where Hardhat cannot infer a revert reason under `--via-ir`. That is relevant because the deploy and upgrade configs turn on `viaIR` with strong optimizer settings.

Reusable idea:
- If tests run under multiple compiler profiles, shared revert helpers should account for profile-specific error-reporting behavior.

## Complexity Management Patterns

### Fork tests

What exists:
- `hardhat-fork.config.js` enables mainnet forking through `MAINNET_PROVIDER_URL`.
- `test-fork/rocket-fork-tests.js` defines fork-specific environment inputs such as `MAINNET_ROCKET_STORAGE`.
- The fork entrypoint reuses `startSnapShot` and `endSnapShot`.

What does not:
- I found no checked-in fork assertions.
- `test-fork/rocket-fork-tests.js` contains only an empty `describe(...)` block.

Assessment:
- Fork complexity management is minimal because the actual fork suite is not implemented in the inspected tree.

### Fuzzing

Not found.

I found no fuzz harness, no Foundry/Forge/Echidna setup, no property generator library, no handler/engine pattern, and no dedicated randomized test infrastructure.

### Invariants

The invariant strategy is deterministic and integrated into normal scenario testing rather than separated into an invariant engine.

Patterns:
- `test/rocket-pool-tests.js` runs `afterEach(checkInvariants)`, so every main-suite test is followed by a registry-wide accounting audit.
- `test/_helpers/invariants.js` traverses nodes and minipools dynamically, rather than hard-coding a few expected values.
- Several megapool scenario helpers run `checkMegapoolInvariants()` immediately after complex operations, adding local reinforcement on top of the global sweep.
- Tests that intentionally mutate shared delegate configuration repair it before teardown so the invariant sweep stays meaningful.

This is useful and nontrivial, but it is not handler-based invariant testing, not stateful randomized invariant testing, and not a dedicated invariant framework.

### Scenario and upgrade complexity

This is where the repo is strongest.

Key patterns:
- `deployRocketPool()` in `test/_helpers/deployment.js` builds a full protocol instance once.
- `setDefaultParameters()` in `test/_helpers/defaults.js` centralizes shared protocol defaults.
- `globalSnapShot()` and `snapshotDescribe()` keep long scenario trees tractable.
- `Artifacts.loadFromDeployment()` lets upgrade tests switch contract handles to the old deployment and then to the upgraded deployment without rewriting each test.
- The helper contracts under `contracts/contract/helper/` let the suite manufacture hard-to-reach states without compromising the production contracts.

## Key Files

| File | Why it matters |
|---|---|
| `package.json` | Declares the main test, fork, gas, upgrade, and coverage entrypoints. |
| `hardhat-common.config.js` | Base Hardhat/Mocha config shared by the suite. |
| `hardhat-fork.config.js` | Explicit evidence of fork support. |
| `hardhat-upgrade.config.js` | Upgrade-suite-specific config with production-like compiler settings. |
| `test/rocket-pool-tests.js` | Main orchestration file: deploy once, set defaults, snapshot per test, run invariants after each test. |
| `test/_helpers/deployment.js` | Test-specific deployment setup. |
| `test/_helpers/deployer.js` | Core staged deployer and contract registry writer. |
| `test/_utils/artifacts.js` | Custom artifact abstraction and storage-backed rehydration layer. |
| `test/_utils/snapshotting.js` | Fixture/snapshot abstraction, including `snapshotDescribe`. |
| `test/_helpers/invariants.js` | Deterministic cross-contract invariant checks. |
| `test/megapool/megapool-tests.js` | Best evidence of deep scenario coverage plus nested snapshot fixtures. |
| `test/node/node-staking-tests.js` | Strong example of snapshot-based branching from intermediate protocol states. |
| `test-upgrade/_helpers/upgrade.js` | Core upgrade harness. |
| `test-upgrade/tests/minipool-tests.js` | Strongest backward-compatibility upgrade scenarios. |
| `contracts/contract/helper/BeaconStateVerifierMock.sol` | Test-only proof bypass used to control consensus-layer complexity. |
| `.github/workflows/CI.yml` | Shows what CI actually runs today: only `npm test`. |

## Final Assessment

Rocket Pool has an advanced, scenario-centric Hardhat test architecture. Its strongest features are not fuzzing or fork depth; they are broad lifecycle coverage, a custom deployer, nested snapshot fixtures, storage-backed artifact reloading for upgrades, and deterministic cross-contract invariant checking after ordinary tests.

The best ideas worth reusing in other protocols are:
- a staged full-protocol deployer shared by tests and deployment scripts,
- storage-backed artifact rehydration for upgradeable registries,
- nested snapshot fixtures for very stateful scenarios,
- post-test invariant sweeps,
- test-only helper contracts for hard-to-reach states,
- separating proof-verification tests from downstream business-logic tests.

The main caveats are equally important:
- no fuzzing or differential harness was found,
- the fork suite is scaffolded but not implemented,
- gas reporting exists without gas-regression gates,
- CI only runs `npm test`,
- `test/minipool/minipool-tests.js:291` contains `it.only`,
- upgrade automation depends on an `old/` submodule path, and the inspected `old/` directory was empty.
