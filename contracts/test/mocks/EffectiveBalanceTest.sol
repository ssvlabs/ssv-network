// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ebToVUnits, vUnitsToEB} from "../../libraries/SSVStorageEB.sol";

contract EffectiveBalanceTest {
    function testRoundtrip(uint32 effectiveBalance) public pure returns (uint64 vUnits, uint32 result, bool success) {
        vUnits = ebToVUnits(effectiveBalance);
        result = vUnitsToEB(vUnits);
        success = (result == effectiveBalance);
    }
}
