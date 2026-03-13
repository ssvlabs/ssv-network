# CLAUDE.md — SSV Network Smart Contracts

This file guides Claude Code when working with the SSV Network smart contracts repository. Read this fully before making any changes.

## Project Overview

SSV Network is a decentralized Ethereum staking infrastructure using Secret Shared Validators (SSV/DVT). This repository contains the on-chain smart contracts that manage operators, validators, clusters, and protocol economics.

**Current Release Target: v2.0.0 — "SSV Staking"**

This release introduces three tightly coupled upgrades:
1. **ETH Payments** — transition from SSV-token fees to native ETH-denominated fees
2. **Effective Balance (EB) Accounting** — fees scale with actual validator effective balance instead of fixed 32 ETH assumption
3. **SSV Staking** — SSV holders stake tokens, receive cSSV, and earn pro-rata ETH protocol revenue

## Build & Test Commands

```bash
npm install                    # Install dependencies
just build                     # Compile contracts (force recompile)
just test                      # Run all tests
just test-unit                 # Run unit tests only (test/unit/)
just test-integration          # Run integration tests only (test/integration/)
just test-forked               # Run fork tests (requires MAINNET_ETH_NODE_URL in .env)
just coverage                  # Generate coverage report + HTML output
```

**Foundry (for Echidna fuzzing):**
```bash
forge build                    # Build with Foundry
# Echidna tests are in test/echidna/
```

## Architecture

### Module System (UUPS Proxy + Delegatecall)

SSVNetwork.sol is a UUPS upgradeable proxy that routes calls via `delegatecall` to specialized modules:

```
SSVNetwork (proxy, UUPS, Ownable2Step)
  ├── SSV_OPERATORS           → SSVOperators.sol
  ├── SSV_CLUSTERS            → SSVClusters.sol
  ├── SSV_DAO                 → SSVDAO.sol
  ├── SSV_VIEWS               → SSVViews.sol (also fallback)
  ├── SSV_OPERATORS_WHITELIST → SSVOperatorsWhitelist.sol
  ├── SSV_STAKING             → SSVStaking.sol
  └── SSV_VALIDATORS          → SSVValidators.sol
```

### Storage Pattern (Diamond/EIP-2535 style)

All state is stored at deterministic slots via `keccak256(slot) - 1` with inline assembly. **Never add storage variables to module contracts directly** — all state goes through storage libraries.

| Storage | Slot Key | Purpose |
|---|---|---|
| SSVStorage | `ssv.network.storage.main` | Operators, clusters, validators, module addresses, token |
| SSVStorageProtocol | `ssv.network.storage.protocol` | Fee indices, DAO balances, liquidation params (both SSV and ETH) |
| SSVStorageEB | `ssv.network.storage.eb` | Merkle roots, cluster EB snapshots, oracle voting, operator vUnits |
| SSVStorageStaking | `ssv.network.storage.staking` | Staking state, rewards accumulator, oracles, withdrawal requests |
| SSVStorageReentrancy | `ssv.network.storage.reentrancy` | Custom reentrancy guard status |

### Dual Cluster System

The protocol maintains two parallel cluster records during the transition period:
- `s.clusters[hash]` — legacy SSV-denominated clusters (VERSION_SSV = 0)
- `s.ethClusters[hash]` — new ETH-denominated clusters (VERSION_ETH = 1)

Each operator tracks dual snapshots: SSV (`.snapshot`, `.fee`, `.validatorCount`) and ETH (`.ethSnapshot`, `.ethFee`, `.ethValidatorCount`).

### Packed Types (Critical for Precision)

```
PackedSSV (uint64): actual_value = raw * 10_000_000   (DEDUCTED_DIGITS)
PackedETH (uint64): actual_value = raw * 100_000       (ETH_DEDUCTED_DIGITS)
```

Values not divisible by the precision factor revert with `MaxPrecisionExceeded`.

## Key Accounting Rules

### ETH Cluster Fee Calculation (vUnit Model)

```
vUnits = ceil(effectiveBalanceETH * 10_000 / 32)
operatorFee = blockDiff * ethFee * effectiveVUnits / BPS_DENOMINATOR
networkFee = (networkFeeIndexDelta * effectiveVUnits) / BPS_DENOMINATOR
totalFees = (operatorFeeUnits + networkFeeUnits) * ETH_DEDUCTED_DIGITS
cluster.balance -= totalFees
```

- Implicit EB (default): `vUnits = validatorCount * 10_000` (assumes 32 ETH/validator)
- Explicit EB: set after first `updateClusterBalance` oracle update

### SSV Cluster Fee Calculation (Legacy)

```
fees = (operatorIndexDelta + networkFeeIndexDelta) * validatorCount
cluster.balance -= unpack(fees)
```

