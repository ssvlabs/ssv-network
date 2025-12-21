# ETH Migration Changelog

## Overview

This document details all changes made to migrate the SSV Network from SSV token-based payments to native ETH payments, and subsequent enhancements including Effective Balance (EB) tracking, DAO root voting, Staking Contract, and infrastructure improvements. The migration maintains backward compatibility with existing SSV token-based operators and clusters while introducing new ETH-based functionality.

**Base Commit:** `a2e968fac3e00b2e3545393727529ca84e8b313e` (develop branch)  
**Current Commit:** `bff3aed34648a98aa0a2e47abf5f963162545054`  
**Migration Branch:** `feat/eth-eb-merge` → `feat/staking-contract`

## Summary Statistics

- **Total Files Changed:** 65
- **Total Lines Added:** 15,708
- **Total Lines Removed:** 13,239
- **Net Change:** +2,469 lines

## Major Feature Additions

### 1. Dual Payment System Support

The migration introduces a dual payment system that supports both:
- **ETH payments** (new, post-migration)
- **SSV token payments** (legacy, pre-migration, backward compatible)

### 2. Effective Balance (EB) System

A comprehensive Effective Balance tracking system has been implemented to:
- Track validator effective balances using Merkle roots
- Calculate vUnits (validator units) for fee distribution
- Support cluster balance updates based on actual validator performance
- Enable automatic liquidation when EB drops below minimum thresholds

### 3. DAO Root Voting/Oracle System

An oracle-based system for committing Effective Balance Merkle roots:
- Allows authorized oracles to commit EB roots for specific blocks
- Enforces timing constraints and update frequency limits
- Supports two-phase timing configuration for different epochs
- Implements voting mechanism requiring multiple oracle confirmations

### 4. Operator Version Simplification

Operator version field was removed in favor of checking ETH/SSV fields directly:
- Operators are identified by presence of active ETH or SSV fields
- Simplified migration logic without explicit version tracking
- Maintains backward compatibility with legacy operators

### 5. SSV Staking Contract

A comprehensive staking system that allows users to stake SSV tokens and earn ETH rewards:
- **Stake SSV tokens** to receive cSSV receipt tokens (1:1 ratio)
- **Earn ETH rewards** from network fees distributed proportionally to stakers
- **Unstake with cooldown** - 7-day cooldown period for unstaking requests
- **Claim ETH rewards** accumulated from network fee distribution
- **Transfer protection** - cSSV transfers automatically settle rewards for sender and receiver
- **Reward tracking** - Per-user reward index and accrued balance tracking
- **Pool management** - Global ETH reward pool synchronized with protocol earnings

### 6. Infrastructure Improvements

- **Hardhat v3 Migration:** Upgraded from Hardhat v2 to v3
- **Scripts Reorganization:** Moved from `tasks/` to `scripts/` directory structure
- **ABI Exports:** Automated ABI export and storage in repository
- **Deployment Scripts:** Enhanced deployment tooling with address book management

---

## Detailed File Changes

### Core Interfaces

#### `contracts/interfaces/ISSVNetworkCore.sol`

**Changes:**
- Added new fields to `Operator` struct:
  - `ethValidatorCount` (uint32) - Validator count for ETH-based operations
  - `ethFee` (uint64) - Fee in ETH
  - `ethSnapshot` (Snapshot) - Snapshot for ETH-based earnings tracking
- Added new error: `ETHTransferFailed()` - Replaces `TokenTransferFailed()` for ETH operations
- Added new error: `IncorrectOperatorVersion(uint8 operatorVersion)` - For version validation (later removed)
- Added new error: `IncorrectClusterVersion()` - For cluster version validation
- Added EB oracle-specific errors:
  - `StaleBlockNumber()` - Block number is too old
  - `FutureBlockNumber()` - Block number is in the future
  - `RootNotFound()` - EB root not found for block
  - `UpdateTooFrequent()` - EB update attempted too soon
  - `StaleUpdate()` - Update is stale
  - `InvalidProof()` - Merkle proof validation failed
  - `EBExceedsMaximum()` - Effective balance exceeds maximum per validator
  - `NotAuthorizedOracle()` - Caller is not authorized oracle
  - `ZeroInterval()` - Zero interval not allowed
  - `EBBelowMinimum()` - Effective balance below minimum threshold
- Added staking-related errors:
  - `NotCSSV()` - Caller is not the cSSV token contract
  - `ZeroAmount()` - Zero amount not allowed
  - `StakeTooLow()` - Staking amount below minimum
  - `CSSVNotSet()` - cSSV token address not configured
  - `CooldownActive()` - Unstake cooldown already active
  - `UnstakeAmountExceedsBalance()` - Unstake amount exceeds user balance
  - `NothingToWithdraw()` - No pending withdrawal available
  - `CooldownNotFinished()` - Cooldown period not yet completed
  - `NothingToClaim()` - No rewards available to claim
  - `InsufficientBalance()` - Insufficient balance for operation
  - `ZeroAddress()` - Zero address not allowed
  - `InvalidToken()` - Invalid token for rescue operation

**Purpose:** Extends the operator structure to support dual payment systems, EB tracking, and staking while maintaining backward compatibility.

---

#### `contracts/interfaces/ISSVClusters.sol`

**Changes:**
- Modified `registerValidator()` and `bulkRegisterValidator()` to accept `payable` and use `msg.value` instead of `amount` parameter
- Modified `reactivate()` to accept `payable` for ETH deposits
- Modified `deposit()` to accept `payable` for ETH deposits
- Added new function: `liquidateSSV()` - For liquidating legacy SSV token-based clusters
- Added new function: `migrateClusterToETH()` - Migrates SSV clusters to ETH with balance conversion
- Added new function: `updateClusterBalance()` - Updates cluster balance based on Effective Balance with Merkle proof
- Added new struct: `UpdateCtx` - Context for cluster balance updates including EB, proof, and version
- Updated function signatures to use `payable` modifier where ETH is expected
- Updated `ClusterMigratedToETH` event to include `clusterEB` (effective balance) field
- Added `ClusterBalanceUpdated` event - Emitted when cluster balance is updated via EB oracle

