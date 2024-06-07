// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

contract Test {
    uint256 public counter;

    function increment() external {
        ++counter;
    }
}
