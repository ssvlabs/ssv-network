// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

interface ISSVWhitelistingContract {
    /// @notice Checks if the caller is whitelisted
    /// @param account The account that is being checked for whitelisting
    /// @param operatorId The SSV Operator Id which is being checked
    function isWhitelisted(address account, uint256 operatorId) external view returns (bool);
}