**Purpose:** Enables ETH-based validator registration, deposits, reactivation, and EB-based balance updates while maintaining SSV token support.

---

#### `contracts/interfaces/ISSVOperators.sol`

**Changes:**
- Updated `registerOperator()` documentation to indicate ETH version (post-migration)
- Removed `migrateOperatorToETH()` - Operator version concept removed
- Updated `withdrawOperatorEarnings()` and `withdrawAllOperatorEarnings()` to handle ETH withdrawals
- Added `withdrawOperatorEarningsSSV()` and `withdrawAllOperatorEarningsSSV()` - For legacy SSV token withdrawals
- Added `withdrawAllVersionOperatorEarnings()` - Withdraws all earnings (ETH and SSV) regardless of operator state
- Updated function documentation to clarify ETH vs SSV token operations
- Removed operator version-related functions and documentation

**Purpose:** Provides separate functions for ETH and SSV token operations, ensuring clear separation and backward compatibility without explicit version tracking.

---

#### `contracts/interfaces/ISSVDAO.sol`

**Changes:**
- Added `updateNetworkFeeSSV()` - For updating legacy SSV token network fee
- Added `withdrawNetworkSSVEarnings()` - For withdrawing legacy SSV token network earnings
- Removed `withdrawNetworkEarnings()` - ETH network earnings now managed through staking contract
- Added `commitRoot()` - Commits Merkle root of all cluster Effective Balances for a specific block
- Added `setOracleTimingConfig()` - Configures oracle timing parameters for two-phase root commitment
- Added `RootCommitted` event - Emitted when EB root is committed
- Added `RootProposed` event - Emitted when EB root is proposed (for voting mechanism)
- Updated documentation to distinguish between ETH (post-migration) and SSV (pre-migration) functions

**Purpose:** Maintains backward compatibility for network fee management while introducing ETH-based operations and EB root commitment functionality. ETH earnings are now distributed through the staking contract.

---

#### `contracts/interfaces/ISSVViews.sol`

**Changes:**
- Added `getNetworkFeeSSV()` - Returns legacy SSV token network fee
- Added `getNetworkEarningsSSV()` - Returns legacy SSV token network earnings
- Added `getClusterVersion()` - Returns cluster version (ETH or SSV) by owner/operator IDs
- Added `getOperatorFeeSSV()` - Returns legacy SSV operator fee
- Added `getOperatorByIdSSV()` and updated `getOperatorById()` to return ETH fields
- Added `isLiquidatableSSV()` - View to check liquidation for legacy SSV clusters
- Added `getOperatorEarningsSSV()` - Returns legacy SSV operator earnings
- Added `getBurnRateSSV()` - Returns burn rate for legacy SSV clusters
- Added `getBalanceSSV()` - Returns cluster balance for legacy SSV clusters
- Added `getClusterEffectiveBalance()` - Returns cluster effective balance from EB snapshot
- Added staking-related view functions:
  - `cooldownDuration()` - Returns the unstake cooldown duration
  - `totalStaked()` - Returns total SSV tokens staked
  - `stakedBalanceOf(address user)` - Returns user's staked balance (cSSV)
  - `pendingUnstake(address user)` - Returns pending unstake request details
  - `accEthPerShare()` - Returns accumulated ETH per share
  - `stakingEthPoolBalance()` - Returns staking pool ETH balance
  - `previewClaimableEth(address user)` - Preview user's claimable ETH rewards
- Updated documentation to clarify SSV vs ETH return values

**Purpose:** Provides view functions for both ETH and SSV token network metrics, plus EB-related queries and staking information.

---

#### `contracts/interfaces/ISSVStaking.sol` (NEW FILE)

**Changes:**
- New interface for SSV Staking module
- Core functions:
  - `syncFees()` - Syncs global ETH reward index from protocol
  - `stake(uint256 amount)` - Stakes SSV tokens, mints cSSV
  - `requestUnstake(uint256 amount)` - Requests unstake, burns cSSV, starts cooldown
  - `withdrawUnlocked()` - Withdraws SSV after cooldown period
  - `claimEthRewards()` - Claims accrued ETH rewards
  - `rescueERC20(address token, address to, uint256 amount)` - Rescues accidental ERC20 transfers
  - `onCSSVTransfer(address from, address to)` - Hook for cSSV transfers
- Events:
  - `Staked(address indexed user, uint256 amount)`
  - `UnstakeRequested(address indexed user, uint256 amount, uint256 unlockTime)`
  - `UnstakedWithdrawn(address indexed user, uint256 amount)`
  - `FeesSynced(uint256 newFeesWei, uint256 accEthPerShare)`
  - `RewardsSettled(address indexed user, uint256 pending, uint256 accrued, uint256 userIndex)`
  - `RewardsClaimed(address indexed user, uint256 amount)`
  - `ERC20Rescued(address indexed token, address indexed to, uint256 amount)`

**Purpose:** Defines the interface for the staking contract that allows users to stake SSV and earn ETH rewards.

---

#### `contracts/interfaces/ICSSVToken.sol` (NEW FILE)

**Changes:**
- New interface for cSSV token (staking receipt token)
- Extends `IERC20` with mint/burn functions:
  - `mint(address to, uint256 amount)` - Mints cSSV tokens (only by staking contract)
  - `burn(address from, uint256 amount)` - Burns cSSV tokens (only by staking contract)

**Purpose:** Defines the interface for the cSSV receipt token used in the staking system.

---

### Core Libraries

#### `contracts/libraries/SSVStorage.sol`

**Changes:**
- Added new storage mapping: `ethClusters` - Stores ETH-based cluster data separately from SSV token clusters
  ```solidity
  mapping(bytes32 => bytes32) ethClusters;
  ```
- Added `SSV_STAKING` to `SSVModules` enum - New module type for staking contract

**Purpose:** Separates ETH and SSV token cluster storage to prevent conflicts and enable independent tracking. Adds staking module to module registry.

---

#### `contracts/libraries/SSVStorageEB.sol` (NEW FILE)

