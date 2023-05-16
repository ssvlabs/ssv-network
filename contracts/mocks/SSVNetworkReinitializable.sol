// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../SSVNetwork.sol";

contract SSVNetworkReinitializable is SSVNetwork {
    uint256 public count;

    constructor(address registerAuth) SSVNetwork(registerAuth) {}

    function initializeV2() public reinitializer(2) {
        count = 100;
    }
}
