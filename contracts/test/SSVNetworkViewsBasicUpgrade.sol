// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../SSVNetworkViews.sol";

contract SSVNetworkViewsBasicUpgrade is SSVNetworkViews {

    function getConstantVersion() external pure returns(uint256 version) {
        version = 1010;
    }
}
