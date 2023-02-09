// File: contracts/ISSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ISSVNetworkCore.sol";

interface ISSVNetwork is ISSVNetworkCore {
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
        address indexed owner,
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
        address indexed owner,
        uint64[] operatorIds,
        bytes publicKey,
        Cluster cluster
    );

    event OperatorFeeDeclared(
        address indexed owner,
        uint64 operatorId,
        uint256 blockNumber,
        uint256 fee
    );

    event OperatorFeeCancelationDeclared(
        address indexed owner,
        uint64 operatorId
    );

    /**
     * @dev Emitted when an operator's fee is updated.
     * @param owner Operator's owner.
     * @param blockNumber from which block number.
     * @param fee updated fee value.
     */
    event OperatorFeeExecuted(
        address indexed owner,
        uint64 operatorId,
        uint256 blockNumber,
        uint256 fee
    );

    event ClusterLiquidated(
        address owner,
        uint64[] operatorIds,
        Cluster cluster
    );

    event ClusterReactivated(
        address owner,
        uint64[] operatorIds,
        Cluster cluster
    );

    event OperatorFeeIncreaseLimitUpdated(uint64 value);

    event DeclareOperatorFeePeriodUpdated(uint64 value);

    event ExecuteOperatorFeePeriodUpdated(uint64 value);

    event LiquidationThresholdPeriodUpdated(uint64 value);

    /**
     * @dev Emitted when the network fee is updated.
     * @param oldFee The old fee
     * @param newFee The new fee
     */
    event NetworkFeeUpdated(uint256 oldFee, uint256 newFee);

    /**
     * @dev Emitted when transfer fees are withdrawn.
     * @param value The amount of tokens withdrawn.
     * @param recipient The recipient address.
     */
    event NetworkEarningsWithdrawn(uint256 value, address recipient);

    event ClusterWithdrawn(
        address owner,
        uint64[] operatorIds,
        uint256 value,
        Cluster cluster
    );
    event OperatorWithdrawn(uint256 value, uint64 operatorId, address owner);

    event ClusterDeposited(
        address indexed owner,
        uint64[] operatorIds,
        uint256 value,
        Cluster cluster
    );

    event FeeRecipientAddressUpdated(address owner, address recipientAddress);

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

    function setFeeRecipientAddress(address feeRecipientAddress) external;

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
        address owner,
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

    function withdrawOperatorEarnings(
        uint64 operatorId,
        uint256 tokenAmount
    ) external;

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
}
