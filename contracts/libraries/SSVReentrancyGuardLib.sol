// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {SSVStorageReentrancy, StorageReentrancy} from "./storage/SSVStorageReentrancy.sol";

/**
 * @title SSV Reentrancy Guard Library
 * @author SSV Labs
 * @notice Library for preventing reentrant calls using custom storage slot
 */
library SSVReentrancyGuardLib {
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    /**
     * @dev Thrown when caller is trying to perform an unauthorized reentrant call
     */
    error ReentrancyGuardReentrantCall();

    /**
     * @notice Starts reentrancy guard
     */
    function _nonReentrantBefore() internal {
        StorageReentrancy storage s = SSVStorageReentrancy.load();
        if (s.status == ENTERED) revert ReentrancyGuardReentrantCall();
        s.status = ENTERED;
    }

    /**
     * @notice Ends reentrancy guard
     */
    function _nonReentrantAfter() internal {
        SSVStorageReentrancy.load().status = NOT_ENTERED;
    }

    /**
     * @notice Returns reentrancy guard storage slot
     * @return Storage slot
     */
    function _reentrancyGuardStorageSlot() internal pure returns (bytes32) {
        return SSVStorageReentrancy.slot();
    }
}