// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISSVStaking {
    function stake(uint256 amount) external;
    function requestUnstake(uint256 amount) external;
    function claimEthRewards() external;
}

/// @notice Attack contract for testing cross-function reentrancy guards on SSVStaking.
/// On receiving ETH (from claimEthRewards), re-enters stake() or requestUnstake().
contract StakingAttacker {
    address public immutable ssvNetwork;
    address public immutable ssvToken;

    /// @notice 0 = accept ETH silently, 1 = re-enter stake(), 2 = re-enter requestUnstake()
    uint8 public attackMode;

    constructor(address _network, address _token) {
        ssvNetwork = _network;
        ssvToken = _token;
    }

    function approveAndStake(uint256 amount) external {
        IERC20(ssvToken).approve(ssvNetwork, amount);
        ISSVStaking(ssvNetwork).stake(amount);
    }

    function setAttackMode(uint8 mode) external {
        attackMode = mode;
    }

    function claimRewards() external {
        ISSVStaking(ssvNetwork).claimEthRewards();
    }

    receive() external payable {
        if (attackMode == 1) {
            ISSVStaking(ssvNetwork).stake(1_000_000_000);
        } else if (attackMode == 2) {
            ISSVStaking(ssvNetwork).requestUnstake(1);
        }
    }
}

/// @notice Contract that rejects all ETH — for testing ETH transfer failure on claim.
contract ETHRejectingStaker {
    address public immutable ssvNetwork;
    address public immutable ssvToken;

    constructor(address _network, address _token) {
        ssvNetwork = _network;
        ssvToken = _token;
    }

    function approveAndStake(uint256 amount) external {
        IERC20(ssvToken).approve(ssvNetwork, amount);
        ISSVStaking(ssvNetwork).stake(amount);
    }

    function claimRewards() external {
        ISSVStaking(ssvNetwork).claimEthRewards();
    }

    // No receive() or fallback() — rejects all ETH transfers
}
