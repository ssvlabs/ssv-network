// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISSVOperators} from "../../interfaces/ISSVOperators.sol";
import {ISSVOperatorsWhitelist} from "../../interfaces/ISSVOperatorsWhitelist.sol";

contract MaliciousWithdrawAllOperatorEarnings {
    address public ssvNetwork;
    uint64 public opId;

    constructor(address _ssvNetwork) {
        ssvNetwork = _ssvNetwork;
    }

    function setParams(uint64 _opId) external {
        opId = _opId;
    }

    function registerOperator(bytes memory publicKey, uint256 fee, bool setPrivate) external returns (uint64) {
        return ISSVOperators(ssvNetwork).registerOperator(publicKey, fee, setPrivate);
    }

    function setOperatorsWhitelists(uint64[] memory operators, address[] memory addresses) external {
        ISSVOperatorsWhitelist(ssvNetwork).setOperatorsWhitelists(operators, addresses);
    }

    function attack() external {
        ISSVOperators(ssvNetwork).withdrawAllOperatorEarnings(opId);
    }

    receive() external payable {
        ISSVOperators(ssvNetwork).withdrawAllOperatorEarnings(opId);
    }
}