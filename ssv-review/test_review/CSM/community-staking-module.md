# Community Staking Module — Test Strategy Analysis

## Overview

The Community Staking Module (CSM) is a Lido protocol module enabling permissionless node operator participation. Its test suite is built entirely on **Foundry** (forge-std v1.9.6, ds-test), with no Hardhat or JS-based test runner. The repo demonstrates an **advanced** testing strategy characterized by a custom invariant assertion library, multi-fork upgrade comparison, and extensive mock infrastructure for the broader Lido ecosystem.

**Key numbers:** 30 unit test files, 14 fork/integration test files, 17 mock contracts, 7 helper files, 6 fixture files (74 total test-related files). ~40+ fuzz test functions, 10 custom invariant assertion functions, 5+ gas snapshot capture points.

---

## Detected Test Types

| Type | Status | Evidence |
|------|--------|----------|
| **Unit** | present | 30 `*.t.sol` files in `test/` root — one per contract/library (CSModule, CSAccounting, CSBondCurve, GIndex, SSZ, QueueLib, etc.) |
| **Integration** | present | 11 files in `test/fork/integration/` — full Lido protocol integration against mainnet fork (Oracle, StakingRouter, Penalty, CreateAndDeposit) |
| **Fork** | present | All integration tests use `vm.createSelectFork`. Multi-fork comparison in `test/fork/vote-upgrade/V2Upgrade.sol`. Anvil fork lifecycle in Justfile |
| **Fuzz** | present | 40+ `testFuzz_*` functions across SigningKeys, CSModule, GIndex, SSZ, CSBondCurve. Configured at 256 runs default, 10,000 in CI |
| **Invariant** | maybe | Custom `assertInvariants` modifier pattern with 10 assertion functions in `test/helpers/InvariantAsserts.sol`. However, **no Foundry native `invariant_*` tests** — no handler contracts, no `targetContract()`, no stateful fuzzing |
| **Scenario** | present | Multi-step workflow tests: `CreateAndDeposit.sol`, `Oracle.t.sol`, `StakingRouter.t.sol` exercise full operator lifecycle flows |
| **Differential** | maybe | `V2Upgrade.sol` compares state field-by-field across all node operators before and after an upgrade vote. This is upgrade-differential, not implementation-differential |
| **Regression** | not_found | No explicit regression markers, tags, or dedicated suite |
| **Upgrade** | present | `V2Upgrade.sol` simulates governance vote, `ProxyUpgrades.sol` tests proxy mechanics, OpenZeppelin upgrades-core validation via `just oz-upgrades` |
| **Gas** | present | `gas_report_include` for 11 contracts in `foundry.toml`. `vm.startSnapshotGas`/`vm.stopSnapshotGas` in fork tests (Oracle.t.sol, ClaimInTokens.t.sol, StakingRouter.t.sol) |

---

## Advanced Testing Techniques

### 1. Inline Invariant Modifier Pattern

**Complexity: High | Reusable: Yes**

The most distinctive pattern in this repo. Instead of Foundry's `invariant_*` engine, they define an `assertInvariants` Solidity modifier that wraps every test body:

```solidity
modifier assertInvariants() {
    _;
    vm.pauseGasMetering();
    assertCSMEnqueuedCount(csm);
    assertCSMKeys(csm);
    assertCSMUnusedStorageSlots(csm);
    vm.resumeGasMetering();
}
```

Each test function decorated with this modifier automatically validates 3–10 invariant properties after execution. Gas metering is paused during checks so invariant verification doesn't pollute gas measurements. Different test suites compose different subsets of the 10 available assertions.

**Evidence:** `test/helpers/InvariantAsserts.sol`, applied in `test/CSModule.t.sol`, `test/CSAccounting.t.sol`, `test/fork/integration/StakingRouter.t.sol`.

**The 10 invariant assertions:**

