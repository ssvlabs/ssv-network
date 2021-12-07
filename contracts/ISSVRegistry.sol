// File: contracts/ISSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

interface ISSVRegistry {
    struct Oess {
        bytes operatorPublicKey;
        bytes sharedPublicKey;
        bytes encryptedKey;
    }

    /**
     * @dev Emitted when the operator has been added.
     * @param name Operator's display name.
     * @param ownerAddress Operator's ethereum address that can collect fees.
     * @param publicKey Operator's public key. Will be used to encrypt secret shares of validators keys.
     */
    event OperatorAdded(string name, address indexed ownerAddress, bytes publicKey);

    /**
     * @dev Emitted when the operator has been deleted.
     * @param ownerAddress Operator's owner.
     * @param publicKey Operator's public key.
     */
    event OperatorDeleted(address indexed ownerAddress, bytes publicKey);

    /**
     * @dev Emitted when the operator has been activated.
     * @param ownerAddress Operator's owner.
     * @param publicKey Operator's public key.
     */
    event OperatorActivated(address indexed ownerAddress, bytes publicKey);

    /**
     * @dev Emitted when the operator has been deactivated.
     * @param ownerAddress Operator's owner.
     * @param publicKey Operator's public key.
     */
    event OperatorDeactivated(address indexed ownerAddress, bytes publicKey);

    /**
     * @dev Emitted when an operator's fee is updated.
     * @param ownerAddress Operator's owner.
     * @param publicKey Operator's public key.
     * @param blockNumber from which block number.
     * @param fee updated fee value.
     */
    event OperatorFeeUpdated(
        address indexed ownerAddress,
        bytes publicKey,
        uint256 blockNumber,
        uint256 fee
    );

    /**
     * @dev Emitted when an operator's score is updated.
     * @param ownerAddress Operator's owner.
     * @param publicKey Operator's public key.
     * @param blockNumber from which block number.
     * @param score updated score value.
     */
    event OperatorScoreUpdated(
        address indexed ownerAddress,
        bytes publicKey,
        uint256 blockNumber,
        uint256 score
    );

    /**
     * @dev Emitted when the validator has been added.
     * @param ownerAddress The user's ethereum address that is the owner of the validator.
     * @param publicKey The public key of a validator.
     * @param oessList The OESS list for this validator.
     */
    event ValidatorAdded(
        address ownerAddress,
        bytes publicKey,
        Oess[] oessList
    );

    /**
     * @dev Emitted when the validator has been updated.
     * @param ownerAddress The user's ethereum address that is the owner of the validator.
     * @param publicKey The public key of a validator.
     * @param oessList The OESS list for this validator.
     */
    event ValidatorUpdated(
        address ownerAddress,
        bytes publicKey,
        Oess[] oessList
    );

    /**
     * @dev Emitted when the validator is deleted.
     * @param ownerAddress Validator's owner.
     * @param publicKey The public key of a validator.
     */
    event ValidatorDeleted(address ownerAddress, bytes publicKey);

    /**
     * @dev Emitted when the validator is activated.
     * @param ownerAddress Validator's owner.
     * @param publicKey The public key of a validator.
     */
    event ValidatorActivated(address ownerAddress, bytes publicKey);

    /**
     * @dev Emitted when the validator is deactivated.
     * @param ownerAddress Validator's owner.
     * @param publicKey The public key of a validator.
     */
    event ValidatorDeactivated(address ownerAddress, bytes publicKey);

    event OwnerValidatorsDisabled(address ownerAddress);

    event OwnerValidatorsEnabled(address ownerAddress);

    /**
     * @dev Initializes the contract
     */
    function initialize() external;

    /**
     * @dev Registers a new operator.
     * @param name Operator's display name.
     * @param ownerAddress Operator's ethereum address that can collect fees.
     * @param publicKey Operator's public key. Will be used to encrypt secret shares of validators keys.
     * @param fee The fee which the operator charges for each block.
     */
    function registerOperator(string calldata name, address ownerAddress, bytes calldata publicKey, uint256 fee) external;

    /**
     * @dev Deletes an operator.
     * @param publicKey Operator public key.
     */
    function deleteOperator(bytes calldata publicKey) external;

