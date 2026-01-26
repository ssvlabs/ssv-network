// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";
import {ClusterLib} from "../libraries/ClusterLib.sol";

interface ISSVClusters is ISSVNetworkCore {
    struct UpdateCtx {
        address clusterOwner;
        bytes32 clusterId;
        uint64 blockNum;
        uint32 effectiveBalance;
        bytes32[] merkleProof;
        uint8 version;
    }

    /// @notice Migrates an SSV cluster to ETH, returning any SSV balance and accepting ETH top-up
    /// @param operatorIds Array of operator IDs in the cluster
    /// @param cluster Cluster data to migrate
    function migrateClusterToETH(uint64[] calldata operatorIds, Cluster memory cluster) external payable;

    /**************************/
    /* Cluster External Functions */
    /**************************/

    /// @notice Liquidates a cluster
    /// @param owner The owner of the cluster
    /// @param operatorIds Array of IDs of operators managing the cluster
    /// @param cluster Cluster to be liquidated
    function liquidate(address owner, uint64[] memory operatorIds, Cluster memory cluster) external;

    /// @notice Liquidates a cluster
    /// @param owner The owner of the cluster
    /// @param operatorIds Array of IDs of operators managing the cluster
    /// @param cluster Cluster to be liquidated
    function liquidateSSV(address owner, uint64[] memory operatorIds, Cluster memory cluster) external;

    /// @notice Reactivates a cluster
    /// @param operatorIds Array of IDs of operators managing the cluster
    /// @param cluster Cluster to be reactivated
    function reactivate(uint64[] memory operatorIds, Cluster memory cluster) external payable;

    /******************************/
    /* Balance External Functions */
    /******************************/

    /// @notice Deposits tokens into a cluster
    /// @param owner The owner of the cluster
    /// @param operatorIds Array of IDs of operators managing the cluster
    /// @param cluster Cluster where the deposit will be made
    function deposit(
        address owner,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external payable;

    /// @notice Withdraws tokens from a cluster
    /// @param operatorIds Array of IDs of operators managing the cluster
    /// @param tokenAmount Amount of SSV tokens to be withdrawn
    /// @param cluster Cluster where the withdrawal will be made
    function withdraw(uint64[] memory operatorIds, uint256 tokenAmount, Cluster memory cluster) external;

    function updateClusterBalance(
        uint64 blockNum,
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster,
        uint32 effectiveBalance,
        bytes32[] calldata merkleProof
    ) external;

    /**
     * @dev Emitted when a cluster is liquidated.
     * @param owner The owner of the liquidated cluster.
     * @param operatorIds The operator IDs managing the cluster.
     * @param cluster The liquidated cluster data.
     */
    event ClusterLiquidated(address indexed owner, uint64[] operatorIds, Cluster cluster);

    /**
     * @dev Emitted when a cluster is reactivated.
     * @param owner The owner of the reactivated cluster.
     * @param operatorIds The operator IDs managing the cluster.
     * @param cluster The reactivated cluster data.
     */
    event ClusterReactivated(address indexed owner, uint64[] operatorIds, Cluster cluster);

    /**
     * @dev Emitted when a legacy SSV cluster is migrated to ETH.
     * @param owner The owner of the migrated cluster.
     * @param operatorIds The operator IDs managing the cluster.
     * @param ethDeposited The amount of ETH supplied during migration.
     * @param ssvRefunded The amount of SSV tokens refunded to the owner.
     * @param effectiveBalance Cluster effective balance in wei.
     * @param cluster The migrated cluster data (ETH version).
     */
    event ClusterMigratedToETH(
        address indexed owner,
        uint64[] operatorIds,
        uint256 ethDeposited,
        uint256 ssvRefunded,
        uint32 effectiveBalance,
        Cluster cluster
    );

    /**
     * @dev Emitted when tokens are withdrawn from a cluster.
     * @param owner The owner of the cluster.
     * @param operatorIds The operator IDs managing the cluster.
     * @param value The amount of tokens withdrawn.
     * @param cluster The cluster from which tokens were withdrawn.
     */
    event ClusterWithdrawn(address indexed owner, uint64[] operatorIds, uint256 value, Cluster cluster);

    /**
     * @dev Emitted when tokens are deposited into a cluster.
     * @param owner The owner of the cluster.
     * @param operatorIds The operator IDs managing the cluster.
     * @param value The amount of ETH deposited.
     * @param cluster The cluster into which ETH was deposited.
     */
    event ClusterDeposited(address indexed owner, uint64[] operatorIds, uint256 value, Cluster cluster);

    event ClusterBalanceUpdated(
        address indexed owner,
        uint64[] operatorIds,
        uint64 indexed blockNum,
        uint32 effectiveBalance,
        ISSVNetworkCore.Cluster cluster
    );
}
