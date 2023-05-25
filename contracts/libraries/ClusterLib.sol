// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "hardhat/console.sol";

import "../interfaces/ISSVNetworkCore.sol";
import "./NetworkLib.sol";
import "./SSVStorage.sol";
import "./Types.sol";

library ClusterLib {
    using Types64 for uint64;

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
    ) internal view returns (bool) {
        console.log("burnRate", burnRate);
        console.log("networkFee", networkFee);
        console.log("minimumBlocksBeforeLiquidation", minimumBlocksBeforeLiquidation);
        console.log("minimumLiquidationCollateral", minimumLiquidationCollateral.expand());

        console.log("cluster.balance", cluster.balance);

        if (cluster.balance < minimumLiquidationCollateral.expand()) return true;

        uint64 liquidationThreshold = minimumBlocksBeforeLiquidation * (burnRate + networkFee) * cluster.validatorCount;
        console.log("liquidationThreshold", liquidationThreshold.expand());

        return cluster.balance < liquidationThreshold.expand();
    }

    function validateClusterIsNotLiquidated(ISSVNetworkCore.Cluster memory cluster) internal pure {
        if (!cluster.active) revert ISSVNetworkCore.ClusterIsLiquidated();
    }

    function validateHashedCluster(
        ISSVNetworkCore.Cluster memory cluster,
        address owner,
        uint64[] memory operatorIds
    ) internal view returns (bytes32) {
        bytes32 hashedCluster = keccak256(abi.encodePacked(owner, operatorIds));
        bytes32 hashedClusterData = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
            )
        );

        bytes32 clusterData = SSVStorage.load().clusters[hashedCluster];
        if (clusterData == bytes32(0)) {
            revert ISSVNetworkCore.ClusterDoesNotExists();
        } else if (clusterData != hashedClusterData) {
            revert ISSVNetworkCore.IncorrectClusterState();
        }

        return hashedCluster;
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

    // Views
    function isLiquidatable(
        address owner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) internal view returns (bool) {
        validateHashedCluster(cluster, owner, operatorIds);

        if (!cluster.active) {
            return false;
        }

        uint64 clusterIndex;
        uint64 burnRate;
        uint operatorsLength = operatorIds.length;
        for (uint i; i < operatorsLength; ++i) {
            ISSVNetworkCore.Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
            clusterIndex += operator.snapshot.index + (uint64(block.number) - operator.snapshot.block) * operator.fee;
            burnRate += operator.fee;
        }

        ISSVNetworkCore.Network memory network = SSVStorage.load().network;

        updateBalance(cluster, clusterIndex, NetworkLib.currentNetworkFeeIndex(network));
        return
            isLiquidatable(
                cluster,
                burnRate,
                network.networkFee,
                SSVStorage.load().minimumBlocksBeforeLiquidation,
                SSVStorage.load().minimumLiquidationCollateral
            );
    }
}
