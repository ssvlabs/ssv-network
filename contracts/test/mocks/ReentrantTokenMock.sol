// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ITokenCallback {
    function onTransferReceived(address from, uint256 amount) external returns (bool);
}

contract ReentrantTokenMock is ERC20 {
    constructor() ERC20("ReentrantToken", "RTK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool success = super.transfer(to, amount);
        if (success && to.code.length > 0) {
            try ITokenCallback(to).onTransferReceived(msg.sender, amount) {} catch {}
        }
        return success;
    }
}
