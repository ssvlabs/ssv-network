// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;
import "hardhat/console.sol";

import "./ISSVNetwork.sol";
import "./ISSVRegistry.sol";

contract SSVNetwork is ISSVNetwork {
    ISSVRegistry private SSVRegistryContract;

    mapping(bytes => OperatorBalanceSnapshot) internal operatorBalances;
    mapping(bytes => ValidatorBalanceSnapshot) internal validatorBalances;

    mapping(address => Balance) public addressBalances;

    function initialize(ISSVRegistry _SSVRegistryAddress) public {
        SSVRegistryContract = _SSVRegistryAddress;
    }


    // uint256 minValidatorBlockSubscription;

    /**
     * @dev See {ISSVNetwork-updateOperatorFee}.
     */
    function updateOperatorFee(bytes calldata _pubKey, uint256 fee) public virtual override {
        SSVRegistryContract.updateOperatorFee(_pubKey, block.number, fee);
    }

    /**
     * @dev See {ISSVNetwork-operatorBalanceOf}.
     */
    function operatorBalanceOf(bytes calldata _pubKey) public override returns(uint256, uint256) {
        uint256 currentBlockNumber = block.number;
        uint256 fee = SSVRegistryContract.getOperatorCurrentFee(_pubKey);
        uint256 balance = operatorBalances[_pubKey].balance + fee * (currentBlockNumber - operatorBalances[_pubKey].blockNumber) * operatorBalances[_pubKey].validatorCount;
        return (balance, currentBlockNumber);
    }

    /**
     * @dev See {ISSVNetwork-updateOperatorBalance}.
     */
    function updateOperatorBalance(bytes calldata _pubKey) public override {
        (uint256 totalPayback, uint256 blockNumber) = operatorBalanceOf(_pubKey);
        OperatorBalanceSnapshot storage balanceSnapshot = operatorBalances[_pubKey];
        balanceSnapshot.blockNumber = blockNumber;
        balanceSnapshot.balance = totalPayback;
    }

    function totalBalanceOf(address _ownerAddress) public view returns(uint256) {
        // TODO: store sum balances just return it
        bytes[] calldata validators = SSVRegistryContract.validatorsByAddress(_ownerAddress);
        bytes[] calldata operators = SSVRegistryContract.operatorsByAddress(_ownerAddress);
        uint256 balance = 0;
        for (uint256 index = 0; index < validators.length; ++index) {
            (uint256 value, uint256 blockNumber) = validatorBalanceOf(validators[index]);
            balance -= value;
        }
        for (uint256 index = 0; index < operators.length; ++index) {
            (uint256 value, uint256 blockNumber) = operatorBalanceOf(validators[index]);
            balance += value;
        }
        return balance + addressBalances[_ownerAddress].charged - addressBalances[_ownerAddress].withdrawn;
    }

    /**
     * @dev See {ISSVNetwork-registerOperator}.
     */
    function registerOperator(
        string calldata _name,
        bytes calldata _publicKey
    ) public override {
        SSVRegistryContract.registerOperator(
            _name,
            msg.sender,
            _publicKey
        );
        // trigger update operator fee function
        operatorBalances[_publicKey] = OperatorBalanceSnapshot(block.number, 0, 0);
    }

    /**
     * @dev See {ISSVNetwork-validatorBalanceOf}.
     */
    function validatorBalanceOf(bytes calldata _pubKey) public override returns(uint256, uint256) {
        uint256 currentBlockNumber = block.number;
        ValidatorBalanceSnapshot storage balanceSnapshot = validatorBalances[_pubKey];
        uint256 usage = balanceSnapshot.balance + SSVRegistryContract.getValidatorUsage(_pubKey, balanceSnapshot.blockNumber, currentBlockNumber);
        return (usage, currentBlockNumber);
    }

    /**
     * @dev See {ISSVNetwork-updateValidatorBalance}.
     */
    function updateValidatorBalance(bytes calldata _pubKey) public override {
        (uint256 totalUsage, uint256 blockNumber) = validatorBalanceOf(_pubKey);
        ValidatorBalanceSnapshot storage balanceSnapshot = validatorBalances[_pubKey];
        balanceSnapshot.blockNumber = blockNumber;
        balanceSnapshot.balance = totalUsage;
        // 1 - get owner address by pubkey
        // 2 owemrAddressBalance -= totalUsage;
    }

    /**
     * @dev See {ISSVNetwork-registerValidator}.
     */
    // TODO: add transfer tokens logic here based on passed value in function params
    function registerValidator(
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys
        // uint256 tokensAmount
    ) public virtual override {
        // TODO: tokensAmount validation based on calculation operator pub key and minimum period of time
        // for each operatorPubKey: minValidatorBlockSubscription * (fee1 + fee2 + fee3)
        SSVRegistryContract.registerValidator(
            msg.sender,
            _publicKey,
            _operatorPublicKeys,
            _sharesPublicKeys,
            _encryptedKeys
        );
        validatorBalances[_publicKey] = ValidatorBalanceSnapshot(block.number, 0);

        for (uint256 index = 0; index < _operatorPublicKeys.length; ++index) {
            bytes calldata operatorPubKey = _operatorPublicKeys[index];
            updateOperatorBalance(operatorPubKey);
            operatorBalances[operatorPubKey].validatorCount++;
        }
    }

    /**
     * @dev See {ISSVNetwork-updateValidator}.
     */
    function updateValidator(
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys
    ) public virtual override {
        updateValidatorBalance(_publicKey);
        bytes[] memory currentOperatorPubKeys = SSVRegistryContract.getOperatorPubKeysInUse(_publicKey);
        // calculate balances for current operators in use
        for (uint256 index = 0; index < currentOperatorPubKeys.length; ++index) {
            bytes calldata operatorPubKey = currentOperatorPubKeys[index];
            updateOperatorBalance(operatorPubKey);
            operatorBalances[operatorPubKey].validatorCount--;
        }

        // calculate balances for new operators in use
        for (uint256 index = 0; index < _operatorPublicKeys.length; ++index) {
            bytes calldata operatorPubKey = _operatorPublicKeys[index];
            updateOperatorBalance(operatorPubKey);
            operatorBalances[operatorPubKey].validatorCount++;
        }

        SSVRegistryContract.updateValidator(
            msg.sender,
            _publicKey,
            _operatorPublicKeys,
            _sharesPublicKeys,
            _encryptedKeys
        );
    }

    /**
     * @dev See {ISSVNetwork-deleteValidator}.
     */
    function deleteValidator(bytes calldata _publicKey) public virtual override {
        updateValidatorBalance(_publicKey);

        // calculate balances for current operators in use and update their balances
        bytes[] memory currentOperatorPubKeys = SSVRegistryContract.getOperatorPubKeysInUse(_publicKey);
        for (uint256 index = 0; index < currentOperatorPubKeys.length; ++index) {
            bytes calldata operatorPubKey = currentOperatorPubKeys[index];
            updateOperatorBalance(operatorPubKey);
            operatorBalances[operatorPubKey].validatorCount--;
        }

        SSVRegistryContract.deleteValidator(msg.sender, _publicKey);
    }

    /**
     * @dev See {ISSVNetwork-deleteValidator}.
     */
    function deleteOperator(bytes calldata _publicKey) public virtual override {
        updateOperatorBalance(_publicKey);
        SSVRegistryContract.deleteOperator(msg.sender, _publicKey);
    }
}