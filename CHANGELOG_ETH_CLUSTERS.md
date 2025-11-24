# Changelog - ETH Clusters Feature

This changelog documents all changes made for the ETH Clusters feature implementation, which enables native ETH-based cluster operations alongside existing SSV token-based clusters.

## Overview

This feature introduces a version-based system that allows clusters and operators to operate using native ETH instead of SSV tokens. The implementation maintains full backward compatibility with existing SSV token-based clusters while enabling new ETH-based operations. Operators can now maintain separate SSV and ETH fee structures simultaneously, and the DAO supports versioned accounting for both asset types.

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

### Dual Fee System for Operators

Operators now support **dual fee structures** - they can maintain separate SSV token fees and ETH fees simultaneously:
- **SSV fees**: Tracked via `fee` and `snapshot` fields
- **ETH fees**: Tracked via `ethFee` and `ethSnapshot` fields
- Operators can have both fee types active at the same time
- The `version` field indicates the primary/default fee type for new registrations

## Changes by Component

### Core Library (`contracts/libraries/CoreLib.sol`)

#### Version Constants
- **Added version constants**:
  - `uint8 internal constant VERSION_SSV = 0`
  - `uint8 internal constant VERSION_ETH = 1`
  - `uint8 internal constant VERSION_UNDEFINED = type(uint8).max`

#### Version Validation
- **New function `validateVersion()`**:
  - Validates that version is either `VERSION_SSV` or `VERSION_ETH`
  - Reverts with `IncorrectOperatorVersion` error if invalid

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

### Protocol Storage (`contracts/libraries/SSVStorageProtocol.sol`)

- **Added ETH accounting fields to `StorageProtocol` struct**:
  - `uint32 daoEthValidatorCount` - Count of ETH-based validators governed by the DAO
  - `uint64 daoEthBalance` - Current balance of the DAO denominated in ETH
  - Enables separate tracking of SSV and ETH earnings for the DAO

### Protocol Library (`contracts/libraries/ProtocolLib.sol`)

#### Version-Aware DAO Accounting
- **Refactored `updateDAO()`**:
  - Now accepts `uint8 version` parameter
  - Tracks validator counts separately for ETH and SSV clusters
  - Updates `daoEthValidatorCount` for ETH clusters (version 1)
  - Updates `daoValidatorCount` for all clusters (total count)

- **New function `updateDAOEarnings()`**:
  - Materializes DAO earnings before operations
  - Validates version parameter
  - Reverts with `IncorrectDAOVersion` if invalid

- **Refactored `networkTotalEarnings()`**:
  - Now accepts `uint8 version` parameter
  - Returns earnings for specified version (SSV or ETH)
  - Uses `_getDAOAccounting()` to retrieve version-specific balance and validator count

- **Refactored `_materializeDAOEarnings()`**:
  - Calculates earnings separately for ETH and SSV validators
  - Updates `daoEthBalance` for ETH validators
  - Updates `daoBalance` for SSV validators
  - Validates that `daoValidatorCount >= daoEthValidatorCount`

- **New function `_getDAOAccounting()`**:
  - Returns version-specific balance and validator count
  - For ETH: returns `daoEthBalance` and `daoEthValidatorCount`
  - For SSV: returns `daoBalance` and `daoValidatorCount - daoEthValidatorCount`
  - Validates version consistency

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

### Operator Library (`contracts/libraries/OperatorLib.sol`)

#### Dual Snapshot System
- **New function `updateETHSnapshot()`**:
  - Updates ETH-specific snapshot for memory operators
  - Calculates earnings based on `ethFee` and `ethSnapshot`
  - Updates `ethSnapshot.index` and `ethSnapshot.balance`

- **New function `updateETHSnapshotSt()`**:
  - Updates ETH-specific snapshot for storage operators
  - Storage version of `updateETHSnapshot()`

- **New function `updateSnapshots()`**:
  - Updates both SSV and ETH snapshots for memory operators
  - Calls both `updateSnapshot()` and `updateETHSnapshot()`

- **New function `updateSnapshotsSt()`**:
  - Updates both SSV and ETH snapshots for storage operators
  - Calls both `updateSnapshotSt()` and `updateETHSnapshotSt()`

