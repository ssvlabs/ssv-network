// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ISSVStaking} from "../interfaces/ISSVStaking.sol";
import {ICSSVToken} from "../interfaces/ICSSVToken.sol";
import {CoreLib} from "../libraries/CoreLib.sol";
import {ProtocolLib} from "../libraries/ProtocolLib.sol";
import {SSVStorage} from "../libraries/SSVStorage.sol";
import {SSVStorageStaking, StorageStaking, UnstakeRequest, Delegation} from "../libraries/SSVStorageStaking.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/SSVStorageProtocol.sol";
import {SSVReentrancyGuard} from "../abstract/SSVReentrancyGuard.sol";
import "../libraries/Types.sol";

contract SSVStaking is ISSVStaking, SSVReentrancyGuard {
    using ProtocolLib for StorageProtocol;
    using Types64 for uint64;
    using Types256 for uint256;

    uint64 private constant MINIMAL_STAKING_AMOUNT = 1_000_000_000;
    uint64 private constant PRECISION = 1e18;
    uint256 private constant MAX_PENDING_REQUESTS = 10;

    function syncFees() external nonReentrant {
        _syncFees(SSVStorageStaking.load());
    }

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

        // todo maybe use safeTransfer here?
        if (!SSVStorage.load().token.transferFrom(msg.sender, address(this), amount)) {
            revert TokenTransferFailed();
        }

        _createDelegation(msg.sender, amount, s);

        ICSSVToken(s.cssv).mint(msg.sender, amount);

        emit Staked(msg.sender, amount);
    }

    function requestUnstake(uint256 amount) external nonReentrant {
        if (amount == 0) {
            revert ZeroAmount();
        }

        StorageStaking storage s = SSVStorageStaking.load();
        // todo maybe use immutable
        address cssv = s.cssv;

        _syncFees(s);

        uint256 bal = ICSSVToken(cssv).balanceOf(msg.sender);
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

        _removeDelegation(msg.sender, amount, bal, s);

        ICSSVToken(cssv).burn(msg.sender, amount);

        emit UnstakeRequested(msg.sender, amount, unlockTime);
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

    function withdrawUnlocked() external nonReentrant {
        StorageStaking storage s = SSVStorageStaking.load();
        uint256 amount = calculateTotalUnfrozenBalance(s);
        if (amount == 0) revert NothingToWithdraw();

        if (!SSVStorage.load().token.transfer(msg.sender, amount)) {
            revert TokenTransferFailed();
        }

        emit UnstakedWithdrawn(msg.sender, amount);
    }

    function claimEthRewards() external nonReentrant {
        StorageStaking storage s = SSVStorageStaking.load();

        _syncFees(s);
        _settle(msg.sender, s);

        uint256 claimable = s.accrued[msg.sender];
        if (claimable == 0) revert NothingToClaim();

        uint256 payout = claimable - (claimable % DEDUCTED_DIGITS);
        if (payout == 0) {
            revert NothingToClaim();
        }

        uint64 payoutShrunk = payout.shrink();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        if (payoutShrunk > s.stakingEthPoolBalance) {
            revert InsufficientBalance();
        }
        if (payoutShrunk > sp.ethDaoBalance) {
            revert InsufficientBalance();
        }

        s.accrued[msg.sender] = claimable - payout;
        s.stakingEthPoolBalance -= payoutShrunk;
        sp.ethDaoBalance -= payoutShrunk;

        CoreLib.transferBalance(msg.sender, payout);
        emit RewardsClaimed(msg.sender, payout);
    }

    function rescueERC20(address token, address to, uint256 amount) external nonReentrant {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (token == address(SSVStorage.load().token) || token == address(SSVStorageStaking.load().cssv)) {
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

    function onCSSVTransfer(address from, address to, uint256 amount) external virtual {
        StorageStaking storage s = SSVStorageStaking.load();

        _syncFees(s);
        _settle(from, s);
        _settle(to, s);

        _transferDelegation(from, to, amount, s);
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

        uint256 totalStaked = ICSSVToken(s.cssv).totalSupply();
        if (totalStaked != 0) {
            newFeesWei = newFeesShrunk.expand();
            s.accEthPerShare += uint128((newFeesWei * PRECISION) / totalStaked);
        }

        s.stakingEthPoolBalance = current;
        emit FeesSynced(newFeesWei, s.accEthPerShare);
    }

    function _settle(address user, StorageStaking storage s) internal {
        uint256 bal = ICSSVToken(s.cssv).balanceOf(user);
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

    function _createDelegation(address user, uint256 amount, StorageStaking storage s) internal {
        if (amount == 0) return;
        Delegation storage d = s.userDelegations[user];

        if (d.oracleIds[0] == 0) {
            d.oracleIds = s.defaultOracleIds;
        }

        uint32[4] memory oracleIds = d.oracleIds;

        uint256 active;
        for (uint256 i; i < 4; ++i) {
            if (oracleIds[i] != 0) active++;
        }
        if (active == 0) return;

        uint256 baseShare = amount / active;
        uint256 remainder = amount - baseShare * active;

        for (uint256 i; i < 4; ++i) {
            uint32 oracleId = oracleIds[i];
            if (oracleId == 0) continue;

            uint256 addAmount = baseShare;
            if (remainder != 0) {
                addAmount += 1;
                --remainder;
            }

            d.amounts[i] += addAmount;
            s.oracleWeights[oracleId] += addAmount;
        }

        emit DelegationUpdated(user, d.oracleIds, d.amounts);
    }

    function _removeDelegation(address user, uint256 amount, uint256 userBalance, StorageStaking storage s) internal {
        if (amount == 0) return;
        Delegation storage d = s.userDelegations[user];
        if (d.oracleIds[0] == 0 || userBalance == 0) return;

        uint32[4] memory oracleIds = d.oracleIds;
        uint256 removed;
        uint256 idxWithMax;
        uint256 maxAmount;

        for (uint256 i; i < 4; ++i) {
            uint32 oracleId = oracleIds[i];
            if (oracleId == 0) continue;

            uint256 removeAmount = (d.amounts[i] * amount) / userBalance;
            if (removeAmount != 0) {
                d.amounts[i] -= removeAmount;
                s.oracleWeights[oracleId] -= removeAmount;
                removed += removeAmount;
            }

            if (d.amounts[i] > maxAmount) {
                maxAmount = d.amounts[i];
                idxWithMax = i;
            }
        }

        if (removed < amount && oracleIds[idxWithMax] != 0) {
            uint256 remainder = amount - removed;
            d.amounts[idxWithMax] -= remainder;
            s.oracleWeights[oracleIds[idxWithMax]] -= remainder;
        }

        emit DelegationUpdated(user, d.oracleIds, d.amounts);
    }

    function _transferDelegation(address from, address to, uint256 amount, StorageStaking storage s) internal {
        if (amount == 0 || from == to) return;

        uint256 fromBalance = ICSSVToken(s.cssv).balanceOf(from);
        if (fromBalance == 0) return;

        Delegation storage fromDel = s.userDelegations[from];
        if (fromDel.oracleIds[0] == 0) {
            fromDel.oracleIds = s.defaultOracleIds;
        }

        uint32[4] memory fromOracleIds = fromDel.oracleIds;
        uint256[4] memory fromAmounts = fromDel.amounts;
        uint256[4] memory movedAmounts;

        uint256 transferred;
        uint256 idxWithMax;
        uint256 maxAmount;

        for (uint256 i; i < 4; ++i) {
            uint32 oracleId = fromOracleIds[i];
            if (oracleId == 0) continue;

            uint256 move = (fromAmounts[i] * amount) / fromBalance;
            movedAmounts[i] = move;
            if (move != 0) {
                fromAmounts[i] -= move;
                s.oracleWeights[oracleId] -= move;
                transferred += move;
            }

            if (fromAmounts[i] > maxAmount) {
                maxAmount = fromAmounts[i];
                idxWithMax = i;
            }
        }

        if (transferred < amount && fromOracleIds[idxWithMax] != 0) {
            uint256 remainder = amount - transferred;
            movedAmounts[idxWithMax] += remainder;
            fromAmounts[idxWithMax] -= remainder;
            s.oracleWeights[fromOracleIds[idxWithMax]] -= remainder;
            transferred = amount;
        }

        fromDel.amounts = fromAmounts;

        Delegation storage toDel = s.userDelegations[to];
        if (toDel.oracleIds[0] == 0) {
            toDel.oracleIds = s.defaultOracleIds;
        }

        uint32[4] memory toOracleIds = toDel.oracleIds;
        uint256[4] memory toAmounts = toDel.amounts;

        for (uint256 i; i < 4; ++i) {
            uint32 oracleId = fromOracleIds[i];
            if (oracleId == 0) continue;

            uint256 moved = movedAmounts[i];
            if (moved == 0) continue;

            // Find matching slot or first empty slot
            uint256 targetIdx = 4;
            for (uint256 j; j < 4; ++j) {
                if (toOracleIds[j] == oracleId) {
                    targetIdx = j;
                    break;
                }
                if (targetIdx == 4 && toOracleIds[j] == 0) {
                    targetIdx = j;
                }
            }
            if (targetIdx == 4) targetIdx = 0;

            if (toOracleIds[targetIdx] == 0) {
                toOracleIds[targetIdx] = oracleId;
            }

            toAmounts[targetIdx] += moved;
            s.oracleWeights[oracleId] += moved;
        }

        toDel.oracleIds = toOracleIds;
        toDel.amounts = toAmounts;

        emit DelegationUpdated(from, fromDel.oracleIds, fromDel.amounts);
        emit DelegationUpdated(to, toDel.oracleIds, toDel.amounts);
    }
}
