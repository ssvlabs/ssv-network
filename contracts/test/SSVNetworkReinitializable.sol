// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../SSVNetwork.sol";
import {SSVStorage as SSVStorageUpgrade} from "./libraries/SSVStorage.sol";

contract SSVNetworkReinitializable is SSVNetwork {
    function initializeV2(uint64 newMinOperatorsPerCluster) public reinitializer(2) {
        SSVStorageUpgrade.load().minOperatorsPerCluster = newMinOperatorsPerCluster;
    }
}
