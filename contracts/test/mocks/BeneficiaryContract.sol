// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../interfaces/external/ISSVWhitelistingContract.sol";
import "../../interfaces/ISSVOperators.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract BeneficiaryContract {
    ISSVOperators private ssvContract;
    uint64 private targetOperatorId;

    constructor(ISSVOperators _ssvContract) {
        ssvContract = _ssvContract;
    }

    function setTargetOperatorId(uint64 _operatorId) external {
        targetOperatorId = _operatorId;
    }

    function withdrawOperatorEarnings(uint256 amount) external {
        // Call SSVNetwork contract, acting as the owner of the operator to try withdraw earnings
        ISSVOperators(ssvContract).withdrawOperatorEarnings(targetOperatorId, amount);
    }

    function registerOperator() external returns (uint64 operatorId) {
        return ISSVOperators(ssvContract).registerOperator("0xcafecafe", 1000000000, false);
    }
}
