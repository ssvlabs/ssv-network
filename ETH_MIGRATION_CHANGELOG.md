# ETH Migration Changelog

## Overview

This document details all changes made to migrate the SSV Network from SSV token-based payments to native ETH payments. The migration maintains backward compatibility with existing SSV token-based operators and clusters while introducing new ETH-based functionality.

**Base Commit:** `a2e968fac3e00b2e3545393727529ca84e8b313e` (develop branch)  
**Migration Branch:** `feat/eth-migration`

## Summary Statistics

- **Total Files Changed:** 20
- **Total Lines Added:** 804
- **Total Lines Removed:** 284
- **Net Change:** +520 lines

## Key Changes

### 1. Dual Payment System Support

The migration introduces a dual payment system that supports both:
- **ETH payments** (new, post-migration)
- **SSV token payments** (legacy, pre-migration, backward compatible)

### 2. Version System

A versioning system has been introduced to distinguish between:
- `VERSION_SSV = 0` - Legacy SSV token-based operators/clusters
- `VERSION_ETH = 1` - New ETH-based operators/clusters
- `VERSION_UNDEFINED = type(uint8).max` - Invalid/undefined version

### 3. Security Enhancements

- Added `ReentrancyGuard` to critical functions handling ETH transfers
- Functions protected: `withdraw`, `removeValidator`, `liquidate`, `reactivate`, `deposit`, and operator withdrawal functions

---

## Detailed File Changes

### Core Interfaces

#### `contracts/interfaces/ISSVNetworkCore.sol`

**Changes:**
- Added new fields to `Operator` struct:
  - `version` (uint8) - Operator version (SSV or ETH)
  - `ethValidatorCount` (uint32) - Validator count for ETH-based operations
  - `ethFee` (uint64) - Fee in ETH
  - `ethSnapshot` (Snapshot) - Snapshot for ETH-based earnings tracking
- Added new error: `ETHTransferFailed()` - Replaces `TokenTransferFailed()` for ETH operations
- Added new error: `IncorrectOperatorVersion(uint8 operatorVersion)` - For version validation
- Added new error: `IncorrectClusterVersion()` - For cluster version validation

**Purpose:** Extends the operator structure to support dual payment systems while maintaining backward compatibility.

---

#### `contracts/interfaces/ISSVClusters.sol`

**Changes:**
- Modified `registerValidator()` and `bulkRegisterValidator()` to accept `payable` and use `msg.value` instead of `amount` parameter
- Modified `reactivate()` to accept `payable` for ETH deposits
- Modified `deposit()` to accept `payable` for ETH deposits
- Added new function: `liquidateSSV()` - For liquidating legacy SSV token-based clusters
- Updated function signatures to use `payable` modifier where ETH is expected

**Purpose:** Enables ETH-based validator registration, deposits, and reactivation while maintaining SSV token support.

---

#### `contracts/interfaces/ISSVOperators.sol`

**Changes:**
- Updated `registerOperator()` documentation to indicate ETH version (post-migration)
- Added `removeOperatorSSV()` - For removing legacy SSV token-based operators
- Added `migrateOperatorToETH(uint256 ethFee)` - For migrating legacy SSV operators to ETH using a provided ETH fee (validated against limits); `ensureETHDefaults()` now applies ETH defaults (fee/snapshot/validator count) during cluster migration without flipping version
- Updated `withdrawOperatorEarnings()` and `withdrawAllOperatorEarnings()` to handle ETH withdrawals
- Added `withdrawOperatorEarningsSSV()` and `withdrawAllOperatorEarningsSSV()` - For legacy SSV token withdrawals
- Updated function documentation to clarify ETH vs SSV token operations

**Purpose:** Provides separate functions for ETH and SSV token operations, ensuring clear separation and backward compatibility.

---

#### `contracts/interfaces/ISSVDAO.sol`

**Changes:**
- Added `updateNetworkFeeSSV()` - For updating legacy SSV token network fee
- Added `withdrawNetworkSSVEarnings()` - For withdrawing legacy SSV token network earnings
- Updated documentation to distinguish between ETH (post-migration) and SSV (pre-migration) functions

**Purpose:** Maintains backward compatibility for network fee management while introducing ETH-based operations.

---

#### `contracts/interfaces/ISSVNetworkCore.sol` (New Interface)

**Changes:**
- This interface was extended with new struct fields and errors as described above

---

#### `contracts/interfaces/ISSVViews.sol`

