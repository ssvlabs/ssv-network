// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "./SSVOperatorsEchidna.sol";

contract SSVOperatorsEchidnaTest is Test {
    SSVOperatorsEchidna echidna;

    function setUp() public {
        echidna = new SSVOperatorsEchidna();
    }

    function test_deployment() public view {
        // Just verify deployment succeeded
        assertTrue(address(echidna.operatorsModule()) != address(0));
        assertTrue(address(echidna.token()) != address(0));
    }

    function test_registerOperator() public {
        bytes memory pubKey = hex"1234567890abcdef";
        echidna.test_registerOperator(pubKey, 1e14);
        assertTrue(echidna.echidna_no_invariant_failed());
    }
}
