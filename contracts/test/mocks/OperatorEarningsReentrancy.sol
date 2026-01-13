// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../interfaces/ISSVOperators.sol";

contract OperatorEarningsReentrancy {
    ISSVOperators public immutable operators;

    uint64 public operatorId;
    uint256 public reenterAmount;
    bool public reentered;
    bool public reenterSucceeded;

    constructor(address operators_) {
        operators = ISSVOperators(operators_);
    }

    function registerOperator(bytes calldata publicKey, uint256 fee, bool setPrivate) external returns (uint64 id) {
        id = operators.registerOperator(publicKey, fee, setPrivate);
        operatorId = id;
    }

    function setReenterAmount(uint256 amount) external {
        reenterAmount = amount;
    }

    function triggerWithdraw(uint256 amount) external {
        operators.withdrawOperatorEarnings(operatorId, amount);
    }

    receive() external payable {
        if (reentered) return;
        reentered = true;

        try operators.withdrawOperatorEarnings(operatorId, reenterAmount) {
            reenterSucceeded = true;
        } catch {
            reenterSucceeded = false;
        }
    }
}
