// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../interfaces/ISSVNetworkCore.sol";
import {StorageData} from "./SSVStorage.sol";
import {StorageProtocol} from "./SSVStorageProtocol.sol";
import "./OperatorLib.sol";
import "./ProtocolLib.sol";
import {Types64} from "./Types.sol";

library ClusterLib {
    using Types64 for uint64;
    using ProtocolLib for StorageProtocol;

    uint8 internal constant _CLUSTER_VERSION_SSV = 0;
    uint8 internal constant _CLUSTER_VERSION_ETH = 1;
    uint8 internal constant _CLUSTER_VERSION_UNDEFINED = type(uint8).max;

    function clusterVersionSSV() internal pure returns (uint8) {
        return _CLUSTER_VERSION_SSV;
    }

    function clusterVersionETH() internal pure returns (uint8) {
        return _CLUSTER_VERSION_ETH;
    }

    function updateBalance(
        ISSVNetworkCore.Cluster memory cluster,
        uint64 newIndex,
        uint64 currentNetworkFeeIndex
    ) internal pure {
        uint64 networkFee = uint64(currentNetworkFeeIndex - cluster.networkFeeIndex) * cluster.validatorCount;
        uint64 usage = (newIndex - cluster.index) * cluster.validatorCount + networkFee;
        cluster.balance = usage.expand() > cluster.balance ? 0 : cluster.balance - usage.expand();
    }

    function isLiquidatable(
        ISSVNetworkCore.Cluster memory cluster,
        uint64 burnRate,
        uint64 networkFee,
        uint64 minimumBlocksBeforeLiquidation,
        uint64 minimumLiquidationCollateral
    ) internal pure returns (bool liquidatable) {
        if (cluster.validatorCount != 0) {
            if (cluster.balance < minimumLiquidationCollateral.expand()) return true;
            uint64 liquidationThreshold = minimumBlocksBeforeLiquidation *
                (burnRate + networkFee) *
                cluster.validatorCount;

            return cluster.balance < liquidationThreshold.expand();
        }
    }

    function validateClusterIsNotLiquidated(ISSVNetworkCore.Cluster memory cluster) internal pure {
        if (!cluster.active) revert ISSVNetworkCore.ClusterIsLiquidated();
    }

    function validateClusterVersion(uint8 clusterVersion, uint8 expectedVersion) internal pure {
        if (clusterVersion != expectedVersion) revert ISSVNetworkCore.IncorrectClusterVersion();
    }

    function validateHashedCluster(
        ISSVNetworkCore.Cluster memory cluster,
        address owner,
        uint64[] memory operatorIds,
        StorageData storage s
    ) internal view returns (bytes32 hashedCluster, uint8 version) {
        hashedCluster = keccak256(abi.encodePacked(owner, operatorIds));
        bytes32 hashedClusterData = hashClusterData(cluster);

        (bytes32 clusterData, uint8 detectedVersion) = getClusterData(hashedCluster, s);
        if (clusterData == bytes32(0)) {
            revert ISSVNetworkCore.ClusterDoesNotExists();
        } else if (clusterData != hashedClusterData) {
            revert ISSVNetworkCore.IncorrectClusterState();
        }

        return (hashedCluster, detectedVersion);
    }

    function updateClusterData(
        ISSVNetworkCore.Cluster memory cluster,
        uint64 clusterIndex,
        uint64 currentNetworkFeeIndex
    ) internal pure {
        updateBalance(cluster, clusterIndex, currentNetworkFeeIndex);
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = currentNetworkFeeIndex;
    }

    function hashClusterData(ISSVNetworkCore.Cluster memory cluster) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    cluster.validatorCount,
                    cluster.networkFeeIndex,
                    cluster.index,
                    cluster.balance,
                    cluster.active
                )
            );
    }

    function validateClusterOnRegistration(
        ISSVNetworkCore.Cluster memory cluster,
        uint64[] memory operatorIds,
        StorageData storage s
    ) internal view returns (bytes32 hashedCluster) {
        hashedCluster = keccak256(abi.encodePacked(msg.sender, operatorIds));

        (bytes32 clusterData, uint8 detectedVersion) = getClusterData(hashedCluster, s);
        if (clusterData == bytes32(0)) {
            if (
                cluster.validatorCount != 0 ||
                cluster.networkFeeIndex != 0 ||
                cluster.index != 0 ||
                cluster.balance != 0 ||
                !cluster.active
            ) {
                revert ISSVNetworkCore.IncorrectClusterState();
            }
        } else if (clusterData != hashClusterData(cluster)) {
            revert ISSVNetworkCore.IncorrectClusterState();
        } else {
            validateClusterIsNotLiquidated(cluster);
            validateClusterVersion(detectedVersion, _CLUSTER_VERSION_ETH);
        }

        return hashedCluster;
    }

    function updateClusterOnRegistration(
        ISSVNetworkCore.Cluster memory cluster,
        uint64[] memory operatorIds,
        bytes32 hashedCluster,
        uint32 validatorCountDelta,
        StorageData storage s,
        StorageProtocol storage sp
    ) internal {
        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateClusterOperatorsOnRegistration(
            operatorIds,
            validatorCountDelta,
            s,
            sp
        );

        updateClusterData(cluster, clusterIndex, sp.currentNetworkFeeIndex());

        sp.updateDAO(true, validatorCountDelta);

        cluster.validatorCount += validatorCountDelta;

        if (
            isLiquidatable(
                cluster,
                burnRate,
                sp.networkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            )
        ) {
            revert ISSVNetworkCore.InsufficientBalance();
        }
            s.ethClusters[hashedCluster] = hashClusterData(cluster);
    }

    function getClusterData(
        bytes32 hashedCluster,
        StorageData storage s
    ) internal view returns (bytes32 clusterData, uint8 version) {
        clusterData = s.clusters[hashedCluster];
        if (clusterData != bytes32(0)) {
            return (clusterData, _CLUSTER_VERSION_SSV);
        }

        clusterData = s.ethClusters[hashedCluster];
        if (clusterData != bytes32(0)) {
            return (clusterData, _CLUSTER_VERSION_ETH);
        }

        revert ISSVNetworkCore.ClusterDoesNotExists();
    }
}