### ETH Liquidation Check

```
liquidatable IF:
  balance < minimumLiquidationCollateral (0.00094 ETH)
  OR balance < minimumBlocksBeforeLiquidation * (burnRate + networkFee) * vUnits / BPS_DENOMINATOR * ETH_DEDUCTED_DIGITS
```

### Staking Rewards (Accumulator Pattern)

```
accEthPerShare += (newFeesWei * 1e18) / totalCSSVSupply
pendingReward = cSSVBalance * (accEthPerShare - userIndex) / 1e18
```

Rewards settle on: stake, requestUnstake, claimEthRewards, cSSV transfer (via onCSSVTransfer hook).

## Governance Parameters (DIP-X Proposed Values)

| Parameter | Value | Update Function |
|---|---|---|
| ethNetworkFee | 0.000000003550900000 ETH/block (~0.00928 ETH/year) | `updateNetworkFee(uint256)` |
| minimumLiquidationCollateral | 0.00094 ETH | `updateMinimumLiquidationCollateral(uint256)` |
| minimumBlocksBeforeLiquidation | 50190 (~7 days) | `updateLiquidationThresholdPeriod(uint64)` |
| defaultOperatorETHFee | 0.000000001775400000 ETH/block (~0.00464 ETH/year) | Hardcoded in contract |
| cooldownDuration | 604,800 seconds (7 days) | `setUnstakeCooldownDuration(uint64)` |
| quorumBps | 7500 (75%) | `setQuorumBps(uint16)` |
| Oracle set | 4 oracles, 3-of-4 threshold | `replaceOracle(uint32, address)` |

## Security Rules — MUST Follow

### Reentrancy
- All functions that transfer ETH or tokens MUST use the `nonReentrant` modifier
- The custom reentrancy guard lives at a deterministic storage slot (NOT inherited state)
- Currently protected: `liquidate`, `liquidateSSV`, `withdraw`, `updateClusterBalance`, all operator withdrawals, all staking functions, `withdrawNetworkSSVEarnings`
- Intentionally NOT protected (no external calls before state writes): `reactivate`, `deposit`, `migrateClusterToETH`, validator register/remove

### Storage Safety
- NEVER add storage variables to module contracts — use the diamond storage pattern
- NEVER modify existing storage struct field order — append only
- When adding new storage fields, add them at the END of the struct
- Verify storage slot computation matches the pattern: `keccak256(abi.encode(SLOT_STRING)) - 1`

### Access Control
- Owner-only functions are enforced at the SSVNetwork proxy level (Ownable2Step), not in modules
- Oracle-only: `commitRoot` checks `oracleIdOf[msg.sender] != 0`
- cSSV-only: `onCSSVTransfer` checks `msg.sender == CSSV_ADDRESS`
- Operator owner: `operator.checkOwner()` verifies `msg.sender == operator.owner`
- Cluster owner: keyed by `keccak256(owner, operatorIds)` — only owner can call cluster management functions

### Upgrade Safety
- UUPS pattern — `_authorizeUpgrade` is owner-only
- New initializers use `reinitializer(N)` (current: N=3 for v2.0.0)
- `UPGRADE_TIMESTAMP` immutable in SSVOperators prevents pre-migration fee declarations from being executed post-migration

### Integer Overflow/Precision
- All fee calculations use packed types — be aware of precision loss from packing/unpacking
- vUnit conversions use ceiling division for ETH→vUnits, floor for vUnits→ETH
- Cluster balance underflow: use `max(0, balance - fees)` pattern, never allow negative

### Oracle Security
- Merkle proofs use OpenZeppelin's double-hash convention: `keccak256(keccak256(abi.encode(clusterID, effectiveBalance)))`
- EB limits enforced: min 32 ETH/validator, max 2048 ETH/validator
- Block numbers must be strictly monotonically increasing (`blockNum > latestCommittedBlock`)
- Quorum is weighted by equal cSSV splits across oracle slots

## Backward Compatibility (Critical)

Any changes to events or function signatures can break external integrations (oracle, liquidator bots, SDK, webapp). Before modifying:

1. **Events**: The SSV Oracle (`github.com/ssvlabs/ssv-oracle`) subscribes to: `ValidatorAdded`, `ValidatorRemoved`, `ClusterLiquidated`, `ClusterReactivated`, `ClusterWithdrawn`, `ClusterDeposited`, `ClusterMigratedToETH`, `ClusterBalanceUpdated`, `RootCommitted`, `WeightedRootProposed`. Changing these signatures requires oracle client updates.

2. **Function signatures**: `registerValidator`, `bulkRegisterValidator`, `deposit`, `reactivate` have already changed (removed `amount` param, added `payable`). The `getBalance` view now returns `(uint256 balance, uint256 ebBalance)` instead of just `uint256`.

