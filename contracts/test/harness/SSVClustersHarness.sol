// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import { SSVClusters } from "../../modules/SSVClusters.sol";
import {ISSVNetworkCore} from "../../interfaces/ISSVNetworkCore.sol";
import {SSVStorage, StorageData} from "../../libraries/SSVStorage.sol";
import {SSVStorageProtocol, StorageProtocol} from "../../libraries/SSVStorageProtocol.sol";
import {SSVStorageEB, StorageEB} from "../../libraries/SSVStorageEB.sol";
import {Types256} from "../../libraries/Types.sol";

import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";

contract SSVClustersHarness is SSVClusters {
    using Counters for Counters.Counter;
    using Types256 for uint256;

    function mockOperator(
        bytes calldata publicKey,
        address owner,
        uint256 fee,
        bool setPrivate
    ) external returns (uint64 id) {
        StorageData storage s = SSVStorage.load();

        s.lastOperatorId.increment();
        id = uint64(s.lastOperatorId.current());

        s.operators[id] = ISSVNetworkCore.Operator({
            validatorCount: 0,
            fee: 0,
            owner: owner,
            snapshot: ISSVNetworkCore.Snapshot({
            block: uint32(block.number),
            index: 0,
            balance: 0
        }),
            whitelisted: setPrivate,
            ethValidatorCount: 0,
            ethFee: fee.shrink(),
            ethSnapshot: ISSVNetworkCore.Snapshot({
            block: uint32(block.number),
            index: 0,
            balance: 0
        })
        });

        s.operatorsPKs[keccak256(publicKey)] = id;
    }

    function mockValidatorsPerOperatorLimit(uint32 limit) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.validatorsPerOperatorLimit = limit;
    }

    function mockCurrentNetworkFeeIndex(uint64 index) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.ethNetworkFeeIndex = index;
    }

    function getCurrentNetworkFeeIndex() external view returns (uint64) {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        return sp.ethNetworkFeeIndex;
    }

    function getOperatorEthFee(uint64 operatorId) external view returns (uint64) {
        return SSVStorage.load().operators[operatorId].ethFee;
    }

    function getClusterVUnits(bytes32 clusterId) external view returns (uint64) {
        StorageEB storage seb = SSVStorageEB.load();
        return seb.clusterEB[clusterId].vUnits;
    }

    function getValidatorData(bytes calldata publicKey, address owner) external view returns (bytes32) {
        bytes32 hashedValidator = keccak256(abi.encodePacked(publicKey, owner));
        return SSVStorage.load().validatorPKs[hashedValidator];
    }

    function getClusterHash(bytes32 hashedCluster) external view returns (bytes32) {
        return SSVStorage.load().ethClusters[hashedCluster];
    }

    function getOperatorEthValidatorCount(uint64 operatorId) external view returns (uint32) {
        return SSVStorage.load().operators[operatorId].ethValidatorCount;
    }

    function getOperatorEthSnapshot(uint64 operatorId) external view returns (uint64 index, uint32 blockNumber, uint64 balance) {
        ISSVNetworkCore.Snapshot storage snap = SSVStorage.load().operators[operatorId].ethSnapshot;
        return (snap.index, snap.block, snap.balance);
    }

    function getDaoEthValidatorCount() external view returns (uint32) {
        return SSVStorageProtocol.load().ethDaoValidatorCount;
    }

    function getDaoEthBalance() external view returns (uint64) {
        return SSVStorageProtocol.load().ethDaoBalance;
    }

    function getDaoEthIndexBlockNumber() external view returns (uint32) {
        return SSVStorageProtocol.load().ethDaoIndexBlockNumber;
    }

    function getOperatorEthVUnits(uint64 operatorId) external view returns (uint64) {
        return SSVStorageEB.load().operatorEthVUnits[operatorId];
    }

    function mockEthNetworkFee(uint64 fee) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.ethNetworkFee = fee;
    }

    function mockMinimumBlocksBeforeLiquidation(uint64 blocks) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.minimumBlocksBeforeLiquidation = blocks;
    }

    function mockMinimumLiquidationCollateral(uint64 collateral) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.minimumLiquidationCollateral = collateral;
    }

    function mockSetClusterVUnits(bytes32 clusterId, uint64 vUnits) external {
        StorageEB storage seb = SSVStorageEB.load();
        seb.clusterEB[clusterId].vUnits = vUnits;
    }

    function mockSetClusterLiquidated(address owner, uint64[] calldata operatorIds) external {
        StorageData storage s = SSVStorage.load();
        bytes32 hashedCluster = keccak256(abi.encodePacked(owner, operatorIds));
        s.ethClusters[hashedCluster] = keccak256(abi.encodePacked(uint32(0), uint64(0), uint64(0), uint256(0), false));
    }
}