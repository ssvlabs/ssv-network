// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

interface ISSVNetworkCore {
    /***********/
    /* Structs */
    /***********/

    /// @notice Represents a snapshot of an operator's or a DAO's state at a certain block
    struct Snapshot {
        /// @dev The block number when the snapshot was taken
        uint32 block;
        /// @dev The last index calculated by the formula index += (currentBlock    block) * fee
        uint64 index;
        /// @dev Total accumulated earnings calculated by the formula accumulated + lastIndex * validatorCount
        uint64 balance;
    }

    /// @notice Represents an SSV operator
    struct Operator {
        /// @dev The number of validators associated with this operator
        uint32 validatorCount;
        /// @dev The fee charged by the operator, set to zero for private operators and cannot be increased once set
        uint64 fee;
        /// @dev The address of the operator's owner
        address owner;
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

    /**********/
    /* Errors */
    /**********/

console.log(`CallerNotOwner    0x${keccak256('CallerNotOwner()').toString('hex').substring(0,8)}`);
console.log(`CallerNotWhitelisted    0x${keccak256('CallerNotWhitelisted()').toString('hex').substring(0,8)}`);
console.log(`FeeTooLow    0x${keccak256('FeeTooLow()').toString('hex').substring(0,8)}`);
console.log(`FeeExceedsIncreaseLimit    0x${keccak256('FeeExceedsIncreaseLimit()').toString('hex').substring(0,8)}`);
console.log(`NoFeeDeclared    0x${keccak256('NoFeeDeclared()').toString('hex').substring(0,8)}`);
console.log(`ApprovalNotWithinTimeframe    0x${keccak256('ApprovalNotWithinTimeframe()').toString('hex').substring(0,8)}`);
console.log(`OperatorDoesNotExist    0x${keccak256('OperatorDoesNotExist()').toString('hex').substring(0,8)}`);
console.log(`InsufficientBalance    0x${keccak256('InsufficientBalance()').toString('hex').substring(0,8)}`);
console.log(`ValidatorAlreadyExists    0x${keccak256('ValidatorAlreadyExists()').toString('hex').substring(0,8)}`);
console.log(`ValidatorDoesNotExist    0x${keccak256('ValidatorDoesNotExist()').toString('hex').substring(0,8)}`);
console.log(`IncorrectValidatorState    0x${keccak256('IncorrectValidatorState()').toString('hex').substring(0,8)}`);
console.log(`ClusterNotLiquidatable    0x${keccak256('ClusterNotLiquidatable()').toString('hex').substring(0,8)}`);
console.log(`InvalidPublicKeyLength    0x${keccak256('InvalidPublicKeyLength()').toString('hex').substring(0,8)}`);
console.log(`InvalidOperatorIdsLength    0x${keccak256('InvalidOperatorIdsLength()').toString('hex').substring(0,8)}`);
console.log(`ClusterAlreadyEnabled    0x${keccak256('ClusterAlreadyEnabled()').toString('hex').substring(0,8)}`);
console.log(`ClusterIsLiquidated    0x${keccak256('ClusterIsLiquidated()').toString('hex').substring(0,8)}`);
console.log(`ClusterDoesNotExists    0x${keccak256('ClusterDoesNotExists()').toString('hex').substring(0,8)}`);
console.log(`IncorrectClusterState    0x${keccak256('IncorrectClusterState()').toString('hex').substring(0,8)}`);
console.log(`UnsortedOperatorsList    0x${keccak256('UnsortedOperatorsList()').toString('hex').substring(0,8)}`);
console.log(`NewBlockPeriodIsBelowMinimum    0x${keccak256('NewBlockPeriodIsBelowMinimum()').toString('hex').substring(0,8)}`);
console.log(`ExceedValidatorLimit    0x${keccak256('ExceedValidatorLimit()').toString('hex').substring(0,8)}`);
console.log(`TokenTransferFailed    0x${keccak256('TokenTransferFailed()').toString('hex').substring(0,8)}`);
console.log(`SameFeeChangeNotAllowed    0x${keccak256('SameFeeChangeNotAllowed()').toString('hex').substring(0,8)}`);
console.log(`FeeIncreaseNotAllowed    0x${keccak256('FeeIncreaseNotAllowed()').toString('hex').substring(0,8)}`);
console.log(`NotAuthorized    0x${keccak256('NotAuthorized()').toString('hex').substring(0,8)}`);
console.log(`OperatorsListNotUnique    0x${keccak256('OperatorsListNotUnique()').toString('hex').substring(0,8)}`);
console.log(`OperatorAlreadyExists    0x${keccak256('OperatorAlreadyExists()').toString('hex').substring(0,8)}`);
console.log(`TargetModuleDoesNotExist    0x${keccak256('TargetModuleDoesNotExist()').toString('hex').substring(0,8)}`);
console.log(`MaxValueExceeded    0x${keccak256('MaxValueExceeded()').toString('hex').substring(0,8)}`);
}
