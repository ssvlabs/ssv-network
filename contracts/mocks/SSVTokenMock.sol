//SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title SSV Token
 */
contract SSVTokenMock is Ownable, ERC20 {
    constructor() ERC20("SSV Token", "SSV") {
        _mint(msg.sender, 1000000000000000000000);
    }

    /**
     * @dev Mint tokens
     * @param to The target address
     * @param amount The amount of token to mint
     */
    // solhint-disable-next-line comprehensive-interface
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
