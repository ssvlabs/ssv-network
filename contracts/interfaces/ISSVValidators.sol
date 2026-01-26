// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";

interface ISSVValidators is ISSVNetworkCore {
    /// @notice Registers a new validator on the SSV Network
    /// @param publicKey The public key of the new validator
    /// @param operatorIds Array of IDs of operators managing this validator
    /// @param sharesData Encrypted shares related to the new validator
    /// @param cluster Cluster to be used with the new validator
    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesData,
        Cluster memory cluster
    ) external payable;

    /// @notice Registers new validators on the SSV Network
    /// @param publicKeys The public keys of the new validators
    /// @param operatorIds Array of IDs of operators managing this validator
    /// @param sharesData Encrypted shares related to the new validators
    /// @param cluster Cluster to be used with the new validator
    function bulkRegisterValidator(
        bytes[] calldata publicKeys,
        uint64[] memory operatorIds,
        bytes[] calldata sharesData,
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

    /// @notice Fires the exit event for a validator
    /// @param publicKey The public key of the validator to be exited
    /// @param operatorIds Array of IDs of operators managing the validator
    function exitValidator(bytes calldata publicKey, uint64[] calldata operatorIds) external;

    /// @notice Fires the exit event for a set of validators
    /// @param publicKeys The public keys of the validators to be exited
    /// @param operatorIds Array of IDs of operators managing the validators
    function bulkExitValidator(bytes[] calldata publicKeys, uint64[] calldata operatorIds) external;

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
     * @dev Emitted when a validator begins the exit process.
     * @param owner The owner of the exiting validator.
     * @param operatorIds The operator IDs managing the validator.
     * @param publicKey The public key of the exiting validator.
     */
    event ValidatorExited(address indexed owner, uint64[] operatorIds, bytes publicKey);
}
