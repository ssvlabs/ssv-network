// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./ISSVNetworkCore.sol";
import "./ISSVNetwork.sol";

interface ISSVNetworkLogic is ISSVNetworkCore {
    /****************/
    /* Initializers */
    /****************/

    /**
     * @dev Initializes the contract.
     * @param ssvNetwork_ The SSVNetwork contract.
     */
    function initialize(ISSVNetwork ssvNetwork_) external;

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    function removeOperator(Operator memory operator, address owner) external returns (uint64 currentBalance);

    function declareOperatorFee(
        Operator memory operator,
        address owner,
        uint256 fee,
        uint64 minimalOperatorFee,
        uint64 operatorMaxFeeIncrease,
        uint64 declareOperatorFeePeriod,
        uint64 executeOperatorFeePeriod
    ) external returns (OperatorFeeChangeRequest memory feeChangeRequest);

    function executeOperatorFee(
        Operator memory operator,
        address owner,
        OperatorFeeChangeRequest memory feeChangeRequest
    ) external returns (Operator memory);

    //function cancelDeclaredOperatorFee(uint64 operatorId) external;

    function reduceOperatorFee(Operator memory operator, address owner, uint256 fee) external returns (Operator memory);

    function withdrawOperatorEarnings(Operator memory operator, address owner, uint256 amount) external;

    /*
    function withdrawOperatorEarnings(uint64 operatorId) external;

    function setOperatorWhitelist(uint64 operatorId, address whitelisted) external;
    */

    // Cluster
    function removeValidator(
        Operator[] memory processedOperators,
        Cluster memory cluster,
        uint64 currentNetworkFeeIndex
    ) external returns (Operator[] memory, bytes32);

    function reactivate(
        Operator[] memory processedOperators,
        Cluster memory cluster,
        uint256 amount,
        uint64 networkFee,
        uint64 currentNetworkFeeIndex,
        uint64 minimumBlocksBeforeLiquidation,
        uint64 minimumLiquidationCollateral
    ) external returns (Operator[] memory, bytes32);

    function liquidate(
        Operator[] memory processedOperators,
        Cluster memory cluster,
        address owner,
        address caller,
        uint64 networkFee,
        uint64 currentNetworkFeeIndex,
        uint64 minimumBlocksBeforeLiquidation,
        uint64 minimumLiquidationCollateral
    ) external returns (Operator[] memory, bytes32, uint256 balanceLiquidatable);

    function withdraw(
        Operator[] memory processedOperators,
        Cluster memory cluster,
        uint256 amount,
        uint64 networkFee,
        uint64 currentNetworkFeeIndex,
        uint64 minimumBlocksBeforeLiquidation,
        uint64 minimumLiquidationCollateral
    ) external returns (bytes32 hashedClusterData);
}
