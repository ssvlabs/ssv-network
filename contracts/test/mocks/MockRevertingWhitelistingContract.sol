// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../interfaces/external/ISSVWhitelistingContract.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/// @notice Whitelisting contract that passes ERC165 but always reverts on isWhitelisted
contract MockRevertingWhitelistingContract is ISSVWhitelistingContract, ERC165 {
    function isWhitelisted(address, uint256) external pure override returns (bool) {
        revert("MockRevertingWhitelistingContract: always reverts");
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(ISSVWhitelistingContract).interfaceId || super.supportsInterface(interfaceId);
    }
}
