// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

type PackedSSV is uint64;
type PackedETH is uint64;

PackedETH constant PACKED_ETH_ZERO = PackedETH.wrap(0);
PackedSSV constant PACKED_SSV_ZERO = PackedSSV.wrap(0);

uint8 constant VERSION_SSV = 0;
uint8 constant VERSION_ETH = 1;
uint8 constant VERSION_UNDEFINED = type(uint8).max;

uint256 constant DEFAULT_OPERATOR_ETH_FEE = 1770_000_000;
