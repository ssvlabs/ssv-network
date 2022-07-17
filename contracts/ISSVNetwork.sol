// File: contracts/ISSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "./ISSVRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISSVNetwork {
    /**
     * @dev Emitted when the account has been enabled.
     * @param ownerAddress Operator's owner.
     */
    event AccountEnable(address indexed ownerAddress);

    /**
     * @dev Emitted when the account has been liquidated.
     * @param ownerAddress Operator's owner.
     */
    event AccountLiquidation(address indexed ownerAddress);

    /**
     * @dev Emitted when the operator has been added.
     * @param id operator's ID.
     * @param name Operator's display name.
     * @param ownerAddress Operator's ethereum address that can collect fees.
     * @param publicKey Operator's public key. Will be used to encrypt secret shares of validators keys.
     * @param fee Operator's initial fee.
     */
    event OperatorRegistration(
        uint32 indexed id,
        string name,
        address indexed ownerAddress,
        bytes publicKey,
        uint256 fee
    );

    /**
     * @dev Emitted when the operator has been removed.
     * @param operatorId operator's ID.
     * @param ownerAddress Operator's owner.
     */
    event OperatorRemoval(uint32 operatorId, address indexed ownerAddress);

    event OperatorFeeDeclaration(
        address indexed ownerAddress,
        uint32 operatorId,
        uint256 blockNumber,
        uint256 fee
    );

    event DeclaredOperatorFeeCancelation(address indexed ownerAddress, uint32 operatorId);

    /**
     * @dev Emitted when an operator's fee is updated.
     * @param ownerAddress Operator's owner.
     * @param blockNumber from which block number.
     * @param fee updated fee value.
     */
    event OperatorFeeExecution(
        address indexed ownerAddress,
        uint32 operatorId,
        uint256 blockNumber,
        uint256 fee
    );

    /**
     * @dev Emitted when an operator's score is updated.
     * @param operatorId operator's ID.
     * @param ownerAddress Operator's owner.
     * @param blockNumber from which block number.
     * @param score updated score value.
     */
    event OperatorScoreUpdate(
        uint32 operatorId,
        address indexed ownerAddress,
        uint256 blockNumber,
        uint256 score
    );

    /**
     * @dev Emitted when the validator has been added.
     * @param ownerAddress The user's ethereum address that is the owner of the validator.
     * @param publicKey The public key of a validator.
     * @param operatorIds The operators public keys list for this validator.
     * @param sharesPublicKeys The shared publick keys list for this validator.
     * @param encryptedKeys The encrypted keys list for this validator.
     */
    event ValidatorRegistration(
        address indexed ownerAddress,
        bytes publicKey,
        uint32[] operatorIds,
        bytes[] sharesPublicKeys,
        bytes[] encryptedKeys
    );

    /**
     * @dev Emitted when the validator is removed.
     * @param ownerAddress Validator's owner.
     * @param publicKey The public key of a validator.
     */
    event ValidatorRemoval(address indexed ownerAddress, bytes publicKey);

    /**
     * @dev Emitted when an owner deposits funds.
     * @param value Amount of tokens.
     * @param ownerAddress Owner's address.
     * @param senderAddress Sender's address.
     */
    event FundsDeposit(uint256 value, address indexed ownerAddress, address indexed senderAddress);

    /**
     * @dev Emitted when an owner withdraws funds.
     * @param value Amount of tokens.
     * @param ownerAddress Owner's address.
     */
    event FundsWithdrawal(uint256 value, address indexed ownerAddress);

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

    event DeclareOperatorFeePeriodUpdate(uint256 value);

    event ExecuteOperatorFeePeriodUpdate(uint256 value);

    event LiquidationThresholdPeriodUpdate(uint256 value);

    event OperatorFeeIncreaseLimitUpdate(uint256 value);

    event ValidatorsPerOperatorLimitUpdate(uint256 value);

    event RegisteredOperatorsPerAccountLimitUpdate(uint256 value);

    event MinimumBlocksBeforeLiquidationUpdate(uint256 value);

    event OperatorMaxFeeIncreaseUpdate(uint256 value);

    /** errors */
    error ValidatorWithPublicKeyNotExist();
    error CallerNotValidatorOwner();
    error OperatorWithPublicKeyNotExist();
    error CallerNotOperatorOwner();
    error FeeTooLow();
    error FeeExceedsIncreaseLimit();
    error NoPendingFeeChangeRequest();
    error ApprovalNotWithinTimeframe();
    error NotEnoughBalance();
    error BurnRatePositive();
    error AccountAlreadyEnabled();
    error NegativeBalance();
    error BelowMinimumBlockPeriod();
    error ExceedManagingOperatorsPerAccountLimit();

    /**
     * @dev Initializes the contract.
     * @param registryAddress_ The registry address.
     * @param token_ The network token.
     * @param minimumBlocksBeforeLiquidation_ The minimum blocks before liquidation.
     * @param declareOperatorFeePeriod_ The period an operator needs to wait before they can approve their fee.
     * @param executeOperatorFeePeriod_ The length of the period in which an operator can approve their fee.
     */
    function initialize(
        ISSVRegistry registryAddress_,
        IERC20 token_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_
    ) external;

    /**
     * @dev Registers a new operator.
     * @param name Operator's display name.
     * @param publicKey Operator's public key. Used to encrypt secret shares of validators keys.
     */
    function registerOperator(
        string calldata name,
        bytes calldata publicKey,
        uint256 fee
    ) external returns (uint32);

    /**
     * @dev Removes an operator.
     * @param operatorId Operator's id.
     */
    function removeOperator(uint32 operatorId) external;

    /**
     * @dev Set operator's fee change request by public key.
     * @param operatorId Operator's id.
     * @param operatorFee The operator's updated fee.
     */
    function declareOperatorFee(uint32 operatorId, uint256 operatorFee) external;

    function cancelDeclaredOperatorFee(uint32 operatorId) external;

    function executeOperatorFee(uint32 operatorId) external;

    /**
     * @dev Updates operator's score by public key.
     * @param operatorId Operator's id.
     * @param score The operators's updated score.
     */
    function updateOperatorScore(uint32 operatorId, uint32 score) external;

    /**
     * @dev Registers a new validator.
     * @param publicKey Validator public key.
     * @param operatorIds Operator public keys.
     * @param sharesPublicKeys Shares public keys.
     * @param sharesEncrypted Encrypted private keys.
     * @param amount Amount of tokens to deposit.
     */
    function registerValidator(
        bytes calldata publicKey,
        uint32[] calldata operatorIds,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata sharesEncrypted,
        uint256 amount
    ) external;

    /**
     * @dev Updates a validator.
     * @param publicKey Validator public key.
     * @param operatorIds Operator public keys.
     * @param sharesPublicKeys Shares public keys.
     * @param sharesEncrypted Encrypted private keys.
     * @param amount Amount of tokens to deposit.
     */
    function updateValidator(
        bytes calldata publicKey,
        uint32[] calldata operatorIds,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata sharesEncrypted,
        uint256 amount
    ) external;

    /**
     * @dev Removes a validator.
     * @param publicKey Validator's public key.
     */
    function removeValidator(bytes calldata publicKey) external;

    /**
     * @dev Deposits tokens for the sender.
     * @param ownerAddress Owners' addresses.
     * @param tokenAmount Tokens amount.
     */
    function deposit(address ownerAddress, uint256 tokenAmount) external;

    /**
     * @dev Withdraw tokens for the sender.
     * @param tokenAmount Tokens amount.
     */
    function withdraw(uint256 tokenAmount) external;

    /**
     * @dev Withdraw total balance to the sender, deactivating their validators if necessary.
     */
    function withdrawAll() external;

    /**
     * @dev Liquidates multiple owners.
     * @param ownerAddresses Owners' addresses.
     */
    function liquidate(address[] calldata ownerAddresses) external;

    /**
     * @dev Enables msg.sender account.
     * @param amount Tokens amount.
     */
    function reactivateAccount(uint256 amount) external;

    /**
     * @dev Updates the number of blocks left for an owner before they can be liquidated.
     * @param blocks The new value.
     */
    function updateLiquidationThresholdPeriod(uint64 blocks) external;

    /**
     * @dev Updates the maximum fee increase in pecentage.
     * @param newOperatorMaxFeeIncrease The new value.
     */
    function updateOperatorFeeIncreaseLimit(uint64 newOperatorMaxFeeIncrease) external;

    function updateDeclareOperatorFeePeriod(uint64 newDeclareOperatorFeePeriod) external;

    function updateExecuteOperatorFeePeriod(uint64 newExecuteOperatorFeePeriod) external;

    /**
     * @dev Updates the network fee.
     * @param fee the new fee
     */
    function updateNetworkFee(uint256 fee) external;

    /**
     * @dev Withdraws network fees.
     * @param amount Amount to withdraw
     */
    function withdrawNetworkEarnings(uint256 amount) external;

    /**
     * @dev Gets total balance for an owner.
     * @param ownerAddress Owner's address.
     */
    function getAddressBalance(address ownerAddress) external view returns (uint256);

    function isLiquidated(address ownerAddress) external view returns (bool);

    /**
     * @dev Gets an operator by operator id.
     * @param operatorId Operator's id.
     */
    function getOperatorById(uint32 operatorId)
        external view
        returns (
            string memory,
            address,
            bytes memory,
            uint256,
            uint256,
            uint256,
            bool
        );

    /**
     * @dev Gets a validator public keys by owner's address.
     * @param ownerAddress Owner's Address.
     */
    function getValidatorsByOwnerAddress(address ownerAddress)
        external view
        returns (bytes[] memory);

    /**
     * @dev Gets operators list which are in use by validator.
     * @param validatorPublicKey Validator's public key.
     */
    function getOperatorsByValidator(bytes calldata validatorPublicKey)
        external view
        returns (uint32[] memory);

    function getOperatorDeclaredFee(uint32 operatorId) external view returns (uint256, uint256, uint256);

    /**
     * @dev Gets operator current fee.
     * @param operatorId Operator's id.
     */
    function getOperatorFee(uint32 operatorId) external view returns (uint256);

    /**
     * @dev Gets the network fee for an address.
     * @param ownerAddress Owner's address.
     */
    function addressNetworkFee(address ownerAddress) external view returns (uint256);

    /**
     * @dev Returns the burn rate of an owner, returns 0 if negative.
     * @param ownerAddress Owner's address.
     */
    function getAddressBurnRate(address ownerAddress) external view returns (uint256);

    /**
     * @dev Check if an owner is liquidatable.
     * @param ownerAddress Owner's address.
     */
    function isLiquidatable(address ownerAddress) external view returns (bool);

    /**
     * @dev Returns the network fee.
     */
    function getNetworkFee() external view returns (uint256);

    /**
     * @dev Gets the available network earnings
     */
    function getNetworkEarnings() external view returns (uint256);

    /**
     * @dev Returns the number of blocks left for an owner before they can be liquidated.
     */
    function getLiquidationThresholdPeriod() external view returns (uint256);

    /**
     * @dev Returns the maximum fee increase in pecentage
     */
     function getOperatorFeeIncreaseLimit() external view returns (uint256);

     function getExecuteOperatorFeePeriod() external view returns (uint256);

     function getDeclaredOperatorFeePeriod() external view returns (uint256);

     function validatorsPerOperatorCount(uint32 operatorId) external view returns (uint32);
}
