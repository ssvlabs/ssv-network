// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/ISSVNetworkCore.sol";

struct StorageNetwork {
    uint32 networkFeeIndexBlockNumber;
    uint32 daoValidatorCount;
    uint32 daoIndexBlockNumber;
    uint32 validatorsPerOperatorLimit;
    uint64 networkFee;
    uint64 networkFeeIndex;
    uint64 daoBalance;
    uint64 minimumBlocksBeforeLiquidation;
    uint64 minimumLiquidationCollateral;
}

library SSVStorageNetwork {
    uint256 constant SSV_STORAGE_POSITION = uint256(keccak256("ssv.network.storage.network")) - 1;

    function load() internal pure returns (StorageNetwork storage sd) {
        uint256 position = SSV_STORAGE_POSITION;
        assembly {
            sd.slot := position
        }
    }
}
