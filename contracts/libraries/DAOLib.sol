// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/ISSVNetworkCore.sol";
import "../SSVNetwork.sol";
import "./SSVStorage.sol";

library DAOLib {
    function updateDAOEarnings(ISSVNetworkCore.DAO storage dao, uint64 networkFee) internal {
        dao.balance = networkTotalEarnings(dao, networkFee);
        dao.block = uint32(block.number);
    }

    function networkTotalEarnings(ISSVNetworkCore.DAO memory dao, uint64 networkFee) internal view returns (uint64) {
        return dao.balance + (uint64(block.number) - dao.block) * networkFee * dao.validatorCount;
    }

    function updateDAO(
        ISSVNetworkCore.DAO storage dao,
        bool increaseValidatorCount,
        uint32 deltaValidatorCount
    ) internal {
        updateDAOEarnings(dao, SSVStorage.load().network.networkFee);
        if (!increaseValidatorCount) {
            dao.validatorCount -= deltaValidatorCount;
        } else if ((dao.validatorCount += deltaValidatorCount) > type(uint32).max) {
            revert ISSVNetworkCore.MaxValueExceeded();
        }
    }
}
