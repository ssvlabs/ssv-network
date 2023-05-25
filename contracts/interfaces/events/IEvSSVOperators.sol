// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./../ISSVNetworkCore.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IEvSSVOperators is ISSVNetworkCore {
    /**
     * @dev Emitted when a new operator has been added.
     * @param operatorId operator's ID.
     * @param owner Operator's ethereum address that can collect fees.
     * @param publicKey Operator's public key. Will be used to encrypt secret shares of validators keys.
     * @param fee Operator's fee.
     */
    event OperatorAdded(uint64 indexed operatorId, address indexed owner, bytes publicKey, uint256 fee);

    /**
     * @dev Emitted when operator has been removed.
     * @param operatorId operator's ID.
     */
    event OperatorRemoved(uint64 indexed operatorId);

    /**
     * @dev Emitted when the whitelist of an operator is updated.
     * @param operatorId operator's ID.
     * @param whitelisted operator's new whitelisted address.
     */
    event OperatorWhitelistUpdated(uint64 indexed operatorId, address whitelisted);
    event OperatorFeeDeclared(address indexed owner, uint64 indexed operatorId, uint256 blockNumber, uint256 fee);

    event OperatorFeeCancellationDeclared(address indexed owner, uint64 indexed operatorId);
    /**
     * @dev Emitted when an operator's fee is updated.
     * @param owner Operator's owner.
     * @param blockNumber from which block number.
     * @param fee updated fee value.
     */
    event OperatorFeeExecuted(address indexed owner, uint64 indexed operatorId, uint256 blockNumber, uint256 fee);
    event OperatorWithdrawn(address indexed owner, uint64 indexed operatorId, uint256 value);
    event FeeRecipientAddressUpdated(address indexed owner, address recipientAddress);
}
