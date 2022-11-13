// File: contracts/ISSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


interface ISSVNetwork {
    /**********/
    /* Events */
    /**********/

    /**
    * @dev Emitted when a new operator has been added.
    * @param id operator's ID.
    * @param owner Operator's ethereum address that can collect fees.
    * @param publicKey Operator's public key. Will be used to encrypt secret shares of validators keys.
    * @param fee Operator's fee.
    */
    event OperatorAdded(
        uint64 id,
        address indexed owner,
        bytes publicKey,
        uint256 fee
    );

    /**
     * @dev Emitted when operator has been removed.
     * @param id operator's ID.
     */
    event OperatorRemoved(uint64 id);

    /**
     * @dev Emitted when the validator has been added.
     * @param publicKey The public key of a validator.
     * @param clusterId The cluster id the validator been added to.
     * @param shares snappy compressed shares(a set of encrypted and public shares).
     */
    event ValidatorAdded(
        bytes publicKey,
        bytes32 clusterId,
        bytes shares
    );

    /**
     * @dev Emitted when validator was transferred between pods.
     * @param publicKey The public key of a validator.
     * @param clusterId The validator's new cluster id.
     * @param shares snappy compressed shares(a set of encrypted and public shares).
     */
    event ValidatorTransferred(
        bytes publicKey,
        bytes32 clusterId,
        bytes shares
    );

    /**
     * @dev Emitted when validators were transferred between pods.
     * @param publicKeys An array of transferred public keys.
     * @param clusterId The validators new pod id.
     * @param shares an array of snappy compressed shares(a set of encrypted and public shares).
     */
    event BulkValidatorTransferred(
        bytes[] publicKeys,
        bytes32 clusterId,
        bytes[] shares
    );

