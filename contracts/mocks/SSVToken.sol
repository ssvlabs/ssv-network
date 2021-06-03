//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.2;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SSVToken is ERC20 {
    constructor () ERC20("SSVToken", "SSV") {
        // _mint(msg.sender, 200000000000000000000); // for demo use only
    }
}