1. `assertCSMKeys` — Validator key state monotonicity: `added >= deposited >= withdrawn`, `deposited >= exited`, `vettedKeys >= depositedKeys`. Also verifies aggregated per-operator data matches `getStakingModuleSummary()`.
2. `assertCSMEnqueuedCount` — Deposit queue linked-list consistency: iterates all priority queues, walks batch linked list, sums keys per operator, verifies against `NodeOperator.enqueuedCount`.
3. `assertCSMUnusedStorageSlots` — Backward-compat: deprecated storage slots (`_accountingOld` at slot 2, `_earlyAdoption` at slot 3) must be zeroed. Uses `vm.load()`.
4. `assertAccountingTotalBondShares` — Bond shares sum across all operators matches `totalBondShares()`, and stETH contract balance >= total shares.
5. `assertAccountingBurnerApproval` — Burner allowance >= `type(uint128).max`.
6. `assertAccountingUnusedStorageSlots` — Deprecated `_feeDistributorOld` slot must be zeroed.
7. `assertFeeDistributorClaimableShares` — `lido.sharesOf(feeDistributor) >= feeDistributor.totalClaimableShares()`.
8. `assertFeeDistributorTree` — Merkle root/CID consistency: if root is zero, CID must be empty; if root is non-zero, CID must be populated.
9. `assertFeeOracleUnusedStorageSlots` — Deprecated oracle slots (0, 1) must be zeroed.
10. `assertStrikesTree` — Strikes Merkle tree root/CID consistency.

### 2. brutalizeMemory Modifier

**Complexity: Medium | Reusable: Yes**

Applied 40+ times in `test/CSModule.t.sol`, this modifier corrupts unused Solidity memory regions before test execution. Catches bugs where code reads from memory that was never explicitly written — a class of vulnerability invisible to normal testing. Particularly valuable when combined with fuzz testing.

**Evidence:** `test/CSModule.t.sol` — applied to `testFuzz_CreateNodeOperator`, `testFuzz_UploadKeys`, and many more.

### 3. Multi-Fork Upgrade State Comparison

**Complexity: High | Reusable: Yes**

`test/fork/vote-upgrade/V2Upgrade.sol` creates two Ethereum forks:

```solidity
function setUp() public {
    Env memory env = envVars();
    assertNotEq(env.VOTE_PREV_BLOCK, 0, "VOTE_PREV_BLOCK not set");
    forkIdBeforeUpgrade = vm.createFork(env.RPC_URL, env.VOTE_PREV_BLOCK);
    forkIdAfterUpgrade = vm.createSelectFork(env.RPC_URL);
    initializeFromDeployment();
}
```

Tests switch between forks with `vm.selectFork()` to verify that upgrade preserved expected state while applying expected mutations. Iterates through all node operators comparing field-by-field equivalence.

### 4. JSON Fixture-Driven Cryptographic Proof Verification

**Complexity: High | Reusable: Yes**

`test/CSVerifier.t.sol` and `test/CSVerifierHistoricalCrossForks.t.sol` load pre-generated JSON test vectors from `test/fixtures/CSVerifier/` (withdrawal proofs, beacon block headers, Merkle proofs) via `vm.readFile()` + `stdJson.parseRaw()`. A separate generator (`test/fixtures/CSVerifier/generator.mjs`) produces these fixtures from real beacon chain data.

**Fixture files:** `withdrawal.json`, `withdrawal_zero_index.json`, `historicalWithdrawal.json`, `historicalCrossForksWithdrawal.json`.

### 5. Cross-Beacon-Fork Historical Proof Testing

**Complexity: High | Reusable: No (domain-specific)**

`test/CSVerifierHistoricalCrossForks.t.sol` tests historical withdrawal proofs that span the Capella→Deneb beacon chain fork boundary. Uses `HistoricalHeaderWitness` to prove state across the pivot slot. This is highly specialized for beacon chain integration and validates that the verifier handles consensus layer fork transitions correctly.

### 6. Storage Slot Backward-Compatibility Assertions

**Complexity: Medium | Reusable: Yes**

Several invariant assertions use `vm.load()` to directly inspect storage slots that should remain empty after contract upgrades. This catches accidental storage slot collisions during upgrades — a critical concern for proxy-based architectures.

```solidity
function assertCSMUnusedStorageSlots(CSModule csm) internal view {
    bytes32 slot2 = vm.load(address(csm), bytes32(uint256(2))); // _accountingOld
    bytes32 slot3 = vm.load(address(csm), bytes32(uint256(3))); // _earlyAdoption
    assertEq(slot2, bytes32(0), "slot 2 not empty");
    assertEq(slot3, bytes32(0), "slot 3 not empty");
}
```

### 7. Governance Vote Simulation

**Complexity: High | Reusable: Yes**

