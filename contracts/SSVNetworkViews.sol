// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "./interfaces/ISSVViews.sol";
import "./libraries/ClusterLib.sol";
import "./libraries/OperatorLib.sol";
import "./libraries/ProtocolLib.sol";
import {MAX_DELEGATION_SLOTS} from "./libraries/storage/SSVStorageStaking.sol";

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

contract SSVNetworkViews is UUPSUpgradeable, Ownable2StepUpgradeable, ISSVViews {
    using ClusterLib for Cluster;
    using OperatorLib for Operator;

    ISSVViews public ssvNetwork;

    // @dev reserve storage space for future new state variables in base contract
    // slither-disable-next-line shadowing-state
    uint256[50] private __gap;

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(ISSVViews ssvNetwork_) external initializer onlyProxy {
        __UUPSUpgradeable_init();
        __Ownable2Step_init();
        ssvNetwork = ssvNetwork_;
    }

    /*************************************/
    /* Validator External View Functions */
    /*************************************/

    function getValidator(address clusterOwner, bytes calldata publicKey) external view override returns (bool) {
        return ssvNetwork.getValidator(clusterOwner, publicKey);
    }

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint64 operatorId) external view override returns (uint256) {
        return ssvNetwork.getOperatorFee(operatorId);
    }

    function getOperatorFeeSSV(uint64 operatorId) external view override returns (uint256) {
        return ssvNetwork.getOperatorFeeSSV(operatorId);
    }

    function getOperatorDeclaredFee(uint64 operatorId) external view override returns (OperatorDeclaredFeeData memory) {
        return ssvNetwork.getOperatorDeclaredFee(operatorId);
    }

    function getOperatorById(
        uint64 operatorId
    ) external view override returns (OperatorData memory) {
        return ssvNetwork.getOperatorById(operatorId);
    }

    function getOperatorByIdSSV(
        uint64 operatorId
    ) external view override returns (OperatorData memory) {
        return ssvNetwork.getOperatorByIdSSV(operatorId);
    }

    function getWhitelistedOperators(
        uint64[] calldata operatorIds,
        address whitelistedAddress
    ) external view override returns (uint64[] memory whitelistedOperatorIds) {
        return ssvNetwork.getWhitelistedOperators(operatorIds, whitelistedAddress);
    }

    function isWhitelistingContract(address contractAddress) external view override returns (bool) {
        return ssvNetwork.isWhitelistingContract(contractAddress);
    }

    function isAddressWhitelistedInWhitelistingContract(
        address addressToCheck,
        uint256 operatorId,
        address whitelistingContract
    ) external view override returns (bool isWhitelisted) {
        return ssvNetwork.isAddressWhitelistedInWhitelistingContract(addressToCheck, operatorId, whitelistingContract);
    }

    /***********************************/
    /* Cluster External View Functions */
    /***********************************/

    function isLiquidatable(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        return ssvNetwork.isLiquidatable(clusterOwner, operatorIds, cluster);
    }

    function isLiquidatableSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        return ssvNetwork.isLiquidatableSSV(clusterOwner, operatorIds, cluster);
    }

    function isLiquidated(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        return ssvNetwork.isLiquidated(clusterOwner, operatorIds, cluster);
    }

    function getBurnRate(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256) {
        return ssvNetwork.getBurnRate(clusterOwner, operatorIds, cluster);
    }

    function getBurnRateSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256) {
        return ssvNetwork.getBurnRateSSV(clusterOwner, operatorIds, cluster);
    }

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    function getOperatorEarnings(uint64 id) external view override returns (uint256) {
        return ssvNetwork.getOperatorEarnings(id);
    }

    function getOperatorEarningsSSV(uint64 id) external view override returns (uint256) {
        return ssvNetwork.getOperatorEarningsSSV(id);
    }

    function getBalance(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256 balance) {
        return ssvNetwork.getBalance(clusterOwner, operatorIds, cluster);
    }

    function getBalanceSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256 balance) {
        return ssvNetwork.getBalanceSSV(clusterOwner, operatorIds, cluster);
    }

    function getEffectiveBalance(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view returns (uint32 effectiveBalance) {
        return ssvNetwork.getEffectiveBalance(clusterOwner, operatorIds, cluster);
    }

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external view override returns (uint256) {
        return ssvNetwork.getNetworkFee();
    }

    function getNetworkEarnings() external view override returns (uint256) {
        return ssvNetwork.getNetworkEarnings();
    }

    function getNetworkFeeSSV() external view override returns (uint256) {
        return ssvNetwork.getNetworkFeeSSV();
    }

    function getNetworkEarningsSSV() external view override returns (uint256) {
        return ssvNetwork.getNetworkEarningsSSV();
    }

    function getOperatorFeeIncreaseLimit() external view override returns (uint64) {
        return ssvNetwork.getOperatorFeeIncreaseLimit();
    }

    function getMaximumOperatorFee() external view override returns (uint256) {
        return ssvNetwork.getMaximumOperatorFee();
    }

    function getMaximumOperatorFeeSSV() external view override returns (uint256) {
        return ssvNetwork.getMaximumOperatorFeeSSV();
    }

    function getMinimumOperatorEthFee() external view override returns (uint256) {
        return ssvNetwork.getMinimumOperatorEthFee();
    }

    function getOperatorFeePeriods() external view override returns (OperatorFeePeriodsData memory) {
        return ssvNetwork.getOperatorFeePeriods();
    }

    function getLiquidationThresholdPeriod() external view override returns (uint64) {
        return ssvNetwork.getLiquidationThresholdPeriod();
    }

    function getLiquidationThresholdPeriodSSV() external view override returns (uint64) {
        return ssvNetwork.getLiquidationThresholdPeriodSSV();
    }

    function getMinimumLiquidationCollateral() external view override returns (uint256) {
        return ssvNetwork.getMinimumLiquidationCollateral();
    }

    function getMinimumLiquidationCollateralSSV() external view override returns (uint256) {
        return ssvNetwork.getMinimumLiquidationCollateralSSV();
    }

    function getValidatorsPerOperatorLimit() external view override returns (uint32) {
        return ssvNetwork.getValidatorsPerOperatorLimit();
    }

    function getNetworkValidatorsCount() external view override returns (uint32) {
        return ssvNetwork.getNetworkValidatorsCount();
    }

    function getClusterAssetType(address owner, uint64[] calldata operatorIds) external view override returns (uint8) {
        return ssvNetwork.getClusterAssetType(owner, operatorIds);
    }

    function cooldownDuration() external view override returns (uint256) {
        return ssvNetwork.cooldownDuration();
    }

    function totalStaked() external view override returns (uint256) {
        return ssvNetwork.totalStaked();
    }

    function stakedBalanceOf(address user) external view override returns (uint256) {
        return ssvNetwork.stakedBalanceOf(user);
    }

    function pendingUnstake(address user) external view override returns (UnstakeRequestsData[] memory) {
        return ssvNetwork.pendingUnstake(user);
    }

    function accEthPerShare() external view override returns (uint256) {
        return ssvNetwork.accEthPerShare();
    }

    function stakingEthPoolBalance() external view override returns (uint256) {
        return ssvNetwork.stakingEthPoolBalance();
    }

    function previewClaimableEth(address user) external view override returns (uint256) {
        return ssvNetwork.previewClaimableEth(user);
    }

    function getOracle(uint32 oracleId) external view override returns (address) {
        return ssvNetwork.getOracle(oracleId);
    }

    function getOracleWeight(uint32 oracleId) external view override returns (uint256) {
        return ssvNetwork.getOracleWeight(oracleId);
    }

    function getActiveOracleIds() external view override returns (uint32[MAX_DELEGATION_SLOTS] memory) {
        return ssvNetwork.getActiveOracleIds();
    }

    function getQuorumBps() external view override returns (uint16) {
        return ssvNetwork.getQuorumBps();
    }

    function getCommittedRoot(uint64 blockNum) external view override returns (bytes32) {
        return ssvNetwork.getCommittedRoot(blockNum);
    }

    function getVersion() external view override returns (string memory) {
        return ssvNetwork.getVersion();
    }
}