    /**
     * @dev Activates an operator.
     * @param publicKey Operator public key.
     */
    function activateOperator(bytes calldata publicKey) external;

    /**
     * @dev Deactivates an operator.
     * @param publicKey Operator public key.
     */
    function deactivateOperator(bytes calldata publicKey) external;

    /**
     * @dev Updates an operator fee.
     * @param publicKey Operator's public key.
     * @param fee new operator fee.
     */
    function updateOperatorFee(
        bytes calldata publicKey,
        uint256 fee
    ) external;

    /**
     * @dev Updates an operator fee.
     * @param publicKey Operator's public key.
     * @param score New score.
     */
    function updateOperatorScore(
        bytes calldata publicKey,
        uint256 score
    ) external;

    /**
     * @dev Registers a new validator.
     * @param ownerAddress The user's ethereum address that is the owner of the validator.
     * @param publicKey Validator public key.
     * @param operatorPublicKeys Operator public keys.
     * @param sharesPublicKeys Shares public keys.
     * @param encryptedKeys Encrypted private keys.
     */
    function registerValidator(
        address ownerAddress,
        bytes calldata publicKey,
        bytes[] calldata operatorPublicKeys,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys
    ) external;

    /**
     * @dev Updates a validator.
     * @param publicKey Validator public key.
     * @param operatorPublicKeys Operator public keys.
     * @param sharesPublicKeys Shares public keys.
     * @param encryptedKeys Encrypted private keys.
     */
    function updateValidator(
        bytes calldata publicKey,
        bytes[] calldata operatorPublicKeys,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys
    ) external;

    /**
     * @dev Deletes a validator.
     * @param publicKey Validator's public key.
     */
    function deleteValidator(bytes calldata publicKey) external;

    /**
     * @dev Activates a validator.
     * @param publicKey Validator's public key.
     */
    function activateValidator(bytes calldata publicKey) external;

    /**
     * @dev Deactivates a validator.
     * @param publicKey Validator's public key.
     */
    function deactivateValidator(bytes calldata publicKey) external;

    function enableOwnerValidators(address ownerAddress) external;

    function disableOwnerValidators(address ownerAddress) external;

    function isOwnerValidatorsDisabled(address ownerAddress) external view returns (bool);

    /**
     * @dev Returns the operator count.
     */
    function operatorCount() external view returns (uint256);

    /**
     * @dev Gets an operator by public key.
     * @param publicKey Operator's public key.
     */
    function operators(bytes calldata publicKey)
        external view
        returns (
            string memory,
            address,
            bytes memory,
            uint256,
            bool,
            uint256
        );

    /**
     * @dev Returns operators for owner.
     * @param ownerAddress Owner's address.
     */
    function getOperatorsByOwnerAddress(address ownerAddress)
        external view
        returns (bytes[] memory);

    /**
     * @dev Gets operators list which are in use by validator.
     * @param validatorPublicKey Validator's public key.
     */
    function getOperatorsByValidator(bytes calldata validatorPublicKey)
        external view
        returns (bytes[] memory);

    /**
     * @dev Gets operator's owner.
     * @param publicKey Operator's public key.
     */
    function getOperatorOwner(bytes calldata publicKey) external view returns (address);

    /**
     * @dev Gets operator current fee.
     * @param publicKey Operator's public key.
     */
    function getOperatorCurrentFee(bytes calldata publicKey)
        external view
        returns (uint256);

    /**
     * @dev Gets validator count.
     */
    function validatorCount() external view returns (uint256);

    /**
     * @dev Gets active validator count.
     */
    function activeValidatorCount() external view returns (uint256);

    /**
     * @dev Gets an validator by public key.
     * @param publicKey Validator's public key.
     */
    function validators(bytes calldata publicKey)
        external view
        returns (
            address,
            bytes memory,
            bool,
            uint256
        );

    /**
     * @dev Gets a validator public keys by owner's address.
     * @param ownerAddress Owner's Address.
     */
    function getValidatorsByAddress(address ownerAddress)
        external view
        returns (bytes[] memory);

    /**
     * @dev Get validator's owner.
     * @param publicKey Validator's public key.
     */
    function getValidatorOwner(bytes calldata publicKey) external view returns (address);
}