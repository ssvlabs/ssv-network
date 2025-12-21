// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

struct UnstakeRequest {
    /// @notice Amount of cSSV burned and pending to be withdrawn as SSV
    uint192 amount;
    /// @notice Timestamp after which the pending unstake can be withdrawn
    uint64 unlockTime;
}

struct StorageStaking {
    /// @notice Address of the cSSV token used as the staking receipt token
    address cssv;
    /// @notice Cooldown duration for unstaking
    uint64 cooldownDuration;
    /// @notice Total ETH-denominated rewards (shrunk) allocated to the staking pool
    uint64 stakingEthPoolBalance;
    /// @notice Global accumulated ETH rewards per cSSV token (scaled by PRECISION)
    uint128 accEthPerShare;

    /// @notice Per-user reward index used to track their last settled accEthPerShare
    mapping(address => uint256) userIndex;
    /// @notice Accumulated but unclaimed ETH rewards for each user (in wei)
    mapping(address => uint256) accrued;

    /// @notice Pending unstake request for each user
    mapping(address => UnstakeRequest) withdrawals;
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
