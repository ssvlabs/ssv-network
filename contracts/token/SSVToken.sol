// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";

contract SSVToken is Initializable, ContextUpgradeable, OwnableUpgradeable, ERC20Upgradeable, ERC20BurnableUpgradeable {
    function initialize() public virtual initializer {
        __SSVToken_init();
    }

    function __SSVToken_init() internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __ERC20_init_unchained("SSV Token", "SSV");
        __ERC20Burnable_init_unchained();
        __SSVToken_init_unchained();
    }

    function __SSVToken_init_unchained() internal initializer {
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
