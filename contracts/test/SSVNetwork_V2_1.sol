// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "../SSVNetwork.sol";

contract SSVNetwork_V2_1 is SSVNetwork {
    uint256 public count;

    function initializeV2() reinitializer(2) public {
        count = 100;
    }
}
