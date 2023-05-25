// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "hardhat/console.sol";
import "./interfaces/ISSVNetwork.sol";

import {ISSVOperators as OperatorEvents} from "./interfaces/events/ISSVOperators.sol";
import {ISSVClusters as ClusterEvents} from "./interfaces/events/ISSVClusters.sol";
import {ISSVDAO as DAOEvents} from "./interfaces/events/ISSVDAO.sol";

import "./interfaces/functions/ISSVViews.sol";
import "./interfaces/functions/ISSVOperators.sol";
import "./interfaces/functions/ISSVClusters.sol";
import "./interfaces/functions/ISSVDAO.sol";

import "./libraries/Types.sol";
import "./libraries/SSVStorage.sol";
import "./libraries/OperatorLib.sol";
import "./libraries/ClusterLib.sol";

import {SSVModules} from "./libraries/SSVStorage.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

contract SSVNetwork is UUPSUpgradeable, Ownable2StepUpgradeable, ISSVNetwork, OperatorEvents, ClusterEvents, DAOEvents {
    using Types256 for uint256;
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
        uint32 validatorsPerOperatorLimit_
    ) external initializer onlyProxy {
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
            validatorsPerOperatorLimit_
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
        uint32 validatorsPerOperatorLimit_
    ) internal onlyInitializing {
        SSVStorage.load().token = token_;
        SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS] = address(ssvOperators_);
        SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS] = address(ssvClusters_);
        SSVStorage.load().ssvContracts[SSVModules.SSV_DAO] = address(ssvDAO_);
        SSVStorage.load().ssvContracts[SSVModules.SSV_VIEWS] = address(ssvViews_);
        SSVStorage.load().minimumBlocksBeforeLiquidation = minimumBlocksBeforeLiquidation_;
        SSVStorage.load().minimumLiquidationCollateral = minimumLiquidationCollateral_.shrink();
        SSVStorage.load().validatorsPerOperatorLimit = validatorsPerOperatorLimit_;
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

    function registerOperator(bytes calldata publicKey, uint256 fee) external returns (uint64 id) {
        bytes memory result = _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("registerOperator(bytes,uint256)", publicKey, fee)
        );
        return abi.decode(result, (uint64));
    }

    function removeOperator(uint64 operatorId) external {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("removeOperator(uint64)", operatorId)
        );
    }

    function setOperatorWhitelist(uint64 operatorId, address whitelisted) external {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("setOperatorWhitelist(uint64,address)", operatorId, whitelisted)
        );
    }

    function declareOperatorFee(uint64 operatorId, uint256 fee) external {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("declareOperatorFee(uint64,uint256)", operatorId, fee)
        );
    }

    function executeOperatorFee(uint64 operatorId) external {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("executeOperatorFee(uint64)", operatorId)
        );
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) external {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("cancelDeclaredOperatorFee(uint64)", operatorId)
        );
    }

    function reduceOperatorFee(uint64 operatorId, uint256 fee) external {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("reduceOperatorFee(uint64,uint256)", operatorId, fee)
        );
    }

    function setFeeRecipientAddress(address recipientAddress) external {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("etFeeRecipientAddress(address)", recipientAddress)
        );
    }

    function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_OPERATORS],
            abi.encodeWithSignature("withdrawOperatorEarnings(uint64,uint256)", operatorId, amount)
        );
    }

    function withdrawOperatorEarnings(uint64 operatorId) external {
        _delegateCall(
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
    ) external {
        _delegateCall(
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
    ) external {
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

    function liquidate(address owner, uint64[] memory operatorIds, ISSVNetworkCore.Cluster memory cluster) external {
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

    function reactivate(uint64[] memory operatorIds, uint256 amount, ISSVNetworkCore.Cluster memory cluster) external {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_CLUSTERS],
            abi.encodeWithSignature(
                "liquidate(uint64[],uint256,(uint32,uint64,uint64,bool,uint256))",
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
    ) external {
        _delegateCall(
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

    function withdraw(uint64[] memory operatorIds, uint256 amount, ISSVNetworkCore.Cluster memory cluster) external {
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

    function updateNetworkFee(uint256 fee) external onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateNetworkFee(uint256)", fee)
        );
    }

    function withdrawNetworkEarnings(uint256 amount) external onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("withdrawNetworkEarnings(uint256)", amount)
        );
    }

    function updateOperatorFeeIncreaseLimit(uint64 percentage) external onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateOperatorFeeIncreaseLimit(uint64)", percentage)
        );
    }

    function updateDeclareOperatorFeePeriod(uint64 timeInSeconds) external onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateDeclareOperatorFeePeriod(uint64)", timeInSeconds)
        );
    }

    function updateExecuteOperatorFeePeriod(uint64 timeInSeconds) external onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateExecuteOperatorFeePeriod(uint64)", timeInSeconds)
        );
    }

    function updateLiquidationThresholdPeriod(uint64 blocks) external onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateLiquidationThresholdPeriod(uint64)", blocks)
        );
    }

    function updateMinimumLiquidationCollateral(uint256 amount) external onlyOwner {
        _delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateMinimumLiquidationCollateral(uint256)", amount)
        );
    }

    function _delegateCall(address ssvModule, bytes memory callMessage) private returns (bytes memory) {
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
}
