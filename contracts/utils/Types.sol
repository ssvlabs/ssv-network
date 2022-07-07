// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.13;

library Types {
  uint64 constant DEDUCTED_DIGITS = 10000000;

  function to64(uint256 value) internal view returns (uint64) {
    uint64 res = uint64(value / DEDUCTED_DIGITS);
    return res;
  }

  function from64(uint64 value) internal view returns (uint256) {
    return uint256(value) * DEDUCTED_DIGITS;
  }
}