// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../../ISSVNetwork.sol";
import "../../SSVNetwork.sol";

library NetworkLibUpgrade {
    function networkRawBalance(ISSVNetwork.DAO memory dao) internal pure returns (uint64) {
        return dao.balance;
    }

    function networkBalance(ISSVNetworkCore.DAO memory dao, uint64 networkFee) internal view returns (uint64) {
        return networkTotalEarnings(dao, networkFee);
    }

    function updateDAOEarnings(ISSVNetworkCore.DAO memory dao, uint64 networkFee) internal view {
        dao.balance = networkTotalEarnings(dao, networkFee);
        //dao.earnings.block = uint64(block.number);
    }

    function networkTotalEarnings(ISSVNetworkCore.DAO memory dao, uint64 networkFee) internal view returns (uint64) {
        return dao.balance + (uint64(block.number) - dao.block) * networkFee * dao.validatorCount;
    }

    function currentNetworkFeeIndex(ISSVNetworkCore.Network memory network) internal view returns (uint64) {
        return network.networkFeeIndex + uint64(block.number - network.networkFeeIndexBlockNumber) * network.networkFee;
    }
}
