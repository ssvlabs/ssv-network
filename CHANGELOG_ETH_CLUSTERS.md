# Changelog - ETH Clusters Feature

This changelog documents all changes made for the ETH Clusters feature implementation, which enables native ETH-based cluster operations alongside existing SSV token-based clusters.

## Overview

This feature introduces a version-based system that allows clusters and operators to operate using native ETH instead of SSV tokens. The implementation maintains full backward compatibility with existing SSV token-based clusters while enabling new ETH-based operations.

## Core Architecture Changes

### Version System

A centralized version system has been implemented to distinguish between SSV token-based and ETH-based operations:

- **Version 0 (VERSION_SSV)**: SSV token-based operations
  - Clusters stored in `clusters` mapping
  - Payments via SSV token transfers
  - Operators with version 0 use SSV token fees

- **Version 1 (VERSION_ETH)**: ETH-based operations
  - Clusters stored in `ethClusters` mapping
  - Payments via native ETH (`msg.value`)
  - Operators with version 1 use ETH fees

- **Version Constants**: Centralized in `CoreLib`
  - `VERSION_SSV = 0`
  - `VERSION_ETH = 1`
  - `VERSION_UNDEFINED = type(uint8).max`

## Changes by Component

### Core Library (`contracts/libraries/CoreLib.sol`)

#### Version Constants
- **Added version constants**:
  - `uint8 internal constant VERSION_SSV = 0`
  - `uint8 internal constant VERSION_ETH = 1`
  - `uint8 internal constant VERSION_UNDEFINED = type(uint8).max`

#### Balance Transfer Functions
- **Refactored `transferBalance()`**:
  - Now handles native ETH transfers via `call{value: amount}`
  - Changed parameter type from `address` to `address payable`
  - Reverts with `ETHTransferFailed` error on failure

- **New function `transferTokenBalance()`**:
  - Extracted SSV token transfer logic from original `transferBalance()`
  - Uses `token.transfer()` for SSV token transfers
  - Reverts with `TokenTransferFailed` error on failure

### Storage (`contracts/libraries/SSVStorage.sol`)

- **Added `ethClusters` mapping**:
  - `mapping(bytes32 => bytes32) ethClusters` - Stores ETH-based cluster data separately from SSV token clusters
  - Enables parallel storage for both cluster types

### Cluster Library (`contracts/libraries/ClusterLib.sol`)

#### Version-Aware Operations
- **Updated `validateHashedCluster()`**:
  - Now returns `(bytes32 hashedCluster, uint8 version)` tuple
  - Automatically detects cluster version by checking both storage mappings
  - Validates cluster existence and state

- **Updated `validateClusterOnRegistration()`**:
  - Validates cluster version matches `VERSION_ETH` for new registrations
  - Ensures version consistency during registration

- **Updated `updateClusterOnRegistration()`**:
  - Always stores new clusters in `ethClusters` mapping (version 1)
  - Ensures all new registrations use ETH-based storage

- **New function `getClusterData()`**:
  - Checks both `clusters` and `ethClusters` mappings
  - Returns cluster data and detected version
  - Prioritizes SSV clusters (version 0) for backward compatibility

- **New function `validateClusterVersion()`**:
  - Validates that cluster version matches expected version
  - Reverts with `IncorrectClusterVersion` error if mismatch

### SSV Clusters Module (`contracts/modules/SSVClusters.sol`)

The `SSVClusters` module has been completely refactored to support both ETH and SSV token clusters with version-aware operations.

#### Registration Functions
- **`registerValidator()` and `bulkRegisterValidator()`**:
  - Now `payable` to accept ETH deposits
  - Validates operators are version 1 (ETH) using `OperatorLib.ensureOperatorVersion()`
  - Uses `msg.value` for balance deposits
  - Stores clusters in `ethClusters` mapping (version 1)

#### Removal Functions
- **`removeValidator()` and `bulkRemoveValidator()`**:
  - Version-aware storage updates
  - Detects cluster version and updates appropriate mapping (`ethClusters` or `clusters`)
  - Reverts with `IncorrectClusterVersion` if version is invalid

#### Liquidation and Reactivation
- **`liquidate()`**:
  - Public function that calls internal `_liquidate()`
  - Emits `ClusterLiquidated` event

- **Internal `_liquidate()` function**:
  - Version-aware liquidation logic
  - ETH clusters: Transfers balance via `CoreLib.transferBalance()` (ETH)
  - SSV clusters: Transfers balance via `CoreLib.transferTokenBalance()` (SSV tokens)
  - Updates appropriate storage mapping based on version

- **`reactivate()`**:
  - Public function that calls internal `_reactivate()`
  - Emits `ClusterReactivated` event

- **Internal `_reactivate()` function**:
  - Validates operators are version 1 (ETH)
  - Accepts ETH via `msg.value`
  - Always stores reactivated clusters in `ethClusters` mapping (version 1)
  - Migrates SSV clusters to ETH clusters upon reactivation

