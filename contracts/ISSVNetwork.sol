// File: contracts/ISSVNetwork.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

interface ISSVNetwork {
    struct OperatorValidators {
        uint256 blockNumber;
        uint256 amountValidators;
    }

    struct ValidatorsInBlock {
        uint256 blockNumber;
        address operatorAddress;
    }

    struct AddressValidatorBalanceInfo {
        uint256 balance;
        ValidatorsInBlock[] validatorsInBlock;
    }

    /**
     * @dev Get operator balance by address.
     * @param _ownerAddress The operators's ethereum address that is the owner of created operators.
     */
    function operatorBalanceOf(address _ownerAddress) external returns (uint256);

    /**
     * @dev Registers a new operator.
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
     * @param _ownerAddress Operator's ethereum address that can collect fees.
     * @param _fee The operators's updated fee.
     */
    function updateOperatorFee(address _ownerAddress, uint256 _fee) external;

    /**
     * @dev Emitted when the operator has been updated the fee.
     * @param ownerAddress Operator's ethereum address that can collect fees.
     * @param fee The operators's updated fee.
     */
    event OperatorFeeUpdated(address ownerAddress, uint256 fee);

    /**
     * @dev Calculate operator's payback.
     * @param _ownerAddress Operator's ethereum address that can collect fees.
     */
    function calculateOperatorPayback(address _ownerAddress) external returns(uint256);

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
     * @param _ownerAddress The validator's ethereum address that is the owner of created validator.
     */
    function validatorBalanceOf(address _ownerAddress) external returns (uint256);

    /**
     * @dev Updates validator's balance.
     * @param _ownerAddress The validator's ethereum address that is the owner of created validator.
     */
    function updateValidatorBalance(address _ownerAddress) external;

    /**
     * @dev Calculate validator's charges.
     * @param _ownerAddress The validator's ethereum address that is the owner of created validator.
     */
    function calculateValidatorCharges(address _ownerAddress) external returns(uint256);

    /**
     * @dev Add new validator to the list.
     * @param _publicKey Validator public key.
     * @param _operatorPublicKeys Operator public keys.
     * @param _sharesPublicKeys Shares public keys.
     * @param _encryptedKeys Encrypted private keys.
     */
    function addValidator(
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys
    ) external;
}
