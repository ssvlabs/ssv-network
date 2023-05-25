// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/ISSVNetworkCore.sol";
import "./SSVStorage.sol";
import "./Types.sol";


library OperatorLib {
    using Types64 for uint64;

    function updateSnapshot(ISSVNetworkCore.Operator memory operator) internal view {
        uint64 blockDiffFee = (uint64(block.number) - operator.snapshot.block) * operator.fee;

        operator.snapshot.index += blockDiffFee;
        operator.snapshot.balance += blockDiffFee * operator.validatorCount;
        operator.snapshot.block = uint64(block.number);
    }

    function checkOwner(ISSVNetworkCore.Operator memory operator) internal view {
        if (operator.snapshot.block == 0) revert ISSVNetworkCore.OperatorDoesNotExist();
        if (operator.owner != msg.sender) revert ISSVNetworkCore.CallerNotOwner();
    }

    function transfer(address to, uint256 amount) internal {
        if (!SSVStorage.load().token.transfer(to, amount)) {
            revert ISSVNetworkCore.TokenTransferFailed();
        }
    }

    // Views
    function getOperatorById(uint64 operatorId) internal view returns (address, uint256, uint32, bool, bool) {
        ISSVNetworkCore.Operator memory operator = SSVStorage.load().operators[operatorId];
        bool isPrivate = SSVStorage.load().operatorsWhitelist[operatorId] == address(0) ? false : true;
        bool isActive = operator.snapshot.block == 0 ? false : true;

        return (operator.owner, operator.fee.expand(), operator.validatorCount, isPrivate, isActive);
    }
}
