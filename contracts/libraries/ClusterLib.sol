// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/ISSVNetworkCore.sol";
import "./SSVStorage.sol";
import "./SSVStorageProtocol.sol";
import "./CoreLib.sol";
import "./OperatorLib.sol";
import "./ProtocolLib.sol";
import "./Types.sol";

library ClusterLib {
    using Types64 for uint64;
    using Types256 for uint256;
    using OperatorLib for ISSVNetworkCore.Operator;
    using ProtocolLib for StorageProtocol;

    function updateClusterBalance(
        ISSVNetworkCore.Cluster memory cluster,
        uint64 newIndex,
        uint64 currentNetworkFeeIndex,
        ISSVNetworkCore.Account memory account,
        bool isTokenFee
    ) internal pure returns (uint64 clusterNetworkFee) {
        uint64 networkUsage = uint64(currentNetworkFeeIndex - cluster.networkFeeIndex) * cluster.validatorCount;
        uint64 operatorsUsage = (newIndex - cluster.index) * cluster.validatorCount;

        if (isTokenFee) {
            clusterNetworkFee = updateAccountBalance(networkUsage, account);
        } else {
            clusterNetworkFee = updateNetworkFeeBalance(cluster, networkUsage, account);
        }

        cluster.balance = operatorsUsage.expand() > cluster.balance ? 0 : cluster.balance - operatorsUsage.expand();
    }

    /*
    function updateBalance(ISSVNetworkCore.Cluster memory cluster, uint64 newIndex) internal pure {
        //uint64 networkFee = uint64(currentNetworkFeeIndex - cluster.networkFeeIndex) * cluster.validatorCount;
        uint64 usage = (newIndex - cluster.index) * cluster.validatorCount;
        cluster.balance = usage.expand() > cluster.balance ? 0 : cluster.balance - usage.expand();
    }
*/
    function updateNetworkFeeBalance(
        ISSVNetworkCore.Cluster memory cluster,
        uint64 networkUsage,
        ISSVNetworkCore.Account memory account
    ) internal pure returns (uint64 clusterNetworkFee) {
        // for legacy clusters check if the account has SSV balance to cover network fees
        if (account.ssvBalance != 0) {
            clusterNetworkFee = updateAccountBalance(networkUsage, account);
        } else {
            // if not, take the network fee from the cluster
            cluster.balance = networkUsage.expand() > cluster.balance ? 0 : cluster.balance - networkUsage.expand();
        }
    }

    function updateAccountBalance(
        uint64 networkUsage,
        ISSVNetworkCore.Account memory account
    ) internal pure returns (uint64 clusterNetworkFee) {
        if (networkUsage > account.ssvBalance) {
            clusterNetworkFee = account.ssvBalance;
            account.ssvBalance = 0;
        } else {
            clusterNetworkFee = networkUsage;
            account.ssvBalance -= networkUsage;
        }
    }

    function isLiquidatable(
        ISSVNetworkCore.Cluster memory cluster,
        uint64 burnRate,
        uint64 networkFee,
        uint64 minimumBlocksBeforeLiquidation,
        uint64 minimumLiquidationCollateral,
        ISSVNetworkCore.Account memory account,
        bool isTokenFee
    ) internal pure returns (bool) {
        uint64 networkLiquidationThreshold = minimumBlocksBeforeLiquidation * networkFee * cluster.validatorCount;
        if (isTokenFee) {
            // for new clusters, check only at the account level
            if (account.ssvBalance < minimumLiquidationCollateral && account.ssvBalance < networkLiquidationThreshold) {
                return true;
            }
        } else if (
            // for legacy clusters, check first at account level and then at cluster level
            account.ssvBalance < minimumLiquidationCollateral &&
            account.ssvBalance < networkLiquidationThreshold &&
            cluster.balance < minimumLiquidationCollateral &&
            cluster.balance < networkLiquidationThreshold
        ) {
            return true;
        }

        // Operators' fee check always against the cluster
        // if (cluster.balance < minimumLiquidationCollateral.expand()) return true; // TODO collateral by token type?
        uint64 operatorsLiquidationThreshold = minimumBlocksBeforeLiquidation * (burnRate) * cluster.validatorCount;

        return cluster.balance < operatorsLiquidationThreshold.expand();
    }

    function validateClusterIsNotLiquidated(ISSVNetworkCore.Cluster memory cluster) internal pure {
        if (!cluster.active) revert ISSVNetworkCore.ClusterIsLiquidated();
    }

    function validateCluster(
        ISSVNetworkCore.Cluster memory cluster,
        bytes32 hashedCluster,
        StorageData storage s
    ) internal view returns (bytes32) {
        bytes32 hashedClusterData = hashClusterData(cluster);

        bytes32 clusterData = s.clusters[hashedCluster];
        if (clusterData == bytes32(0)) {
            revert ISSVNetworkCore.ClusterDoesNotExists();
        } else if (clusterData != hashedClusterData) {
            revert ISSVNetworkCore.IncorrectClusterState();
        }

        return hashedCluster;
    }

    function updateClusterData(
        ISSVNetworkCore.Cluster memory cluster,
        uint64 clusterIndex,
        uint64 currentNetworkFeeIndex,
        ISSVNetworkCore.Account memory account,
        bool isTokenFee
    ) internal pure {
        updateClusterBalance(cluster, clusterIndex, currentNetworkFeeIndex, account, isTokenFee);
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = currentNetworkFeeIndex;
    }

    function hashClusterData(ISSVNetworkCore.Cluster memory cluster) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    cluster.validatorCount,
                    cluster.networkFeeIndex,
                    cluster.index,
                    cluster.balance,
                    cluster.active
                )
            );
    }

    function validateClusterOnRegistration(
        ISSVNetworkCore.Cluster memory cluster,
        bytes32 hashedCluster,
        StorageData storage s
    ) internal view returns (bytes32) {
        bytes32 clusterData = s.clusters[hashedCluster];
        if (clusterData == bytes32(0)) {
            if (
                cluster.validatorCount != 0 ||
                cluster.networkFeeIndex != 0 ||
                cluster.index != 0 ||
                cluster.balance != 0 ||
                !cluster.active
            ) {
                revert ISSVNetworkCore.IncorrectClusterState();
            }
        } else if (clusterData != hashClusterData(cluster)) {
            revert ISSVNetworkCore.IncorrectClusterState();
        } else {
            validateClusterIsNotLiquidated(cluster);
        }
        return hashedCluster;
    }

    function updateClusterOnRegistration(
        ISSVNetworkCore.Cluster memory cluster,
        uint256 feeAmount,
        uint256 operatorsLength,
        uint64[] memory operatorIds,
        IERC20 feeToken,
        ISSVNetworkCore.Account memory accountData,
        StorageData storage s,
        StorageProtocol storage sp,
        bool isTokenFee
    ) internal returns (uint64 burnRate) {
        cluster.balance += feeAmount;

        if (cluster.active) {
            uint64 clusterIndex;

            for (uint256 i; i < operatorsLength; ) {
                uint64 operatorId = operatorIds[i];
                {
                    if (i + 1 < operatorsLength) {
                        if (operatorId > operatorIds[i + 1]) {
                            revert ISSVNetworkCore.UnsortedOperatorsList();
                        } else if (operatorId == operatorIds[i + 1]) {
                            revert ISSVNetworkCore.OperatorsListNotUnique();
                        }
                    }
                }

                ISSVNetworkCore.Operator memory operator = s.operators[operatorId];
                if (operator.snapshot.block == 0) {
                    revert ISSVNetworkCore.OperatorDoesNotExist();
                }

                // check if the deposit token is the same as operator's fee token
                if (isTokenFee && operator.feeToken != feeToken) {
                    revert ISSVNetworkCore.FeeTokenMismatch();
                }
                if (operator.whitelisted) {
                    address whitelisted = s.operatorsWhitelist[operatorId];
                    if (whitelisted != address(0) && whitelisted != msg.sender) {
                        revert ISSVNetworkCore.CallerNotWhitelisted();
                    }
                }
                operator.updateSnapshot();
                if (++operator.validatorCount > sp.validatorsPerOperatorLimit) {
                    revert ISSVNetworkCore.ExceedValidatorLimit();
                }
                clusterIndex += operator.snapshot.index;
                burnRate += operator.fee;

                s.operators[operatorId] = operator;

                unchecked {
                    ++i;
                }
            }
            updateClusterData(cluster, clusterIndex, sp.currentNetworkFeeIndex());
            if (isTokenFee) {
                updateAccountBalance(cluster, sp.currentNetworkFeeIndex(), accountData);
            }
            sp.updateDAO(true, 1);
        }

        ++cluster.validatorCount;
    }

    function deposit(
        ISSVNetworkCore.Cluster memory cluster,
        bytes32 hashedCluster,
        IERC20 feeToken,
        uint256 feeAmount
    ) internal {
        StorageData storage s = SSVStorage.load();

        validateCluster(cluster, hashedCluster, s);

        cluster.balance += feeAmount;

        s.clusters[hashedCluster] = hashClusterData(cluster);

        CoreLib.deposit(feeAmount, feeToken);
    }

    function liquidateCluster(
        ISSVNetworkCore.Cluster memory cluster,
        address clusterOwner,
        uint64[] memory operatorIds,
        bytes32 hashedCluster,
        IERC20 feeToken,
        bool isTokenFee
    ) internal {
        StorageData storage s = SSVStorage.load();

        validateCluster(cluster, hashedCluster, s);
        validateClusterIsNotLiquidated(cluster);

        StorageProtocol storage sp = SSVStorageProtocol.load();

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateOperators(
            operatorIds,
            false,
            cluster.validatorCount,
            s
        );

        bytes32 account = keccak256(abi.encodePacked(clusterOwner));
        ISSVNetworkCore.Account memory accountData = s.accounts[account];

        uint64 clusterNetworkFee = updateClusterBalance(
            cluster,
            clusterIndex,
            sp.currentNetworkFeeIndex(),
            accountData,
            isTokenFee
        );

        if (
            clusterOwner != msg.sender &&
            !isLiquidatable(
                cluster,
                burnRate,
                sp.networkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral,
                accountData,
                isTokenFee
            )
        ) {
            revert ISSVNetworkCore.ClusterNotLiquidatable();
        }

        sp.updateDAO(false, cluster.validatorCount);

        uint256 balanceLiquidatable;

        if (cluster.balance != 0) {
            balanceLiquidatable = cluster.balance;
            cluster.balance = 0;
        }
        cluster.index = 0;
        cluster.networkFeeIndex = 0;
        cluster.active = false;

        s.clusters[hashedCluster] = hashClusterData(cluster);

        // accountData.validatorCount -= cluster.validatorCount;
        s.accounts[account] = accountData;

        if (balanceLiquidatable != 0) {
            CoreLib.transferBalance(msg.sender, balanceLiquidatable, feeToken);
        }

        if (clusterNetworkFee != 0) {
            CoreLib.transferBalance(msg.sender, clusterNetworkFee, s.token);
        }
    }

    function reactivateCluster(
        ISSVNetworkCore.Cluster memory cluster,
        bytes32 hashedCluster,
        uint64[] calldata operatorIds,
        uint256 feeAmount,
        IERC20 feeToken,
        uint256 ssvAmount,
        bool isTokenFee
    ) internal {
        StorageData storage s = SSVStorage.load();

        validateCluster(cluster, hashedCluster, s);
        if (cluster.active) revert ISSVNetworkCore.ClusterAlreadyEnabled();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        (uint64 clusterIndex, uint64 burnRate) = OperatorLib.updateOperators(
            operatorIds,
            true,
            cluster.validatorCount,
            s
        );

        cluster.balance += feeAmount;
        cluster.active = true;
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = sp.currentNetworkFeeIndex();

        sp.updateDAO(true, cluster.validatorCount);

        bytes32 account = keccak256(abi.encodePacked(msg.sender));
        ISSVNetworkCore.Account memory accountData = s.accounts[account];
        accountData.ssvBalance += ssvAmount.shrink();

        if (
            isLiquidatable(
                cluster,
                burnRate,
                sp.networkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral,
                accountData,
                isTokenFee
            )
        ) {
            revert ISSVNetworkCore.InsufficientBalance();
        }

        s.clusters[hashedCluster] = hashClusterData(cluster);

        if (feeAmount > 0) {
            CoreLib.deposit(feeAmount, feeToken);
        }

        if (ssvAmount > 0) {
            s.accounts[account] = accountData;
            CoreLib.deposit(ssvAmount, s.token);
        }
    }
}
