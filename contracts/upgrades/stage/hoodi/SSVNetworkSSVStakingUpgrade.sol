// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../../SSVNetwork.sol";
import {MAX_DELEGATION_SLOTS} from "../../../libraries/storage/SSVStorageStaking.sol";

contract SSVNetworkSSVStakingUpgrade is SSVNetwork {
    /// @notice One-time initializer for the SSV Staking upgrade
    /// @param cooldownDuration Unstake cooldown duration in seconds (e.g. 604800 for 7 days)
    /// @param defaultOracleIds Default oracle IDs for new delegations
    function initializeSSVStaking(
        uint64 cooldownDuration,
        uint32[MAX_DELEGATION_SLOTS] memory defaultOracleIds
    ) external onlyOwner reinitializer(3) {
        // save staking storage updates
        StorageStaking storage s = SSVStorageStaking.load();
        s.cooldownDuration = cooldownDuration;
        s.defaultOracleIds = defaultOracleIds;

        emit CooldownDurationUpdated(cooldownDuration);
        emit SSVNetworkUpgradeBlock("v2.0.0", block.number);
    }
}
