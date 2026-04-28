// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";
import {MAX_DELEGATION_SLOTS} from "../libraries/storage/SSVStorageStaking.sol";

/**
 * @title SSV Views Types Interface
 * @author SSV Labs
 * @notice Interface providing strict data types to be used as return values in SSV Views getters
 */
interface ISSVViewsTypes {
    /// @notice Contains data about a declared (pending) operator fee change
    struct OperatorDeclaredFeeData {
        /// @dev Whether the operator has an active fee declaration
        bool isFeeDeclared;
        /// @dev The fee value that was declared
        uint256 fee;
        /// @dev Timestamp when the approval window for this declaration begins
        uint64 approvalBeginTime;
        /// @dev Timestamp when the approval window for this declaration ends
        uint64 approvalEndTime;
    }

    /// @notice Contains core information about an operator
    struct OperatorData {
        /// @dev The address that owns and manages the operator
        address owner;
        /// @dev The current fee charged by the operator
        uint256 fee;
        /// @dev The number of validators currently registered to this operator
        uint32 validatorCount;
        /// @dev The address whitelisted for this operator
        address whitelistedAddress;
        /// @dev Whether the operator is private
        bool isPrivate;
        /// @dev Whether the operator is currently active
        bool isActive;
    }

    /// @notice Contains the time periods used for operator fee change workflow
    struct OperatorFeePeriodsData {
        /// @dev Duration (in seconds) of the declaration period
        uint64 declarePeriod;
        /// @dev Duration (in seconds) of the approval/execution period
        uint64 executePeriod;
    }

    /// @notice Represents a single pending unstake request
    struct UnstakeRequestsData {
        /// @dev The amount of SSV requested to be unstaked
        uint256 amount;
        /// @dev Timestamp after which the unstaked amount becomes withdrawable
        uint256 unlockTime;
    }
}

/**
 * @title SSV Views Interface
 * @author SSV Labs
 * @notice Interface providing view functions to retrieve network state, operator data, validator status, cluster information, fees, and staking details
 */
interface ISSVViews is ISSVNetworkCore, ISSVViewsTypes {
    /**
     * @notice Returns whether a validator is active
     * @param owner Owner of the validator
     * @param publicKey Validator public key
     * @return active True if validator exists and is active
     */
    function getValidator(address owner, bytes calldata publicKey) external view returns (bool);

    /**
     * @notice Returns the current ETH fee of an operator
     * @param operatorId The operator ID
     * @return fee Current operator fee in ETH
     */
    function getOperatorFee(uint64 operatorId) external view returns (uint256 fee);

    /**
     * @notice Returns the legacy SSV fee of an operator
     * @param operatorId The operator ID
     * @return fee Current operator fee in SSV
     */
    function getOperatorFeeSSV(uint64 operatorId) external view returns (uint256 fee);

    /**
     * @notice Gets the declared operator fee
     * @param operatorId The ID of the operator
     * @return data Declaration data
     */
    function getOperatorDeclaredFee(
        uint64 operatorId
    ) external view returns (OperatorDeclaredFeeData memory);

    /**
     * @notice Gets operator details by ID
     * @param operatorId The ID of the operator
     * @return The struct with operator details
     */
    function getOperatorById(
        uint64 operatorId
    )
        external
        view
        returns (OperatorData memory);

    /**
     * @notice Gets legacy SSV operator details by ID
     * @param operatorId The ID of the operator
     * @return The struct with operator details
     */
    function getOperatorByIdSSV(
        uint64 operatorId
    )
        external
        view
        returns (OperatorData memory);

    /**
     * @notice Returns which operators have the given address whitelisted
     * @param operatorIds List of operator IDs to check
     * @param whitelistedAddress Address to check
     * @return whitelistedOperatorIds List of operators where address is whitelisted
     */
    function getWhitelistedOperators(
        uint64[] calldata operatorIds,
        address whitelistedAddress
    ) external view returns (uint64[] memory whitelistedOperatorIds);

    /**
     * @notice Checks if an address is a valid whitelisting contract
     * @param contractAddress Address to check
     * @return isWhitelistingContract True if address implements ISSVWhitelistingContract
     */
    function isWhitelistingContract(address contractAddress) external view returns (bool);

