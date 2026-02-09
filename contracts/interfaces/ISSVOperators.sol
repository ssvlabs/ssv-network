// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";

/**
 * @title SSV Operators Interface
 * @author SSV Labs
 * @notice Interface for managing SSV operators including registration, fee management, earnings withdrawal and privacy settings
 */
interface ISSVOperators is ISSVNetworkCore {
    /**
     * @dev Emitted when a new operator is registered
     * @param operatorId The ID assigned to the new operator
     * @param owner The address that owns and can collect fees from this operator
     * @param publicKey The operator's public key used for encrypting validator shares
     * @param fee The fee set for this operator
     */
    event OperatorAdded(
        uint64 indexed operatorId,
        address indexed owner,
        bytes publicKey,
        uint256 fee
    );

    /**
     * @dev Emitted when an operator is removed
     * @param operatorId The ID of the removed operator
     */
    event OperatorRemoved(uint64 indexed operatorId);

    /**
     * @dev Emitted when an operator fee is declared
     * @param owner The owner of the operator
     * @param operatorId The ID of the operator
     * @param blockNumber The block number when the declaration was made
     * @param fee The proposed fee value
     */
    event OperatorFeeDeclared(
        address indexed owner,
        uint64 indexed operatorId,
        uint256 blockNumber,
        uint256 fee
    );

    /**
     * @dev Emitted when a declared operator fee is cancelled
     * @param owner The owner of the operator
     * @param operatorId The ID of the operator
     */
    event OperatorFeeDeclarationCancelled(
        address indexed owner,
        uint64 indexed operatorId
    );

    /**
     * @dev Emitted when a declared operator fee is executed
     * @param owner The owner of the operator
     * @param operatorId The ID of the operator
     * @param blockNumber The block number from which the new fee applies
     * @param fee The new active fee value
     */
    event OperatorFeeExecuted(
        address indexed owner,
        uint64 indexed operatorId,
        uint256 blockNumber,
        uint256 fee
    );

    /**
     * @dev Emitted when operator earnings are withdrawn
     * @param owner The owner of the operator
     * @param operatorId The ID of the operator
     * @param value The amount withdrawn
     */
    event OperatorWithdrawn(
        address indexed owner,
        uint64 indexed operatorId,
        uint256 value
    );

    /**
     * @dev Emitted when an operator changes privacy status
     * @param operatorIds The IDs of the affected operators
     * @param toPrivate True = set to private, False = set to public
     */
    event OperatorPrivacyStatusUpdated(uint64[] operatorIds, bool toPrivate);

    /**
     * @dev Emitted when an operator's whitelist address is updated
     * @param operatorId The ID of the operator
     * @param whitelisted The new whitelisted address
     */
    event OperatorWhitelistUpdated(uint64 indexed operatorId, address whitelisted);

    /**
     * @dev Emitted when operator fee recipient address is updated
     * @param owner The owner of the operator
     * @param recipientAddress The new fee recipient address
     */
    event FeeRecipientAddressUpdated(address indexed owner, address recipientAddress);

    /**
     * @notice Registers a new operator
     * @param publicKey The public key of the operator
     * @param fee The operator's fee (in ETH)
     * @param setPrivate Flag indicating whether the operator should be private
     * @return operatorId The newly assigned operator ID
     */
    function registerOperator(
        bytes calldata publicKey,
        uint256 fee,
        bool setPrivate
    ) external returns (uint64);

    /**
     * @notice Removes an existing ETH operator
     * @param operatorId The ID of the operator to remove
     */
    function removeOperator(uint64 operatorId) external;

    /**
     * @notice Declares a new fee for the operator
     * @param operatorId The ID of the operator
     * @param fee The new fee value to propose (in SSV units)
     */
    function declareOperatorFee(uint64 operatorId, uint256 fee) external;

    /**
     * @notice Executes a previously declared operator fee
     * @param operatorId The ID of the operator
     */
    function executeOperatorFee(uint64 operatorId) external;

    /**
     * @notice Cancels a previously declared (but not yet executed) operator fee
     * @param operatorId The ID of the operator
     */
    function cancelDeclaredOperatorFee(uint64 operatorId) external;

    /**
     * @notice Reduces the operator's fee (can only decrease)
     * @param operatorId The ID of the operator
     * @param fee The new (lower) fee value
     */
    function reduceOperatorFee(uint64 operatorId, uint256 fee) external;

    /**
     * @notice Withdraws a specified amount of operator earnings in ETH (post-migration)
     * @param operatorId The ID of the operator
     * @param ethAmount The amount of ETH to withdraw
     */
    function withdrawOperatorEarnings(uint64 operatorId, uint256 ethAmount) external;

    /**
     * @notice Withdraws all available operator earnings in ETH (post-migration)
     * @param operatorId The ID of the operator
     */
    function withdrawAllOperatorEarnings(uint64 operatorId) external;

    /**
     * @notice Withdraws all available operator earnings (both ETH and legacy SSV) in one call
     * @param operatorId The ID of the operator
     */
    function withdrawAllVersionOperatorEarnings(uint64 operatorId) external;

    /**
     * @notice Withdraws a specified amount of legacy SSV operator earnings (pre-migration)
     * @param operatorId The ID of the operator
     * @param tokenAmount The amount of SSV tokens to withdraw
     */
    function withdrawOperatorEarningsSSV(uint64 operatorId, uint256 tokenAmount) external;

    /**
     * @notice Withdraws all available legacy SSV operator earnings (pre-migration)
     * @param operatorId The ID of the operator
     */
    function withdrawAllOperatorEarningsSSV(uint64 operatorId) external;

    /**
     * @notice Sets multiple operators as private without checking whitelist addresses
     * @param operatorIds Array of operator IDs to set as private
     */
    function setOperatorsPrivateUnchecked(uint64[] calldata operatorIds) external;

    /**
     * @notice Sets multiple operators as public while keeping existing whitelist addresses
     * @param operatorIds Array of operator IDs to set as public
     */
    function setOperatorsPublicUnchecked(uint64[] calldata operatorIds) external;
}