// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../../interfaces/external/ISSVWhitelistingContract.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract MockWhitelistingContract is ISSVWhitelistingContract, ERC165 {
    mapping(address => bool) private whitelisted;

    constructor(address[] memory whitelistedAddresses) {
        for (uint i; i < whitelistedAddresses.length; ++i) {
            whitelisted[whitelistedAddresses[i]] = true;
        }
    }

    function isWhitelisted(address account, uint256) external view override returns (bool) {
        return whitelisted[account];
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(ISSVWhitelistingContract).interfaceId || super.supportsInterface(interfaceId);
    }
}
