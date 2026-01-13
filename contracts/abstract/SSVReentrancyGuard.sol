// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {SSVReentrancyGuardLib} from "../libraries/SSVReentrancyGuardLib.sol";

abstract contract SSVReentrancyGuard {
    modifier nonReentrant() {
        SSVReentrancyGuardLib._nonReentrantBefore();
        _;
        SSVReentrancyGuardLib._nonReentrantAfter();
    }
}
