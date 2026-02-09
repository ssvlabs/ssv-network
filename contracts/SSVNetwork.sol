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
import {StorageData, SSVModules} from "./libraries/storage/SSVStorage.sol";
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
        // Delegates the call to the address of the SSV Views module
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_VIEWS]);
    }

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    function registerOperator(
        bytes calldata publicKey,
        uint256 fee,
        bool setPrivate
    ) external override returns (uint64 id) {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS]);
    }

    function removeOperator(uint64 operatorId) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS]);
    }

    function setOperatorsWhitelists(
        uint64[] calldata operatorIds,
        address[] calldata whitelistAddresses
    ) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS_WHITELIST]);
    }

    function removeOperatorsWhitelists(
        uint64[] calldata operatorIds,
        address[] calldata whitelistAddresses
    ) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS_WHITELIST]);
    }

    function setOperatorsWhitelistingContract(
        uint64[] calldata operatorIds,
        ISSVWhitelistingContract whitelistingContract
    ) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS_WHITELIST]);
    }

    function setOperatorsPrivateUnchecked(uint64[] calldata operatorIds) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS]);
    }

    function setOperatorsPublicUnchecked(uint64[] calldata operatorIds) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS]);
    }

    function removeOperatorsWhitelistingContract(uint64[] calldata operatorIds) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS_WHITELIST]);
    }

    function declareOperatorFee(uint64 operatorId, uint256 fee) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS]);
    }

    function executeOperatorFee(uint64 operatorId) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS]);
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS]);
    }

    function reduceOperatorFee(uint64 operatorId, uint256 fee) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS]);
    }

    function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS]);
    }

    function withdrawAllOperatorEarnings(uint64 operatorId) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS]);
    }

    function withdrawAllVersionOperatorEarnings(uint64 operatorId) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS]);
    }

    function withdrawOperatorEarningsSSV(uint64 operatorId, uint256 amount) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS]);
    }

    function withdrawAllOperatorEarningsSSV(uint64 operatorId) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS]);
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
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_STAKING]);
    }

    function stake(uint256 amount) external {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_STAKING]);
    }

    function requestUnstake(uint256 amount) external {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_STAKING]);
    }

    function withdrawUnlocked() external {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_STAKING]);
    }

    function claimEthRewards() external {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_STAKING]);
    }

    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_STAKING]);
    }

    function onCSSVTransfer(address from, address to, uint256 amount) external {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_STAKING]);
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
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_VALIDATORS]);
    }

    function bulkRegisterValidator(
        bytes[] calldata publicKeys,
        uint64[] calldata operatorIds,
        bytes[] calldata sharesData,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_VALIDATORS]);
    }

    function removeValidator(
        bytes calldata publicKey,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_VALIDATORS]);
    }

    function bulkRemoveValidator(
        bytes[] calldata publicKeys,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_VALIDATORS]);
    }

    function liquidate(
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS]);
    }

    function liquidateSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS]);
    }

    function reactivate(
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS]);
    }

    function deposit(
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS]);
    }

    function withdraw(
        uint64[] calldata operatorIds,
        uint256 amount,
        ISSVNetworkCore.Cluster memory cluster
    ) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS]);
    }

    function updateClusterBalance(
        uint64 blockNum,
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster,
        uint32 effectiveBalance,
        bytes32[] calldata merkleProof
    ) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS]);
    }

    function migrateClusterToETH(
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS]);
    }

    function exitValidator(bytes calldata publicKey, uint64[] calldata operatorIds) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_VALIDATORS]);
    }

    function bulkExitValidator(bytes[] calldata publicKeys, uint64[] calldata operatorIds) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_VALIDATORS]);
    }

    function updateNetworkFee(uint256 fee) external override onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
    }

    function updateNetworkFeeSSV(uint256 fee) external override onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
    }

    function withdrawNetworkSSVEarnings(uint256 amount) external override onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
    }

    function updateOperatorFeeIncreaseLimit(uint64 percentage) external override onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
    }

    function updateDeclareOperatorFeePeriod(uint64 timeInSeconds) external override onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
    }

    function updateExecuteOperatorFeePeriod(uint64 timeInSeconds) external override onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
    }

    function updateLiquidationThresholdPeriod(uint64 blocks) external override onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
    }

    function updateLiquidationThresholdPeriodSSV(uint64 blocks) external onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
    }

    function updateMinimumLiquidationCollateral(uint256 amount) external override onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
    }

    function updateMinimumLiquidationCollateralSSV(uint256 amount) external onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
    }

    function updateMaximumOperatorFee(uint256 maxFee) external override onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
    }

    function updateMinimumOperatorEthFee(uint256 minFee) external override onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
    }

    function commitRoot(bytes32 merkleRoot, uint64 blockNum) external override {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
    }

    function setUnstakeCooldownDuration(uint64 duration) external onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
    }

    function replaceOracle(uint32 oracleId, address newOracle) external override onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
    }

    function setQuorumBps(uint16 quorum) external override onlyOwner {
        _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_DAO]);
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
