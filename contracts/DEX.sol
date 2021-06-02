//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.2;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DEX {
    event CDTToSSVConverted(uint256 amount);

    IERC20 public cdtToken;
    IERC20 public ssvToken;

    uint public rate;

    function init(address _cdtTokenAddress, address _ssvTokenAddress) public {
        cdtToken = IERC20(_cdtTokenAddress);
        ssvToken = IERC20(_ssvTokenAddress);
        rate = 10;
    }

    function convertCDTToSSV(uint256 amount) public {
        uint256 ssvAmount = amount / rate;
        cdtToken.transferFrom(msg.sender, address(this), amount);
        ssvToken.transfer(msg.sender, ssvAmount);
        emit CDTToSSVConverted(ssvAmount);
    }
}