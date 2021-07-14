//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.2;
import "../token/SSVToken.sol";

contract SSVTokenMock is SSVToken {
    function initialize() public virtual override initializer {
        SSVToken.initialize();
        __SSVTokenMock_init_unchained();
    }

    function __SSVTokenMock_init_unchained() internal initializer {
        _mint(msg.sender, 1000000000000000000000);
    }
}