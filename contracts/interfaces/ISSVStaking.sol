// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";

interface ISSVStaking is ISSVNetworkCore {
    /// @notice Updates the global ETH reward index by pulling new earnings from the protocol storage
    function syncFees() external;

    /// @notice Stakes SSV tokens to mint cSSV and start earning ETH rewards
    /// @param amount The amount of SSV tokens to stake
    function stake(uint256 amount) external;

    /// @notice Requests to unstake a specific amount of SSV, burning cSSV immediately
    /// @dev Starts the cooldown period for the user
    /// @param amount The amount of cSSV to burn (1:1 with SSV)
    function requestUnstake(uint256 amount) external;

    /// @notice Withdraws the unstaked SSV tokens after the cooldown period has passed
    function withdrawUnlocked() external;

    /// @notice Claims accrued ETH rewards for the caller
    function claimEthRewards() external;

    /// @notice Rescues accidental ERC20 transfers to the contract (cannot rescue SSV or cSSV)
    /// @param token The address of the token to rescue
    /// @param to The recipient address
    /// @param amount The amount to transfer
    function rescueERC20(address token, address to, uint256 amount) external;

    /// @notice Hook called by cSSV token before any transfer (except mint/burn by this contract)
    /// @dev Updates reward indexes for both sender and receiver to prevent reward theft/loss
    /// @param from The sender address
    /// @param to The recipient address
    /// @param amount The amount of cSSV being transferred
    function onCSSVTransfer(address from, address to, uint256 amount) external;

    /**
     * @dev Emitted when SSV tokens are staked.
     * @param user The address of the user staking tokens.
     * @param amount The amount of SSV tokens staked.
     */
    event Staked(address indexed user, uint256 amount);

    /**
     * @dev Emitted when an unstake request is made.
     * @param user The address of the user requesting unstake.
     * @param amount The amount of cSSV burned/SSV requested.
     * @param unlockTime The timestamp when the tokens will be available for withdrawal.
     */
    event UnstakeRequested(address indexed user, uint256 amount, uint256 unlockTime);

    /**
     * @dev Emitted when unstaked tokens are withdrawn.
     * @param user The address of the user withdrawing tokens.
     * @param amount The amount of SSV tokens withdrawn.
     */
    event UnstakedWithdrawn(address indexed user, uint256 amount);

    /**
     * @dev Emitted when global fees are synced from the protocol.
     * @param newFeesWei The amount of new fees in Wei since the last sync.
     * @param accEthPerShare The updated accumulated ETH per share.
     */
    event FeesSynced(uint256 newFeesWei, uint256 accEthPerShare);

    /**
     * @dev Emitted when a user's rewards are settled.
     * @param user The address of the user.
     * @param pending The pending rewards calculated for this settlement.
     * @param accrued The total accrued rewards for the user.
     * @param userIndex The user's reward index after settlement.
     */
    event RewardsSettled(address indexed user, uint256 pending, uint256 accrued, uint256 userIndex);

    /**
     * @dev Emitted when rewards are claimed.
     * @param user The address of the user claiming rewards.
     * @param amount The amount of ETH rewards claimed.
     */
    event RewardsClaimed(address indexed user, uint256 amount);

    /**
     * @dev Emitted when ERC20 tokens are rescued.
     * @param token The address of the rescued token.
     * @param to The recipient address.
     * @param amount The amount of tokens rescued.
     */
    event ERC20Rescued(address indexed token, address indexed to, uint256 amount);

    event DelegationUpdated(address indexed user, uint32[4] oracleIds, uint256[4] amounts);
}
