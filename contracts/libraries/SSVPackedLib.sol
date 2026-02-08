// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {PackedSSV, PackedETH} from "./SSVCoreTypes.sol";

uint256 constant DEDUCTED_DIGITS = 10_000_000;
uint256 constant ETH_DEDUCTED_DIGITS = 100_000;

library PackingLib {
    error MaxValueExceeded();
    error MaxPrecisionExceeded();

    function _pack(uint256 value, uint256 scale) internal pure returns (uint64) {
        if (value > uint256(type(uint64).max) * scale) revert MaxValueExceeded();
        if (value % scale != 0) revert MaxPrecisionExceeded();

        return uint64(value / scale);
    }

    function _unpack(uint64 raw, uint256 scale) internal pure returns (uint256) {
        return uint256(raw) * scale;
    }
}

library PackedSSVLib {
    function pack(uint256 value) internal pure returns (PackedSSV) {
        return PackedSSV.wrap(PackingLib._pack(value, DEDUCTED_DIGITS));
    }

    function unpack(PackedSSV packed) internal pure returns (uint256) {
        return PackingLib._unpack(PackedSSV.unwrap(packed), DEDUCTED_DIGITS);
    }

    function raw(PackedSSV packed) internal pure returns (uint64) {
        return PackedSSV.unwrap(packed);
    }

    function eq(PackedSSV a, PackedSSV b) internal pure returns (bool) {
        return PackedSSV.unwrap(a) == PackedSSV.unwrap(b);
    }

    function neq(PackedSSV a, PackedSSV b) internal pure returns (bool) {
        return PackedSSV.unwrap(a) != PackedSSV.unwrap(b);
    }

    function gt(PackedSSV a, PackedSSV b) internal pure returns (bool) {
        return PackedSSV.unwrap(a) > PackedSSV.unwrap(b);
    }

    function lt(PackedSSV a, PackedSSV b) internal pure returns (bool) {
        return PackedSSV.unwrap(a) < PackedSSV.unwrap(b);
    }

    function add(PackedSSV a, PackedSSV b) internal pure returns (PackedSSV) {
        return PackedSSV.wrap(PackedSSV.unwrap(a) + PackedSSV.unwrap(b));
    }
    
    function sub(PackedSSV a, PackedSSV b) internal pure returns (PackedSSV) {
        return PackedSSV.wrap(PackedSSV.unwrap(a) - PackedSSV.unwrap(b));
    }
}

library PackedETHLib {
    function pack(uint256 value) internal pure returns (PackedETH) {
        return PackedETH.wrap(PackingLib._pack(value, ETH_DEDUCTED_DIGITS));
    }

    function unpack(PackedETH packed) internal pure returns (uint256) {
        return PackingLib._unpack(PackedETH.unwrap(packed), ETH_DEDUCTED_DIGITS);
    }

    function raw(PackedETH packed) internal pure returns (uint64) {
        return PackedETH.unwrap(packed);
    }

    function eq(PackedETH a, PackedETH b) internal pure returns (bool) {
        return PackedETH.unwrap(a) == PackedETH.unwrap(b);
    }

    function neq(PackedETH a, PackedETH b) internal pure returns (bool) {
        return PackedETH.unwrap(a) != PackedETH.unwrap(b);
    }

    function gt(PackedETH a, PackedETH b) internal pure returns (bool) {
        return PackedETH.unwrap(a) > PackedETH.unwrap(b);
    }

    function gte(PackedETH a, PackedETH b) internal pure returns (bool) {
        return PackedETH.unwrap(a) >= PackedETH.unwrap(b);
    }

    function lt(PackedETH a, PackedETH b) internal pure returns (bool) {
        return PackedETH.unwrap(a) < PackedETH.unwrap(b);
    }

    function lte(PackedETH a, PackedETH b) internal pure returns (bool) {
        return PackedETH.unwrap(a) <= PackedETH.unwrap(b);
    }

    function add(PackedETH a, PackedETH b) internal pure returns (PackedETH) {
        return PackedETH.wrap(PackedETH.unwrap(a) + PackedETH.unwrap(b));
    }

    function sub(PackedETH a, PackedETH b) internal pure returns (PackedETH) {
        return PackedETH.wrap(PackedETH.unwrap(a) - PackedETH.unwrap(b));
    }
}
