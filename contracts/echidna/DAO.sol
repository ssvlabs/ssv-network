// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../modules/SSVDAO.sol";

contract DAO is SSVDAO {
    constructor() {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.networkFee = 100000000 / 10;
    }

    function check_updateNetworkFee(uint256 fee) public {
        this.updateNetworkFee(fee);
    }
}