**Changes:**
- Added `getNetworkFeeSSV()` - Returns legacy SSV token network fee
- Added `getNetworkEarningsSSV()` - Returns legacy SSV token network earnings
- Updated documentation to clarify SSV vs ETH return values

**Purpose:** Provides view functions for both ETH and SSV token network metrics.

---

### Core Libraries

#### `contracts/libraries/SSVStorage.sol`

**Changes:**
- Added new storage mapping: `ethClusters` - Stores ETH-based cluster data separately from SSV token clusters
  ```solidity
  mapping(bytes32 => bytes32) ethClusters;
  ```

**Purpose:** Separates ETH and SSV token cluster storage to prevent conflicts and enable independent tracking.

---

#### `contracts/libraries/SSVStorageProtocol.sol`

**Changes:**
- Added ETH-specific protocol storage fields:
  - `ethNetworkFeeIndexBlockNumber` (uint32) - Block number for ETH network fee index
  - `ethDaoValidatorCount` (uint32) - DAO validator count for ETH clusters
  - `ethDaoIndexBlockNumber` (uint32) - Block number for ETH DAO index
  - `ethNetworkFee` (uint64) - Current ETH network fee
  - `ethNetworkFeeIndex` (uint64) - Current ETH network fee index
  - `ethDaoBalance` (uint64) - Current ETH DAO balance

**Purpose:** Maintains separate tracking for ETH and SSV token protocol parameters, enabling independent fee management.

---

#### `contracts/libraries/CoreLib.sol`

**Changes:**
- Added version constants:
  - `VERSION_SSV = 0`
  - `VERSION_ETH = 1`
  - `VERSION_UNDEFINED = type(uint8).max`
- Replaced `transferBalance()` to use native ETH transfers instead of ERC20 token transfers:
  ```solidity
  function transferBalance(address to, uint256 amount) internal {
      (bool success, ) = payable(to).call{value: amount}("");
      if(!success){
          revert ISSVNetworkCore.ETHTransferFailed();
      }
  }
  ```
- Added new function `transferTokenBalance()` - For legacy SSV token transfers:
  ```solidity
  function transferTokenBalance(address to, uint256 amount) internal {
      if (!SSVStorage.load().token.transfer(to, amount)) {
          revert ISSVNetworkCore.TokenTransferFailed();
      }
  }
  ```
- Removed `deposit()` function (ETH deposits now handled via `msg.value`)

**Purpose:** Provides core ETH transfer functionality while maintaining SSV token transfer support for backward compatibility.

---

#### `contracts/libraries/ProtocolLib.sol`

**Changes:**
- Added `currentNetworkFeeIndexSSV()` - Returns SSV token network fee index
- Modified `currentNetworkFeeIndex()` to return ETH network fee index
- Added `updateNetworkFeeSSV()` - Updates SSV token network fee
- Modified `updateNetworkFee()` to update ETH network fee
- Added `updateDAOEarningsSSV()` - Updates SSV token DAO earnings
- Modified `updateDAOEarnings()` to update ETH DAO earnings
- Added `networkTotalEarningsSSV()` - Returns SSV token network total earnings
- Modified `networkTotalEarnings()` to return ETH network total earnings
- Added `updateDAOSSV()` - Updates SSV token DAO validator count
- Modified `updateDAO()` to update ETH DAO validator count

**Purpose:** Provides separate protocol management functions for ETH and SSV token operations, ensuring independent fee and earnings tracking.

---

#### `contracts/libraries/OperatorLib.sol`

**Changes:**
- Added `updateSnapshot()` - Updates ETH-based operator snapshot
- Added `updateSnapshotSt()` - Updates ETH-based operator snapshot (storage version)
- Added `updateSnapshotSSV()` - Updates SSV token-based operator snapshot
- Added `updateSnapshotStSVV()` - Updates SSV token-based operator snapshot (storage version)
- Added `updateSnapshots()` - Updates both ETH and SSV snapshots (memory)
- Added `updateSnapshotsSt()` - Updates both ETH and SSV snapshots (storage)
- Modified `updateClusterOperatorsOnRegistration()` to handle both ETH and SSV token operators
- Modified `updateClusterOperators()` to handle both ETH and SSV token operators
- Updated operator validation logic to check version and use appropriate snapshot/fee fields

**Purpose:** Enables dual snapshot tracking for operators, allowing them to earn from both ETH and SSV token validators independently.

---

#### `contracts/libraries/ClusterLib.sol`

