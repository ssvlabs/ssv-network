// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../ISSVNetworkCore.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

library SSVStorage {
    using Counters for Counters.Counter;
    bytes32 constant SSV_OPERATORS_CONTRACT = keccak256("ssv.network.contract.operators");
    bytes32 constant SSV_CLUSTERS_CONTRACT = keccak256("ssv.network.contract.clusters");

    uint256 constant SSV_STORAGE_POSITION = uint256(keccak256("ssv.network.contract.storage")) - 1;

    struct StorageData {
        ISSVNetworkCore.Network network;
        ISSVNetworkCore.DAO dao;
        IERC20 token;

        Counters.Counter lastOperatorId;

        uint32 validatorsPerOperatorLimit;
        uint64 minimumBlocksBeforeLiquidation;
        uint64 minimumLiquidationCollateral;
        
        mapping(bytes32 => address) ssvContracts;
        mapping(bytes32 => uint64) operatorsPKs;
        mapping(uint64 => ISSVNetworkCore.Operator) operators;
        mapping(uint64 => address) operatorsWhitelist;
        mapping(bytes32 => ISSVNetworkCore.Validator) validatorPKs;
        mapping(bytes32 => bytes32) clusters;
    }

    function getStorage() internal pure returns (StorageData storage sd) {
        uint256 position = SSV_STORAGE_POSITION;
        assembly {
            sd.slot := position
        }
    }
}
