// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

interface ISSVNetworkCore {
    /***********/
    /* Structs */
    /***********/

    /// @notice Represents an SSV validator
    struct Validator {
        /// @dev Hashed IDs of operators related to this validator
        bytes32 hashedOperatorIds;
        /// @dev Flag indicating whether the validator is active
        bool active;
    }

    /// @notice Represents a snapshot of an operator's or a DAO's state at a certain block
    struct Snapshot {
        /// @dev The block number when the snapshot was taken
        uint32 block;
        /// @dev The last index calculated by the formula index += (currentBlock - block) * fee
        uint64 index;
        /// @dev Total accumulated earnings calculated by the formula accumulated + lastIndex * validatorCount
        uint64 balance;
    }

    /// @notice Represents an SSV operator
    struct Operator {
        /// @dev The address of the operator's owner
        address owner;
        /// @dev The fee charged by the operator, set to zero for private operators and cannot be increased once set
        uint64 fee;
        /// @dev The number of validators associated with this operator
        uint32 validatorCount;
        /// @dev Whitelisted flag for this operator 
        bool whitelisted;
        /// @dev The state snapshot of the operator
        Snapshot snapshot;
    }

    /// @notice Represents a request to change an operator's fee
    struct OperatorFeeChangeRequest {
        /// @dev The new fee proposed by the operator
        uint64 fee;
        /// @dev The time when the approval period for the fee change begins
        uint64 approvalBeginTime;
        /// @dev The time when the approval period for the fee change ends
        uint64 approvalEndTime;
    }

    /// @notice Contains the configuration related to operator fees
    struct OperatorFeeConfig {
        /// @dev The period in which an operator can declare their fee
        uint64 declareOperatorFeePeriod;
        /// @dev The period in which an operator can execute their fee change
        uint64 executeOperatorFeePeriod;
        /// @dev The maximum fee increase an operator can propose
        uint64 operatorMaxFeeIncrease;
    }

    /// @notice Represents a cluster of validators
    struct Cluster {
        /// @dev The number of validators in the cluster
        uint32 validatorCount;
        /// @dev The index of network fees related to this cluster
        uint64 networkFeeIndex;
        /// @dev The last index calculated for the cluster
        uint64 index;
        /// @dev Flag indicating whether the cluster is active
        bool active;
        /// @dev The balance of the cluster
        uint256 balance;
    }

    /// @notice Represents the DAO of the SSV network
    struct DAO {
        /// @dev The number of validators in the network
        uint32 validatorCount;
        /// @dev The balance of the DAO
        uint64 balance;
        /// @dev The block number when the last update was made
        uint32 block;
    }

    /// @notice Represents the network status of the SSV network
    struct Network {
        /// @dev The network fee
        uint64 networkFee;
        /// @dev The index of the network fee
        uint64 networkFeeIndex;
        /// @dev The block number when the last network fee index was set
        uint32 networkFeeIndexBlockNumber;
    }

    /**********/
    /* Errors */
    /**********/

    error CallerNotOwner();
    error CallerNotWhitelisted();
    error FeeTooLow();
    error FeeExceedsIncreaseLimit();
    error NoFeeDeclared();
    error ApprovalNotWithinTimeframe();
    error OperatorDoesNotExist();
    error InsufficientBalance();
    error ValidatorAlreadyExists();
    error ValidatorDoesNotExist();
    error IncorrectValidatorState();
    error ClusterNotLiquidatable();
    error InvalidPublicKeyLength();
    error InvalidOperatorIdsLength();
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
    error NotAuthorized();
    error OperatorsListNotUnique();
    error OperatorAlreadyExists();
    error TargetModuleDoesNotExist();
    error MaxValueExceeded();
}
