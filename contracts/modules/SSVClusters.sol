// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/ISSVClusters.sol";
import "../libraries/ClusterLib.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/ProtocolLib.sol";
import "../libraries/CoreLib.sol";
import "../libraries/SSVStorage.sol";
import "../libraries/SSVStorageProtocol.sol";

contract SSVClusters is ISSVClusters {
    using ClusterLib for Cluster;
    using OperatorLib for Operator;
    using ProtocolLib for StorageProtocol;
    using Types256 for uint256;

    uint64 private constant MIN_OPERATORS_LENGTH = 4;
    uint64 private constant MAX_OPERATORS_LENGTH = 13;
    uint64 private constant MODULO_OPERATORS_LENGTH = 3;
    uint64 private constant PUBLIC_KEY_LENGTH = 48;

    // legacy cluster
    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesData,
        uint256 feeAmount,
        Cluster memory cluster
    ) external {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint256 operatorsLength = operatorIds.length;

        if (
            operatorsLength < MIN_OPERATORS_LENGTH ||
            operatorsLength > MAX_OPERATORS_LENGTH ||
            operatorsLength % MODULO_OPERATORS_LENGTH != 1
        ) {
            revert InvalidOperatorIdsLength();
        }

        registerValidatorPublicKey(publicKey, operatorIds, s);

        bytes32 hashedCluster = cluster.validateClusterOnRegistration(
            keccak256(abi.encodePacked(msg.sender, operatorIds)),
            s
        );

        bytes32 account = keccak256(abi.encodePacked(msg.sender));
        Account memory accountData = s.accounts[account];

        uint64 burnRate = cluster.updateClusterOnRegistration(
            feeAmount,
            operatorsLength,
            operatorIds,
            IERC20(address(0)),
            accountData,
            s,
            sp,
            false
        );

        if (
            cluster.isLiquidatable(
                burnRate,
                sp.networkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral,
                accountData,
                false
            )
        ) {
            revert InsufficientBalance();
        }

        s.clusters[hashedCluster] = cluster.hashClusterData();

        if (feeAmount != 0) {
            CoreLib.deposit(feeAmount, s.token);
        }

        emit ValidatorAdded(msg.sender, operatorIds, publicKey, sharesData, cluster);
    }

    // token cluster
    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesData,
        uint256 feeAmount,
        IERC20 feeToken,
        uint256 ssvAmount,
        Cluster memory cluster
    ) external override {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint256 operatorsLength = operatorIds.length;

        if (
            operatorsLength < MIN_OPERATORS_LENGTH ||
            operatorsLength > MAX_OPERATORS_LENGTH ||
            operatorsLength % MODULO_OPERATORS_LENGTH != 1
        ) {
            revert InvalidOperatorIdsLength();
        }

        registerValidatorPublicKey(publicKey, operatorIds, s);

        bytes32 hashedCluster = cluster.validateClusterOnRegistration(
            keccak256(abi.encodePacked(msg.sender, operatorIds, feeToken)),
            s
        );

        bytes32 account = keccak256(abi.encodePacked(msg.sender));
        Account memory accountData = s.accounts[account];
        ++accountData.validatorCount;
        accountData.ssvBalance += ssvAmount.shrink();

        uint64 burnRate = cluster.updateClusterOnRegistration(
            feeAmount,
            operatorsLength,
            operatorIds,
            feeToken,
            accountData,
            s,
            sp,
            true
        );

        if (
            cluster.isLiquidatable(
                burnRate,
                sp.networkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral,
                accountData,
                true
            )
        ) {
            revert InsufficientBalance();
        }

        s.clusters[hashedCluster] = cluster.hashClusterData();

        if (feeAmount != 0) {
            CoreLib.deposit(feeAmount, s.token);
        }

        if (ssvAmount != 0) {
            CoreLib.deposit(feeAmount, s.token);
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
        if ((validatorData & mask) != hashedOperatorIds) {
            // Clear LSB of stored validator data and compare
            revert IncorrectValidatorState();
        }

        bytes32 hashedCluster = cluster.validateCluster(msg.sender, operatorIds, s);

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

        // not sure about the usage of Account.validatorCount for now
        // --s.accounts[keccak256(abi.encodePacked(msg.sender))].validatorCount;

        emit ValidatorRemoved(msg.sender, operatorIds, publicKey, cluster);
    }

    // legacy clusters
    function liquidate(address clusterOwner, uint64[] memory operatorIds, Cluster memory cluster) external override {
        cluster.liquidateCluster(
            clusterOwner,
            operatorIds,
            keccak256(abi.encodePacked(msg.sender, operatorIds)),
            SSVStorage.load().token,
            false
        );

        emit ClusterLiquidated(clusterOwner, operatorIds, cluster);
    }

    // token cluster
    function liquidate(
        address clusterOwner,
        uint64[] memory operatorIds,
        IERC20 feeToken,
        Cluster memory cluster
    ) external override {
        cluster.liquidateCluster(
            clusterOwner,
            operatorIds,
            keccak256(abi.encodePacked(msg.sender, operatorIds, feeToken)),
            feeToken,
            true
        );

        emit ClusterLiquidated(clusterOwner, operatorIds, cluster);
    }

    // legacy cluster
    function reactivate(uint64[] calldata operatorIds, uint256 ssvAmount, Cluster memory cluster) external override {
        cluster.reactivateCluster(
            keccak256(abi.encodePacked(msg.sender, operatorIds)),
            operatorIds,
            feeAmount,
            feeToken,
            ssvAmount,
            true
        );
        emit ClusterReactivated(msg.sender, operatorIds, cluster);
    }

    // token cluster
    function reactivate(
        uint64[] calldata operatorIds,
        uint256 feeAmount,
        IERC20 feeToken,
        uint256 ssvAmount,
        Cluster memory cluster
    ) external override {
        cluster.reactivateCluster(
            keccak256(abi.encodePacked(msg.sender, operatorIds, feeToken)),
            operatorIds,
            feeAmount,
            feeToken,
            ssvAmount,
            true
        );
        emit ClusterReactivated(msg.sender, operatorIds, cluster);
    }

    function depositNetworkFees(address accountOwner, uint256 ssvAmount) external {
        StorageData storage s = SSVStorage.load();

        bytes32 account = keccak256(abi.encodePacked(msg.sender));
        Account memory accountData = s.accounts[account];

        accountData.ssvBalance += ssvAmount;

        CoreLib.deposit(ssvAmount, s.token);
    }

    // legacy cluster
    function depositClusterBalance(
        address clusterOwner,
        uint64[] calldata operatorIds,
        uint256 ssvAmount,
        Cluster memory cluster
    ) external override {
        cluster.deposit(keccak256(abi.encodePacked(clusterOwner, operatorIds)), SSVStorage.load().token, ssvAmount);

        emit ClusterDeposited(clusterOwner, operatorIds, ssvAmount, cluster);
    }

    // token cluster
    function depositClusterBalance(
        address clusterOwner,
        uint64[] calldata operatorIds,
        uint256 feeAmount,
        IERC20 feeToken,
        Cluster memory cluster
    ) external override {
        // add check to match feeToken with Operator.feeToken
        cluster.deposit(
            clusterOwner,
            keccak256(abi.encodePacked(clusterOwner, operatorIds, feeToken)),
            feeToken,
            feeAmount
        );

        emit ClusterTokenDeposited(clusterOwner, operatorIds, feeToken, feeAmount, cluster);
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

    function registerValidatorPublicKey(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        StorageData storage s
    ) private {
        if (publicKey.length != PUBLIC_KEY_LENGTH) revert ISSVNetworkCore.InvalidPublicKeyLength();

        bytes32 hashedPk = keccak256(abi.encodePacked(publicKey, msg.sender));

        if (s.validatorPKs[hashedPk] != bytes32(0)) {
            revert ISSVNetworkCore.ValidatorAlreadyExists();
        }

        s.validatorPKs[hashedPk] = bytes32(uint256(keccak256(abi.encodePacked(operatorIds))) | uint256(0x01)); // set LSB to 1
    }
}
