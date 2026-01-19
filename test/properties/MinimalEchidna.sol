// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

/// @notice Minimal contract to test Echidna deployment
contract MinimalEchidna {
    uint256 public counter;

    function test_increment() public {
        counter++;
    }

    function echidna_counter_positive() public view returns (bool) {
        return counter >= 0;
    }
}
