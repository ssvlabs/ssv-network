// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/ISSVClusters.sol";
import "../libraries/ClusterLib.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/ProtocolLib.sol";
import "../libraries/CoreLib.sol";
import "../libraries/ValidatorLib.sol";
import "../libraries/SSVStorage.sol";
import "../libraries/SSVStorageProtocol.sol";

contract SSVClusters is ISSVClusters {
    using ClusterLib for Cluster;
    using OperatorLib for Operator;
    using ProtocolLib for StorageProtocol;
    uint64 private constant MIN_OPERATORS_LENGTH = 4;
    uint64 private constant MAX_OPERATORS_LENGTH = 13;
    uint64 private constant MODULO_OPERATORS_LENGTH = 3;
    uint64 private constant PUBLIC_KEY_LENGTH = 48;

    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesData,
        uint256 amount,
        Cluster memory cluster
    ) external override {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint256 operatorsLength = operatorIds.length;
        {
            if (
                operatorsLength < MIN_OPERATORS_LENGTH ||
                operatorsLength > MAX_OPERATORS_LENGTH ||
                operatorsLength % MODULO_OPERATORS_LENGTH != 1
            ) {
                revert InvalidOperatorIdsLength();
            }

            if (publicKey.length != PUBLIC_KEY_LENGTH) revert InvalidPublicKeyLength();

            bytes32 hashedPk = keccak256(abi.encodePacked(publicKey, msg.sender));

            if (s.validatorPKs[hashedPk] != bytes32(0)) {
                revert ValidatorAlreadyExists();
            }

            s.validatorPKs[hashedPk] = bytes32(uint256(keccak256(abi.encodePacked(operatorIds))) | uint256(0x01)); // set LSB to 1
        }
        bytes32 hashedCluster = keccak256(abi.encodePacked(msg.sender, operatorIds));

        {
            bytes32 clusterData = s.clusters[hashedCluster];
            if (clusterData == bytes32(0)) {
                if (
                    cluster.validatorCount != 0 ||
                    cluster.networkFeeIndex != 0 ||
                    cluster.index != 0 ||
                    cluster.balance != 0 ||
                    !cluster.active
                ) {
                    revert IncorrectClusterState();
                }
            } else if (clusterData != cluster.hashClusterData()) {
                revert IncorrectClusterState();
            } else {
                cluster.validateClusterIsNotLiquidated();
            }
        }

        cluster.balance += amount;

        uint64 burnRate;

        if (cluster.active) {
            uint64 clusterIndex;

            for (uint256 i; i < operatorsLength; ) {
                uint64 operatorId = operatorIds[i];
                {
                    if (i + 1 < operatorsLength) {
                        if (operatorId > operatorIds[i + 1]) {
                            revert UnsortedOperatorsList();
                        } else if (operatorId == operatorIds[i + 1]) {
                            revert OperatorsListNotUnique();
                        }
                    }
                }

                Operator memory operator = s.operators[operatorId];
                if (operator.snapshot.block == 0) {
                    revert OperatorDoesNotExist();
                }
                if (operator.whitelisted) {
                    address whitelisted = s.operatorsWhitelist[operatorId];
                    if (whitelisted != address(0) && whitelisted != msg.sender) {
                        revert CallerNotWhitelisted();
                    }
                }
                operator.updateSnapshot();
                if (++operator.validatorCount > sp.validatorsPerOperatorLimit) {
                    revert ExceedValidatorLimit();
                }
                clusterIndex += operator.snapshot.index;
                burnRate += operator.fee;

                s.operators[operatorId] = operator;

                unchecked {
                    ++i;
                }
            }
            cluster.updateClusterData(clusterIndex, sp.currentNetworkFeeIndex());

            sp.updateDAO(true, 1);
        }

        ++cluster.validatorCount;

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

        s.clusters[hashedCluster] = cluster.hashClusterData();

        if (amount != 0) {
            CoreLib.deposit(amount);
        }

        emit ValidatorAdded(msg.sender, operatorIds, publicKey, sharesData, cluster);
    }

    function removeValidator(
        bytes calldata publicKey,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external override {
        StorageData storage s = SSVStorage.load();

        bytes32 hashedValidator = ValidatorLib.validateState(publicKey, operatorIds, s);

        bytes32 hashedCluster = cluster.validateHashedCluster(msg.sender, operatorIds, s);

        {
            if (cluster.active) {
                StorageProtocol storage sp = SSVStorageProtocol.load();
                (uint64 clusterIndex, ) = OperatorLib.updateOperators(operatorIds, false, 1, s, sp);

                cluster.updateClusterData(clusterIndex, sp.currentNetworkFeeIndex());

                sp.updateDAO(false, 1);
            }
        }

        --cluster.validatorCount;

        delete s.validatorPKs[hashedValidator];

        s.clusters[hashedCluster] = cluster.hashClusterData();

        emit ValidatorRemoved(msg.sender, operatorIds, publicKey, cluster);
    }

    function liquidate(address clusterOwner, uint64[] calldata operatorIds, Cluster memory cluster) external override {
        StorageData storage s = SSVStorage.load();

        bytes32 hashedCluster = cluster.validateHashedCluster(clusterOwner, operatorIds, s);
        cluster.validateClusterIsNotLiquidated();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateOperators(
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

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateOperators(
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
            cluster.isLiquidatable(
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
                for (uint256 i; i < operatorsLength; ) {
                    Operator storage operator = SSVStorage.load().operators[operatorIds[i]];
                    clusterIndex +=
                        operator.snapshot.index +
                        (uint64(block.number) - operator.snapshot.block) *
                        operator.fee;
                    burnRate += operator.fee;
                    unchecked {
                        ++i;
                    }
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

        s.clusters[hashedCluster] = cluster.hashClusterData();

        CoreLib.transferBalance(msg.sender, amount);

        emit ClusterWithdrawn(msg.sender, operatorIds, amount, cluster);
    }

    function exitValidator(bytes calldata publicKey, uint64[] calldata operatorIds) external override {
        ValidatorLib.validateState(publicKey, operatorIds, SSVStorage.load());

        emit ValidatorExited(msg.sender, operatorIds, publicKey);
    }
}
