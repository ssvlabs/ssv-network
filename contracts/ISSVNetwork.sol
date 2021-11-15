// File: contracts/ISSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "./ISSVRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISSVNetwork {
    /**
     * @dev Emitted when the operator validator added.
     * @param ownerAddress The user's ethereum address that is the owner of the operator.
     * @param blockNumber Block number for changes.
     */
    event OperatorValidatorAdded(address ownerAddress, uint256 blockNumber);

    /**
     * @dev Emitted when the network fee is updated.
     * @param oldFee The old fee
     * @param newFee The new fee
     */
    event NetworkFeeUpdated(uint256 oldFee, uint256 newFee);

    /**
     * @dev Initializes the contract.
     * @param registryAddress The registry address.
     * @param token The network token.
     * @param minimumBlocksBeforeLiquidation The minimum blocks before liquidation.
     */
    function initialize(
        ISSVRegistry registryAddress,
        IERC20 token,
        uint256 minimumBlocksBeforeLiquidation,
        uint256 operatorMaxFeeIncrease
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
    ) external;

    /**
     * @dev Deletes an operator.
     * @param publicKey Operator's public key.
     */
    function deleteOperator(bytes calldata publicKey) external;

    /**
     * @dev Activates an operator.
     * @param publicKey Operator's public key.
     */
    function activateOperator(bytes calldata publicKey) external;

    /**
     * @dev Deactivates an operator.
     * @param publicKey Operator's public key.
     */
    function deactivateOperator(bytes calldata publicKey) external;

    /**
     * @dev Updates operator's fee by public key.
     * @param publicKey Operator's public Key.
     * @param fee The operators's updated fee.
     */
    function updateOperatorFee(bytes calldata publicKey, uint256 fee) external;

    /**
     * @dev Updates operator's score by public key.
     * @param publicKey Operator's public Key.
     * @param score The operators's updated score.
     */
    function updateOperatorScore(bytes calldata publicKey, uint256 score) external;

    /**
     * @dev Registers a new validator.
     * @param publicKey Validator public key.
     * @param operatorPublicKeys Operator public keys.
     * @param sharesPublicKeys Shares public keys.
     * @param encryptedKeys Encrypted private keys.
     */
    function registerValidator(
        bytes calldata publicKey,
        bytes[] calldata operatorPublicKeys,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys,
        uint256 tokenAmount
    ) external;

    /**
     * @dev Updates a validator.
     * @param publicKey Validator public key.
     * @param operatorPublicKeys Operator public keys.
     * @param sharesPublicKeys Shares public keys.
     * @param encryptedKeys Encrypted private keys.
     */
    function updateValidator(
        bytes calldata publicKey,
        bytes[] calldata operatorPublicKeys,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys,
        uint256 tokenAmount
    ) external;

    /**
     * @dev Deletes a validator.
     * @param publicKey Validator's public key.
     */
    function deleteValidator(bytes calldata publicKey) external;

    /**
     * @dev Activates a validator.
     * @param publicKey Validator's public key.
     */
    function activateValidator(bytes calldata publicKey, uint256 tokenAmount) external;

    /**
     * @dev Deactivates a validator.
     * @param publicKey Validator's public key.
     */
    function deactivateValidator(bytes calldata publicKey) external;
    /**
     * @dev Deposits tokens for the sender.
     * @param tokenAmount Tokens amount.
     */
    function deposit(uint256 tokenAmount) external;

    /**
     * @dev Withdraw tokens for the sender.
     * @param tokenAmount Tokens amount.
     */
    function withdraw(uint256 tokenAmount) external;

    /**
     * @dev Liquidates an operator.
     * @param ownerAddress Owner's address.
     */
    function liquidate(address ownerAddress) external;

    /**
     * @dev Liquidates multiple owners.
     * @param ownerAddresses Owners' addresses.
     */
    function liquidateAll(address[] calldata ownerAddresses) external;

    /**
     * @dev Updates the number of blocks left for an owner before they can be liquidated.
     * @param minimumBlocksBeforeLiquidation The new value.
     */
    function updateMinimumBlocksBeforeLiquidation(uint256 minimumBlocksBeforeLiquidation) external;

    /**
     * @dev Updates the maximum fee increase in pecentage.
     * @param operatorMaxFeeIncrease The new value.
     */
    function updateOperatorMaxFeeIncrease(uint256 operatorMaxFeeIncrease) external;

    /**
     * @dev Updates the network fee.
     * @param fee the new fee
     */
    function updateNetworkFee(uint256 fee) external;

    /**
     * @dev Withdraws network fees.
     * @param amount Amount to withdraw
     */
     function withdrawNetworkFees(uint256 amount) external;

    /**
     * @dev Gets total earnings for an owner
     * @param ownerAddress Owner's address.
     */
     function totalEarningsOf(address ownerAddress) external view returns (uint256);

    /**
     * @dev Gets total balance for an owner.
     * @param ownerAddress Owner's address.
     */
    function totalBalanceOf(address ownerAddress) external view returns (uint256);

    /**
     * @dev Gets an operator by public key.
     * @param publicKey Operator's public key.
     */
    function operators(bytes calldata publicKey)
        external view
        returns (
            string memory,
            address,
            bytes memory,
            uint256,
            bool,
            uint256
        );

    /**
     * @dev Gets operator current fee.
     * @param publicKey Operator's public key.
     */
    function getOperatorCurrentFee(bytes calldata publicKey) external view returns (uint256);

    /**
     * @dev Gets operator earnings.
     * @param publicKey Operator's public key.
     */
    function operatorEarningsOf(bytes memory publicKey) external view returns (uint256);

    /**
     * @dev Gets the network fee for an address.
     * @param ownerAddress Owner's address.
     */
    function addressNetworkFee(address ownerAddress) external view returns (uint256);

    /**
     * @dev Returns the burn rate of an owner, returns 0 if negative.
     * @param ownerAddress Owner's address.
     */
    function burnRate(address ownerAddress) external view returns (uint256);

    /**
     * @dev Check if an owner is liquidatable.
     * @param ownerAddress Owner's address.
     */
    function liquidatable(address ownerAddress) external view returns (bool);

    /**
     * @dev Returns the network fee.
     */
    function networkFee() external view returns (uint256);

    /**
     * @dev Gets the network treasury
     */
    function getNetworkTreasury() external view returns (uint256);

    /**
     * @dev Returns the number of blocks left for an owner before they can be liquidated.
     */
    function minimumBlocksBeforeLiquidation() external view returns (uint256);

    /**
     * @dev Returns the maximum fee increase in pecentage
     */
     function operatorMaxFeeIncrease() external view returns (uint256);
}
