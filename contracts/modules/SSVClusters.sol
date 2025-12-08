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
        uint256, // deprecated amount param stays for backward compatability
        Cluster memory cluster
    ) external payable override {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        ValidatorLib.validateOperatorsLength(operatorIds);

        ValidatorLib.registerPublicKey(publicKey, operatorIds, s);

        bytes32 hashedCluster = cluster.validateClusterOnRegistration(operatorIds, s);

        cluster.balance += msg.value;

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
                    seb.operatorEthVUnits[operatorId] += deltaClusterVUnits;
                }
            }
        }

        emit ValidatorAdded(msg.sender, operatorIds, publicKey, sharesData, cluster);
    }

    function bulkRegisterValidator(
        bytes[] memory publicKeys,
        uint64[] memory operatorIds,
        bytes[] calldata sharesData,
        uint256, // deprecated amount param stays for backward compatability
        Cluster memory cluster
    ) external payable override {
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

        cluster.balance += msg.value;

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
                    seb.operatorEthVUnits[operatorId] += deltaClusterVUnits;
                }
            }
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

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        ClusterLib.validateClusterVersion(version, CoreLib.VERSION_ETH);
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

            cluster.updateClusterData(clusterIndex, sp.currentNetworkFeeIndex());

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
                    seb.operatorEthVUnits[operatorId] -= deltaClusterVUnits;
                }
            }
        }

        s.ethClusters[hashedCluster] = cluster.hashClusterData();

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

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        ClusterLib.validateClusterVersion(version, CoreLib.VERSION_ETH);
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

            cluster.updateClusterData(clusterIndex, sp.currentNetworkFeeIndex());

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
                    seb.operatorEthVUnits[operatorId] -= deltaClusterVUnits;
                }
            }
        }

        s.ethClusters[hashedCluster] = cluster.hashClusterData();

        for (uint i; i < validatorsLength; ++i) {
            emit ValidatorRemoved(msg.sender, operatorIds, publicKeys[i], cluster);
        }
    }

    function liquidate(address clusterOwner, uint64[] calldata operatorIds, Cluster memory cluster) external override {
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        ClusterLib.validateClusterVersion(version, CoreLib.VERSION_ETH);
        cluster.validateClusterIsNotLiquidated();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateClusterOperators(
            operatorIds,
            false,
            cluster.validatorCount,
            s,
            sp
        );

        // TODO refactor next 3 lines to ClusterLib.updateClusterDataWithEB
        cluster.updateBalanceWithEB(hashedCluster, clusterIndex, sp.currentNetworkFeeIndex());
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = sp.currentNetworkFeeIndex();
        
        uint256 balanceLiquidatable;

        if (
            clusterOwner != msg.sender &&
            !cluster.isLiquidatableWithEB(
                hashedCluster,
                burnRate,
                sp.ethNetworkFee,
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
                            sp.daoTotalEthVUnits -= delta;
                        } else {
                            sp.daoTotalEthVUnits += delta;
                        }
                    }
                }

                // Remove this cluster's EB units from each operator in the cluster.
                uint256 operatorsLength = operatorIds.length;
                for (uint256 i; i < operatorsLength; ++i) {
                    uint64 operatorId = operatorIds[i];
                    seb.operatorEthVUnits[operatorId] -= vUnitsCluster;
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

        s.ethClusters[hashedCluster] = cluster.hashClusterData();

        if (balanceLiquidatable != 0) {
            CoreLib.transferBalance(msg.sender, balanceLiquidatable);
        }

        emit ClusterLiquidated(clusterOwner, operatorIds, cluster);
    }

    function liquidateSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external override {
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        ClusterLib.validateClusterVersion(version, CoreLib.VERSION_SSV);
        cluster.validateClusterIsNotLiquidated();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateClusterOperatorsSSV(
            operatorIds,
            false,
            cluster.validatorCount,
            s,
            sp
        );

        // TODO refactor next 3 lines to ClusterLib.updateClusterDataWithEB
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

        sp.updateDAOSSV(false, cluster.validatorCount);

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
            CoreLib.transferTokenBalance(msg.sender, balanceLiquidatable);
        }

        emit ClusterLiquidated(clusterOwner, operatorIds, cluster); // TODO add event to diverge the SSV from ETH clusters
    }

    function reactivate(
        uint64[] calldata operatorIds,
        uint256, // deprecated amount param stays for backward compatability
        Cluster memory cluster
    ) external payable override {
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        ClusterLib.validateClusterVersion(version, CoreLib.VERSION_ETH);
        if (cluster.active) revert ClusterAlreadyEnabled();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateClusterOperators(
            operatorIds,
            true,
            cluster.validatorCount,
            s,
            sp
        );

        cluster.balance += msg.value;
        cluster.active = true;
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = sp.currentNetworkFeeIndex();

        sp.updateDAO(true, cluster.validatorCount);

        if (
            cluster.isLiquidatableWithEB(
                hashedCluster,
                burnRate,
                sp.ethNetworkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            )
        ) {
            revert InsufficientBalance();
        }

        s.ethClusters[hashedCluster] = cluster.hashClusterData();

        emit ClusterReactivated(msg.sender, operatorIds, cluster);
    }

    function deposit(
        address clusterOwner,
        uint64[] calldata operatorIds,
        uint256, // deprecated amount param stays for backward compatability
        Cluster memory cluster
    ) external payable override {
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        ClusterLib.validateClusterVersion(version, CoreLib.VERSION_ETH);

        cluster.balance += msg.value;

        s.ethClusters[hashedCluster] = cluster.hashClusterData();

        emit ClusterDeposited(clusterOwner, operatorIds, msg.value, cluster);
    }

    function withdraw(uint64[] calldata operatorIds, uint256 amount, Cluster memory cluster) external override {
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        ClusterLib.validateClusterVersion(version, CoreLib.VERSION_ETH);
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
                        operator.ethSnapshot.index +
                        (uint64(block.number) - operator.ethSnapshot.block) *
                        operator.ethFee;
                    burnRate += operator.ethFee;
                }
            }

            // TODO refactor next 3 lines to ClusterLib.updateClusterDataWithEB
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
                sp.ethNetworkFee,
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

    function migrateClusterToETH(uint64[] calldata operatorIds, Cluster memory cluster) external payable override {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        ClusterLib.validateClusterVersion(version, CoreLib.VERSION_SSV);
        cluster.validateClusterIsNotLiquidated();

        uint256 ssvBalance = cluster.balance;

        // compute cluster data using ETH fields
        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateClusterOperators(
            operatorIds,
            true,
            cluster.validatorCount,
            s,
            sp
        );

        cluster.balance = msg.value;
        cluster.active = true;
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = sp.currentNetworkFeeIndex();

        sp.updateDAOSSV(false, cluster.validatorCount);
        sp.updateDAO(true, cluster.validatorCount);

        if (
            cluster.isLiquidatable(
                burnRate,
                sp.ethNetworkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            )
        ) {
            revert ISSVNetworkCore.InsufficientBalance();
        }

        s.ethClusters[hashedCluster] = cluster.hashClusterData();

        if (ssvBalance != 0) {
            CoreLib.transferTokenBalance(msg.sender, ssvBalance);
        }

        emit ClusterMigratedToETH(msg.sender, operatorIds, msg.value, ssvBalance, cluster);
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
        StorageData storage s = SSVStorage.load();

        (ctx.clusterId, ctx.version) = cluster.validateHashedCluster(clusterOwner, operatorIds, s);
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
            _applyClusterFeeUpdates(operatorIds, cluster, oldVUnits, newVUnits, ctx.version, s, sp);
        }

        _updateOperatorVUnits(operatorIds, seb, clusterId, newVUnits, ctx.version);

        _updateEBSnapshot(seb, clusterId, ctx.blockNum, newVUnits);

        if (ctx.version == CoreLib.VERSION_ETH) {
            s.ethClusters[clusterId] = cluster.hashClusterData();
        } else {
            s.clusters[clusterId] = cluster.hashClusterData();
        }

        _emitClusterBalanceUpdated(cluster, clusterId, ctx.blockNum, ctx.effectiveBalance, newVUnits);
    }

    function _emitClusterBalanceUpdated(
        Cluster memory cluster,
        bytes32 clusterId,
        uint64 blockNum,
        uint256 eb,
        uint64 newVUnits
    ) internal {
        emit ClusterBalanceUpdated(cluster, clusterId, blockNum, eb, newVUnits);
    }

    function _verifyEBRoots(UpdateCtx memory ctx, StorageEB storage seb) internal view {
        if (seb.ebRoots[ctx.blockNum] == bytes32(0)) {
            revert RootNotFound();
        }
    }

    function _verifyEBUpdateFrequency(bytes32 clusterId, StorageEB storage seb) internal view {
        ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[clusterId];
        if (ebSnapshot.lastUpdateBlock != 0 &&
            block.number < ebSnapshot.lastUpdateBlock + seb.minBlocksBetweenUpdates) {
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

        if (!MerkleProof.verify(ctx.merkleProof, root, keccak256(abi.encode(ctx.clusterId, ctx.effectiveBalance)))) {
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
        uint8 version,
        StorageData storage s,
        StorageProtocol storage sp
    ) internal {
        uint64 clusterIndex;
        uint64 currentNetworkFeeIndex;

        if (version == CoreLib.VERSION_ETH) {
            // ETH path: use ethSnapshot, ethFee, ethNetworkFeeIndex
            (clusterIndex, ) = OperatorLib.updateClusterOperators(operatorIds, false, 0, s, sp);
            currentNetworkFeeIndex = sp.currentNetworkFeeIndex(); // ETH network fee index
        } else {
            // SSV path: use snapshot, fee, networkFeeIndex
            (clusterIndex, ) = OperatorLib.updateClusterOperatorsSSV(operatorIds, false, 0, s, sp);
            currentNetworkFeeIndex = sp.currentNetworkFeeIndexSSV();
        }

        uint128 units = oldVUnits;
        uint128 idxNet = currentNetworkFeeIndex - cluster.networkFeeIndex;
        uint128 idxOp = clusterIndex - cluster.index;

        uint128 networkFeeUnits = (idxNet * units) / VUNITS_PRECISION;
        uint128 operatorFeeUnits = (idxOp * units) / VUNITS_PRECISION;
        uint64 totalFees = uint64(networkFeeUnits) + uint64(operatorFeeUnits);

        cluster.index = clusterIndex;
        cluster.networkFeeIndex = currentNetworkFeeIndex;

        if (cluster.balance >= totalFees.expand()) {
            cluster.balance -= totalFees.expand();
        } else {
            cluster.balance = 0;
        }

        // Update DAO vUnits (version-aware)
        if (newVUnits != oldVUnits) {
            if (version == CoreLib.VERSION_ETH) {
                sp.updateDAOEthVUnits(oldVUnits, newVUnits);
            } else {
                sp.updateDAOVUnits(oldVUnits, newVUnits);
            }
        }
    }

    function _updateOperatorVUnits(
        uint64[] calldata operatorIds,
        StorageEB storage seb,
        bytes32 clusterId,
        uint64 newVUnits,
        uint8 version
    ) internal {
        uint64 storedVUnits = seb.clusterEB[clusterId].vUnits;

        if (newVUnits != storedVUnits) {
            bool deltaPositive = newVUnits > storedVUnits;
            uint64 deltaAbs = deltaPositive ? newVUnits - storedVUnits : storedVUnits - newVUnits;

            if (deltaAbs != 0) {
                uint256 operatorsLength = operatorIds.length;
                for (uint256 i; i < operatorsLength; ++i) {
                    uint64 operatorId = operatorIds[i];
                    if (version == CoreLib.VERSION_ETH) {
                        // ETH clusters use operatorEthVUnits
                        if (deltaPositive) seb.operatorEthVUnits[operatorId] += deltaAbs;
                        else seb.operatorEthVUnits[operatorId] -= deltaAbs;
                    } else {
                        // SSV clusters use operatorVUnits
                        if (deltaPositive) seb.operatorVUnits[operatorId] += deltaAbs;
                        else seb.operatorVUnits[operatorId] -= deltaAbs;
                    }
                }
            }
        }
    }

    function _updateEBSnapshot(StorageEB storage seb, bytes32 clusterId, uint64 blockNum, uint64 newVUnits) internal {
        ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[clusterId];
        ebSnapshot.vUnits = newVUnits;
        ebSnapshot.lastRootBlockNum = blockNum;
        ebSnapshot.lastUpdateBlock = uint64(block.number);
    }
}