#### Version-Aware Cluster Operations
- **Refactored `updateClusterOperatorsOnRegistration()`**:
  - Version-aware snapshot updates
  - Uses `updateETHSnapshot()` for ETH operators (version 1)
  - Uses `updateSnapshot()` for SSV operators (version 0)
  - Calculates cumulative fee and index based on operator version
  - Uses `ethFee` and `ethSnapshot.index` for ETH operators
  - Uses `fee` and `snapshot.index` for SSV operators

- **Refactored `updateClusterOperators()`**:
  - Version-aware snapshot updates
  - Uses `updateETHSnapshotSt()` for ETH operators
  - Uses `updateSnapshotSt()` for SSV operators
  - Calculates cumulative fee and index based on operator version

- **Updated `ensureOperatorVersion()`**:
  - Validates that all operators in a list match the expected version
  - Checks operator version against expected version
  - Allows operators with zero fee to have any version (for backward compatibility)
  - Reverts with `IncorrectOperatorVersion` error if version mismatch

### SSV Clusters Module (`contracts/modules/SSVClusters.sol`)

The `SSVClusters` module has been completely refactored to support both ETH and SSV token clusters with version-aware operations.

#### Registration Functions
- **`registerValidator()` and `bulkRegisterValidator()`**:
  - Now `payable` to accept ETH deposits
  - Validates operators are version 1 (ETH) using `OperatorLib.ensureOperatorVersion()`
  - Uses `msg.value` for balance deposits
  - Stores clusters in `ethClusters` mapping (version 1)
  - Passes version to `updateDAO()` for proper accounting

#### Removal Functions
- **`removeValidator()` and `bulkRemoveValidator()`**:
  - Version-aware storage updates
  - Detects cluster version and updates appropriate mapping (`ethClusters` or `clusters`)
  - Passes version to `updateDAO()` for proper accounting
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
  - Passes version to `updateDAO()` for proper accounting

- **`reactivate()`**:
  - Public function that calls internal `_reactivate()`
  - Emits `ClusterReactivated` event

- **Internal `_reactivate()` function**:
  - Validates operators are version 1 (ETH)
  - Accepts ETH via `msg.value`
  - Always stores reactivated clusters in `ethClusters` mapping (version 1)
  - Migrates SSV clusters to ETH clusters upon reactivation
  - Passes version to `updateDAO()` for proper accounting

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

### SSV Operators Module (`contracts/modules/SSVOperators.sol`)

#### Operator Registration
- **`registerOperator()`**:
  - New operators registered with `version: CoreLib.VERSION_ETH` (version 1)
  - Initializes both `snapshot` and `ethSnapshot` with current block
  - Sets `ethFee` to the provided fee amount
  - Sets `fee` to 0 (SSV fee not used for new operators)
  - All new operators default to ETH-based fees

#### Fee Management
- **`declareOperatorFee()`**:
  - Declares SSV token fee (version 0)
  - Calls internal `_declareOperatorFee()` with `VERSION_SSV`

- **New function `declareOperatorEthFee()`**:
  - Declares ETH fee (version 1)
  - Calls internal `_declareOperatorFee()` with `VERSION_ETH`

- **Internal `_declareOperatorFee()` function**:
  - Refactored to accept `uint8 version` parameter
  - Validates version using `CoreLib.validateVersion()`
  - Uses appropriate fee field (`fee` or `ethFee`) based on version
  - Handles initial ETH fee declaration (when `ethSnapshot.block == 0`)
  - Sets `version` in `OperatorFeeChangeRequest` struct

- **`executeOperatorFee()`**:
  - Validates that operator version matches fee change request version
  - Version-aware fee execution:
    - ETH version: Updates `ethFee` and `ethSnapshot`
    - SSV version: Updates `fee` and `snapshot`
  - Reverts if version mismatch

- **`reduceOperatorFee()`**:
  - Version-aware fee reduction
  - ETH operators: Reduces `ethFee` using `updateETHSnapshot()`
  - SSV operators: Reduces `fee` using `updateSnapshot()`
  - Validates minimum fee based on version

- **New function `migrateToEth()`**:
  - Migrates SSV operators to ETH-based fees
  - Updates SSV snapshot to finalize earnings
  - Sets `fee = 0` and `ethFee = providedFee`
  - Updates `version` to `VERSION_ETH`
  - Initializes `ethSnapshot.block` to current block
  - Emits `OperatorMigratedToEth` event

