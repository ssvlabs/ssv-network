// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../interfaces/ISSVNetworkCore.sol";
import {PackedSSV, PackedETH} from "../libraries/SSVCoreTypes.sol";
import {PackedSSVLib, PackedETHLib} from "../libraries/SSVPackedLib.sol";
import {StorageProtocol} from "./SSVStorageProtocol.sol";
import {VUNITS_PRECISION} from "./SSVStorageEB.sol";

library ProtocolLib {
    using PackedETHLib for PackedETH;
    
    /******************************/
    /* Network internal functions */
    /******************************/
    function currentNetworkFeeIndex(StorageProtocol storage sp) internal view returns (uint64) {
        return sp.ethNetworkFeeIndex + uint64(block.number - sp.ethNetworkFeeIndexBlockNumber) * PackedETH.unwrap(sp.ethNetworkFee);
    }

    function currentNetworkFeeIndexSSV(StorageProtocol storage sp) internal view returns (uint64) {
        return sp.networkFeeIndex + uint64(block.number - sp.networkFeeIndexBlockNumber) * PackedSSV.unwrap(sp.networkFee);
    }

    function updateNetworkFee(StorageProtocol storage sp, uint256 fee) internal {
        updateDAOEarnings(sp);

        sp.ethNetworkFeeIndex = currentNetworkFeeIndex(sp);
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
        sp.ethNetworkFee = PackedETHLib.pack(fee);
    }

    function updateNetworkFeeSSV(StorageProtocol storage sp, uint256 fee) internal {
        updateDAOEarningsSSV(sp);

        sp.networkFeeIndex = currentNetworkFeeIndexSSV(sp);
        sp.networkFeeIndexBlockNumber = uint32(block.number);
        sp.networkFee = PackedSSVLib.pack(fee);
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

    function networkTotalEarnings(StorageProtocol storage sp) internal view returns (PackedETH) {
        uint128 units = sp.daoTotalEthVUnits;
        uint128 idx = uint64(block.number) - sp.ethDaoIndexBlockNumber;

        uint128 earningsUnits = (idx * PackedETH.unwrap(sp.ethNetworkFee) * units) / VUNITS_PRECISION;
        return sp.ethDaoBalance.add(PackedETH.wrap(uint64(earningsUnits)));
    }    

    function networkTotalEarningsSSV(StorageProtocol storage sp) internal view returns (PackedSSV) {
        return PackedSSV.wrap(PackedSSV.unwrap(sp.daoBalance) + (uint64(block.number) - sp.daoIndexBlockNumber) * PackedSSV.unwrap(sp.networkFee) * sp.daoValidatorCount);
    }

    function updateDAO(StorageProtocol storage sp, bool increaseValidatorCount, uint32 deltaValidatorCount) internal {
        updateDAOEarnings(sp);
        uint64 vUnitsDelta = uint64(deltaValidatorCount) * VUNITS_PRECISION;
        if (!increaseValidatorCount) {
            sp.ethDaoValidatorCount -= deltaValidatorCount;
            sp.daoTotalEthVUnits -= vUnitsDelta;
        } else {
            if ((sp.ethDaoValidatorCount += deltaValidatorCount) > type(uint32).max) {
                revert ISSVNetworkCore.MaxValueExceeded();
            } 
            sp.daoTotalEthVUnits += vUnitsDelta;
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

    function updateDAOEthVUnits(StorageProtocol storage sp, uint64 oldVUnits, uint64 newVUnits) internal {
        updateDAOEarnings(sp);  // Settle ETH earnings first

        if (newVUnits > oldVUnits) {
            sp.daoTotalEthVUnits += newVUnits - oldVUnits;
        } else {
            sp.daoTotalEthVUnits -= oldVUnits - newVUnits;
        }
    }
}
