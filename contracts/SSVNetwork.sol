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
    function updateOperatorFee(address _ownerAddress, uint256 fee) public override {
        SSVRegisterContract.updateOperatorFee(_ownerAddress, block.number, fee);
    }

    /**
     * @dev See {ISSVNetwork-getOperatorFee}.
     */
    function getOperatorFee(address _ownerAddress) public override returns(OperatorFee[] calldata) {
        return SSVRegisterContract.operatorFees(_ownerAddress);
    }

    /**
     * @dev See {ISSVNetwork-operatorBalanceOf}.
     */
    function operatorBalanceOf(address _ownerAddress) public view override returns(uint256) {
        return calculateOperatorPayback(_ownerAddress);
    }

    /**
     * @dev See {ISSVNetwork-calculateOperatorPayback}.
     */
    function calculateOperatorPayback(address _ownerAddress) internal override returns(uint256) {
        OperatorFee[] memory fees = getOperatorFee(_ownerAddress);
        require(fees.length > 0, "Operator fees not found");

        if (operatorValidators[_ownerAddress].length == 0) {
            return 0;
        }
        uint256 balance;
        for (uint256 index = 0; index < operatorValidators[_ownerAddress].length; ++index) {
            OperatorValidators memory validatorsInBlock = operatorValidators[_ownerAddress][index];
            uint256 blockBalance;
            for (uint256 feeIndex = 0; feeIndex < fees.length; ++feeIndex) {
                if (fees[feeIndex].blockNumber <= validatorsInBlock.blockNumber) {
                    blockBalance = fees[feeIndex].fee * validatorsInBlock.amountValidators;
                }
            }
            balance += blockBalance;
        }
        return balance;
    }

    /**
     * @dev See {ISSVNetwork-addOperatorValidator}.
     */
    function addOperatorValidator(address _operatorAddress, uint256 blockNumber) internal override {
        uint256 latestTotalValidators = 0;
        if (operatorValidators[_operatorAddress].length > 0) {
            latestTotalValidators = operatorValidators[_operatorAddress][operatorValidators[_operatorAddress].length - 1];
        }
        operatorValidators[_operatorAddress].push(
            OperatorValidators(blockNumber, latestTotalValidators + 1)
        );
    }

    /**
     * @dev See {ISSVNetwork-deductOperatorValidator}.
     */
    function deductOperatorValidator(address _ownerAddress, uint256 blockNumber, uint256 amountValidators) internal override {
        uint256 latestTotalValidators = 0;
        if (operatorValidators[_ownerAddress].length > 0) {
            latestTotalValidators = operatorValidators[_ownerAddress][operatorValidators[_ownerAddress].length - 1];
        }
        require(latestTotalValidators - amountValidators < 0, "Requested validators not found for current block");
        operatorValidators[_ownerAddress].push(
            OperatorValidators(blockNumber, latestTotalValidators - amountValidators)
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
    function validatorBalanceOf(address _ownerAddress) public view override returns(uint256) {
        return calculateValidatorCharges(_ownerAddress);
    }

    /**
     * @dev See {ISSVNetwork-calculateOperatorCharges}.
     Example:
     in block #1 registered 1 vaildator => 
        0x000 - operator
        0x001 - operator
        0x002 - operator
        0x003 - operator
     in block #10 registered 1 vaildator => 
        0x011 - operator
        0x014 - operator
     in block #12 registered 1 vaildator => 
        0x021 - operator
        0x022 - operator
        0x023 - operator
     */
    function calculateValidatorCharges(address _ownerAddress) internal override returns(uint256) {
        AddressValidatorBalanceInfo storage validatorItem = addressValidatorBalanceInfo[_ownerAddress];
        uint256 totalUsed;
        for (uint256 index = 0; index < validatorItem.validatorsInBlock.length; ++index) {
            OperatorFee[] memory fees = getOperatorFee(validatorItem.validatorsInBlock[index].operatorAddress);
            uint256 blockBalance;
            for (uint256 feeIndex = 0; feeIndex < fees.length; ++feeIndex) {
                if (fees[feeIndex].blockNumber <= validatorItem.validatorsInBlock[index].blockNumber) {
                    blockBalance = fees[feeIndex].fee * validatorItem.validatorsInBlock[index].amountValidators;
                }
            }
            totalUsed += blockBalance;
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
    ) public virtual {
        address ownerAddress = msg.sender;
        SSVRegisterContract.addValidator(
            ownerAddress,
            _publicKey,
            _operatorPublicKeys,
            _sharesPublicKeys,
            _encryptedKeys
        );
        uint256 blockNumber = block.number;
        for (uint256 index = 0; index < _operatorPublicKeys.length; ++index) {
            address operatorAddress = SSVRegisterContract.operators(_operatorPublicKeys[index]).ownerAddress;
            AddressValidatorBalanceInfo[ownerAddress].validatorsInBlock.push(
                ValidatorsInBlock(blockNumber, operatorAddress)
            );
            addOperatorValidator(operatorAddress, blockNumber);
        }
    }
}