`test/fork/vote-upgrade/V2Upgrade.sol` and helper scripts in `fork.just` simulate DAO governance votes (Aragon voting) against a forked mainnet. The flow: fork at pre-vote block → execute vote → run integration tests → compare state. Commands like `vote-add-module`, `vote-upgrade`, `pause-csm`, `resume-csm` are orchestrated via Justfile.

### 8. Conditional Invariant Execution by CI Profile

**Complexity: Medium | Reusable: Yes**

The `skipInvariants()` function in `InvariantAsserts.sol` gates invariant checks on two conditions:

1. `FOUNDRY_PROFILE == ci`
2. An active fork exists

This prevents expensive invariant checks (which walk all node operators and queue batches) from running in local dev while ensuring they always execute in CI. An elegant pattern for balancing development speed with correctness assurance.

### 9. Gas Snapshot Metering

**Complexity: Low | Reusable: Yes**

Fork tests capture gas snapshots for key operations:

```solidity
vm.startSnapshotGas("CSFeeOracle.submitReportData_fees");
oracle.submitReportData(data, contractVersion);
vm.stopSnapshotGas();
```

Found in `Oracle.t.sol`, `ClaimInTokens.t.sol`, `StakingRouter.t.sol`, and `Misc.t.sol`. Combined with `gas_report_include` in `foundry.toml` covering 11 contracts.

---

## Complexity Management Patterns

### Fork Test Complexity

| Pattern | Description |
|---------|-------------|
| Environment-driven config | `RPC_URL`, `DEPLOY_CONFIG`, `VOTE_PREV_BLOCK` injected as env vars — same tests target mainnet, holesky, hoodi, or local-devnet |
| Deployment state hydration | Tests load contract addresses from `artifacts/{chain}/deploy-{chain}.json` rather than hardcoding |
| Justfile orchestration | 10+ commands: `test-local`, `test-full-deploy`, `test-v2-only-deploy`, `test-upgrade`, `make-fork`, `kill-fork` |
| Profile isolation | `[profile.coverage]` doubles gas limit to 60M; `[profile.ci]` increases fuzz runs 40× |
| Multi-fork comparison | `vm.createFork` at two different blocks, `vm.selectFork` to switch |

### Fuzz Test Complexity

| Pattern | Description |
|---------|-------------|
| Tiered execution | 256 runs for dev, 10,000 for CI, `max_test_rejects = 2,000,000` |
| Memory safety amplification | `brutalizeMemory` modifier layered onto fuzz tests |
| Deterministic test data | `nextAddress()` (SHA3 seed), `keysSignatures()` (validator keys), `randomBytes()` — all deterministic for reproducibility |

### Invariant Complexity

| Pattern | Description |
|---------|-------------|
| Composable assertion sets | Different test suites compose different subsets of the 10 assertion functions |
| Gas-isolated checks | `vm.pauseGasMetering()` / `vm.resumeGasMetering()` around invariant checks |
| Profile-gated execution | `skipInvariants()` ensures expensive walks only execute in CI |
| Storage slot inspection | `vm.load()` for direct slot verification of backward-compat constraints |

---

## Test Architecture

### Fixture Hierarchy

```
CSMFixtures (abstract) — deploys all contracts, provides helpers
  ├── CSMCommon — full role setup, default operator creation
  │     └── 43 concrete test contracts in CSModule.t.sol
  └── CSMCommonNoRoles — no CREATE_NODE_OPERATOR_ROLE
        └── CSMAccessControl, CSMStakingRouterAccessControl

CSAccountingFixtures — accounting-specific setup with mock staking module
  └── 20+ concrete test contracts in CSAccounting.t.sol

DeploymentFixtures (fork tests) — loads from deployment JSON
  └── Fork integration test contracts
```

### Mock Infrastructure

17 mock contracts in `test/helpers/mocks/` covering the full Lido ecosystem surface:

| Mock | Purpose |
|------|---------|
| LidoMock, StETHMock, WstETHMock | Core Lido token mechanics |
| LidoLocatorMock | Service locator for Lido addresses |
| BurnerMock | stETH burning |
| WithdrawalQueueMock | Withdrawal queue |
| CSAccountingMock | Accounting with test-only hooks |
| CSStrikesMock, ExitPenaltiesMock | Penalty subsystem |
| CSParametersRegistryMock | Config registry |
| DistributorMock | Fee distribution |
| ConsensusContractMock | Oracle consensus |
| ReportProcessorMock | Oracle report processing |
| EjectorMock | Validator ejection |
| TWGMock | Triggerable withdrawals gateway |
| Stub | Generic stub for any interface |
| CSMMock | CSModule mock for isolated testing |

