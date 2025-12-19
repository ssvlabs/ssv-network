// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ISSVStaking} from "../interfaces/ISSVStaking.sol";
import {ICSSVToken} from "../interfaces/ICSSVToken.sol";
import {CoreLib} from "../libraries/CoreLib.sol";
import {ProtocolLib} from "../libraries/ProtocolLib.sol";
import {SSVStorage} from "../libraries/SSVStorage.sol";
import {SSVStorageStaking, StorageStaking, UnstakeRequest} from "../libraries/SSVStorageStaking.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/SSVStorageProtocol.sol";
import "../libraries/Types.sol";

contract SSVStaking is ISSVStaking {
    using ProtocolLib for StorageProtocol;
    using Types64 for uint64;
    using Types256 for uint256;

    uint64 private constant MINIMAL_STAKING_AMOUNT = 1_000_000_000;
    uint64 private constant PRECISION = 1e18;

    uint64 public immutable cooldownDuration;

    constructor() {
        cooldownDuration = 7 days;
    }

    function syncFees() external {
        _syncFees(SSVStorageStaking.load());
    }

    function stake(uint256 amount) external {
        // 1. Validation
        if (amount == 0) revert ZeroAmount();
        if (amount < MINIMAL_STAKING_AMOUNT) revert StakeTooLow();

        StorageStaking storage s = SSVStorageStaking.load();
        address cssv = s.cssv;
        if (cssv == address(0)) revert CSSVNotSet();

        // 2. Update global and user states before balance change
        _syncFees(s);
        _settle(msg.sender, s);

        // 3. Transfer SSV from user to this contract
        if (!SSVStorage.load().token.transferFrom(msg.sender, address(this), amount)) {
            revert TokenTransferFailed();
        }

        // 4. Mint cSSV receipt tokens 1:1
        ICSSVToken(cssv).mint(msg.sender, amount);

        emit Staked(msg.sender, amount);
    }

    function requestUnstake(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        StorageStaking storage s = SSVStorageStaking.load();
        address cssv = s.cssv;
        if (cssv == address(0)) revert CSSVNotSet();
        // Ensure user doesn't have an existing pending request
        if (s.withdrawals[msg.sender].amount != 0) revert CooldownActive();

        // 1. Sync global state
        _syncFees(s);
        // 2. Settle user rewards using current balance (before burn)
        uint256 bal = ICSSVToken(cssv).balanceOf(msg.sender);
        _settleWithBalance(msg.sender, bal, s);
        if (amount > bal) revert UnstakeAmountExceedsBalance();

        // 3. Burn cSSV tokens immediately
        ICSSVToken(cssv).burn(msg.sender, amount);

        // 4. Record pending withdrawal and set cooldown
        uint64 unlockTime = uint64(block.timestamp + cooldownDuration);
        s.withdrawals[msg.sender] = UnstakeRequest({
            amount: uint192(amount),
            unlockTime: unlockTime
        });

        emit UnstakeRequested(msg.sender, amount, unlockTime);
    }

    function withdrawUnlocked() external {
        StorageStaking storage s = SSVStorageStaking.load();
        UnstakeRequest memory request = s.withdrawals[msg.sender];
        uint256 amount = request.amount;
        if (amount == 0) revert NothingToWithdraw();

        // Verify cooldown period has passed
        if (block.timestamp < request.unlockTime) revert CooldownNotFinished();

        // Clear pending state
        delete s.withdrawals[msg.sender];

        // Transfer underlying SSV back to user
        if (!SSVStorage.load().token.transfer(msg.sender, amount)) {
            revert TokenTransferFailed();
        }

        emit UnstakedWithdrawn(msg.sender, amount);
    }

    function claimEthRewards() external {
        StorageStaking storage s = SSVStorageStaking.load();
        // Update state to calculate latest rewards
        _syncFees(s);
        _settle(msg.sender, s);

        uint256 claimable = s.accrued[msg.sender];
        if (claimable == 0) revert NothingToClaim();

        // Round down to precision supported by protocol storage
        uint256 payout = claimable - (claimable % DEDUCTED_DIGITS);
        if (payout == 0) revert NothingToClaim();

        uint64 payoutShrunk = payout.shrink();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        // Ensure sufficient balance in both staking pool and protocol DAO
        if (payoutShrunk > s.stakingEthPoolBalance) revert InsufficientBalance();
        if (payoutShrunk > sp.ethDaoBalance) revert InsufficientBalance();

        // Deduct from user accrual and global pools
        s.accrued[msg.sender] = claimable - payout;
        s.stakingEthPoolBalance -= payoutShrunk;
        sp.ethDaoBalance -= payoutShrunk;

        // Transfer ETH to user
        CoreLib.transferBalance(msg.sender, payout);
        emit RewardsClaimed(msg.sender, payout);
    }

    function rescueERC20(address token, address to, uint256 amount) external {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (token == address(SSVStorage.load().token) || token == address(SSVStorageStaking.load().cssv)) revert InvalidToken();
        if (amount == 0) revert ZeroAmount();

        if (!IERC20(token).transfer(to, amount)) {
            revert TokenTransferFailed();
        }

        emit ERC20Rescued(token, to, amount);
    }

    function onCSSVTransfer(address from, address to) external {
        StorageStaking storage s = SSVStorageStaking.load();

        _syncFees(s);
        _settle(from, s);
        _settle(to, s);
    }

    function _syncFees(StorageStaking storage s) internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint64 current = sp.networkTotalEarnings();
        sp.ethDaoBalance = current;
        sp.ethDaoIndexBlockNumber = uint32(block.number);

        uint64 previous = s.stakingEthPoolBalance;
        if (current <= previous) {
            s.stakingEthPoolBalance = current;
            return;
        }

        uint64 newFeesShrunk = current - previous;
        uint256 newFeesWei;

        uint256 totalStaked = s.cssv == address(0) ? 0 : ICSSVToken(s.cssv).totalSupply();
        if (totalStaked != 0) {
            newFeesWei = newFeesShrunk.expand();
            s.accEthPerShare += uint128((newFeesWei * PRECISION) / totalStaked);
        }

        s.stakingEthPoolBalance = current;
        emit FeesSynced(newFeesWei, s.accEthPerShare);
    }

    function _previewAccEthPerShare(StorageStaking storage s) internal view returns (uint256) {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 current = sp.networkTotalEarnings();

        uint256 idx = s.accEthPerShare;
        uint64 previous = s.stakingEthPoolBalance;

        uint256 totalStaked = s.cssv == address(0) ? 0 : ICSSVToken(s.cssv).totalSupply();

        if (current <= previous || totalStaked == 0) {
            return idx;
        }

        uint64 newFeesShrunk = current - previous;
        uint256 newFeesWei = newFeesShrunk.expand();
        return idx + (newFeesWei * PRECISION) / totalStaked;
    }

    function _settle(address user, StorageStaking storage s) internal {
        address cssv = s.cssv;
        uint256 bal = cssv == address(0) ? 0 : ICSSVToken(cssv).balanceOf(user);
        _settleWithBalance(user, bal, s);
    }

    function _settleWithBalance(address user, uint256 bal, StorageStaking storage s) internal {
        uint256 idx = s.accEthPerShare;
        uint256 userIdx = s.userIndex[user];

        uint256 pending;
        if (bal != 0 && idx != userIdx) {
            pending = (bal * (idx - userIdx)) / PRECISION;
            if (pending != 0) {
                s.accrued[user] += pending;
            }
        }

        s.userIndex[user] = idx;
        emit RewardsSettled(user, pending, s.accrued[user], idx);
    }
}
