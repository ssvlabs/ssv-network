pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";

contract SSVToken is ERC20, ERC20Mintable {
    constructor(uint256 initialSupply) ERC20Detailed("SSVToken", "SSV", 18) public {
        _mint(msg.sender, initialSupply);
    }
}