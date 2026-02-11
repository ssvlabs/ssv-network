// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {PackedSSV, PackedETH} from "../libraries/SSVCoreTypes.sol";

interface ISSVNetworkCore {
    /// @notice Represents a snapshot of an SSV operator's or a SSV DAO's state at a certain block
    struct Snapshot {
        /// @dev The block number when the snapshot was taken
        uint32 block;
        /// @dev The last index calculated by the formula index += (currentBlock - block) * fee
        uint64 index;
        /// @dev Total accumulated earnings calculated by the formula accumulated + lastIndex * validatorCount
        PackedSSV balance;
    }

    /// @notice Represents a snapshot of an operator's or a DAO's state at a certain block
    struct EthSnapshot {
        /// @dev The block number when the snapshot was taken
        uint32 block;
        /// @dev The last index calculated by the formula index += (currentBlock - block) * fee
        uint64 index;
        /// @dev Total accumulated earnings calculated by the formula accumulated + lastIndex * validatorCount
        PackedETH balance;
    }

    /// @notice Represents an SSV operator
    struct Operator {
        /// @dev The number of validators associated with this operator
        uint32 validatorCount;
        /// @dev The fee charged by the operator, set to zero for private operators and cannot be increased once set
        PackedSSV fee;
        /// @dev The address of the operator's owner
        address owner;
        /// @dev private flag for this operator
        bool whitelisted;
        /// @dev The state snapshot of the operator
        Snapshot snapshot;
        
        /// @dev The number of validators associated with this operator in eth
        uint32 ethValidatorCount;
        /// @dev The fee charged by the operator in eth, set to zero for private operators and cannot be increased once set
        PackedETH ethFee;
        /// @dev The state snapshot of the operator for eth
        EthSnapshot ethSnapshot;
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

    /**
     * @dev Thrown when the caller is not the owner of the called entity (operator, cluster)
     */
    error CallerNotOwnerWithData(address caller, address owner); // 0x8907fc65

    /**
     * @dev Thrown when the caller is trying to create a cluster with an operator who did not whitelist the caller
     */
    error CallerNotWhitelistedWithData(uint64 operatorId); // 0xb7f529fe

    /**
     * @dev Thrown when trying to use a fee that is below a minimum allowed
     */
    error FeeTooLow(); // 0x732f9413

    /**
     * @dev Thrown when trying to increase the fee above the allowed limit
     */
    error FeeExceedsIncreaseLimit(); // 0x958065d9

    /**
     * @dev Thrown when trying executee a fee without declaration
     */
    error NoFeeDeclared(); // 0x1d226c30

    /**
     * @dev Thrown when trying to execute fee change outside approval timeframe
     */
    error ApprovalNotWithinTimeframe(); // 0x97e4b518

    /**
     * @dev Thrown when operator does not exist
     */
    error OperatorDoesNotExist(); // 0x961e3e8c

    /**
     * @dev Thrown when balance required to perform an action is insufficient
     */
    error InsufficientBalance(); // 0xf4d678b8

    /**
     * @dev Thrown when validator does not exist
     */
    error ValidatorDoesNotExist(); // 0xe51315d2

    /**
     * @dev Thrown when cluster is not liquidatable
     */
    error ClusterNotLiquidatable(); // 0x60300a8d

    /**
     * @dev Thrown when public key length is invalid
     */
    error InvalidPublicKeyLength(); // 0x637297a4

    /**
     * @dev Thrown when operator IDs length is invalid (allowed only 4, 7, 10 and 13)
     */
    error InvalidOperatorIdsLength(); // 0x38186224

    /**
     * @dev Thrown when trying to reactive active cluster
     */
    error ClusterAlreadyEnabled(); // 0x3babafd2

    /**
     * @dev Thrown when trying to interact with a liquidated cluster
     */
    error ClusterIsLiquidated(); // 0x95a0cf33

    /**
     * @dev Thrown when cluster does not exist
     */
    error ClusterDoesNotExist(); // 0x25d92f88

    /**
     * @dev Thrown when the provided data is incorrect
     */
    error IncorrectClusterState(); // 0x12e04c87

    /**
     * @dev Thrown when operators list is unsorted
     */
    error UnsortedOperatorsList(); // 0xdd020e25

    /**
     * @dev Thrown when new block period is below minimum
     */
    error NewBlockPeriodIsBelowMinimum(); // 0x6e6c9cac

    /**
     * @dev Thrown when registering a validator, but validator limit is exceeded
     */
    error ExceedValidatorLimitWithData(uint64 operatorId); // 0x639f5851

    /**
     * @dev Thrown when token transfer fails
     */
    error TokenTransferFailed(); // 0x045c4b02

    /**
     * @dev Thrown when trying to change fee to the same value
     */
    error SameFeeChangeNotAllowed(); // 0xc81272f8

    /**
     * @dev Thrown when trying to increase fee of a free operator
     */
    error FeeIncreaseNotAllowed(); // 0x410a2b6c

    /**
     * @dev Thrown when caller is not authorized to perform the action
     */
    error NotAuthorized(); // 0xea8e4eb5

    /**
     * @dev Thrown when operators list is not unique and has duplicates
     */
    error OperatorsListNotUnique(); // 0xa5a1ff5d

