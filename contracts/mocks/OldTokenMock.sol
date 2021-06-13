//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.2;
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

contract OldTokenMock is ERC20Upgradeable {
    function initialize() public virtual initializer {
        __Context_init_unchained();
        __ERC20_init_unchained("SSV Token", "SSV");
        __OldTokenMock_init_unchained();
    }

    function __OldTokenMock_init_unchained() internal initializer {
        _mint(msg.sender, 100000000000000000000);
    }
}