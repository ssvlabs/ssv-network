// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../interfaces/ISSVNetworkCore.sol";
import {Types256} from "./Types.sol";
import {StorageProtocol} from "./SSVStorageProtocol.sol";
import "./CoreLib.sol";

library ProtocolLib {
    using Types256 for uint256;

    /******************************/
    /* Network internal functions */
    /******************************/
    function currentNetworkFeeIndex(StorageProtocol storage sp) internal view returns (uint64) {
        return sp.networkFeeIndex + uint64(block.number - sp.networkFeeIndexBlockNumber) * sp.networkFee;
    }

    function updateNetworkFee(StorageProtocol storage sp, uint256 fee) internal {
        _materializeDAOEarnings(sp);
        sp.networkFeeIndex = currentNetworkFeeIndex(sp);
        sp.networkFeeIndexBlockNumber = uint32(block.number);
        sp.networkFee = fee.shrink();
    }

    /**************************/
    /* DAO internal functions */
    /**************************/
    function updateDAOEarnings(StorageProtocol storage sp, uint8 version) internal {
        _materializeDAOEarnings(sp);
        if (version != CoreLib.VERSION_ETH && version != CoreLib.VERSION_SSV) {
            revert ISSVNetworkCore.IncorrectDAOVersion(version);
        }
    }

    function networkTotalEarnings(StorageProtocol storage sp, uint8 version) internal view returns (uint64) {
        (uint64 balance, uint32 validatorCount) = _getDAOAccounting(sp, version);
        if (validatorCount == 0) return balance;
        return balance + (uint64(block.number) - sp.daoIndexBlockNumber) * sp.networkFee * validatorCount;
    }

    function updateDAO(
        StorageProtocol storage sp,
        bool increaseValidatorCount,
        uint32 deltaValidatorCount,
        uint8 version
    ) internal {
        _materializeDAOEarnings(sp);
        if (!increaseValidatorCount) {
            sp.daoValidatorCount -= deltaValidatorCount;
            if (version == CoreLib.VERSION_ETH) {
                sp.daoEthValidatorCount -= deltaValidatorCount;
            }
        } else {
            if ((sp.daoValidatorCount += deltaValidatorCount) > type(uint32).max) {
                revert ISSVNetworkCore.MaxValueExceeded();
            }

            if (version == CoreLib.VERSION_ETH) {
                if ((sp.daoEthValidatorCount += deltaValidatorCount) > type(uint32).max) {
                    revert ISSVNetworkCore.MaxValueExceeded();
                }
            }
        }
    }

    function _materializeDAOEarnings(StorageProtocol storage sp) private {
        uint32 lastUpdate = sp.daoIndexBlockNumber;
        uint32 currentBlock = uint32(block.number);
        if (currentBlock == lastUpdate) return;

        if (sp.daoValidatorCount < sp.daoEthValidatorCount) {
            revert ISSVNetworkCore.IncorrectDAOVersion(CoreLib.VERSION_UNDEFINED);
        }

        uint64 blockDiff = uint64(currentBlock - lastUpdate);
        uint64 feeDelta = blockDiff * sp.networkFee;

        uint64 ethValidators = sp.daoEthValidatorCount;
        uint64 ssvValidators = sp.daoValidatorCount - ethValidators;

        if (ethValidators != 0) {
            sp.daoEthBalance += feeDelta * ethValidators;
        }
        if (ssvValidators != 0) {
            sp.daoBalance += feeDelta * ssvValidators;
        }

        sp.daoIndexBlockNumber = currentBlock;
    }

    function _getDAOAccounting(
        StorageProtocol storage sp,
        uint8 version
    ) private view returns (uint64 balance, uint32 validatorCount) {
        if (version == CoreLib.VERSION_ETH) {
            return (sp.daoEthBalance, sp.daoEthValidatorCount);
        } else if (version == CoreLib.VERSION_SSV) {
            if (sp.daoValidatorCount < sp.daoEthValidatorCount) {
                revert ISSVNetworkCore.IncorrectDAOVersion(version);
            }
            return (sp.daoBalance, sp.daoValidatorCount - sp.daoEthValidatorCount);
        }

        revert ISSVNetworkCore.IncorrectDAOVersion(version);
    }
}
