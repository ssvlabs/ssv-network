// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "./interfaces/ISSVNetwork.sol";
import "./interfaces/ISSVClusters.sol";
import "./interfaces/ISSVValidators.sol";
import "./interfaces/ISSVOperators.sol";
import "./interfaces/ISSVOperatorsWhitelist.sol";
import "./interfaces/ISSVDAO.sol";
import "./interfaces/ISSVViews.sol";
import "./interfaces/ISSVStaking.sol";
import "./interfaces/external/ISSVWhitelistingContract.sol";

import {PackedETHLib} from "./libraries/SSVPackedLib.sol";
import {CoreLib} from "./libraries/CoreLib.sol";
import {StorageProtocol, SSVStorageProtocol} from "./libraries/storage/SSVStorageProtocol.sol";
import {StorageData, SSVModules, SSVStorage} from "./libraries/storage/SSVStorage.sol";
import {SSVStorageStaking, StorageStaking} from "./libraries/storage/SSVStorageStaking.sol";

import "./SSVProxy.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

contract SSVNetwork is
    UUPSUpgradeable,
    Ownable2StepUpgradeable,
    ISSVNetwork,
    ISSVOperators,
    ISSVOperatorsWhitelist,
    ISSVClusters,
    ISSVValidators,
    ISSVDAO,
    ISSVStaking,
    SSVProxy
{
    /****************/
    /* Initializers */
    /****************/

    function initialize(
        IERC20 token_,
        ISSVOperators ssvOperators_,
        ISSVClusters ssvClusters_,
        ISSVDAO ssvDAO_,
        ISSVViews ssvViews_,
        NetworkInitParams calldata params
    ) external override initializer onlyProxy {
        __UUPSUpgradeable_init();
        __Ownable2Step_init();
        __SSVNetwork_init_unchained(
            token_,
            ssvOperators_,
            ssvClusters_,
            ssvDAO_,
            ssvViews_,
            params
        );
    }

    function __SSVNetwork_init_unchained(
        IERC20 token_,
        ISSVOperators ssvOperators_,
        ISSVClusters ssvClusters_,
        ISSVDAO ssvDAO_,
        ISSVViews ssvViews_,
        NetworkInitParams calldata params
    ) internal onlyInitializing {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageStaking storage ss = SSVStorageStaking.load();
        
        s.token = token_;
        s.ssvContracts[SSVModules.SSV_OPERATORS] = address(ssvOperators_);
        s.ssvContracts[SSVModules.SSV_CLUSTERS] = address(ssvClusters_);
        s.ssvContracts[SSVModules.SSV_DAO] = address(ssvDAO_);
        s.ssvContracts[SSVModules.SSV_VIEWS] = address(ssvViews_);
        
        sp.minimumBlocksBeforeLiquidation = params.minimumBlocksBeforeLiquidation;
        sp.minimumLiquidationCollateral = PackedETHLib.pack(params.minimumLiquidationCollateral);
        sp.validatorsPerOperatorLimit = params.validatorsPerOperatorLimit;
        sp.declareOperatorFeePeriod = params.declareOperatorFeePeriod;
        sp.executeOperatorFeePeriod = params.executeOperatorFeePeriod;
        sp.operatorMaxFeeIncrease = params.operatorMaxFeeIncrease;
        
        ss.defaultOracleIds = params.defaultOracleIds;
        ss.quorumBps = params.quorumBps;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /*****************/
    /* UUPS required */
    /*****************/

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /*********************/
    /* Fallback function */
    /*********************/
    fallback() external {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_VIEWS];
        _delegate(target);
    }

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    function registerOperator(
        bytes calldata publicKey,
        uint256 fee,
        bool setPrivate
    ) external override returns (uint64 id) {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS];
        _delegate(target);
    }

    function removeOperator(uint64 operatorId) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS];
        _delegate(target);
    }

    function setOperatorsWhitelists(
        uint64[] calldata operatorIds,
        address[] calldata whitelistAddresses
    ) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS_WHITELIST];
        _delegate(target);
    }

    function removeOperatorsWhitelists(
        uint64[] calldata operatorIds,
        address[] calldata whitelistAddresses
    ) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS_WHITELIST];
        _delegate(target);
    }

    function setOperatorsWhitelistingContract(
        uint64[] calldata operatorIds,
        ISSVWhitelistingContract whitelistingContract
    ) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS_WHITELIST];
        _delegate(target);
    }

    function setOperatorsPrivateUnchecked(uint64[] calldata operatorIds) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS];
        _delegate(target);
    }

    function setOperatorsPublicUnchecked(uint64[] calldata operatorIds) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS];
        _delegate(target);
    }

    // Proxy redirection optimization for whitlist controls
    function removeOperatorsWhitelistingContract(uint64[] calldata operatorIds) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS_WHITELIST];
        _delegate(target);
    }

    function declareOperatorFee(uint64 operatorId, uint256 fee) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS];
        _delegate(target);
    }

    function executeOperatorFee(uint64 operatorId) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS];
        _delegate(target);
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS];
        _delegate(target);
    }

    function reduceOperatorFee(uint64 operatorId, uint256 fee) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS];
        _delegate(target);
    }

    function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS];
        _delegate(target);
    }

    function withdrawAllOperatorEarnings(uint64 operatorId) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS];
        _delegate(target);
    }

    function withdrawAllVersionOperatorEarnings(uint64 operatorId) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS];
        _delegate(target);
    }

    function withdrawOperatorEarningsSSV(uint64 operatorId, uint256 amount) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS];
        _delegate(target);
    }

    function withdrawAllOperatorEarningsSSV(uint64 operatorId) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS];
        _delegate(target);
    }

    /*******************************/
    /* Address External Functions */
    /*******************************/

    function setFeeRecipientAddress(address recipientAddress) external override {
        emit FeeRecipientAddressUpdated(msg.sender, recipientAddress);
    }

    /*******************************/
    /* Staking External Functions */
    /*******************************/

    function syncFees() external {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_STAKING];
        _delegate(target);
    }

    function stake(uint256 amount) external {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_STAKING];
        _delegate(target);
    }

    function requestUnstake(uint256 amount) external {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_STAKING];
        _delegate(target);
    }

    function withdrawUnlocked() external {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_STAKING];
        _delegate(target);
    }

    function claimEthRewards() external {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_STAKING];
        _delegate(target);
    }

    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_STAKING];
        _delegate(target);
    }

    function onCSSVTransfer(address from, address to, uint256 amount) external {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_STAKING];
        _delegate(target);
    }

    /*******************************/
    /* Validator External Functions */
    /*******************************/

    function registerValidator(
        bytes calldata publicKey,
        uint64[] calldata operatorIds,
        bytes calldata sharesData,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_VALIDATORS];
        _delegate(target);
    }

    function bulkRegisterValidator(
        bytes[] calldata publicKeys,
        uint64[] calldata operatorIds,
        bytes[] calldata sharesData,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_VALIDATORS];
        _delegate(target);
    }

    function removeValidator(
        bytes calldata publicKey,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_VALIDATORS];
        _delegate(target);
    }

    function bulkRemoveValidator(
        bytes[] calldata publicKeys,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_VALIDATORS];
        _delegate(target);
    }

    function liquidate(
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS];
        _delegate(target);
    }

    // Proxy redirection optimization for liquidation tasks
    function liquidateSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS];
        _delegate(target);
    }

    function reactivate(
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS];
        _delegate(target);
    }

    function deposit(
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS];
        _delegate(target);
    }

    function withdraw(
        uint64[] calldata operatorIds,
        uint256 amount,
        ISSVNetworkCore.Cluster memory cluster
    ) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS];
        _delegate(target);
    }

    function updateClusterBalance(
        uint64 blockNum,
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster,
        uint32 effectiveBalance,
        bytes32[] calldata merkleProof
    ) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS];
        _delegate(target);
    }

    function migrateClusterToETH(
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS];
        _delegate(target);
    }

    function exitValidator(bytes calldata publicKey, uint64[] calldata operatorIds) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_VALIDATORS];
        _delegate(target);
    }

    function bulkExitValidator(bytes[] calldata publicKeys, uint64[] calldata operatorIds) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_VALIDATORS];
        _delegate(target);
    }

    function updateNetworkFee(uint256 fee) external override onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function updateNetworkFeeSSV(uint256 fee) external override onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function withdrawNetworkSSVEarnings(uint256 amount) external override onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function updateOperatorFeeIncreaseLimit(uint64 percentage) external override onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function updateDeclareOperatorFeePeriod(uint64 timeInSeconds) external override onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function updateExecuteOperatorFeePeriod(uint64 timeInSeconds) external override onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function updateLiquidationThresholdPeriod(uint64 blocks) external override onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function updateLiquidationThresholdPeriodSSV(uint64 blocks) external onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function updateMinimumLiquidationCollateral(uint256 amount) external override onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function updateMinimumLiquidationCollateralSSV(uint256 amount) external onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function updateMaximumOperatorFee(uint256 maxFee) external override onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function updateMinimumOperatorEthFee(uint256 minFee) external override onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function commitRoot(bytes32 merkleRoot, uint64 blockNum) external override {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function updateUnstakeCooldownDuration(uint64 duration) external onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function updateMinBlocksBetweenUpdates(uint32 blocks) external override onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function replaceOracle(uint32 oracleId, address newOracle) external override onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function updateQuorumBps(uint16 quorum) external override onlyOwner {
        address target = SSVStorage.load().ssvContracts[SSVModules.SSV_DAO];
        _delegate(target);
    }

    function getVersion() external pure override returns (string memory version) {
        return CoreLib.getVersion();
    }

    /*******************************/
    /* Upgrade Modules Function    */
    /*******************************/
    function updateModule(SSVModules moduleId, address moduleAddress) external onlyOwner {
        CoreLib.setModuleContract(moduleId, moduleAddress);
    }
}