**Changes:**
- New library for Effective Balance storage
- Added constants:
  - `VUNITS_PRECISION = 10_000` - Precision for vUnits calculations (reduced from 100)
  - `MAX_EB_PER_VALIDATOR = 2048 ether` - Maximum effective balance per validator
  - `DEFAULT_EB_PER_VALIDATOR = 32 ether` - Default effective balance per validator
- Added `ClusterEBSnapshot` struct:
  - `vUnits` (uint64) - Validator units for this cluster
  - `lastRootBlockNum` (uint64) - Last block number where EB root was committed
  - `lastUpdateBlock` (uint64) - Last block when cluster EB was updated
- Added `StorageEB` struct with:
  - `ebRoots` - Maps block number to EB Merkle roots
  - `clusterEB` - Maps cluster ID to EB snapshot
  - `operatorVUnits` - Maps operator ID to SSV vUnits
  - `operatorEthVUnits` - Maps operator ID to ETH vUnits
  - `latestCommittedBlock` - Latest block number where EB was committed
  - `minBlocksBetweenUpdates` - Minimum blocks between EB updates
  - `rootCommitments` - Temporary mapping for root commitment tracking (voting mechanism)

**Purpose:** Provides storage structure for Effective Balance tracking, vUnits calculation, and EB root management with voting support.

---

#### `contracts/libraries/SSVStorageStaking.sol` (NEW FILE)

**Changes:**
- New library for Staking storage
- Added `UnstakeRequest` struct:
  - `amount` (uint192) - Amount of cSSV burned and pending withdrawal
  - `unlockTime` (uint64) - Timestamp after which withdrawal is available
- Added `StorageStaking` struct:
  - `cssv` (address) - Address of cSSV token contract
  - `stakingEthPoolBalance` (uint64) - Total ETH rewards allocated to staking pool (shrunk)
  - `accEthPerShare` (uint128) - Global accumulated ETH rewards per cSSV token (scaled by PRECISION)
  - `userIndex` (mapping) - Per-user reward index tracking
  - `accrued` (mapping) - Per-user accumulated unclaimed ETH rewards (in wei)
  - `withdrawals` (mapping) - Per-user pending unstake requests

**Purpose:** Provides storage structure for staking contract state, reward tracking, and unstake requests.

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
- Added vUnits tracking fields:
  - `daoTotalVUnits` (uint64) - Total SSV vUnits for DAO
  - `daoTotalEthVUnits` (uint64) - Total ETH vUnits for DAO

**Purpose:** Maintains separate tracking for ETH and SSV token protocol parameters, enabling independent fee management and vUnits-based earnings calculation.

---

#### `contracts/libraries/CoreLib.sol`

**Changes:**
- Removed version constants (VERSION_SSV, VERSION_ETH, VERSION_UNDEFINED) - Version concept removed
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
- Modified `networkTotalEarnings()` to return ETH network total earnings using vUnits
- Added `updateDAOSSV()` - Updates SSV token DAO validator count
- Modified `updateDAO()` to update ETH DAO validator count
- Added `updateDAOVUnits()` - Updates SSV DAO vUnits (settles earnings first)
- Added `updateDAOEthVUnits()` - Updates ETH DAO vUnits (settles earnings first)
- Updated earnings calculations to use vUnits with `VUNITS_PRECISION` scaling

**Purpose:** Provides separate protocol management functions for ETH and SSV token operations, ensuring independent fee and earnings tracking with vUnits-based calculations.

---

#### `contracts/libraries/OperatorLib.sol`

**Changes:**
- Added `updateSnapshot()` - Updates ETH-based operator snapshot
- Added `updateSnapshotSt()` - Updates ETH-based operator snapshot (storage version)
- Added `updateSnapshotSSV()` - Updates SSV token-based operator snapshot
- Added `updateSnapshotStSSV()` - Updates SSV token-based operator snapshot (storage version)
- Added `updateSnapshots()` - Updates both ETH and SSV snapshots (memory)
- Added `updateSnapshotsSt()` - Updates both ETH and SSV snapshots (storage)
- Modified `updateClusterOperatorsOnRegistration()` to handle both ETH and SSV token operators
- Split cluster updates into `updateClusterOperators()` (ETH) and `updateClusterOperatorsSSV()` (legacy SSV) for explicit version handling
- Updated operator validation logic to check ETH/SSV fields directly (version removed)
- Added vUnits tracking:
  - `updateOperatorVUnits()` - Updates operator vUnits for SSV
  - `updateOperatorEthVUnits()` - Updates operator vUnits for ETH
- Removed `ensureETHDefaults()` - No longer needed with version removal
- Updated operator earnings calculation to use vUnits

**Purpose:** Enables dual snapshot tracking for operators, allowing them to earn from both ETH and SSV token validators independently, with vUnits-based fee distribution.

---

#### `contracts/libraries/ClusterLib.sol`

**Changes:**
- Modified `validateHashedCluster()` to return both `hashedCluster` and `version` (determined by storage location)
- Added `validateClusterVersion()` - Validates cluster version matches expected version
- Modified `validateClusterOnRegistration()` to check `ethClusters` mapping for new registrations
- Updated cluster storage logic to use appropriate mapping based on version (`ethClusters` vs `clusters`)
- Added EB-related functions:
  - `getClusterEB()` - Gets cluster effective balance from EB snapshot
  - `validateEBLimits()` - Validates EB is within min/max bounds
  - `calculateVUnits()` - Calculates vUnits from effective balance
- Updated cluster balance calculations to incorporate EB when available

**Purpose:** Enables version-aware cluster validation and storage, ensuring ETH and SSV token clusters are properly separated, with EB integration.

---

#### `contracts/libraries/ValidatorLib.sol`

**Changes:**
- Updated validator registration/removal logic to work with both ETH and SSV clusters
- Added EB-aware validator tracking

**Purpose:** Supports validator operations across both payment systems.

---

### Core Modules

#### `contracts/modules/SSVClusters.sol`

**Changes:**
- Added `ReentrancyGuard` inheritance (later moved to proxy level)
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
- Refactored validator registration/removal into centralized internal functions:
  - `_bulkRegisterValidator()` - Centralized bulk registration logic
  - `_bulkRemoveValidator()` - Centralized bulk removal logic
