// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "../ISSVNetworkCore.sol";
import "../SSVNetwork.sol";
import "./Types.sol";

library ClusterLib {
    using Types64 for uint64;

    function clusterBalance(
        ISSVNetworkCore.Cluster memory cluster,
        uint64 newIndex,
        uint64 currentNetworkFeeIndex
    ) internal pure returns (uint256 balance) {
        uint64 networkFee = uint64(
            currentNetworkFeeIndex - cluster.networkFeeIndex
        ) * cluster.validatorCount;
        uint64 usage = (newIndex - cluster.index) *
            cluster.validatorCount +
            networkFee;

        if (usage.expand() > cluster.balance) {
            revert ISSVNetworkCore.InsufficientFunds();
        }

        balance = cluster.balance - usage.expand();
    }

    function liquidatable(
        ISSVNetworkCore.Cluster memory cluster,
        uint64 burnRate,
        uint64 networkFee,
        uint64 minimumBlocksBeforeLiquidation
    ) internal pure returns (bool) {
        uint64 liquidationThreshold = minimumBlocksBeforeLiquidation *
            (burnRate + networkFee) *
            cluster.validatorCount;
        return cluster.balance < liquidationThreshold.expand();
    }

    function validateClusterIsNotLiquidated(
        ISSVNetworkCore.Cluster memory cluster
    ) internal pure {
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

    function updateClusterData(
        ISSVNetworkCore.Cluster memory cluster,
        uint64 clusterIndex,
        uint64 currentNetworkFeeIndex
    ) internal pure {
        cluster.balance = clusterBalance(
            cluster,
            clusterIndex,
            currentNetworkFeeIndex
        );
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = currentNetworkFeeIndex;
    }
}
