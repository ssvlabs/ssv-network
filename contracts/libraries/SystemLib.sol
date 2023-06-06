// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/ISSVNetworkCore.sol";
import "../SSVNetwork.sol";
import "./SSVStorageNetwork.sol";

library SystemLib {
    using Types256 for uint256;

    function currentNetworkFeeIndex(StorageNetwork storage sn) internal view returns (uint64) {
        return sn.networkFeeIndex + uint64(block.number - sn.networkFeeIndexBlockNumber) * sn.networkFee;
    }

    function updateNetworkFee(StorageNetwork storage sn, uint256 fee) internal {
        updateDAOEarnings(sn);

        sn.networkFeeIndex = currentNetworkFeeIndex(sn);
        sn.networkFeeIndexBlockNumber = uint32(block.number);
        sn.networkFee = fee.shrink();
    }

    // DAO
    function updateDAOEarnings(StorageNetwork storage sn) internal {
        sn.daoBalance = networkTotalEarnings(sn);
        sn.daoIndexBlockNumber = uint32(block.number);
    }

    function networkTotalEarnings(StorageNetwork storage sn) internal view returns (uint64) {
        return sn.daoBalance + (uint64(block.number) - sn.daoIndexBlockNumber) * sn.networkFee * sn.daoValidatorCount;
    }

    function updateDAO(StorageNetwork storage sn, bool increaseValidatorCount, uint32 deltaValidatorCount) internal {
        updateDAOEarnings(sn);
        if (!increaseValidatorCount) {
            sn.daoValidatorCount -= deltaValidatorCount;
        } else if ((sn.daoValidatorCount += deltaValidatorCount) > type(uint32).max) {
            revert ISSVNetworkCore.MaxValueExceeded();
        }
    }
}
