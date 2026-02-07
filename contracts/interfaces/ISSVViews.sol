// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";
import {MAX_DELEGATION_SLOTS} from "../libraries/storage/SSVStorageStaking.sol";

/**
 * @title SSV Views Interface
 * @author SSV Labs
 * @notice Interface providing view functions to retrieve network state, operator data, validator status, cluster information, fees, and staking details
 */
interface ISSVViews is ISSVNetworkCore {
    /**
     * @notice Returns whether a validator is active
     * @param owner Owner of the validator
     * @param publicKey Validator public key
     * @return active True if validator exists and is active
     */
    function getValidator(address owner, bytes calldata publicKey) external view returns (bool active);

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
     * @notice Returns the currently declared (pending) operator fee
     * @param operatorId The operator ID
     * @return isFeeDeclared Whether a fee is currently declared
     * @return fee The declared fee amount
     * @return approvalBeginTime Start of the approval window
     * @return approvalEndTime End of the approval window
     */
    function getOperatorDeclaredFee(uint64 operatorId)
    external
    view
    returns (
        bool isFeeDeclared,
        uint256 fee,
        uint64 approvalBeginTime,
        uint64 approvalEndTime
    );

    /**
     * @notice Returns full details of an operator (ETH version)
     * @param operatorId The operator ID
     * @return owner Operator owner address
     * @return ethFee Current ETH fee
     * @return ethValidatorCount Number of validators managed
     * @return whitelistedAddress Whitelisted address or contract
     * @return isPrivate Whether operator is private
     * @return active Whether operator is active
     */
    function getOperatorById(uint64 operatorId)
    external
    view
    returns (
        address owner,
        uint256 ethFee,
        uint32 ethValidatorCount,
        address whitelistedAddress,
        bool isPrivate,
        bool active
    );

    /**
     * @notice Returns full details of an operator (legacy SSV version)
     * @param operatorId The operator ID
     * @return owner Operator owner address
     * @return fee Current SSV fee
     * @return validatorCount Number of validators managed
     * @return whitelistedAddress Whitelisted address or contract
     * @return isPrivate Whether operator is private
     * @return active Whether operator is active
     */
    function getOperatorByIdSSV(uint64 operatorId)
    external
    view
    returns (
        address owner,
        uint256 fee,
        uint32 validatorCount,
        address whitelistedAddress,
        bool isPrivate,
        bool active
    );

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
    function getMaximumOperatorFee() external view returns (uint64);

    /**
     * @notice Returns the maximum allowed operator fee (SSV)
     * @return Maximum operator fee
     */
    function getMaximumOperatorFeeSSV() external view returns (uint64);

    /**
     * @notice Returns the minimum operator ETH fee set by DAO
     * @return Minimum operator fee in ETH
     */
    function getMinimumOperatorEthFee() external view returns (uint64);

    /**
     * @notice Returns the declaration and execution periods for operator fee changes
     * @return declarationPeriod Duration of declaration phase
     * @return executionPeriod Duration of execution phase
     */
    function getOperatorFeePeriods() external view returns (uint64 declarationPeriod, uint64 executionPeriod);

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
     * @return amounts Array of pending amounts
     * @return unlockTimes Array of unlock timestamps
     */
    function pendingUnstake(address user)
    external
    view
    returns (uint256[] memory amounts, uint256[] memory unlockTimes);

    /**
     * @notice Returns current accumulated ETH per share
     * @return Accumulated ETH per share
     */
    function accEthPerShare() external view returns (uint256);

    /**
     * @notice Returns current ETH balance in the staking pool
     * @return ETH pool balance
     */
    function stakingEthPoolBalance() external view returns (uint64);

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