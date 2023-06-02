// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./interfaces/ISSVNetwork.sol";

import "./interfaces/events/IEvSSVOperators.sol";
import "./interfaces/events/IEvSSVClusters.sol";
import "./interfaces/events/IEvSSVDAO.sol";

import "./interfaces/functions/IFnSSVViews.sol";
import "./interfaces/functions/IFnSSVOperators.sol";
import "./interfaces/functions/IFnSSVClusters.sol";
import "./interfaces/functions/IFnSSVDAO.sol";

import "./libraries/Types.sol";
import "./libraries/CoreLib.sol";
import "./libraries/SSVStorage.sol";
import "./libraries/OperatorLib.sol";
import "./libraries/ClusterLib.sol";
import "./libraries/RegisterAuth.sol";

import {SSVModules} from "./libraries/SSVStorage.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

contract SSVNetwork is
    UUPSUpgradeable,
    Ownable2StepUpgradeable,
    ISSVNetwork,
    IEvSSVOperators,
    IEvSSVClusters,
    IEvSSVDAO
{
    using Types256 for uint256;
    using ClusterLib for Cluster;

    /****************/
    /* Initializers */
    /****************/

    function initialize(
        IERC20 token_,
        IFnSSVOperators ssvOperators_,
        IFnSSVClusters ssvClusters_,
        IFnSSVDAO ssvDAO_,
        IFnSSVViews ssvViews_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint256 minimumLiquidationCollateral_,
        uint32 validatorsPerOperatorLimit_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint64 operatorMaxFeeIncrease_
    ) external override initializer onlyProxy {
        __UUPSUpgradeable_init();
        __Ownable_init_unchained();
        __SSVNetwork_init_unchained(
            token_,
            ssvOperators_,
            ssvClusters_,
            ssvDAO_,
            ssvViews_,
            minimumBlocksBeforeLiquidation_,
            minimumLiquidationCollateral_,
            validatorsPerOperatorLimit_,
            declareOperatorFeePeriod_,
            executeOperatorFeePeriod_,
            operatorMaxFeeIncrease_
        );
    }

    function __SSVNetwork_init_unchained(
        IERC20 token_,
        IFnSSVOperators ssvOperators_,
        IFnSSVClusters ssvClusters_,
        IFnSSVDAO ssvDAO_,
        IFnSSVViews ssvViews_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint256 minimumLiquidationCollateral_,
        uint32 validatorsPerOperatorLimit_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint64 operatorMaxFeeIncrease_
    ) internal onlyInitializing {
        SSVStorage.load().token = token_;
        SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS] = address(ssvOperators_);
        SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS] = address(ssvClusters_);
        SSVStorage.load().ssvContracts[SSVModules.SSV_DAO] = address(ssvDAO_);
        SSVStorage.load().ssvContracts[SSVModules.SSV_VIEWS] = address(ssvViews_);
        SSVStorage.load().minimumBlocksBeforeLiquidation = minimumBlocksBeforeLiquidation_;
        SSVStorage.load().minimumLiquidationCollateral = minimumLiquidationCollateral_.shrink();
        SSVStorage.load().validatorsPerOperatorLimit = validatorsPerOperatorLimit_;
        SSVStorage.load().operatorFeeConfig = OperatorFeeConfig({
            declareOperatorFeePeriod: declareOperatorFeePeriod_,
            executeOperatorFeePeriod: executeOperatorFeePeriod_,
            operatorMaxFeeIncrease: operatorMaxFeeIncrease_
        });
    }

    /*****************/
    /* UUPS required */
    /*****************/

    function _authorizeUpgrade(address) internal override onlyOwner {}

    fallback() external {
        address ssvViews = SSVStorage.load().ssvContracts[SSVModules.SSV_VIEWS];
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), ssvViews, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if eq(result, 0) {
                revert(0, returndatasize())
            }
            return(0, returndatasize())
        }
    }

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    function registerOperator(bytes calldata publicKey, uint256 fee) external override returns (uint64 id) {
        if (!RegisterAuth.load().authorization[msg.sender].registerOperator) revert NotAuthorized();

        bytes memory result = CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("registerOperator(bytes,uint256)", publicKey, fee)
        );
        return abi.decode(result, (uint64));
    }

    function removeOperator(uint64 operatorId) external override {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("removeOperator(uint64)", operatorId)
        );
    }

    function setOperatorWhitelist(uint64 operatorId, address whitelisted) external override {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("setOperatorWhitelist(uint64,address)", operatorId, whitelisted)
        );
    }

    function declareOperatorFee(uint64 operatorId, uint256 fee) external override {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("declareOperatorFee(uint64,uint256)", operatorId, fee)
        );
    }

    function executeOperatorFee(uint64 operatorId) external override {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("executeOperatorFee(uint64)", operatorId)
        );
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) external override {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("cancelDeclaredOperatorFee(uint64)", operatorId)
        );
    }

    function reduceOperatorFee(uint64 operatorId, uint256 fee) external override {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("reduceOperatorFee(uint64,uint256)", operatorId, fee)
        );
    }

    function setFeeRecipientAddress(address recipientAddress) external override {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("setFeeRecipientAddress(address)", recipientAddress)
        );
    }

    function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external override {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("withdrawOperatorEarnings(uint64,uint256)", operatorId, amount)
        );
    }

    function withdrawOperatorEarnings(uint64 operatorId) external override {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("withdrawOperatorEarnings(uint64)", operatorId)
        );
    }

    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesData,
        uint256 amount,
        ISSVNetworkCore.Cluster memory cluster
    ) external override {
        if (!RegisterAuth.load().authorization[msg.sender].registerValidator) revert NotAuthorized();

        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "registerValidator(bytes,uint64[],bytes,uint256,(uint32,uint64,uint64,bool,uint256))",
                publicKey,
                operatorIds,
                sharesData,
                amount,
                cluster
            )
        );
    }

    function removeValidator(
        bytes calldata publicKey,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external override {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "removeValidator(bytes,uint64[],(uint32,uint64,uint64,bool,uint256))",
                publicKey,
                operatorIds,
                cluster
            )
        );
    }

    function liquidate(address owner, uint64[] calldata operatorIds, ISSVNetworkCore.Cluster memory cluster) external {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "liquidate(address,uint64[],(uint32,uint64,uint64,bool,uint256))",
                owner,
                operatorIds,
                cluster
            )
        );
    }

    function reactivate(
        uint64[] calldata operatorIds,
        uint256 amount,
        ISSVNetworkCore.Cluster memory cluster
    ) external override {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "reactivate(uint64[],uint256,(uint32,uint64,uint64,bool,uint256))",
                operatorIds,
                amount,
                cluster
            )
        );
    }

    function deposit(
        address owner,
        uint64[] calldata operatorIds,
        uint256 amount,
        ISSVNetworkCore.Cluster memory cluster
    ) external override {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "deposit(address,uint64[],uint256,(uint32,uint64,uint64,bool,uint256))",
                owner,
                operatorIds,
                amount,
                cluster
            )
        );
    }

    function withdraw(
        uint64[] calldata operatorIds,
        uint256 amount,
        ISSVNetworkCore.Cluster memory cluster
    ) external override {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "withdraw(uint64[],uint256,(uint32,uint64,uint64,bool,uint256))",
                operatorIds,
                amount,
                cluster
            )
        );
    }

    function updateNetworkFee(uint256 fee) external override onlyOwner {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateNetworkFee(uint256)", fee)
        );
    }

    function withdrawNetworkEarnings(uint256 amount) external override onlyOwner {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("withdrawNetworkEarnings(uint256)", amount)
        );
    }

    function updateOperatorFeeIncreaseLimit(uint64 percentage) external override onlyOwner {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateOperatorFeeIncreaseLimit(uint64)", percentage)
        );
    }

    function updateDeclareOperatorFeePeriod(uint64 timeInSeconds) external override onlyOwner {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateDeclareOperatorFeePeriod(uint64)", timeInSeconds)
        );
    }

    function updateExecuteOperatorFeePeriod(uint64 timeInSeconds) external override onlyOwner {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateExecuteOperatorFeePeriod(uint64)", timeInSeconds)
        );
    }

    function updateLiquidationThresholdPeriod(uint64 blocks) external override onlyOwner {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateLiquidationThresholdPeriod(uint64)", blocks)
        );
    }

    function updateMinimumLiquidationCollateral(uint256 amount) external override onlyOwner {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateMinimumLiquidationCollateral(uint256)", amount)
        );
    }

    // Upgrade functions
    function upgradeModule(SSVModules moduleId, address moduleAddress) external onlyOwner {
        CoreLib.setModuleContract(moduleId, moduleAddress);
    }

    // Authorization
    function setRegisterAuth(address userAddress, Authorization calldata auth) external override onlyOwner {
        RegisterAuth.load().authorization[userAddress] = auth;
    }

    function getRegisterAuth(address userAddress) external view override returns (Authorization memory) {
        return RegisterAuth.load().authorization[userAddress];
    }
}