3. **Cluster struct**: `(uint32 validatorCount, uint64 networkFeeIndex, uint64 index, bool active, uint256 balance)` — changing this struct breaks ALL event decoding and function calls.

4. When in doubt, check the oracle repo at `github.com/ssvlabs/ssv-oracle` for ABI dependencies.

## Working Branch & Git Workflow

- **Working branch**: `ssv-staking` (contains all v2.0.0 changes)
- **Create feature branches off `ssv-staking`** for each task, then PR back
- Follow existing commit message conventions in the repo

## Project Structure

```
contracts/
├── SSVNetwork.sol                    # UUPS proxy + routing
├── SSVNetworkViews.sol               # Read-only views contract
├── SSVProxy.sol                      # Delegatecall base
├── abstract/SSVReentrancyGuard.sol   # Custom reentrancy guard
├── interfaces/                       # All interfaces (ISSVClusters, ISSVDAO, ISSVStaking, etc.)
├── libraries/
│   ├── ClusterLib.sol                # Cluster operations (balance, liquidation, hashing)
│   ├── OperatorLib.sol               # Operator operations (snapshots, fees, validation)
│   ├── ValidatorLib.sol              # Validator registration/removal logic
│   ├── ProtocolLib.sol               # Protocol-level accounting (DAO, indices)
│   ├── CoreLib.sol                   # Token transfers, module management
│   ├── SSVPackedLib.sol              # Packed type packing/unpacking
│   ├── SSVCoreTypes.sol              # Type definitions (PackedSSV, PackedETH, Snapshot, etc.)
│   └── storage/                      # Diamond storage structs
├── modules/
│   ├── SSVClusters.sol               # Cluster lifecycle (deposit, withdraw, liquidate, migrate, updateEB)
│   ├── SSVDAO.sol                    # Governance, oracle management, fee params
│   ├── SSVOperators.sol              # Operator management, fee changes, earnings withdrawal
│   ├── SSVOperatorsWhitelist.sol     # Whitelist management (bitmap + contracts)
│   ├── SSVStaking.sol                # SSV staking, cSSV rewards, unstaking
│   ├── SSVValidators.sol             # Validator register/remove/exit
│   └── SSVViews.sol                  # View function implementations
├── token/
│   ├── SSVToken.sol                  # SSV ERC-20 token
│   └── CSSVToken.sol                 # cSSV receipt token (mint/burn by SSVStaking only)
├── whitelisting/BasicWhitelisting.sol
└── upgrades/stage/hoodi/            # Upgrade initializer (reinitializer(3))
scripts/                              # Deployment & upgrade scripts (TypeScript)
test/
├── unit/                             # Per-module unit tests
├── integration/                      # Full integration tests
├── sanity/                           # Sanity/regression tests
├── echidna/                          # Foundry-based fuzzing
├── test-forked/                      # Fork tests against v1.2.0
├── helpers/                          # Test utilities
├── common/                           # Constants, errors, events, types
└── setup/                            # Deploy, fixtures, fork setup
```

## Key Constants

```
BPS_DENOMINATOR = 10_000
MAX_EB_PER_VALIDATOR = 2048 ETH
DEFAULT_EB_PER_VALIDATOR = 32 ETH
ETH_DEDUCTED_DIGITS = 100_000
DEDUCTED_DIGITS = 10_000_000
DEFAULT_OPERATOR_ETH_FEE = 1_770_000_000 wei (1.77 gwei/vUnit/block)
MINIMAL_LIQUIDATION_THRESHOLD = 21_480 blocks
MAX_PENDING_REQUESTS = 2000
MINIMAL_STAKING_AMOUNT = 1_000_000_000
MAX_DELEGATION_SLOTS = 4
VERSION_SSV = 0
VERSION_ETH = 1
```

## Reference Documentation

- **docs/SPEC.md** — Full DIP-X specification with detailed accounting formulas, storage layout, and all function/event signatures
- **docs/FLOWS.md** — Step-by-step contract flows with state mutations, invariants, and sequence diagrams
- **ssv-review/** — Original proposal documents and mainnet readiness coverage report

## Test Expectations

When writing tests:
- Use the existing test helper patterns in `test/helpers/contract-helpers.ts`
- Follow the Mocha + Chai + ethers v6 patterns used in existing tests
- Include both happy path and revert/edge case tests
- Verify event emissions with exact parameter matching
- Check balance invariants before and after operations (contract ETH balance, SSV token balance, operator earnings, cluster balances)
- For migration tests: verify both SSV balance refund AND ETH deposit correctness
- For staking tests: verify accEthPerShare accumulator math with precision