    /**
     * @dev Thrown when operator with the same public key already exists
     */
    error OperatorAlreadyExists(); // 0x289c9494

    /**
     * @dev Thrown when target module does not exist
     */
    error TargetModuleDoesNotExistWithData(uint8 moduleId); // 0x208bb85d

    /**
     * @dev Thrown when maximum value is exceeded
     */
    error MaxValueExceeded(); // 0x91aa3017

    /**
     * @dev Thrown when the provided fee is too high
     */
    error FeeTooHigh(); // 0xcd4e6167

    /**
     * @dev Thrown when public keys and shares arrays length mismatch
     */
    error PublicKeysSharesLengthMismatch(); // 0x9ad467b8

    /**
     * @dev Thrown when validator state is incorrect
     */
    error IncorrectValidatorStateWithData(bytes publicKey); // 0x89307938

    /**
     * @dev Thrown when trying to register a validator that is already registered
     */
    error ValidatorAlreadyExistsWithData(bytes publicKey); // 0x388e7999

    /**
     * @dev Thrown when public keys list is empty
     */
    error EmptyPublicKeysList(); // 0xdf83e679

    /**
     * @dev Thrown when contract address is invalid
     */
    error InvalidContractAddress(); // 0xa710429d

    /**
     * @dev Thrown when address is a whitelisting contract
     */
    error AddressIsWhitelistingContract(address contractAddress); // 0x71cadba7

    /**
     * @dev Thrown when whitelisting contract is invalid
     */
    error InvalidWhitelistingContract(address contractAddress); // 0x886e6a03

    /**
     * @dev Thrown when whitelist addresses length is invalid
     */
    error InvalidWhitelistAddressesLength(); // 0xcbb362dc

    /**
     * @dev Thrown when trying to use zero address
     */
    error ZeroAddressNotAllowed(); // 0x8579befe

    /**
     * @dev Thrown when operator version is incorrect
     */
    error IncorrectOperatorVersion(uint8 operatorVersion); // 0xf222e863

    /**
     * @dev Thrown when cluster version is incorrect
     */
    error IncorrectClusterVersion(); // 0xf6749746

    /**
     * @dev Thrown when ETH transfer fails
     */
    error ETHTransferFailed(); // 0xb12d13eb

    /**
     * @dev Thrown when legacy operator fee declaration (before migration) is invalid for current configuration
     */
    error LegacyOperatorFeeDeclarationInvalid(); // 0x9e593e76

    /**
     * @dev Thrown when the provided block number is stale
     */
    error StaleBlockNumber(); // 0x305c3e93

    /**
     * @dev Thrown when commiting a block number that is in future
     */
    error FutureBlockNumber(); // 0x252f8a0e

    /**
     * @dev Thrown when the merkle for a specific block root was not found
     */
    error RootNotFound(); // 0x3033b0ff

    /**
     * @dev Thrown when eb update is happening too frequent
     */
    error UpdateTooFrequent(); // 0x53f7a6ee

    /**
     * @dev Thrown when eb update is stale
     */
    error StaleUpdate(); // 0x666a2814

    /**
     * @dev Thrown when the merkle proof is invalid
     */
    error InvalidProof(); // 0x09bde339

    /**
     * @dev Thrown when EB exceeds maximum allowed
     */
    error EBExceedsMaximum(); // 0xf5ca7cb9

    /**
     * @dev Thrown when EB is below minimum
     */
    error EBBelowMinimum(); // 0x9fecdce5

    /**
     * @dev Thrown when oracle has zero weight due to zero staked SSV
     */
    error OracleHasZeroWeight(); // 0xf2b58fb9

    /**
     * @dev Thrown when the caller is not cSSV token
     */
    error NotCSSV(); // 0x1598959e

    /**
     * @dev Thrown when trying to use zero address
     */
    error ZeroAddress(); // 0xd92e233d

    /**
     * @dev Thrown when trying to configure a quorum higher than 100%
     */
    error InvalidQuorum(); // 0xd1735779

    /**
     * @dev Thrown when amount is zero
     */
    error ZeroAmount(); // 0x1f2a2005

    /**
     * @dev Thrown when token is invalid
     */
    error InvalidToken(); // 0xc1ab6dc1

    /**
     * @dev Thrown when user has nothing to claim
     */
    error NothingToClaim(); // 0x969bf728

    /**
     * @dev Thrown when user has nothing to withdraw
     */
    error NothingToWithdraw(); // 0xd0d04f60

    /**
     * @dev Thrown when unstake amount exceeds staked balance
     */
    error UnstakeAmountExceedsBalance(); // 0x02a19f57

    /**
     * @dev Thrown when stake amount is less than minimum allowed
     */
    error StakeTooLow(); // 0x1cc3b37b

    /**
     * @dev Thrown when the caller is not an oracle
     */
    error NotOracle(); // 0x1bc2178f

    /**
     * @dev Thrown when the oracle already voted for this root
     */
    error AlreadyVoted(); // 0x7c9a1cf9

    /**
     * @dev Thrown when oracle is already assigned with the selected address
     */
    error OracleAlreadyAssigned(); // 0xa97938cb

    /**
     * @dev Thrown when the maximum unstake requests amount reached
     */
    error MaxRequestsAmountReached(); // 0xee0e82ff

}
