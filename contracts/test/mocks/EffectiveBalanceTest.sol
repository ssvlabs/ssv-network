// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {VUNITS_PRECISION, DEFAULT_EB_PER_VALIDATOR} from "../../libraries/SSVStorageEB.sol";

/// @notice Test contract to verify effective balance roundtrip conversion
contract EffectiveBalanceTest {
    /// @notice Convert effective balance to vUnits using ceiling division (write path)
    function effectiveBalanceToVUnits(uint32 effectiveBalance) public pure returns (uint64) {
        return uint64(
            (effectiveBalance * VUNITS_PRECISION + (DEFAULT_EB_PER_VALIDATOR / 1 ether) - 1) /
                (DEFAULT_EB_PER_VALIDATOR / 1 ether)
        );
    }

    /// @notice Convert vUnits back to effective balance (read path)
    function vUnitsToEffectiveBalance(uint64 vUnits) public pure returns (uint32) {
        return uint32((uint256(vUnits) * (DEFAULT_EB_PER_VALIDATOR / 1 ether)) / VUNITS_PRECISION);
    }

    /// @notice Test roundtrip conversion - should return original value or higher
    function testRoundtrip(uint32 effectiveBalance) public pure returns (uint32 result, bool success) {
        uint64 vUnits = effectiveBalanceToVUnits(effectiveBalance);
        result = vUnitsToEffectiveBalance(vUnits);
        // After fix: result should equal effectiveBalance (no precision loss)
        success = (result >= effectiveBalance);
    }

    /// @notice Old conversion (floor division) for comparison - DO NOT USE
    function effectiveBalanceToVUnitsOld(uint32 effectiveBalance) public pure returns (uint64) {
        return uint64((effectiveBalance * VUNITS_PRECISION) / (DEFAULT_EB_PER_VALIDATOR / 1 ether));
    }

    /// @notice Test old roundtrip to demonstrate the bug
    function testRoundtripOld(uint32 effectiveBalance) public pure returns (uint32 result, bool success) {
        uint64 vUnits = effectiveBalanceToVUnitsOld(effectiveBalance);
        result = vUnitsToEffectiveBalance(vUnits);
        success = (result >= effectiveBalance);
    }
}