#### Earnings Withdrawal
- **`withdrawOperatorEarnings()`**:
  - Withdraws SSV token earnings (version 0)
  - Calls `_withdrawOperatorEarnings()` with `VERSION_SSV`

- **`withdrawAllOperatorEarnings()`**:
  - Withdraws all SSV token earnings (version 0)
  - Calls `_withdrawOperatorEarnings()` with `VERSION_SSV`

- **New function `withdrawOperatorETHEarnings()`**:
  - Withdraws ETH earnings (version 1)
  - Calls `_withdrawOperatorEarnings()` with `VERSION_ETH`

- **New function `withdrawAllOperatorETHEarnings()`**:
  - Withdraws all ETH earnings (version 1)
  - Calls `_withdrawOperatorEarnings()` with `VERSION_ETH`

- **Refactored `_withdrawOperatorEarnings()`**:
  - Now accepts `uint8 version` parameter
  - Version-aware withdrawal logic:
    - ETH version: Uses `updateETHSnapshot()` and `ethSnapshot.balance`
    - SSV version: Uses `updateSnapshot()` and `snapshot.balance`
  - ETH operators: Uses `_transferOperatorBalanceUnsafe()` for ETH transfers
  - SSV operators: Uses `_transferOperatorTokenBalanceUnsafe()` for SSV token transfers

- **`removeOperator()`**:
  - Updates both snapshots using `updateSnapshots()`
  - Withdraws both ETH and SSV balances if present
  - Clears both `fee` and `ethFee` fields

#### Transfer Functions
- **`_transferOperatorBalanceUnsafe()`**:
  - Transfers ETH via `CoreLib.transferBalance()`
  - Emits `OperatorWithdrawn` event

- **`_transferOperatorTokenBalanceUnsafe()`**:
  - Transfers SSV tokens via `CoreLib.transferTokenBalance()`
  - Emits `OperatorWithdrawn` event

### SSV DAO Module (`contracts/modules/SSVDAO.sol`)

#### Version-Aware Withdrawals
- **`withdrawNetworkEarnings()`**:
  - Withdraws SSV token earnings (version 0)
  - Calls `_withdrawNetworkEarnings()` with `VERSION_SSV`
  - Maintains backward compatibility

- **New function `withdrawNetworkEarningsETH()`**:
  - Withdraws ETH earnings (version 1)
  - Calls `_withdrawNetworkEarnings()` with `VERSION_ETH`

- **Refactored `_withdrawNetworkEarnings()`**:
  - Now accepts `uint8 version` parameter
  - Calls `updateDAOEarnings()` to materialize earnings for specified version
  - Version-aware balance retrieval:
    - ETH version: Uses `daoEthBalance`
    - SSV version: Uses `daoBalance`
  - ETH withdrawals: Uses `CoreLib.transferBalance()` for ETH transfers
  - SSV withdrawals: Uses `CoreLib.transferTokenBalance()` for SSV token transfers
  - Updates appropriate balance field based on version
  - Emits `NetworkEarningsWithdrawn` event with version parameter

### SSV Views Module (`contracts/modules/SSVViews.sol`)

#### Version-Aware Queries
- **`getOperatorEarnings()`**:
  - Version-aware earnings calculation
  - ETH operators: Uses `updateETHSnapshot()` and returns `ethSnapshot.balance`
  - SSV operators: Uses `updateSnapshot()` and returns `snapshot.balance`

- **`getBalance()`**:
  - Version-aware balance calculation
  - Validates that all operators match cluster version
  - ETH clusters: Uses `updateETHSnapshot()` and `ethFee` for each operator
  - SSV clusters: Uses `updateSnapshot()` and `fee` for each operator
  - Reverts with `IncorrectOperatorVersion` if operator versions don't match cluster version

- **`getNetworkEarnings()`**:
  - Returns ETH network earnings by default
  - Calls `getNetworkEarningsByVersion()` with `VERSION_ETH`

- **New function `getNetworkEarningsByVersion()`**:
  - Returns network earnings for specified version
  - Uses `ProtocolLib.networkTotalEarnings()` with version parameter
  - Supports querying both SSV and ETH earnings separately

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

