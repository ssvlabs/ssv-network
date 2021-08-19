//SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.4;
import "../token/SSVToken.sol";

contract SSVTokenMock is SSVToken {
    constructor() {
        _mint(msg.sender, 1000000000000000000000);
    }
}