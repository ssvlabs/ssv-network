// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "../ISSVNetworkCore.sol";
import "../SSVNetwork.sol";

library NetworkLib {
    function networkBalance(
        ISSVNetworkCore.DAO memory dao,
        uint64 networkFee
    ) internal view returns (uint64) {
        return networkTotalEarnings(dao, networkFee) - dao.withdrawn;
    }

    function updateDAOEarnings(
        ISSVNetworkCore.DAO memory dao,
        uint64 networkFee
    ) internal view returns (ISSVNetworkCore.DAO memory) {
        dao.earnings.balance = networkTotalEarnings(dao, networkFee);
        dao.earnings.block = uint64(block.number);

        return dao;
    }

    function networkTotalEarnings(
        ISSVNetworkCore.DAO memory dao,
        uint64 networkFee
    ) internal view returns (uint64) {
        return
            dao.earnings.balance +
            (uint64(block.number) - dao.earnings.block) *
            networkFee *
            dao.validatorCount;
    }

    function currentNetworkFeeIndex(
        ISSVNetworkCore.Network memory network
    ) internal view returns (uint64) {
        return
            network.networkFeeIndex +
            uint64(block.number - network.networkFeeIndexBlockNumber) *
            network.networkFee;
    }
}
