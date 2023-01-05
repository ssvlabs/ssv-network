// File: contracts/ISSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISSVNetwork {
    struct Pod {
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
     * @param pod All the pod data.
     */
    event ValidatorAdded(
        address ownerAddress,
        uint64[] operatorIds,
        bytes publicKey,
        bytes shares,
        Pod pod
    );

    /**
     * @dev Emitted when the validator is removed.
     * @param publicKey The public key of a validator.
     * @param operatorIds The operator ids list.
     * @param pod All the pod data.
     */
    event ValidatorRemoved(
        address ownerAddress,
        uint64[] operatorIds,
        bytes publicKey,
        Pod pod
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

    event DeclaredOperatorFeeCancelation(
        address indexed ownerAddress,
        uint64 operatorId
    );

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

    event PodLiquidated(address ownerAddress, uint64[] operatorIds, Pod pod);

    event PodEnabled(address ownerAddress, uint64[] operatorIds, Pod pod);

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

    event PodFundsWithdrawal(
        address ownerAddress,
        uint64[] operatorIds,
        uint256 value,
        Pod pod
    );
    event OperatorFundsWithdrawal(
        uint256 value,
        uint64 operatorId,
        address ownerAddress
    );

    event FundsDeposit(uint256 value, uint64[] operatorIds, address owner);

    event PodDeposited(address ownerAddress, uint64[] operatorIds, Pod pod);

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
    error PodLiquidatable();
    error PodNotLiquidatable();
    error InvalidPublicKeyLength();
    error OperatorIdsStructureInvalid();
    error ValidatorNotOwned();
    error ParametersMismatch();
    error NegativeBalance();
    error PodAlreadyEnabled();
    error PodIsLiquidated();
    error PodNotExists();
    error BurnRatePositive();
    error PodDataIsBroken();
    error OperatorsListDoesNotSorted();
    error BelowMinimumBlockPeriod();

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
        bytes calldata shares,
        uint256 amount,
        Pod memory pod
    ) external;

    function removeValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        Pod memory pod
    ) external;

    /**************************/
    /* Pod External Functions */
    /**************************/

    function liquidatePod(
        address ownerAddress,
        uint64[] memory operatorIds,
        Pod memory pod
    ) external;

    function reactivatePod(
        uint64[] memory operatorIds,
        uint256 amount,
        Pod memory pod
    ) external;

    /******************************/
    /* Balance External Functions */
    /******************************/

    function deposit(
        address owner,
        uint64[] memory operatorIds,
        uint256 amount,
        Pod memory pod
    ) external;

    function deposit(
        uint64[] memory operatorIds,
        uint256 amount,
        Pod memory pod
    ) external;

    function withdrawOperatorBalance(
        uint64 operatorId,
        uint256 tokenAmount
    ) external;

    function withdrawOperatorBalance(uint64 operatorId) external;

    function withdrawPodBalance(
        uint64[] memory operatorIds,
        uint256 tokenAmount,
        Pod memory pod
    ) external;

    /**************************/
    /* DAO External Functions */
    /**************************/

    function updateNetworkFee(uint256 fee) external;

    function withdrawNetworkEarnings(uint256 amount) external;

    function updateOperatorFeeIncreaseLimit(
        uint64 newOperatorMaxFeeIncrease
    ) external;

    function updateDeclareOperatorFeePeriod(
        uint64 newDeclareOperatorFeePeriod
    ) external;

    function updateExecuteOperatorFeePeriod(
        uint64 newExecuteOperatorFeePeriod
    ) external;

    function updateLiquidationThresholdPeriod(uint64 blocks) external;

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint64 operatorId) external view returns (uint256);

    function getOperatorDeclaredFee(
        uint64 operatorId
    ) external view returns (uint256, uint256, uint256);

    function getOperatorById(
        uint64 operatorId
    ) external view returns (address owner, uint256 fee, uint32 validatorCount);

    /*******************************/
    /* Pod External View Functions */
    /*******************************/

    function isLiquidatable(
        address ownerAddress,
        uint64[] memory operatorIds,
        Pod memory pod
    ) external view returns (bool);

    function isLiquidated(
        address ownerAddress,
        uint64[] memory operatorIds,
        Pod memory pod
    ) external view returns (bool);

    function getPodBurnRate(
        uint64[] memory operatorIds
    ) external view returns (uint256);

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
    function operatorSnapshot(
        uint64 id
    )
        external
        view
        returns (uint64 currentBlock, uint64 index, uint256 balance);

    function podBalanceOf(
        address ownerAddress,
        uint64[] memory operatorIds,
        Pod memory pod
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
