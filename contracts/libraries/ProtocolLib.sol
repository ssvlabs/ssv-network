// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../interfaces/ISSVNetworkCore.sol";
import {Types256} from "./Types.sol";
import {StorageProtocol} from "./SSVStorageProtocol.sol";

library ProtocolLib {
    using Types256 for uint256;

    /******************************/
    /* Network internal functions */
    /******************************/
    function currentNetworkFeeIndex(StorageProtocol storage sp) internal view returns (uint64) {
        return sp.ethNetworkFeeIndex + uint64(block.number - sp.ethNetworkFeeIndexBlockNumber) * sp.ethNetworkFee;
    }

    function currentNetworkFeeIndexSSV(StorageProtocol storage sp) internal view returns (uint64) {
        return sp.networkFeeIndex + uint64(block.number - sp.networkFeeIndexBlockNumber) * sp.networkFee;
    }

    function updateNetworkFee(StorageProtocol storage sp, uint256 fee) internal {
        updateDAOEarnings(sp);

        sp.ethNetworkFeeIndex = currentNetworkFeeIndex(sp);
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
        sp.ethNetworkFee = fee.shrink();
    }

    function updateNetworkFeeSSV(StorageProtocol storage sp, uint256 fee) internal {
        updateDAOEarnings(sp);

        sp.networkFeeIndex = currentNetworkFeeIndexSSV(sp);
        sp.networkFeeIndexBlockNumber = uint32(block.number);
        sp.networkFee = fee.shrink();
    }

    /**************************/
    /* DAO internal functions */
    /**************************/
    function updateDAOEarnings(StorageProtocol storage sp) internal {
        sp.ethDaoBalance = networkTotalEarnings(sp);
        sp.ethDaoIndexBlockNumber = uint32(block.number);
    }
    
    function updateDAOEarningsSSV(StorageProtocol storage sp) internal {
        sp.daoBalance = networkTotalEarningsSSV(sp);
        sp.daoIndexBlockNumber = uint32(block.number);
    }

    function networkTotalEarnings(StorageProtocol storage sp) internal view returns (uint64) {
        return
            sp.ethDaoBalance +
            (uint64(block.number - sp.ethDaoIndexBlockNumber)) *
            sp.ethNetworkFee *
            sp.ethDaoValidatorCount;
        }    

    function networkTotalEarningsSSV(StorageProtocol storage sp) internal view returns (uint64) {
        return sp.daoBalance + (uint64(block.number) - sp.daoIndexBlockNumber) * sp.networkFee * sp.daoValidatorCount;
    }

    function updateDAO(StorageProtocol storage sp, bool increaseValidatorCount, uint32 deltaValidatorCount) internal {
        updateDAOEarnings(sp);
        if (!increaseValidatorCount) {
            sp.ethDaoValidatorCount -= deltaValidatorCount;
        } else if ((sp.ethDaoValidatorCount += deltaValidatorCount) > type(uint32).max) {
            revert ISSVNetworkCore.MaxValueExceeded();
        }
    }

    function updateDAOSSV(StorageProtocol storage sp, bool increaseValidatorCount, uint32 deltaValidatorCount) internal {
        updateDAOEarningsSSV(sp);
        if (!increaseValidatorCount) {
            sp.daoValidatorCount -= deltaValidatorCount;
        } else if ((sp.daoValidatorCount += deltaValidatorCount) > type(uint32).max) {
            revert ISSVNetworkCore.MaxValueExceeded();
        }
    }
}
