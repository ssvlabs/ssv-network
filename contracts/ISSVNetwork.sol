// File: contracts/ISSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


interface ISSVNetwork {

    struct Cluster {
        uint32 validatorCount;

        uint64 networkFee;
        uint64 networkFeeIndex;

        uint64 index;
        uint64 balance;

        bool disabled;
    }

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
     * @param operatorIds The operator ids list.
     * @param shares snappy compressed shares(a set of encrypted and public shares).
     * @param cluster All the cluster data.
     */
    event ValidatorAdded(
        address ownerAddress,
        uint64[] operatorIds,
        bytes publicKey,
        bytes shares,
        Cluster cluster
    );

    /**
     * @dev Emitted when the validator is removed.
     * @param publicKey The public key of a validator.
     * @param operatorIds The operator ids list.
     * @param cluster All the cluster data.
     */
    event ValidatorRemoved(
        address ownerAddress,
        uint64[] operatorIds,
        bytes publicKey,
        Cluster cluster
    );

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

    event ClusterLiquidated(address ownerAddress, uint64[] operatorIds, Cluster cluster);

    event ClusterReactivated(address ownerAddress, uint64[] operatorIds, Cluster cluster);

    event OperatorFeeIncreaseLimitUpdate(uint64 value);

    event DeclareOperatorFeePeriodUpdate(uint64 value);

    event ExecuteOperatorFeePeriodUpdate(uint64 value);

    event LiquidationThresholdPeriodUpdate(uint64 value);

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
    event NetworkEarningsWithdrawal(uint256 value, address recipient);

    event ClusterFundsWithdrawal(address ownerAddress, uint64[] operatorIds, uint256 value, Cluster cluster);
    event OperatorFundsWithdrawal(uint256 value, uint64 operatorId, address ownerAddress);

    event ClusterDeposited(
        address ownerAddress,
        uint64[] operatorIds,
        uint256 value,
        Cluster cluster
    );

    event FeeRecipientAddressAdded(
        address ownerAddress,
        address recipientAddress
    );

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
    error ClusterLiquidatable();
    error ClusterNotLiquidatable();
    error InvalidPublicKeyLength();
    error OperatorIdsStructureInvalid();
    error ValidatorNotOwned();
    error ParametersMismatch();
    error NegativeBalance();
    error ClusterAlreadyEnabled();
    error ClusterIsLiquidated();
    error ClusterNotExists();
    error BurnRatePositive();
    error ClusterDataIsBroken();
    error OperatorsListDoesNotSorted();
    error BelowMinimumBlockPeriod();
    error ExceedValidatorLimit();

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
        uint64 executeOperatorFeePeriod_,
        uint64 minimumBlocksBeforeLiquidation_
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

    function feeRecipientAddress(address feeRecipientAddress) external;

    /********************************/
    /* Validator External Functions */
    /********************************/

    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesEncrypted,
        uint256 amount,
        Cluster memory cluster
    ) external;

    function removeValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external;

    /**************************/
    /* Cluster External Functions */
    /**************************/

    function liquidate(
        address ownerAddress,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external;

    function reactivate(
        uint64[] memory operatorIds,
        uint256 amount,
        Cluster memory cluster
    ) external;

    /******************************/
    /* Balance External Functions */
    /******************************/

    function deposit(
        address owner,
        uint64[] memory operatorIds,
        uint256 amount,
        Cluster memory cluster
    ) external;

    function deposit(
        uint64[] memory operatorIds,
        uint256 amount,
        Cluster memory cluster
    ) external;

    function withdrawOperatorEarnings(uint64 operatorId, uint256 tokenAmount) external;

    function withdrawOperatorEarnings(uint64 operatorId) external;

    function withdraw(
        uint64[] memory operatorIds,
        uint256 tokenAmount,
        Cluster memory cluster
    ) external;

    /**************************/
    /* DAO External Functions */
    /**************************/

    function updateNetworkFee(uint256 fee) external;

    function withdrawNetworkEarnings(uint256 amount) external;

    function updateOperatorFeeIncreaseLimit(uint64 newOperatorMaxFeeIncrease) external;

    function updateDeclareOperatorFeePeriod(uint64 newDeclareOperatorFeePeriod) external;

    function updateExecuteOperatorFeePeriod(uint64 newExecuteOperatorFeePeriod) external;

    function updateLiquidationThresholdPeriod(uint64 blocks) external;

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint64 operatorId) external view returns (uint256);

    function getOperatorDeclaredFee(uint64 operatorId) external view returns (uint256, uint256, uint256);

    function getOperatorById(uint64 operatorId) external view returns (address owner, uint256 fee, uint32 validatorCount);

    /*******************************/
    /* Cluster External View Functions */
    /*******************************/

    function isLiquidatable(
        address ownerAddress,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external view returns(bool);

    function isLiquidated(
        address ownerAddress,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external view returns(bool);

    function getClusterBurnRate(uint64[] memory operatorIds) external view returns (uint256);

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

    function clusterBalanceOf(
        address ownerAddress,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external view returns (uint256);

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external view returns (uint256);

    function getNetworkEarnings() external view returns (uint256);

    function getOperatorFeeIncreaseLimit() external view returns (uint64);

    function getExecuteOperatorFeePeriod() external view returns (uint64);

    function getDeclaredOperatorFeePeriod() external view returns (uint64);

    function getLiquidationThresholdPeriod() external view returns (uint64);
}