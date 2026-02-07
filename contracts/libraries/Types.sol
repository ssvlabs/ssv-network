// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

uint256 constant DEDUCTED_DIGITS = 10_000_000;

/**
 * @title SSV Types64 Library
 * @notice Library for uint64 type conversions with precision scaling
 */
library Types64 {
    /**
     * @notice Expands uint64 value by multiplying with precision factor
     * @param value Value to expand
     * @return Expanded value
     */
    function expand(uint64 value) internal pure returns (uint256) {
        return value * DEDUCTED_DIGITS;
    }
}

/**
 * @title SSV Types256 Library
 * @notice Library for uint256 type conversions with precision checks and scaling
 */
library Types256 {
    /**
     * @notice Shrinks uint256 value by dividing with precision factor after checks
     * @param value Value to shrink
     * @return Shrunk value as uint64
     */
    function shrink(uint256 value) internal pure returns (uint64) {
        require(value < (2 ** 64 * DEDUCTED_DIGITS), "Max value exceeded");
        return uint64(shrinkable(value) / DEDUCTED_DIGITS);
    }

    /**
     * @notice Checks if uint256 is shrinkable (divisible by precision factor)
     * @param value Value to check
     * @return Shrinkable value if valid
     */
    function shrinkable(uint256 value) internal pure returns (uint256) {
        require(value % DEDUCTED_DIGITS == 0, "Max precision exceeded");
        return value;
    }
}