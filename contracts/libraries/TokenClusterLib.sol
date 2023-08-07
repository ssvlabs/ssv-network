// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/ISSVNetworkCore.sol";
import "./SSVStorage.sol";
import "./Types.sol";

library TokenClusterLib {
    using Types64 for uint64;

    function updateBalance(
        ISSVNetworkCore.TokenCluster memory cluster,
        uint64 newIndex,
        uint64 currentNetworkFeeIndex
    ) internal pure {
        uint64 networkUsage = uint64(currentNetworkFeeIndex - cluster.base.networkFeeIndex) * cluster.base.validatorCount;
        uint64 operatorsUsage = (newIndex - cluster.base.index) * cluster.base.validatorCount;

        cluster.base.ssvBalance = networkUsage.expand() > cluster.base.ssvBalance
            ? 0
            : cluster.base.ssvBalance - networkUsage.expand();
        cluster.tokenBalance = operatorsUsage.expand() > cluster.tokenBalance
            ? 0
            : cluster.tokenBalance - operatorsUsage.expand();
    }

    function isLiquidatable(
        ISSVNetworkCore.TokenCluster memory cluster,
        uint64 burnRate,
        uint64 networkFee,
        uint64 minimumBlocksBeforeLiquidation,
        uint64 minimumLiquidationCollateral
    ) internal pure returns (bool) {
        if (cluster.tokenBalance < minimumLiquidationCollateral.expand()) return true; // think about this

        uint64 operatorsLiquidationThreshold = minimumBlocksBeforeLiquidation * burnRate * cluster.base.validatorCount;
        uint64 networkLiquidationThreshold = minimumBlocksBeforeLiquidation * networkFee * cluster.base.validatorCount;

        return
            cluster.base.ssvBalance < networkLiquidationThreshold.expand() ||
            cluster.tokenBalance < operatorsLiquidationThreshold.expand();
    }

    function validateClusterIsNotLiquidated(ISSVNetworkCore.TokenCluster memory cluster) internal pure {
        if (!cluster.base.active) revert ISSVNetworkCore.ClusterIsLiquidated();
    }

    function validateHashedCluster(
        ISSVNetworkCore.TokenCluster memory cluster,
        address owner,
        uint64[] memory operatorIds,
        StorageData storage s
    ) internal view returns (bytes32) {
        bytes32 hashedCluster = keccak256(abi.encodePacked(owner, operatorIds));
        bytes32 hashedClusterData = hashClusterData(cluster);

        bytes32 clusterData = s.clusters[hashedCluster];
        if (clusterData == bytes32(0)) {
            revert ISSVNetworkCore.ClusterDoesNotExists();
        } else if (clusterData != hashedClusterData) {
            revert ISSVNetworkCore.IncorrectClusterState();
        }

        return hashedCluster;
    }

    function updateClusterData(
        ISSVNetworkCore.TokenCluster memory cluster,
        uint64 clusterIndex,
        uint64 currentNetworkFeeIndex
    ) internal pure {
        updateBalance(cluster, clusterIndex, currentNetworkFeeIndex);
        cluster.base.index = clusterIndex;
        cluster.base.networkFeeIndex = currentNetworkFeeIndex;
    }

    function hashClusterData(ISSVNetworkCore.TokenCluster memory cluster) internal pure returns (bytes32) {
        return keccak256(abi.encode(cluster.base, cluster.tokenBalance, cluster.tokenAddress));
    }
}
