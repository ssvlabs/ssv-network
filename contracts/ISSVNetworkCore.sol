// File: contracts/ISSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;
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
        /// @dev block is the last block in which last index was set
        uint64 block;
        /// @dev index is the last index calculated by index += (currentBlock - block) * fee
        uint64 index;
        /// @dev accumulated is all the accumulated earnings, calculated by accumulated + lastIndex * validatorCount
        uint64 balance;
    }

    struct Operator {
        address owner;
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
        uint64 networkFee;
        uint64 networkFeeIndex;
        uint64 index;
        uint64 balance;
        bool disabled;
    }

    struct DAO {
        uint32 validatorCount;
        uint64 withdrawn;
        Snapshot earnings;
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
    error InsufficientFunds();
    error ClusterAlreadyEnabled();
    error ClusterIsLiquidated();
    error ClusterDoesNotExists();
    error IncorrectClusterState();
    error UnsortedOperatorsList();
    error NewBlockPeriodIsBelowMinimum();
    error ExceedValidatorLimit();
    error TokenTransferFailed();
}
