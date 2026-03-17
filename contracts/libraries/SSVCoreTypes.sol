// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

type PackedSSV is uint64;
type PackedETH is uint64;

PackedETH constant PACKED_ETH_ZERO = PackedETH.wrap(0);
PackedSSV constant PACKED_SSV_ZERO = PackedSSV.wrap(0);

uint8 constant VERSION_SSV = 0;
uint8 constant VERSION_ETH = 1;
uint8 constant VERSION_UNDEFINED = type(uint8).max;

uint64 constant BPS_DENOMINATOR = 10_000;
uint256 constant DEFAULT_OPERATOR_ETH_FEE = 1770_000_000;
uint256 constant PRECISION = 1e18;

uint256 constant DEDUCTED_DIGITS = 10_000_000;
uint256 constant ETH_DEDUCTED_DIGITS = 100_000;

uint256 constant DEFAULT_EB_PER_VALIDATOR = 32 ether;
uint256 constant MAX_EB_PER_VALIDATOR = 2048 ether;

error SafeCastOverflow();

function _safeUint64(uint128 value) pure returns (uint64) {
    if (value > type(uint64).max) revert SafeCastOverflow();
    return uint64(value);
}

