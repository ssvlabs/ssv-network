// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

/// @notice Storage layout for the reentrancy guard (matches other SSV storage libs).
struct StorageReentrancy {
    uint256 status;
}

library SSVStorageReentrancy {
    // keccak256("ssv.network.storage.reentrancy") - 1
    uint256 private constant SSV_REENTRANCY_POSITION =
        uint256(keccak256("ssv.network.storage.reentrancy")) - 1;

    function slot() internal pure returns (bytes32) {
        return bytes32(SSV_REENTRANCY_POSITION);
    }

    function load() internal pure returns (StorageReentrancy storage sr) {
        uint256 position = SSV_REENTRANCY_POSITION;
        assembly {
            sr.slot := position
        }
    }
}