### Helper Utilities

| File | Purpose |
|------|---------|
| `test/helpers/Fixtures.sol` | Lido mock initialization, deployment config parsing, `_enableInitializers()` via storage slot manipulation |
| `test/helpers/Utilities.sol` | Deterministic address/key generation, array helpers, `expectRoleRevert()`, `shuffle()` |
| `test/helpers/InvariantAsserts.sol` | 10 invariant assertion functions with conditional execution |
| `test/helpers/MerkleTree.sol` | Merkle tree construction for fee distribution and strikes testing |
| `test/helpers/Permit.sol` | EIP-2612 permit signature helpers |
| `test/helpers/ERCTestable.sol` | ERC-20 test wrappers |

---

## Key Files

| File | Role |
|------|------|
| `test/helpers/InvariantAsserts.sol` | 10 custom invariant assertion functions, conditional execution logic |
| `test/helpers/Fixtures.sol` | Lido mock initialization, deployment config parsing, `_enableInitializers()` |
| `test/helpers/Utilities.sol` | Deterministic test data generation, array helpers, role revert helpers |
| `test/CSModule.t.sol` | Largest test file: 43 contract classes, 500+ tests, brutalizeMemory usage |
| `test/CSAccounting.t.sol` | Accounting tests with ETH-to-stETH round-trip precision verification |
| `test/fork/vote-upgrade/V2Upgrade.sol` | Multi-fork upgrade state comparison |
| `test/fork/integration/StakingRouter.t.sol` | Full invariant suite in fork context, gas snapshots |
| `test/fork/integration/misc/Invariants.t.sol` | Dedicated fork invariant execution with `noGasMetering` |
| `test/CSVerifierHistoricalCrossForks.t.sol` | Cross-beacon-fork proof testing |
| `foundry.toml` | 5 profiles (default, ci, coverage, deploy, upgrades), gas reports for 11 contracts |
| `Justfile` | 30+ commands for test orchestration, fork management, deployment flows |
| `test/fixtures/CSVerifier/generator.mjs` | Generates JSON test vectors from real beacon chain data |

---

## Final Assessment

**Maturity: Advanced**

The Community Staking Module demonstrates a well-engineered testing strategy with several genuinely sophisticated patterns — most notably the composable `assertInvariants` modifier that post-conditions every test with protocol-wide property checks, and the multi-fork upgrade comparison that verifies governance vote execution at the storage level.

### Strengths Worth Reusing

1. **Inline invariant modifier pattern** — pragmatic alternative to Foundry's invariant engine when you want deterministic, per-test property checking rather than stateful random exploration. Every test automatically validates protocol-wide properties.
2. **`skipInvariants()` conditional gating** — elegantly balances dev speed vs. CI thoroughness by profile-gating expensive invariant walks.
3. **Storage slot backward-compatibility assertions** — essential for any upgradeable proxy system; catches slot collisions that could corrupt state during upgrades.
4. **`brutalizeMemory` in fuzz contexts** — catches a real class of Solidity bugs (reading uninitialized memory) that normal testing misses entirely.
5. **Multi-fork state comparison** — the V2Upgrade pattern of creating pre/post-vote forks and comparing state field-by-field is directly applicable to any governance-gated protocol upgrade.
6. **Tiered fuzz configuration** — simple but effective: 256 runs for fast local iteration, 10,000 in CI with tuned rejection limits.

### Notable Gaps

1. **No Foundry native invariant_* tests** — The repo's invariant checks are comprehensive but deterministic. They verify properties after scripted scenarios, not after random state exploration via handlers. A handler-based approach would explore state transitions the team hasn't explicitly scripted.
2. **No external fuzzer integration** — No Echidna or Medusa despite good Foundry fuzz coverage. External fuzzers bring different exploration strategies.
3. **No explicit regression test suite** — Upgrade tests implicitly serve as regression tests, but there are no markers, tags, or dedicated regression files.
4. **No differential testing** — The upgrade comparison is structural (same implementation, different state), not behavioral (alternative implementation, same interface).
5. **No mutation testing** — No evidence of tools like `vertigo` or `gambit` to validate that the test suite catches the bugs it should catch.
6. **Standard fuzz patterns** — No custom input generators, guided fuzzing, or corpus management. Fuzz tests rely on Foundry's default random input generation.
