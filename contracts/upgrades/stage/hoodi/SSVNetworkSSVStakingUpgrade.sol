// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../../SSVNetwork.sol";
import {MAX_DELEGATION_SLOTS} from "../../../libraries/storage/SSVStorageStaking.sol";

contract SSVNetworkSSVStakingUpgrade is SSVNetwork {
    function initializeSSVStaking(
        uint64 cooldownDuration,
        uint32[MAX_DELEGATION_SLOTS] memory defaultOracleIds
    ) external onlyOwner reinitializer(_getInitializedVersion() + 1) {
        // save staking storage updates
        StorageStaking storage s = SSVStorageStaking.load();
        s.cooldownDuration = cooldownDuration;
        s.defaultOracleIds = defaultOracleIds;

        emit CooldownDurationUpdated(cooldownDuration);
    }
}
