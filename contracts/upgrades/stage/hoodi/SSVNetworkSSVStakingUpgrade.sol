// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../../SSVNetwork.sol";
import {MAX_DELEGATION_SLOTS} from "../../../libraries/storage/SSVStorageStaking.sol";
import {SSVStorageEB, StorageEB} from "../../../libraries/storage/SSVStorageEB.sol";

contract SSVNetworkSSVStakingUpgrade is SSVNetwork {
    /// @notice One-time initializer for the SSV Staking upgrade
    /// @param cooldownDuration Unstake cooldown duration in seconds (e.g. 604800 for 7 days)
    /// @param defaultOracleIds Default oracle IDs for new delegations
    /// @param quorumBps Oracle quorum in basis points
    /// @param minBlocksBetweenUpdates Minimum block interval between EB updates (must be non-zero)
    function initializeSSVStaking(
        uint64 cooldownDuration,
        uint32[MAX_DELEGATION_SLOTS] memory defaultOracleIds,
        uint16 quorumBps,
        uint32 minBlocksBetweenUpdates
    ) external onlyOwner reinitializer(3) {
        if (quorumBps == 0 || quorumBps > 10_000) revert InvalidQuorum();
        if (minBlocksBetweenUpdates == 0) revert ZeroAmount();

        // save staking storage updates
        StorageStaking storage s = SSVStorageStaking.load();
        s.cooldownDuration = cooldownDuration;
        s.defaultOracleIds = defaultOracleIds;
        s.quorumBps = quorumBps;
        StorageEB storage seb = SSVStorageEB.load();
        seb.minBlocksBetweenUpdates = minBlocksBetweenUpdates;

        emit CooldownDurationUpdated(cooldownDuration);
        emit QuorumUpdated(quorumBps);
        emit MinBlocksBetweenUpdatesUpdated(minBlocksBetweenUpdates);
        emit SSVNetworkUpgradeBlock("v2.0.0", block.number);
    }
}