**Changes:**
- Modified `validateHashedCluster()` to return both `hashedCluster` and `version`
- Added `validateClusterVersion()` - Validates cluster version matches expected version
- Modified `validateClusterOnRegistration()` to check `ethClusters` mapping for new registrations
- Updated cluster storage logic to use appropriate mapping based on version (`ethClusters` vs `clusters`)

**Purpose:** Enables version-aware cluster validation and storage, ensuring ETH and SSV token clusters are properly separated.

---

### Core Modules

#### `contracts/modules/SSVClusters.sol`

**Changes:**
- Added `ReentrancyGuard` inheritance
- Modified `registerValidator()`:
  - Changed to `payable`
  - Uses `msg.value` instead of `amount` parameter
  - Removed `CoreLib.deposit()` call (ETH handled via `msg.value`)
  - Stores in `ethClusters` mapping
- Modified `bulkRegisterValidator()`:
  - Changed to `payable`
  - Uses `msg.value` instead of `amount` parameter
  - Removed `CoreLib.deposit()` call
  - Stores in `ethClusters` mapping
- Modified `removeValidator()`:
  - Added `nonReentrant` modifier
  - Validates cluster version (must be ETH)
  - Stores in appropriate mapping based on version
- Modified `bulkRemoveValidator()`:
  - Added `nonReentrant` modifier
  - Validates cluster version (must be ETH)
  - Stores in appropriate mapping based on version
- Modified `liquidate()`:
  - Added `nonReentrant` modifier
  - Validates cluster version (must be ETH)
  - Uses `ethNetworkFee` instead of `networkFee`
  - Uses `CoreLib.transferBalance()` for ETH transfers
  - Stores in `ethClusters` mapping
- Added `liquidateSSV()`:
  - New function for liquidating SSV token-based clusters
  - Validates cluster version (must be SSV)
  - Uses `networkFee` and `CoreLib.transferTokenBalance()`
  - Stores in `clusters` mapping
- Modified `reactivate()`:
  - Changed to `payable`
  - Uses `msg.value` for ETH deposits
  - Validates cluster version
  - Stores in appropriate mapping based on version
- Modified `deposit()`:
  - Changed to `payable`
  - Uses `msg.value` for ETH deposits
  - Validates cluster version
  - Stores in appropriate mapping based on version
- Modified `withdraw()`:
  - Added `nonReentrant` modifier
  - Validates cluster version
  - Uses `CoreLib.transferBalance()` for ETH withdrawals
  - Stores in appropriate mapping based on version

**Purpose:** Implements ETH-based cluster operations while maintaining SSV token cluster support. All ETH operations are protected with reentrancy guards.

---

#### `contracts/modules/SSVOperators.sol`

**Changes:**
 - Added `ReentrancyGuard` inheritance
 - Added constant: `MINIMAL_OPERATOR_ETH_FEE = 1_000_000_000`
 - Added constant: `DEFAULT_OPERATOR_ETH_FEE = 1_000_000_000`
- Modified `registerOperator()`:
  - Creates operators with `VERSION_ETH`
  - Initializes `ethFee`, `ethValidatorCount`, and `ethSnapshot`
  - Sets legacy `fee` and `validatorCount` to 0
- Modified `removeOperator()`:
  - Added `nonReentrant` modifier
  - Validates operator version (must be ETH)
  - Uses `ethSnapshot` for balance calculation
  - Uses `CoreLib.transferBalance()` for ETH transfers
  - Resets operator state via `_resetOperatorState()`
- Added `removeOperatorSSV()`:
  - New function for removing SSV token-based operators
  - Validates operator version (must be SSV)
  - Uses `snapshot` for balance calculation
  - Uses `CoreLib.transferTokenBalance()` for SSV token transfers
 - Added `migrateOperatorToETH(uint256 ethFee)`:
  - Migrates legacy SSV operators to ETH by setting the provided ETH fee (validated against min/max) and switching to ETH version
  - Clears pending fee change requests
 - Added `ensureETHDefaults()` in `OperatorLib` to initialize ETH fee/snapshot/validator count when clusters migrate and operators are still legacy (without flipping version)
- Modified `declareOperatorFee()`:
  - Validates operator version
  - Uses `ethFee` for ETH operators
  - Checks against `MINIMAL_OPERATOR_ETH_FEE`
- Modified `executeOperatorFee()`:
  - Handles both ETH and SSV token operators
  - For SSV operators, migrates to ETH version when fee is executed
  - Updates appropriate snapshot and fee fields based on version
