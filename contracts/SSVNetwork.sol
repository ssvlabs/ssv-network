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

    function initialize(ISSVRegistry _SSVRegistryAddress) public {
        SSVRegistryContract = _SSVRegistryAddress;
    }

    /**
     * @dev See {ISSVNetwork-updateOperatorFee}.
     */
    function updateOperatorFee(bytes calldata _pubKey, uint256 fee) public virtual override {
        SSVRegistryContract.updateOperatorFee(_pubKey, block.number, fee);
    }

    /**
     * @dev See {ISSVNetwork-operatorBalanceOf}.
     */
    function operatorBalanceOf(bytes calldata _pubKey) public override returns(uint256) {
        return calculateOperatorPayback(_pubKey, block.number);
    }

    /**
     * @dev See {ISSVNetwork-calculateOperatorPayback}.
     */
    // TODO: private doesn't work. Need to fix it
    function calculateOperatorPayback(bytes memory _pubKey, uint256 _currentBlockNumber) public override returns(uint256) {
        uint256 fee = SSVRegistryContract.getOperatorCurrentFee(_pubKey);
        return operatorBalances[_pubKey].balance + fee * (_currentBlockNumber - operatorBalances[_pubKey].blockNumber) * operatorBalances[_pubKey].validatorCount;
    }

    /**
     * @dev See {ISSVNetwork-updateOperatorBalance}.
     */
    function updateOperatorBalance(bytes memory _pubKey) public override {
        uint256 currentBlockNumber = block.number;
        uint256 totalPayback = calculateOperatorPayback(_pubKey, currentBlockNumber);
        OperatorBalanceSnapshot storage balanceSnapshot = operatorBalances[_pubKey];
        balanceSnapshot.blockNumber = currentBlockNumber;
        balanceSnapshot.balance = totalPayback;
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
        operatorBalances[_publicKey] = OperatorBalanceSnapshot(block.number, 0, 0);
    }

    /**
     * @dev See {ISSVNetwork-validatorBalanceOf}.
     */
    function validatorBalanceOf(bytes calldata _pubKey) public override returns(uint256) {
        uint256 currentBlockNumber = block.number;
        return calculateValidatorUsage(_pubKey, currentBlockNumber);
    }

    /**
     * @dev See {ISSVNetwork-calculateValidatorUsage}.
     */
    // TODO: private doesn't work. Need to fix it
    function calculateValidatorUsage(bytes calldata _pubKey, uint256 _currentBlockNumber) public override returns(uint256) {
        ValidatorBalanceSnapshot storage balanceSnapshot = validatorBalances[_pubKey];
        uint256 usage = balanceSnapshot.balance + SSVRegistryContract.getValidatorUsage(_pubKey, balanceSnapshot.blockNumber, _currentBlockNumber);
    }

    /**
     * @dev See {ISSVNetwork-updateValidatorBalance}.
     */
    function updateValidatorBalance(bytes calldata _pubKey) public override {
        uint256 currentBlockNumber = block.number;
        uint256 totalUsage = calculateValidatorUsage(_pubKey, currentBlockNumber);
        ValidatorBalanceSnapshot storage balanceSnapshot = validatorBalances[_pubKey];
        balanceSnapshot.blockNumber = currentBlockNumber;
        balanceSnapshot.balance = totalUsage;
    }

    /**
     * @dev See {ISSVNetwork-registerValidator}.
     */
    function registerValidator(
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys
    ) public virtual override {
        SSVRegistryContract.registerValidator(
            msg.sender,
            _publicKey,
            _operatorPublicKeys,
            _sharesPublicKeys,
            _encryptedKeys
        );
        validatorBalances[_publicKey] = ValidatorBalanceSnapshot(block.number, 0);

        for (uint256 index = 0; index < _operatorPublicKeys.length; ++index) {
            bytes memory operatorPubKey = _operatorPublicKeys[index];
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
            bytes memory operatorPubKey = currentOperatorPubKeys[index];
            updateOperatorBalance(operatorPubKey);
            operatorBalances[operatorPubKey].validatorCount--;
        }

        // calculate balances for new operators in use
        for (uint256 index = 0; index < _operatorPublicKeys.length; ++index) {
            bytes memory operatorPubKey = _operatorPublicKeys[index];
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
            bytes memory operatorPubKey = currentOperatorPubKeys[index];
            updateOperatorBalance(operatorPubKey);
            operatorBalances[operatorPubKey].validatorCount--;
        }

        SSVRegistryContract.deleteValidator(msg.sender, _publicKey);
    }

    /**
     * @dev See {ISSVNetwork-deleteValidator}.
     */
    function deleteOperator(bytes memory _publicKey) public virtual override {
        updateOperatorBalance(_publicKey);
        SSVRegistryContract.deleteOperator(msg.sender, _publicKey);
    }
}