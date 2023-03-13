// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../SSVNetwork.sol";

contract SSVNetworkBasicUpgrade is SSVNetwork {
    uint256 public operatorsUpdated;

    function resetOperatorFee(uint64 operatorId) external {
        if (operators[operatorId].snapshot.block != 0) {
            operators[operatorId].fee = 0;

            ++operatorsUpdated;
        }
    }
}
