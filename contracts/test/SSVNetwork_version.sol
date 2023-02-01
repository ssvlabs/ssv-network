// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "../SSVNetwork.sol";

contract SSVNetwork_version is SSVNetwork {
    function initializev2() external reinitializer(version + 1) {
         version = _getInitializedVersion();
    }
}