    /**
     * @dev Emitted when the validator is removed.
     * @param publicKey The public key of a validator.
     * @param clusterId The pod id the validator has been removed from.
     */
    event ValidatorRemoved(bytes publicKey, bytes32 clusterId);

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
        uint256 fee
    );

    event PodLiquidated(address ownerAddress, bytes32 clusterId);

    event PodEnabled(address ownerAddress, bytes32 clusterId);

    event OperatorFeeIncreaseLimitUpdate(uint64 value);

    event DeclareOperatorFeePeriodUpdate(uint256 value);

    event ExecuteOperatorFeePeriodUpdate(uint256 value);

    event PodCreated(address ownerAddress, bytes32 clusterId);
    /**
     * @dev Emitted when the network fee is updated.
     * @param oldFee The old fee
     * @param newFee The new fee
     */
    event NetworkFeeUpdate(uint256 oldFee, uint256 newFee);

    /**
     * @dev Emitted when transfer fees are withdrawn.
     * @param value The amount of tokens withdrawn.
     * @param recipient The recipient address.
     */
    event NetworkFeesWithdrawal(uint256 value, address recipient);

    event PodFundsWithdrawal(uint256 value, bytes32 clusterId, address owner);
    event OperatorFundsWithdrawal(uint256 value, uint64 operatorId, address owner);


    event FundsDeposit(uint256 value, bytes32 clusterId, address owner);

    /**********/
    /* Errors */
    /**********/

    error CallerNotOwner();
    error FeeTooLow();
    error FeeExceedsIncreaseLimit();
    error NoPendingFeeChangeRequest();
    error ApprovalNotWithinTimeframe();
    error OperatorWithPublicKeyNotExist();
    error OperatorNotFound();
    error OperatorDoesNotExist();
    error NotEnoughBalance();
    error ValidatorAlreadyExists();
    error PodLiquidatable();
    error PodNotLiquidatable();
    error InvalidPublicKeyLength();
    error OperatorIdsStructureInvalid();
    error ValidatorNotOwned();
    error InvalidCluster();
    error ParametersMismatch();
    error NegativeBalance();
    error ClusterAlreadyExists();
    error ClusterNotExists();
    error PodAlreadyEnabled();
    error PodAlreadyExists();
    error BurnRatePositive();

    /****************/
    /* Initializers */
    /****************/

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
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_
    ) external;

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    /**
     * @dev Registers a new operator.
     * @param publicKey Operator's public key. Used to encrypt secret shares of validators keys.
     * @param fee operator's fee.
     */
    function registerOperator(
        bytes calldata publicKey,
        uint256 fee
    ) external returns (uint64);

    /**
     * @dev Removes an operator.
     * @param id Operator's id.
     */
    function removeOperator(uint64 id) external;

    function declareOperatorFee(uint64 operatorId, uint256 fee) external;

    function executeOperatorFee(uint64 operatorId) external;

    function cancelDeclaredOperatorFee(uint64 operatorId) external;

    /********************************/
    /* Validator External Functions */
    /********************************/

    /**
     * @dev Registers a new validator.
     * @param publicKey Validator public key.
     * @param clusterId Cluster id.
     * @param shares snappy compressed shares(a set of encrypted and public shares).
     */
    function registerValidator(
        bytes calldata publicKey,
        bytes32 clusterId,
        bytes calldata shares
    ) external;

    /**
     * @dev Removes a validator.
     * @param publicKey Validator's public key.
     */
    function removeValidator(bytes calldata publicKey) external;

    /**
     * @dev Transfers a validator.
     * @param publicKey Validator public key.
     * @param newClusterId new cluster id to transfer the validator to.
     * @param shares snappy compressed shares(a set of encrypted and public shares).
     */
    function transferValidator(
        bytes calldata publicKey,
        bytes32 newClusterId,
        bytes calldata shares
    ) external;

    function bulkTransferValidators(
        bytes[] calldata publicKey,
        bytes32 fromClusterId,
        bytes32 toClusterId,
        bytes[] calldata shares
    ) external;

    /**************************/
    /* Pod External Functions */
    /**************************/

    function registerPod(uint64[] memory operatorIds, uint256 amount) external;

    function liquidate(address ownerAddress, bytes32 clusterId) external;

    function reactivatePod(bytes32 clusterId, uint256 amount) external;

    /******************************/
    /* Balance External Functions */
    /******************************/

    function deposit(address owner, bytes32 clusterId, uint256 amount) external;

    function deposit(bytes32 clusterId, uint256 amount) external;

    function withdrawOperatorBalance(uint64 operatorId, uint256 tokenAmount) external;

    function withdrawOperatorBalance(uint64 operatorId) external;

    function withdrawPodBalance(bytes32 clusterId, uint256 tokenAmount) external;

    /**************************/
    /* DAO External Functions */
    /**************************/

    function updateNetworkFee(uint256 fee) external;

    function withdrawDAOEarnings(uint256 amount) external;

    function updateOperatorFeeIncreaseLimit(uint64 newOperatorMaxFeeIncrease) external;

    function updateDeclareOperatorFeePeriod(uint64 newDeclareOperatorFeePeriod) external;

    function updateExecuteOperatorFeePeriod(uint64 newExecuteOperatorFeePeriod) external;


    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint64 operatorId) external view returns (uint256);

    function getOperatorDeclaredFee(uint64 operatorId) external view returns (uint256, uint256, uint256);

    /*******************************/
    /* Pod External View Functions */
    /*******************************/

    function getClusterId(uint64[] memory operatorIds) external view returns(bytes32);

    function isLiquidatable(address ownerAddress, bytes32 clusterId) external view returns(bool);

    function isLiquidated(address ownerAddress, bytes32 clusterId) external view returns(bool);

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    /**
     * @dev Gets the operators current snapshot.
     * @param id Operator's id.
     * @return currentBlock the block that the snapshot is updated to.
     * @return index the index of the operator.
     * @return balance the current balance of the operator.
     */
    function operatorSnapshot(uint64 id) external view returns (uint64 currentBlock, uint64 index, uint256 balance);

    function podBalanceOf(address owner, bytes32 clusterId) external view returns (uint256);

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external view returns (uint256);

    function getNetworkBalance() external view returns (uint256);

    function getOperatorFeeIncreaseLimit() external view returns (uint64);

    function getExecuteOperatorFeePeriod() external view returns (uint64);

    function getDeclaredOperatorFeePeriod() external view returns (uint64);
}