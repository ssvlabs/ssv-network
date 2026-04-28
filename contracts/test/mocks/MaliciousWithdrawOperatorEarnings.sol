// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISSVOperators} from "../../interfaces/ISSVOperators.sol";
import {ISSVOperatorsWhitelist} from "../../interfaces/ISSVOperatorsWhitelist.sol";

contract MaliciousWithdrawOperatorEarnings {
    address public ssvNetwork;
    uint64 public opId;
    uint256 public amount;

    constructor(address _ssvNetwork) {
        ssvNetwork = _ssvNetwork;
    }

    function setParams(uint64 _opId, uint256 _amount) external {
        opId = _opId;
        amount = _amount;
    }

    function registerOperator(bytes memory publicKey, uint256 fee, bool setPrivate) external returns (uint64) {
        return ISSVOperators(ssvNetwork).registerOperator(publicKey, fee, setPrivate);
    }

    function setOperatorsWhitelists(uint64[] memory operators, address[] memory addresses) external {
        ISSVOperatorsWhitelist(ssvNetwork).setOperatorsWhitelists(operators, addresses);
    }

    function attack() external payable {
        ISSVOperators(ssvNetwork).withdrawOperatorEarnings(opId, amount);
    }

    receive() external payable {
        ISSVOperators(ssvNetwork).withdrawOperatorEarnings(opId, amount);
    }
}