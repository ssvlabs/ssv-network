// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./ISSVNetworkCore.sol";
import "./ISSVNetwork.sol";

interface ISSVNetworkViews is ISSVNetworkCore {
    /****************/
    /* Initializers */
    /****************/

    /**
     * @dev Initializes the contract.
     * @param ssvNetwork_ The SSVNetwork contract.
     */
    function initialize(ISSVNetwork ssvNetwork_) external;

    /*************************************/
    /* Validator External View Functions */
    /*************************************/

    function getValidator(bytes calldata publicKey) external returns (address, bool);

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint64 operatorId) external returns (uint256);

    function getOperatorDeclaredFee(uint64 operatorId) external returns (uint256, uint256, uint256);

    function getOperatorById(
        uint64 operatorId
    ) external view returns (address owner, uint256 fee, uint32 validatorCount, bool isPrivate, bool active);

    /*******************************/
    /* Cluster External View Functions */
    /*******************************/

    function isLiquidatable(
        address owner,
        uint64[] memory operatorIds,
        ISSVNetwork.Cluster memory cluster
    ) external returns (bool);

    function isLiquidated(
        address owner,
        uint64[] memory operatorIds,
        ISSVNetwork.Cluster memory cluster
    ) external returns (bool);

    function getBurnRate(
        address owner,
        uint64[] memory operatorIds,
        ISSVNetwork.Cluster memory cluster
    ) external returns (uint256);

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    function getOperatorEarnings(uint64 operatorId) external returns (uint256);

    function getBalance(
        address owner,
        uint64[] memory operatorIds,
        ISSVNetwork.Cluster memory cluster
    ) external returns (uint256);

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external returns (uint256);

    function getNetworkEarnings() external returns (uint256);

    function getOperatorFeeIncreaseLimit() external returns (uint64);

    function getExecuteOperatorFeePeriod() external returns (uint64);

    function getDeclaredOperatorFeePeriod() external returns (uint64);

    function getLiquidationThresholdPeriod() external returns (uint64);

    function getMinimumLiquidationCollateral() external returns (uint256);
}
