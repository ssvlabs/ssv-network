// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./SSVDAO.sol";

contract DAO is SSVDAO {
    uint64 private constant MINIMAL_LIQUIDATION_THRESHOLD = 100_800;

    function echidna_test(uint256 amount) public returns (bool) {
        return SSVStorageProtocol.load().networkFee == amount;
    }
}
