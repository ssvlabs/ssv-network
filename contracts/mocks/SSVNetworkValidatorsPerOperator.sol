// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../SSVNetwork.sol";

contract SSVNetworkValidatorsPerOperator is SSVNetwork {
    constructor(address registerAuth) SSVNetwork(registerAuth) {}

    function initializev2(uint32 validatorsPerOperatorLimit_) external reinitializer(2) {
        validatorsPerOperatorLimit = validatorsPerOperatorLimit_;
    }
}
