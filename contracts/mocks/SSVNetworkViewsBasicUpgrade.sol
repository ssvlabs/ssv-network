// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../SSVNetworkViews.sol";

contract SSVNetworkViewsBasicUpgrade is SSVNetworkViews {
    function getOperatorOwnerdById(uint64 operatorId) external view returns (address) {
        (address operatorOwner, , , ) = _ssvNetwork.operators(operatorId);
        if (operatorOwner == address(0)) revert ISSVNetworkCore.OperatorDoesNotExist();

        return operatorOwner;
    }
}
