// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;
import "hardhat/console.sol";

import "./ISSVNetwork.sol";
import "./ISSVRegister.sol";

contract SSVNetwork is ISSVNetwork {
    ISSVRegister private SSVRegisterContract;

    mapping(address => OperatorBalanceInfo) internal operatorBalances;
    mapping(address => AddressValidatorBalanceInfo) internal addressValidatorBalanceInfo;

    function initialize(ISSVRegister _SSVRegisterAddress) public {
        SSVRegisterContract = _SSVRegisterAddress;
    }

    /**
     * @dev See {ISSVNetwork-updateOperatorFee}.
     */
    function updateOperatorFee(address _ownerAddress, uint256 fee) public override {
        SSVRegisterContract.updateOperatorFee(_ownerAddress, fee);
        emit OperatorFeeUpdated(_ownerAddress, fee);
    }

    /**
     * @dev See {ISSVNetwork-getOperatorFee}.
     */
    function getOperatorFee(address _ownerAddress) public override returns(uint256) {
        uint256 fee = SSVRegisterContract.operatorFees(_ownerAddress);
        return fee;
    }

    /**
     * @dev See {ISSVNetwork-operatorBalanceOf}.
     */
    function operatorBalanceOf(address _ownerAddress) public view override returns(uint256) {
        return calculateOperatorBalance(_ownerAddress);
    }

    /**
     * @dev See {ISSVNetwork-calculateOperatorBalance}.
     */
    function calculateOperatorBalance(address _ownerAddress) public override returns(uint256) {
        uint256 fee = getOperatorFee(_ownerAddress); // will be used get after PR will be merged
        uint256 balance = operatorBalanceOf(_ownerAddress) + (block.number - operatorBalances[_ownerAddress].blockNumber) * operatorBalances[_ownerAddress].numValidators * fee;
        return balance;
    }

    /**
     * @dev See {ISSVNetwork-updateOperatorBalance}.
     */
    function updateOperatorBalance(address _ownerAddress) public override {
        uint256 balance = calculateOperatorBalance(_ownerAddress);
        operatorBalances[_ownerAddress] = OperatorBalanceInfo(balance, block.number, operatorBalances[_ownerAddress].numValidators + 1);
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
        return calculateValidatorBalance(_ownerAddress);
    }

    /**
     * @dev See {ISSVNetwork-calculateOperatorBalance}.
     */
    function calculateValidatorBalance(address _ownerAddress) public view override returns(uint256) {
        uint256 totalUsed = 0;
        AddressValidatorBalanceInfo storage addressItem = addressValidatorBalanceInfo[_ownerAddress];
        for (uint256 index = 0; index < addressItem.validatorBalances.length; ++index) {
            totalUsed += (block.number - addressItem.validatorBalances[index].blockNumber) * addressItem.validatorBalances[index].fee;
        }
        return addressItem.balance - totalUsed;
    }

    /**
     * @dev See {ISSVNetwork-updateValidatorBalance}.
     */
    function updateValidatorBalance(address _ownerAddress) public override {
        addressValidatorBalanceInfo[_ownerAddress].balance = calculateValidatorBalance(_ownerAddress);
    }
}