- Modified `removeValidator()`:
  - Validates cluster version (must be ETH)
  - Stores in appropriate mapping based on version
  - Removed `nonReentrant` modifier (moved to proxy level)
- Modified `bulkRemoveValidator()`:
  - Validates cluster version (must be ETH)
  - Stores in appropriate mapping based on version
- Modified `liquidate()`:
  - Added `nonReentrant` modifier (later moved to proxy)
  - Validates cluster version (must be ETH)
  - Uses `ethNetworkFee` instead of `networkFee`
  - Uses `CoreLib.transferBalance()` for ETH transfers
  - Stores in `ethClusters` mapping
  - Can be triggered automatically after EB update if balance insufficient
- Added `liquidateSSV()`:
  - New function for liquidating SSV token-based clusters
  - Validates cluster version (must be SSV)
  - Uses `updateClusterOperatorsSSV()` and `currentNetworkFeeIndexSSV()` for SSV accounting
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
  - Added `nonReentrant` modifier (later moved to proxy)
  - Validates cluster version
  - Uses `CoreLib.transferBalance()` for ETH withdrawals
  - Stores in appropriate mapping based on version
- Added `migrateClusterToETH()`:
  - Migrates SSV cluster to ETH version
  - Refunds SSV balance to owner
  - Accepts ETH top-up via `msg.value`
  - Decrements SSV DAO validator count, increments ETH DAO validator count
  - Handles liquidated SSV clusters without double-counting operators
- Added `updateClusterBalance()`:
  - Updates cluster balance based on Effective Balance with Merkle proof
  - Validates EB root, proof, and update frequency
  - Updates cluster vUnits and EB snapshot
  - Triggers automatic liquidation if balance insufficient after EB update
  - Emits `ClusterBalanceUpdated` event
- Added internal EB update functions:
  - `_updateClusterBalanceInternal()` - Core EB update logic
  - `_updateClusterDataWithEB()` - Updates cluster data with new EB
  - `_verifyEBRoots()` - Validates EB root exists and is not stale
  - `_verifyEBUpdateFrequency()` - Ensures updates aren't too frequent
  - `_verifyEBStaleness()` - Validates update is not stale
  - `_verifyMerkleProof()` - Validates Merkle proof for EB update
  - `_verifyEBLimits()` - Validates EB is within min/max bounds
  - `_applyClusterFeeUpdates()` - Applies fee updates based on new EB
  - `_updateOperatorVUnits()` - Updates operator vUnits from cluster EB change
  - `_updateEBSnapshot()` - Updates cluster EB snapshot
  - `_liquidateAfterEBUpdateIfNeeded()` - Checks and executes liquidation if needed
- Added `ClusterMigratedToETH` event with `clusterEB` field
- Added `ClusterBalanceUpdated` event

**Purpose:** Implements ETH-based cluster operations while maintaining SSV token cluster support. All ETH operations are protected with reentrancy guards (at proxy level). Supports EB-based balance updates and automatic liquidation.

---

#### `contracts/modules/SSVOperators.sol`

**Changes:**
- Added `ReentrancyGuard` inheritance (later moved to proxy level)
- Added constants:
  - `MINIMAL_OPERATOR_ETH_FEE = 1_000_000_000` (1 gwei)
  - `DEFAULT_OPERATOR_ETH_FEE = 1_000_000_000` (1 gwei)
- Modified `registerOperator()`:
  - Creates operators with ETH fields initialized
  - Initializes `ethFee`, `ethValidatorCount`, and `ethSnapshot`
  - Sets legacy `fee` and `validatorCount` to 0
  - No longer uses version field
- Modified `removeOperator()`:
  - Added `nonReentrant` modifier (later moved to proxy)
  - Handles both ETH and SSV snapshots for balance calculation
  - Uses `CoreLib.transferBalance()` for ETH transfers and `CoreLib.transferTokenBalance()` for SSV earnings
  - Resets operator state via `_resetOperatorState()`
- Removed `migrateOperatorToETH()` - Version concept removed, operators work with both ETH and SSV fields
- Modified `declareOperatorFee()`:
  - Validates operator has active ETH fields
  - Uses `ethFee` for ETH operators
  - Checks against `MINIMAL_OPERATOR_ETH_FEE`
- Modified `executeOperatorFee()`:
  - Handles both ETH and SSV token operators
  - Updates appropriate snapshot and fee fields based on active fields
  - No longer migrates operators (version removed)
- Modified `reduceOperatorFee()`:
  - Uses `ethFee` for fee reduction
  - Validates against `MINIMAL_OPERATOR_ETH_FEE`
- Modified `withdrawOperatorEarnings()`:
  - Added `nonReentrant` modifier (later moved to proxy)
  - Withdraws ETH earnings
- Modified `withdrawAllOperatorEarnings()`:
  - Added `nonReentrant` modifier (later moved to proxy)
  - Withdraws both ETH and legacy SSV balances (if any)
- Added `withdrawAllVersionOperatorEarnings()`:
  - Withdraws all earnings (ETH and SSV) in a single call regardless of operator state
- Added `withdrawOperatorSSVEarnings()`:
  - New function for withdrawing SSV token earnings
  - Added `nonReentrant` modifier (later moved to proxy)
  - Withdraws SSV earnings only
- Added `withdrawAllOperatorSSVEarnings()`:
  - New function for withdrawing all SSV token earnings
  - Added `nonReentrant` modifier (later moved to proxy)
  - Withdraws both SSV and any residual ETH balances for SSV-focused operators
- Modified `_withdrawOperatorEarnings()`:
  - Now checks active fields (ETH or SSV) instead of version
  - Uses appropriate snapshot and transfer function based on active fields
  - Validates operator has active fields

**Purpose:** Implements ETH-based operator operations with full backward compatibility for SSV token operators. All withdrawal functions are protected with reentrancy guards (at proxy level). Operators work with both ETH and SSV fields simultaneously without version tracking.

---

#### `contracts/modules/SSVDAO.sol`

**Changes:**
- Added `ReentrancyGuard` inheritance (later moved to proxy level)
- Modified `updateNetworkFee()`:
  - Updates ETH network fee (`ethNetworkFee`)
  - Uses `sp.updateNetworkFee()` which handles ETH protocol updates
