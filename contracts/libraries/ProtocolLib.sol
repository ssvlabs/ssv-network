// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../interfaces/ISSVNetworkCore.sol";
import {Types256} from "./Types.sol";
import {StorageProtocol} from "./SSVStorageProtocol.sol";
import {VUNITS_PRECISION} from "./SSVStorageEB.sol";

library ProtocolLib {
    using Types256 for uint256;

    /******************************/
    /* Network internal functions */
    /******************************/
    function currentNetworkFeeIndex(StorageProtocol storage sp) internal view returns (uint64) {
        return sp.networkFeeIndex + uint64(block.number - sp.networkFeeIndexBlockNumber) * sp.networkFee;
    }

    function updateNetworkFee(StorageProtocol storage sp, uint256 fee) internal {
        updateDAOEarnings(sp);

        sp.networkFeeIndex = currentNetworkFeeIndex(sp);
        sp.networkFeeIndexBlockNumber = uint32(block.number);
        sp.networkFee = fee.shrink();
    }

    /**************************/
    /* DAO internal functions */
    /**************************/
    function updateDAOEarnings(StorageProtocol storage sp) internal {
        sp.daoBalance = networkTotalEarnings(sp);
        sp.daoIndexBlockNumber = uint32(block.number);
    }

    function networkTotalEarnings(StorageProtocol storage sp) internal view returns (uint64) {
        uint128 units = sp.daoTotalVUnits;
        uint128 idx = uint64(block.number) - sp.daoIndexBlockNumber;
        uint128 fee = sp.networkFee;

        uint128 earningsUnits = (idx * fee * units) / VUNITS_PRECISION;
        return sp.daoBalance + uint64(earningsUnits);
    }

    function updateDAO(
        StorageProtocol storage sp,
        bool increaseValidatorCount,
        uint32 deltaValidatorCount
    ) internal {
        updateDAOEarnings(sp);
        uint64 deltaVUnits = uint64(deltaValidatorCount) * VUNITS_PRECISION;
        if (!increaseValidatorCount) {
            sp.daoValidatorCount -= deltaValidatorCount;
            sp.daoTotalVUnits -= deltaVUnits;
        } else {
            if ((sp.daoValidatorCount += deltaValidatorCount) > type(uint32).max) {
                revert ISSVNetworkCore.MaxValueExceeded();
            }
            sp.daoTotalVUnits += deltaVUnits;
        }
    }
}
