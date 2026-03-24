// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/token/CSSVToken.sol";
import "../../contracts/test/mocks/MockToken.sol";

contract CSSVTokenEchidna is CSSVToken {
    uint256 private constant SSV_SUPPLY_CAP = 1_000_000_000 ether;

    uint256 public totalMinted;
    uint256 public totalBurned;
    uint256 public callbackCount;

    MockToken private ssvToken;

    address constant USER1 = address(0x10000);
    address constant USER2 = address(0x20000);
    address constant USER3 = address(0x30000);
    address constant USER4 = address(0x40000);

    constructor() CSSVToken(address(this)) {
        ssvToken = new MockToken();
        ssvToken.mint(address(this), SSV_SUPPLY_CAP);
    }

    function onCSSVTransfer(address, address, uint256) external {
        require(msg.sender == address(this), "Only self");
        callbackCount++;
    }

    function _getUser(uint8 seed) internal pure returns (address) {
        uint8 idx = seed % 4;
        if (idx == 0) return USER1;
        if (idx == 1) return USER2;
        if (idx == 2) return USER3;
        return USER4;
    }

    function _boundAmount(uint256 amount) internal pure returns (uint256) {
        amount = amount % 1_000_000 ether;
        if (amount == 0) amount = 1 ether;
        return amount;
    }

    function _mintableAmount(uint256 requestedAmount) internal view returns (uint256) {
        uint256 cssvSupply = totalSupply();
        uint256 ssvSupply = ssvToken.totalSupply();
        if (cssvSupply >= ssvSupply) return 0;

        uint256 headroom = ssvSupply - cssvSupply;
        return requestedAmount > headroom ? headroom : requestedAmount;
    }

    function action_mint(uint256 amount, uint8 userSeed) public {
        amount = _boundAmount(amount);
        amount = _mintableAmount(amount);
        if (amount == 0) return;

        address to = _getUser(userSeed);
        _mint(to, amount);
        totalMinted += amount;
    }

    function action_burn(uint256 amount, uint8 userSeed) public {
        address from = _getUser(userSeed);
        uint256 balance = balanceOf(from);
        if (balance == 0) return;
        
        amount = amount % balance;
        if (amount == 0) amount = 1;

        _burn(from, amount);
        totalBurned += amount;
    }

    function action_mintLarge(uint8 userSeed) public {
        address to = _getUser(userSeed);
        uint256 currentSupply = totalSupply();
        
        if (currentSupply > type(uint256).max - 10000 ether) return;
        
        uint256 amount = _mintableAmount(10000 ether);
        if (amount == 0) return;

        _mint(to, amount);
        totalMinted += amount;
    }

    function action_rapidMintBurn(uint256 amount, uint8 userSeed, uint8 iterations) public {
        address user = _getUser(userSeed);
        amount = _boundAmount(amount);
        amount = _mintableAmount(amount);
        if (amount == 0) return;

        iterations = iterations % 10 + 1;
        
        for (uint8 i = 0; i < iterations; i++) {
            _mint(user, amount);
            _burn(user, amount);
        }
    }

    function action_mintToAll(uint256 amount) public {
        amount = _boundAmount(amount);
        uint256 headroom = _mintableAmount(type(uint256).max);
        if (headroom < 4) return;
        if (amount > headroom / 4) amount = headroom / 4;
        if (amount == 0) return;
        
        _mint(USER1, amount);
        _mint(USER2, amount);
        _mint(USER3, amount);
        _mint(USER4, amount);
        
        totalMinted += amount * 4;
    }

    function action_burnFromAll(uint256 amount) public {
        uint256 bal1 = balanceOf(USER1);
        uint256 bal2 = balanceOf(USER2);
        uint256 bal3 = balanceOf(USER3);
        uint256 bal4 = balanceOf(USER4);
        
        uint256 minBal = bal1;
        if (bal2 < minBal) minBal = bal2;
        if (bal3 < minBal) minBal = bal3;
        if (bal4 < minBal) minBal = bal4;
        
        if (minBal == 0) return;
        
        amount = amount % minBal;
        if (amount == 0) amount = 1;
        
        _burn(USER1, amount);
        _burn(USER2, amount);
        _burn(USER3, amount);
        _burn(USER4, amount);
        
        totalBurned += amount * 4;
    }

    function action_burnAll(uint8 userSeed) public {
        address user = _getUser(userSeed);
        uint256 balance = balanceOf(user);
        
        if (balance == 0) return;
        
        _burn(user, balance);
        totalBurned += balance;
    }

    function action_internalTransfer(uint8 fromSeed, uint8 toSeed, uint256 amount) public {
        address from = _getUser(fromSeed);
        address to = _getUser(toSeed);
        if (from == to) return;
        
        uint256 balance = balanceOf(from);
        if (balance == 0) return;
        
        amount = amount % balance;
        if (amount == 0) amount = 1;
        
        _transfer(from, to, amount);
    }

    function echidna_supply_equals_minted_minus_burned() public view returns (bool) {
        return totalSupply() == totalMinted - totalBurned;
    }

    function echidna_burned_lte_minted() public view returns (bool) {
        return totalBurned <= totalMinted;
    }

    function echidna_individual_balance_lte_supply() public view returns (bool) {
        return balanceOf(USER1) <= totalSupply() &&
               balanceOf(USER2) <= totalSupply() &&
               balanceOf(USER3) <= totalSupply() &&
               balanceOf(USER4) <= totalSupply() &&
               balanceOf(address(this)) <= totalSupply();
    }

    function echidna_staking_is_self() public view returns (bool) {
        return ssvStaking == address(this);
    }

    function echidna_name_immutable() public view returns (bool) {
        return keccak256(bytes(name())) == keccak256(bytes("cSSV"));
    }

    function echidna_symbol_immutable() public view returns (bool) {
        return keccak256(bytes(symbol())) == keccak256(bytes("cSSV"));
    }

    function echidna_decimals_is_18() public view returns (bool) {
        return decimals() == 18;
    }

    function echidna_zero_address_has_no_balance() public view returns (bool) {
        return balanceOf(address(0)) == 0;
    }

    function echidna_supply_non_negative() public view returns (bool) {
        return totalSupply() >= 0;
    }

    function echidna_cssv_supply_lte_ssv_total_supply() public view returns (bool) {
        return totalSupply() <= ssvToken.totalSupply();
    }
}
