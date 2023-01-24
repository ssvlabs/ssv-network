// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "../IOperator.sol";
import "../ISSVNetwork.sol";

library OperatorLib {
    function getSnapshot(
        Operator memory operator,
        uint64 currentBlock
    ) internal pure returns (ISSVNetwork.Snapshot memory) {
        uint64 blockDiffFee = (currentBlock - operator.snapshot.block) *
            operator.fee;

        operator.snapshot.index += blockDiffFee;
        operator.snapshot.balance += blockDiffFee * operator.validatorCount;
        operator.snapshot.block = currentBlock;

        return operator.snapshot;
    }
}
