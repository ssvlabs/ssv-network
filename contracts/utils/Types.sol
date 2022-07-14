// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

uint64 constant DEDUCTED_DIGITS = 10000000;

library Types64 {
  function expand(uint64 value) internal pure returns (uint256) {
    return uint256(value) * DEDUCTED_DIGITS;
  }
}

library Types256 {
  function shrink(uint256 value) internal pure returns (uint64) {
    require(value % DEDUCTED_DIGITS == 0, "Precision is over the maximum defined");
    return uint64(value / DEDUCTED_DIGITS);
  }
}