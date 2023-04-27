// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./ISSVNetworkCore.sol";
import "./ISSVNetwork.sol";

interface ISSVOperators is ISSVNetworkCore {
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

    function removeOperator(Operator memory operator) external returns (uint64 currentBalance);

    function declareOperatorFee(
        Operator memory operator,
        uint256 fee,
        uint64 minimalOperatorFee,
        uint64 operatorMaxFeeIncrease,
        uint64 declareOperatorFeePeriod,
        uint64 executeOperatorFeePeriod
    ) external returns (OperatorFeeChangeRequest memory feeChangeRequest);

    function executeOperatorFee(Operator memory operator, OperatorFeeChangeRequest memory feeChangeRequest) external returns (Operator memory);
    
    //function cancelDeclaredOperatorFee(uint64 operatorId) external;

    function reduceOperatorFee(Operator memory operator, uint256 fee) external returns (Operator memory);
/*
    function withdrawOperatorEarnings(uint64 operatorId, uint256 tokenAmount) external;

    function withdrawOperatorEarnings(uint64 operatorId) external;

    function setOperatorWhitelist(uint64 operatorId, address whitelisted) external;
    */
}
