// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

interface ISSVStaking {
    function syncFees() external;

    function stake(uint256 amount) external;

    function requestUnstake(uint256 amount) external;

    function withdrawUnlocked() external;

    function claimEthRewards() external;

    function rescueERC20(address token, address to, uint256 amount) external;

    function setCSSV(address cssv) external;

    function onCSSVTransfer(address from, address to) external;

    error NotCSSV();

    error CSSVNotSet();

    error ZeroAddress();
    error ZeroAmount();
    error InvalidToken();
    error CooldownActive();
    error CooldownNotFinished();
    error NothingToClaim();
    error NothingToWithdraw();
    error UnstakeAmountExceedsBalance();

    event Staked(address indexed user, uint256 amount);
    event UnstakeRequested(address indexed user, uint256 amount, uint256 unlockTime);
    event UnstakedWithdrawn(address indexed user, uint256 amount);

    event FeesSynced(uint256 newFeesWei, uint256 accEthPerShare);
    event RewardsSettled(address indexed user, uint256 pending, uint256 accrued, uint256 userIndex);
    event RewardsClaimed(address indexed user, uint256 amount);
    event ERC20Rescued(address indexed token, address indexed to, uint256 amount);

    event CSSVUpdated(address indexed cssv);
}
