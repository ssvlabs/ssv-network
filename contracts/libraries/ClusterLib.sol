// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../interfaces/ISSVNetworkCore.sol";
import {StorageData} from "./SSVStorage.sol";
import {StorageProtocol} from "./SSVStorageProtocol.sol";
import {DEFAULT_EB_PER_VALIDATOR, SSVStorageEB, StorageEB, VUNITS_PRECISION} from "./SSVStorageEB.sol";
import "./OperatorLib.sol";
import "./ProtocolLib.sol";
import {Types64} from "./Types.sol";
import "./CoreLib.sol";

library ClusterLib {
    using Types64 for uint64;
    using ProtocolLib for StorageProtocol;

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

    function isLiquidatableWithEB(
        ISSVNetworkCore.Cluster memory cluster,
        bytes32 clusterId,
        uint64 burnRate,
        uint64 networkFee,
        uint64 minimumBlocksBeforeLiquidation,
        uint64 minimumLiquidationCollateral
    ) internal view returns (bool liquidatable) {
        if (cluster.validatorCount == 0) return false;
        if (cluster.balance < minimumLiquidationCollateral.expand()) return true;

        uint64 vUnits = getVUnits(clusterId, cluster.validatorCount);
        uint128 units = vUnits;
        uint128 rate = burnRate + networkFee;
        uint128 thresholdUnits = (uint128(minimumBlocksBeforeLiquidation) * rate * units) / VUNITS_PRECISION;

        uint64 liquidationThreshold = uint64(thresholdUnits);
        return cluster.balance < liquidationThreshold.expand();
    }

    function isLiquidatableWithVUnits(
        ISSVNetworkCore.Cluster memory cluster,
        uint64 vUnits,
        uint64 burnRate,
        uint64 networkFee,
        uint64 minimumBlocksBeforeLiquidation,
        uint64 minimumLiquidationCollateral
    ) internal pure returns (bool liquidatable) {
        if (cluster.validatorCount == 0) return false;
        if (cluster.balance < minimumLiquidationCollateral.expand()) return true;

        uint128 units = vUnits;
        uint128 rate = burnRate + networkFee;
        uint128 thresholdUnits = (uint128(minimumBlocksBeforeLiquidation) * rate * units) / VUNITS_PRECISION;

        uint64 liquidationThreshold = uint64(thresholdUnits);
        return cluster.balance < liquidationThreshold.expand();
    }

    function validateClusterIsNotLiquidated(ISSVNetworkCore.Cluster memory cluster) internal pure {
        if (!cluster.active) revert ISSVNetworkCore.ClusterIsLiquidated();
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
        address owner,
        uint64[] memory operatorIds,
        StorageData storage s
    ) internal view returns (bytes32 hashedCluster) {
        hashedCluster = keccak256(abi.encodePacked(owner, operatorIds));

        bytes32 clusterData = s.ethClusters[hashedCluster];
        bytes32 clusterDataSSV = s.clusters[hashedCluster];

        if (clusterData == bytes32(0) && clusterDataSSV!= bytes32(0)) {
            revert ISSVNetworkCore.IncorrectClusterVersion();
        }

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
        }
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
            isLiquidatableWithEB(
                cluster,
                hashedCluster,
                burnRate,
                sp.ethNetworkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            )
        ) {
            revert ISSVNetworkCore.InsufficientBalance();
        }

        s.ethClusters[hashedCluster] = hashClusterData(cluster);
    }

    function getVUnits(bytes32 clusterId, uint32 validatorCount) internal view returns (uint64) {
        StorageEB storage seb = SSVStorageEB.load();
        uint64 vUnits = seb.clusterEB[clusterId].vUnits;

        if (vUnits == 0) {
            // Before any EB is set for this cluster, approximate EB as 32 ETH per validator.
            // To preserve legacy accounting, we treat each validator as 1 logical vUnit (32 ETH),
            // scaled by VUNITS_PRECISION for fixed-point arithmetic.
            return uint64(validatorCount) * VUNITS_PRECISION;
        }

        return vUnits;
    }

    function updateBalanceWithEB(
        ISSVNetworkCore.Cluster memory cluster,
        bytes32 clusterId,
        uint64 newIndex,
        uint64 currentNetworkFeeIndex
    ) internal view {
        uint64 vUnits = getVUnits(clusterId, cluster.validatorCount);
        uint128 units = vUnits;
        uint128 idxNet = currentNetworkFeeIndex - cluster.networkFeeIndex;
        uint128 idxOp = newIndex - cluster.index;

        uint128 networkFeeUnits = (idxNet * units) / VUNITS_PRECISION;
        uint128 usageUnits = (idxOp * units) / VUNITS_PRECISION + networkFeeUnits;

        uint64 usage = uint64(usageUnits);
        cluster.balance = usage.expand() > cluster.balance ? 0 : cluster.balance - usage.expand();
    }

    function validateClusterVersion(uint8 clusterVersion, uint8 expectedVersion) internal pure {
        if (clusterVersion != expectedVersion) revert ISSVNetworkCore.IncorrectClusterVersion();
    }

    function getClusterData(
        bytes32 hashedCluster,
        StorageData storage s
    ) internal view returns (bytes32 clusterData, uint8 version) {
        clusterData = s.ethClusters[hashedCluster];
        if (clusterData != bytes32(0)) {
            return (clusterData, CoreLib.VERSION_ETH);
        }

        clusterData = s.clusters[hashedCluster];
        if (clusterData != bytes32(0)) {
            return (clusterData, CoreLib.VERSION_SSV);
        }

        revert ISSVNetworkCore.ClusterDoesNotExists();
    }

    /// @notice Convert effective balance to vUnits using ceiling division (write path)
    /// @param effectiveBalance The effective balance in ETH
    /// @return vUnits value with VUNITS_PRECISION scaling
    function ebToVUnits(uint32 effectiveBalance) internal pure returns (uint64) {
        uint256 vUnits = uint256(effectiveBalance) * VUNITS_PRECISION;
        uint256 vUnitsPerValidator = DEFAULT_EB_PER_VALIDATOR / 1 ether;
        
        return uint64(vUnits == 0 ? 0 : (vUnits - 1) / vUnitsPerValidator + 1);
    }

    /// @notice Convert vUnits to effective balance using floor division (read path)
    /// @param vUnits The vUnits value with VUNITS_PRECISION scaling
    /// @return effectiveBalance in ETH
    function vUnitsToEB(uint64 vUnits) internal pure returns (uint32) {
        return uint32((uint256(vUnits) * (DEFAULT_EB_PER_VALIDATOR / 1 ether)) / VUNITS_PRECISION);
    }
}
