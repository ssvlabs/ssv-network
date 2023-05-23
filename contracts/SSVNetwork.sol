// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "hardhat/console.sol";
import "./ISSVNetworkCore.sol";
import "./ISSVNetwork.sol";
import "./ISSVOperators.sol";
import "./ISSVClusters.sol";
import "./libraries/Types.sol";
import "./libraries/SSVStorage.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

contract SSVNetwork is UUPSUpgradeable, Ownable2StepUpgradeable, ISSVNetwork {
    using Types256 for uint256;

    /****************/
    /* Initializers */
    /****************/

    function initialize(
        IERC20 token_,
        ISSVOperators ssvOperators_,
        ISSVClusters ssvClusters_,
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
            minimumBlocksBeforeLiquidation_,
            minimumLiquidationCollateral_,
            validatorsPerOperatorLimit_
        );
    }

    function __SSVNetwork_init_unchained(
        IERC20 token_,
        ISSVOperators ssvOperators_,
        ISSVClusters ssvClusters_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint256 minimumLiquidationCollateral_,
        uint32 validatorsPerOperatorLimit_
    ) internal onlyInitializing {
        SSVStorage.getStorage().token = token_;
        SSVStorage.getStorage().ssvContracts[SSVStorage.SSV_OPERATORS_CONTRACT] = address(ssvOperators_);
        SSVStorage.getStorage().ssvContracts[SSVStorage.SSV_CLUSTERS_CONTRACT] = address(ssvClusters_);
        SSVStorage.getStorage().minimumBlocksBeforeLiquidation = minimumBlocksBeforeLiquidation_;
        SSVStorage.getStorage().minimumLiquidationCollateral = minimumLiquidationCollateral_.shrink();
        SSVStorage.getStorage().validatorsPerOperatorLimit = validatorsPerOperatorLimit_;
    }

    /*****************/
    /* UUPS required */
    /*****************/

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    function registerOperator(bytes calldata publicKey, uint256 fee) external returns (uint64 id) {
        (bool success, bytes memory result) = SSVStorage
            .getStorage()
            .ssvContracts[SSVStorage.SSV_OPERATORS_CONTRACT]
            .delegatecall(abi.encodeWithSignature("registerOperator(bytes,uint256)", publicKey, fee));

        require(success, "The call to operators contract failed");
        return abi.decode(result, (uint64));
    }

    function removeOperator(uint64 operatorId) external {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function setOperatorWhitelist(uint64 operatorId, address whitelisted) external {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function declareOperatorFee(uint64 operatorId, uint256 fee) external {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function executeOperatorFee(uint64 operatorId) external {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) external {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function reduceOperatorFee(uint64 operatorId, uint256 fee) external {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function setFeeRecipientAddress(address recipientAddress) external {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesData,
        uint256 amount,
        ISSVNetworkCore.Cluster memory cluster
    ) external {
        (bool success, bytes memory result) = SSVStorage
            .getStorage()
            .ssvContracts[SSVStorage.SSV_CLUSTERS_CONTRACT]
            .delegatecall(
                abi.encodeWithSignature(
                    "registerValidator(bytes,uint64[],bytes,uint256,(uint32,uint64,uint64,bool,uint256))",
                    publicKey,
                    operatorIds,
                    sharesData,
                    amount,
                    cluster
                )
            );
        //console.logBytes(result);
        require(success, "The call to clusters contract failed");
    }

    function removeValidator(
        bytes calldata publicKey,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function liquidate(address owner, uint64[] memory operatorIds, ISSVNetworkCore.Cluster memory cluster) external {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function reactivate(uint64[] memory operatorIds, uint256 amount, ISSVNetworkCore.Cluster memory cluster) external {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function deposit(
        address owner,
        uint64[] calldata operatorIds,
        uint256 amount,
        ISSVNetworkCore.Cluster memory cluster
    ) external {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function withdrawOperatorEarnings(uint64 operatorId) external {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function withdraw(uint64[] memory operatorIds, uint256 amount, ISSVNetworkCore.Cluster memory cluster) external {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function updateNetworkFee(uint256 fee) external onlyOwner {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function withdrawNetworkEarnings(uint256 amount) external onlyOwner {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function updateOperatorFeeIncreaseLimit(uint64 percentage) external onlyOwner {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function updateDeclareOperatorFeePeriod(uint64 timeInSeconds) external onlyOwner {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function updateExecuteOperatorFeePeriod(uint64 timeInSeconds) external onlyOwner {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function updateLiquidationThresholdPeriod(uint64 blocks) external onlyOwner {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function updateMinimumLiquidationCollateral(uint256 amount) external onlyOwner {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    /*************************************/
    /* Validator External View Functions */
    /*************************************/

    function getValidator(address owner, bytes calldata publicKey) external returns (bool active) {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint64 operatorId) external returns (uint256) {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function getOperatorDeclaredFee(uint64 operatorId) external returns (uint256, uint64, uint64) {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function getOperatorById(uint64 operatorId) external returns (address, uint256, uint32, bool, bool) {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    /***********************************/
    /* Cluster External View Functions */
    /***********************************/

    function isLiquidatable(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external returns (bool) {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function isLiquidated(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external returns (bool) {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function getBurnRate(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external returns (uint256) {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    function getOperatorEarnings(uint64 id) external returns (uint256) {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function getBalance(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external returns (uint256) {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external returns (uint256) {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function getNetworkEarnings() external returns (uint256) {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }
    
    function getOperatorFeeIncreaseLimit() external returns (uint64 operatorMaxFeeIncrease) {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function getOperatorFeePeriods()
        external
        returns (uint64 declareOperatorFeePeriod, uint64 executeOperatorFeePeriod)
    {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function getLiquidationThresholdPeriod() external returns (uint64) {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function getMinimumLiquidationCollateral() external returns (uint256) {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function getVersion() external returns (string memory version) {
        _delegateCall(abi.encodeWithSignature("registerOperator(bytes,uint256)", 1, 1));
    }

    function _delegateCall(bytes memory callMessage) private {
        (bool success, bytes memory result) = address(this).delegatecall(callMessage);
        require(success, "The call to operators contract failed");
    }
}
