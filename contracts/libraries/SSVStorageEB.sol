// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

uint32 constant VUNITS_PRECISION = 10_000;
uint256 constant MAX_EB_PER_VALIDATOR = 2048 ether;
uint256 constant DEFAULT_EB_PER_VALIDATOR = 32 ether;

struct ClusterEBSnapshot {
    uint64 vUnits;
    uint64 lastRootBlockNum;
    uint64 lastUpdateBlock;
}

struct StorageEB {
    /// @notice Maps block to EB roots
    mapping(uint64 => bytes32) ebRoots;
    /// @notice Maps cluster ID to EB snapshot
    mapping(bytes32 => ClusterEBSnapshot) clusterEB;
    /// @notice Maps operator ID to vUnits
    mapping(uint64 => uint64) operatorVUnits;
    /// @notice Maps operator ID to ETH vUnits
    mapping(uint64 => uint64) operatorEthVUnits;
    /// @notice Latest block number where EB was committed
    uint64 latestCommittedBlock;
    /// @notice Minimum blocks between updates
    uint32 minBlocksBetweenUpdates;
    /// @notice TEMP counts root commitments for oracle logic simulation (root commitment is encoded root and block)
    mapping(bytes32 => uint256) rootCommitments;
}

library SSVStorageEB {
    uint256 private constant SSV_STORAGE_POSITION = uint256(keccak256("ssv.network.storage.eb")) - 1;

    function load() internal pure returns (StorageEB storage seb) {
        uint256 position = SSV_STORAGE_POSITION;
        assembly {
            seb.slot := position
        }
    }
}
