// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../ISSVNetworkCore.sol";

library OperatorLib {
    function updateSnapshot(ISSVNetworkCore.Operator memory operator) internal view {
        uint64 blockDiffFee = (uint64(block.number) - operator.snapshot.block) * operator.fee;

        operator.snapshot.index += blockDiffFee;
        operator.snapshot.balance += blockDiffFee * operator.validatorCount;
        operator.snapshot.block = uint64(block.number);
    }
}
