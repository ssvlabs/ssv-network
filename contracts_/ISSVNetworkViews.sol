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

    function getValidator(address owner, bytes calldata publicKey) external returns (bool);

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint64 operatorId) external returns (uint256);

    function getOperatorDeclaredFee(
        uint64 operatorId
    ) external returns (uint256 fee, uint64 approvalBeginTime, uint64 approvalEndTime);

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
    ) external returns (bool isLiquidatable);

    function isLiquidated(
        address owner,
        uint64[] memory operatorIds,
        ISSVNetwork.Cluster memory cluster
    ) external returns (bool isLiquidated);

    function getBurnRate(
        address owner,
        uint64[] memory operatorIds,
        ISSVNetwork.Cluster memory cluster
    ) external returns (uint256 burnRate);

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    function getOperatorEarnings(uint64 operatorId) external returns (uint256);

    function getBalance(
        address owner,
        uint64[] memory operatorIds,
        ISSVNetwork.Cluster memory cluster
    ) external returns (uint256 balance);

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external returns (uint256 networkFee);

    function getNetworkEarnings() external returns (uint256 networkEarnings);

    function getOperatorFeeIncreaseLimit() external returns (uint64 operatorMaxFeeIncrease);

    function getOperatorFeePeriods()
        external
        returns (uint64 declareOperatorFeePeriod, uint64 executeOperatorFeePeriod);

    function getLiquidationThresholdPeriod() external returns (uint64 blocks);

    function getMinimumLiquidationCollateral() external returns (uint256 amount);
}
