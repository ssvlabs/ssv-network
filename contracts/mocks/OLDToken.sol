//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.2;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract OldToken is ERC20 {
    constructor () ERC20("OldToken", "OLD") {
        _mint(msg.sender, 100000000000000000000);
    }
}