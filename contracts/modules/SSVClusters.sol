// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/functions/IFnSSVClusters.sol";
import "../interfaces/events/IEvSSVClusters.sol";
import "../libraries/Types.sol";
import "../libraries/ClusterLib.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/NetworkLib.sol";
import "../libraries/CoreLib.sol";
import "../libraries/SSVStorage.sol";

contract SSVClusters is IFnSSVClusters, IEvSSVClusters {
    using ClusterLib for Cluster;
    using OperatorLib for Operator;
    using NetworkLib for Network;
    using NetworkLib for DAO;

    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesData,
        uint256 amount,
        Cluster memory cluster
    ) external override {
        uint operatorsLength = operatorIds.length;
        {
            if (operatorsLength < 4 || operatorsLength > 13 || operatorsLength % 3 != 1) {
                revert InvalidOperatorIdsLength();
            }

            if (publicKey.length != 48) revert InvalidPublicKeyLength();

            bytes32 hashedPk = keccak256(abi.encodePacked(publicKey, msg.sender));

            if (SSVStorage.load().validatorPKs[hashedPk].hashedOperatorIds != bytes32(0)) {
                revert ValidatorAlreadyExists();
            }
            SSVStorage.load().validatorPKs[hashedPk] = Validator({
                hashedOperatorIds: keccak256(abi.encodePacked(operatorIds)),
                active: true
            });
        }
        bytes32 hashedCluster = keccak256(abi.encodePacked(msg.sender, operatorIds));

        {
            bytes32 clusterData = SSVStorage.load().clusters[hashedCluster];
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
            } else if (
                clusterData !=
                keccak256(
                    abi.encodePacked(
                        cluster.validatorCount,
                        cluster.networkFeeIndex,
                        cluster.index,
                        cluster.balance,
                        cluster.active
                    )
                )
            ) {
                revert IncorrectClusterState();
            } else {
                cluster.validateClusterIsNotLiquidated();
            }
        }

        Network storage network_ = SSVStorage.load().network;
        uint64 currentNetworkFeeIndex = NetworkLib.currentNetworkFeeIndex(network_);

        cluster.balance += amount;

        uint64 burnRate;
        uint64 clusterIndex;

        if (cluster.active) {
            for (uint i; i < operatorsLength; ) {
                {
                    if (i + 1 < operatorsLength) {
                        if (operatorIds[i] > operatorIds[i + 1]) {
                            revert UnsortedOperatorsList();
                        } else if (operatorIds[i] == operatorIds[i + 1]) {
                            revert OperatorsListNotUnique();
                        }
                    }
                    if (
                        SSVStorage.load().operatorsWhitelist[operatorIds[i]] != address(0) &&
                        SSVStorage.load().operatorsWhitelist[operatorIds[i]] != msg.sender
                    ) {
                        revert CallerNotWhitelisted();
                    }
                }
                Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
                if (operator.snapshot.block == 0) {
                    revert OperatorDoesNotExist();
                }
                operator.updateSnapshot();
                if (++operator.validatorCount > SSVStorage.load().validatorsPerOperatorLimit) {
                    revert ExceedValidatorLimit();
                }
                clusterIndex += operator.snapshot.index;
                burnRate += operator.fee;
                SSVStorage.load().operators[operatorIds[i]] = operator;
                unchecked {
                    ++i;
                }
            }
            cluster.updateClusterData(clusterIndex, currentNetworkFeeIndex);

            DAO memory dao_ = SSVStorage.load().dao;
            dao_.updateDAOEarnings(network_.networkFee);
            ++dao_.validatorCount;
            SSVStorage.load().dao = dao_;
        }

        ++cluster.validatorCount;

        if (
            cluster.isLiquidatable(
                burnRate,
                network_.networkFee,
                SSVStorage.load().minimumBlocksBeforeLiquidation,
                SSVStorage.load().minimumLiquidationCollateral
            )
        ) {
            revert InsufficientBalance();
        }

        SSVStorage.load().clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
            )
        );

        if (amount > 0) {
            _deposit(amount);
        }

        emit ValidatorAdded(msg.sender, operatorIds, publicKey, sharesData, cluster);
    }

    function removeValidator(
        bytes calldata publicKey,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external override {
        SSVStorage.StorageData storage ssvStorage = SSVStorage.load();

        bytes32 hashedValidator = keccak256(abi.encodePacked(publicKey, msg.sender));

        bytes32 validatorHashedOpsIds = ssvStorage.validatorPKs[hashedValidator].hashedOperatorIds;

        if (validatorHashedOpsIds == bytes32(0)) {
            revert ValidatorDoesNotExist();
        } else if (validatorHashedOpsIds != keccak256(abi.encodePacked(operatorIds))) {
            revert IncorrectValidatorState();
        }

        bytes32 hashedCluster = cluster.validateHashedCluster(msg.sender, operatorIds);

        {
            if (cluster.active) {
                (uint64 clusterIndex, ) = _updateOperators(operatorIds, false, 1);

                cluster.updateClusterData(clusterIndex, NetworkLib.currentNetworkFeeIndex(ssvStorage.network));

                DAO memory dao_ = ssvStorage.dao;
                dao_.updateDAOEarnings(ssvStorage.network.networkFee);
                --dao_.validatorCount;
                ssvStorage.dao = dao_;
            }
        }

        --cluster.validatorCount;

        delete ssvStorage.validatorPKs[hashedValidator];

        ssvStorage.clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
            )
        );

        emit ValidatorRemoved(msg.sender, operatorIds, publicKey, cluster);
    }

    function liquidate(address owner, uint64[] calldata operatorIds, Cluster memory cluster) external override {
        bytes32 hashedCluster = cluster.validateHashedCluster(owner, operatorIds);
        cluster.validateClusterIsNotLiquidated();

        (uint64 clusterIndex, uint64 burnRate) = _updateOperators(operatorIds, false, cluster.validatorCount);

        cluster.updateBalance(clusterIndex, NetworkLib.currentNetworkFeeIndex(SSVStorage.load().network));

        uint64 networkFee = SSVStorage.load().network.networkFee;
        uint256 balanceLiquidatable;

        if (
            owner != msg.sender &&
            !cluster.isLiquidatable(
                burnRate,
                networkFee,
                SSVStorage.load().minimumBlocksBeforeLiquidation,
                SSVStorage.load().minimumLiquidationCollateral
            )
        ) {
            revert ClusterNotLiquidatable();
        }

        DAO memory dao_ = SSVStorage.load().dao;
        dao_.updateDAOEarnings(networkFee);
        dao_.validatorCount -= cluster.validatorCount;
        SSVStorage.load().dao = dao_;

        if (cluster.balance != 0) {
            balanceLiquidatable = cluster.balance;
            cluster.balance = 0;
        }
        cluster.index = 0;
        cluster.networkFeeIndex = 0;
        cluster.active = false;

        SSVStorage.load().clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
            )
        );

        if (balanceLiquidatable != 0) {
            CoreLib.transfer(msg.sender, balanceLiquidatable);
        }

        emit ClusterLiquidated(owner, operatorIds, cluster);
    }

    function reactivate(uint64[] calldata operatorIds, uint256 amount, Cluster memory cluster) external override {
        bytes32 hashedCluster = cluster.validateHashedCluster(msg.sender, operatorIds);
        if (cluster.active) revert ClusterAlreadyEnabled();

        (uint64 clusterIndex, uint64 burnRate) = _updateOperators(operatorIds, true, cluster.validatorCount);

        uint64 currentNetworkFeeIndex = NetworkLib.currentNetworkFeeIndex(SSVStorage.load().network);

        cluster.balance += amount;
        cluster.active = true;
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = currentNetworkFeeIndex;

        uint64 networkFee = SSVStorage.load().network.networkFee;

        DAO memory dao_ = SSVStorage.load().dao;
        dao_.updateDAOEarnings(networkFee);
        dao_.validatorCount += cluster.validatorCount;
        SSVStorage.load().dao = dao_;

        if (
            cluster.isLiquidatable(
                burnRate,
                networkFee,
                SSVStorage.load().minimumBlocksBeforeLiquidation,
                SSVStorage.load().minimumLiquidationCollateral
            )
        ) {
            revert InsufficientBalance();
        }

        SSVStorage.load().clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
            )
        );

        if (amount > 0) {
            _deposit(amount);
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

        SSVStorage.load().clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
            )
        );

        _deposit(amount);

        emit ClusterDeposited(owner, operatorIds, amount, cluster);
    }

    function withdraw(uint64[] calldata operatorIds, uint256 amount, Cluster memory cluster) external override {
        bytes32 hashedCluster = cluster.validateHashedCluster(msg.sender, operatorIds);
        cluster.validateClusterIsNotLiquidated();

        uint64 clusterIndex;
        uint64 burnRate;
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

        cluster.updateClusterData(clusterIndex, SSVStorage.load().network.currentNetworkFeeIndex());

        if (cluster.balance < amount) revert InsufficientBalance();

        cluster.balance -= amount;

        if (
            cluster.isLiquidatable(
                burnRate,
                SSVStorage.load().network.networkFee,
                SSVStorage.load().minimumBlocksBeforeLiquidation,
                SSVStorage.load().minimumLiquidationCollateral
            )
        ) {
            revert InsufficientBalance();
        }

        SSVStorage.load().clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
            )
        );

        CoreLib.transfer(msg.sender, amount);

        emit ClusterWithdrawn(msg.sender, operatorIds, amount, cluster);
    }

    // Private functions
    function _deposit(uint256 amount) private {
        if (!SSVStorage.load().token.transferFrom(msg.sender, address(this), amount)) {
            revert TokenTransferFailed();
        }
    }

    function _updateOperators(
        uint64[] calldata operatorIds,
        bool increaseValidatorCount,
        uint32 deltaValidatorCount
    ) private returns (uint64 clusterIndex, uint64 burnRate) {
        uint operatorsLength = operatorIds.length;

        for (uint i; i < operatorsLength; ) {
            Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
            if (operator.snapshot.block != 0) {
                operator.updateSnapshot();
                if (increaseValidatorCount) {
                    operator.validatorCount += deltaValidatorCount;
                } else {
                    operator.validatorCount -= deltaValidatorCount;
                }
                burnRate += operator.fee;
                SSVStorage.load().operators[operatorIds[i]] = operator;
            }

            clusterIndex += operator.snapshot.index;
            unchecked {
                ++i;
            }
        }
    }
}
