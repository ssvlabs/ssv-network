// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/token/CSSVToken.sol";

contract UnauthorizedMinter {
    CSSVToken public token;
    bool public mintSucceeded;
    bool public burnSucceeded;
    
    function setToken(address _token) external {
        token = CSSVToken(_token);
    }
    
    function tryMint(address to, uint256 amount) external {
        try token.mint(to, amount) {
            mintSucceeded = true;
        } catch {
            mintSucceeded = false;
        }
    }
    
    function tryBurn(address from, uint256 amount) external {
        try token.burn(from, amount) {
            burnSucceeded = true;
        } catch {
            burnSucceeded = false;
        }
    }
}

contract CSSVTokenAccessControlEchidna is CSSVToken {
    UnauthorizedMinter public attacker;
    
    address constant USER1 = address(0x10000);
    
    constructor() CSSVToken(address(this)) {
        attacker = new UnauthorizedMinter();
        attacker.setToken(address(this));
        _mint(USER1, 1000 ether);
    }
    
    function onCSSVTransfer(address, address, uint256) external view {
        require(msg.sender == address(this));
    }
    
    function action_attackerTryMint(uint256 amount) public {
        amount = amount % 1_000_000 ether;
        attacker.tryMint(address(attacker), amount);
    }
    
    function action_attackerTryBurn(uint256 amount) public {
        uint256 balance = balanceOf(USER1);
        if (balance == 0) return;
        amount = amount % balance;
        attacker.tryBurn(USER1, amount);
    }
    
    function echidna_attacker_cannot_mint() public view returns (bool) {
        return !attacker.mintSucceeded();
    }
    
    function echidna_attacker_cannot_burn() public view returns (bool) {
        return !attacker.burnSucceeded();
    }
    
    function echidna_only_self_is_staking() public view returns (bool) {
        return ssvNetwork == address(this);
    }
}
