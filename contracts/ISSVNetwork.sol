// File: contracts/ISSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "./ISSVRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISSVNetwork {
    struct OperatorBalanceSnapshot {
        uint256 blockNumber;
        uint256 validatorCount;
        uint256 balance;
        uint256 index;
        uint256 indexBlockNumber;
    }

    struct ValidatorUsageSnapshot {
        uint256 blockNumber;
        uint256 balance;
    }

    struct OwnerData {
        uint256 deposited;
        uint256 withdrawn;
        uint256 earned;
        uint256 used;
        uint256 networkFee;
        uint256 networkFeePrevIndex;
        uint256 activeValidatorsCount;
    }

    struct OperatorInUse {
        uint256 index;
        uint256 validatorCount;
        uint256 used;
        bool exists;
    }

    function initialize(ISSVRegistry _SSVRegistryAddress, IERC20 _token) external;

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
     * @dev Get network fee index for the address.
     * @param _ownerAddress Owner address.
     */
    function addressNetworkFee(address _ownerAddress) external view returns (uint256);

    /**
     * @dev Registers new operator.
     * @param _name Operator's display name.
     * @param _publicKey Operator's Public Key. Will be used to encrypt secret shares of validators keys.
     */
    function registerOperator(
        string calldata _name,
        bytes calldata _publicKey,
        uint256 _fee
    ) external;

    /**
     * @dev Updates operator's fee by address.
     * @param _publicKey Operator's Public Key.
     * @param _fee The operators's updated fee.
     */
    function updateOperatorFee(bytes calldata _publicKey, uint256 _fee) external;

    /**
     * @dev Update network fee.
     */
    function updateNetworkFee(uint256 _fee) external;

    /**
     * @dev Get validator usage by address.
     * @param _pubKey The validator's public key.
     */
    function validatorUsageOf(bytes memory _pubKey) external view returns (uint256);

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

    /**
     * @dev Deposit tokens.
     * @param _tokenAmount Tokens amount.
     */
    function deposit(uint256 _tokenAmount) external;

    /**
     * @dev Withdraw tokens.
     * @param _tokenAmount Tokens amount.
     */
    /**
     * @dev Validate tokens amount to transfer.
     * @param _tokenAmount Tokens amount.
     */
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

    function activateValidator(bytes calldata _pubKey) external;
    function deactivateValidator(bytes calldata _pubKey) external;

    function activateOperator(bytes calldata _pubKey) external;
    function deactivateOperator(bytes calldata _pubKey) external;
}
