// File: contracts/ISSVNetwork.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

interface ISSVNetwork {
    struct OperatorBalanceSnapshot {
        uint256 blockNumber;
        uint256 validatorCount;
        uint256 balance;
    }

    struct ValidatorBalanceSnapshot {
        uint256 blockNumber;
        uint256 balance;
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
    function operatorBalanceOf(bytes calldata _publicKey) external returns (uint256);

    /**
     * @dev Registers new operator.
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
     * @dev Updates operator's fee by address.
     * @param _publicKey Operator's Public Key.
     * @param _fee The operators's updated fee.
     */
    function updateOperatorFee(bytes calldata _publicKey, uint256 _fee) external;

    /**
     * @dev Calculate operator's payback.
     * @param _publicKey Operator's public key.
     * @param _currentBlockNumber block number.
     */
    function calculateOperatorPayback(bytes calldata _publicKey, uint256 _currentBlockNumber) external returns(uint256);

    /**
     * @dev Add validators to operator.
     * @param _ownerAddress Operator's ethereum address that can collect fees.
     * @param _blockNumber Block number for changes.
     */
    function addOperatorValidator(address _ownerAddress, uint256 _blockNumber) external;

    /**
     * @dev Calculate operator's payback.
     * @param _ownerAddress Operator's ethereum address that can collect fees.
     * @param _blockNumber Block number for changes.
     * @param _amountValidators Amount of new validators.
     */
    function deductOperatorValidator(address _ownerAddress, uint256 _blockNumber, uint256 _amountValidators) external;

    /**
     * @dev Get validator balance by address.
     * @param _pubKey The validator's public key.
     */
    function validatorBalanceOf(bytes calldata _pubKey) external returns (uint256);

    /**
     * @dev Updates validator's balance.
     * @param _pubKey The validator's public key.
     */
    function updateValidatorBalance(bytes calldata _pubKey) external;

    /**
     * @dev Calculate validator's usage.
     * @param _pubKey The validator's public key.
     * @param _currentBlockNumber block number.
     */
    function calculateValidatorUsage(bytes calldata _pubKey, uint256 _currentBlockNumber) external returns(uint256);

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
        bytes[] calldata _encryptedKeys
    ) external;

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
        bytes[] calldata _encryptedKeys
    ) external;

    /**
     * @dev Delete validator.
     * @param _publicKey Validator's public key.
     * @param _ownerAddress Validator's owner address.
     */
    function deleteValidator(bytes calldata _publicKey, address _ownerAddress) external;

    /**
     * @dev Delete operator.
     * @param _publicKey Validator's public key.
     * @param _ownerAddress Validator's owner address.
     */
    function deleteOperator(bytes calldata _publicKey, address _ownerAddress) external;
}
