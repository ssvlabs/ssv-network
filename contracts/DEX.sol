//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.2;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DEX {
    event CDTToSSVConverted(address sender, uint256 cdtAmount, uint256 ssvAmount);
    event SSVToCDTConverted(address sender, uint256 ssvAmount, uint256 cdtAmount);

    mapping(address => uint256) public cdtAllowance;

    IERC20 private cdtToken;
    IERC20 private ssvToken;

    uint public rate;

    function initialize(IERC20 _cdtTokenAddress, IERC20 _ssvTokenAddress, uint256 _rate) public {
        cdtToken = _cdtTokenAddress;
        ssvToken = _ssvTokenAddress;
        rate = _rate;
    }

    function convertCDTToSSV(uint256 _amount) public {
        uint256 ssvAmount = _amount / rate;
        uint256 cdtAmount = ssvAmount * rate;
        cdtToken.transferFrom(msg.sender, address(this), cdtAmount);
        ssvToken.transfer(msg.sender, ssvAmount);
        cdtAllowance[msg.sender] += cdtAmount;
        emit CDTToSSVConverted(msg.sender, cdtAmount, ssvAmount);
    }

    function convertSSVToCDT(uint256 _amount) public {
        uint256 cdtAmount = _amount * rate;
        require(
            cdtAllowance[msg.sender] >= cdtAmount,
            "DEX: Can't exceed original CDT amount"
        );
        cdtAllowance[msg.sender] -= cdtAmount;
        ssvToken.transferFrom(msg.sender, address(this), _amount);
        cdtToken.transfer(msg.sender, cdtAmount);
        emit SSVToCDTConverted(msg.sender, _amount, cdtAmount);
    }
}