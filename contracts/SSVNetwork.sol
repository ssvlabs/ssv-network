// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;
import "hardhat/console.sol";

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./ISSVNetwork.sol";
import "./ISSVRegister.sol";

contract SSVNetwork is ISSVNetwork {
    // using SafeMath for uint256;

    ISSVRegister private SSVRegisterContract;

    function initialize(ISSVRegister _SSVRegisterAddress) public {
        SSVRegisterContract = _SSVRegisterAddress;
    }

    /**
     * @dev See {ISSVNetwork-updateOperatorFee}.
     */
    function updateOperatorFee(address _ownerAddress, uint256 fee) public override {
        SSVRegisterContract.updateOperatorFee(_ownerAddress, fee);
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
    function balanceOf(address _operatorAddress) public override {}

    /**
     * @dev See {ISSVNetwork-registerOperator}.
     */
    function registerOperator(
        string calldata _name,
        address _ownerAddress,
        bytes calldata _publicKey
    ) public override {}
}