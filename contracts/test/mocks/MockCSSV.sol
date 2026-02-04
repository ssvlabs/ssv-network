// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ISSVStaking {
    function onCSSVTransfer(address from, address to, uint256 amount) external;
}

contract MockCSSV is ERC20 {

    constructor() ERC20("cSSV", "cSSV") {}

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
        super._beforeTokenTransfer(from, to, amount);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
