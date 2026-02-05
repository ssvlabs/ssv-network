// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

interface ISSVNetworkCore {
    /***********/
    /* Structs */
    /***********/

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
        /// @dev The number of validators associated with this operator
        uint32 validatorCount;
        /// @dev The fee charged by the operator, set to zero for private operators and cannot be increased once set
        uint64 fee;
        /// @dev The address of the operator's owner
        address owner;
        /// @dev private flag for this operator
        bool whitelisted;
        /// @dev The state snapshot of the operator
        Snapshot snapshot;
        
        /// @dev The number of validators associated with this operator in eth
        uint32 ethValidatorCount;
        /// @dev The fee charged by the operator in eth, set to zero for private operators and cannot be increased once set
        uint64 ethFee;
        /// @dev The state snapshot of the operator for eth
        Snapshot ethSnapshot;
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

    error CallerNotOwnerWithData(address caller, address owner); // 0x8907fc65
    error CallerNotWhitelistedWithData(uint64 operatorId); // 0xb7f529fe
    error FeeTooLow(); // 0x732f9413
    error FeeExceedsIncreaseLimit(); // 0x958065d9
    error NoFeeDeclared(); // 0x1d226c30
    error ApprovalNotWithinTimeframe(); // 0x97e4b518
    error OperatorDoesNotExist(); // 0x961e3e8c
    error InsufficientBalance(); // 0xf4d678b8
    error ValidatorDoesNotExist(); // 0xe51315d2
    error ClusterNotLiquidatable(); // 0x60300a8d
    error InvalidPublicKeyLength(); // 0x637297a4
    error InvalidOperatorIdsLength(); // 0x38186224
    error ClusterAlreadyEnabled(); // 0x3babafd2
    error ClusterIsLiquidated(); // 0x95a0cf33
    error ClusterDoesNotExist(); // 0x25d92f88
    error IncorrectClusterState(); // 0x12e04c87
    error UnsortedOperatorsList(); // 0xdd020e25
    error NewBlockPeriodIsBelowMinimum(); // 0x6e6c9cac
    error ExceedValidatorLimitWithData(uint64 operatorId); // 0x639f5851
    error TokenTransferFailed(); // 0x045c4b02
    error SameFeeChangeNotAllowed(); // 0xc81272f8
    error FeeIncreaseNotAllowed(); // 0x410a2b6c
    error NotAuthorized(); // 0xea8e4eb5
    error OperatorsListNotUnique(); // 0xa5a1ff5d
    error OperatorAlreadyExists(); // 0x289c9494
    error TargetModuleDoesNotExistWithData(uint8 moduleId); // 0x208bb85d
    error MaxValueExceeded(); // 0x91aa3017
    error FeeTooHigh(); // 0xcd4e6167
    error PublicKeysSharesLengthMismatch(); // 0x9ad467b8
    error IncorrectValidatorStateWithData(bytes publicKey); // 0x89307938
    error ValidatorAlreadyExistsWithData(bytes publicKey); // 0x388e7999
    error EmptyPublicKeysList(); // 0xdf83e679
    error InvalidContractAddress(); // 0xa710429d
    error AddressIsWhitelistingContract(address contractAddress); // 0x71cadba7
    error InvalidWhitelistingContract(address contractAddress); // 0x886e6a03
    error InvalidWhitelistAddressesLength(); // 0xcbb362dc
    error ZeroAddressNotAllowed(); // 0x8579befe
    error IncorrectOperatorVersion(uint8 operatorVersion); // 0xf222e863
    error IncorrectClusterVersion(); // 0xf6749746
    error ETHTransferFailed(); // 0xb12d13eb
    error LegacyOperatorFeeDeclarationInvalid(); // 0x9e593e76

    // EB oracle-specific errors
    error StaleBlockNumber(); // 0x305c3e93
    error FutureBlockNumber(); // 0x252f8a0e
    error RootNotFound(); // 0x3033b0ff
    error UpdateTooFrequent(); // 0x53f7a6ee
    error StaleUpdate(); // 0x666a2814
    error InvalidProof(); // 0x09bde339
    error EBExceedsMaximum(); // 0xf5ca7cb9
    error NotAuthorizedOracle(); // 0x0b7b9fc7
    error ZeroInterval(); // 0x346ff607
    error EBBelowMinimum(); // 0x9fecdce5
    error OracleHasZeroWeight(); // 0xf2b58fb9

    // SSV Staking-specific errors
    error NotCSSV(); // 0x1598959e
    error ZeroAddress(); // 0xd92e233d
    error ZeroAmount(); // 0x1f2a2005
    error InvalidToken(); // 0xc1ab6dc1
    error NothingToClaim(); // 0x969bf728
    error NothingToWithdraw(); // 0xd0d04f60
    error UnstakeAmountExceedsBalance(); // 0x02a19f57
    error StakeTooLow(); // 0x1cc3b37b
    error NotOracle(); // 0x1bc2178f
    error AlreadyVoted(); // 0x7c9a1cf9
    error OracleAlreadyAssigned(); // 0xa97938cb
    error MaxRequestsAmountReached(); // 0xee0e82ff

    // legacy errors
    error ValidatorAlreadyExists(); // 0x8d09a73e
    error IncorrectValidatorState(); // 0x2feda3c1
    error ExceedValidatorLimit(uint64 operatorId); // 0x8ddf7de4
    error CallerNotOwner(); // 0x5cd83192
    error TargetModuleDoesNotExist(); // 0x8f9195fb
    error CallerNotWhitelisted(); // 0x8c6e5d71
}
