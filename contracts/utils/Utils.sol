// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.13;

library Utils {
  uint64 constant DEDUCTED_DIGITS = 10000000;

  function blockNumber() external view returns (uint256) {
    return block.number;
  }

  function blockTimestamp() external view returns (uint256) {
    return block.timestamp;
  }

  function to64(uint256 value) external view returns (uint64) {
    uint64 res = uint64(value / DEDUCTED_DIGITS);
    require(res > 0, "value is too low");
    return res;
  }

  function from64(uint64 value) external view returns (uint256) {
    return uint256(value * DEDUCTED_DIGITS);
  }
}