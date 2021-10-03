// File: contracts/ISSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

interface ISSVRegistry {
    struct Oess {
        uint256 index;
        bytes operatorPublicKey;
        bytes sharedPublicKey;
        bytes encryptedKey;
    }

    /**
     * @dev Emitted when the operator has been added.
     * @param name Opeator's display name.
     * @param ownerAddress Operator's ethereum address that can collect fees.
     * @param publicKey Operator's Public Key. Will be used to encrypt secret shares of validators keys.
     */
    event OperatorAdded(string name, address ownerAddress, bytes publicKey);

    /**
     * @dev Emitted when the operator has been deleted.
     * @param publicKey Operator's Public Key.
     */
    event OperatorDeleted(string name, bytes publicKey);

    event OperatorActive(address ownerAddress, bytes publicKey);
    event OperatorInactive(address ownerAddress, bytes publicKey);

    /**
     * @param publicKey Operator's public key.
     * @param blockNumber from which block number.
     * @param fee updated fee value.
     */
    event OperatorFeeUpdated(
        bytes publicKey,
        uint256 blockNumber,
        uint256 fee
    );

    /**
     * @param publicKey Operator's public key.
     * @param blockNumber from which block number.
     * @param score updated score value.
     */
    event OperatorScoreUpdated(
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
     * @dev Emitted when the validator has been deleted.
     * @param publicKey Operator's Public Key.
     */
    event ValidatorDeleted(address ownerAddress, bytes publicKey);

    event ValidatorActive(address ownerAddress, bytes publicKey);
    event ValidatorInactive(address ownerAddress, bytes publicKey);

    /**
     * @param validatorPublicKey The public key of a validator.
     * @param index Operator index.
     * @param operatorPublicKey Operator public key.
     * @param sharedPublicKey Share public key.
     * @param encryptedKey Encrypted private key.
     */
    event OessAdded(
        bytes validatorPublicKey,
        uint256 index,
        bytes operatorPublicKey,
        bytes sharedPublicKey,
        bytes encryptedKey
    );


    function initialize() external;

    /**
     * @dev Register new operator.
     * @param name Operator's display name.
     * @param ownerAddress Operator's ethereum address that can collect fees.
     * @param publicKey Operator's Public Key. Will be used to encrypt secret shares of validators keys.
     */
    function registerOperator(
        string calldata name,
        address ownerAddress,
        bytes calldata publicKey,
        uint256 fee
    ) external;

    /**
     * @dev Deletes an operator from the list.
     * @param ownerAddress The user's ethereum address that is the owner of the operator.
     * @param publicKey Operator public key.
     */
    function deleteOperator(
        address ownerAddress,
        bytes calldata publicKey
    ) external;

    function activateOperator(bytes calldata publicKey) external;
    function deactivateOperator(bytes calldata publicKey) external;

    /**
     * @dev Update an operator fee.
     * @param publicKey Operator's public key.
     * @param fee new operator fee.
     */
    function updateOperatorFee(
        bytes calldata publicKey,
        uint256 fee
    ) external;

    /**
     * @dev Update an operator fee.
     * @param publicKey Operator's public key.
     * @param score new operator score.
     */
    function updateOperatorScore(
        bytes calldata publicKey,
        uint256 score
    ) external;

    /**
     * @dev Register new validator.
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

    function updateValidator(
        bytes calldata publicKey,
        bytes[] calldata operatorPublicKeys,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys
    ) external;

    function deleteValidator(address _ownerAddress, bytes calldata _publicKey) external;

    function activateValidator(bytes calldata publicKey) external;
    function deactivateValidator(bytes calldata publicKey) external;


    function operatorCount() external view returns (uint);

    /**
     * @dev Gets an operator by public key.
     * @param publicKey Operator's Public Key.
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

    function getOperatorsByOwnerAddress(address ownerAddress)
        external view
        returns (bytes[] memory);

    /**
     * @dev Get operators list which are in use of validator.
     * @param validatorPublicKey Validator public key.
     */
    function getOperatorsByValidator(bytes calldata validatorPublicKey)
        external view
        returns (bytes[] memory);

    function getOperatorOwner(bytes calldata publicKey) external view returns (address);

    /**
     * @dev Gets an operator public keys by owner address.
     * @param ownerAddress Owner Address.
     */

    /**
     * @dev Gets operator current fee.
     * @param operatorPublicKey Operator public key.
     */
    function getOperatorCurrentFee(bytes calldata operatorPublicKey)
        external view
        returns (uint256);

    function validatorCount() external view returns (uint);

    function validators(bytes calldata publicKey)
        external view
        returns (
            address,
            bytes memory,
            bool,
            uint256
        );

    /**
     * @dev Gets a validator public keys by owner address.
     * @param ownerAddress Owner Address.
     */
    function getValidatorsByAddress(address ownerAddress)
        external view
        returns (bytes[] memory);

    function getValidatorOwner(bytes calldata publicKey) external view returns (address);
}