- Added `updateNetworkFeeSSV()`:
  - Updates SSV token network fee (`networkFee`)
  - Uses `sp.updateNetworkFeeSSV()` which handles SSV protocol updates
- Removed `withdrawNetworkEarnings()`:
  - ETH network earnings are now distributed through the staking contract
  - Only SSV token earnings can be withdrawn directly
- Modified `withdrawNetworkSSVEarnings()`:
  - New function for withdrawing SSV token network earnings
  - Added `nonReentrant` modifier (later moved to proxy)
  - Withdraws from SSV DAO balance (`daoBalance`)
  - Uses `CoreLib.transferTokenBalance()` for SSV token transfers
  - Updates `daoIndexBlockNumber`
- Added `commitRoot()`:
  - Commits Merkle root of all cluster Effective Balances for a specific block
  - Validates block number is finalized and strictly increasing
  - Implements voting mechanism requiring 3 oracle confirmations
  - Stores root in `StorageEB.ebRoots` mapping after threshold reached
  - Updates `latestCommittedBlock`
  - Emits `RootCommitted` event when threshold reached, `RootProposed` otherwise
- Added `setOracleTimingConfig()`:
  - Configures oracle timing parameters for two-phase root commitment
  - Sets first and second phase start epochs and intervals
  - Validates intervals are non-zero
- Added root commitment tracking for oracle voting logic

**Purpose:** Manages network fees and earnings for both ETH and SSV token systems independently. ETH earnings are distributed through staking contract. All withdrawal functions are protected with reentrancy guards (at proxy level). Provides EB root commitment functionality with voting mechanism for oracle integration.

---

#### `contracts/modules/SSVStaking.sol` (NEW FILE)

**Changes:**
- New staking module for SSV token staking and ETH reward distribution
- Constants:
  - `MINIMAL_STAKING_AMOUNT = 1_000_000_000` (1 gwei minimum)
  - `PRECISION = 1e18` - Precision for reward calculations
  - `cooldownDuration = 7 days` - Unstake cooldown period (immutable)
- Core functions:
  - `syncFees()` - Syncs global ETH reward index from protocol earnings
  - `stake(uint256 amount)` - Stakes SSV tokens, mints cSSV 1:1, settles rewards before staking
  - `requestUnstake(uint256 amount)` - Burns cSSV, starts 7-day cooldown, settles rewards
  - `withdrawUnlocked()` - Withdraws SSV after cooldown period
  - `claimEthRewards()` - Claims accrued ETH rewards (rounds down to protocol precision)
  - `rescueERC20(address token, address to, uint256 amount)` - Rescues accidental ERC20 transfers (cannot rescue SSV or cSSV)
  - `onCSSVTransfer(address from, address to)` - Hook called by cSSV on transfer, settles rewards for both parties
- Internal functions:
  - `_syncFees(StorageStaking storage s)` - Updates global reward index from protocol
  - `_previewAccEthPerShare(StorageStaking storage s)` - Preview function for reward index
  - `_settle(address user, StorageStaking storage s)` - Settles user rewards based on current balance
  - `_settleWithBalance(address user, uint256 bal, StorageStaking storage s)` - Settles with specific balance
- Reward mechanism:
  - Uses accumulated ETH per share (accEthPerShare) for proportional distribution
  - Per-user reward index tracks last settled state
  - Accrued rewards stored separately for claiming
  - Rewards automatically settled on stake, unstake, and transfer
- Security:
  - All functions protected with `nonReentrant` at proxy level
  - Validates cSSV address is set before operations
  - Prevents multiple pending unstake requests
  - Validates cooldown period before withdrawal
  - Rounds down claimable rewards to protocol precision

**Purpose:** Enables users to stake SSV tokens and earn ETH rewards from network fees. Provides liquid staking with receipt tokens and automatic reward distribution.

---

#### `contracts/modules/SSVViews.sol`

**Changes:**
- Updated view functions to handle both ETH and SSV token data
- Added functions to query SSV token-specific network metrics
- Updated functions to return appropriate values based on operator/cluster active fields
- Added EB-related view functions:
  - `getClusterEffectiveBalance()` - Returns cluster effective balance from EB snapshot
  - Updated balance getters to handle EB amounts in gwei
- Added minimum balance check views for EB
- Added staking-related view functions:
  - `cooldownDuration()` - Returns unstake cooldown duration (7 days)
  - `totalStaked()` - Returns total SSV staked (cSSV total supply)
  - `stakedBalanceOf(address user)` - Returns user's cSSV balance
  - `pendingUnstake(address user)` - Returns pending unstake request (amount, unlockTime)
  - `accEthPerShare()` - Returns current accumulated ETH per share
  - `stakingEthPoolBalance()` - Returns staking pool ETH balance
  - `previewClaimableEth(address user)` - Preview user's claimable ETH rewards (includes pending)

**Purpose:** Provides comprehensive view functions for both ETH and SSV token operations, plus EB-related queries and staking information.

---

### Main Contracts

#### `contracts/SSVNetwork.sol`

**Changes:**
- Added `liquidateSSV()` function - Delegates to clusters module for SSV token liquidation
- Added `updateNetworkFeeSSV()` function - Delegates to DAO module for SSV token network fee updates
- Added `withdrawNetworkSSVEarnings()` function - Delegates to DAO module for SSV token network earnings withdrawal
- Removed `withdrawNetworkEarnings()` function - ETH earnings now distributed through staking
- Added `withdrawOperatorSSVEarnings()` function - Delegates to operators module for SSV token operator earnings withdrawal
- Added `withdrawAllOperatorSSVEarnings()` function - Delegates to operators module for all SSV token operator earnings withdrawal
- Added `updateClusterBalance()` function - Delegates to clusters module for EB-based balance updates
- Added `commitRoot()` function - Delegates to DAO module for EB root commitment
- Added `setOracleTimingConfig()` function - Delegates to DAO module for oracle timing configuration
- Added staking functions:
  - `syncFees()` - Delegates to staking module
  - `stake(uint256 amount)` - Delegates to staking module
  - `requestUnstake(uint256 amount)` - Delegates to staking module
  - `withdrawUnlocked()` - Delegates to staking module
  - `claimEthRewards()` - Delegates to staking module
  - `rescueERC20(address token, address to, uint256 amount)` - Delegates to staking module (owner only)
  - `onCSSVTransfer(address from, address to)` - Validates caller is cSSV, delegates to staking module
