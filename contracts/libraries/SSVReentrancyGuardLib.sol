// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {SSVStorageReentrancy, StorageReentrancy} from "./SSVStorageReentrancy.sol";

library SSVReentrancyGuardLib {
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    function _nonReentrantBefore() internal {
        StorageReentrancy storage s = SSVStorageReentrancy.load();
        if (s.status == ENTERED) revert ReentrancyGuardReentrantCall();
        s.status = ENTERED;
    }

    function _nonReentrantAfter() internal {
        SSVStorageReentrancy.load().status = NOT_ENTERED;
    }

    function _reentrancyGuardStorageSlot() internal pure returns (bytes32) {
        return SSVStorageReentrancy.slot();
    }
}
