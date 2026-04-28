// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {SSVReentrancyGuardLib} from "../libraries/SSVReentrancyGuardLib.sol";

/**
 * @title SSV Reentrancy Guard
 * @author SSV Labs
 * @dev An abstract contract that provides a modifier to prevent reentrancy attacks
 */
abstract contract SSVReentrancyGuard {
    /**
     * @dev Prevents a contract from re-calling itself, directly or indirectly
     */
    modifier nonReentrant() {
        SSVReentrancyGuardLib._nonReentrantBefore();
        _;
        SSVReentrancyGuardLib._nonReentrantAfter();
    }
}