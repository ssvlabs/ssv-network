// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../../../../modules/SSVOperators.sol";
import "../../../../libraries/Types.sol";

contract SSVOperatorsV2 is SSVOperators {
    using Types64 for uint64;
    /****************************************/
    /* Upgraded Operator External Functions */
    /****************************************/

    function getOperatorById(uint64 operatorId) external view returns (address, uint256, uint32, address, bool, bool) {
        StorageData storage s = SSVStorage.load();
        Operator memory operator = s.operators[operatorId];
        address whitelisted = s.operatorsWhitelist[operatorId];
        bool isPrivate = whitelisted == address(0) ? false : true;
        bool isActive = operator.snapshot.block == 0 ? false : true;

        return (operator.owner, operator.fee.expand(), operator.validatorCount, whitelisted, isPrivate, isActive);
    }
}
