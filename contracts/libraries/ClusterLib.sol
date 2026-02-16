// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../interfaces/ISSVNetworkCore.sol";
import {StorageData} from "./storage/SSVStorage.sol";
import {StorageProtocol} from "./storage/SSVStorageProtocol.sol";
import {DEFAULT_EB_PER_VALIDATOR, SSVStorageEB, StorageEB, VUNITS_PRECISION} from "./storage/SSVStorageEB.sol";
import "./OperatorLib.sol";
import "./ProtocolLib.sol";
import {PackedSSV, PackedETH, VERSION_SSV, VERSION_ETH} from "../libraries/SSVCoreTypes.sol";
import {PackedSSVLib, PackedETHLib, ETH_DEDUCTED_DIGITS} from "../libraries/SSVPackedLib.sol";

/**
 * @title SSV Cluster Library
 * @author SSV Labs
 * @notice Library functions for managing SSV clusters including balance updates, liquidation checks, validations and data operations
 */
library ClusterLib {
    using ProtocolLib for StorageProtocol;

    function updateBalanceSSV(
        ISSVNetworkCore.Cluster memory cluster,
        uint64 newIndex,
        uint64 currentNetworkFeeIndex
    ) internal pure {
        uint64 networkFee = uint64(currentNetworkFeeIndex - cluster.networkFeeIndex) * cluster.validatorCount;
        PackedSSV usage = PackedSSV.wrap((newIndex - cluster.index) * cluster.validatorCount + networkFee);
        cluster.balance = PackedSSVLib.unpack(usage) > cluster.balance ? 0 : cluster.balance - PackedSSVLib.unpack(usage);
    }

    /**
     * @notice Checks if cluster is liquidatable based on balance thresholds
     * @param cluster Cluster data
     * @param burnRate Cluster burn rate
     * @param networkFee Network fee
     * @param minimumBlocksBeforeLiquidation Minimum blocks before liquidation
     * @param minimumLiquidationCollateral Minimum collateral for liquidation
     * @return liquidatable True if cluster can be liquidated
     */
    function isLiquidatable(
        ISSVNetworkCore.Cluster memory cluster,
        uint64 burnRate,
        uint64 networkFee,
        uint64 minimumBlocksBeforeLiquidation,
        PackedSSV minimumLiquidationCollateral
    ) internal pure returns (bool liquidatable) {
        if (cluster.validatorCount != 0) {
            if (cluster.balance < PackedSSVLib.unpack(minimumLiquidationCollateral)) return true;
            uint64 liquidationThreshold = minimumBlocksBeforeLiquidation *
                (burnRate + networkFee) *
                cluster.validatorCount;

            return cluster.balance < PackedSSVLib.unpack(PackedSSV.wrap(liquidationThreshold));
        }
    }

    /**
     * @notice Checks if cluster is liquidatable using effective balance
     * @param cluster Cluster data
     * @param clusterId Cluster ID
     * @param burnRate Cluster burn rate
     * @param networkFee Network fee
     * @param minimumBlocksBeforeLiquidation Minimum blocks before liquidation
     * @param minimumLiquidationCollateral Minimum collateral for liquidation
     * @return liquidatable True if cluster can be liquidated
     */
    function isLiquidatableWithEB(
        ISSVNetworkCore.Cluster memory cluster,
        bytes32 clusterId,
        uint64 burnRate,
        uint64 networkFee,
        uint64 minimumBlocksBeforeLiquidation,
        PackedETH minimumLiquidationCollateral
    ) internal view returns (bool liquidatable) {
        if (cluster.validatorCount == 0) return false;
        if (cluster.balance < PackedETHLib.unpack(minimumLiquidationCollateral)) return true;

        uint64 vUnits = getVUnits(clusterId, cluster.validatorCount);
        uint128 units = vUnits;
        uint128 rate = burnRate + networkFee;
        uint256 thresholdUnits = (uint256(minimumBlocksBeforeLiquidation) * rate * units) / VUNITS_PRECISION;
        uint256 liquidationThreshold = thresholdUnits * ETH_DEDUCTED_DIGITS;
        return cluster.balance < liquidationThreshold;
    }

    /**
     * @notice Checks if cluster is liquidatable using provided vUnits
     * @param cluster Cluster data
     * @param vUnits cluster VUnits
     * @param burnRate Cluster burn rate
     * @param networkFee Network fee
     * @param minimumBlocksBeforeLiquidation Minimum blocks before liquidation
     * @param minimumLiquidationCollateral Minimum collateral for liquidation
     * @return liquidatable True if cluster can be liquidated
     */
    function isLiquidatableWithVUnits(
        ISSVNetworkCore.Cluster memory cluster,
        uint64 vUnits,
        uint64 burnRate,
        uint64 networkFee,
        uint64 minimumBlocksBeforeLiquidation,
        PackedETH minimumLiquidationCollateral
    ) internal pure returns (bool liquidatable) {
        if (cluster.validatorCount == 0) return false;
        if (cluster.balance < PackedETHLib.unpack(minimumLiquidationCollateral)) return true;

        uint128 units = vUnits;
        uint128 rate = burnRate + networkFee;
        uint256 thresholdUnits = (uint256(minimumBlocksBeforeLiquidation) * rate * units) / VUNITS_PRECISION;
        uint256 liquidationThreshold = thresholdUnits * ETH_DEDUCTED_DIGITS;
        return cluster.balance < liquidationThreshold;
    }

    /**
     * @notice Validates that cluster is not liquidated
     * @param cluster Cluster data
     */
    function validateClusterIsNotLiquidated(ISSVNetworkCore.Cluster memory cluster) internal pure {
        if (!cluster.active) revert ISSVNetworkCore.ClusterIsLiquidated();
    }

    /**
     * @notice Validates and hashes cluster data
     * @param cluster Cluster data
     * @param owner Cluster owner
     * @param operatorIds Operator IDs
     * @param s Storage data
     * @return hashedCluster Hashed cluster ID
     * @return version Cluster version
     */
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
            revert ISSVNetworkCore.ClusterDoesNotExist();
        } else if (clusterData != hashedClusterData) {
            revert ISSVNetworkCore.IncorrectClusterState();
        }

        return (hashedCluster, detectedVersion);
    }

    /**
     * @notice Updates ETH cluster data with new indexes
     * @param cluster Cluster data
     * @param clusterIndex New cluster index
     * @param currentNetworkFeeIndex Current network fee index
     */
    function updateClusterData(
        ISSVNetworkCore.Cluster memory cluster,
        bytes32 hashedCluster,
        uint64 clusterIndex,
        uint64 currentNetworkFeeIndex
    ) internal view {
        updateBalanceWithEB(cluster, hashedCluster, clusterIndex, currentNetworkFeeIndex);
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = currentNetworkFeeIndex;
    }

    /**
     * @notice Hashes cluster data
     * @param cluster Cluster data
     * @return Hashed cluster data
     */
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

    /**
     * @notice Validates cluster state for registration
     * @param cluster Cluster data
     * @param owner Cluster owner
     * @param operatorIds Operator IDs
     * @param s Storage data
     * @return hashedCluster Hashed cluster ID
     */
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

    /**
     * @notice Updates cluster on registration
     * @param cluster Cluster data
     * @param operatorIds Operator IDs
     * @param hashedCluster Hashed cluster ID
     * @param validatorCountDelta Change in validator count
     * @param s Storage data
     * @param sp Storage protocol
     */
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

        updateClusterData(cluster, hashedCluster, clusterIndex, sp.currentNetworkFeeIndex());

        sp.updateDAO(true, validatorCountDelta);

        cluster.validatorCount += validatorCountDelta;

        if (
            isLiquidatableWithEB(
                cluster,
                hashedCluster,
                burnRate,
                PackedETH.unwrap(sp.ethNetworkFee),
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            )
        ) {
            revert ISSVNetworkCore.InsufficientBalance();
        }

        s.ethClusters[hashedCluster] = hashClusterData(cluster);
    }

    /**
     * @notice Gets VUnits for cluster
     * @param clusterId Cluster ID
     * @param validatorCount Validator count
     * @return vUnits cluster VUnits
     */
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

    /**
     * @notice Updates cluster balance using effective balance
     * @param cluster Cluster data
     * @param clusterId Cluster ID
     * @param newIndex New operator index
     * @param currentNetworkFeeIndex Current network fee index
     */
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
        uint256 usage = uint256(usageUnits) * ETH_DEDUCTED_DIGITS;
        cluster.balance = usage > cluster.balance ? 0 : cluster.balance - usage;
    }

    /**
     * @notice Validates cluster version and throws error if version is not the expected one
     * @param clusterVersion Detected version
     * @param expectedVersion Expected version
     */
    function validateClusterVersion(uint8 clusterVersion, uint8 expectedVersion) internal pure {
        if (clusterVersion != expectedVersion) revert ISSVNetworkCore.IncorrectClusterVersion();
    }

    /**
     * @notice Gets cluster data from storage
     * @param hashedCluster Hashed cluster ID
     * @param s Storage data
     * @return clusterData Hashed cluster data
     * @return version Cluster version
     */
    function getClusterData(
        bytes32 hashedCluster,
        StorageData storage s
    ) internal view returns (bytes32 clusterData, uint8 version) {
        clusterData = s.ethClusters[hashedCluster];
        if (clusterData != bytes32(0)) {
            return (clusterData, VERSION_ETH);
        }

        clusterData = s.clusters[hashedCluster];
        if (clusterData != bytes32(0)) {
            return (clusterData, VERSION_SSV);
        }

        revert ISSVNetworkCore.ClusterDoesNotExist();
    }

    /**
     * @notice Converts effective balance to v units using ceiling division
     * @param effectiveBalance Effective balance in ETH
     * @return vUnits v units scaled by precision
     */
    function ebToVUnits(uint32 effectiveBalance) internal pure returns (uint64) {
        uint256 vUnits = uint256(effectiveBalance) * VUNITS_PRECISION;
        uint256 vUnitsPerValidator = DEFAULT_EB_PER_VALIDATOR / 1 ether;
        
        return uint64(vUnits == 0 ? 0 : (vUnits - 1) / vUnitsPerValidator + 1);
    }

    /**
     * @notice Converts v units to effective balance using floor division
     * @param vUnits v units scaled by precision
     * @return effectiveBalance Effective balance in ETH
     */
    function vUnitsToEB(uint64 vUnits) internal pure returns (uint32) {
        return uint32((uint256(vUnits) * (DEFAULT_EB_PER_VALIDATOR / 1 ether)) / VUNITS_PRECISION);
    }
}