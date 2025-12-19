// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../../SSVNetwork.sol";

contract SSVNetworkSSVStakingUpgrade is SSVNetwork {
    function initializeSSVStaking(address cssv_) external onlyOwner reinitializer(2) {
        SSVStorageStaking.load().cssv = cssv_;
    }
}
