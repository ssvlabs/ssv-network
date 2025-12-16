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
import {
    SSVStorageEB,
    StorageEB,
    ClusterEBSnapshot,
    VUNITS_PRECISION,
    MAX_EB_PER_VALIDATOR
} from "../libraries/SSVStorageEB.sol";
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
        bytes[] memory publicKeys = new bytes[](1);
        publicKeys[0] = publicKey;

        bytes[] memory shares = new bytes[](1);
        shares[0] = sharesData;

        _bulkRegisterValidator(msg.sender, msg.value, publicKeys, operatorIds, shares, cluster);
    }

    function bulkRegisterValidator(
        bytes[] memory publicKeys,
        uint64[] memory operatorIds,
        bytes[] calldata sharesData,
        uint256, // deprecated amount param stays for backward compatability
        Cluster memory cluster
    ) external payable override {
        _bulkRegisterValidator(msg.sender, msg.value, publicKeys, operatorIds, sharesData, cluster);
    }

    function removeValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external override {
        bytes[] memory publicKeys = new bytes[](1);
        publicKeys[0] = publicKey;

        _bulkRemoveValidator(msg.sender, publicKeys, operatorIds, cluster, true);
    }

    function bulkRemoveValidator(
        bytes[] calldata publicKeys,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external override {
        _bulkRemoveValidator(msg.sender, publicKeys, operatorIds, cluster, false);
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
            sp,
            false
        );

        _updateClusterDataWithEB(cluster, hashedCluster, clusterIndex, sp.currentNetworkFeeIndex());

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

        _executeLiquidation(clusterOwner, msg.sender, hashedCluster, operatorIds, cluster, CoreLib.VERSION_ETH);
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

        _updateClusterDataWithEB(cluster, hashedCluster, clusterIndex, sp.currentNetworkFeeIndex());

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

        _executeLiquidation(clusterOwner, msg.sender, hashedCluster, operatorIds, cluster, CoreLib.VERSION_SSV);
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
            sp,
            false
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
            _updateClusterDataWithEB(cluster, hashedCluster, clusterIndex, sp.currentNetworkFeeIndex());
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
        bool isLiquidated = !cluster.active; // A liquidated SSV cluster already had its SSV counts removed

        uint256 ssvBalance = cluster.balance;

        // compute cluster data using ETH fields
        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateClusterOperators(
            operatorIds,
            true,
            cluster.validatorCount,
            s,
            sp,
            isLiquidated
        );

        cluster.balance = msg.value;
        cluster.active = true;
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = sp.currentNetworkFeeIndex();

        if (!isLiquidated) {
            sp.updateDAOSSV(false, cluster.validatorCount);
        }
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
        StorageEB storage seb = SSVStorageEB.load();
        ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[hashedCluster];
        uint64 vUnits = ebSnapshot.vUnits;
        if (vUnits == 0) {
            vUnits = uint64(cluster.validatorCount) * VUNITS_PRECISION;
        }
        uint256 clusterEB = (uint256(vUnits) * 32 ether) / VUNITS_PRECISION;

        emit ClusterMigratedToETH(msg.sender, operatorIds, msg.value, ssvBalance, clusterEB, cluster);
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
        ctx.clusterOwner = clusterOwner;
        ctx.blockNum = blockNum;
        ctx.effectiveBalance = effectiveBalance;
        ctx.merkleProof = merkleProof;

        _updateClusterBalanceInternal(operatorIds, cluster, ctx);
    }

    function _bulkRegisterValidator(
        address owner,
        uint256 value,
        bytes[] memory publicKeys,
        uint64[] memory operatorIds,
        bytes[] memory sharesData,
        Cluster memory cluster
    ) internal virtual {
        uint256 validatorsLength = publicKeys.length;

        if (validatorsLength == 0) revert EmptyPublicKeysList();
        if (validatorsLength != sharesData.length) revert PublicKeysSharesLengthMismatch();

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        ValidatorLib.validateOperatorsLength(operatorIds);

        for (uint i; i < validatorsLength; ++i) {
            ValidatorLib.registerPublicKey(publicKeys[i], operatorIds, owner, s);
        }
        bytes32 hashedCluster = cluster.validateClusterOnRegistration(owner, operatorIds, s);

        cluster.balance += value;

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

            emit ValidatorAdded(owner, operatorIds, pk, sh, cluster);
        }
    }

    function _bulkRemoveValidator(
        address owner,
        bytes[] memory publicKeys,
        uint64[] memory operatorIds,
        Cluster memory cluster,
        bool revertIfValidatorMissing
    ) internal virtual {
        uint256 validatorsLength = publicKeys.length;

        if (validatorsLength == 0) {
            revert ISSVNetworkCore.ValidatorDoesNotExist();
        }
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(owner, operatorIds, s);
        ClusterLib.validateClusterVersion(version, CoreLib.VERSION_ETH);
        bytes32 hashedOperatorIds = ValidatorLib.hashOperatorIds(operatorIds);

        uint32 validatorsRemoved;

        for (uint i; i < validatorsLength; ++i) {
            bytes32 hashedValidator = keccak256(abi.encodePacked(publicKeys[i], owner));
            bytes32 validatorData = s.validatorPKs[hashedValidator];

            if (revertIfValidatorMissing && validatorData == bytes32(0)) {
                revert ISSVNetworkCore.ValidatorDoesNotExist();
            }

            if (!ValidatorLib.validateCorrectState(validatorData, hashedOperatorIds))
                revert ISSVNetworkCore.IncorrectValidatorStateWithData(publicKeys[i]);

            delete s.validatorPKs[hashedValidator];
            validatorsRemoved++;
        }

        if (cluster.active) {
            StorageProtocol storage sp = SSVStorageProtocol.load();
            (uint64 clusterIndex, ) = OperatorLib.updateClusterOperators(
                operatorIds,
                false,
                validatorsRemoved,
                s,
                sp,
                false
            );

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
            emit ValidatorRemoved(owner, operatorIds, publicKeys[i], cluster);
        }
    }

    function _updateClusterBalanceInternal(
        uint64[] calldata operatorIds,
        Cluster memory cluster,
        UpdateCtx memory ctx
    ) internal {
        // convert gwei input to eth
        uint256 ebInEth = ctx.effectiveBalance / (1 gwei);

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageEB storage seb = SSVStorageEB.load();

        bytes32 clusterId = ctx.clusterId;

        _verifyEBRoots(ctx, seb);
        _verifyEBUpdateFrequency(clusterId, seb);
        _verifyEBStaleness(ctx, clusterId, seb);
        _verifyMerkleProof(ctx, seb);
        _verifyEBLimits(ctx, cluster);

        uint64 oldVUnits = seb.clusterEB[clusterId].vUnits;
        if (oldVUnits == 0) {
            oldVUnits = uint64(cluster.validatorCount) * VUNITS_PRECISION;
        }

        uint64 newVUnits = uint64((ctx.effectiveBalance * VUNITS_PRECISION) / (DEFAULT_EB_PER_VALIDATOR / 1 ether));

        if (cluster.active) {
            _applyClusterFeeUpdates(operatorIds, cluster, oldVUnits, newVUnits, ctx.version, s, sp);
        }

        _updateOperatorVUnits(operatorIds, seb, clusterId, newVUnits, ctx.version);

        _updateEBSnapshot(seb, clusterId, ctx.blockNum, newVUnits);

        _liquidateAfterEBUpdateIfNeeded(cluster, clusterId, ctx.clusterOwner, operatorIds, ctx.version);

        if (ctx.version == CoreLib.VERSION_ETH) {
            s.ethClusters[clusterId] = cluster.hashClusterData();
        } else {
            s.clusters[clusterId] = cluster.hashClusterData();
        }

        _emitClusterBalanceUpdated(
            ctx.clusterOwner,
            operatorIds,
            ctx.blockNum,
            ctx.effectiveBalance * 1 ether,
            newVUnits,
            cluster
        );
    }

    function _updateClusterDataWithEB(
        Cluster memory cluster,
        bytes32 clusterId,
        uint64 clusterIndex,
        uint64 networkFeeIndex
    ) internal view {
        cluster.updateBalanceWithEB(clusterId, clusterIndex, networkFeeIndex);
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = networkFeeIndex;
    }

    function _emitClusterBalanceUpdated(
        address clusterOwner,
        uint64[] calldata operatorIds,
        uint64 blockNum,
        uint256 eb,
        uint64 newVUnits,
        Cluster memory cluster
    ) internal {
        emit ClusterBalanceUpdated(clusterOwner, operatorIds, blockNum, eb, newVUnits, cluster);
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

        if (!MerkleProof.verify(ctx.merkleProof, root, keccak256(abi.encode(ctx.clusterId, ctx.effectiveBalance)))) {
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

    function _liquidateAfterEBUpdateIfNeeded(
        Cluster memory cluster,
        bytes32 clusterId,
        address clusterOwner,
        uint64[] calldata operatorIds,
        uint8 version
    ) internal {
        if (!cluster.active || cluster.validatorCount == 0) return;

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint64 burnRate;
        uint256 n = operatorIds.length;
        for (uint256 i; i < n; ++i) {
            Operator storage op = s.operators[operatorIds[i]];
            burnRate += (version == CoreLib.VERSION_ETH) ? op.ethFee : op.fee;
        }

        uint64 networkFee = (version == CoreLib.VERSION_ETH) ? sp.ethNetworkFee : sp.networkFee;

        bool liq = cluster.isLiquidatableWithEB(
            clusterId,
            burnRate,
            networkFee,
            sp.minimumBlocksBeforeLiquidation,
            sp.minimumLiquidationCollateral
        );

        if (!liq) return;

        _executeLiquidation(clusterOwner, msg.sender, clusterId, operatorIds, cluster, version);
    }

    function _executeLiquidation(
        address clusterOwner,
        address liquidator,
        bytes32 clusterId,
        uint64[] calldata operatorIds,
        Cluster memory cluster,
        uint8 version
    ) internal {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageEB storage seb = SSVStorageEB.load();

        if (version == CoreLib.VERSION_ETH) {
            sp.updateDAO(false, cluster.validatorCount);
        } else {
            sp.updateDAOSSV(false, cluster.validatorCount);
        }

        ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[clusterId];
        uint64 vUnitsCluster = ebSnapshot.vUnits;
        if (vUnitsCluster > 0) {
            uint64 baselineVUnits = uint64(cluster.validatorCount) * VUNITS_PRECISION;

            if (vUnitsCluster != baselineVUnits) {
                bool moreThanBaseline = vUnitsCluster > baselineVUnits;
                uint64 delta = moreThanBaseline ? vUnitsCluster - baselineVUnits : baselineVUnits - vUnitsCluster;

                if (delta != 0) {
                    if (version == CoreLib.VERSION_ETH) {
                        if (moreThanBaseline) sp.daoTotalEthVUnits -= delta;
                        else sp.daoTotalEthVUnits += delta;
                    } else {
                        if (moreThanBaseline) sp.daoTotalVUnits -= delta;
                        else sp.daoTotalVUnits += delta;
                    }
                }
            }

            uint256 n = operatorIds.length;
            for (uint256 i; i < n; ++i) {
                uint64 opId = operatorIds[i];
                if (version == CoreLib.VERSION_ETH) seb.operatorEthVUnits[opId] -= vUnitsCluster;
                else seb.operatorVUnits[opId] -= vUnitsCluster;
            }

            ebSnapshot.vUnits = 0;
        }

        uint256 payout = cluster.balance;
        cluster.balance = 0;
        cluster.active = false;
        cluster.index = 0;
        cluster.networkFeeIndex = 0;

        if (version == CoreLib.VERSION_ETH) s.ethClusters[clusterId] = cluster.hashClusterData();
        else s.clusters[clusterId] = cluster.hashClusterData();

        if (payout > 0) {
            if (version == CoreLib.VERSION_ETH) CoreLib.transferBalance(liquidator, payout);
            else CoreLib.transferTokenBalance(liquidator, payout);
        }

        emit ClusterLiquidated(clusterOwner, operatorIds, cluster);
    }
}
