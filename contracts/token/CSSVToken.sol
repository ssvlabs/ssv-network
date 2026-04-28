// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ISSVStaking {
    function onCSSVTransfer(address from, address to, uint256 amount) external;
}

contract CSSVToken is ERC20 {
    error NotSSVStaking();
    error ZeroAddress();

    address public immutable ssvStaking;

    modifier onlySSVStaking() {
        if (msg.sender != ssvStaking) revert NotSSVStaking();
        _;
    }

    constructor(address ssvStaking_) ERC20("cSSV", "cSSV") {
        if (ssvStaking_ == address(0)) revert ZeroAddress();
        ssvStaking = ssvStaking_;
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
        if (from != to && from != address(0) && to != address(0) && msg.sender != ssvStaking && amount > 0) {
            ISSVStaking(ssvStaking).onCSSVTransfer(from, to, amount);
        }
        super._beforeTokenTransfer(from, to, amount);
    }

    function mint(address to, uint256 amount) external onlySSVStaking {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlySSVStaking {
        _burn(from, amount);
    }
}
