//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.2;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract NEWToken is ERC20 {
    constructor () ERC20("NEWToken", "NEW") {
        _mint(msg.sender, 200000000000000000000);
    }
}