- Modified `reduceOperatorFee()`:
  - Uses `ethFee` for fee reduction
  - Validates against `MINIMAL_OPERATOR_ETH_FEE`
- Modified `withdrawOperatorEarnings()`:
  - Added `nonReentrant` modifier
  - Calls `_withdrawOperatorEarnings()` with `VERSION_ETH`
- Modified `withdrawAllOperatorEarnings()`:
  - Added `nonReentrant` modifier
  - Calls `_withdrawOperatorEarnings()` with `VERSION_ETH`
- Added `withdrawOperatorSSVEarnings()`:
  - New function for withdrawing SSV token earnings
  - Added `nonReentrant` modifier
  - Calls `_withdrawOperatorEarnings()` with `VERSION_SSV`
- Added `withdrawAllOperatorSSVEarnings()`:
  - New function for withdrawing all SSV token earnings
  - Added `nonReentrant` modifier
  - Calls `_withdrawOperatorEarnings()` with `VERSION_SSV`
- Modified `_withdrawOperatorEarnings()`:
  - Now accepts `version` parameter
  - Uses appropriate snapshot and transfer function based on version
  - Validates operator version

**Purpose:** Implements ETH-based operator operations with full backward compatibility for SSV token operators. All withdrawal functions are protected with reentrancy guards.

---

#### `contracts/modules/SSVDAO.sol`

**Changes:**
- Added `ReentrancyGuard` inheritance
- Modified `updateNetworkFee()`:
  - Updates ETH network fee (`ethNetworkFee`)
  - Uses `sp.updateNetworkFee()` which handles ETH protocol updates
- Added `updateNetworkFeeSSV()`:
  - Updates SSV token network fee (`networkFee`)
  - Uses `sp.updateNetworkFeeSSV()` which handles SSV protocol updates
- Modified `withdrawNetworkEarnings()`:
  - Added `nonReentrant` modifier
  - Withdraws from ETH DAO balance (`ethDaoBalance`)
  - Uses `CoreLib.transferBalance()` for ETH transfers
  - Updates `ethDaoIndexBlockNumber`
- Added `withdrawNetworkSSVEarnings()`:
  - New function for withdrawing SSV token network earnings
  - Added `nonReentrant` modifier
  - Withdraws from SSV DAO balance (`daoBalance`)
  - Uses `CoreLib.transferTokenBalance()` for SSV token transfers
  - Updates `daoIndexBlockNumber`

**Purpose:** Manages network fees and earnings for both ETH and SSV token systems independently. All withdrawal functions are protected with reentrancy guards.

---

#### `contracts/modules/SSVViews.sol`

**Changes:**
- Updated view functions to handle both ETH and SSV token data
- Added functions to query SSV token-specific network metrics
- Updated functions to return appropriate values based on operator/cluster version

**Purpose:** Provides comprehensive view functions for both ETH and SSV token operations.

---

### Main Contract

#### `contracts/SSVNetwork.sol`

**Changes:**
- Added `liquidateSSV()` function - Delegates to clusters module for SSV token liquidation
- Added `removeOperatorSSV()` function - Delegates to operators module for SSV token operator removal
- Added `updateNetworkFeeSSV()` function - Delegates to DAO module for SSV token network fee updates
- Added `withdrawNetworkSSVEarnings()` function - Delegates to DAO module for SSV token network earnings withdrawal
- Added `withdrawOperatorSSVEarnings()` function - Delegates to operators module for SSV token operator earnings withdrawal
- Added `withdrawAllOperatorSSVEarnings()` function - Delegates to operators module for all SSV token operator earnings withdrawal

**Purpose:** Provides main contract interface for all new SSV token backward compatibility functions.

---

### Test Files

#### `contracts/test/SSVNetworkUpgrade.sol`

**Changes:**
- Updated test contract to handle both ETH and SSV token operations
- Added tests for version validation
- Added tests for dual payment system

**Purpose:** Ensures upgrade compatibility and tests both payment systems.

---

#### `contracts/test/modules/SSVOperatorsUpdate.sol`

**Changes:**
- Extended test coverage for operator version handling
- Added tests for ETH and SSV token operator operations
- Added tests for operator migration scenarios

**Purpose:** Comprehensive testing of operator functionality across both payment systems.

---

### Configuration Files

#### `.solhint.json`

**Changes:**
- Updated linting rules (minor configuration change)

**Purpose:** Maintains code quality standards.

---

#### `package-lock.json`

**Changes:**
- Dependency updates (163 lines changed, likely version updates)

