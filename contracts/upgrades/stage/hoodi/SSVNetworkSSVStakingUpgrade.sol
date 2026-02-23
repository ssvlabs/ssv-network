// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../../SSVNetwork.sol";
import {MAX_DELEGATION_SLOTS} from "../../../libraries/storage/SSVStorageStaking.sol";
import {SSVStorageEB, StorageEB} from "../../../libraries/storage/SSVStorageEB.sol";

contract SSVNetworkSSVStakingUpgrade is SSVNetwork {
    uint32 private constant DEFAULT_MIN_BLOCKS_BETWEEN_UPDATES = 7_200;

    function initializeSSVStaking(
        uint64 cooldownDuration,
        uint32[MAX_DELEGATION_SLOTS] memory defaultOracleIds,
        uint16 quorumBps
    ) external onlyOwner reinitializer(3) {
        if (quorumBps == 0 || quorumBps > 10_000) revert InvalidQuorum();

        // save staking storage updates
        StorageStaking storage s = SSVStorageStaking.load();
        s.cooldownDuration = cooldownDuration;
        s.defaultOracleIds = defaultOracleIds;
        s.quorumBps = quorumBps;
        StorageEB storage seb = SSVStorageEB.load();
        seb.minBlocksBetweenUpdates = DEFAULT_MIN_BLOCKS_BETWEEN_UPDATES;

        emit CooldownDurationUpdated(cooldownDuration);
        emit QuorumUpdated(quorumBps);
        emit MinBlocksBetweenUpdatesUpdated(DEFAULT_MIN_BLOCKS_BETWEEN_UPDATES);
        emit SSVNetworkUpgradeBlock("v2.0.0", block.number);
    }
}
