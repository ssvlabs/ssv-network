// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISSVNetworkCore {
    /***********/
    /* Structs */
    /***********/

    struct Validator {
        address owner;
        bool active;
    }
    struct Snapshot {
        /// @dev block is the last block in which last index was set. For Operator, it's also used to identify an active / inactive one.
        uint64 block;
        /// @dev index is the last index calculated by index += (currentBlock - block) * fee
        uint64 index;
        /// @dev accumulated is all the accumulated earnings, calculated by accumulated + lastIndex * validatorCount
        uint64 balance;
    }

    struct Operator {
        address owner;
        /// @dev when fee is set to zero (mostly for private operators), it can not be increased
        uint64 fee;
        uint32 validatorCount;
        Snapshot snapshot;
    }

    struct OperatorFeeChangeRequest {
        uint64 fee;
        uint64 approvalBeginTime;
        uint64 approvalEndTime;
    }

    struct Cluster {
        uint32 validatorCount;
        uint64 networkFeeIndex;
        uint64 index;
        uint256 balance;
        bool active;
    }

    struct DAO {
        uint32 validatorCount;
        uint64 balance;
        uint64 block;
    }

    struct Network {
        uint64 networkFee;
        uint64 networkFeeIndex;
        uint64 networkFeeIndexBlockNumber;
    }

    /**********/
    /* Errors */
    /**********/

    error CallerNotOwner();
    error CallerNotWhitelisted();
    error FeeTooLow();
    error FeeExceedsIncreaseLimit();
    error NoFeeDelcared();
    error ApprovalNotWithinTimeframe();
    error OperatorDoesNotExist();
    error InsufficientBalance();
    error ValidatorAlreadyExists();
    error ValidatorDoesNotExist();
    error ClusterNotLiquidatable();
    error InvalidPublicKeyLength();
    error InvalidOperatorIdsLength();
    error ValidatorOwnedByOtherAddress();
    error ClusterAlreadyEnabled();
    error ClusterIsLiquidated();
    error ClusterDoesNotExists();
    error IncorrectClusterState();
    error UnsortedOperatorsList();
    error NewBlockPeriodIsBelowMinimum();
    error ExceedValidatorLimit();
    error TokenTransferFailed();
    error SameFeeChangeNotAllowed();
    error FeeIncreaseNotAllowed();
}
