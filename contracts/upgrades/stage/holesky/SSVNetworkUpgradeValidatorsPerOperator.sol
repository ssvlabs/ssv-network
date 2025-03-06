// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../../SSVNetwork.sol";

contract SSVNetworkUpgradeValidatorsPerOperator is SSVNetwork {
    function initializev2(uint32 validatorsPerOperatorLimit_) external onlyOwner  {
        SSVStorageProtocol.load().validatorsPerOperatorLimit = validatorsPerOperatorLimit_;
    }
}