#### Deposit and Withdraw
- **`deposit()`**:
  - **Automatic migration**: If cluster is SSV (version 0), automatically migrates to ETH:
    1. Liquidates the SSV cluster (transfers SSV balance to liquidator)
    2. Reactivates as ETH cluster (version 1)
    3. Stores in `ethClusters` mapping
  - If cluster is already ETH (version 1), simply adds `msg.value` to balance
  - Emits both `ClusterLiquidated` and `ClusterReactivated` events during migration

- **`withdraw()`**:
  - Version-aware withdrawal
  - ETH clusters: Uses `CoreLib.transferBalance()` for ETH transfers
  - SSV clusters: Uses `CoreLib.transferTokenBalance()` for SSV token transfers
  - Updates appropriate storage mapping based on version

#### Exit Functions
- **`exitValidator()` and `bulkExitValidator()`**:
  - No changes to logic, remain version-agnostic
  - Emit `ValidatorExited` events

### Operator Library (`contracts/libraries/OperatorLib.sol`)

- **New function `ensureOperatorVersion()`**:
  - Validates that all operators in a list match the expected version
  - Checks operator version against expected version
  - Allows operators with zero fee to have any version (for backward compatibility)
  - Reverts with `IncorrectOperatorVersion` error if version mismatch

### SSV Operators Module (`contracts/modules/SSVOperators.sol`)

#### Operator Registration
- **`registerOperator()`**:
  - New operators registered with `version: CoreLib.VERSION_ETH` (version 1)
  - All new operators default to ETH-based fees

#### Fee Management
- **`declareOperatorFee()`**:
  - Refactored to call internal `_declareOperatorFee()`
  - Fee change requests now include `version: CoreLib.VERSION_ETH`

- **Internal `_declareOperatorFee()` function**:
  - Extracted as internal virtual function for reusability
  - Sets `version: CoreLib.VERSION_ETH` in `OperatorFeeChangeRequest` struct

- **`executeOperatorFee()`**:
  - **Migration logic**: If operator version is `VERSION_SSV`, automatically migrates to `VERSION_ETH`
  - Updates operator version to ETH when fee is executed

- **`reduceOperatorFee()`**:
  - **Migration logic**: If operator version is `VERSION_SSV`, automatically migrates to `VERSION_ETH`
  - Updates operator version to ETH when fee is reduced

- **New function `migrateToEth()`**:
  - Public function to explicitly migrate operators to ETH-based fees
  - Withdraws all operator earnings first
  - Then declares new fee (which sets version to ETH)

#### Earnings Withdrawal
- **`_withdrawOperatorEarnings()`**:
  - Version-aware withdrawal logic
  - ETH operators (version 1): Uses `_transferOperatorBalanceUnsafe()` for ETH transfers
  - SSV operators (version 0): Uses `_transferOperatorTokenBalanceUnsafe()` for SSV token transfers

- **`_transferOperatorBalanceUnsafe()`**:
  - Transfers ETH via `CoreLib.transferBalance()`
  - Emits `OperatorWithdrawn` event

- **`_transferOperatorTokenBalanceUnsafe()`**:
  - Transfers SSV tokens via `CoreLib.transferTokenBalance()`
  - Emits `OperatorWithdrawn` event

### SSV DAO Module (`contracts/modules/SSVDAO.sol`)

- **`withdrawNetworkEarnings()` / `withdrawNetworkEarningsETH()`**:
  - Legacy function continues to settle SSV-denominated earnings, while the new ETH-specific function withdraws native balances
  - Both leverage version-aware accounting under the hood and emit `NetworkEarningsWithdrawn` with the withdrawn asset version

### Interface Changes

#### ISSVClusters (`contracts/interfaces/ISSVClusters.sol`)

- **All functions made `payable`**:
  - `registerValidator()`
  - `bulkRegisterValidator()`
  - `liquidate()`
  - `reactivate()`
  - `deposit()`
  - `withdraw()`

- **Event declarations moved to interface**:
  - `ValidatorAdded`
  - `ValidatorRemoved`
  - `ClusterLiquidated`
  - `ClusterReactivated`
  - `ClusterWithdrawn`
  - `ClusterDeposited`
  - `ValidatorExited`

#### ISSVNetworkCore (`contracts/interfaces/ISSVNetworkCore.sol`)

- **Added `version` field to `Operator` struct**:
  - `uint8 version` - Operator struct version (0 = SSV fees, 1 = ETH fees)

- **Added `version` field to `OperatorFeeChangeRequest` struct**:
  - `uint8 version` - Fee change request version

- **New errors**:
  - `ETHTransferFailed()` - Reverts when ETH transfer fails (error code: 0xb12d13eb)
  - `IncorrectClusterVersion()` - Reverts when cluster version doesn't match expected version (error code: 0xf6749746)
  - `IncorrectOperatorVersion(uint8 operatorVersion)` - Reverts when operator version doesn't match expected version (error code: 0xf222e863)

#### ISSVOperators (`contracts/interfaces/ISSVOperators.sol`)

