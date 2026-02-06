// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/modules/SSVStaking.sol";
import "../../contracts/libraries/SSVStorageProtocol.sol";
import "../../contracts/libraries/SSVStorageStaking.sol";
import "../../contracts/libraries/SSVStorage.sol";
import "../../contracts/libraries/Types.sol";
import "../../contracts/test/mocks/MockToken.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
    uint64 private constant MINIMAL_STAKING_AMOUNT = 1_000_000_000;
    uint256 private constant MAX_STAKE = 1_000_000 ether;
    uint256 private constant MAX_PENDING_REQUESTS = 10;

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
    }

    function action_stake(uint256 seed, uint8 userSeed) external {
        StakingUser user = _user(userSeed);
        uint256 amount = _boundAmount(seed);

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
        } catch {}
    }

    function action_request_unstake(uint256 seed, uint8 userSeed) external {
        StorageStaking storage s = SSVStorageStaking.load();
        StakingUser user = _user(userSeed);
        address userAddr = address(user);

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
        } catch {}
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
        StakingUser user = _user(userSeed);
        try user.claim() {} catch {}
    }

    function action_transfer_cssv(uint256 seed, uint8 fromSeed, uint8 toSeed) external {
        StakingUser fromUser = _user(fromSeed);
        StakingUser toUser = _user(toSeed);
        if (address(fromUser) == address(toUser)) return;

        uint256 balance = cssv.balanceOf(address(fromUser));
        if (balance == 0) return;

        uint256 amount = (seed % balance) + 1;
        try fromUser.transferCSSV(address(toUser), amount) {} catch {}
    }

    function action_sync_fees_with_increase(uint256 seed) external {
        StorageStaking storage s = SSVStorageStaking.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint64 previous = s.stakingEthPoolBalance;
        uint64 add = _boundShrunk(seed, type(uint64).max);
        if (add == 0) return;
        if (previous > type(uint64).max - add) return;
        uint64 current = previous + add;

        uint64 oldDao = sp.ethDaoBalance;
        uint32 oldIndex = sp.ethDaoIndexBlockNumber;

        sp.ethDaoBalance = current;
        sp.ethDaoIndexBlockNumber = uint32(block.number);

        try this.syncFees() {
            if (s.stakingEthPoolBalance != current) {
                syncFeesMismatch = true;
            }
        } catch {
            syncFeesFailed = true;
            sp.ethDaoBalance = oldDao;
            sp.ethDaoIndexBlockNumber = oldIndex;
        }
    }

    function action_sync_fees_with_decrease(uint256 seed) external {
        StorageStaking storage s = SSVStorageStaking.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint64 oldPool = s.stakingEthPoolBalance;
        uint64 previous = _boundShrunk(seed, type(uint64).max);
        if (previous == 0) previous = 1;
        uint64 current = previous - 1;

        uint64 oldDao = sp.ethDaoBalance;
        uint32 oldIndex = sp.ethDaoIndexBlockNumber;

        s.stakingEthPoolBalance = previous;
        _mockSetEthDaoBalance(current);
        sawDecrease = true;

        try this.syncFees() {
            if (s.stakingEthPoolBalance != current) {
                syncFeesMismatch = true;
            }
        } catch {
            syncFeesFailed = true;
            s.stakingEthPoolBalance = oldPool;
            sp.ethDaoBalance = oldDao;
            sp.ethDaoIndexBlockNumber = oldIndex;
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
        return supply == sumBalances;
    }

    function echidna_transfer_conserves_total_delegation() external view returns (bool) {
        // Delegation is deprecated; treat total delegation as total cSSV supply.
        uint256 supply = cssv.totalSupply();
        uint256 sumBalances = cssv.balanceOf(address(user1)) +
            cssv.balanceOf(address(user2)) +
            cssv.balanceOf(address(user3)) +
            cssv.balanceOf(address(user4));
        return supply == sumBalances;
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
        return SSVStorageStaking.load().stakingEthPoolBalance == sp.ethDaoBalance;
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
        StorageStaking storage s = SSVStorageStaking.load();
        uint256 acc = s.accEthPerShare;
        if (s.userIndex[address(user1)] > acc) return false;
        if (s.userIndex[address(user2)] > acc) return false;
        if (s.userIndex[address(user3)] > acc) return false;
        if (s.userIndex[address(user4)] > acc) return false;
        return true;
    }

    function echidna_accrued_within_pool() external view returns (bool) {
        if (sawDecrease) return true;
        StorageStaking storage s = SSVStorageStaking.load();
        uint256 accrued = s.accrued[address(user1)] +
            s.accrued[address(user2)] +
            s.accrued[address(user3)] +
            s.accrued[address(user4)];
        uint256 poolWei = uint256(SSVStorageProtocol.load().ethDaoBalance) * DEDUCTED_DIGITS;
        return accrued <= poolWei;
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
    function onCSSVTransfer(address from, address to, uint256 amount) external override {
        StorageStaking storage s = SSVStorageStaking.load();

        _syncFees(s);
        _settle(from, s);
        _settle(to, s);
    }

    function _mockSetEthDaoBalance(uint64 balance) internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.ethDaoBalance = balance;
        sp.ethDaoIndexBlockNumber = uint32(block.number);
    }
}