- Reentrancy guard initialized in proxy for delegatecall modules
- Added `SSV_STAKING` module to module registry

**Purpose:** Provides main contract interface for all new SSV token backward compatibility functions, EB updates, oracle functions, and staking operations. Reentrancy protection unified at proxy level.

---

#### `contracts/SSVNetworkViews.sol`

**Changes:**
- Wired to new SSV/ETH view helpers
- Added legacy SSV views
- Updated to use new view functions from SSVViews module
- Added EB-related view function delegations
- Added staking-related view function delegations:
  - `cooldownDuration()`
  - `totalStaked()`
  - `stakedBalanceOf(address user)`
  - `pendingUnstake(address user)`
  - `accEthPerShare()`
  - `stakingEthPoolBalance()`
  - `previewClaimableEth(address user)`

**Purpose:** Provides view interface for both ETH and SSV operations, plus EB queries and staking information.

---

### Token Contracts

#### `contracts/token/CSSVToken.sol` (NEW FILE)

**Changes:**
- New ERC20 token contract for staking receipt tokens
- Token details:
  - Name: "cSSV"
  - Symbol: "cSSV"
  - 1:1 ratio with staked SSV tokens
- Access control:
  - `onlySSVStaking` modifier - Only staking contract can mint/burn
  - Immutable `ssvStaking` address set in constructor
- Functions:
  - `mint(address to, uint256 amount)` - Mints cSSV (only by staking contract)
  - `burn(address from, uint256 amount)` - Burns cSSV (only by staking contract)
- Transfer hook:
  - `_beforeTokenTransfer()` - Calls `onCSSVTransfer()` on staking contract
  - Excludes mint/burn operations and zero-amount transfers
  - Ensures rewards are settled for both sender and receiver

**Purpose:** Provides receipt tokens for staked SSV, enabling transferable staking positions with automatic reward settlement.

---

### Test Files

#### `contracts/test/SSVNetworkUpgrade.sol`

**Changes:**
- Updated test contract to handle both ETH and SSV token operations
- Added tests for EB updates
- Added tests for version validation (later updated for version removal)
- Added tests for dual payment system
- Added tests for automatic liquidation after EB update
- Removed tests for `withdrawNetworkEarnings()` (function removed)

**Purpose:** Ensures upgrade compatibility and tests both payment systems plus EB functionality.

---

#### `contracts/test/modules/SSVOperatorsUpdate.sol`

**Changes:**
- Extended test coverage for operator field handling (version removed)
- Added tests for ETH and SSV token operator operations
- Added tests for operator migration scenarios (updated for version removal)
- Added tests for vUnits tracking

**Purpose:** Comprehensive testing of operator functionality across both payment systems.

---

### Infrastructure Changes

#### Hardhat Configuration (`hardhat.config.ts`)

**Changes:**
- Migrated from Hardhat v2 to v3
- Updated to use `@nomicfoundation/hardhat-ethers` v4
- Updated to use `@nomicfoundation/hardhat-ignition` v3
- Updated to use `hardhat-toolbox-mocha-ethers` v3
- Updated Solidity compiler to 0.8.24
- Updated dependency versions

**Purpose:** Keeps build tooling up to date with latest Hardhat ecosystem.

---

#### Scripts Reorganization

**Changes:**
- Moved from `tasks/` directory to `scripts/` directory structure
- Deleted old task files:
  - `tasks/deploy.ts`
  - `tasks/update-module.ts`
  - `tasks/upgrade.ts`
- Created new script files:
  - `scripts/deploy-all.ts` - Deploys all contracts (updated to include staking module)
  - `scripts/deploy-ssv-network.ts` - Deploys SSVNetwork contract
  - `scripts/deploy-ssv-network-views.ts` - Deploys SSVNetworkViews contract
  - `scripts/deploy-implementation.ts` - Deploys implementation contracts
  - `scripts/deploy-module.ts` - Deploys individual modules
  - `scripts/attach-module.ts` - Attaches modules to main contract
  - `scripts/update-module.ts` - Updates module implementations
  - `scripts/upgrade-contract.ts` - Upgrades contracts
  - `scripts/upgrade-with-impl.ts` - Upgrades with new implementation
  - `scripts/contract-sizes.ts` - Checks contract sizes
- Created helper modules:
  - `scripts/common/address-book.ts` - Address book management
  - `scripts/common/export-abis.ts` - ABI export functionality
  - `scripts/common/helpers.ts` - Common helper functions
  - `scripts/common/modules.ts` - Module configuration (renamed from `tasks/config.ts`, updated to include SSV_STAKING)

**Purpose:** Modernizes deployment and upgrade scripts with better organization and tooling. Includes staking module deployment.

---

#### ABI Exports

**Changes:**
- Added automated ABI export script (`scripts/common/export-abis.ts`)
- Added ABI files to repository:
  - `abis/BasicWhitelisting.json`
  - `abis/SSVClusters.json`
  - `abis/SSVDAO.json`
  - `abis/SSVNetwork.json`
  - `abis/SSVNetworkViews.json`
  - `abis/SSVOperators.json`
  - `abis/SSVOperatorsWhitelist.json`
  - `abis/SSVToken.json`
  - `abis/SSVViews.json`
- Updated `.gitignore` to track ABI files

**Purpose:** Makes ABIs available in repository for easier integration and deployment tracking.

---

#### Deployment Configuration

**Changes:**
- Added `deployments/hoodi.json` - Deployment addresses and configuration for hoodi network
- Added `Justfile` - Just command runner configuration for common tasks
- Updated deployment scripts to support staking contract and cSSV token deployment

**Purpose:** Tracks deployments and provides convenient task runners.

---

#### Package Configuration

**Changes:**
- Updated `package.json`:
  - Updated Hardhat and related dependencies to v3
  - Updated ethers to v6
  - Updated other dependencies
  - Updated files list to include `abis/` directory
