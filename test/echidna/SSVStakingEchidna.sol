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
    uint256 private constant ACCRUAL_PRECISION = 1e18;
    // Mirror SSVStaking.MAX_PENDING_REQUESTS to avoid harness-only false negatives.
    uint256 private constant MAX_PENDING_REQUESTS = 2000;
    uint256 private constant CANONICAL_TEST_STAKE = 1 ether;
    uint64 private constant MAX_REWARD_WINDOW_UNITS = 1_000_000_000;

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
    bool private transferSettleMismatch;
    bool private claimDeltaMismatch;
    bool private secondSameBlockClaimPaid;
    bool private claimPayoutPrecisionMismatch;
    bool private freeRewardsOnTransferDetected;
    bool private payoutAccountingOverflow;
    bool private unstakeStopsAccrualViolation;
    bool private dustForfeitureViolation;
    bool private zeroCssvAccrualViolation;
    bool private withdrawUnlockedBatchViolation;

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

    function action_withdraw_unlocked_batch_processing(uint256 seed, uint8 userSeed) external {
        StorageStaking storage s = SSVStorageStaking.load();

        (StakingUser user, address userAddr, bool found) = _pickUserWithoutPendingRequests(uint256(userSeed) + seed);
        if (!found) return;
        if (!_ensureBalanceAtLeast(user, CANONICAL_TEST_STAKE)) return;

        uint256[4] memory requestAmounts = [uint256(1), uint256(2), uint256(3), uint256(4)];
        uint256 totalRequested = 0;
        for (uint256 i; i < requestAmounts.length; ++i) {
            totalRequested += requestAmounts[i];
        }
        if (cssv.balanceOf(userAddr) < totalRequested) return;

        for (uint256 i; i < requestAmounts.length; ++i) {
            if (!_requestUnstakeExact(user, requestAmounts[i])) {
                return;
            }
        }

        UnstakeRequest[] storage requests = s.withdrawalRequests[userAddr];
        if (requests.length != 4) {
            withdrawUnlockedBatchViolation = true;
            return;
        }

        uint64 nowTs = uint64(block.timestamp);
        UnstakeRequest memory req0 = UnstakeRequest({amount: uint192(requestAmounts[0]), unlockTime: nowTs});
        UnstakeRequest memory req1 = UnstakeRequest({amount: uint192(requestAmounts[1]), unlockTime: nowTs + 1});
        UnstakeRequest memory req2 = UnstakeRequest({amount: uint192(requestAmounts[2]), unlockTime: nowTs});
        UnstakeRequest memory req3 = UnstakeRequest({amount: uint192(requestAmounts[3]), unlockTime: nowTs + 2});
        UnstakeRequest[4] memory expectedRequests;

        uint256 scenario = seed % 3;
        if (scenario == 0) {
            requests[0].unlockTime = req0.unlockTime;
            requests[1].unlockTime = req1.unlockTime;
            requests[2].unlockTime = req2.unlockTime;
            requests[3].unlockTime = req3.unlockTime;
            expectedRequests[0] = req0;
            expectedRequests[1] = req1;
            expectedRequests[2] = req2;
            expectedRequests[3] = req3;
        } else if (scenario == 1) {
            requests[0].unlockTime = nowTs;
            requests[1].unlockTime = nowTs;
            requests[2].unlockTime = nowTs;
            requests[3].unlockTime = nowTs;
            expectedRequests[0] = UnstakeRequest({amount: uint192(requestAmounts[0]), unlockTime: nowTs});
            expectedRequests[1] = UnstakeRequest({amount: uint192(requestAmounts[1]), unlockTime: nowTs});
            expectedRequests[2] = UnstakeRequest({amount: uint192(requestAmounts[2]), unlockTime: nowTs});
            expectedRequests[3] = UnstakeRequest({amount: uint192(requestAmounts[3]), unlockTime: nowTs});
        } else {
            requests[0].unlockTime = nowTs + 1;
            requests[1].unlockTime = nowTs + 2;
            requests[2].unlockTime = nowTs + 3;
            requests[3].unlockTime = nowTs + 4;
            expectedRequests[0] = UnstakeRequest({amount: uint192(requestAmounts[0]), unlockTime: nowTs + 1});
            expectedRequests[1] = UnstakeRequest({amount: uint192(requestAmounts[1]), unlockTime: nowTs + 2});
            expectedRequests[2] = UnstakeRequest({amount: uint192(requestAmounts[2]), unlockTime: nowTs + 3});
            expectedRequests[3] = UnstakeRequest({amount: uint192(requestAmounts[3]), unlockTime: nowTs + 4});
        }

        uint256 userTokenBefore = token.balanceOf(userAddr);
        uint256 contractTokenBefore = token.balanceOf(address(this));
        uint256 supplyBefore = cssv.totalSupply();

        if (scenario == 2) {
            try user.withdrawUnlocked() {
                invalidWithdrawSucceeded = true;
                withdrawUnlockedBatchViolation = true;
            } catch {
                if (token.balanceOf(userAddr) != userTokenBefore) {
                    withdrawUnlockedBatchViolation = true;
                }
                if (token.balanceOf(address(this)) != contractTokenBefore) {
                    withdrawUnlockedBatchViolation = true;
                }
                if (cssv.totalSupply() != supplyBefore) {
                    withdrawUnlockedBatchViolation = true;
                }
                if (!_requestsMatchFourExact(s.withdrawalRequests[userAddr], expectedRequests)) {
                    withdrawUnlockedBatchViolation = true;
                }
            }
            return;
        }

        uint256 expectedPayout = scenario == 0
            ? requestAmounts[0] + requestAmounts[2]
            : requestAmounts[0] + requestAmounts[1] + requestAmounts[2] + requestAmounts[3];

        try user.withdrawUnlocked() {
            if (token.balanceOf(userAddr) != userTokenBefore + expectedPayout) {
                withdrawUnlockedBatchViolation = true;
            }
            if (token.balanceOf(address(this)) != contractTokenBefore - expectedPayout) {
                withdrawUnlockedBatchViolation = true;
            }
            if (cssv.totalSupply() != supplyBefore) {
                withdrawUnlockedBatchViolation = true;
            }

            if (scenario == 0) {
                if (!_requestsMatchTwoAsMultiset(s.withdrawalRequests[userAddr], req1, req3)) {
                    withdrawUnlockedBatchViolation = true;
                }
            } else if (s.withdrawalRequests[userAddr].length != 0) {
                withdrawUnlockedBatchViolation = true;
            }
        } catch {
            withdrawUnlockedBatchViolation = true;
        }
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
                claimPayoutPrecisionMismatch = true;
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

            uint64 midPool = afterPool;
            uint64 midDao = afterDao;
            uint256 midUserBalance = afterUserBalance;

            try user.claim() {
                uint64 finalPool = PackedETH.unwrap(s.stakingEthPoolBalance);
                uint64 finalDao = PackedETH.unwrap(sp.ethDaoBalance);
                uint256 finalUserBalance = address(user).balance;
                if (finalPool != midPool || finalDao != midDao || finalUserBalance != midUserBalance) {
                    secondSameBlockClaimPaid = true;
                }
            } catch {}
        } catch {}
    }

    function action_transfer_cssv(uint256 seed, uint8 fromSeed, uint8 toSeed) external {
        StorageStaking storage s = SSVStorageStaking.load();
        StakingUser fromUser = _user(fromSeed);
        StakingUser toUser = _user(toSeed);
        if (address(fromUser) == address(toUser)) return;
        uint64 beforePool = PackedETH.unwrap(s.stakingEthPoolBalance);
        address from = address(fromUser);
        address to = address(toUser);
        uint256 fromBalanceBefore = cssv.balanceOf(from);
        uint256 toBalanceBefore = cssv.balanceOf(to);
        uint256 fromIdxBefore = s.userIndex[from];
        uint256 toIdxBefore = s.userIndex[to];
        uint256 fromAccruedBefore = s.accrued[from];
        uint256 toAccruedBefore = s.accrued[to];

        uint256 balance = fromBalanceBefore;
        if (balance == 0) return;

        uint256 amount = (seed % balance) + 1;
        try fromUser.transferCSSV(address(toUser), amount) {
            uint256 accAfter = s.accEthPerShare;

            if (s.userIndex[from] != accAfter || s.userIndex[to] != accAfter) {
                transferSettleMismatch = true;
            }

            uint256 fromPending;
            if (fromBalanceBefore != 0 && accAfter > fromIdxBefore) {
                fromPending = (fromBalanceBefore * (accAfter - fromIdxBefore)) / ACCRUAL_PRECISION;
            }

            uint256 toPending;
            if (toBalanceBefore != 0 && accAfter > toIdxBefore) {
                toPending = (toBalanceBefore * (accAfter - toIdxBefore)) / ACCRUAL_PRECISION;
            }

            uint256 expectedFromAccrued = fromAccruedBefore + fromPending;
            uint256 expectedToAccrued = toAccruedBefore + toPending;

            if (s.accrued[from] != expectedFromAccrued || s.accrued[to] != expectedToAccrued) {
                freeRewardsOnTransferDetected = true;
            }
        } catch {}
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

    function action_request_unstake_stops_accrual(
        uint256 unstakeSeed,
        uint256 preWindowSeed,
        uint256 postWindowSeed,
        uint256 userSeed
    ) external {
        StorageStaking storage s = SSVStorageStaking.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        StakingUser user = _user(uint8(userSeed));
        if (!_ensureBalanceAtLeast(user, CANONICAL_TEST_STAKE)) return;

        address userAddr = address(user);
        uint256 balanceBefore = cssv.balanceOf(userAddr);
        if (balanceBefore <= 1) return;
        if (s.withdrawalRequests[userAddr].length >= MAX_PENDING_REQUESTS) return;

        _setUserRewardState(userAddr, 0);
        _forceCurrentDaoBalance(s, sp);

        (bool preOk, uint256 accBefore, uint256 accAfterPre) = _creditFeeWindow(_boundRewardUnits(preWindowSeed));
        if (!preOk || accAfterPre <= accBefore) return;

        uint256 expectedAccruedAtRequest = _pendingReward(balanceBefore, accAfterPre, accBefore);
        if (expectedAccruedAtRequest == 0) return;

        uint256 beforeSupply = cssv.totalSupply();
        uint256 unstakeAmount = (unstakeSeed % (balanceBefore - 1)) + 1;
        uint256 poolBeforeRequest = uint256(PackedETH.unwrap(s.stakingEthPoolBalance)) * ETH_DEDUCTED_DIGITS;

        try user.requestUnstake(unstakeAmount) {
            uint256 remainingBalance = cssv.balanceOf(userAddr);
            if (remainingBalance != balanceBefore - unstakeAmount) {
                unstakeStopsAccrualViolation = true;
            }
            if (s.userIndex[userAddr] != accAfterPre) {
                unstakeStopsAccrualViolation = true;
            }
            if (s.accrued[userAddr] != expectedAccruedAtRequest) {
                unstakeStopsAccrualViolation = true;
            }
            if (cssv.totalSupply() != beforeSupply - unstakeAmount) {
                cssvSupplyDeltaMismatch = true;
            }
            if (expectedCssvSupply < unstakeAmount) {
                cssvSupplyDeltaMismatch = true;
            } else {
                expectedCssvSupply -= unstakeAmount;
            }
            if (uint256(PackedETH.unwrap(s.stakingEthPoolBalance)) * ETH_DEDUCTED_DIGITS != poolBeforeRequest) {
                unstakeStopsAccrualViolation = true;
            }

            (bool postOk, , uint256 accAfterPost) = _creditFeeWindow(_boundRewardUnits(postWindowSeed));
            if (!postOk || accAfterPost <= accAfterPre) return;

            uint256 expectedPostRequestPending = _pendingReward(remainingBalance, accAfterPost, accAfterPre);
            uint256 wrongPostRequestPending = _pendingReward(balanceBefore, accAfterPost, accAfterPre);
            uint256 expectedTotalAccrued = expectedAccruedAtRequest + expectedPostRequestPending;
            uint256 wrongTotalAccrued = expectedAccruedAtRequest + wrongPostRequestPending;

            uint256 expectedPayout = _roundedDownToPayoutPrecision(expectedTotalAccrued);
            uint256 wrongPayout = _roundedDownToPayoutPrecision(wrongTotalAccrued);
            uint256 expectedRemainder = expectedTotalAccrued - expectedPayout;
            uint256 wrongRemainder = wrongTotalAccrued - wrongPayout;
            if (expectedPayout == 0) return;

            uint64 poolBeforeClaimUnits = PackedETH.unwrap(s.stakingEthPoolBalance);
            uint64 daoBeforeClaimUnits = PackedETH.unwrap(sp.ethDaoBalance);
            uint64 payoutUnits = uint64(expectedPayout / ETH_DEDUCTED_DIGITS);
            if (
                payoutUnits > poolBeforeClaimUnits ||
                payoutUnits > daoBeforeClaimUnits ||
                expectedPayout > address(this).balance
            ) {
                return;
            }

            uint256 userEthBefore = userAddr.balance;
            try user.claim() {
                uint256 actualPayout = userAddr.balance - userEthBefore;
                if (actualPayout != expectedPayout) {
                    unstakeStopsAccrualViolation = true;
                }
                if (s.accrued[userAddr] != expectedRemainder) {
                    unstakeStopsAccrualViolation = true;
                }
                if (s.userIndex[userAddr] != accAfterPost) {
                    unstakeStopsAccrualViolation = true;
                }
                if (PackedETH.unwrap(s.stakingEthPoolBalance) != poolBeforeClaimUnits - payoutUnits) {
                    unstakeStopsAccrualViolation = true;
                }
                if (PackedETH.unwrap(sp.ethDaoBalance) != daoBeforeClaimUnits - payoutUnits) {
                    unstakeStopsAccrualViolation = true;
                }
                if (
                    wrongTotalAccrued != expectedTotalAccrued &&
                    actualPayout == wrongPayout &&
                    s.accrued[userAddr] == wrongRemainder
                ) {
                    unstakeStopsAccrualViolation = true;
                }
                _addPaidOut(actualPayout);
            } catch {
                unstakeStopsAccrualViolation = true;
            }
        } catch {}
    }

    function action_claim_dust_zero_balance(uint256 dustSeed, uint256 userSeed) external {
        StorageStaking storage s = SSVStorageStaking.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        (StakingUser user, address userAddr, bool found) = _pickZeroCssvUser(userSeed);
        if (!found) return;

        uint256 dust = _boundDust(dustSeed);
        _setUserRewardState(userAddr, dust);
        _forceCurrentDaoBalance(s, sp);

        uint256 accruedBefore = s.accrued[userAddr];
        uint256 indexBefore = s.userIndex[userAddr];
        uint64 poolBefore = PackedETH.unwrap(s.stakingEthPoolBalance);
        uint64 daoBefore = PackedETH.unwrap(sp.ethDaoBalance);
        uint256 ethBefore = userAddr.balance;

        try user.claim() {
            if (s.accrued[userAddr] != 0) {
                dustForfeitureViolation = true;
            }
            if (s.userIndex[userAddr] != indexBefore) {
                dustForfeitureViolation = true;
            }
            if (PackedETH.unwrap(s.stakingEthPoolBalance) != poolBefore) {
                dustForfeitureViolation = true;
            }
            if (PackedETH.unwrap(sp.ethDaoBalance) != daoBefore) {
                dustForfeitureViolation = true;
            }
            if (userAddr.balance != ethBefore) {
                dustForfeitureViolation = true;
            }
            if (accruedBefore != dust) {
                dustForfeitureViolation = true;
            }
        } catch {
            dustForfeitureViolation = true;
        }
    }

    function action_claim_dust_positive_balance(uint256 dustSeed, uint256 userSeed) external {
        StorageStaking storage s = SSVStorageStaking.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        StakingUser user = _user(uint8(userSeed));
        if (!_ensureBalanceAtLeast(user, CANONICAL_TEST_STAKE)) return;

        address userAddr = address(user);
        uint256 dust = _boundDust(dustSeed);
        _setUserRewardState(userAddr, dust);
        _forceCurrentDaoBalance(s, sp);

        uint256 accruedBefore = s.accrued[userAddr];
        uint256 indexBefore = s.userIndex[userAddr];
        uint64 poolBefore = PackedETH.unwrap(s.stakingEthPoolBalance);
        uint64 daoBefore = PackedETH.unwrap(sp.ethDaoBalance);
        uint256 cssvBefore = cssv.balanceOf(userAddr);
        uint256 ethBefore = userAddr.balance;

        try user.claim() {
            dustForfeitureViolation = true;
        } catch {
            if (s.accrued[userAddr] != accruedBefore) {
                dustForfeitureViolation = true;
            }
            if (s.userIndex[userAddr] != indexBefore) {
                dustForfeitureViolation = true;
            }
            if (PackedETH.unwrap(s.stakingEthPoolBalance) != poolBefore) {
                dustForfeitureViolation = true;
            }
            if (PackedETH.unwrap(sp.ethDaoBalance) != daoBefore) {
                dustForfeitureViolation = true;
            }
            if (cssv.balanceOf(userAddr) != cssvBefore) {
                dustForfeitureViolation = true;
            }
            if (userAddr.balance != ethBefore) {
                dustForfeitureViolation = true;
            }
        }
    }

    function action_zero_cssv_no_accrual(
        uint256 zeroWindowSeed,
        uint256 postWindowSeed,
        uint256 userSeed
    ) external {
        StorageStaking storage s = SSVStorageStaking.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        (StakingUser targetUser, address targetAddr, bool found) = _pickZeroCssvUser(userSeed);
        if (!found) return;

        (StakingUser supportUser, , bool distinctFound) = _pickDistinctUser(targetAddr, userSeed + 1);
        if (!distinctFound) return;
        if (!_ensureBalanceAtLeast(supportUser, CANONICAL_TEST_STAKE)) return;

        _setUserRewardState(targetAddr, 0);
        _forceCurrentDaoBalance(s, sp);

        uint256 accBeforeZeroWindow = s.accEthPerShare;
        (bool zeroOk, , uint256 accAfterZeroWindow) = _creditFeeWindow(_boundRewardUnits(zeroWindowSeed));
        if (!zeroOk || accAfterZeroWindow <= accBeforeZeroWindow) return;

        if (!_stakeExact(targetUser, CANONICAL_TEST_STAKE)) return;

        uint256 targetBalance = cssv.balanceOf(targetAddr);
        if (targetBalance == 0) return;
        if (s.userIndex[targetAddr] != accAfterZeroWindow) {
            zeroCssvAccrualViolation = true;
        }
        if (s.accrued[targetAddr] != 0) {
            zeroCssvAccrualViolation = true;
        }

        (bool postOk, , uint256 accAfterPostWindow) = _creditFeeWindow(_boundRewardUnits(postWindowSeed));
        if (!postOk || accAfterPostWindow <= accAfterZeroWindow) return;

        uint256 expectedPostStakeAccrued = _pendingReward(targetBalance, accAfterPostWindow, accAfterZeroWindow);
        uint256 wrongTotalAccrued = _pendingReward(targetBalance, accAfterPostWindow, accBeforeZeroWindow);
        uint256 expectedPayout = _roundedDownToPayoutPrecision(expectedPostStakeAccrued);
        uint256 wrongPayout = _roundedDownToPayoutPrecision(wrongTotalAccrued);
        uint256 expectedRemainder = expectedPostStakeAccrued - expectedPayout;
        uint256 wrongRemainder = wrongTotalAccrued - wrongPayout;
        if (expectedPayout == 0) return;

        uint64 poolBeforeClaimUnits = PackedETH.unwrap(s.stakingEthPoolBalance);
        uint64 daoBeforeClaimUnits = PackedETH.unwrap(sp.ethDaoBalance);
        uint64 payoutUnits = uint64(expectedPayout / ETH_DEDUCTED_DIGITS);
        if (
            payoutUnits > poolBeforeClaimUnits ||
            payoutUnits > daoBeforeClaimUnits ||
            expectedPayout > address(this).balance
        ) {
            return;
        }

        uint256 ethBefore = targetAddr.balance;
        try targetUser.claim() {
            uint256 actualPayout = targetAddr.balance - ethBefore;
            if (actualPayout != expectedPayout) {
                zeroCssvAccrualViolation = true;
            }
            if (s.accrued[targetAddr] != expectedRemainder) {
                zeroCssvAccrualViolation = true;
            }
            if (s.userIndex[targetAddr] != accAfterPostWindow) {
                zeroCssvAccrualViolation = true;
            }
            if (PackedETH.unwrap(s.stakingEthPoolBalance) != poolBeforeClaimUnits - payoutUnits) {
                zeroCssvAccrualViolation = true;
            }
            if (PackedETH.unwrap(sp.ethDaoBalance) != daoBeforeClaimUnits - payoutUnits) {
                zeroCssvAccrualViolation = true;
            }
            if (
                wrongTotalAccrued != expectedPostStakeAccrued &&
                actualPayout == wrongPayout &&
                s.accrued[targetAddr] == wrongRemainder
            ) {
                zeroCssvAccrualViolation = true;
            }
            _addPaidOut(actualPayout);
        } catch {
            zeroCssvAccrualViolation = true;
        }
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

    function echidna_claim_twice_same_block_no_second_payout() external view returns (bool) {
        return !secondSameBlockClaimPaid;
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
        return !claimPayoutPrecisionMismatch;
    }

    function echidna_no_free_rewards_on_transfer() external view returns (bool) {
        return !freeRewardsOnTransferDetected;
    }

    function echidna_unstake_stops_accrual() external view returns (bool) {
        return !unstakeStopsAccrualViolation;
    }

    function echidna_dust_forfeiture_correct() external view returns (bool) {
        return !dustForfeitureViolation;
    }

    function echidna_zero_cssv_no_accrual() external view returns (bool) {
        return !zeroCssvAccrualViolation;
    }

    function echidna_withdraw_unlocked_batch_correct() external view returns (bool) {
        return !withdrawUnlockedBatchViolation;
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

    function _boundRewardUnits(uint256 seed) internal pure returns (uint64) {
        return uint64(seed % MAX_REWARD_WINDOW_UNITS) + 1;
    }

    function _boundDust(uint256 seed) internal pure returns (uint256) {
        return (seed % (ETH_DEDUCTED_DIGITS - 1)) + 1;
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
    }

    function _mockSetEthDaoBalance(uint64 balance) internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.ethDaoBalance = PackedETH.wrap(balance);
        sp.ethDaoIndexBlockNumber = uint32(block.number);
    }

    function _forceCurrentDaoBalance(StorageStaking storage s, StorageProtocol storage sp) internal {
        sp.ethDaoBalance = s.stakingEthPoolBalance;
        sp.ethDaoIndexBlockNumber = uint32(block.number);
    }

    function _setUserRewardState(address user, uint256 accruedAmount) internal {
        StorageStaking storage s = SSVStorageStaking.load();
        s.userIndex[user] = s.accEthPerShare;
        s.accrued[user] = accruedAmount;
    }

    function _pendingReward(uint256 balance, uint256 idxAfter, uint256 idxBefore) internal pure returns (uint256) {
        if (balance == 0 || idxAfter <= idxBefore) return 0;
        return (balance * (idxAfter - idxBefore)) / ACCRUAL_PRECISION;
    }

    function _creditFeeWindow(uint64 addUnits) internal returns (bool ok, uint256 accBefore, uint256 accAfter) {
        StorageStaking storage s = SSVStorageStaking.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        if (addUnits == 0) return (false, 0, 0);

        uint64 beforePool = PackedETH.unwrap(s.stakingEthPoolBalance);
        if (beforePool > type(uint64).max - addUnits) return (false, 0, 0);

        uint64 oldDao = PackedETH.unwrap(sp.ethDaoBalance);
        uint32 oldIndex = sp.ethDaoIndexBlockNumber;
        uint64 targetPool = beforePool + addUnits;
        accBefore = s.accEthPerShare;

        sp.ethDaoBalance = PackedETH.wrap(targetPool);
        sp.ethDaoIndexBlockNumber = uint32(block.number);

        try this.syncFees() {
            uint64 afterPool = PackedETH.unwrap(s.stakingEthPoolBalance);
            if (afterPool != targetPool) {
                syncFeesMismatch = true;
                return (false, accBefore, s.accEthPerShare);
            }
            _trackPoolCredit(beforePool, afterPool);
            return (true, accBefore, s.accEthPerShare);
        } catch {
            syncFeesFailed = true;
            sp.ethDaoBalance = PackedETH.wrap(oldDao);
            sp.ethDaoIndexBlockNumber = oldIndex;
            return (false, accBefore, accBefore);
        }
    }

    function _stakeExact(StakingUser user, uint256 amount) internal returns (bool) {
        if (amount < MINIMAL_STAKING_AMOUNT) return false;

        StorageStaking storage s = SSVStorageStaking.load();
        uint64 beforePool = PackedETH.unwrap(s.stakingEthPoolBalance);
        uint256 beforeSupply = cssv.totalSupply();

        token.mint(address(user), amount);
        try user.approve(amount) {} catch {
            return false;
        }

        try user.stake(amount) {
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
            _trackPoolCredit(beforePool, PackedETH.unwrap(s.stakingEthPoolBalance));
            return true;
        } catch {
            return false;
        }
    }

    function _requestUnstakeExact(StakingUser user, uint256 amount) internal returns (bool) {
        if (amount == 0) return false;

        StorageStaking storage s = SSVStorageStaking.load();
        address userAddr = address(user);
        if (cssv.balanceOf(userAddr) < amount) return false;
        if (s.withdrawalRequests[userAddr].length >= MAX_PENDING_REQUESTS) return false;

        uint64 beforePool = PackedETH.unwrap(s.stakingEthPoolBalance);
        uint256 beforeSupply = cssv.totalSupply();

        try user.requestUnstake(amount) {
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
            _trackPoolCredit(beforePool, PackedETH.unwrap(s.stakingEthPoolBalance));
            return true;
        } catch {
            return false;
        }
    }

    function _ensureBalanceAtLeast(StakingUser user, uint256 targetBalance) internal returns (bool) {
        uint256 balance = cssv.balanceOf(address(user));
        if (balance >= targetBalance) return true;

        uint256 deficit = targetBalance - balance;
        if (deficit < MINIMAL_STAKING_AMOUNT) {
            deficit = MINIMAL_STAKING_AMOUNT;
        }
        return _stakeExact(user, deficit);
    }

    function _pickZeroCssvUser(
        uint256 seed
    ) internal view returns (StakingUser user, address userAddr, bool found) {
        for (uint256 i; i < 4; ++i) {
            user = _user(uint8((seed + i) % 4));
            userAddr = address(user);
            if (cssv.balanceOf(userAddr) == 0) {
                return (user, userAddr, true);
            }
        }

        return (user1, address(user1), false);
    }

    function _pickDistinctUser(
        address excluded,
        uint256 seed
    ) internal view returns (StakingUser user, address userAddr, bool found) {
        for (uint256 i; i < 4; ++i) {
            user = _user(uint8((seed + i) % 4));
            userAddr = address(user);
            if (userAddr != excluded) {
                return (user, userAddr, true);
            }
        }

        return (user1, address(user1), false);
    }

    function _pickUserWithoutPendingRequests(
        uint256 seed
    ) internal view returns (StakingUser user, address userAddr, bool found) {
        StorageStaking storage s = SSVStorageStaking.load();
        for (uint256 i; i < 4; ++i) {
            user = _user(uint8((seed + i) % 4));
            userAddr = address(user);
            if (s.withdrawalRequests[userAddr].length == 0) {
                return (user, userAddr, true);
            }
        }

        return (user1, address(user1), false);
    }

    function _roundedDownToPayoutPrecision(uint256 amount) internal pure returns (uint256) {
        return amount - (amount % ETH_DEDUCTED_DIGITS);
    }

    function _requestsMatchTwoAsMultiset(
        UnstakeRequest[] storage requests,
        UnstakeRequest memory expectedA,
        UnstakeRequest memory expectedB
    ) internal view returns (bool) {
        if (requests.length != 2) return false;

        bool direct = requests[0].amount == expectedA.amount && requests[0].unlockTime == expectedA.unlockTime
            && requests[1].amount == expectedB.amount && requests[1].unlockTime == expectedB.unlockTime;
        bool swapped = requests[0].amount == expectedB.amount && requests[0].unlockTime == expectedB.unlockTime
            && requests[1].amount == expectedA.amount && requests[1].unlockTime == expectedA.unlockTime;

        return direct || swapped;
    }

    function _requestsMatchFourExact(
        UnstakeRequest[] storage storedRequests,
        UnstakeRequest[4] memory expectedRequests
    ) internal view returns (bool) {
        if (storedRequests.length != expectedRequests.length) return false;

        uint256 count = storedRequests.length;
        for (uint256 i; i < count; ++i) {
            if (storedRequests[i].amount != expectedRequests[i].amount) return false;
            if (storedRequests[i].unlockTime != expectedRequests[i].unlockTime) return false;
        }

        return true;
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
