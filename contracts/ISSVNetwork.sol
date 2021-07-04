// File: contracts/ISSVNetwork.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

interface ISSVNetwork {
    struct OperatorBalanceSnapshot {
        uint256 blockNumber;
        uint256 validatorCount;
        uint256 balance;
    }

    struct ValidatorUsageSnapshot {
        uint256 blockNumber;
        uint256 balance;
    }

    struct Balance {
        uint256 deposited;
        uint256 used;
        uint256 withdrawn;
    }

    /**
     * @dev Emitted when the operator validator added.
     * @param ownerAddress The user's ethereum address that is the owner of the operator.
     * @param blockNumber Block number for changes.
     */
    event OperatorValidatorAdded(address ownerAddress, uint256 blockNumber);

    /**
     * @dev Get operator balance by address.
     * @param _publicKey Operator's Public Key.
     */
    function operatorBalanceOf(bytes memory _publicKey) external view returns (uint256);

    /**
     * @dev Registers new operator.
     * @param _name Operator's display name.
     * @param _publicKey Operator's Public Key. Will be used to encrypt secret shares of validators keys.
     */
    function registerOperator(
        string calldata _name,
        bytes calldata _publicKey
    ) external;

    /**
     * @dev Updates operator's fee by address.
     * @param _publicKey Operator's Public Key.
     * @param _fee The operators's updated fee.
     */
    function updateOperatorFee(bytes calldata _publicKey, uint256 _fee) external;

    /**
     * @dev Get validator usage by address.
     * @param _pubKey The validator's public key.
     */
    function validatorUsageOf(bytes memory _pubKey) external view returns (uint256);

    /**
     * @dev Updates operators's balance.
     * @param _pubKey The operators's public key.
     */
    function updateOperatorBalance(bytes memory _pubKey) external;

    /**
     * @dev Updates validator's usage.
     * @param _pubKey The validator's public key.
     */
    function updateValidatorUsage(bytes calldata _pubKey) external;

    function totalBalanceOf(address _ownerAddress) external view returns (uint256);

    /**
     * @dev Register new validator.
     * @param _publicKey Validator public key.
     * @param _operatorPublicKeys Operator public keys.
     * @param _sharesPublicKeys Shares public keys.
     * @param _encryptedKeys Encrypted private keys.
     */
    function registerValidator(
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys,
        uint256 _tokenAmount
    ) external;

    function deposit(uint256 _tokenAmount) external;

    function withdraw(uint256 _tokenAmount) external;

    /**
     * @dev Update validator.
     * @param _publicKey Validator public key.
     * @param _operatorPublicKeys Operator public keys.
     * @param _sharesPublicKeys Shares public keys.
     * @param _encryptedKeys Encrypted private keys.
     */
    function updateValidator(
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys,
        uint256 _tokenAmount
    ) external;

    /**
     * @dev Delete validator.
     * @param _publicKey Validator's public key.
     */
    function deleteValidator(bytes calldata _publicKey) external;

    /**
     * @dev Delete operator.
     * @param _publicKey Operator's public key.
     */
    function deleteOperator(bytes calldata _publicKey) external;

    function deactivate(bytes calldata _pubKey) external;

    function activate(bytes calldata _pubKey) external;
}
