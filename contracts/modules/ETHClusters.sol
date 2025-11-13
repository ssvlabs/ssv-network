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

contract ETHClusters is ISSVClusters {
    using ClusterLib for Cluster;
    using OperatorLib for Operator;
    using ProtocolLib for StorageProtocol;

    /// @inheritdoc ISSVClusters
    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesData,
        uint256,
        Cluster memory cluster
    ) external payable override {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        ValidatorLib.validateOperatorsLength(operatorIds);

        ValidatorLib.registerPublicKey(publicKey, operatorIds, s);

        bytes32 hashedCluster = cluster.validateClusterOnRegistration(operatorIds, s);

        cluster.balance += msg.value;

        cluster.updateClusterOnRegistration(operatorIds, hashedCluster, 1, s, sp);

        emit ValidatorAdded(msg.sender, operatorIds, publicKey, sharesData, cluster);
    }

    /// @inheritdoc ISSVClusters
    function bulkRegisterValidator(
        bytes[] memory publicKeys,
        uint64[] memory operatorIds,
        bytes[] calldata sharesData,
        uint256,
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

        for (uint i; i < validatorsLength; ++i) {
            bytes memory pk = publicKeys[i];
            bytes memory sh = sharesData[i];

            emit ValidatorAdded(msg.sender, operatorIds, pk, sh, cluster);
        }
    }

    /// @inheritdoc ISSVClusters
    function removeValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external override {
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(msg.sender, operatorIds, s);
        bytes32 hashedOperatorIds = ValidatorLib.hashOperatorIds(operatorIds);

        bytes32 hashedValidator = keccak256(abi.encodePacked(publicKey, msg.sender));
        bytes32 validatorData = s.validatorPKs[hashedValidator];

        if (validatorData == bytes32(0)) {
            revert ISSVNetworkCore.ValidatorDoesNotExist();
        }

        if (!ValidatorLib.validateCorrectState(validatorData, hashedOperatorIds)) {
            revert ISSVNetworkCore.IncorrectValidatorStateWithData(publicKey);
        }
        delete s.validatorPKs[hashedValidator];

        if (cluster.active) {
            StorageProtocol storage sp = SSVStorageProtocol.load();
            (uint64 clusterIndex, ) = OperatorLib.updateClusterOperators(operatorIds, false, 1, s, sp);

            cluster.updateClusterData(clusterIndex, sp.currentNetworkFeeIndex());

            sp.updateDAO(false, 1);
        }

        --cluster.validatorCount;
        if (version == ClusterLib._CLUSTER_VERSION_ETH) {
            s.ethClusters[hashedCluster] = cluster.hashClusterData();
        } else if (version == ClusterLib._CLUSTER_VERSION_SSV) {
            s.clusters[hashedCluster] = cluster.hashClusterData();
        } else {
            revert IncorrectClusterVersion();
        }

        emit ValidatorRemoved(msg.sender, operatorIds, publicKey, cluster);
    }

    /// @inheritdoc ISSVClusters
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

        if (version == ClusterLib._CLUSTER_VERSION_ETH) {
            s.ethClusters[hashedCluster] = cluster.hashClusterData();
        } else if (version == ClusterLib._CLUSTER_VERSION_SSV) {
            s.clusters[hashedCluster] = cluster.hashClusterData();
        } else {
            revert IncorrectClusterVersion();
        }

        for (uint i; i < validatorsLength; ++i) {
            emit ValidatorRemoved(msg.sender, operatorIds, publicKeys[i], cluster);
        }
    }

    /// @inheritdoc ISSVClusters
    function liquidate(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external payable override {
        _liquidate(clusterOwner, operatorIds, cluster);
        emit ClusterLiquidated(clusterOwner, operatorIds, cluster);
    }

    /// @inheritdoc ISSVClusters
    function reactivate(uint64[] calldata operatorIds, uint256, Cluster memory cluster) external payable override {
        _reactivate(operatorIds, cluster);
        emit ClusterReactivated(msg.sender, operatorIds, cluster);
    }

    /// @inheritdoc ISSVClusters
    function deposit(
        address clusterOwner,
        uint64[] calldata operatorIds,
        uint256 amount,
        Cluster memory cluster
    ) external payable override {
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(clusterOwner, operatorIds, s);
        if (version == ClusterLib._CLUSTER_VERSION_SSV) {
            _liquidate(clusterOwner, operatorIds, cluster);
            emit ClusterLiquidated(clusterOwner, operatorIds, cluster);

            _reactivate(operatorIds, cluster);
            emit ClusterReactivated(msg.sender, operatorIds, cluster);
        } else {
            cluster.balance += msg.value;
            s.ethClusters[hashedCluster] = cluster.hashClusterData();
        }
        emit ClusterDeposited(clusterOwner, operatorIds, amount, cluster);
    }

    /// @inheritdoc ISSVClusters
    function withdraw(uint64[] calldata operatorIds, uint256 amount, Cluster memory cluster) external payable override {
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(msg.sender, operatorIds, s);
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

            cluster.updateClusterData(clusterIndex, sp.currentNetworkFeeIndex());
        }
        if (cluster.balance < amount) revert InsufficientBalance();

        cluster.balance -= amount;

        if (
            cluster.active &&
            cluster.validatorCount != 0 &&
            cluster.isLiquidatable(
                burnRate,
                sp.networkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            )
        ) {
            revert InsufficientBalance();
        }

        s.ethClusters[hashedCluster] = cluster.hashClusterData();

        if (version == ClusterLib._CLUSTER_VERSION_ETH) {
            s.ethClusters[hashedCluster] = cluster.hashClusterData();
            if (amount != 0) {
                CoreLib.transferBalance(payable(msg.sender), amount);
            }
        } else if (version == ClusterLib._CLUSTER_VERSION_SSV) {
            s.clusters[hashedCluster] = cluster.hashClusterData();
            if (amount != 0) {
                CoreLib.transferTokenBalance(msg.sender, amount);
            }
        } else {
            revert IncorrectClusterVersion();
        }
        emit ClusterWithdrawn(msg.sender, operatorIds, amount, cluster);
    }

    /// @inheritdoc ISSVClusters
    function exitValidator(bytes calldata publicKey, uint64[] calldata operatorIds) external override {
        if (
            !ValidatorLib.validateCorrectState(
                SSVStorage.load().validatorPKs[keccak256(abi.encodePacked(publicKey, msg.sender))],
                ValidatorLib.hashOperatorIds(operatorIds)
            )
        ) revert ISSVNetworkCore.IncorrectValidatorStateWithData(publicKey);

        emit ValidatorExited(msg.sender, operatorIds, publicKey);
    }

    /// @inheritdoc ISSVClusters
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

    function _liquidate(address clusterOwner, uint64[] calldata operatorIds, Cluster memory cluster) internal virtual {
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(clusterOwner, operatorIds, s);
        cluster.validateClusterIsNotLiquidated();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateClusterOperators(
            operatorIds,
            false,
            cluster.validatorCount,
            s,
            sp
        );

        cluster.updateBalance(clusterIndex, sp.currentNetworkFeeIndex());

        uint256 balanceLiquidatable;

        if (
            clusterOwner != msg.sender &&
            !cluster.isLiquidatable(
                burnRate,
                sp.networkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            )
        ) {
            revert ClusterNotLiquidatable();
        }

        sp.updateDAO(false, cluster.validatorCount);

        if (cluster.balance != 0) {
            balanceLiquidatable = cluster.balance;
            cluster.balance = 0;
        }
        cluster.index = 0;
        cluster.networkFeeIndex = 0;
        cluster.active = false;

        if (version == ClusterLib._CLUSTER_VERSION_ETH) {
            s.ethClusters[hashedCluster] = cluster.hashClusterData();
            if (balanceLiquidatable != 0) {
                CoreLib.transferBalance(payable(msg.sender), balanceLiquidatable);
            }
        } else if (version == ClusterLib._CLUSTER_VERSION_SSV) {
            s.clusters[hashedCluster] = cluster.hashClusterData();
            if (balanceLiquidatable != 0) {
                CoreLib.transferTokenBalance(msg.sender, balanceLiquidatable);
            }
        } else {
            revert IncorrectClusterVersion();
        }
    }

    function _reactivate(uint64[] calldata operatorIds, Cluster memory cluster) internal virtual {
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, ) = cluster.validateHashedCluster(msg.sender, operatorIds, s);
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
            cluster.isLiquidatable(
                burnRate,
                sp.networkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            )
        ) {
            revert InsufficientBalance();
        }

        s.ethClusters[hashedCluster] = cluster.hashClusterData();
    }
}
