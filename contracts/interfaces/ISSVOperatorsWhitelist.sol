// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

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
    function setOperatorsWhitelistingContract(uint64[] calldata operatorIds, ISSVWhitelistingContract whitelistingContract) external;

    /// @notice Removes the whitelisting contract set for a list of operators
    /// @param operatorIds The operator IDs to remove the whitelisting contract for
    function removeOperatorsWhitelistingContract(uint64[] calldata operatorIds) external;

    /**
     * @dev Emitted when the whitelist of an operator is updated.
     * @param operatorId operator's ID.
     * @param whitelisted operator's new whitelisted address.
     */
    event OperatorWhitelistUpdated(uint64 indexed operatorId, address whitelisted);

    /**
     * @dev Emitted when the whitelisting contract of an operator is updated.
     * @param operatorIds operators' IDs.
     * @param whitelistingContract operators' new whitelisting contract address.
     */
    event OperatorWhitelistingContractUpdated(uint64[] indexed operatorIds, address whitelistingContract);
}
