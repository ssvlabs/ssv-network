// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../ISSVNetworkCore.sol";
import "../SSVNetwork.sol";
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
    ) internal pure returns (bool) {
        if (cluster.balance < minimumLiquidationCollateral.expand()) return true;

        uint64 liquidationThreshold = minimumBlocksBeforeLiquidation * (burnRate + networkFee) * cluster.validatorCount;
        return cluster.balance < liquidationThreshold.expand();
    }

    function validateClusterIsNotLiquidated(ISSVNetworkCore.Cluster memory cluster) internal pure {
        if (!cluster.active) revert ISSVNetworkCore.ClusterIsLiquidated();
    }

    function validateHashedCluster(
        ISSVNetworkCore.Cluster memory cluster,
        address owner,
        uint64[] memory operatorIds,
        SSVNetwork ssvNetwork
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

        if (ssvNetwork.clusters(hashedCluster) == bytes32(0)) {
            revert ISSVNetworkCore.ClusterDoesNotExists();
        } else if (ssvNetwork.clusters(hashedCluster) != hashedClusterData) {
            revert ISSVNetworkCore.IncorrectClusterState();
        }

        return hashedCluster;
    }

    function bulkValidateHashedCluster(
        ISSVNetworkCore.Liquidation[] memory liquidations,
        SSVNetwork ssvNetwork
    ) internal view returns (bytes32[] memory hashedClusters) {
        hashedClusters = new bytes32[](liquidations.length);

        for (uint i; i < liquidations.length; ++i) {
            ISSVNetworkCore.Liquidation memory liquidation = liquidations[i];
            ISSVNetworkCore.Cluster memory cluster = liquidation.cluster;

            bytes32 hashedCluster = keccak256(abi.encodePacked(liquidation.owner, liquidation.operatorIds));
            bytes32 hashedClusterData = keccak256(
                abi.encodePacked(
                    cluster.validatorCount,
                    cluster.networkFeeIndex,
                    cluster.index,
                    cluster.balance,
                    cluster.active
                )
            );
            if (ssvNetwork.clusters(hashedCluster) != hashedClusterData) {
                revert ISSVNetworkCore.IncorrectClusterState();
            } else if (!cluster.active) revert ISSVNetworkCore.ClusterIsLiquidated();

            hashedClusters[i] = hashedCluster;
        }
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

    function liquidate(
        ISSVNetworkCore.Cluster memory cluster,
        address owner,
        uint64 burnRate,
        uint64 clusterIndex,
        uint64 networkFee,
        uint64 networkFeeIndex,
        uint64 minimumBlocksBeforeLiquidation,
        uint64 minimumLiquidationCollateral
    ) internal view returns (uint256 balanceLiquidatable) {
        updateBalance(cluster, clusterIndex, networkFeeIndex);

        if (
            owner != msg.sender &&
            !isLiquidatable(cluster, burnRate, networkFee, minimumBlocksBeforeLiquidation, minimumLiquidationCollateral)
        ) revert ISSVNetworkCore.ClusterNotLiquidatable();

        if (cluster.balance != 0) {
            balanceLiquidatable = cluster.balance;
            cluster.balance = 0;
        }
        cluster.index = 0;
        cluster.networkFeeIndex = 0;
        cluster.active = false;
    }
}