- Updated `tsconfig.json` for new script structure

**Purpose:** Keeps dependencies up to date and configuration aligned with new structure.

---

#### Upgrade Contracts

**Changes:**
- Added `contracts/upgrades/stage/hoodi/SSVNetworkSSVStakingUpgrade.sol` - Upgrade contract for adding staking module to existing deployments

**Purpose:** Enables upgrading existing deployments to include staking functionality.

---

## Migration Path

### For New Operators (Post-Migration)

1. **Register Operator:** Use `registerOperator()` - Creates operator with ETH fields initialized
2. **Set Fee:** Fee is set in ETH during registration
3. **Earnings:** Withdraw using `withdrawOperatorEarnings()` - Receives ETH
4. **vUnits Tracking:** Operator vUnits automatically tracked based on cluster Effective Balances

### For Existing Operators (Pre-Migration)

1. **Continue Operations:** Existing SSV token operators continue to function normally
2. **Earnings:** Withdraw using `withdrawOperatorSSVEarnings()` - Receives SSV tokens
3. **Dual Earnings:** Operators can earn from both ETH and SSV validators simultaneously
4. **Withdraw All:** Use `withdrawAllVersionOperatorEarnings()` to withdraw both ETH and SSV earnings

### For New Clusters (Post-Migration)

1. **Register Validator:** Use `registerValidator()` with ETH value - Creates ETH-based cluster
2. **Deposit:** Use `deposit()` with ETH value
3. **Withdraw:** Use `withdraw()` - Receives ETH
4. **Liquidate:** Use `liquidate()` - Handles ETH-based liquidation
5. **EB Updates:** Cluster balance automatically updated via `updateClusterBalance()` when EB roots committed
6. **Auto-Liquidation:** Cluster automatically liquidated if balance insufficient after EB update

### For Existing Clusters (Pre-Migration)

1. **Continue Operations:** Existing SSV token clusters continue to function normally
2. **Deposit/Withdraw:** Continue using SSV token functions
3. **Liquidate:** Use `liquidateSSV()` for SSV token-based clusters
4. **Migrate:** Use `migrateClusterToETH()` to convert SSV cluster to ETH (including liquidated clusters)

### For Stakers

1. **Stake SSV:** Use `stake(uint256 amount)` - Transfers SSV, mints cSSV 1:1
2. **Earn Rewards:** ETH rewards automatically accrue based on network fees
3. **Claim Rewards:** Use `claimEthRewards()` - Claims accrued ETH rewards
4. **Transfer cSSV:** cSSV tokens are transferable, rewards automatically settled on transfer
5. **Unstake:** Use `requestUnstake(uint256 amount)` - Burns cSSV, starts 7-day cooldown
6. **Withdraw:** Use `withdrawUnlocked()` after cooldown - Receives SSV tokens back

---

## Security Considerations

### Reentrancy Protection

Reentrancy protection unified at proxy level using `ReentrancyGuardUpgradeable`:
- All modules use delegatecall, so reentrancy guard in proxy protects all functions
- Functions protected include:
  - `SSVClusters.liquidate()`
  - `SSVClusters.liquidateSSV()`
  - `SSVClusters.withdraw()`
  - `SSVClusters.updateClusterBalance()` (indirectly via internal calls)
  - `SSVOperators.removeOperator()`
  - `SSVOperators.withdrawOperatorEarnings()`
  - `SSVOperators.withdrawAllOperatorEarnings()`
  - `SSVOperators.withdrawAllVersionOperatorEarnings()`
  - `SSVOperators.withdrawOperatorSSVEarnings()`
  - `SSVOperators.withdrawAllOperatorSSVEarnings()`
  - `SSVDAO.withdrawNetworkSSVEarnings()`
  - `SSVStaking.syncFees()`
  - `SSVStaking.stake()`
  - `SSVStaking.requestUnstake()`
  - `SSVStaking.withdrawUnlocked()`
  - `SSVStaking.claimEthRewards()`
  - `SSVStaking.rescueERC20()`
  - `SSVStaking.onCSSVTransfer()`

### Version Validation

- Clusters are validated to ensure correct storage location (ETH vs SSV) before operations
- Operators checked for active fields (ETH or SSV) instead of version
- Prevents mixing ETH and SSV token operations incorrectly
- Provides clear error messages for mismatches

### Effective Balance Security

- EB roots must be committed by authorized oracles
- Voting mechanism requires 3 oracle confirmations before root is committed
- Block numbers must be finalized and strictly increasing
- Merkle proofs validated for all EB updates
- Update frequency limited to prevent abuse
- EB values validated against min/max bounds
- Automatic liquidation triggered if balance insufficient after EB decrease

### Staking Security

- Minimum staking amount enforced (1 gwei)
- Cooldown period prevents instant unstaking (7 days)
- Only one pending unstake request per user
- Rewards rounded down to protocol precision to prevent dust
- Transfer hook ensures rewards settled for both parties
- cSSV contract validates caller is staking contract for mint/burn
- Rescue function cannot rescue SSV or cSSV tokens
- Balance checks ensure sufficient funds before operations

### Backward Compatibility

- All existing SSV token operations remain functional
- No breaking changes to existing interfaces (new functions added, not modified)
- Legacy operators and clusters can coexist with new ETH-based ones
- Operators can earn from both ETH and SSV validators simultaneously
- ETH network earnings distributed through staking, SSV earnings withdrawable directly

---

## Commit History

The migration and enhancements were implemented across the following commits (from base to HEAD):

### Phase 1: ETH Migration Foundation
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

### Phase 2: Operator Migration and Enhancements
16. `b6c5d93` - migrate to eth operator added
17. `7109d98` - migrateClusterToETH added wip
18. `91285a4` - ensureETHDefaults added
19. `cf2ee52` - obsolate code removed
20. `2c3e531` - compilation errors fixed
21. `fe08665` - updateClusterOperatorsSSV added
22. `eeaa2c4` - ClusterMigratedToETH event added
23. `fb31267` - removeValidator nonReentrant modifier removed
24. `092fd52` - ssv dao update during migration added
25. `aaf3422` - withdrawAllVersionOperatorEarnings added
26. `fdac245` - ensureETHDefaults refactored
27. `464273c` - Add legacy SSV views, dual withdraw helpers, and bump version to v1.3.0
28. `a30d73c` - Wire SSVNetworkViews to new SSV/ETH view helpers
29. `c37a58b` - migrateOperator to ETH refactored
30. `caf13d1` - reentracy changed to upgradable
31. `eb1092b` - Initialize reentrancy guard in proxy for delegatecall modules
32. `914b277` - Unify reentrancy guard at proxy and fix ETH/SSV accounting mismatches

