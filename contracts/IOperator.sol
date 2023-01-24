// File: contracts/ISSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "./ISSVNetwork.sol";

    struct Operator {
        address owner;
        uint64 fee;
        uint32 validatorCount;
        ISSVNetwork.Snapshot snapshot;
    }

    struct OperatorFeeChangeRequest {
        uint64 fee;
        uint64 approvalBeginTime;
        uint64 approvalEndTime;
    }

    error OperatorDoesNotExist();
    error NoFeeDelcared();