- **Updated `Operator` struct**:
  - `uint8 version` - Operator struct version (0 = SSV fees, 1 = ETH fees)
  - `uint64 ethFee` - The fee charged by the operator in ETH
  - `Snapshot ethSnapshot` - The state snapshot of the operator for ETH
  - Operators now maintain separate SSV and ETH fee structures

- **Added `version` field to `OperatorFeeChangeRequest` struct**:
  - `uint8 version` - Fee change request version

- **New errors**:
  - `ETHTransferFailed()` - Reverts when ETH transfer fails (error code: 0xb12d13eb)
  - `IncorrectClusterVersion()` - Reverts when cluster version doesn't match expected version (error code: 0xf6749746)
  - `IncorrectOperatorVersion(uint8 operatorVersion)` - Reverts when operator version doesn't match expected version (error code: 0xf222e863)
  - `IncorrectDAOVersion(uint8 daoVersion)` - Reverts when DAO version is invalid (error code: 0x13bb6c4f)
  - `MaxValueExceeded()` - Reverts when value exceeds maximum (error code: 0x91aa3017)

#### ISSVOperators (`contracts/interfaces/ISSVOperators.sol`)

- **New functions**:
  - `declareOperatorEthFee(uint64 operatorId, uint256 fee)` - Declares ETH fee
  - `withdrawOperatorETHEarnings(uint64 operatorId, uint256 amount)` - Withdraws ETH earnings
  - `withdrawAllOperatorETHEarnings(uint64 operatorId)` - Withdraws all ETH earnings

- **New events**:
  - `OperatorMigratedToEth(address indexed owner, uint64 indexed operatorId, uint256 blockNumber, uint256 ethFee)` - Emitted when operator migrates to ETH

#### ISSVDAO (`contracts/interfaces/ISSVDAO.sol`)

- **New function**:
  - `withdrawNetworkEarningsETH(uint256 amount)` - Withdraws native ETH-denominated network earnings

- **Updated `NetworkEarningsWithdrawn` event**:
  - Added `uint8 version` parameter to track withdrawn asset version

#### ISSVViews (`contracts/interfaces/ISSVViews.sol`)

- **New function**:
  - `getNetworkEarningsByVersion(uint8 version)` - Gets network earnings for specified version (0 = SSV, 1 = ETH)

### Main Contract (`contracts/SSVNetwork.sol`)

- **All cluster functions made `payable`**:
  - `registerValidator()`
  - `bulkRegisterValidator()`
  - `liquidate()`
  - `reactivate()`
  - `deposit()`
  - `withdraw()`

  This enables ETH transfers through the main contract delegate calls.

### SSV Network Views (`contracts/SSVNetworkViews.sol`)

- Updated to support new view functions and version-aware queries

### Test Contracts

#### SSVNetworkUpgrade (`contracts/test/SSVNetworkUpgrade.sol`)
- Updated to accommodate interface changes and version-aware operations

#### SSVOperatorsUpdate (`contracts/test/modules/SSVOperatorsUpdate.sol`)
- Updated to accommodate interface changes (version parameter in events, new functions)

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

Operators can migrate to ETH version via:
- **`migrateToEth()`**: Explicit migration function that sets ETH fee and updates version
- **Fee execution**: When executing a fee change request with ETH version
- **Fee reduction**: When reducing fee for ETH version operators

### Dual Fee Support

Operators can maintain both SSV and ETH fees simultaneously:
- SSV fees tracked via `fee` and `snapshot`
- ETH fees tracked via `ethFee` and `ethSnapshot`
- Both can be active at the same time
- Withdrawals can be made separately for each fee type

## Backward Compatibility

- **Existing SSV clusters (version 0) continue to function unchanged**
- **SSV token-based operations remain fully supported**
- **Both cluster types can coexist in the same network**
- **Operators with zero fee can have any version** (for backward compatibility)
- **Version detection is automatic** - no manual version specification required
- **Legacy SSV operators continue to work** with their existing fee structure
- **DAO maintains separate accounting** for SSV and ETH earnings

## Technical Details

### Storage Layout

- **SSV Clusters**: Stored in `s.clusters[hashedCluster]` (version 0)
- **ETH Clusters**: Stored in `s.ethClusters[hashedCluster]` (version 1)
- **Version Detection**: `ClusterLib.getClusterData()` checks both mappings and returns detected version

