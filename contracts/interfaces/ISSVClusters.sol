// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";
import {ClusterLib} from "../libraries/ClusterLib.sol";

interface ISSVClusters is ISSVNetworkCore {
    struct UpdateCtx {
        bytes32 clusterId;
        uint64 blockNum;
        uint256 effectiveBalance;
        bytes32[] merkleProof;
        uint8 version;
    }

    /// @notice Registers a new validator on the SSV Network
    /// @param publicKey The public key of the new validator
    /// @param operatorIds Array of IDs of operators managing this validator
    /// @param sharesData Encrypted shares related to the new validator
    /// @param amount Amount of SSV tokens to be deposited
    /// @param cluster Cluster to be used with the new validator
    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesData,
        uint256 amount,
        Cluster memory cluster
    ) external payable;

    /// @notice Registers new validators on the SSV Network
    /// @param publicKeys The public keys of the new validators
    /// @param operatorIds Array of IDs of operators managing this validator
    /// @param sharesData Encrypted shares related to the new validators
    /// @param amount Amount of SSV tokens to be deposited
    /// @param cluster Cluster to be used with the new validator
    function bulkRegisterValidator(
        bytes[] calldata publicKeys,
        uint64[] memory operatorIds,
        bytes[] calldata sharesData,
        uint256 amount,
        Cluster memory cluster
    ) external payable;

    /// @notice Removes an existing validator from the SSV Network
    /// @param publicKey The public key of the validator to be removed
    /// @param operatorIds Array of IDs of operators managing the validator
    /// @param cluster Cluster associated with the validator
    function removeValidator(bytes calldata publicKey, uint64[] memory operatorIds, Cluster memory cluster) external;

    /// @notice Bulk removes a set of existing validators in the same cluster from the SSV Network
    /// @notice Reverts if publicKeys contains duplicates or non-existent validators
    /// @param publicKeys The public keys of the validators to be removed
    /// @param operatorIds Array of IDs of operators managing the validator
    /// @param cluster Cluster associated with the validator
    function bulkRemoveValidator(
        bytes[] calldata publicKeys,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external;

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
    /// @param amount Amount of SSV tokens to be deposited for reactivation
    /// @param cluster Cluster to be reactivated
    function reactivate(uint64[] memory operatorIds, uint256 amount, Cluster memory cluster) external payable;

    /******************************/
    /* Balance External Functions */
    /******************************/

    /// @notice Deposits tokens into a cluster
    /// @param owner The owner of the cluster
    /// @param operatorIds Array of IDs of operators managing the cluster
    /// @param amount Amount of SSV tokens to be deposited
    /// @param cluster Cluster where the deposit will be made
    function deposit(
        address owner,
        uint64[] memory operatorIds,
        uint256 amount,
        Cluster memory cluster
    ) external payable;

    /// @notice Withdraws tokens from a cluster
    /// @param operatorIds Array of IDs of operators managing the cluster
    /// @param tokenAmount Amount of SSV tokens to be withdrawn
    /// @param cluster Cluster where the withdrawal will be made
    function withdraw(uint64[] memory operatorIds, uint256 tokenAmount, Cluster memory cluster) external;

    /// @notice Fires the exit event for a validator
    /// @param publicKey The public key of the validator to be exited
    /// @param operatorIds Array of IDs of operators managing the validator
    function exitValidator(bytes calldata publicKey, uint64[] calldata operatorIds) external;

    /// @notice Fires the exit event for a set of validators
    /// @param publicKeys The public keys of the validators to be exited
    /// @param operatorIds Array of IDs of operators managing the validators
    function bulkExitValidator(bytes[] calldata publicKeys, uint64[] calldata operatorIds) external;

    function updateClusterBalance(
        uint64 blockNum,
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster,
        uint256 effectiveBalance,
        bytes32[] calldata merkleProof
    ) external;

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
     * @param cluster The migrated cluster data (ETH version).
     */
    event ClusterMigratedToETH(
        address indexed owner,
        uint64[] operatorIds,
        uint256 ethDeposited,
        uint256 ssvRefunded,
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
     * @param value The amount of SSV tokens deposited.
     * @param cluster The cluster into which SSV tokens were deposited.
     */
    event ClusterDeposited(address indexed owner, uint64[] operatorIds, uint256 value, Cluster cluster);

    event ClusterBalanceUpdated(
        ISSVNetworkCore.Cluster,
        bytes32 indexed clusterId,
        uint64 indexed blockNum,
        uint256 effectiveBalance,
        uint64 vUnits
    );

    /**
     * @dev Emitted when a validator begins the exit process.
     * @param owner The owner of the exiting validator.
     * @param operatorIds The operator IDs managing the validator.
     * @param publicKey The public key of the exiting validator.
     */
    event ValidatorExited(address indexed owner, uint64[] operatorIds, bytes publicKey);
}
