// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./ISSVClusters.sol";
import "./libraries/Types.sol";
import "./libraries/ClusterLib.sol";
import "./libraries/OperatorLib.sol";
import "./libraries/NetworkLib.sol";
import "./libraries/SSVStorage.sol";

contract SSVClusters is ISSVClusters {
    using ClusterLib for Cluster;
    using OperatorLib for Operator;
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

            if (SSVStorage.getStorage().validatorPKs[hashedPk].hashedOperatorIds != bytes32(0)) {
                revert ValidatorAlreadyExists();
            }
            SSVStorage.getStorage().validatorPKs[hashedPk] = Validator({
                hashedOperatorIds: keccak256(abi.encodePacked(operatorIds)),
                active: true
            });
        }
        bytes32 hashedCluster = keccak256(abi.encodePacked(msg.sender, operatorIds));

        {
            bytes32 clusterData = SSVStorage.getStorage().clusters[hashedCluster];
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

        Network memory network_ = SSVStorage.getStorage().network;
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
                        SSVStorage.getStorage().operatorsWhitelist[operatorIds[i]] != address(0) &&
                        SSVStorage.getStorage().operatorsWhitelist[operatorIds[i]] != msg.sender
                    ) {
                        revert CallerNotWhitelisted();
                    }
                }
                Operator storage operator = SSVStorage.getStorage().operators[operatorIds[i]];
                if (operator.snapshot.block == 0) {
                    revert OperatorDoesNotExist();
                }
                operator.updateSnapshot();
                if (++operator.validatorCount > SSVStorage.getStorage().validatorsPerOperatorLimit) {
                    revert ExceedValidatorLimit();
                }
                clusterIndex += operator.snapshot.index;
                burnRate += operator.fee;
                SSVStorage.getStorage().operators[operatorIds[i]] = operator;
                unchecked {
                    ++i;
                }
            }
            cluster.updateClusterData(clusterIndex, currentNetworkFeeIndex);

            DAO memory dao_ = SSVStorage.getStorage().dao;
            dao_.updateDAOEarnings(network_.networkFee);
            ++dao_.validatorCount;
            SSVStorage.getStorage().dao = dao_;
        }

        ++cluster.validatorCount;

        if (
            cluster.isLiquidatable(
                burnRate,
                network_.networkFee,
                SSVStorage.getStorage().minimumBlocksBeforeLiquidation,
                SSVStorage.getStorage().minimumLiquidationCollateral
            )
        ) {
            revert InsufficientBalance();
        }

        SSVStorage.getStorage().clusters[hashedCluster] = keccak256(
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

    function _deposit(uint256 amount) private {
        if (!SSVStorage.getStorage().token.transferFrom(msg.sender, address(this), amount)) {
            revert TokenTransferFailed();
        }
    }
}
