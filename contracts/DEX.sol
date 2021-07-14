//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.2;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DEX {
    event CDTToSSVConverted(address sender, uint256 cdtAmount, uint256 ssvAmount);

    IERC20 public cdtToken;
    IERC20 public ssvToken;

    uint public rate;

    bool initialized;

    function initialize(IERC20 _cdtTokenAddress, IERC20 _ssvTokenAddress, uint256 _rate) public {
        require(!initialized, "already initialized");
        require(_rate > 0, "rate cannot be zero");

        cdtToken = _cdtTokenAddress;
        ssvToken = _ssvTokenAddress;
        rate = _rate;

        initialized = true;
    }

    function convertCDTToSSV(uint256 _amount) public {
        uint256 ssvAmount = _amount / rate;
        uint256 cdtAmount = ssvAmount * rate;
        cdtToken.transferFrom(msg.sender, address(this), cdtAmount);
        ssvToken.transfer(msg.sender, ssvAmount);
        emit CDTToSSVConverted(msg.sender, cdtAmount, ssvAmount);
    }
}