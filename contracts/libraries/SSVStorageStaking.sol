// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

struct UnstakeRequest {
    /// @notice Amount of cSSV burned and pending to be withdrawn as SSV
    uint192 amount;
    /// @notice Timestamp after which the pending unstake can be withdrawn
    uint64 unlockTime;
}

struct Delegation {
    /// @notice Oracle IDs delegated to (up to 4). Stable across replacements.
    uint32[4] oracleIds;
    /// @notice Amount of cSSV delegated to each oracle ID
    uint256[4] amounts;
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

    /// @notice Oracle registry: stable ID => oracle address
    mapping(uint32 => address) oracles;
    /// @notice Reverse lookup: oracle address => oracle ID (0 if not registered)
    mapping(address => uint32) oracleIdOf;
    /// @notice Aggregated weight (in cSSV amount) for each oracle ID
    mapping(uint32 => uint256) oracleWeights;
    /// @notice Per-user delegation data
    mapping(address => Delegation) userDelegations;
    /// @notice Default oracle IDs to use for new delegations (equal split)
    uint32[4] defaultOracleIds;
    /// @notice Quorum threshold in basis points (e.g. 7000 = 70%)
    uint16 quorumBps;
    /// @notice The mapping of address to their unstake requests
    mapping(address => UnstakeRequest[]) withdrawalRequests;
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
