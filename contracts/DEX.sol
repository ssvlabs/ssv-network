//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.2;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DEX {
    event CDTToSSVConverted(address sender, uint256 amount);
    event SSVToCDTConverted(address sender, uint256 amount);

    mapping(address => uint256) public cdtAllowance;

    IERC20 public cdtToken;
    IERC20 public ssvToken;

    uint public rate;

    function initialize(IERC20 _cdtTokenAddress, IERC20 _ssvTokenAddress, uint256 _rate) public {
        cdtToken = _cdtTokenAddress;
        ssvToken = _ssvTokenAddress;
        rate = _rate;
    }

    function convertCDTToSSV(uint256 amount) public {   
        uint256 ssvAmount = amount / rate;
        uint256 cleanAmount = ssvAmount * rate;
        cdtToken.transferFrom(msg.sender, address(this), cleanAmount);
        ssvToken.transfer(msg.sender, ssvAmount);
        cdtAllowance[msg.sender] += cleanAmount;
        emit CDTToSSVConverted(msg.sender, ssvAmount);
    }

    function convertSSVToCDT(uint256 amount) public {
        uint256 cdtAmount = amount * rate;
        require(
            cdtAllowance[msg.sender] >= cdtAmount,
            "Exchange SSV to CDT tokens in requested amount not allowed."
        );
        ssvToken.transferFrom(msg.sender, address(this), amount);
        cdtToken.transfer(msg.sender, cdtAmount);
        cdtAllowance[msg.sender] -= cdtAmount;
        emit SSVToCDTConverted(msg.sender, cdtAmount);
    }
}