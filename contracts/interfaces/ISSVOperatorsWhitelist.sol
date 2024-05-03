// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "./ISSVNetworkCore.sol";
import "./external/ISSVWhitelistingContract.sol";

interface ISSVOperatorsWhitelist is ISSVNetworkCore {
    /// @notice Sets the whitelist for an operator
    /// @param operatorId The ID of the operator
    /// @param whitelistAddress The address to be whitelisted
    function setOperatorWhitelist(uint64 operatorId, address whitelistAddress) external;

    /// @notice Sets a list of whitelisted addresses (EOAs or generic contracts) for a list of operators
    /// @param operatorIds The operator IDs to set the whitelists for
    /// @param whitelistAddresses The list of addresses to be whitelisted
    function setOperatorMultipleWhitelists(
        uint64[] calldata operatorIds,
        address[] calldata whitelistAddresses
    ) external;

    /// @notice Removes a list of whitelisted addresses (EOAs or generic contracts) for a list of operators
    /// @param operatorIds Operator IDs for which whitelists are removed
    /// @param whitelistAddresses List of addresses to be removed from the whitelist
    function removeOperatorMultipleWhitelists(
        uint64[] calldata operatorIds,
        address[] calldata whitelistAddresses
    ) external;

    /// @notice Sets a whitelisting contract for a list of operators
    /// @param operatorIds The operator IDs to set the whitelisting contract for
    /// @param whitelistingContract The address of a whitelisting contract
    function setOperatorsWhitelistingContract(
        uint64[] calldata operatorIds,
        ISSVWhitelistingContract whitelistingContract
    ) external;

    /// @notice Removes the whitelisting contract set for a list of operators
    /// @param operatorIds The operator IDs to remove the whitelisting contract for
    function removeOperatorsWhitelistingContract(uint64[] calldata operatorIds) external;

    /// @notice Set the list of operators as private without checking for any whitelisting address
    /// @notice The operators are considered private when registering validators
    /// @param operatorIds The operator IDs to set as private
    function setOperatorsPrivateUnchecked(uint64[] calldata operatorIds) external;

    /// @notice Set the list of operators as public without removing any whitelisting address
    /// @notice The operators still keep its adresses whitelisted (external contract or EOAs/generic contracts)
    /// @notice The operators are considered public when registering validators
    /// @param operatorIds The operator IDs to set as public
    function setOperatorsPublicUnchecked(uint64[] calldata operatorIds) external;

    /**
     * @dev Emitted when the whitelist of an operator is updated.
     * @param operatorId operator's ID.
     * @param whitelistAddress operator's new whitelisted address.
     */
    event OperatorWhitelistUpdated(uint64 indexed operatorId, address whitelistAddress);

    /**
     * @dev Emitted when a list of adresses are whitelisted for a set of operators.
     * @param operatorIds operators' IDs.
     * @param whitelistAddresses operators' new whitelist addresses (EOAs or generic contracts).
     */
    event OperatorMultipleWhitelistUpdated(uint64[] operatorIds, address[] whitelistAddresses);

    /**
     * @dev Emitted when a list of adresses are de-whitelisted for a set of operators.
     * @param operatorIds operators' IDs.
     * @param whitelistAddresses operators' list of whitelist addresses to be removed (EOAs or generic contracts).
     */
    event OperatorMultipleWhitelistRemoved(uint64[] operatorIds, address[] whitelistAddresses);

    /**
     * @dev Emitted when the whitelisting contract of an operator is updated.
     * @param operatorIds operators' IDs.
     * @param whitelistingContract operators' new whitelisting contract address.
     */
    event OperatorWhitelistingContractUpdated(uint64[] operatorIds, address whitelistingContract);

    /**
     * @dev Emitted when the operators changed its privacy status
     * @param operatorIds operators' IDs.
     * @param toPrivate Flag that indicates if the operators are being set to private (true) or public (false).
     */
    event OperatorPrivacyStatusUpdated(uint64[] operatorIds, bool toPrivate);
}
