// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISSVStaking} from "../../interfaces/ISSVStaking.sol";

contract MaliciousClaimEthRewards {
    address public ssvNetwork;

    constructor(address _ssvNetwork) {
        ssvNetwork = _ssvNetwork;
    }

    function attack() external {
        ISSVStaking(ssvNetwork).claimEthRewards();
    }

    receive() external payable {
        ISSVStaking(ssvNetwork).claimEthRewards();
    }
}
