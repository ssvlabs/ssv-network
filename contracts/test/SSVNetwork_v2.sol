// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "../SSVNetwork.sol";

contract SSVNetwork_v2 is SSVNetwork {
    
    function initializev2(uint32 validatorsPerOperatorLimit_) reinitializer(2) external {
        validatorsPerOperatorLimit = validatorsPerOperatorLimit_;
    }
}
