// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../../SSVNetwork.sol";

contract SSVNetworkSSVStakingUpgrade is SSVNetwork {
    function initializeSSVStaking(
        address cssv,
        uint64 cooldownDuration,
        uint32[4] memory defaultOracleIds
    ) external onlyOwner reinitializer(_getInitializedVersion() + 1) {
        if (cssv == address(0)) revert ZeroAddress();

        // save staking storage updates
        StorageStaking storage s = SSVStorageStaking.load();
        s.cssv = cssv;
        s.cooldownDuration = cooldownDuration;
        s.defaultOracleIds = defaultOracleIds;

        emit CooldownDurationUpdated(cooldownDuration);
    }
}
