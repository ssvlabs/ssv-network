// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../interfaces/ISSVOperators.sol";
import "../../interfaces/ISSVNetworkCore.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract OperatorEarningsReentrancySSV {
    ISSVOperators public immutable operators;
    IERC20 public immutable token;

    uint64 public operatorId;
    uint256 public reenterAmount;
    bool public reentered;
    bool public reenterSucceeded;

    constructor(address operators_, address token_) {
        operators = ISSVOperators(operators_);
        token = IERC20(token_);
    }

    function registerOperator(bytes calldata publicKey, uint256 fee, bool setPrivate) external returns (uint64 id) {
        id = operators.registerOperator(publicKey, fee, setPrivate);
        operatorId = id;
    }

    function setReenterAmount(uint256 amount) external {
        reenterAmount = amount;
    }

    function triggerWithdraw(uint256 amount) external {
        operators.withdrawOperatorEarningsSSV(operatorId, amount);
    }
    
    // Callback for ReentrantTokenMock
    function onTransferReceived(address, uint256) external returns (bool) {
        if (reentered) return true;
        reentered = true;

        try operators.withdrawOperatorEarningsSSV(operatorId, reenterAmount) {
            reenterSucceeded = true;
        } catch {
            reenterSucceeded = false;
        }
        return true;
    }
}
