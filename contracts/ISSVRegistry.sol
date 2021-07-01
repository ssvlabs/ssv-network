// File: contracts/ISSVRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

interface ISSVRegistry {
    struct Oess {
        uint256 index;
        bytes operatorPublicKey;
        bytes sharedPublicKey;
        bytes encryptedKey;
    }

    struct Operator {
        string name;
        address ownerAddress;
        bytes publicKey;
        uint256 score;
    }

    struct Validator {
        address ownerAddress;
        bytes publicKey;
        Oess[] oess;
    }

    struct OperatorFee {
        uint256 blockNumber;
        uint256 fee;
    }

    /**
     * @dev Register new validator.
     * @param _ownerAddress The user's ethereum address that is the owner of the validator.
     * @param _publicKey Validator public key.
     * @param _operatorPublicKeys Operator public keys.
     * @param _sharesPublicKeys Shares public keys.
     * @param _encryptedKeys Encrypted private keys.
     */
    function registerValidator(
        address _ownerAddress,
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys
    ) external;

    /**
     * @dev Register new operator.
     * @param _name Operator's display name.
     * @param _ownerAddress Operator's ethereum address that can collect fees.
     * @param _publicKey Operator's Public Key. Will be used to encrypt secret shares of validators keys.
     */
    function registerOperator(
        string calldata _name,
        address _ownerAddress,
        bytes calldata _publicKey
    ) external;

    /**
     * @dev Gets an operator by public key.
     * @param _publicKey Operator's Public Key.
     */
    function operators(bytes calldata _publicKey)
        external
        returns (
            string memory,
            address,
            bytes memory,
            uint256
        );

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

    /**
     * @dev Updates a validator in the list.
     * @param _ownerAddress The user's ethereum address that is the owner of the validator.
     * @param _publicKey Validator public key.
     * @param _operatorPublicKeys Operator public keys.
     * @param _sharesPublicKeys Shares public keys.
     * @param _encryptedKeys Encrypted private keys.
     */
    function updateValidator(
        address _ownerAddress,
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys
    ) external;

    /**
     * @dev Deletes a validator from the list.
     * @param _ownerAddress The user's ethereum address that is the owner of the validator.
     * @param _publicKey Validator public key.
     */
    function deleteValidator(
        address _ownerAddress,
        bytes calldata _publicKey
    ) external;

    /**
     * @dev Deletes an operator from the list.
     * @param _ownerAddress The user's ethereum address that is the owner of the operator.
     * @param _publicKey Operator public key.
     */
    function deleteOperator(
        address _ownerAddress,
        bytes calldata _publicKey
    ) external;

    /**
     * @dev Gets operator fee by address and block number.
     * @param _operatorPublicKey Operator public key.
     * @param _blockNumber for which block number.
     */
    function getOperatorFee(bytes calldata _operatorPublicKey, uint256 _blockNumber)
        external
        returns (uint256);

    /**
     * @dev Gets validator usage fees.
     * @param _pubKey Validator public key.
     * @param _fromBlockNumber from which block number.
     * @param _toBlockNumber to which block number.
     */
    function getValidatorUsage(bytes calldata _pubKey, uint256 _fromBlockNumber, uint256 _toBlockNumber)
        external
        returns (uint256);

    /**
     * @dev Update an operator fee.
     * @param _pubKey Operator's public key.
     * @param _blockNumber from which block number.
     * @param _fee new operator fee.
     */
    function updateOperatorFee(
        bytes calldata _pubKey,
        uint256 _blockNumber,
        uint256 _fee
    ) external;

    /**
     * @param pubKey Operator's public key.
     * @param blockNumber from which block number.
     * @param fee updated fee value.
     */
    event OperatorFeeUpdated(
        bytes pubKey,
        uint256 blockNumber,
        uint256 fee
    );

    /**
     * @dev Get operators list which are in use of validator.
     * @param _validatorPubKey Validator public key.
     */
    function getOperatorPubKeysInUse(bytes calldata _validatorPubKey)
        external
        returns (bytes[] memory);

}
