// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ISSVStaking} from "../interfaces/ISSVStaking.sol";
import {ICSSVToken} from "../interfaces/ICSSVToken.sol";
import {CoreLib} from "../libraries/CoreLib.sol";
import {ProtocolLib} from "../libraries/ProtocolLib.sol";
import {SSVStorage} from "../libraries/storage/SSVStorage.sol";
import {SSVStorageStaking, StorageStaking, UnstakeRequest} from "../libraries/storage/SSVStorageStaking.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/storage/SSVStorageProtocol.sol";
import {SSVReentrancyGuard} from "../abstract/SSVReentrancyGuard.sol";
import {PackedETH} from "../libraries/SSVCoreTypes.sol";
import {PackedETHLib, ETH_DEDUCTED_DIGITS} from "../libraries/SSVPackedLib.sol";

contract SSVStaking is ISSVStaking, SSVReentrancyGuard {
    using ProtocolLib for StorageProtocol;
    using PackedETHLib for PackedETH;

    uint64 private constant MINIMAL_STAKING_AMOUNT = 1_000_000_000;
    uint64 private constant PRECISION = 1e18;
    uint256 private constant MAX_PENDING_REQUESTS = 2000;

    address public immutable CSSV_ADDRESS;

    constructor(address _cssv) {
        CSSV_ADDRESS = _cssv;
    }

    /**
     * @inheritdoc ISSVStaking
     */
    function syncFees() external nonReentrant {
        _syncFees(SSVStorageStaking.load());
    }

    /**
     * @inheritdoc ISSVStaking
     */
    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (amount < MINIMAL_STAKING_AMOUNT) {
            revert StakeTooLow();
        }

        StorageStaking storage s = SSVStorageStaking.load();

        _syncFees(s);
        _settle(msg.sender, s);

        if (!SSVStorage.load().token.transferFrom(msg.sender, address(this), amount)) {
            revert TokenTransferFailed();
        }

        ICSSVToken(CSSV_ADDRESS).mint(msg.sender, amount);

        emit Staked(msg.sender, amount);
    }

    /**
     * @inheritdoc ISSVStaking
     */
    function requestUnstake(uint256 amount) external nonReentrant {
        if (amount == 0) {
            revert ZeroAmount();
        }

        StorageStaking storage s = SSVStorageStaking.load();

        _syncFees(s);

        uint256 bal = ICSSVToken(CSSV_ADDRESS).balanceOf(msg.sender);
        _settleWithBalance(msg.sender, bal, s);

        if (amount > bal) {
            revert UnstakeAmountExceedsBalance();
        }

        UnstakeRequest[] storage requests = s.withdrawalRequests[msg.sender];

        if (requests.length == MAX_PENDING_REQUESTS) {
            revert MaxRequestsAmountReached();
        }

        uint64 unlockTime = uint64(block.timestamp + s.cooldownDuration);
        requests.push(UnstakeRequest({amount: uint192(amount), unlockTime: unlockTime}));

        ICSSVToken(CSSV_ADDRESS).burn(msg.sender, amount);

        emit UnstakeRequested(msg.sender, amount, unlockTime);
    }

    /**
     * @inheritdoc ISSVStaking
     */
    function withdrawUnlocked() external nonReentrant {
        StorageStaking storage s = SSVStorageStaking.load();
        uint256 amount = calculateTotalUnfrozenBalance(s);
        if (amount == 0) revert NothingToWithdraw();

        if (!SSVStorage.load().token.transfer(msg.sender, amount)) {
            revert TokenTransferFailed();
        }

        emit UnstakedWithdrawn(msg.sender, amount);
    }

    /**
     * @inheritdoc ISSVStaking
     */
    function claimEthRewards() external nonReentrant {
        StorageStaking storage s = SSVStorageStaking.load();

        _syncFees(s);
        _settle(msg.sender, s);

        uint256 claimable = s.accrued[msg.sender];
        if (claimable == 0) revert NothingToClaim();

        uint256 payout = claimable - (claimable % ETH_DEDUCTED_DIGITS);
        if (payout == 0) {
            revert NothingToClaim();
        }

        PackedETH packedPayout = PackedETHLib.pack(payout);

        StorageProtocol storage sp = SSVStorageProtocol.load();

        if (packedPayout.gt(s.stakingEthPoolBalance)) {
            revert InsufficientBalance();
        }
        if (packedPayout.gt(sp.ethDaoBalance))   {
            revert InsufficientBalance();
        }

        s.accrued[msg.sender] = claimable - payout;
        s.stakingEthPoolBalance = s.stakingEthPoolBalance.sub(packedPayout);
        sp.ethDaoBalance = sp.ethDaoBalance.sub(packedPayout);

        CoreLib.transferBalance(msg.sender, payout);
        emit RewardsClaimed(msg.sender, payout);
    }

    /**
     * @inheritdoc ISSVStaking
     */
    function rescueERC20(address token, address to, uint256 amount) external nonReentrant {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (token == address(SSVStorage.load().token) || token == CSSV_ADDRESS) {
            revert InvalidToken();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        if (!IERC20(token).transfer(to, amount)) {
            revert TokenTransferFailed();
        }

        emit ERC20Rescued(token, to, amount);
    }

    /**
     * @inheritdoc ISSVStaking
     */
    function onCSSVTransfer(address from, address to, uint256 amount) external virtual {
        if (msg.sender != CSSV_ADDRESS) revert NotCSSV();

        StorageStaking storage s = SSVStorageStaking.load();

        _syncFees(s);
        _settle(from, s);
        _settle(to, s);
    }

    function _syncFees(StorageStaking storage s) internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();

        PackedETH current = sp.networkTotalEarnings();
        sp.ethDaoBalance = current;
        sp.ethDaoIndexBlockNumber = uint32(block.number);

        PackedETH previous = s.stakingEthPoolBalance;
        if (current.lte(previous)) {
            s.stakingEthPoolBalance = current;
            return;
        }

        PackedETH packedNewFees = current.sub(previous);
        uint256 newFeesWei;

        uint256 totalStaked = ICSSVToken(CSSV_ADDRESS).totalSupply();
        if (totalStaked != 0) {
            newFeesWei = PackedETHLib.unpack(packedNewFees);
            s.accEthPerShare += uint128((newFeesWei * PRECISION) / totalStaked);
        }

        s.stakingEthPoolBalance = current;
        emit FeesSynced(newFeesWei, s.accEthPerShare);
    }

    function _settle(address user, StorageStaking storage s) internal {
        uint256 bal = ICSSVToken(CSSV_ADDRESS).balanceOf(user);
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

    function calculateTotalUnfrozenBalance(StorageStaking storage s) internal returns (uint256) {
        UnstakeRequest[] storage requests = s.withdrawalRequests[msg.sender];
        uint256 total = 0;
        uint256 i = 0;

        while (i < requests.length) {
            if (requests[i].unlockTime <= block.timestamp) {
                total += requests[i].amount;
                requests[i] = requests[requests.length - 1];
                requests.pop();
            } else {
                i++;
            }
        }
        return total;
    }
}
