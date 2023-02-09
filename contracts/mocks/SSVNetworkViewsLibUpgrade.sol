// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "../SSVNetworkViews.sol";
import "../ISSVNetworkCore.sol";
import "./libraries/NetworkLibUpgrade.sol";

contract SSVNetworkViewsLibUpgrade is SSVNetworkViews {
    using NetworkLibUpgrade for ISSVNetworkCore.DAO;

    function getFixedNetworkRawBalance() external view returns (uint64) {
        ISSVNetworkCore.DAO memory dao = ISSVNetworkCore.DAO({
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
