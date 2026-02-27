// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ISSVClusters} from "../interfaces/ISSVClusters.sol";
import "../libraries/ClusterLib.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/ProtocolLib.sol";
import "../libraries/CoreLib.sol";
import "../libraries/ValidatorLib.sol";
import {PackedETH, VERSION_ETH, VERSION_SSV} from "../libraries/SSVCoreTypes.sol";
import {ETH_DEDUCTED_DIGITS} from "../libraries/SSVPackedLib.sol";
import {SSVStorage, StorageData} from "../libraries/storage/SSVStorage.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/storage/SSVStorageProtocol.sol";
import {
    SSVStorageEB,
    StorageEB,
    ClusterEBSnapshot,
    VUNITS_PRECISION,
    MAX_EB_PER_VALIDATOR
} from "../libraries/storage/SSVStorageEB.sol";


import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {SSVReentrancyGuard} from "../abstract/SSVReentrancyGuard.sol";
import {ISSVOperators} from "../interfaces/ISSVOperators.sol";

contract SSVClusters is ISSVClusters, SSVReentrancyGuard {
    using ClusterLib for Cluster;
    using OperatorLib for Operator;
    using ProtocolLib for StorageProtocol;

    /**
     * @inheritdoc ISSVClusters
     */
    function liquidate(address clusterOwner, uint64[] calldata operatorIds, Cluster memory cluster) external override nonReentrant {
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(clusterOwner, operatorIds, s);
        ClusterLib.validateClusterVersion(version, VERSION_ETH);
        cluster.validateClusterIsNotLiquidated();

        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageEB storage seb = SSVStorageEB.load();

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateClusterOperators(
            operatorIds,
            false,
            cluster.validatorCount,
            s,
            sp
        );

        cluster.updateClusterData(hashedCluster, clusterIndex, sp.currentNetworkFeeIndex());

        if (
            clusterOwner != msg.sender &&
            !cluster.isLiquidatableWithEB(
                hashedCluster,
                burnRate,
                PackedETH.unwrap(sp.ethNetworkFee),
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            )
        ) {
            revert ClusterNotLiquidatable();
        }

        _executeLiquidation(clusterOwner, msg.sender, hashedCluster, operatorIds, cluster, s, sp, seb);
    }

    /**
     * @inheritdoc ISSVClusters
     */
    function liquidateSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external override nonReentrant {
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(clusterOwner, operatorIds, s);
        ClusterLib.validateClusterVersion(version, VERSION_SSV);
        cluster.validateClusterIsNotLiquidated();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateClusterOperatorsSSV(
            operatorIds,
            false,
            cluster.validatorCount,
            s,
            sp
        );

        cluster.updateBalanceSSV(clusterIndex, sp.currentNetworkFeeIndexSSV());

        uint256 balanceLiquidatable;

        if (
            clusterOwner != msg.sender &&
            !cluster.isLiquidatable(
                burnRate,
                PackedSSV.unwrap(sp.networkFee),
                sp.minimumBlocksBeforeLiquidationSSV,
                sp.minimumLiquidationCollateralSSV
            )
        ) {
            revert ClusterNotLiquidatable();
        }

        sp.updateDAOSSV(false, cluster.validatorCount);

        if (cluster.balance != 0) {
            balanceLiquidatable = cluster.balance;
            cluster.balance = 0;
        }
        cluster.index = 0;
        cluster.networkFeeIndex = 0;
        cluster.active = false;

        s.clusters[hashedCluster] = cluster.hashClusterData();

        if (balanceLiquidatable != 0) {
            CoreLib.transferTokenBalance(msg.sender, balanceLiquidatable);
        }

        emit ClusterLiquidated(clusterOwner, operatorIds, cluster);
    }

    /**
     * @inheritdoc ISSVClusters
     */
    function reactivate(
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external payable override {
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        ClusterLib.validateClusterVersion(version, VERSION_ETH);
        if (cluster.active) revert ClusterAlreadyEnabled();

        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageEB storage seb = SSVStorageEB.load();

        uint64 vUnitsCluster = seb.clusterEB[hashedCluster].vUnits;
        uint64 baselineVUnits = uint64(cluster.validatorCount) * VUNITS_PRECISION;
        uint64 effectiveVUnits = vUnitsCluster > 0 ? vUnitsCluster : baselineVUnits;
        uint64 clusterDeviation = vUnitsCluster > baselineVUnits ? vUnitsCluster - baselineVUnits : 0;

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateClusterOperatorsOnReactivation(
            operatorIds,
            cluster.validatorCount,
            clusterDeviation,
            s,
            sp,
            seb
        );

        cluster.balance += msg.value;
        cluster.active = true;
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = sp.currentNetworkFeeIndex();

        if (
            cluster.isLiquidatableWithVUnits(
                effectiveVUnits,
                burnRate,
                PackedETH.unwrap(sp.ethNetworkFee),
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            )
        ) {
            revert InsufficientBalance();
        }

        sp.updateDAO(true, cluster.validatorCount);
        if (clusterDeviation > 0) {
            sp.daoTotalEthVUnits += clusterDeviation;
        }

        s.ethClusters[hashedCluster] = cluster.hashClusterData();

        emit ClusterReactivated(msg.sender, operatorIds, cluster);
    }

    /**
     * @inheritdoc ISSVClusters
     */
    function deposit(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external payable override {
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(clusterOwner, operatorIds, s);
        ClusterLib.validateClusterVersion(version, VERSION_ETH);

        cluster.balance += msg.value;

        s.ethClusters[hashedCluster] = cluster.hashClusterData();

        emit ClusterDeposited(clusterOwner, operatorIds, msg.value, cluster);
    }

    /**
     * @inheritdoc ISSVClusters
     */
    function withdraw(uint64[] calldata operatorIds, uint256 amount, Cluster memory cluster) external override nonReentrant {
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        ClusterLib.validateClusterVersion(version, VERSION_ETH);

        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint64 burnRate;
        if (cluster.active) {
            uint64 clusterIndex;
            {
                uint256 operatorsLength = operatorIds.length;
                for (uint256 i; i < operatorsLength; ++i) {
                    Operator storage operator = SSVStorage.load().operators[operatorIds[i]];
                    clusterIndex +=
                        operator.ethSnapshot.index +
                        (uint64(block.number) - operator.ethSnapshot.block) *
                        PackedETH.unwrap(operator.ethFee);
                    burnRate += PackedETH.unwrap(operator.ethFee);
                }
            }

            cluster.updateClusterData(hashedCluster, clusterIndex, sp.currentNetworkFeeIndex());
        }
        if (cluster.balance < amount) revert InsufficientBalance();

        cluster.balance -= amount;

        if (
            cluster.active &&
            cluster.validatorCount != 0 &&
            cluster.isLiquidatableWithEB(
                hashedCluster,
                burnRate,
                PackedETH.unwrap(sp.ethNetworkFee),
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            )
        ) {
            revert InsufficientBalance();
        }

        s.ethClusters[hashedCluster] = cluster.hashClusterData();

        CoreLib.transferBalance(msg.sender, amount);

        emit ClusterWithdrawn(msg.sender, operatorIds, amount, cluster);
    }

    /**
     * @inheritdoc ISSVClusters
     */
    function migrateClusterToETH(uint64[] calldata operatorIds, Cluster memory cluster) external payable override {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        ClusterLib.validateClusterVersion(version, VERSION_SSV);
        bool isLiquidated = !cluster.active; // A liquidated SSV cluster already had its SSV counts removed

        // compute cluster data using ETH fields
        (uint64 clusterIndexSSV, uint64 clusterIndexETH, uint64 burnRateETH) = OperatorLib.updateClusterOperatorsMigration(
            operatorIds,
            cluster.validatorCount,
            s,
            sp,
            isLiquidated
        );

        cluster.updateBalanceSSV(clusterIndexSSV, sp.currentNetworkFeeIndexSSV());
        uint256 ssvClusterBalance = cluster.balance;

        cluster.balance = msg.value;
        cluster.active = true;
        cluster.index = clusterIndexETH;
        cluster.networkFeeIndex = sp.currentNetworkFeeIndex();

        if (!isLiquidated) {
            sp.updateDAOSSV(false, cluster.validatorCount);
        }
        sp.updateDAO(true, cluster.validatorCount);

        if (
            cluster.isLiquidatableWithEB(
                hashedCluster,
                burnRateETH,
                PackedETH.unwrap(sp.ethNetworkFee),
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            )
        ) {
            revert ISSVNetworkCore.InsufficientBalance();
        }

        s.ethClusters[hashedCluster] = cluster.hashClusterData();
        delete s.clusters[hashedCluster];

        StorageEB storage seb = SSVStorageEB.load();
        ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[hashedCluster];

        // Deviation-only model: baseline added via ethValidatorCount (in updateClusterOperatorsMigration above)
        // Only add deviation if cluster has explicit EB tracking
        uint64 vUnitsCluster = ebSnapshot.vUnits;
        if (vUnitsCluster > 0) {
            uint64 baseline = uint64(cluster.validatorCount) * VUNITS_PRECISION;
            
            // DAO deviation accounting
            if (vUnitsCluster > baseline) {
                uint64 deviation = vUnitsCluster - baseline;
                sp.daoTotalEthVUnits += deviation;
                
                // Operator deviation accounting
                uint256 n = operatorIds.length;
                for (uint256 i; i < n; ++i) {
                    seb.operatorEthVUnits[operatorIds[i]] += deviation;
                }
            }
            // Note: EB floor is 32 ETH, so vUnitsCluster >= baseline always
            // If vUnitsCluster == baseline, deviation is 0, nothing to add
        }
        // For implicit clusters (vUnitsCluster == 0): no deviation to add

        // For event emission, compute effective balance
        uint64 effectiveVUnits = vUnitsCluster > 0 
            ? vUnitsCluster 
            : uint64(cluster.validatorCount) * VUNITS_PRECISION;
        uint32 effectiveBalance = ClusterLib.vUnitsToEB(effectiveVUnits);

        if (ssvClusterBalance != 0) {
            CoreLib.transferTokenBalance(msg.sender, ssvClusterBalance);
        }

        emit ClusterMigratedToETH(msg.sender, operatorIds, msg.value, ssvClusterBalance, effectiveBalance, cluster);
        if (isLiquidated) {
            emit ClusterReactivated(msg.sender, operatorIds, cluster);
        }
    }

    /**
     * @inheritdoc ISSVClusters
     */
    function updateClusterBalance(
        uint64 blockNum,
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster,
        uint32 effectiveBalance,
        bytes32[] calldata merkleProof
    ) external override nonReentrant {
        UpdateCtx memory ctx;
        StorageData storage s = SSVStorage.load();

        (ctx.clusterId, ctx.version) = cluster.validateHashedCluster(clusterOwner, operatorIds, s);
        ctx.clusterOwner = clusterOwner;
        ctx.blockNum = blockNum;
        ctx.effectiveBalance = effectiveBalance;
        ctx.merkleProof = merkleProof;

        _updateClusterBalanceInternal(operatorIds, cluster, ctx);
    }

    function _updateClusterBalanceInternal(
        uint64[] calldata operatorIds,
        Cluster memory cluster,
        UpdateCtx memory ctx
    ) internal {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageEB storage seb = SSVStorageEB.load();

        bytes32 clusterId = ctx.clusterId;

        _verifyEBRoots(ctx, seb);
        _verifyEBUpdateFrequency(clusterId, seb);
        _verifyEBStaleness(ctx, clusterId, seb);
        _verifyMerkleProof(ctx, seb);
        _verifyEBLimits(ctx, cluster);

        uint64 newVUnits = ClusterLib.ebToVUnits(ctx.effectiveBalance);

        if (ctx.version == VERSION_ETH) {
            // ETH clusters: full accounting flow
            uint64 storedVUnits = seb.clusterEB[clusterId].vUnits;
            uint64 effectiveOldVUnits = storedVUnits;
            if (effectiveOldVUnits == 0) {
                effectiveOldVUnits = uint64(cluster.validatorCount) * VUNITS_PRECISION;
            }

            uint64 burnRate;
            if (cluster.active) {
                burnRate = _applyClusterFeeUpdates(operatorIds, cluster, effectiveOldVUnits, s, sp);
            }

            // Apply new vUnits BEFORE liquidation check so auto-liquidation
            if (cluster.active && newVUnits != effectiveOldVUnits) {
                _updateOperatorVUnits(operatorIds, seb, effectiveOldVUnits, newVUnits);
                sp.updateDAOEthVUnits(effectiveOldVUnits, newVUnits);
            }
            _updateEBSnapshot(seb, clusterId, ctx.blockNum, newVUnits);

            bool liquidated = _liquidateAfterEBUpdateIfNeeded(cluster, clusterId, ctx.clusterOwner, operatorIds, burnRate, s, sp, seb);

            if (!liquidated && cluster.active) {
                s.ethClusters[clusterId] = cluster.hashClusterData();
            }
        } else {
            // SSV clusters: only update EB snapshot (preparing for future migration)
            _updateEBSnapshot(seb, clusterId, ctx.blockNum, newVUnits);
        }
        
        emit ClusterBalanceUpdated(ctx.clusterOwner, operatorIds, ctx.blockNum, ctx.effectiveBalance, cluster);
    }

    function _verifyEBRoots(UpdateCtx memory ctx, StorageEB storage seb) internal view {
        if (seb.ebRoots[ctx.blockNum] == bytes32(0)) {
            revert RootNotFound();
        }
    }

    function _verifyEBUpdateFrequency(bytes32 clusterId, StorageEB storage seb) internal view {
        ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[clusterId];
        if (
            ebSnapshot.lastUpdateBlock != 0 && block.number < ebSnapshot.lastUpdateBlock + seb.minBlocksBetweenUpdates
        ) {
            revert UpdateTooFrequent();
        }
    }

    function _verifyEBStaleness(UpdateCtx memory ctx, bytes32 clusterId, StorageEB storage seb) internal view {
        ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[clusterId];
        if (ebSnapshot.lastRootBlockNum != 0 && ctx.blockNum <= ebSnapshot.lastRootBlockNum) {
            revert StaleUpdate();
        }
    }

    function _verifyMerkleProof(UpdateCtx memory ctx, StorageEB storage seb) internal view {
        bytes32 root = seb.ebRoots[ctx.blockNum];

        if (!MerkleProof.verify(ctx.merkleProof, root, keccak256(abi.encodePacked(keccak256(abi.encode(ctx.clusterId, ctx.effectiveBalance)))))) {
            revert InvalidProof();
        }
    }

    function _verifyEBLimits(UpdateCtx memory ctx, Cluster memory cluster) internal pure {
        if (ctx.effectiveBalance > uint256(cluster.validatorCount) * (MAX_EB_PER_VALIDATOR / 1 ether)) {
            revert EBExceedsMaximum();
        } else if (ctx.effectiveBalance < uint256(cluster.validatorCount) * (DEFAULT_EB_PER_VALIDATOR / 1 ether)) {
            revert EBBelowMinimum();
        }
    }

    function _applyClusterFeeUpdates(
        uint64[] calldata operatorIds,
        Cluster memory cluster,
        uint64 oldVUnits,
        StorageData storage s,
        StorageProtocol storage sp
    ) internal returns (uint64 burnRate) {
        // ETH path: use ethSnapshot, ethFee, ethNetworkFeeIndex
        (uint64 clusterIndex, uint64 cumulativeFee) = OperatorLib.updateClusterOperators(operatorIds, false, 0, s, sp);
        uint64 currentNetworkFeeIndex = sp.currentNetworkFeeIndex();

        // Calculate fee deltas BEFORE updating indexes
        uint128 units = oldVUnits;
        uint128 idxNet = currentNetworkFeeIndex - cluster.networkFeeIndex;
        uint128 idxOp = clusterIndex - cluster.index;

        uint128 networkFeeUnits = (idxNet * units) / VUNITS_PRECISION;
        uint128 operatorFeeUnits = (idxOp * units) / VUNITS_PRECISION;
        uint256 totalFees = (uint256(networkFeeUnits) + uint256(operatorFeeUnits)) * ETH_DEDUCTED_DIGITS;

        // Update indexes
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = currentNetworkFeeIndex;

        if (cluster.balance >= totalFees) {
            cluster.balance -= totalFees;
        } else {
            cluster.balance = 0;
        }

        return cumulativeFee;
    }

    function _updateOperatorVUnits(
        uint64[] calldata operatorIds,
        StorageEB storage seb,
        uint64 storedVUnits,
        uint64 newVUnits
    ) internal {
        // Caller must ensure newVUnits != storedVUnits
        bool deltaPositive = newVUnits > storedVUnits;
        uint64 deltaAbs = deltaPositive ? newVUnits - storedVUnits : storedVUnits - newVUnits;

        uint256 operatorsLength = operatorIds.length;
        for (uint256 i; i < operatorsLength; ) {
            uint64 operatorId = operatorIds[i];
            if (deltaPositive) seb.operatorEthVUnits[operatorId] += deltaAbs;
            else seb.operatorEthVUnits[operatorId] -= deltaAbs;
            unchecked {
                ++i;
            }
        }
    }

    function _updateEBSnapshot(StorageEB storage seb, bytes32 clusterId, uint64 blockNum, uint64 newVUnits) internal {
        ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[clusterId];
        ebSnapshot.vUnits = newVUnits;
        ebSnapshot.lastRootBlockNum = blockNum;
        ebSnapshot.lastUpdateBlock = uint64(block.number);
    }

    function _liquidateAfterEBUpdateIfNeeded(
        Cluster memory cluster,
        bytes32 clusterId,
        address clusterOwner,
        uint64[] calldata operatorIds,
        uint64 burnRate,
        StorageData storage s,
        StorageProtocol storage sp,
        StorageEB storage seb
    ) internal returns (bool liquidated) {
        if (!cluster.active || cluster.validatorCount == 0) return false;

        if (cluster.isLiquidatableWithEB(
            clusterId,
            burnRate,
            PackedETH.unwrap(sp.ethNetworkFee),
            sp.minimumBlocksBeforeLiquidation,
            sp.minimumLiquidationCollateral
        )) {

            for (uint256 i; i < operatorIds.length; ++i) {
                ISSVOperators.Operator storage op = s.operators[operatorIds[i]];
                if (op.ethSnapshot.block != 0) {
                    op.ethValidatorCount -= cluster.validatorCount;
                }
            }

            _executeLiquidation(clusterOwner, msg.sender, clusterId, operatorIds, cluster, s, sp, seb);
            return true;
        }
        return false;
    }

    function _executeLiquidation(
        address clusterOwner,
        address liquidator,
        bytes32 clusterId,
        uint64[] calldata operatorIds,
        Cluster memory cluster,
        StorageData storage s,
        StorageProtocol storage sp,
        StorageEB storage seb
    ) internal {
        sp.updateDAO(false, cluster.validatorCount);

        ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[clusterId];
        uint64 vUnitsCluster = ebSnapshot.vUnits;
        
        // Deviation-only model: only subtract deviation from operatorEthVUnits
        // Baseline is removed via ethValidatorCount decrement (in updateClusterOperators above)
        if (vUnitsCluster > 0) {
            uint64 baselineVUnits = uint64(cluster.validatorCount) * VUNITS_PRECISION;

            // DAO deviation accounting
            if (vUnitsCluster != baselineVUnits) {
                bool moreThanBaseline = vUnitsCluster > baselineVUnits;
                uint64 deviation = moreThanBaseline ? vUnitsCluster - baselineVUnits : baselineVUnits - vUnitsCluster;

                if (deviation != 0) {
                    if (moreThanBaseline) sp.daoTotalEthVUnits -= deviation;
                    else sp.daoTotalEthVUnits += deviation;
                }
                
                // Operator deviation accounting: only subtract deviation, not baseline
                // Note: EB floor is 32 ETH, so vUnitsCluster >= baselineVUnits always
                // But we handle both cases for safety
                uint256 n = operatorIds.length;
                for (uint256 i; i < n; ++i) {
                    if (moreThanBaseline) {
                        seb.operatorEthVUnits[operatorIds[i]] -= deviation;
                    } else {
                        seb.operatorEthVUnits[operatorIds[i]] += deviation;
                    }
                }
            }
            // If vUnitsCluster == baselineVUnits, deviation is 0, nothing to update
            
        }
        // For implicit clusters (vUnitsCluster == 0): no deviation to remove

        uint256 balanceLiquidatable = cluster.balance;
        cluster.balance = 0;
        cluster.active = false;
        cluster.index = 0;
        cluster.networkFeeIndex = 0;

        s.ethClusters[clusterId] = cluster.hashClusterData();

        if (balanceLiquidatable > 0) {
            CoreLib.transferBalance(liquidator, balanceLiquidatable);
        }

        emit ClusterLiquidated(clusterOwner, operatorIds, cluster);
    }
}
