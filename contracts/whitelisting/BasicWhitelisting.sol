// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {ISSVWhitelistingContract} from "../interfaces/external/ISSVWhitelistingContract.sol";

contract BasicWhitelisting is ISSVWhitelistingContract, ERC165, Ownable {
    mapping(address => bool) private whitelisted;

    event AddressWhitelisted(address indexed account);
    event AddressRemovedFromWhitelist(address indexed account);

    function addWhitelistedAddress(address account) external onlyOwner {
        whitelisted[account] = true;
        emit AddressWhitelisted(account);
    }

    function removeWhitelistedAddress(address account) external onlyOwner {
        whitelisted[account] = false;
        emit AddressRemovedFromWhitelist(account);
    }

    function isWhitelisted(address account, uint256) external view override returns (bool) {
        return whitelisted[account];
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(ISSVWhitelistingContract).interfaceId || super.supportsInterface(interfaceId);
    }
}