### Operator Snapshots

- **SSV Snapshot**: Tracks earnings from `fee` field
  - Updated via `updateSnapshot()` / `updateSnapshotSt()`
  - Stored in `operator.snapshot`
  
- **ETH Snapshot**: Tracks earnings from `ethFee` field
  - Updated via `updateETHSnapshot()` / `updateETHSnapshotSt()`
  - Stored in `operator.ethSnapshot`

- **Dual Updates**: `updateSnapshots()` / `updateSnapshotsSt()` update both simultaneously

### DAO Accounting

- **SSV Earnings**: Tracked in `daoBalance` with validator count `daoValidatorCount - daoEthValidatorCount`
- **ETH Earnings**: Tracked in `daoEthBalance` with validator count `daoEthValidatorCount`
- **Total Validators**: `daoValidatorCount` represents total (SSV + ETH)
- **Earnings Materialization**: `_materializeDAOEarnings()` calculates and updates both balances separately

### Balance Handling

- **ETH Clusters**: Use `CoreLib.transferBalance()` for native ETH transfers
- **SSV Clusters**: Use `CoreLib.transferTokenBalance()` for SSV token transfers
- **Deposits**: ETH clusters accept `msg.value`, SSV clusters would use token approval (legacy)

### Version Validation

- **Cluster Version**: Validated via `ClusterLib.validateClusterVersion()`
- **Operator Version**: Validated via `OperatorLib.ensureOperatorVersion()` and `CoreLib.validateVersion()`
- **DAO Version**: Validated in `ProtocolLib.updateDAOEarnings()`
- **Registration**: New clusters always use version 1 (ETH)
- **Operations**: Version is auto-detected from storage

## Files Modified

1. `contracts/libraries/CoreLib.sol` - Version constants, validation, and transfer functions
2. `contracts/libraries/SSVStorage.sol` - Added `ethClusters` mapping
3. `contracts/libraries/SSVStorageProtocol.sol` - Added ETH accounting fields
4. `contracts/libraries/ProtocolLib.sol` - Complete refactor for version-aware DAO accounting
5. `contracts/libraries/ClusterLib.sol` - Version-aware cluster operations
6. `contracts/libraries/OperatorLib.sol` - Dual snapshot system and version-aware operations
7. `contracts/modules/SSVClusters.sol` - Complete refactor for dual-version support
8. `contracts/modules/SSVOperators.sol` - Dual fee system and version-aware operations
9. `contracts/modules/SSVDAO.sol` - Version-aware withdrawals
10. `contracts/modules/SSVViews.sol` - Version-aware queries
11. `contracts/interfaces/ISSVClusters.sol` - Payable functions and events
12. `contracts/interfaces/ISSVNetworkCore.sol` - Updated Operator struct, version fields, and new errors
13. `contracts/interfaces/ISSVOperators.sol` - New ETH fee functions and events
14. `contracts/interfaces/ISSVDAO.sol` - New ETH withdrawal function and updated event
15. `contracts/interfaces/ISSVViews.sol` - New version-aware query function
16. `contracts/SSVNetwork.sol` - Payable function signatures
17. `contracts/SSVNetworkViews.sol` - Updated view functions
18. `contracts/test/SSVNetworkUpgrade.sol` - Interface compatibility updates
19. `contracts/test/modules/SSVOperatorsUpdate.sol` - Interface compatibility updates
20. `.solhint.json` - Configuration updates
21. `package-lock.json` - Dependency updates

## Statistics

- **Total files changed**: 21
- **Major refactoring**: 
  - SSVClusters module completely rewritten for dual-version support
  - ProtocolLib completely refactored for version-aware DAO accounting
  - OperatorLib extended with dual snapshot system
- **New storage fields**: 
  - `ethClusters` mapping for ETH-based clusters
  - `daoEthBalance` and `daoEthValidatorCount` for ETH DAO accounting
- **New operator fields**: `ethFee` and `ethSnapshot` for dual fee support
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
11. `6996e31` - feat: add ETH DAO withdrawals with versioned accounting
12. `ba94edf` - wip: operator eth fee initiated
13. `6b5f0c4` - Refine operator fee/earnings flows and snapshot updates
14. `55e96b5` - migrate to eth function refactored
15. `56ad532` - Make operator snapshots version-aware across clusters and views
