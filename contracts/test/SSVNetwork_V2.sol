// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "../SSVNetwork.sol";

contract SSVNetwork_V2 is SSVNetwork {
    uint256 public operatorsUpdated;

    function resetOperatorFee(uint64 operatorId) external {
        if (operators[operatorId].snapshot.block != 0) {
            operators[operatorId].fee = 0;

            ++operatorsUpdated;
        }
    }
}
