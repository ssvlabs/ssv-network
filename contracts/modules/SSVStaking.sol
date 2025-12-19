// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ISSVNetworkCore} from "../interfaces/ISSVNetworkCore.sol";
import {CoreLib} from "../libraries/CoreLib.sol";
import {ProtocolLib} from "../libraries/ProtocolLib.sol";
import {SSVStorage} from "../libraries/SSVStorage.sol";
import {SSVStorageStaking, StorageStaking} from "../libraries/SSVStorageStaking.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/SSVStorageProtocol.sol";
import "../libraries/Types.sol";

interface ICSSV {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}

contract SSVStaking {
    using ProtocolLib for StorageProtocol;
    using Types64 for uint64;
    using Types256 for uint256;

    uint256 private constant PRECISION = 1e18;

    uint256 public immutable cooldownDuration;

    constructor() {
        cooldownDuration = 7 days;
    }

    function syncFees() external {
        _syncFees(SSVStorageStaking.load());
    }

    function stake(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        StorageStaking storage s = SSVStorageStaking.load();
        address cssv = s.cssv;
        if (cssv == address(0)) revert CSSVNotSet();
        _syncFees(s);
        _settle(msg.sender, s);

        if (!SSVStorage.load().token.transferFrom(msg.sender, address(this), amount)) {
            revert ISSVNetworkCore.TokenTransferFailed();
        }

        ICSSV(cssv).mint(msg.sender, amount);

        emit Staked(msg.sender, amount);
    }

    function requestUnstake(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        StorageStaking storage s = SSVStorageStaking.load();
        address cssv = s.cssv;
        if (cssv == address(0)) revert CSSVNotSet();
        if (s.pendingUnstakeAmount[msg.sender] != 0) revert CooldownActive();

        _syncFees(s);
        uint256 bal = ICSSV(cssv).balanceOf(msg.sender);
        _settleWithBalance(msg.sender, bal, s);
        if (amount > bal) revert UnstakeAmountExceedsBalance();

        ICSSV(cssv).burn(msg.sender, amount);

        uint256 unlockTime = block.timestamp + cooldownDuration;
        s.pendingUnstakeAmount[msg.sender] = amount;
        s.pendingUnstakeUnlockTime[msg.sender] = unlockTime;

        emit UnstakeRequested(msg.sender, amount, unlockTime);
    }

    function withdrawUnlocked() external {
        StorageStaking storage s = SSVStorageStaking.load();
        uint256 amount = s.pendingUnstakeAmount[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        uint256 unlockTime = s.pendingUnstakeUnlockTime[msg.sender];
        if (block.timestamp < unlockTime) revert CooldownNotFinished();

        s.pendingUnstakeAmount[msg.sender] = 0;
        s.pendingUnstakeUnlockTime[msg.sender] = 0;

        if (!SSVStorage.load().token.transfer(msg.sender, amount)) {
            revert ISSVNetworkCore.TokenTransferFailed();
        }

        emit UnstakedWithdrawn(msg.sender, amount);
    }

    function claimEthRewards() external {
        StorageStaking storage s = SSVStorageStaking.load();
        _syncFees(s);
        _settle(msg.sender, s);

        uint256 claimable = s.accrued[msg.sender];
        if (claimable == 0) revert NothingToClaim();

        uint256 payout = claimable - (claimable % DEDUCTED_DIGITS);
        if (payout == 0) revert NothingToClaim();

        uint64 payoutShrunk = payout.shrink();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        if (payoutShrunk > s.stakingEthPoolBalance) revert ISSVNetworkCore.InsufficientBalance();
        if (payoutShrunk > sp.ethDaoBalance) revert ISSVNetworkCore.InsufficientBalance();

        s.accrued[msg.sender] = claimable - payout;
        s.stakingEthPoolBalance -= payoutShrunk;
        sp.ethDaoBalance -= payoutShrunk;

        CoreLib.transferBalance(msg.sender, payout);
        emit RewardsClaimed(msg.sender, payout);
    }

    function rescueERC20(address token, address to, uint256 amount) external {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (token == address(SSVStorage.load().token)) revert InvalidToken();
        if (amount == 0) revert ZeroAmount();

        if (!IERC20(token).transfer(to, amount)) {
            revert ISSVNetworkCore.TokenTransferFailed();
        }

        emit ERC20Rescued(token, to, amount);
    }

    function onCSSVTransfer(address from, address to) external {
        StorageStaking storage s = SSVStorageStaking.load();
        if (msg.sender != s.cssv) revert NotCSSV();

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

        uint256 totalStaked = s.cssv == address(0) ? 0 : ICSSV(s.cssv).totalSupply();
        if (totalStaked != 0) {
            newFeesWei = newFeesShrunk.expand();
            s.accEthPerShare += (newFeesWei * PRECISION) / totalStaked;
        }

        s.stakingEthPoolBalance = current;
        emit FeesSynced(newFeesWei, s.accEthPerShare);
    }

    function _previewAccEthPerShare(StorageStaking storage s) internal view returns (uint256) {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 current = sp.networkTotalEarnings();

        uint256 idx = s.accEthPerShare;
        uint64 previous = s.stakingEthPoolBalance;

        uint256 totalStaked = s.cssv == address(0) ? 0 : ICSSV(s.cssv).totalSupply();

        if (current <= previous || totalStaked == 0) {
            return idx;
        }

        uint64 newFeesShrunk = current - previous;
        uint256 newFeesWei = newFeesShrunk.expand();
        return idx + (newFeesWei * PRECISION) / totalStaked;
    }

    function _settle(address user, StorageStaking storage s) internal {
        address cssv = s.cssv;
        uint256 bal = cssv == address(0) ? 0 : ICSSV(cssv).balanceOf(user);
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
