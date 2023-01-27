// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "../SSVNetwork.sol";
import "./libraries/NetworkLib_V2.sol";

contract SSVNetwork_V2_2 is SSVNetwork {
    using NetworkLib_V2 for DAO;

    function getFixedNetworkRawBalance() external view returns (uint64) {
        DAO memory dao = ISSVNetworkCore.DAO({
            validatorCount: 0,
            withdrawn: 0,
            earnings: ISSVNetworkCore.Snapshot({
                block: uint64(block.number),
                index: 0,
                balance: 100
            })
        });

        return dao.networkRawBalance();
    }
}
