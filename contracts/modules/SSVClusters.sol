// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/ISSVClusters.sol";
import "../libraries/ClusterLib.sol";
import "../libraries/TokenClusterLib.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/ProtocolLib.sol";
import "../libraries/CoreLib.sol";
import "../libraries/SSVStorage.sol";
import "../libraries/SSVStorageProtocol.sol";

contract SSVClusters is ISSVClusters {
    using ClusterLib for Cluster;
    using TokenClusterLib for TokenCluster;
    using OperatorLib for Operator;
    using ProtocolLib for StorageProtocol;
    uint64 private constant MIN_OPERATORS_LENGTH = 4;
    uint64 private constant MAX_OPERATORS_LENGTH = 13;
    uint64 private constant MODULO_OPERATORS_LENGTH = 3;
    uint64 private constant PUBLIC_KEY_LENGTH = 48;

    // only SSV
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
                    cluster.ssvBalance != 0 ||
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

        cluster.ssvBalance += amount;

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
            CoreLib.deposit(amount, s.token);
        }

        emit ValidatorAdded(msg.sender, operatorIds, publicKey, sharesData, cluster);
    }

    // using TokenCluster
    function registerTokenValidator(
        bytes calldata publicKey,
        uint64[] calldata operatorIds,
        bytes calldata sharesData,
        uint256 ssvAmount,
        uint256 tokenAmount,
        TokenCluster memory cluster
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
            bytes32 clusterData = s.tokenClusters[hashedCluster];
            if (clusterData == bytes32(0)) {
                Cluster memory base = cluster.base;
                if (
                    base.validatorCount != 0 ||
                    base.networkFeeIndex != 0 ||
                    base.index != 0 ||
                    base.ssvBalance != 0 ||
                    !base.active ||
                    cluster.tokenBalance != 0 ||
                    address(cluster.tokenAddress) == address(0)
                ) {
                    revert IncorrectClusterState();
                }
                cluster.tokenAddress = cluster.tokenAddress;
            } else if (clusterData != cluster.hashClusterData()) {
                revert IncorrectClusterState();
            } else {
                cluster.validateClusterIsNotLiquidated();
            }
        }

        cluster.base.ssvBalance += ssvAmount;
        cluster.tokenBalance += tokenAmount;

        uint64 burnRate;

        if (cluster.base.active) {
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

                // check if the deposit token is the same as operator's fee token
                if (operator.feeToken != cluster.tokenAddress) {
                    revert FeeTokenMismatch();
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

        ++cluster.base.validatorCount;

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

        s.tokenClusters[hashedCluster] = cluster.hashClusterData();

        if (ssvAmount != 0) {
            CoreLib.deposit(ssvAmount, s.token);
        }

        if (tokenAmount != 0) {
            CoreLib.deposit(tokenAmount, cluster.tokenAddress);
        }
        emit ValidatorAdded(msg.sender, publicKey, cluster);
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
        if ((validatorData & mask) != hashedOperatorIds) {
            // Clear LSB of stored validator data and compare
            revert IncorrectValidatorState();
        }

        bytes32 hashedCluster = cluster.validateHashedCluster(msg.sender, operatorIds, s);

        {
            if (cluster.active) {
                (uint64 clusterIndex, ) = OperatorLib.updateOperators(operatorIds, false, 1, s);
                StorageProtocol storage sp = SSVStorageProtocol.load();

                cluster.updateClusterData(clusterIndex, sp.currentNetworkFeeIndex());

                sp.updateDAO(false, 1);
            }
        }

        --cluster.validatorCount;

        delete s.validatorPKs[hashedValidator];

        s.clusters[hashedCluster] = cluster.hashClusterData();

        emit ValidatorRemoved(msg.sender, operatorIds, publicKey, cluster);
    }

    function liquidate(address clusterOwner, uint64[] memory operatorIds, Cluster memory cluster) external override {
        StorageData storage s = SSVStorage.load();

        bytes32 hashedCluster = cluster.validateHashedCluster(clusterOwner, operatorIds, s);
        cluster.validateClusterIsNotLiquidated();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateOperators(
            operatorIds,
            false,
            cluster.validatorCount,
            s
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

        if (cluster.ssvBalance != 0) {
            balanceLiquidatable = cluster.ssvBalance;
            cluster.ssvBalance = 0;
        }
        cluster.index = 0;
        cluster.networkFeeIndex = 0;
        cluster.active = false;

        s.clusters[hashedCluster] = cluster.hashClusterData();

        if (balanceLiquidatable != 0) {
            CoreLib.transferBalance(msg.sender, balanceLiquidatable, s.token);
        }

        emit ClusterLiquidated(clusterOwner, operatorIds, cluster);
    }

    // TokenCluster
    function liquidate(
        address clusterOwner,
        uint64[] memory operatorIds,
        TokenCluster memory cluster
    ) external override {
        StorageData storage s = SSVStorage.load();

        bytes32 hashedCluster = cluster.validateHashedCluster(clusterOwner, operatorIds, s);
        cluster.validateClusterIsNotLiquidated();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateOperators(
            operatorIds,
            false,
            cluster.base.validatorCount,
            s
        );

        cluster.updateBalance(clusterIndex, sp.currentNetworkFeeIndex());

        uint256 ssvBalanceLiquidatable;
        uint256 tokenBalanceLiquidatable;

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

        sp.updateDAO(false, cluster.base.validatorCount);

        if (cluster.base.ssvBalance != 0) {
            ssvBalanceLiquidatable = cluster.base.ssvBalance;
            cluster.base.ssvBalance = 0;
        }
        if (cluster.tokenBalance != 0) {
            tokenBalanceLiquidatable = cluster.tokenBalance;
            cluster.tokenBalance = 0;
        }
        cluster.base.index = 0;
        cluster.base.networkFeeIndex = 0;
        cluster.base.active = false;

        s.tokenClusters[hashedCluster] = cluster.hashClusterData();

        if (ssvBalanceLiquidatable != 0) {
            CoreLib.transferBalance(msg.sender, ssvBalanceLiquidatable, s.token);
        }
        if (tokenBalanceLiquidatable != 0) {
            CoreLib.transferBalance(msg.sender, tokenBalanceLiquidatable, cluster.tokenAddress);
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
            s
        );

        cluster.ssvBalance += amount;
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
            CoreLib.deposit(amount, s.token);
        }

        emit ClusterReactivated(msg.sender, operatorIds, cluster);
    }

    function deposit(
        address clusterOwner,
        uint64[] calldata operatorIds,
        uint256 ssvAmount,
        Cluster memory cluster
    ) external override {
        StorageData storage s = SSVStorage.load();

        bytes32 hashedCluster = cluster.validateHashedCluster(clusterOwner, operatorIds, s);

        cluster.ssvBalance += ssvAmount;

        s.clusters[hashedCluster] = cluster.hashClusterData();

        CoreLib.deposit(ssvAmount, s.token);

        emit ClusterDeposited(clusterOwner, operatorIds, ssvAmount, cluster);
    }

    function depositToken(
        address clusterOwner,
        uint64[] calldata operatorIds,
        uint256 tokenAmount,
        IERC20 tokenAddress,
        TokenCluster memory cluster
    ) external override {
        StorageData storage s = SSVStorage.load();

        bytes32 hashedCluster = cluster.validateHashedCluster(clusterOwner, operatorIds, s);

        cluster.tokenBalance += tokenAmount;

        s.clusters[hashedCluster] = cluster.hashClusterData();

        CoreLib.deposit(tokenAmount, tokenAddress);

        emit ClusterDeposited(clusterOwner, operatorIds, tokenAmount, tokenAddress, cluster);
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
        if (cluster.ssvBalance < amount) revert InsufficientBalance();

        cluster.ssvBalance -= amount;

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

        CoreLib.transferBalance(msg.sender, amount, s.token);

        emit ClusterWithdrawn(msg.sender, operatorIds, amount, cluster);
    }
}
