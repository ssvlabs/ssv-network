// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../libraries/ClusterLib.sol";

contract EffectiveBalanceTest {
    function testRoundtrip(uint32 effectiveBalance) public pure returns (uint64 vUnits, uint32 result, bool success) {
        vUnits = ClusterLib.ebToVUnits(effectiveBalance);
        result = ClusterLib.vUnitsToEB(vUnits);
        success = (result == effectiveBalance);
    }
}
