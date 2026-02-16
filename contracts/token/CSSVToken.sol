// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ISSVStaking {
    function onCSSVTransfer(address from, address to, uint256 amount) external;
}

contract CSSVToken is ERC20 {
    error NotSSVStaking();
    error ZeroAddress();
    error InvalidRecipient();

    address public immutable ssvNetwork;

    modifier onlySSVStaking() {
        if (msg.sender != ssvNetwork) revert NotSSVStaking();
        _;
    }

    constructor(address ssvNetwork_) ERC20("cSSV", "cSSV") {
        if (ssvNetwork_ == address(0)) revert ZeroAddress();
        ssvNetwork = ssvNetwork_;
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
        if (to == address(this) || to == ssvNetwork) {
            revert InvalidRecipient();
        }

        if (from != to && from != address(0) && to != address(0) && msg.sender != ssvNetwork && amount > 0) {
            ISSVStaking(ssvNetwork).onCSSVTransfer(from, to, amount);
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
