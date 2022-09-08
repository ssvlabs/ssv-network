// File: contracts/ISSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


interface ISSVNetwork {

    /**
    * @dev Emitted when a new operator has been added.
    * @param id operator's ID.
    * @param owner Operator's ethereum address that can collect fees.
    * @param publicKey Operator's public key. Will be used to encrypt secret shares of validators keys.
    */
    event OperatorAdded(
        uint64 id,
        address indexed owner,
        bytes publicKey
    );

    /**
     * @dev Emitted when operator has been removed.
     * @param id operator's ID.
     */
    event OperatorRemoved(uint64 id);

    /**
     * @dev Emitted when the validator has been added.
     * @param publicKey The public key of a validator.
     * @param podId The pod id the validator been added to.
     * @param shares snappy compressed shares(a set of encrypted and public shares).
     */
    event ValidatorAdded(
        bytes publicKey,
        bytes32 podId,
        bytes shares
    );

    /**
     * @dev Emitted when validator was transferred between pods.
     * @param publicKey The public key of a validator.
     * @param podId The validator's new pod id.
     * @param shares snappy compressed shares(a set of encrypted and public shares).
     */
    event ValidatorTransferred(
        bytes publicKey,
        bytes32 podId,
        bytes shares
    );

    /**
     * @dev Emitted when validators were transferred between pods.
     * @param publicKeys An array of transferred public keys.
     * @param podId The validators new pod id.
     * @param shares an array of snappy compressed shares(a set of encrypted and public shares).
     */
    event BulkValidatorTransferred(
        bytes[] publicKeys,
        bytes32 podId,
        bytes[] shares
    );

    /**
     * @dev Emitted when the validator is removed.
     * @param publicKey The public key of a validator.
     * @param podId The pod id the validator has been removed from.
     */
    event ValidatorRemoved(bytes publicKey, bytes32 podId);

    event OperatorFeeDeclaration(
        address indexed ownerAddress,
        uint64 operatorId,
        uint256 blockNumber,
        uint256 fee
    );

    /**
     * @dev Emitted when operator changed fee.
     * @param id operator's ID.
     * @param fee operator's new fee.
     */
    event OperatorFeeSet(uint64 id, uint64 fee);

    event DeclaredOperatorFeeCancelation(address indexed ownerAddress, uint64 operatorId);

    /**
     * @dev Emitted when an operator's fee is updated.
     * @param ownerAddress Operator's owner.
     * @param blockNumber from which block number.
     * @param fee updated fee value.
     */
    event OperatorFeeExecution(
        address indexed ownerAddress,
        uint64 operatorId,
        uint256 blockNumber,
        uint64 fee
    );

    event OperatorFeeIncreaseLimitUpdate(uint64 value);

    event DeclareOperatorFeePeriodUpdate(uint256 value);

    event ExecuteOperatorFeePeriodUpdate(uint256 value);

    /** errors */
    error CallerNotOwner();
    error FeeTooLow();
    error FeeExceedsIncreaseLimit();
    error NoPendingFeeChangeRequest();
    error ApprovalNotWithinTimeframe();


    error InvalidPublicKeyLength();
    error OessDataStructureInvalid();
    error ValidatorNotOwned();

    /** errors */
//    error validatorWithPublicKeyNotExist();
//    error callerNotValidatorOwner();
//    error operatorWithPublicKeyNotExist();
//    error callerNotOperatorOwner();
//    error feeTooLow();
//    error feeExceedsIncreaseLimit();
//    error noPendingFeeChangeRequest();
//    error approvalNotWithinTimeframe();
//    error notEnoughBalance();
//    error burnRatePositive();
//    error accountAlreadyEnabled();
//    error negativeBalance();


    /**
    * @dev Initializes the contract.
    * @param token_ The network token.
    * @param operatorMaxFeeIncrease_ The step limit to increase the operator fee
    * @param declareOperatorFeePeriod_ The period an operator needs to wait before they can approve their fee.
    * @param executeOperatorFeePeriod_ The length of the period in which an operator can approve their fee.
    */
    function initialize(
        IERC20 token_,
        uint64 operatorMaxFeeIncrease_,
        uint256 declareOperatorFeePeriod_,
        uint256 executeOperatorFeePeriod_
    ) external;

    /**
     * @dev Registers a new operator.
     * @param publicKey Operator's public key. Used to encrypt secret shares of validators keys.
     * @param fee operator's fee.
     */
    function registerOperator(
        bytes calldata publicKey,
        uint64 fee
    ) external returns (uint64);

    /**
     * @dev Removes an operator.
     * @param id Operator's id.
     */
    function removeOperator(uint64 id) external;

    /**
     * @dev Gets the operators current snapshot.
     * @param id Operator's id.
     * @return currentBlock the block that the snapshot is updated to.
     * @return index the index of the operator.
     * @return balance the current balance of the operator.
     */
    function operatorSnapshot(uint64 id) external view returns (uint64 currentBlock, uint64 index, uint64 balance);


    /**
     * @dev Registers a new validator.
     * @param publicKey Validator public key.
     * @param operatorIds Operator ids.
     * @param shares snappy compressed shares(a set of encrypted and public shares).
     * @param amount amount of tokens to be deposited for the validator's pod.
     */
    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata shares,
        uint64 amount
    ) external;

    /**
     * @dev Removes a validator.
     * @param publicKey Validator's public key.
     */
    function removeValidator(bytes calldata publicKey) external;

    /**
     * @dev Transfers a validator.
     * @param publicKey Validator public key.
     * @param operatorIds new Operator ids(cluster) to transfer the validator to.
     * @param shares snappy compressed shares(a set of encrypted and public shares).
     * @param amount amount of tokens to be deposited for the validator's pod.
     */
    function transferValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata shares,
        uint64 amount
    ) external;

    function bulkTransferValidators(
        bytes[] calldata validatorPK,
        bytes32 fromPodId,
        bytes32 toPodId,
        bytes[] calldata shares
    ) external;

    function updateOperatorFeeIncreaseLimit(uint64 newOperatorMaxFeeIncrease) external;

    function updateDeclareOperatorFeePeriod(uint256 newDeclareOperatorFeePeriod) external;

    function updateExecuteOperatorFeePeriod(uint256 newExecuteOperatorFeePeriod) external;

    function getOperatorFeeIncreaseLimit() external view returns (uint64);

    function getExecuteOperatorFeePeriod() external view returns (uint256);

    function getDeclaredOperatorFeePeriod() external view returns (uint256);


}