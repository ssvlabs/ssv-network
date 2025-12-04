// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ISSVClusters} from "../interfaces/ISSVClusters.sol";
import "../libraries/ClusterLib.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/ProtocolLib.sol";
import "../libraries/CoreLib.sol";
import "../libraries/ValidatorLib.sol";
import {SSVStorage, StorageData} from "../libraries/SSVStorage.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/SSVStorageProtocol.sol";
import {SSVStorageEB, StorageEB, ClusterEBSnapshot, VUNITS_PRECISION, MAX_EB_PER_VALIDATOR} from "../libraries/SSVStorageEB.sol";
import {Types64} from "../libraries/Types.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract SSVClusters is ISSVClusters {
    using ClusterLib for Cluster;
    using OperatorLib for Operator;
    using ProtocolLib for StorageProtocol;
    using Types64 for uint64;

    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesData,
        uint256 amount,
        Cluster memory cluster
    ) external override {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        ValidatorLib.validateOperatorsLength(operatorIds);

        ValidatorLib.registerPublicKey(publicKey, operatorIds, s);

        bytes32 hashedCluster = cluster.validateClusterOnRegistration(operatorIds, s);

        cluster.balance += amount;

        cluster.updateClusterOnRegistration(operatorIds, hashedCluster, 1, s, sp);

        {
            StorageEB storage seb = SSVStorageEB.load();
            ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[hashedCluster];
            if (ebSnapshot.vUnits > 0) {
                uint64 deltaClusterVUnits = VUNITS_PRECISION;
                ebSnapshot.vUnits += deltaClusterVUnits;

                uint256 operatorsLength = operatorIds.length;
                for (uint256 i; i < operatorsLength; ++i) {
                    uint64 operatorId = operatorIds[i];
                    seb.operatorVUnits[operatorId] += deltaClusterVUnits;
                }
            }
        }

        if (amount != 0) {
            CoreLib.deposit(amount);
        }

        emit ValidatorAdded(msg.sender, operatorIds, publicKey, sharesData, cluster);
    }

    function bulkRegisterValidator(
        bytes[] memory publicKeys,
        uint64[] memory operatorIds,
        bytes[] calldata sharesData,
        uint256 amount,
        Cluster memory cluster
    ) external override {
        uint256 validatorsLength = publicKeys.length;

        if (validatorsLength == 0) revert EmptyPublicKeysList();
        if (validatorsLength != sharesData.length) revert PublicKeysSharesLengthMismatch();

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        ValidatorLib.validateOperatorsLength(operatorIds);

        for (uint i; i < validatorsLength; ++i) {
            ValidatorLib.registerPublicKey(publicKeys[i], operatorIds, s);
        }
        bytes32 hashedCluster = cluster.validateClusterOnRegistration(operatorIds, s);

        cluster.balance += amount;

        cluster.updateClusterOnRegistration(operatorIds, hashedCluster, uint32(validatorsLength), s, sp);

        {
            StorageEB storage seb = SSVStorageEB.load();
            ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[hashedCluster];
            if (ebSnapshot.vUnits > 0) {
                uint64 deltaClusterVUnits = uint64(validatorsLength) * VUNITS_PRECISION;
                ebSnapshot.vUnits += deltaClusterVUnits;

                uint256 operatorsLength = operatorIds.length;
                for (uint256 i; i < operatorsLength; ++i) {
                    uint64 operatorId = operatorIds[i];
                    seb.operatorVUnits[operatorId] += deltaClusterVUnits;
                }
            }
        }

        if (amount != 0) {
            CoreLib.deposit(amount);
        }

        for (uint i; i < validatorsLength; ++i) {
            bytes memory pk = publicKeys[i];
            bytes memory sh = sharesData[i];

            emit ValidatorAdded(msg.sender, operatorIds, pk, sh, cluster);
        }
    }

    function removeValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external override {
        StorageData storage s = SSVStorage.load();

        bytes32 hashedCluster = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        bytes32 hashedOperatorIds = ValidatorLib.hashOperatorIds(operatorIds);

        bytes32 hashedValidator = keccak256(abi.encodePacked(publicKey, msg.sender));
        bytes32 validatorData = s.validatorPKs[hashedValidator];

        if (validatorData == bytes32(0)) {
            revert ISSVNetworkCore.ValidatorDoesNotExist();
        }

        if (!ValidatorLib.validateCorrectState(validatorData, hashedOperatorIds))
            revert ISSVNetworkCore.IncorrectValidatorStateWithData(publicKey);

        delete s.validatorPKs[hashedValidator];

        if (cluster.active) {
            StorageProtocol storage sp = SSVStorageProtocol.load();
            (uint64 clusterIndex, ) = OperatorLib.updateClusterOperators(operatorIds, false, 1, s, sp);

            cluster.updateClusterData(hashedCluster, clusterIndex, sp.currentNetworkFeeIndex());

            sp.updateDAO(false, 1);
        }

        --cluster.validatorCount;

        {
            StorageEB storage seb = SSVStorageEB.load();
            ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[hashedCluster];
            if (ebSnapshot.vUnits > 0) {
                uint64 deltaClusterVUnits = VUNITS_PRECISION;
                ebSnapshot.vUnits -= deltaClusterVUnits;

                uint256 operatorsLength = operatorIds.length;
                for (uint256 i; i < operatorsLength; ++i) {
                    uint64 operatorId = operatorIds[i];
                    seb.operatorVUnits[operatorId] -= deltaClusterVUnits;
                }
            }
        }

        s.clusters[hashedCluster] = cluster.hashClusterData();

        emit ValidatorRemoved(msg.sender, operatorIds, publicKey, cluster);
    }

    function bulkRemoveValidator(
        bytes[] calldata publicKeys,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external override {
        uint256 validatorsLength = publicKeys.length;

        if (validatorsLength == 0) {
            revert ISSVNetworkCore.ValidatorDoesNotExist();
        }
        StorageData storage s = SSVStorage.load();

        bytes32 hashedCluster = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        bytes32 hashedOperatorIds = ValidatorLib.hashOperatorIds(operatorIds);

        bytes32 hashedValidator;
        bytes32 validatorData;

        uint32 validatorsRemoved;

        for (uint i; i < validatorsLength; ++i) {
            hashedValidator = keccak256(abi.encodePacked(publicKeys[i], msg.sender));
            validatorData = s.validatorPKs[hashedValidator];

            if (!ValidatorLib.validateCorrectState(validatorData, hashedOperatorIds))
                revert ISSVNetworkCore.IncorrectValidatorStateWithData(publicKeys[i]);

            delete s.validatorPKs[hashedValidator];
            validatorsRemoved++;
        }

        if (cluster.active) {
            StorageProtocol storage sp = SSVStorageProtocol.load();
            (uint64 clusterIndex, ) = OperatorLib.updateClusterOperators(operatorIds, false, validatorsRemoved, s, sp);

            cluster.updateClusterData(hashedCluster, clusterIndex, sp.currentNetworkFeeIndex());

            sp.updateDAO(false, validatorsRemoved);
        }

        cluster.validatorCount -= validatorsRemoved;

        {
            StorageEB storage seb = SSVStorageEB.load();
            ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[hashedCluster];
            if (ebSnapshot.vUnits > 0) {
                uint64 deltaClusterVUnits = uint64(validatorsRemoved) * VUNITS_PRECISION;
                ebSnapshot.vUnits -= deltaClusterVUnits;

                uint256 operatorsLength = operatorIds.length;
                for (uint256 i; i < operatorsLength; ++i) {
                    uint64 operatorId = operatorIds[i];
                    seb.operatorVUnits[operatorId] -= deltaClusterVUnits;
                }
            }
        }

        s.clusters[hashedCluster] = cluster.hashClusterData();

        for (uint i; i < validatorsLength; ++i) {
            emit ValidatorRemoved(msg.sender, operatorIds, publicKeys[i], cluster);
        }
    }

    function liquidate(address clusterOwner, uint64[] calldata operatorIds, Cluster memory cluster) external override {
        StorageData storage s = SSVStorage.load();

        bytes32 hashedCluster = cluster.validateHashedCluster(clusterOwner, operatorIds, s);
        cluster.validateClusterIsNotLiquidated();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateClusterOperators(
            operatorIds,
            false,
            cluster.validatorCount,
            s,
            sp
        );

        cluster.updateBalanceWithEB(hashedCluster, clusterIndex, sp.currentNetworkFeeIndex());
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = sp.currentNetworkFeeIndex();

        uint256 balanceLiquidatable;

        if (
            clusterOwner != msg.sender &&
            !cluster.isLiquidatableWithEB(
                hashedCluster,
                burnRate,
                sp.networkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            )
        ) {
            revert ClusterNotLiquidatable();
        }

        sp.updateDAO(false, cluster.validatorCount);

        // EB accounting on liquidation:
        // - Remove this cluster's EB units from DAO totals (beyond the baseline 1 vUnit per validator
        //   already handled by updateDAO).
        // - Remove this cluster's EB contribution from each operator's operatorVUnits.
        // - Reset the cluster's EB snapshot vUnits to zero so future EB-aware helpers fall back
        //   to validatorCount until a new EB is reported.
        {
            StorageEB storage seb = SSVStorageEB.load();
            ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[hashedCluster];
            uint64 vUnitsCluster = ebSnapshot.vUnits;
            if (vUnitsCluster > 0) {
                // Adjust DAO total vUnits so that the net effect of liquidation is to remove
                // the full cluster EB units vUnitsCluster from daoTotalVUnits.
                uint64 baselineVUnits = uint64(cluster.validatorCount) * VUNITS_PRECISION;
                if (vUnitsCluster != baselineVUnits) {
                    bool moreThanBaseline = vUnitsCluster > baselineVUnits;
                    uint64 delta = moreThanBaseline
                        ? vUnitsCluster - baselineVUnits
                        : baselineVUnits - vUnitsCluster;
                    if (delta != 0) {
                        if (moreThanBaseline) {
                            sp.daoTotalVUnits -= delta;
                        } else {
                            sp.daoTotalVUnits += delta;
                        }
                    }
                }

                // Remove this cluster's EB units from each operator in the cluster.
                uint256 operatorsLength = operatorIds.length;
                for (uint256 i; i < operatorsLength; ++i) {
                    uint64 operatorId = operatorIds[i];
                    seb.operatorVUnits[operatorId] -= vUnitsCluster;
                }

                // Reset cluster EB units to zero (root metadata is kept for staleness checks).
                ebSnapshot.vUnits = 0;
            }
        }

        if (cluster.balance != 0) {
            balanceLiquidatable = cluster.balance;
            cluster.balance = 0;
        }
        cluster.index = 0;
        cluster.networkFeeIndex = 0;
        cluster.active = false;

        s.clusters[hashedCluster] = cluster.hashClusterData();

        if (balanceLiquidatable != 0) {
            CoreLib.transferBalance(msg.sender, balanceLiquidatable);
        }

        emit ClusterLiquidated(clusterOwner, operatorIds, cluster);
    }

    function reactivate(uint64[] calldata operatorIds, uint256 amount, Cluster memory cluster) external override {
        StorageData storage s = SSVStorage.load();

        bytes32 hashedCluster = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        if (cluster.active) revert ClusterAlreadyEnabled();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateClusterOperators(
            operatorIds,
            true,
            cluster.validatorCount,
            s,
            sp
        );

        cluster.balance += amount;
        cluster.active = true;
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = sp.currentNetworkFeeIndex();

        sp.updateDAO(true, cluster.validatorCount);

        if (
            cluster.isLiquidatableWithEB(
                hashedCluster,
                burnRate,
                sp.networkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            )
        ) {
            revert InsufficientBalance();
        }

        s.clusters[hashedCluster] = cluster.hashClusterData();

        if (amount > 0) {
            CoreLib.deposit(amount);
        }

        emit ClusterReactivated(msg.sender, operatorIds, cluster);
    }

    function deposit(
        address clusterOwner,
        uint64[] calldata operatorIds,
        uint256 amount,
        Cluster memory cluster
    ) external override {
        StorageData storage s = SSVStorage.load();

        bytes32 hashedCluster = cluster.validateHashedCluster(clusterOwner, operatorIds, s);

        cluster.balance += amount;

        s.clusters[hashedCluster] = cluster.hashClusterData();

        CoreLib.deposit(amount);

        emit ClusterDeposited(clusterOwner, operatorIds, amount, cluster);
    }

    function withdraw(uint64[] calldata operatorIds, uint256 amount, Cluster memory cluster) external override {
        StorageData storage s = SSVStorage.load();

        bytes32 hashedCluster = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        cluster.validateClusterIsNotLiquidated();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint64 burnRate;
        if (cluster.active) {
            uint64 clusterIndex;
            {
                uint256 operatorsLength = operatorIds.length;
                for (uint256 i; i < operatorsLength; ++i) {
                    Operator storage operator = SSVStorage.load().operators[operatorIds[i]];
                    clusterIndex +=
                        operator.snapshot.index +
                        (uint64(block.number) - operator.snapshot.block) *
                        operator.fee;
                    burnRate += operator.fee;
                }
            }

            cluster.updateBalanceWithEB(hashedCluster, clusterIndex, sp.currentNetworkFeeIndex());
            cluster.index = clusterIndex;
            cluster.networkFeeIndex = sp.currentNetworkFeeIndex();
        }
        if (cluster.balance < amount) revert InsufficientBalance();

        cluster.balance -= amount;

        if (
            cluster.active &&
            cluster.validatorCount != 0 &&
            cluster.isLiquidatableWithEB(
                hashedCluster,
                burnRate,
                sp.networkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            )
        ) {
            revert InsufficientBalance();
        }

        s.clusters[hashedCluster] = cluster.hashClusterData();

        CoreLib.transferBalance(msg.sender, amount);

        emit ClusterWithdrawn(msg.sender, operatorIds, amount, cluster);
    }

    function exitValidator(bytes calldata publicKey, uint64[] calldata operatorIds) external override {
        if (
            !ValidatorLib.validateCorrectState(
                SSVStorage.load().validatorPKs[keccak256(abi.encodePacked(publicKey, msg.sender))],
                ValidatorLib.hashOperatorIds(operatorIds)
            )
        ) revert ISSVNetworkCore.IncorrectValidatorStateWithData(publicKey);

        emit ValidatorExited(msg.sender, operatorIds, publicKey);
    }

    function bulkExitValidator(bytes[] calldata publicKeys, uint64[] calldata operatorIds) external override {
        if (publicKeys.length == 0) {
            revert ISSVNetworkCore.ValidatorDoesNotExist();
        }
        bytes32 hashedOperatorIds = ValidatorLib.hashOperatorIds(operatorIds);

        for (uint i; i < publicKeys.length; ++i) {
            if (
                !ValidatorLib.validateCorrectState(
                    SSVStorage.load().validatorPKs[keccak256(abi.encodePacked(publicKeys[i], msg.sender))],
                    hashedOperatorIds
                )
            ) revert ISSVNetworkCore.IncorrectValidatorStateWithData(publicKeys[i]);

            emit ValidatorExited(msg.sender, operatorIds, publicKeys[i]);
        }
    }

    function updateClusterBalance(
        uint64 blockNum,
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster,
        uint256 effectiveBalance,
        bytes32[] calldata merkleProof
    ) external override {
        UpdateCtx memory ctx;
        ctx.clusterId = cluster.validateHashedCluster(clusterOwner, operatorIds, SSVStorage.load());
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
        _verifyEBMaximum(ctx, cluster);

        uint64 oldVUnits = seb.clusterEB[clusterId].vUnits;
        if (oldVUnits == 0) {
            oldVUnits = uint64(cluster.validatorCount) * VUNITS_PRECISION;
        }

        uint64 newVUnits = uint64((ctx.effectiveBalance * VUNITS_PRECISION) / 32 ether);

        if (cluster.active) {
            _applyClusterFeeUpdates(
                operatorIds,
                cluster,
                oldVUnits,
                newVUnits,
                s,
                sp
            );
        }

        _updateOperatorVUnits(operatorIds, seb, clusterId, newVUnits);

        _updateEBSnapshot(seb, clusterId, ctx.blockNum, newVUnits);

        s.clusters[clusterId] = cluster.hashClusterData();

        emit ClusterBalanceUpdated(clusterId, ctx.blockNum, ctx.effectiveBalance, newVUnits);
    }

    function _verifyEBRoots(UpdateCtx memory ctx, StorageEB storage seb) internal view {
        if (seb.ebRoots[ctx.blockNum] == bytes32(0)) revert RootNotFound();
    }

    function _verifyEBUpdateFrequency(
        bytes32 clusterId,
        StorageEB storage seb
    ) internal view {
        ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[clusterId];
        if (
            ebSnapshot.lastUpdateBlock != 0 &&
            block.number < ebSnapshot.lastUpdateBlock + seb.minBlocksBetweenUpdates
        ) {
            revert UpdateTooFrequent();
        }
    }

    function _verifyEBStaleness(
        UpdateCtx memory ctx,
        bytes32 clusterId,
        StorageEB storage seb
    ) internal view {
        ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[clusterId];
        if (ebSnapshot.lastRootBlockNum != 0 && ctx.blockNum <= ebSnapshot.lastRootBlockNum) {
            revert StaleUpdate();
        }
    }

    function _verifyMerkleProof(UpdateCtx memory ctx, StorageEB storage seb) internal view {
        bytes32 root = seb.ebRoots[ctx.blockNum];

        if (
            !MerkleProof.verify(
            ctx.merkleProof,
            root,
            keccak256(abi.encode(ctx.clusterId, ctx.effectiveBalance))
        )
        ) {
            revert InvalidProof();
        }
    }

    function _verifyEBMaximum(UpdateCtx memory ctx, Cluster memory cluster) internal pure {
        if (ctx.effectiveBalance > uint256(cluster.validatorCount) * MAX_EB_PER_VALIDATOR) {
            revert EBExceedsMaximum();
        }
    }

    function _applyClusterFeeUpdates(
        uint64[] calldata operatorIds,
        Cluster memory cluster,
        uint64 oldVUnits,
        uint64 newVUnits,
        StorageData storage s,
        StorageProtocol storage sp
    ) internal {
        (uint64 clusterIndex, ) = OperatorLib.updateClusterOperators(
            operatorIds,
            false,
            0,
            s,
            sp
        );

        uint64 currentNetworkFeeIndex = sp.currentNetworkFeeIndex();
        uint128 units = oldVUnits;
        uint128 idxNet = currentNetworkFeeIndex - cluster.networkFeeIndex;
        uint128 idxOp = clusterIndex - cluster.index;

        uint128 networkFeeUnits = (idxNet * units) / VUNITS_PRECISION;
        uint128 operatorFeeUnits = (idxOp * units) / VUNITS_PRECISION;
        uint64 networkFee = uint64(networkFeeUnits);
        uint64 operatorFees = uint64(operatorFeeUnits);
        uint64 totalFees = networkFee + operatorFees;

        cluster.index = clusterIndex;
        cluster.networkFeeIndex = currentNetworkFeeIndex;

        if (cluster.balance >= totalFees.expand()) {
            cluster.balance -= totalFees.expand();
        } else {
            cluster.balance = 0;
        }

        if (newVUnits != oldVUnits) {
            _updateDAOVUnits(sp, oldVUnits, newVUnits);
        }
    }

    function _updateOperatorVUnits(
        uint64[] calldata operatorIds,
        StorageEB storage seb,
        bytes32 clusterId,
        uint64 newVUnits
    ) internal {
        uint64 storedVUnits = seb.clusterEB[clusterId].vUnits;

        if (newVUnits != storedVUnits) {
            bool deltaPositive = newVUnits > storedVUnits;
            uint256 deltaClusterVUnits = deltaPositive
                ? uint256(newVUnits) - uint256(storedVUnits)
                : uint256(storedVUnits) - uint256(newVUnits);

            if (deltaClusterVUnits != 0) {
                uint64 deltaAbs = uint64(deltaClusterVUnits);
                if (deltaAbs != 0) {
                    uint256 operatorsLength = operatorIds.length;
                    for (uint256 i; i < operatorsLength; ++i) {
                        uint64 operatorId = operatorIds[i];
                        if (deltaPositive) seb.operatorVUnits[operatorId] += deltaAbs;
                        else seb.operatorVUnits[operatorId] -= deltaAbs;
                    }
                }
            }
        }
    }

    function _updateEBSnapshot(
        StorageEB storage seb,
        bytes32 clusterId,
        uint64 blockNum,
        uint64 newVUnits
    ) internal {
        ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[clusterId];
        ebSnapshot.vUnits = newVUnits;
        ebSnapshot.lastRootBlockNum = blockNum;
        ebSnapshot.lastUpdateBlock = uint64(block.number);
    }

    function _updateDAOVUnits(StorageProtocol storage sp, uint64 oldVUnits, uint64 newVUnits) internal {
        sp.updateDAOEarnings();

        if (newVUnits > oldVUnits) {
            sp.daoTotalVUnits += newVUnits - oldVUnits;
        } else {
            sp.daoTotalVUnits -= oldVUnits - newVUnits;
        }
    }
}
