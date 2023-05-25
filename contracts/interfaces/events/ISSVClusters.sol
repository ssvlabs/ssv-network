// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../ISSVNetworkCore.sol";

interface ISSVClusters is ISSVNetworkCore {
    /**
     * @dev Emitted when the validator has been added.
     * @param publicKey The public key of a validator.
     * @param operatorIds The operator ids list.
     * @param shares snappy compressed shares(a set of encrypted and public shares).
     * @param cluster All the cluster data.
     */
    event ValidatorAdded(address indexed owner, uint64[] operatorIds, bytes publicKey, bytes shares, Cluster cluster);

    /**
     * @dev Emitted when the validator is removed.
     * @param publicKey The public key of a validator.
     * @param operatorIds The operator ids list.
     * @param cluster All the cluster data.
     */
    event ValidatorRemoved(address indexed owner, uint64[] operatorIds, bytes publicKey, Cluster cluster);

    event ClusterLiquidated(address indexed owner, uint64[] operatorIds, Cluster cluster);

    event ClusterReactivated(address indexed owner, uint64[] operatorIds, Cluster cluster);

    event ClusterWithdrawn(address indexed owner, uint64[] operatorIds, uint256 value, Cluster cluster);

    event ClusterDeposited(address indexed owner, uint64[] operatorIds, uint256 value, Cluster cluster);
}
