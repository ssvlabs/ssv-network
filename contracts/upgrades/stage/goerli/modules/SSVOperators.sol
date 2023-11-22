// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../../../../modules/SSVOperators.sol";

contract SSVOperatorsGetOperator is SSVOperators {
    /****************************************/
    /* Upgraded Operator External Functions */
    /****************************************/

    function getOperator(uint64 operatorId) external view returns(Operator memory) {
        StorageData storage s = SSVStorage.load();
        Operator memory operator = s.operators[operatorId];
        return operator;
    }
}
