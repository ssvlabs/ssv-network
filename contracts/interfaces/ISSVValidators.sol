// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";

/**
 * @title SSV Validators Interface
 * @author SSV Labs
 * @notice Interface for managing validators in the SSV network including registration, removal and exit operations
 */
interface ISSVValidators is ISSVNetworkCore {
    /**
     * @dev Emitted when a validator is added
     * @param owner The owner of the validator (and cluster)
     * @param operatorIds The operator IDs managing the validator
     * @param publicKey The validator's public key
     * @param shares The shares data
     * @param cluster The cluster data
     */
    event ValidatorAdded(
        address indexed owner,
        uint64[] operatorIds,
        bytes publicKey,
        bytes shares,
        Cluster cluster
    );

    /**
     * @dev Emitted when a validator is removed
     * @param owner The owner of the validator
     * @param operatorIds The operator IDs managing the validator
     * @param publicKey The validator's public key
     * @param cluster The cluster data
     */
    event ValidatorRemoved(
        address indexed owner,
        uint64[] operatorIds,
        bytes publicKey,
        Cluster cluster
    );

    /**
     * @dev Emitted when a validator exits
     * @param owner The owner of the validator
     * @param operatorIds The operator IDs managing the validator
     * @param publicKey The validator's public key
     */
    event ValidatorExited(
        address indexed owner,
        uint64[] operatorIds,
        bytes publicKey
    );

    /**
     * @notice Registers a new validator
     * @param publicKey Validator public key
     * @param operatorIds Operator IDs managing the validator
     * @param sharesData Encrypted shares data
     * @param cluster Cluster data
     */
    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesData,
        Cluster memory cluster
    ) external payable;

    /**
     * @notice Registers multiple new validators
     * @param publicKeys Array of validator public keys
     * @param operatorIds Operator IDs managing the validators
     * @param sharesData Array of encrypted shares data
     * @param cluster Cluster data
     */
    function bulkRegisterValidator(
        bytes[] calldata publicKeys,
        uint64[] memory operatorIds,
        bytes[] calldata sharesData,
        Cluster memory cluster
    ) external payable;

    /**
     * @notice Removes an existing validator
     * @param publicKey Validator public key
     * @param operatorIds Operator IDs managing the validator
     * @param cluster Cluster data
     */
    function removeValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external;

    /**
     * @notice Removes multiple existing validators from the same cluster
     * @notice Reverts on duplicates or non-existent validators
     * @param publicKeys Array of validator public keys
     * @param operatorIds Operator IDs managing the validators
     * @param cluster Cluster data
     */
    function bulkRemoveValidator(
        bytes[] calldata publicKeys,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external;

    /**
     * @notice Initiates exit for a validator
     * @param publicKey Validator public key
     * @param operatorIds Operator IDs managing the validator
     */
    function exitValidator(
        bytes calldata publicKey,
        uint64[] calldata operatorIds
    ) external;

    /**
     * @notice Initiates exit for multiple validators
     * @param publicKeys Array of validator public keys
     * @param operatorIds Operator IDs managing the validators
     */
    function bulkExitValidator(
        bytes[] calldata publicKeys,
        uint64[] calldata operatorIds
    ) external;
}