### Phase 3: Effective Balance System
33. `4400829` - feat: persist ssv/eth balance checks
34. `8bd71f0` - fix: ssv/eth natspec inconsistency
35. `09e783a` - fix: add ethSnapshot check in `checkOwner`
36. `fa8aa07` - chore: fix typos
37. `4437102` - settle SSV snapshot before migrate ETHDefaults, msg.value fixed
38. `2df7bcf` - update SSV before ensureETHDefaults
39. `e20df4e` - update snapshor on registration removed
40. `d912a16` - increase check added
41. `7c852ce` - feat:phase 1 - storage
42. `8e0a9a2` - phase 3 - clusters + dao (wip)
43. `6699242` - feat: dao vunits calculation helpers
44. `467223f` - feat: add cluster struct to clusterUpdated event
45. `79d1694` - chore: markup & helpers for daoVUnits calculation
46. `e002d56` - feat: eb snapshot updates for eth & ssv
47. `6899c33` - chore: change init call to 2step upgradeable
48. `cf97d72` - feat: draft root voting
49. `8bae50a` - fix: replace root with key
50. `597ba89` - fix: align ClusterBalanceUpdated event signature with other cluster events
51. `04d1fe4` - cleanup comment
52. `525ea75` - Remove timestamps from DAO root events
53. `5c8db29` - OperatorMigratedToETH event added
54. `d052a30` - Merge pull request #324 from ssvlabs/fix/cluster-balance-updated-event-order
55. `314eb38` - fix: align ClusterBalanceUpdated indexing with other cluster events
56. `0d323b0` - Merge pull request #325 from ssvlabs/fix/cluster-balance-updated-indexing
57. `5ae7f9b` - feat: add effective balance to getter
58. `1bccd29` - feat: add cluster liquidation upon update
59. `84f0348` - Merge pull request #326 from ssvlabs/feat/cluster-balance-get-and-liquidate
60. `7f43990` - eb added to migrate event, operator default eth fee fixed
61. `81ad445` - Merge pull request #329 from ssvlabs/fix/add-eb-to-event
62. `96a59d6` - comment cleanup
63. `6be3ec5` - refactor: centralize validator register/remove flows in SSVClusters (#327)

### Phase 4: Operator Version Removal and Refactoring
64. `540d0c2` - operator version removed, migrate operator refactored
65. `642d597` - operator constants refactored
66. `425c8b0` - Allow migrating liquidated SSV clusters without double-counting operators
67. `5bcbac3` - Merge branch 'fix/liquidated-ssv-cluster-migration' into feat/eth-eb-merge
68. `5a9885d` - Ref/operator version (#330)
69. `ad2c0b6` - operator version removed
70. `7f722ac` - Merge pull request #337 from ssvlabs/fix/remove-operator-version

### Phase 5: EB Refinements and Infrastructure
71. `92e3c84` - feat: add eb minimum balance check (#333)
72. `f9eff2e` - Update balance getters and handle eb amount in gwei (#331)
73. `12ba64c` - fix: unit32 eb / operator struct (#334)
74. `21e25a1` - Reduce vunits scaling (#336)
75. `87b5760` - Change eb return data types (#338)
76. `21d91b0` - Migrate to hardhat v3 (#328)
77. `66d8bca` - Export abis and store them in the repo (#335)
78. `44ea372` - Feat/hoodi dev deployment (#339)

### Phase 6: Staking Contract
79. `03d7fd4` - feat:staking contract + cSSV WIP
80. `8776aef` - Merge branch 'feat/eth-eb-merge' into feat/staking-contract
81. `bff3aed` - feat:update deploy script, remove withdrawNetworkEarnings, optimizations

---

## Testing Recommendations

1. **Unit Tests:** Test all new ETH-based functions
2. **Integration Tests:** Test interaction between ETH and SSV token systems
3. **Migration Tests:** Test operator/cluster migration scenarios
4. **Security Tests:** Test reentrancy protection
5. **Backward Compatibility Tests:** Ensure existing SSV token operations continue to work
6. **Gas Optimization Tests:** Compare gas costs between ETH and SSV token operations
7. **EB Tests:** Test Effective Balance updates, Merkle proof validation, and automatic liquidation
8. **Oracle Tests:** Test root commitment, voting mechanism, timing constraints, and authorization
9. **vUnits Tests:** Test vUnits calculation and DAO earnings distribution
10. **Staking Tests:** Test staking, unstaking, reward distribution, transfer hooks, and cooldown mechanisms
11. **Edge Cases:** Test liquidated cluster migration, EB boundary conditions, update frequency limits, staking edge cases

---

## Notes

- The migration maintains full backward compatibility with existing SSV token-based operations
- ETH and SSV token systems operate independently with separate storage and tracking
- Operators can earn from both ETH and SSV validators simultaneously without version tracking
- All ETH transfer operations are protected against reentrancy attacks at proxy level
- Effective Balance system enables fee distribution based on actual validator performance
- vUnits precision reduced from 100 to 10,000 for better granularity
- EB updates can trigger automatic liquidation if cluster balance becomes insufficient
- Oracle system enforces timing constraints and update frequency limits for EB roots
- Root commitment requires 3 oracle confirmations before being finalized
- ETH network earnings are distributed through the staking contract to SSV stakers
- SSV token network earnings remain withdrawable directly by DAO
- Staking contract provides liquid staking with 7-day cooldown for unstaking
- cSSV tokens are transferable with automatic reward settlement
- Hardhat v3 migration provides better tooling and performance
- Scripts reorganization improves maintainability and deployment workflows
- ABI exports enable easier integration and deployment tracking

---