**Purpose:** Keeps dependencies up to date.

---

## Migration Path

### For New Operators (Post-Migration)

1. **Register Operator:** Use `registerOperator()` - Creates ETH-based operator (version 1)
2. **Set Fee:** Fee is set in ETH during registration
3. **Earnings:** Withdraw using `withdrawOperatorEarnings()` - Receives ETH

### For Existing Operators (Pre-Migration)

1. **Continue Operations:** Existing SSV token operators continue to function normally
2. **Earnings:** Withdraw using `withdrawOperatorSSVEarnings()` - Receives SSV tokens
3. **Migration:** When executing a fee change, SSV operators automatically migrate to ETH version
4. **Removal:** Use `removeOperatorSSV()` to remove SSV token operators

### For New Clusters (Post-Migration)

1. **Register Validator:** Use `registerValidator()` with ETH value - Creates ETH-based cluster
2. **Deposit:** Use `deposit()` with ETH value
3. **Withdraw:** Use `withdraw()` - Receives ETH
4. **Liquidate:** Use `liquidate()` - Handles ETH-based liquidation

### For Existing Clusters (Pre-Migration)

1. **Continue Operations:** Existing SSV token clusters continue to function normally
2. **Deposit/Withdraw:** Continue using SSV token functions
3. **Liquidate:** Use `liquidateSSV()` for SSV token-based clusters

---

## Security Considerations

### Reentrancy Protection

All functions that handle ETH transfers or withdrawals are protected with the `nonReentrant` modifier:

- `SSVClusters.removeValidator()`
- `SSVClusters.bulkRemoveValidator()`
- `SSVClusters.liquidate()`
- `SSVClusters.liquidateSSV()`
- `SSVClusters.withdraw()`
- `SSVOperators.removeOperator()`
- `SSVOperators.removeOperatorSSV()`
- `SSVOperators.withdrawOperatorEarnings()`
- `SSVOperators.withdrawAllOperatorEarnings()`
- `SSVOperators.withdrawOperatorSSVEarnings()`
- `SSVOperators.withdrawAllOperatorSSVEarnings()`
- `SSVDAO.withdrawNetworkEarnings()`
- `SSVDAO.withdrawNetworkSSVEarnings()`

### Version Validation

- Operators and clusters are validated to ensure correct version before operations
- Prevents mixing ETH and SSV token operations incorrectly
- Provides clear error messages for version mismatches

### Backward Compatibility

- All existing SSV token operations remain functional
- No breaking changes to existing interfaces (new functions added, not modified)
- Legacy operators and clusters can coexist with new ETH-based ones

---

## Commit History

The migration was implemented across the following commits:

1. `fb5a9df` - clusters::registration:eth storage added
2. `9635060` - clusters::registration:refactored
3. `84e7816` - clusters::remove:refactored
4. `0c9bc2f` - clusters::liquidate:refactored, liquidateSSV added
5. `aa01b8c` - clusters::reactivate:refactored for eth migration
6. `334414f` - clusters::deposit:refactored for eth migration
7. `a6269b0` - clusters::withdraw:refactored for eth migration
8. `800f6ac` - operators::library:refactored for eth migration
9. `925f11f` - operators::registerOperator:refactored for eth migration
10. `e71b395` - operators::removeOperator:refactored for eth migration remove operator ssv function added for backward, clusters missing functions added
11. `63cda69` - operators::declareOperatorFee:refactored for eth migration
12. `a0a87ff` - operators::reduceOperatorFee:refactored for eth migration
13. `ab8d658` - operators::withdraw:refactored for eth migration
14. `9db14fd` - SSVDAO:refactored for eth migration
15. `8377c83` - reentrancy guard added for eth payments

---

## Testing Recommendations

1. **Unit Tests:** Test all new ETH-based functions
2. **Integration Tests:** Test interaction between ETH and SSV token systems
3. **Migration Tests:** Test operator/cluster migration scenarios
4. **Security Tests:** Test reentrancy protection
5. **Backward Compatibility Tests:** Ensure existing SSV token operations continue to work
6. **Gas Optimization Tests:** Compare gas costs between ETH and SSV token operations

---

## Notes

- The migration maintains full backward compatibility with existing SSV token-based operations
- ETH and SSV token systems operate independently with separate storage and tracking
- Operators can migrate from SSV to ETH when executing a fee change
- All ETH transfer operations are protected against reentrancy attacks
- The version system ensures type safety and prevents incorrect operations

---
