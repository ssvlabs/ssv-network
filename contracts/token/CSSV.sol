// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ICSSVController {
    function onCSSVTransfer(address from, address to) external;
}

contract CSSV is ERC20 {
    error NotController();
    error ZeroAddress();

    address public immutable controller;

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    constructor(address controller_) ERC20("cSSV", "cSSV") {
        if (controller_ == address(0)) revert ZeroAddress();
        controller = controller_;
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0) && msg.sender != controller) {
            ICSSVController(controller).onCSSVTransfer(from, to);
        }
        super._beforeTokenTransfer(from, to, amount);
    }

    function mint(address to, uint256 amount) external onlyController {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyController {
        _burn(from, amount);
    }
}
