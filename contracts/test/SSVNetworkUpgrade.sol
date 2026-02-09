// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "./interfaces/ISSVNetworkT.sol";

import "../interfaces/ISSVClusters.sol";
import "../interfaces/ISSVOperators.sol";
import "../interfaces/ISSVValidators.sol";
import "../interfaces/ISSVDAO.sol";
import "../interfaces/ISSVViews.sol";

import "../libraries/CoreLib.sol";
import "../libraries/storage/SSVStorage.sol";
import "../libraries/storage/SSVStorageProtocol.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/ClusterLib.sol";
import {PackedETHLib} from "../libraries/SSVPackedLib.sol";

import {SSVModules} from "../libraries/storage/SSVStorage.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

abstract contract SSVNetworkUpgrade is
    UUPSUpgradeable,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable,
    ISSVNetworkT,
    ISSVOperators,
    ISSVClusters,
    ISSVDAO,
    ISSVValidators
{
    using ClusterLib for Cluster;

    /****************/
    /* Initializers */
    /****************/

    function initialize(
        IERC20 token_,
        ISSVOperators ssvOperators_,
        ISSVClusters ssvClusters_,
        ISSVDAO ssvDAO_,
        ISSVViews ssvViews_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint256 minimumLiquidationCollateral_,
        uint32 validatorsPerOperatorLimit_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint64 operatorMaxFeeIncrease_
    ) external override initializer onlyProxy {
        __UUPSUpgradeable_init();
        __Ownable_init_unchained();
        __ReentrancyGuard_init();
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
        ISSVOperators ssvOperators_,
        ISSVClusters ssvClusters_,
        ISSVDAO ssvDAO_,
        ISSVViews ssvViews_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint256 minimumLiquidationCollateral_,
        uint32 validatorsPerOperatorLimit_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint64 operatorMaxFeeIncrease_
    ) internal onlyInitializing {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        s.token = token_;
        s.ssvContracts[SSVModules.SSV_OPERATORS] = address(ssvOperators_);
        s.ssvContracts[SSVModules.SSV_CLUSTERS] = address(ssvClusters_);
        s.ssvContracts[SSVModules.SSV_DAO] = address(ssvDAO_);
        s.ssvContracts[SSVModules.SSV_VIEWS] = address(ssvViews_);
        sp.minimumBlocksBeforeLiquidation = minimumBlocksBeforeLiquidation_;
        sp.minimumLiquidationCollateral = PackedETHLib.pack(minimumLiquidationCollateral_);
        sp.validatorsPerOperatorLimit = validatorsPerOperatorLimit_;
        sp.declareOperatorFeePeriod = declareOperatorFeePeriod_;
        sp.executeOperatorFeePeriod = executeOperatorFeePeriod_;
        sp.operatorMaxFeeIncrease = operatorMaxFeeIncrease_;
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

    function registerOperator(
        bytes calldata publicKey,
        uint256 fee,
        bool setPrivate
    ) external override returns (uint64 id) {
        bytes memory result = _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("registerOperator(bytes,uint256)", publicKey, fee, setPrivate)
        );
        return abi.decode(result, (uint64));
    }

    function removeOperator(uint64 operatorId) external override nonReentrant {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("removeOperator(uint64)", operatorId)
        );
    }

    function declareOperatorFee(uint64 operatorId, uint256 fee) external override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("declareOperatorFee(uint64,uint256)", operatorId, fee)
        );
    }

    function executeOperatorFee(uint64 operatorId) external override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("executeOperatorFee(uint64)", operatorId)
        );
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) external override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("cancelDeclaredOperatorFee(uint64)", operatorId)
        );
    }

    function reduceOperatorFee(uint64 operatorId, uint256 fee) external override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("reduceOperatorFee(uint64,uint256)", operatorId, fee)
        );
    }

    function setFeeRecipientAddress(address recipientAddress) external override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("setFeeRecipientAddress(address)", recipientAddress)
        );
    }

    function setOperatorsPrivateUnchecked(uint64[] calldata operatorIds) external override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("setOperatorsPrivateUnchecked(uint64[])", operatorIds)
        );
    }

    function setOperatorsPublicUnchecked(uint64[] calldata operatorIds) external override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("setOperatorsPublicUnchecked(uint64[])", operatorIds)
        );
    }

    function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external override nonReentrant {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("withdrawOperatorEarnings(uint64,uint256)", operatorId, amount)
        );
    }

    function withdrawAllOperatorEarnings(uint64 operatorId) external override nonReentrant {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("withdrawAllOperatorEarnings(uint64)", operatorId)
        );
    }

    function withdrawAllVersionOperatorEarnings(uint64 operatorId) external override nonReentrant {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("withdrawAllVersionOperatorEarnings(uint64)", operatorId)
        );
    }

    function withdrawOperatorEarningsSSV(uint64 operatorId, uint256 amount) external override nonReentrant {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("withdrawOperatorEarningsSSV(uint64,uint256)", operatorId, amount)
        );
    }

    function withdrawAllOperatorEarningsSSV(uint64 operatorId) external override nonReentrant {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("withdrawAllOperatorEarningsSSV(uint64)", operatorId)
        );
    }

    function migrateClusterToETH(
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "migrateClusterToETH(uint64[],(uint32,uint64,uint64,bool,uint256))",
                operatorIds,
                cluster
            )
        );
    }

    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata shares,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "registerValidator(bytes[],uint64[],bytes,(uint32,uint64,uint64,bool,uint256))",
                publicKey,
                operatorIds,
                shares,
                cluster
            )
        );
    }

    function bulkRegisterValidator(
        bytes[] calldata publicKey,
        uint64[] memory operatorIds,
        bytes[] calldata shares,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "registerValidator(bytes[],uint64[],bytes,(uint32,uint64,uint64,bool,uint256))",
                publicKey,
                operatorIds,
                shares,
                cluster
            )
        );
    }

    function removeValidator(
        bytes calldata publicKey,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "removeValidator(bytes,uint64[],(uint32,uint64,uint64,bool,uint256))",
                publicKey,
                operatorIds,
                cluster
            )
        );
    }

    function bulkRemoveValidator(
        bytes[] calldata publicKeys,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "bulkRemoveValidator(bytes[],uint64[],(uint32,uint64,uint64,bool,uint256))",
                publicKeys,
                operatorIds,
                cluster
            )
        );
    }

    function liquidate(
        address owner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external override nonReentrant {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "liquidate(address,uint64[],(uint32,uint64,uint64,bool,uint256))",
                owner,
                operatorIds,
                cluster
            )
        );
    }

    function liquidateSSV(
        address owner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external override nonReentrant {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "liquidateSSV(address,uint64[],(uint32,uint64,uint64,bool,uint256))",
                owner,
                operatorIds,
                cluster
            )
        );
    }

    function reactivate(
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "reactivate(uint64[],(uint32,uint64,uint64,bool,uint256))",
                operatorIds,
                cluster
            )
        );
    }

    function deposit(
        address owner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "deposit(address,uint64[],(uint32,uint64,uint64,bool,uint256))",
                owner,
                operatorIds,
                cluster
            )
        );
    }

    function withdraw(
        uint64[] calldata operatorIds,
        uint256 amount,
        ISSVNetworkCore.Cluster memory cluster
    ) external override nonReentrant {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "withdraw(uint64[],uint256,(uint32,uint64,uint64,bool,uint256))",
                operatorIds,
                amount,
                cluster
            )
        );
    }

    function exitValidator(bytes calldata publicKey, uint64[] calldata operatorIds) external override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature("exitValidator(bytes,uint64[]))", publicKey, operatorIds)
        );
    }

    function bulkExitValidator(bytes[] calldata publicKeys, uint64[] calldata operatorIds) external override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature("bulkExitValidator(bytes[],uint64[]))", publicKeys, operatorIds)
        );
    }

    function updateNetworkFee(uint256 fee) external override onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateNetworkFee(uint256)", fee)
        );
    }

    function updateNetworkFeeSSV(uint256 fee) external override onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateNetworkFeeSSV(uint256)", fee)
        );
    }

    function withdrawNetworkSSVEarnings(uint256 amount) external override onlyOwner nonReentrant {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("withdrawNetworkSSVEarnings(uint256)", amount)
        );
    }

    function updateOperatorFeeIncreaseLimit(uint64 percentage) external override onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateOperatorFeeIncreaseLimit(uint64)", percentage)
        );
    }

    function updateDeclareOperatorFeePeriod(uint64 timeInSeconds) external override onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateDeclareOperatorFeePeriod(uint64)", timeInSeconds)
        );
    }

    function updateExecuteOperatorFeePeriod(uint64 timeInSeconds) external override onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateExecuteOperatorFeePeriod(uint64)", timeInSeconds)
        );
    }

    function updateLiquidationThresholdPeriod(uint64 blocks) external override onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateLiquidationThresholdPeriod(uint64)", blocks)
        );
    }

    function updateMinimumLiquidationCollateral(uint256 amount) external override onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateMinimumLiquidationCollateral(uint256)", amount)
        );
    }

    function updateMaximumOperatorFee(uint256 maxFee) external override {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateMaximumOperatorFee(uint64)", maxFee)
        );
    }

    function updateMinimumOperatorEthFee(uint256 minFee) external override onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateMinimumOperatorEthFee(uint64)", minFee)
        );
    }

    function replaceOracle(uint32 oracleId, address newOracle) external override onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("replaceOracle(uint32,address)", oracleId, newOracle)
        );
    }

    function setQuorumBps(uint16 quorum) external override onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("setQuorumBps(uint16)", quorum)
        );
    }

    function _delegateCall(address ssvModule, bytes memory callMessage) internal returns (bytes memory) {
        /// @custom:oz-upgrades-unsafe-allow delegatecall
        (bool success, bytes memory result) = ssvModule.delegatecall(callMessage);
        if (!success && result.length > 0) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                let returndata_size := mload(result)
                revert(add(32, result), returndata_size)
            }
        }
        return result;
    }

    // Upgrade functions
    function updateModule(SSVModules moduleId, address moduleAddress) external onlyOwner {
        CoreLib.setModuleContract(moduleId, moduleAddress);
    }
}
