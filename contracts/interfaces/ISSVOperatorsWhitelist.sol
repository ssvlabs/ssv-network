// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";
import {ISSVWhitelistingContract} from "./external/ISSVWhitelistingContract.sol";

/**
 * @title SSV Operators Whitelist Interface
 * @author SSV Labs
 * @notice Interface for managing whitelists for SSV operators including setting and removing whitelisted addresses and contracts
 */
interface ISSVOperatorsWhitelist is ISSVNetworkCore {
    /**
     * @dev Emitted when multiple addresses are added to whitelists for operators
     * @param operatorIds The IDs of the affected operators
     * @param whitelistAddresses The addresses added to the whitelists
     */
    event OperatorMultipleWhitelistUpdated(uint64[] operatorIds, address[] whitelistAddresses);

    /**
     * @dev Emitted when multiple addresses are removed from whitelists for operators
     * @param operatorIds The IDs of the affected operators
     * @param whitelistAddresses The addresses removed from the whitelists
     */
    event OperatorMultipleWhitelistRemoved(uint64[] operatorIds, address[] whitelistAddresses);

    /**
     * @dev Emitted when the whitelisting contract is updated for operators
     * @param operatorIds The IDs of the affected operators
     * @param whitelistingContract The new whitelisting contract address
     */
    event OperatorWhitelistingContractUpdated(uint64[] operatorIds, address whitelistingContract);

    /**
     * @notice Sets whitelisted addresses (EOAs or contracts) for multiple operators
     * @notice Updates do not affect existing validators
     * @notice Only new registrations use the updated whitelist
     * @param operatorIds Array of operator IDs to update
     * @param whitelistAddresses Array of addresses to whitelist
     */
    function setOperatorsWhitelists(
        uint64[] calldata operatorIds,
        address[] calldata whitelistAddresses
    ) external;

    /**
     * @notice Removes whitelisted addresses from multiple operators
     * @param operatorIds Array of operator IDs to update
     * @param whitelistAddresses Array of addresses to remove
     */
    function removeOperatorsWhitelists(
        uint64[] calldata operatorIds,
        address[] calldata whitelistAddresses
    ) external;

    /**
     * @notice Sets a whitelisting contract for multiple operators
     * @param operatorIds Array of operator IDs to update
     * @param whitelistingContract The whitelisting contract address
     */
    function setOperatorsWhitelistingContract(
        uint64[] calldata operatorIds,
        ISSVWhitelistingContract whitelistingContract
    ) external;

    /**
     * @notice Removes the whitelisting contract from multiple operators
     * @param operatorIds Array of operator IDs to update
     */
    function removeOperatorsWhitelistingContract(uint64[] calldata operatorIds) external;
}