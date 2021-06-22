// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;
import "hardhat/console.sol";

import "./ISSVNetwork.sol";
import "./ISSVRegister.sol";

contract SSVNetwork is ISSVNetwork {
    ISSVRegister private SSVRegisterContract;

    mapping(address => OperatorValidators[]) internal operatorValidators;
    mapping(address => AddressValidatorBalanceInfo) internal addressValidatorBalanceInfo;

    function initialize(ISSVRegister _SSVRegisterAddress) public {
        SSVRegisterContract = _SSVRegisterAddress;
    }

    /**
     * @dev See {ISSVNetwork-updateOperatorFee}.
     */
    function updateOperatorFee(address _ownerAddress, uint256 fee) public virtual override {
        SSVRegisterContract.updateOperatorFee(_ownerAddress, block.number, fee);
    }

    /**
     * @dev See {ISSVNetwork-operatorBalanceOf}.
     */
    function operatorBalanceOf(address _ownerAddress) public override returns(uint256) {
        return calculateOperatorPayback(_ownerAddress);
    }

    /**
     * @dev See {ISSVNetwork-calculateOperatorPayback}.
     */
    function calculateOperatorPayback(address _ownerAddress) public virtual override returns(uint256) {
        if (operatorValidators[_ownerAddress].length == 0) {
            return 0;
        }
        uint256 balance;
        for (uint256 index = 0; index < operatorValidators[_ownerAddress].length; ++index) {
            OperatorValidators memory validatorsInBlock = operatorValidators[_ownerAddress][index];
            uint256 fee = SSVRegisterContract.getOperatorFee(_ownerAddress, validatorsInBlock.blockNumber);
            uint256 blockBalance = fee * validatorsInBlock.amountValidators;
            balance += blockBalance;
        }
        return balance;
    }

    /**
     * @dev See {ISSVNetwork-addOperatorValidator}.
     */
    function addOperatorValidator(address _operatorAddress, uint256 _blockNumber) public virtual override {
        uint256 latestTotalValidators = 0;
        if (operatorValidators[_operatorAddress].length > 0) {
            latestTotalValidators = operatorValidators[_operatorAddress][operatorValidators[_operatorAddress].length - 1].amountValidators;
        }
        operatorValidators[_operatorAddress].push(
            OperatorValidators(_blockNumber, latestTotalValidators + 1)
        );
    }

    /**
     * @dev See {ISSVNetwork-deductOperatorValidator}.
     */
    function deductOperatorValidator(address _ownerAddress, uint256 _blockNumber, uint256 _amountValidators) public override {
        uint256 latestTotalValidators = 0;
        if (operatorValidators[_ownerAddress].length > 0) {
            latestTotalValidators = operatorValidators[_ownerAddress][operatorValidators[_ownerAddress].length - 1].amountValidators;
        }
        require(latestTotalValidators - _amountValidators < 0, "Requested validators not found for current block");
        operatorValidators[_ownerAddress].push(
            OperatorValidators(_blockNumber, latestTotalValidators - _amountValidators)
        );
    }

    /**
     * @dev See {ISSVNetwork-registerOperator}.
     */
    function registerOperator(
        string calldata _name,
        address _ownerAddress,
        bytes calldata _publicKey
    ) public override {}

    /**
     * @dev See {ISSVNetwork-validatorBalanceOf}.
     */
    function validatorBalanceOf(address _ownerAddress) public override returns(uint256) {
        return calculateValidatorCharges(_ownerAddress);
    }

    /**
     * @dev See {ISSVNetwork-calculateOperatorCharges}.
     */
    function calculateValidatorCharges(address _ownerAddress) public override returns(uint256) {
        AddressValidatorBalanceInfo storage validatorItem = addressValidatorBalanceInfo[_ownerAddress];
        uint256 totalUsed;
        for (uint256 index = 0; index < validatorItem.validatorsInBlock.length; ++index) {
            uint256 fee = SSVRegisterContract.getOperatorFee(_ownerAddress, validatorItem.validatorsInBlock[index].blockNumber);
            totalUsed += fee;
        }
        return totalUsed;
    }

    /**
     * @dev See {ISSVNetwork-updateValidatorBalance}.
     */
    function updateValidatorBalance(address _ownerAddress) public override {
        addressValidatorBalanceInfo[_ownerAddress].balance -= calculateValidatorCharges(_ownerAddress);
    }

    /**
     * @dev See {ISSVNetwork-addValidator}.
     */
    function addValidator(
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys
    ) public virtual override {
        address ownerAddress = msg.sender;
        SSVRegisterContract.addValidator(
            ownerAddress,
            _publicKey,
            _operatorPublicKeys,
            _sharesPublicKeys,
            _encryptedKeys
        );
        uint256 blockNumber = block.number;
        AddressValidatorBalanceInfo storage validatorItem = addressValidatorBalanceInfo[ownerAddress];

        for (uint256 index = 0; index < _operatorPublicKeys.length; ++index) {
            string memory name;
            address operatorAddress;
            bytes memory publicKey;
            uint256 score;
            (name, operatorAddress, publicKey, score) = SSVRegisterContract.operators(_operatorPublicKeys[index]);

            validatorItem.validatorsInBlock.push(
                ValidatorsInBlock(blockNumber, operatorAddress)
            );
            addOperatorValidator(operatorAddress, blockNumber);
        }
    }
}