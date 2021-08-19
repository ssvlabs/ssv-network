//SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.4;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract OldTokenMock is ERC20 {
    constructor() ERC20("CDT Token", "CDT") {
        _mint(msg.sender, 10000000000000000000000);
    }
}