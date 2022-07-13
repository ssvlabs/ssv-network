// File: contracts/utils/VersionedContract.sol
// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.2;

interface VersionedContract {
  function version() external pure returns (uint32);
}
