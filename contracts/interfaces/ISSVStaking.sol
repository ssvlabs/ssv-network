// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";

/**
 * @title SSV Staking Interface
 * @author SSV Labs
 * @notice Interface for SSV staking operations including staking tokens, requesting unstakes, withdrawing, claiming rewards and managing fees
 */
interface ISSVStaking is ISSVNetworkCore {
    /**
     * @dev Emitted when SSV tokens are staked
     * @param user The user who staked tokens
     * @param amount The amount of SSV staked
     */
    event Staked(address indexed user, uint256 amount);

    /**
     * @dev Emitted when an unstake is requested
     * @param user The user requesting the unstake
     * @param amount The amount of cSSV burned (matches SSV amount)
     * @param unlockTime When the SSV can be withdrawn
     */
    event UnstakeRequested(address indexed user, uint256 amount, uint256 unlockTime);

    /**
     * @dev Emitted when unstaked SSV is withdrawn
     * @param user The user withdrawing
     * @param amount The amount of SSV withdrawn
     */
    event UnstakedWithdrawn(address indexed user, uint256 amount);

    /**
     * @dev Emitted when fees are synced within the protocol
     * @param newFeesWei New fees amount in wei
     * @param accEthPerShare Updated accumulated ETH per share
     */
    event FeesSynced(uint256 newFeesWei, uint256 accEthPerShare);

    /**
     * @dev Emitted when a user's rewards are settled
     * @param user The user's address
     * @param pending Pending rewards for this settlement
     * @param accrued Total accrued rewards
     * @param userIndex User's reward index after settlement
     */
    event RewardsSettled(address indexed user, uint256 pending, uint256 accrued, uint256 userIndex);

    /**
     * @dev Emitted when ETH rewards are claimed
     * @param user The user claiming
     * @param amount The ETH amount claimed
     */
    event RewardsClaimed(address indexed user, uint256 amount);

    /**
     * @dev Emitted when ERC20 tokens are rescued
     * @param token The token rescued
     * @param to The recipient
     * @param amount The amount rescued
     */
    event ERC20Rescued(address indexed token, address indexed to, uint256 amount);

    /**
     * @notice Updates the global ETH reward index from protocol storage
     */
    function syncFees() external;

    /**
     * @notice Stakes SSV tokens to mint cSSV and earn ETH rewards
     * @param amount Amount of SSV to stake
     */
    function stake(uint256 amount) external;

    /**
     * @notice Requests to unstake SSV by burning cSSV
     * @notice Starts cooldown period
     * @param amount Amount of cSSV to burn (1:1 with SSV)
     */
    function requestUnstake(uint256 amount) external;

    /**
     * @notice Withdraws unlocked SSV after cooldown
     */
    function withdrawUnlocked() external;

    /**
     * @notice Claims earned ETH rewards
     */
    function claimEthRewards() external;

    /**
     * @notice Rescues stuck ERC20 tokens (not SSV or cSSV)
     * @param token Token address
     * @param to Recipient
     * @param amount Amount to rescue
     */
    function rescueERC20(address token, address to, uint256 amount) external;

    /**
     * @dev Hook for cSSV transfers
     * @dev Updates rewards for sender and receiver
     * @param from Sender
     * @param to Recipient
     * @param amount cSSV amount
     */
    function onCSSVTransfer(address from, address to, uint256 amount) external;
}
