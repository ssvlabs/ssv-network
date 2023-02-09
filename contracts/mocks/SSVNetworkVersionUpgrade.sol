// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "../SSVNetwork.sol";

contract SSVNetworkVersionUpgrade is SSVNetwork {
    function initializev2(string calldata _version) external reinitializer(_getInitializedVersion() + 1) {
         version = bytes32(abi.encodePacked((_version)));
    }
}
