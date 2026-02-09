// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {PackedSSV, PackedETH} from "../SSVCoreTypes.sol";

/// @title SSV Network Storage Protocol
/// @notice Represents the operational settings and parameters required by the SSV Network
struct StorageProtocol {
    /// @notice The block number when the network fee index was last updated
    uint32 networkFeeIndexBlockNumber;
    /// @notice The count of validators governed by the DAO
    uint32 daoValidatorCount;
    /// @notice The block number when the DAO index was last updated
    uint32 daoIndexBlockNumber;
    /// @notice The maximum limit of validators per operator
    uint32 validatorsPerOperatorLimit;
    /// @notice The current network fee value
    PackedSSV networkFee;
    /// @notice The current network fee index value
    uint64 networkFeeIndex;
    /// @notice The current balance of the DAO
    PackedSSV daoBalance;
    /// @notice The minimum number of blocks before a liquidation event can be triggered for SSV cluster
    uint64 minimumBlocksBeforeLiquidationSSV;
    /// @notice The minimum collateral required for liquidation of SSV clusters
    PackedSSV minimumLiquidationCollateralSSV;
    /// @notice The period in which an operator can declare a fee change
    uint64 declareOperatorFeePeriod;
    /// @notice The period in which an operator fee change can be executed
    uint64 executeOperatorFeePeriod;
    /// @notice The maximum increase in operator fee that is allowed (percentage)
    uint64 operatorMaxFeeIncrease;
    /// @notice The maximum value in operator fee that is allowed (SSV)
    uint64 operatorMaxFeeSSV;

    // ETH 
    /// @notice The block number when the network fee index was last updated for eth
    uint32 ethNetworkFeeIndexBlockNumber;
    /// @notice The count of validators governed by the DAO for eth clusters
    uint32 ethDaoValidatorCount;
    /// @notice The block number when the DAO index was last updated for eth
    uint32 ethDaoIndexBlockNumber;
    /// @notice The current network fee value for eth clusters
    PackedETH ethNetworkFee;
    /// @notice The current network fee index value for eth clusters
    uint64 ethNetworkFeeIndex;
    /// @notice The current balance of the DAO for eth clusters
    PackedETH ethDaoBalance;
    /// @notice The minimum collateral required for liquidation
    PackedETH minimumLiquidationCollateral;
    /// @notice The minimum number of blocks before a liquidation event can be triggered
    uint64 minimumBlocksBeforeLiquidation;
    /// @notice The maximum value in operator fee that is allowed (ETH)
    PackedETH operatorMaxFee;

    // EB
    /// @notice The current total ETH vUnits
    uint64 daoTotalEthVUnits;
    /// @notice The minimum operator ETH fee (DAO-governed)
    PackedETH minimumOperatorEthFee;
}

library SSVStorageProtocol {
    uint256 private constant SSV_STORAGE_POSITION = uint256(keccak256("ssv.network.storage.protocol")) - 1;

    function load() internal pure returns (StorageProtocol storage sd) {
        uint256 position = SSV_STORAGE_POSITION;
        assembly {
            sd.slot := position
        }
    }
}
