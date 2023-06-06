// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/functions/IFnSSVClusters.sol";
import "../interfaces/events/IEvSSVClusters.sol";
import "../libraries/Types.sol";
import "../libraries/ClusterLib.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/DAOLib.sol";
import "../libraries/NetworkLib.sol";
import "../libraries/CoreLib.sol";
import "../libraries/SSVStorage.sol";

contract SSVClusters is IFnSSVClusters, IEvSSVClusters {
    using ClusterLib for Cluster;
    using OperatorLib for Operator;
    using NetworkLib for Network;
    using DAOLib for DAO;

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

        uint operatorsLength = operatorIds.length;
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

            for (uint i; i < operatorsLength; ) {
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
                if (
                    operator.whitelisted &&
                    s.operatorsWhitelist[operatorId] != address(0) &&
                    s.operatorsWhitelist[operatorId] != msg.sender
                ) {
                    revert CallerNotWhitelisted();
                }
                operator.updateSnapshot();
                if (++operator.validatorCount > s.validatorsPerOperatorLimit) {
                    revert ExceedValidatorLimit();
                }
                clusterIndex += operator.snapshot.index;
                burnRate += operator.fee;

                s.operators[operatorId] = operator;

                unchecked {
                    ++i;
                }
            }
            cluster.updateClusterData(clusterIndex, s.network.currentNetworkFeeIndex());

            s.dao.updateDAO(true, 1);
        }

        ++cluster.validatorCount;

        if (
            cluster.isLiquidatable(
                burnRate,
                s.network.networkFee,
                s.minimumBlocksBeforeLiquidation,
                s.minimumLiquidationCollateral
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

        bytes32 hashedValidator = keccak256(abi.encodePacked(publicKey, msg.sender));

        bytes32 mask = ~bytes32(uint256(1)); // All bits set to 1 except LSB
        bytes32 validatorData = s.validatorPKs[hashedValidator];
        
        if (validatorData == bytes32(0)) {
            revert ValidatorDoesNotExist();
        }

        bytes32 hashedOperatorIds = keccak256(abi.encodePacked(operatorIds)) & mask; // Clear LSB of provided operator ids
        if ((validatorData & mask) != hashedOperatorIds) { // Clear LSB of stored validator data and compare
            revert IncorrectValidatorState();
        }

        bytes32 hashedCluster = cluster.validateHashedCluster(msg.sender, operatorIds);

        {
            if (cluster.active) {
                (uint64 clusterIndex, ) = OperatorLib.updateOperators(operatorIds, false, 1, s);

                cluster.updateClusterData(clusterIndex, s.network.currentNetworkFeeIndex());

                s.dao.updateDAO(false, 1);
            }
        }

        --cluster.validatorCount;

        delete s.validatorPKs[hashedValidator];

        s.clusters[hashedCluster] = cluster.hashClusterData();

        emit ValidatorRemoved(msg.sender, operatorIds, publicKey, cluster);
    }

    function liquidate(address owner, uint64[] memory operatorIds, Cluster memory cluster) external override {
        bytes32 hashedCluster = cluster.validateHashedCluster(owner, operatorIds);
        cluster.validateClusterIsNotLiquidated();

        StorageData storage s = SSVStorage.load();

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateOperators(
            operatorIds,
            false,
            cluster.validatorCount,
            s
        );

        cluster.updateBalance(clusterIndex, s.network.currentNetworkFeeIndex());

        uint256 balanceLiquidatable;

        if (
            owner != msg.sender &&
            !cluster.isLiquidatable(
                burnRate,
                s.network.networkFee,
                s.minimumBlocksBeforeLiquidation,
                s.minimumLiquidationCollateral
            )
        ) {
            revert ClusterNotLiquidatable();
        }

        s.dao.updateDAO(false, cluster.validatorCount);

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

        emit ClusterLiquidated(owner, operatorIds, cluster);
    }

    function reactivate(uint64[] calldata operatorIds, uint256 amount, Cluster memory cluster) external override {
        bytes32 hashedCluster = cluster.validateHashedCluster(msg.sender, operatorIds);
        if (cluster.active) revert ClusterAlreadyEnabled();

        StorageData storage s = SSVStorage.load();

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateOperators(operatorIds, true, cluster.validatorCount, s);

        cluster.balance += amount;
        cluster.active = true;
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = s.network.currentNetworkFeeIndex();

        uint64 networkFee = s.network.networkFee;

        s.dao.updateDAO(true, cluster.validatorCount);

        if (
            cluster.isLiquidatable(
                burnRate,
                networkFee,
                s.minimumBlocksBeforeLiquidation,
                s.minimumLiquidationCollateral
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
        address owner,
        uint64[] calldata operatorIds,
        uint256 amount,
        Cluster memory cluster
    ) external override {
        bytes32 hashedCluster = cluster.validateHashedCluster(owner, operatorIds);

        cluster.balance += amount;

        SSVStorage.load().clusters[hashedCluster] = cluster.hashClusterData();

        CoreLib.deposit(amount);

        emit ClusterDeposited(owner, operatorIds, amount, cluster);
    }

    function withdraw(uint64[] calldata operatorIds, uint256 amount, Cluster memory cluster) external override {
        bytes32 hashedCluster = cluster.validateHashedCluster(msg.sender, operatorIds);
        cluster.validateClusterIsNotLiquidated();

        StorageData storage s = SSVStorage.load();

        uint64 burnRate;
        if (cluster.active) {
            uint64 clusterIndex;
            {
                uint operatorsLength = operatorIds.length;
                for (uint i; i < operatorsLength; ) {
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

            cluster.updateClusterData(clusterIndex, s.network.currentNetworkFeeIndex());
        }
        if (cluster.balance < amount) revert InsufficientBalance();

        cluster.balance -= amount;

        if (
            cluster.active &&
            cluster.validatorCount != 0 &&
            cluster.isLiquidatable(
                burnRate,
                s.network.networkFee,
                s.minimumBlocksBeforeLiquidation,
                s.minimumLiquidationCollateral
            )
        ) {
            revert InsufficientBalance();
        }

        s.clusters[hashedCluster] = cluster.hashClusterData();

        CoreLib.transferBalance(msg.sender, amount);

        emit ClusterWithdrawn(msg.sender, operatorIds, amount, cluster);
    }
}