    /**
     * @notice Checks if an address is whitelisted in a specific whitelisting contract
     * @param addressToCheck Address to verify
     * @param operatorId Operator ID (usage depends on contract implementation)
     * @param whitelistingContract Whitelisting contract address
     * @return isWhitelisted Whether the address is whitelisted
     */
    function isAddressWhitelistedInWhitelistingContract(
        address addressToCheck,
        uint256 operatorId,
        address whitelistingContract
    ) external view returns (bool isWhitelisted);

    /**
     * @notice Checks if a cluster is eligible for liquidation
     * @param owner Cluster owner
     * @param operatorIds Operator IDs in the cluster
     * @param cluster Cluster data
     * @return isLiquidatable True if cluster can be liquidated
     */
    function isLiquidatable(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view returns (bool isLiquidatable);

    /**
     * @notice Checks if a legacy SSV cluster is eligible for liquidation
     * @param owner Cluster owner
     * @param operatorIds Operator IDs in the cluster
     * @param cluster Cluster data
     * @return isLiquidatable True if cluster can be liquidated
     */
    function isLiquidatableSSV(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view returns (bool isLiquidatable);

    /**
     * @notice Checks if a cluster is already liquidated
     * @param owner Cluster owner
     * @param operatorIds Operator IDs in the cluster
     * @param cluster Cluster data
     * @return isLiquidated True if cluster is liquidated
     */
    function isLiquidated(
        address owner,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external view returns (bool isLiquidated);

    /**
     * @notice Returns the current burn rate of a cluster
     * @param owner Cluster owner
     * @param operatorIds Operator IDs in the cluster
     * @param cluster Cluster data
     * @return burnRate Current burn rate in SSV per block
     */
    function getBurnRate(
        address owner,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external view returns (uint256 burnRate);

    /**
     * @notice Returns the burn rate of a legacy SSV cluster
     * @param owner Cluster owner
     * @param operatorIds Operator IDs in the cluster
     * @param cluster Cluster data
     * @return burnRate Current burn rate in SSV per block
     */
    function getBurnRateSSV(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view returns (uint256 burnRate);

    /**
     * @notice Returns accumulated operator earnings (ETH)
     * @param operatorId The operator ID
     * @return earnings Total ETH earnings
     */
    function getOperatorEarnings(uint64 operatorId) external view returns (uint256 earnings);

    /**
     * @notice Returns accumulated operator earnings (legacy SSV)
     * @param operatorId The operator ID
     * @return earnings Total SSV earnings
     */
    function getOperatorEarningsSSV(uint64 operatorId) external view returns (uint256 earnings);

    /**
     * @notice Returns the balance of a cluster
     * @param owner Cluster owner
     * @param operatorIds Operator IDs in the cluster
     * @param cluster Cluster data
     * @return balance Cluster balance in ETH
     */
    function getBalance(
        address owner,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external view returns (uint256 balance);

    /**
     * @notice Returns the balance of a legacy SSV cluster
     * @param owner Cluster owner
     * @param operatorIds Operator IDs in the cluster
     * @param cluster Cluster data
     * @return balance Cluster balance in SSV
     */
    function getBalanceSSV(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view returns (uint256 balance);

    /**
     * @notice Returns the effective balance of a cluster
     * @param owner Cluster owner
     * @param operatorIds Operator IDs in the cluster
     * @param cluster Cluster data
     * @return effectiveBalance Effective balance
     */
    function getEffectiveBalance(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view returns (uint32 effectiveBalance);

    /**
     * @notice Returns the asset type/version of a cluster
     * @param owner Cluster owner
     * @param operatorIds Operator IDs in the cluster
     * @return version Cluster version (ETH or SSV)
     */
    function getClusterAssetType(
        address owner,
        uint64[] calldata operatorIds
    ) external view returns (uint8 version);

    /**
     * @notice Returns the current network fee
     * @return networkFee Current network fee in ETH
     */
    function getNetworkFee() external view returns (uint256 networkFee);

    /**
     * @notice Returns the total network earnings
     * @return networkEarnings Total network earnings in ETH
     */
    function getNetworkEarnings() external view returns (uint256 networkEarnings);

    /**
     * @notice Returns the legacy network fee (SSV)
     * @return networkFee Current network fee in SSV
     */
    function getNetworkFeeSSV() external view returns (uint256 networkFee);

    /**
     * @notice Returns the legacy network earnings (SSV)
     * @return networkEarnings Total network earnings in SSV
     */
    function getNetworkEarningsSSV() external view returns (uint256 networkEarnings);

    /**
     * @notice Returns the maximum allowed operator fee increase percentage
     * @return Maximum fee increase limit
     */
    function getOperatorFeeIncreaseLimit() external view returns (uint64);

    /**
     * @notice Returns the maximum allowed operator fee (ETH)
     * @return Maximum operator fee
     */
    function getMaximumOperatorFee() external view returns (uint256);

    /**
     * @notice Returns the maximum allowed operator fee (SSV)
     * @return Maximum operator fee
     */
    function getMaximumOperatorFeeSSV() external view returns (uint256);

    /**
     * @notice Returns the minimum operator ETH fee set by DAO
     * @return Minimum operator fee in ETH
     */
    function getMinimumOperatorEthFee() external view returns (uint256);

    /**
     * @notice Returns the declaration and execution periods for operator fee changes
     * @return The struct with operator fee periods
     */
    function getOperatorFeePeriods() external view returns (OperatorFeePeriodsData memory);

    /**
     * @notice Returns the liquidation threshold period (ETH)
     * @return blocks Number of blocks
     */
    function getLiquidationThresholdPeriod() external view returns (uint64 blocks);

    /**
     * @notice Returns the liquidation threshold period (SSV)
     * @return blocks Number of blocks
     */
    function getLiquidationThresholdPeriodSSV() external view returns (uint64 blocks);

    /**
     * @notice Returns the minimum liquidation collateral
     * @return amount Minimum collateral in SSV
     */
    function getMinimumLiquidationCollateral() external view returns (uint256 amount);

    /**
     * @notice Returns the minimum liquidation collateral (SSV)
     * @return amount Minimum collateral in SSV
     */
    function getMinimumLiquidationCollateralSSV() external view returns (uint256 amount);

    /**
     * @notice Returns the maximum number of validators per operator
     * @return validators Maximum validators allowed
     */
    function getValidatorsPerOperatorLimit() external view returns (uint32 validators);

    /**
     * @notice Returns total number of registered validators in the network
     * @return validatorsCount Total validator count
     */
    function getNetworkValidatorsCount() external view returns (uint32 validatorsCount);

    /**
     * @notice Returns the unstaking cooldown duration
     * @return Cooldown period in seconds
     */
    function cooldownDuration() external view returns (uint256);

    /**
     * @notice Returns total SSV tokens currently staked
     * @return Total staked amount
     */
    function totalStaked() external view returns (uint256);

    /**
     * @notice Returns the staked balance of a user
     * @param user User address
     * @return Staked balance
     */
    function stakedBalanceOf(address user) external view returns (uint256);

    /**
     * @notice Returns pending unstake requests for a user
     * @param user User address
     * @return Array of pending amounts and unstake requests
     */
    function pendingUnstake(address user) external view returns (UnstakeRequestsData[] memory);

    /**
     * @notice Returns current accumulated ETH per share
     * @return Accumulated ETH per share
     */
    function accEthPerShare() external view returns (uint256);

    /**
     * @notice Returns current ETH balance in the staking pool
     * @return ETH pool balance
     */
    function stakingEthPoolBalance() external view returns (uint256);

    /**
     * @notice Returns claimable ETH rewards for a user
     * @param user User address
     * @return Claimable ETH amount
     */
    function previewClaimableEth(address user) external view returns (uint256);

    /**
     * @notice Returns oracle address by ID
     * @param oracleId Oracle ID
     * @return Oracle address
     */
    function getOracle(uint32 oracleId) external view returns (address);

    /**
     * @notice Returns weight of a specific oracle
     * @param oracleId Oracle ID
     * @return Oracle weight
     */
    function getOracleWeight(uint32 oracleId) external view returns (uint256);

    /**
     * @notice Returns currently active oracle IDs
     * @return Array of active oracle IDs
     */
    function getActiveOracleIds() external view returns (uint32[MAX_DELEGATION_SLOTS] memory);

    /**
     * @notice Returns the required quorum in basis points
     * @return Quorum in bps
     */
    function getQuorumBps() external view returns (uint16);

    /**
     * @notice Returns the committed merkle root for a given block
     * @param blockNum Block number
     * @return merkleRoot Committed merkle root
     */
    function getCommittedRoot(uint64 blockNum) external view returns (bytes32 merkleRoot);

    /**
     * @notice Returns the current contract version
     * @return Contract version string
     */
    function getVersion() external view returns (string memory);
}