// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";
import {ISSVWhitelistingContract} from "./external/ISSVWhitelistingContract.sol";

interface ISSVOperatorsWhitelist is ISSVNetworkCore {
    /// @notice Sets a list of whitelisted addresses (EOAs or generic contracts) for a list of operators
    /// @notice Changes to an operator's whitelist will not impact existing validators registered with that operator
    /// @notice Only new validator registrations will adhere to the updated whitelist rules
    /// @param operatorIds The operator IDs to set the whitelists for
    /// @param whitelistAddresses The list of addresses to be whitelisted
    function setOperatorsWhitelists(uint64[] calldata operatorIds, address[] calldata whitelistAddresses) external;

    /// @notice Removes a list of whitelisted addresses (EOAs or generic contracts) for a list of operators
    /// @param operatorIds Operator IDs for which whitelists are removed
    /// @param whitelistAddresses List of addresses to be removed from the whitelist
    function removeOperatorsWhitelists(uint64[] calldata operatorIds, address[] calldata whitelistAddresses) external;

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
}
