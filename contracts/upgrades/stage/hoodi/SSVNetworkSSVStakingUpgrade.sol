// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../../SSVNetwork.sol";

contract SSVNetworkSSVStakingUpgrade is SSVNetwork {
    function initializeSSVStaking(address cssv_, uint64 cooldownDuration_) external onlyOwner reinitializer(2) {
        if (cssv_ == address(0)) revert ZeroAddress();
        
        StorageStaking storage s = SSVStorageStaking.load();
        s.cssv = cssv_;
        s.cooldownDuration = cooldownDuration_;
        s.defaultOracleIds = [1,2,3,4];

        emit CooldownDurationUpdated(cooldownDuration_);
    }
}
