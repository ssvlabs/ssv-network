// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {PackedSSV, PackedETH, PACKED_ETH_ZERO, PACKED_SSV_ZERO, VERSION_SSV, VERSION_ETH, VERSION_UNDEFINED, DEFAULT_OPERATOR_ETH_FEE} from "../../libraries/SSVCoreTypes.sol";
import {PackedSSVLib, PackedETHLib, PackingLib, DEDUCTED_DIGITS, ETH_DEDUCTED_DIGITS} from "../../libraries/SSVPackedLib.sol";

contract PackedLibHarness {
    using PackedSSVLib for PackedSSV;
    using PackedETHLib for PackedETH;

    // ============ Constants ============

    function getDeductedDigits() external pure returns (uint256) {
        return DEDUCTED_DIGITS;
    }

    function getEthDeductedDigits() external pure returns (uint256) {
        return ETH_DEDUCTED_DIGITS;
    }

    function getVersionSSV() external pure returns (uint8) {
        return VERSION_SSV;
    }

    function getVersionETH() external pure returns (uint8) {
        return VERSION_ETH;
    }

    function getVersionUndefined() external pure returns (uint8) {
        return VERSION_UNDEFINED;
    }

    function getDefaultOperatorEthFee() external pure returns (uint256) {
        return DEFAULT_OPERATOR_ETH_FEE;
    }

    function getPackedEthZero() external pure returns (uint64) {
        return PackedETH.unwrap(PACKED_ETH_ZERO);
    }

    function getPackedSsvZero() external pure returns (uint64) {
        return PackedSSV.unwrap(PACKED_SSV_ZERO);
    }

    // ============ PackedETHLib ============

    function ethPack(uint256 value) external pure returns (uint64) {
        return PackedETH.unwrap(PackedETHLib.pack(value));
    }

    function ethUnpack(uint64 raw) external pure returns (uint256) {
        return PackedETHLib.unpack(PackedETH.wrap(raw));
    }

    function ethRaw(uint64 raw) external pure returns (uint64) {
        return PackedETHLib.raw(PackedETH.wrap(raw));
    }

    function ethEq(uint64 a, uint64 b) external pure returns (bool) {
        return PackedETH.wrap(a).eq(PackedETH.wrap(b));
    }

    function ethNeq(uint64 a, uint64 b) external pure returns (bool) {
        return PackedETH.wrap(a).neq(PackedETH.wrap(b));
    }

    function ethGt(uint64 a, uint64 b) external pure returns (bool) {
        return PackedETH.wrap(a).gt(PackedETH.wrap(b));
    }

    function ethGte(uint64 a, uint64 b) external pure returns (bool) {
        return PackedETH.wrap(a).gte(PackedETH.wrap(b));
    }

    function ethLt(uint64 a, uint64 b) external pure returns (bool) {
        return PackedETH.wrap(a).lt(PackedETH.wrap(b));
    }

    function ethLte(uint64 a, uint64 b) external pure returns (bool) {
        return PackedETH.wrap(a).lte(PackedETH.wrap(b));
    }

    function ethAdd(uint64 a, uint64 b) external pure returns (uint64) {
        return PackedETH.unwrap(PackedETH.wrap(a).add(PackedETH.wrap(b)));
    }

    function ethSub(uint64 a, uint64 b) external pure returns (uint64) {
        return PackedETH.unwrap(PackedETH.wrap(a).sub(PackedETH.wrap(b)));
    }

    // ============ PackedSSVLib ============

    function ssvPack(uint256 value) external pure returns (uint64) {
        return PackedSSV.unwrap(PackedSSVLib.pack(value));
    }

    function ssvUnpack(uint64 raw) external pure returns (uint256) {
        return PackedSSVLib.unpack(PackedSSV.wrap(raw));
    }

    function ssvRaw(uint64 raw) external pure returns (uint64) {
        return PackedSSVLib.raw(PackedSSV.wrap(raw));
    }

    function ssvEq(uint64 a, uint64 b) external pure returns (bool) {
        return PackedSSV.wrap(a).eq(PackedSSV.wrap(b));
    }

    function ssvNeq(uint64 a, uint64 b) external pure returns (bool) {
        return PackedSSV.wrap(a).neq(PackedSSV.wrap(b));
    }

    function ssvGt(uint64 a, uint64 b) external pure returns (bool) {
        return PackedSSV.wrap(a).gt(PackedSSV.wrap(b));
    }

    function ssvLt(uint64 a, uint64 b) external pure returns (bool) {
        return PackedSSV.wrap(a).lt(PackedSSV.wrap(b));
    }

    function ssvAdd(uint64 a, uint64 b) external pure returns (uint64) {
        return PackedSSV.unwrap(PackedSSV.wrap(a).add(PackedSSV.wrap(b)));
    }

    function ssvSub(uint64 a, uint64 b) external pure returns (uint64) {
        return PackedSSV.unwrap(PackedSSV.wrap(a).sub(PackedSSV.wrap(b)));
    }
}
