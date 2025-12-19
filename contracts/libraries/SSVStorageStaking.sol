// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

struct StorageStaking {
    address cssv;

    uint256 accEthPerShare;
    uint64 stakingEthPoolBalance;

    mapping(address => uint256) userIndex;
    mapping(address => uint256) accrued;

    mapping(address => uint256) pendingUnstakeAmount;
    mapping(address => uint256) pendingUnstakeUnlockTime;
}

library SSVStorageStaking {
    uint256 private constant SSV_STORAGE_POSITION = uint256(keccak256("ssv.network.storage.staking")) - 1;

    function load() internal pure returns (StorageStaking storage ss) {
        uint256 position = SSV_STORAGE_POSITION;
        assembly {
            ss.slot := position
        }
    }
}