- **Updated `OperatorFeeDeclared` event**:
  - Added `uint8 version` parameter to track fee change version
  - Note: Event signature updated but version parameter may not be explicitly emitted in all implementations

### Main Contract (`contracts/SSVNetwork.sol`)

- **All cluster functions made `payable`**:
  - `registerValidator()`
  - `bulkRegisterValidator()`
  - `liquidate()`
  - `reactivate()`
  - `deposit()`
  - `withdraw()`

  This enables ETH transfers through the main contract delegate calls.

### Test Contracts

#### SSVNetworkUpgrade (`contracts/test/SSVNetworkUpgrade.sol`)
- Updated to accommodate interface changes

#### SSVOperatorsUpdate (`contracts/test/modules/SSVOperatorsUpdate.sol`)
- Updated to accommodate interface changes (version parameter in events)

## Migration Path

### Automatic Cluster Migration

The `deposit()` function provides automatic migration from SSV to ETH clusters:

1. When depositing to an SSV cluster (version 0):
   - Cluster is liquidated (SSV balance transferred to liquidator)
   - Cluster is reactivated as ETH cluster (version 1)
   - New deposit (ETH) is added to balance
   - Cluster stored in `ethClusters` mapping

2. When depositing to an ETH cluster (version 1):
   - ETH value is simply added to existing balance
   - No migration needed

### Operator Migration

Operators automatically migrate to ETH version when:
- Fee is executed via `executeOperatorFee()`
- Fee is reduced via `reduceOperatorFee()`
- Explicitly migrated via `migrateToEth()`

## Backward Compatibility

- **Existing SSV clusters (version 0) continue to function unchanged**
- **SSV token-based operations remain fully supported**
- **Both cluster types can coexist in the same network**
- **Operators with zero fee can have any version** (for backward compatibility)
- **Version detection is automatic** - no manual version specification required

## Technical Details

### Storage Layout

- **SSV Clusters**: Stored in `s.clusters[hashedCluster]` (version 0)
- **ETH Clusters**: Stored in `s.ethClusters[hashedCluster]` (version 1)
- **Version Detection**: `ClusterLib.getClusterData()` checks both mappings and returns detected version

### Balance Handling

- **ETH Clusters**: Use `CoreLib.transferBalance()` for native ETH transfers
- **SSV Clusters**: Use `CoreLib.transferTokenBalance()` for SSV token transfers
- **Deposits**: ETH clusters accept `msg.value`, SSV clusters would use token approval (legacy)

### Version Validation

- **Cluster Version**: Validated via `ClusterLib.validateClusterVersion()`
- **Operator Version**: Validated via `OperatorLib.ensureOperatorVersion()`
- **Registration**: New clusters always use version 1 (ETH)
- **Operations**: Version is auto-detected from storage

## Files Modified

1. `contracts/libraries/CoreLib.sol` - Version constants and transfer functions
2. `contracts/libraries/SSVStorage.sol` - Added `ethClusters` mapping
3. `contracts/libraries/ClusterLib.sol` - Version-aware cluster operations
4. `contracts/libraries/OperatorLib.sol` - Version validation function
5. `contracts/modules/SSVClusters.sol` - Complete refactor for dual-version support
6. `contracts/modules/SSVOperators.sol` - ETH version defaults and migration logic
7. `contracts/modules/SSVDAO.sol` - Token transfer update
8. `contracts/interfaces/ISSVClusters.sol` - Payable functions and events
9. `contracts/interfaces/ISSVNetworkCore.sol` - Version fields and new errors
10. `contracts/interfaces/ISSVOperators.sol` - Version in fee declaration event
11. `contracts/SSVNetwork.sol` - Payable function signatures
12. `contracts/test/SSVNetworkUpgrade.sol` - Interface compatibility updates
13. `contracts/test/modules/SSVOperatorsUpdate.sol` - Interface compatibility updates
14. `.solhint.json` - Configuration updates
15. `package-lock.json` - Dependency updates

## Statistics

- **Total files changed**: 15
- **Major refactoring**: SSVClusters module completely rewritten for dual-version support
- **New storage mapping**: `ethClusters` for ETH-based clusters
- **New version system**: Centralized constants in CoreLib
- **Automatic migration**: Built into deposit and operator fee operations

## Commit History

The following commits represent the development of this feature:

1. `9714da7` - feat: add ETH clusters support with version-based storage system
2. `04c82e2` - ETH_Cluster added to storage, initializeV2 added, cluster lib refactored
3. `539932e` - version removed from ssv cluster
4. `ed307dc` - feat(eth-clusters): add version validation and SSV cluster support
5. `7bf8202` - ensure operator version added
6. `5080118` - merge into SSVClusters
7. `b76b85c` - ETH_CLUSTERS removed
8. `2bd9b5c` - ETH_CLUSTERS removed
9. `f70011f` - refactor: centralize version constants in CoreLib
10. `9b36110` - migration to eth added to reduce and execute
