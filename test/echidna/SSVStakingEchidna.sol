// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/modules/SSVStaking.sol";
import "../../contracts/libraries/storage/SSVStorageProtocol.sol";
import "../../contracts/libraries/storage/SSVStorageStaking.sol";
import "../../contracts/libraries/storage/SSVStorage.sol";
import "../../contracts/test/mocks/MockToken.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PackedETH, ETH_DEDUCTED_DIGITS} from "../../contracts/libraries/SSVCoreTypes.sol";

interface IStakingHook {
    function onCSSVTransfer(address from, address to, uint256 amount) external;
}

contract CSSVTokenMock is ERC20 {
    error NotSSVStaking();
    error ZeroAddress();

    address public immutable ssvStaking;

    modifier onlySSVStaking() {
        if (msg.sender != ssvStaking) revert NotSSVStaking();
        _;
    }

    constructor(address ssvStaking_) ERC20("cSSV", "cSSV") {
        if (ssvStaking_ == address(0)) revert ZeroAddress();
        ssvStaking = ssvStaking_;
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
        if (from != to && from != address(0) && to != address(0) && msg.sender != ssvStaking && amount > 0) {
            IStakingHook(ssvStaking).onCSSVTransfer(from, to, amount);
        }
        super._beforeTokenTransfer(from, to, amount);
    }

    function mint(address to, uint256 amount) external onlySSVStaking {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlySSVStaking {
        _burn(from, amount);
    }
}

interface IStaking {
    function stake(uint256 amount) external;
    function requestUnstake(uint256 amount) external;
    function withdrawUnlocked() external;
    function claimEthRewards() external;
}

contract StakingUser {
    IStaking public staking;
    IERC20 public token;
    IERC20 public cssv;

    constructor(IStaking staking_, IERC20 token_, IERC20 cssv_) {
        staking = staking_;
        token = token_;
        cssv = cssv_;
    }

    receive() external payable {}

    function approve(uint256 amount) external {
        token.approve(address(staking), amount);
    }

    function stake(uint256 amount) external {
        staking.stake(amount);
    }

    function requestUnstake(uint256 amount) external {
        staking.requestUnstake(amount);
    }

    function withdrawUnlocked() external {
        staking.withdrawUnlocked();
    }

    function claim() external {
        staking.claimEthRewards();
    }

    function transferCSSV(address to, uint256 amount) external {
        cssv.transfer(to, amount);
    }
}

contract SSVStakingEchidna is SSVStaking {
    using PackedETHLib for PackedETH;

    uint64 private constant MINIMAL_STAKING_AMOUNT = 1_000_000_000;
    uint256 private constant MAX_STAKE = 1_000_000 ether;
    // Mirror SSVStaking.MAX_PENDING_REQUESTS to avoid harness-only false negatives.
    uint256 private constant MAX_PENDING_REQUESTS = 2000;

    MockToken private token;
    CSSVTokenMock private cssv;

    StakingUser private user1;
    StakingUser private user2;
    StakingUser private user3;
    StakingUser private user4;

    bool private syncFeesFailed;
    bool private syncFeesMismatch;
    bool private sawDecrease;
    bool private invalidStakeSucceeded;
    bool private invalidUnstakeSucceeded;
    bool private invalidWithdrawSucceeded;
    bool private cssvSupplyDeltaMismatch;
    bool private userIndexSettleMismatch;
    bool private claimDeltaMismatch;
    bool private payoutAccountingOverflow;
    bool private transferSettleMismatch;
    bool private claimPayoutPrecisionBroken;

    uint256 private expectedCssvSupply;
    uint256 private totalEthCreditedWei;
    uint256 private totalEthPaidOutWei;

    constructor() SSVStaking(address(new CSSVTokenMock(address(this)))) {
        token = new MockToken();
        cssv = CSSVTokenMock(CSSV_ADDRESS);

        _mockSetToken(address(token));

        IStaking self = IStaking(address(this));
        user1 = new StakingUser(self, IERC20(address(token)), IERC20(address(cssv)));
        user2 = new StakingUser(self, IERC20(address(token)), IERC20(address(cssv)));
        user3 = new StakingUser(self, IERC20(address(token)), IERC20(address(cssv)));
        user4 = new StakingUser(self, IERC20(address(token)), IERC20(address(cssv)));

        _mockSetDefaultOracleIds();
        expectedCssvSupply = cssv.totalSupply();
    }

    function action_stake(uint256 seed, uint8 userSeed) external {
        StakingUser user = _user(userSeed);
        uint256 amount = _boundAmount(seed);
        uint64 beforePool = PackedETH.unwrap(SSVStorageStaking.load().stakingEthPoolBalance);
        uint256 beforeSupply = cssv.totalSupply();

        if (seed % 10 == 0) {
            amount = 0;
        } else if (seed % 10 == 1) {
            amount = MINIMAL_STAKING_AMOUNT - 1;
        }

        token.mint(address(user), amount);
        try user.approve(amount) {} catch {}

        bool invalid = amount == 0 || amount < MINIMAL_STAKING_AMOUNT;
        try user.stake(amount) {
            if (invalid) invalidStakeSucceeded = true;
            if (!invalid) {
                uint256 afterSupply = cssv.totalSupply();
                if (afterSupply != beforeSupply + amount) {
                    cssvSupplyDeltaMismatch = true;
                }
                if (expectedCssvSupply > type(uint256).max - amount) {
                    payoutAccountingOverflow = true;
                } else {
                    expectedCssvSupply += amount;
                }
                _checkSettledUser(address(user));
            }
        } catch {}
        _trackPoolCredit(beforePool, PackedETH.unwrap(SSVStorageStaking.load().stakingEthPoolBalance));
    }

    function action_request_unstake(uint256 seed, uint8 userSeed) external {
        StorageStaking storage s = SSVStorageStaking.load();
        StakingUser user = _user(userSeed);
        address userAddr = address(user);
        uint64 beforePool = PackedETH.unwrap(s.stakingEthPoolBalance);
        uint256 beforeSupply = cssv.totalSupply();

        uint256 balance = cssv.balanceOf(userAddr);
        uint256 amount;

        if (seed % 5 == 0) {
            amount = balance + 1;
        } else if (seed % 5 == 1 || balance == 0) {
            amount = 0;
        } else {
            amount = seed % (balance + 1);
            if (amount == 0) amount = 1;
        }

        uint256 requestCount = s.withdrawalRequests[userAddr].length;
        bool invalid = amount == 0 || amount > balance || requestCount >= MAX_PENDING_REQUESTS;

        try user.requestUnstake(amount) {
            if (invalid) invalidUnstakeSucceeded = true;
            if (!invalid) {
                uint256 afterSupply = cssv.totalSupply();
                if (beforeSupply < amount || afterSupply != beforeSupply - amount) {
                    cssvSupplyDeltaMismatch = true;
                }
                if (expectedCssvSupply < amount) {
                    cssvSupplyDeltaMismatch = true;
                } else {
                    expectedCssvSupply -= amount;
                }
                _checkSettledUser(userAddr);
            }
        } catch {}
        _trackPoolCredit(beforePool, PackedETH.unwrap(SSVStorageStaking.load().stakingEthPoolBalance));
    }

    function action_withdraw_unlocked(uint8 userSeed) external {
        StorageStaking storage s = SSVStorageStaking.load();
        StakingUser user = _user(userSeed);
        address userAddr = address(user);

        uint256 withdrawable = _withdrawableAmount(s, userAddr);
        try user.withdrawUnlocked() {
            if (withdrawable == 0) invalidWithdrawSucceeded = true;
        } catch {}
    }

    function action_claim_rewards(uint8 userSeed) external {
        StorageStaking storage s = SSVStorageStaking.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        StakingUser user = _user(userSeed);
        uint64 beforePool = PackedETH.unwrap(s.stakingEthPoolBalance);
        uint64 beforeDao = PackedETH.unwrap(sp.ethDaoBalance);
        uint256 beforeUserBalance = address(user).balance;
        try user.claim() {
            uint64 afterPool = PackedETH.unwrap(s.stakingEthPoolBalance);
            uint64 afterDao = PackedETH.unwrap(sp.ethDaoBalance);
            uint256 afterUserBalance = address(user).balance;
            uint256 payout = afterUserBalance - beforeUserBalance;
            if (payout % ETH_DEDUCTED_DIGITS != 0) {
                claimPayoutPrecisionBroken = true;
            }

            if (afterPool > beforePool || afterDao > beforeDao) {
                claimDeltaMismatch = true;
            } else {
                uint256 poolDeltaWei = uint256(beforePool - afterPool) * ETH_DEDUCTED_DIGITS;
                uint256 daoDeltaWei = uint256(beforeDao - afterDao) * ETH_DEDUCTED_DIGITS;
                if (poolDeltaWei != payout || daoDeltaWei != payout) {
                    claimDeltaMismatch = true;
                }
            }

            _addPaidOut(payout);
            _checkSettledUser(address(user));
        } catch {}
    }

    function action_transfer_cssv(uint256 seed, uint8 fromSeed, uint8 toSeed) external {
        StakingUser fromUser = _user(fromSeed);
        StakingUser toUser = _user(toSeed);
        if (address(fromUser) == address(toUser)) return;
        uint64 beforePool = PackedETH.unwrap(SSVStorageStaking.load().stakingEthPoolBalance);

        uint256 balance = cssv.balanceOf(address(fromUser));
        if (balance == 0) return;

        uint256 amount = (seed % balance) + 1;
        try fromUser.transferCSSV(address(toUser), amount) {} catch {}
        _trackPoolCredit(beforePool, PackedETH.unwrap(SSVStorageStaking.load().stakingEthPoolBalance));
    }

    function action_sync_fees_with_increase(uint256 seed) external {
        StorageStaking storage s = SSVStorageStaking.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint64 previous = PackedETH.unwrap(s.stakingEthPoolBalance);
        uint64 add = _boundShrunk(seed, type(uint64).max);
        if (add == 0) return;
        if (previous > type(uint64).max - add) return;
        uint64 current = previous + add;

        uint64 oldDao = PackedETH.unwrap(sp.ethDaoBalance);
        uint32 oldIndex = sp.ethDaoIndexBlockNumber;
        uint64 beforePool = PackedETH.unwrap(s.stakingEthPoolBalance);

        sp.ethDaoBalance = PackedETH.wrap(current);
        sp.ethDaoIndexBlockNumber = uint32(block.number);

        try this.syncFees() {
            if (PackedETH.unwrap(s.stakingEthPoolBalance) != current) {
                syncFeesMismatch = true;
            }
        } catch {
            syncFeesFailed = true;
            sp.ethDaoBalance = PackedETH.wrap(oldDao);
            sp.ethDaoIndexBlockNumber = oldIndex;
        }
        _trackPoolCredit(beforePool, PackedETH.unwrap(s.stakingEthPoolBalance));
    }

    function action_sync_fees_with_decrease(uint256 seed) external {
        StorageStaking storage s = SSVStorageStaking.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint64 oldPool = PackedETH.unwrap(s.stakingEthPoolBalance);
        uint64 previous = _boundShrunk(seed, type(uint64).max);
        if (previous == 0) previous = 1;
        uint64 current = previous - 1;

        uint64 oldDao = PackedETH.unwrap(sp.ethDaoBalance);
        uint32 oldIndex = sp.ethDaoIndexBlockNumber;
        uint64 beforePool = PackedETH.unwrap(s.stakingEthPoolBalance);

        s.stakingEthPoolBalance = PackedETH.wrap(previous);
        _mockSetEthDaoBalance(current);
        sawDecrease = true;

        try this.syncFees() {
            if (PackedETH.unwrap(s.stakingEthPoolBalance) != current) {
                syncFeesMismatch = true;
            }
        } catch {
            syncFeesFailed = true;
            s.stakingEthPoolBalance = PackedETH.wrap(oldPool);
            sp.ethDaoBalance = PackedETH.wrap(oldDao);
            sp.ethDaoIndexBlockNumber = oldIndex;
        }
        _trackPoolCredit(beforePool, PackedETH.unwrap(s.stakingEthPoolBalance));
    }

    function echidna_sync_fees_handles_decrease() external view returns (bool) {
        if (!sawDecrease) return true;
        return !syncFeesFailed && !syncFeesMismatch;
    }

    function echidna_sync_fees_never_fails() external view returns (bool) {
        return !syncFeesFailed && !syncFeesMismatch;
    }

    function echidna_invalid_stake_reverts() external view returns (bool) {
        return !invalidStakeSucceeded;
    }

    function echidna_invalid_unstake_reverts() external view returns (bool) {
        return !invalidUnstakeSucceeded;
    }

    function echidna_invalid_withdraw_reverts() external view returns (bool) {
        return !invalidWithdrawSucceeded;
    }

    function echidna_cssv_supply_matches_users() external view returns (bool) {
        uint256 supply = cssv.totalSupply();
        uint256 sumBalances = cssv.balanceOf(address(user1)) +
            cssv.balanceOf(address(user2)) +
            cssv.balanceOf(address(user3)) +
            cssv.balanceOf(address(user4));
        return !cssvSupplyDeltaMismatch && supply == sumBalances && supply == expectedCssvSupply;
    }

    function echidna_cssv_supply_lte_ssv_backing() external view returns (bool) {
        return cssv.totalSupply() <= token.balanceOf(address(this));
    }

    function echidna_ssv_balance_matches_staked_plus_pending() external view returns (bool) {
        StorageStaking storage s = SSVStorageStaking.load();
        uint256 pending = _totalPendingUnstake(s);
        uint256 staked = cssv.totalSupply();
        uint256 contractBalance = token.balanceOf(address(this));
        return contractBalance == staked + pending;
    }

    function echidna_pool_matches_dao_balance() external view returns (bool) {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        return !claimDeltaMismatch && SSVStorageStaking.load().stakingEthPoolBalance.eq(sp.ethDaoBalance);
    }

    function echidna_pending_requests_bounded() external view returns (bool) {
        StorageStaking storage s = SSVStorageStaking.load();
        if (s.withdrawalRequests[address(user1)].length > MAX_PENDING_REQUESTS) return false;
        if (s.withdrawalRequests[address(user2)].length > MAX_PENDING_REQUESTS) return false;
        if (s.withdrawalRequests[address(user3)].length > MAX_PENDING_REQUESTS) return false;
        if (s.withdrawalRequests[address(user4)].length > MAX_PENDING_REQUESTS) return false;
        return true;
    }

    function echidna_user_index_leq_acc() external view returns (bool) {
        if (userIndexSettleMismatch) return false;
        StorageStaking storage s = SSVStorageStaking.load();
        uint256 acc = s.accEthPerShare;
        if (s.userIndex[address(user1)] > acc) return false;
        if (s.userIndex[address(user2)] > acc) return false;
        if (s.userIndex[address(user3)] > acc) return false;
        if (s.userIndex[address(user4)] > acc) return false;
        return true;
    }

    function echidna_accrued_within_pool() external view returns (bool) {
        if (payoutAccountingOverflow || claimDeltaMismatch) return false;
        StorageStaking storage s = SSVStorageStaking.load();
        uint256 accrued = _roundedDownToPayoutPrecision(s.accrued[address(user1)]) +
            _roundedDownToPayoutPrecision(s.accrued[address(user2)]) +
            _roundedDownToPayoutPrecision(s.accrued[address(user3)]) +
            _roundedDownToPayoutPrecision(s.accrued[address(user4)]);
        uint256 poolWei = uint256(PackedETH.unwrap(SSVStorageProtocol.load().ethDaoBalance)) * ETH_DEDUCTED_DIGITS;
        if (totalEthPaidOutWei > totalEthCreditedWei) return false;
        if (accrued <= poolWei) return true;
        if (accrued > type(uint256).max - totalEthPaidOutWei) return false;
        return accrued + totalEthPaidOutWei <= totalEthCreditedWei;
    }

    function echidna_cssv_transfer_settles_both() external view returns (bool) {
        return !transferSettleMismatch;
    }

    function echidna_claim_payout_precision() external view returns (bool) {
        return !claimPayoutPrecisionBroken;
    }

    function _boundShrunk(uint256 seed, uint64 maxValue) internal pure returns (uint64) {
        if (maxValue == 0) return 0;
        return uint64(seed % (uint256(maxValue) + 1));
    }

    function _boundAmount(uint256 seed) internal pure returns (uint256) {
        uint256 amount = seed % MAX_STAKE;
        if (amount == 0) amount = 1;
        return amount;
    }

    function _user(uint8 seed) internal view returns (StakingUser) {
        uint8 idx = seed % 4;
        if (idx == 0) return user1;
        if (idx == 1) return user2;
        if (idx == 2) return user3;
        return user4;
    }

    function _withdrawableAmount(StorageStaking storage s, address user) internal view returns (uint256) {
        UnstakeRequest[] storage requests = s.withdrawalRequests[user];
        uint256 total;
        for (uint256 i; i < requests.length; ++i) {
            if (requests[i].unlockTime <= block.timestamp) {
                total += requests[i].amount;
            }
        }
        return total;
    }

    function _totalPendingUnstake(StorageStaking storage s) internal view returns (uint256) {
        return _pendingForUser(s, address(user1)) +
            _pendingForUser(s, address(user2)) +
            _pendingForUser(s, address(user3)) +
            _pendingForUser(s, address(user4));
    }

    function _pendingForUser(StorageStaking storage s, address user) internal view returns (uint256) {
        UnstakeRequest[] storage requests = s.withdrawalRequests[user];
        uint256 total;
        for (uint256 i; i < requests.length; ++i) {
            total += requests[i].amount;
        }
        return total;
    }

    function _mockSetToken(address tokenAddress) internal {
        SSVStorage.load().token = IERC20(tokenAddress);
    }

    function _mockSetDefaultOracleIds() internal {
        StorageStaking storage s = SSVStorageStaking.load();
        uint32[4] memory ids = [uint32(1), uint32(2), uint32(3), uint32(4)];
        s.defaultOracleIds = ids;
    }

    // Override to add access control check (simulating SSVNetwork.sol behavior)
    function onCSSVTransfer(address from, address to, uint256) external override {
        if (msg.sender != CSSV_ADDRESS) revert NotCSSV();
        StorageStaking storage s = SSVStorageStaking.load();

        _syncFees(s);
        _settle(from, s);
        _settle(to, s);
        _checkSettledWithStorage(s, from);
        _checkSettledWithStorage(s, to);
        if (s.userIndex[from] != s.accEthPerShare || s.userIndex[to] != s.accEthPerShare) {
            transferSettleMismatch = true;
        }
    }

    function _mockSetEthDaoBalance(uint64 balance) internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.ethDaoBalance = PackedETH.wrap(balance);
        sp.ethDaoIndexBlockNumber = uint32(block.number);
    }

    function _roundedDownToPayoutPrecision(uint256 amount) internal pure returns (uint256) {
        return amount - (amount % ETH_DEDUCTED_DIGITS);
    }

    function _checkSettledUser(address user) internal {
        _checkSettledWithStorage(SSVStorageStaking.load(), user);
    }

    function _checkSettledWithStorage(StorageStaking storage s, address user) internal {
        if (s.userIndex[user] != s.accEthPerShare) {
            userIndexSettleMismatch = true;
        }
    }

    function _trackPoolCredit(uint64 beforePoolUnits, uint64 afterPoolUnits) internal {
        if (afterPoolUnits <= beforePoolUnits) return;
        uint256 deltaWei = uint256(afterPoolUnits - beforePoolUnits) * ETH_DEDUCTED_DIGITS;
        _addCredited(deltaWei);
    }

    function _addCredited(uint256 amountWei) internal {
        if (totalEthCreditedWei > type(uint256).max - amountWei) {
            payoutAccountingOverflow = true;
            return;
        }
        totalEthCreditedWei += amountWei;
    }

    function _addPaidOut(uint256 amountWei) internal {
        if (totalEthPaidOutWei > type(uint256).max - amountWei) {
            payoutAccountingOverflow = true;
            return;
        }
        totalEthPaidOutWei += amountWei;
    }
}
