// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;
import "hardhat/console.sol";

import "./ISSVNetwork.sol";
import "./ISSVRegister.sol";

contract SSVNetwork is ISSVNetwork {
    ISSVRegister private SSVRegisterContract;

    mapping(address => BalanceInfo) internal balances;

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
     * @dev See {ISSVNetwork-balanceOf}.
     */
    function balanceOf(address _ownerAddress) public view override returns(uint256) {
        console.log("Trying to get balance for %s is %s", _ownerAddress, balances[_ownerAddress].balance);
        return balances[_ownerAddress].balance;
    }

    /**
     * @dev See {ISSVNetwork-updateBalance}.
     */
    function updateBalance(address _ownerAddress) public override {
        console.log("%s, %s, %s", balances[_ownerAddress].blockNumber, balances[_ownerAddress].numValidators, balances[_ownerAddress].balance);
        uint256 fee = getOperatorFee(_ownerAddress); // will be used get after PR will be merged
        uint256 balance = balanceOf(_ownerAddress) + (block.number - balances[_ownerAddress].blockNumber) * balances[_ownerAddress].numValidators * fee;
        balances[_ownerAddress] = BalanceInfo(balance, block.number, balances[_ownerAddress].numValidators + 1);
    }

    /**
     * @dev See {ISSVNetwork-registerOperator}.
     */
    function registerOperator(
        string calldata _name,
        address _ownerAddress,
        bytes calldata _publicKey
    ) public override {}
}