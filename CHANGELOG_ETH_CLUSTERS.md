# Changelog - ETH Clusters Feature

This changelog documents all changes made for the ETH Clusters feature implementation.

## Summary

This feature introduces support for ETH-based clusters alongside the existing SSV token-based clusters. Operators and clusters can now operate using native ETH instead of SSV tokens, with version-based storage and payment mechanisms.

## Changes by Component

### New Modules

#### ETHClusters Module (`contracts/modules/ETHClusters.sol`)
- **New file**: Added complete `ETHClusters` contract implementing `ISSVClusters` interface
- Supports all cluster operations (register, remove, liquidate, reactivate, deposit, withdraw, exit) using native ETH
- Uses `msg.value` for ETH deposits instead of SSV token transfers
- Stores cluster data in `ethClusters` mapping (version 1) instead of `clusters` mapping (version 0)
- Includes `ensureMigrated` function to help migrate existing SSV clusters to ETH clusters
- All functions marked as `payable` to accept ETH transfers

### Storage Changes

#### SSVStorage (`contracts/libraries/SSVStorage.sol`)
- Added `ethClusters` mapping: `mapping(bytes32 => bytes32) ethClusters` to store ETH-based cluster data separately from SSV token clusters

### Core Library Changes

#### CoreLib (`contracts/libraries/CoreLib.sol`)
- **Refactored `transferBalance`**: 
  - Renamed to handle ETH transfers via `call{value: amount}`
  - Changed parameter from `address` to `address payable`
  - Added `ETHTransferFailed` error handling
- **New function `transferTokenBalance`**: 
  - Extracted SSV token transfer logic from old `transferBalance`
  - Uses `token.transfer()` for SSV token transfers
  - Maintains `TokenTransferFailed` error handling

#### ClusterLib (`contracts/libraries/ClusterLib.sol`)
- **Added version parameter support**:
  - `validateHashedCluster()` now accepts `uint8 version` parameter
  - `validateClusterOnRegistration()` now accepts `uint8 version` parameter
  - `updateClusterOnRegistration()` now accepts `uint8 version` parameter
- **Version-based storage selection**:
  - Version 0: Uses `s.clusters[hashedCluster]` (SSV token clusters)
  - Version 1: Uses `s.ethClusters[hashedCluster]` (ETH clusters)
  - Conditional logic added to select appropriate storage mapping based on version

### Interface Changes

#### ISSVClusters (`contracts/interfaces/ISSVClusters.sol`)
- **Moved event declarations** from implementation to interface:
  - `ValidatorAdded` event
  - `ValidatorRemoved` event
  - `ClusterLiquidated` event
  - `ClusterReactivated` event
  - `ClusterWithdrawn` event
  - `ClusterDeposited` event
  - `ValidatorExited` event
- All function signatures updated to `payable` to support ETH transfers

#### ISSVNetworkCore (`contracts/interfaces/ISSVNetworkCore.sol`)
- **Added `version` field to `Operator` struct**:
  - `uint8 version` - Operator struct version (0 = SSV fees, 1 = ETH fees)
- **Added `version` field to `OperatorFeeChangeRequest` struct**:
  - `uint8 version` - Fee change request version
- **New error**: `ETHTransferFailed()` - Reverts when ETH transfer fails

#### ISSVOperators (`contracts/interfaces/ISSVOperators.sol`)
- **Updated `OperatorFeeDeclared` event**:
  - Added `uint8 version` parameter to track fee change version

### Module Updates

#### SSVClusters (`contracts/modules/SSVClusters.sol`)
- **Updated all functions to `payable`**: All cluster operation functions now accept ETH (for interface compatibility)
- **Version parameter integration**:
  - All cluster validation calls now pass `version: 0` (SSV token clusters)
  - `validateClusterOnRegistration()` calls updated with version 0
  - `validateHashedCluster()` calls updated with version 0
  - `updateClusterOnRegistration()` calls updated with version 0
- **Token transfer updates**:
  - `liquidate()` now uses `CoreLib.transferTokenBalance()` instead of `transferBalance()`
  - `withdraw()` now uses `CoreLib.transferTokenBalance()` instead of `transferBalance()`
- Maintains SSV token-based operations (version 0)

#### SSVOperators (`contracts/modules/SSVOperators.sol`)
- **Operator registration**:
  - New operators registered with `version: 1` (ETH-based fees)
- **Fee declaration refactoring**:
  - Extracted `_declareOperatorFee()` as internal virtual function
  - `declareOperatorFee()` now calls `_declareOperatorFee()`
  - Fee change requests now include `version: 1` in the request struct
  - `OperatorFeeDeclared` event now includes version parameter
- **New function `migrateToEth()`**:
  - Public function to migrate operators to ETH-based fees
  - Calls `_declareOperatorFee()` internally
- **Balance transfer updates**:
  - `_transferOperatorBalanceUnsafe()` updated to use `CoreLib.transferBalance()` (ETH)
  - New `_transferOperatorTokenBalanceUnsafe()` function for SSV token transfers
  - Withdrawal logic includes version check (currently both paths use same function, prepared for future differentiation)

#### SSVDAO (`contracts/modules/SSVDAO.sol`)
- **Token transfer update**:
  - `withdrawNetworkEarnings()` now uses `CoreLib.transferTokenBalance()` instead of `transferBalance()`
  - Maintains SSV token-based withdrawals for DAO earnings

### Test Updates

#### SSVOperatorsUpdate (`contracts/test/modules/SSVOperatorsUpdate.sol`)
- Updated to accommodate interface changes (likely version parameter in events)

### Package Updates

#### package-lock.json
- Updated dependencies (174 lines changed, likely dependency updates for the feature)

## Technical Details

### Version System
- **Version 0**: SSV token-based operations
  - Clusters stored in `clusters` mapping
  - Payments via SSV token transfers
  - Operators with version 0 use SSV token fees
  
- **Version 1**: ETH-based operations
  - Clusters stored in `ethClusters` mapping
  - Payments via native ETH (`msg.value`)
  - Operators with version 1 use ETH fees

### Migration Path
- `ETHClusters.deposit()` includes `ensureMigrated()` check
- Automatically liquidates existing SSV cluster if active ETH cluster detected
- Allows seamless transition from SSV to ETH clusters

### Backward Compatibility
- Existing SSV clusters (version 0) continue to function unchanged
- SSVClusters module maintains all existing functionality
- New ETH clusters (version 1) operate in parallel
- Both cluster types can coexist in the same network

## Files Modified

1. `contracts/modules/ETHClusters.sol` (new file, 391 lines)
2. `contracts/interfaces/ISSVClusters.sol` (191 lines changed)
3. `contracts/interfaces/ISSVNetworkCore.sol` (5 lines added)
4. `contracts/interfaces/ISSVOperators.sol` (1 line changed)
5. `contracts/libraries/ClusterLib.sol` (13 lines changed)
6. `contracts/libraries/CoreLib.sol` (11 lines changed)
7. `contracts/libraries/SSVStorage.sol` (2 lines added)
8. `contracts/modules/SSVClusters.sol` (44 lines changed)
9. `contracts/modules/SSVDAO.sol` (1 line changed)
10. `contracts/modules/SSVOperators.sol` (78 lines changed)
11. `contracts/test/modules/SSVOperatorsUpdate.sol` (2 lines changed)
12. `package-lock.json` (dependency updates)

## Statistics

- **Total files changed**: 12
- **Lines added**: 657
- **Lines removed**: 258
- **Net change**: +399 lines

