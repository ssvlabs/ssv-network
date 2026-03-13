// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/interfaces/ISSVDAO.sol";
import "../../contracts/libraries/storage/SSVStorage.sol";
import "../../contracts/libraries/storage/SSVStorageEB.sol";
import "../../contracts/libraries/storage/SSVStorageProtocol.sol";
import "../../contracts/libraries/storage/SSVStorageStaking.sol";
import "../../contracts/modules/SSVDAO.sol";
import "../../contracts/test/mocks/MockToken.sol";
import "./SSVStakingEchidna.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PackedETH, PackedSSV, DEDUCTED_DIGITS, ETH_DEDUCTED_DIGITS} from "../../contracts/libraries/SSVCoreTypes.sol";

contract DAOUser {
    ISSVDAO public dao;

    constructor(ISSVDAO dao_) {
        dao = dao_;
    }

    function withdraw(uint256 amount) external {
        dao.withdrawNetworkSSVEarnings(amount);
    }
}

contract OracleUser {
    ISSVDAO public dao;

    constructor(ISSVDAO dao_) {
        dao = dao_;
    }

    function commitRoot(bytes32 root, uint64 blockNum) external {
        dao.commitRoot(root, blockNum);
    }
}

contract SSVDAOEchidna is SSVDAO {
    uint64 private constant MINIMAL_LIQUIDATION_THRESHOLD = 21_480;
    uint64 private constant MAX_FEE_UNITS = 1_000_000;
    uint64 private constant MAX_PERIOD = 1_000_000;
    uint16 private constant MAX_QUORUM_BPS = 10_000;

    MockToken private token;

    DAOUser private user1;
    DAOUser private user2;

    OracleUser private oracle1;
    OracleUser private oracle2;
    OracleUser private oracle3;
    OracleUser private candidate1;
    OracleUser private candidate2;
    OracleUser private attacker;

    uint64 private lastCommittedBlock;

    bytes32 private lastCommitRoot;
    uint64 private lastCommitBlock;
    OracleUser private lastCommitOracle;

    mapping(bytes32 => mapping(uint32 => bool)) private localVotes;

    bool private nonOracleCommitSucceeded;
    bool private duplicateVoteSucceeded;
    bool private staleCommitSucceeded;
    bool private futureCommitSucceeded;
    bool private overWithdrawSucceeded;
    bool private withdrawMismatch;
    bool private feeIndexDecreased;

    uint256 private prevEthFeeCurrentIndex;
    uint256 private prevSsvFeeCurrentIndex;
    bool private feeIndexTrackingInitialized;

    modifier trackFeeIndexMonotonicity() {
        _checkpointNetworkFeeIndices();
        _;
        _checkpointNetworkFeeIndices();
    }

    constructor() SSVDAO(address(new CSSVTokenMock(address(this)))) {
        token = new MockToken();

        ISSVDAO self = ISSVDAO(address(this));
        user1 = new DAOUser(self);
        user2 = new DAOUser(self);

        oracle1 = new OracleUser(self);
        oracle2 = new OracleUser(self);
        oracle3 = new OracleUser(self);
        candidate1 = new OracleUser(self);
        candidate2 = new OracleUser(self);
        attacker = new OracleUser(self);

        _mockSetToken(address(token));

        token.mint(address(user1), 1000 ether);

        _mockSetOracle(1, address(oracle1));
        _mockSetOracle(2, address(oracle2));
        _mockSetOracle(3, address(oracle3));

        _mockSetQuorumBps(7500);
        _checkpointNetworkFeeIndices();
    }

    function action_update_network_fee(uint256 seed) external trackFeeIndexMonotonicity {
        uint64 feeUnits = _boundShrunk(seed, MAX_FEE_UNITS);
        uint256 fee = uint256(feeUnits) * ETH_DEDUCTED_DIGITS;
        try this.updateNetworkFee(fee) {} catch {}
    }

    function action_update_network_fee_ssv(uint256 seed) external trackFeeIndexMonotonicity {
        uint64 feeUnits = _boundShrunk(seed, MAX_FEE_UNITS);
        uint256 fee = uint256(feeUnits) * DEDUCTED_DIGITS;
        try this.updateNetworkFeeSSV(fee) {} catch {}
    }

    function action_update_operator_fee_increase(uint64 percentage) external trackFeeIndexMonotonicity {
        uint64 value = percentage % (MAX_FEE_UNITS + 1);
        try this.updateOperatorFeeIncreaseLimit(value) {} catch {}
    }

    function action_update_declare_period(uint64 secondsPeriod) external trackFeeIndexMonotonicity {
        uint64 value = secondsPeriod % (MAX_PERIOD + 1);
        try this.updateDeclareOperatorFeePeriod(value) {} catch {}
    }

    function action_update_execute_period(uint64 secondsPeriod) external trackFeeIndexMonotonicity {
        uint64 value = secondsPeriod % (MAX_PERIOD + 1);
        try this.updateExecuteOperatorFeePeriod(value) {} catch {}
    }

    function action_update_liquidation_threshold(uint64 blocksPeriod) external trackFeeIndexMonotonicity {
        uint64 value = MINIMAL_LIQUIDATION_THRESHOLD + (blocksPeriod % 10_000);
        try this.updateLiquidationThresholdPeriod(value) {} catch {}
    }

    function action_update_liquidation_threshold_ssv(uint64 blocksPeriod) external trackFeeIndexMonotonicity {
        uint64 value = MINIMAL_LIQUIDATION_THRESHOLD + (blocksPeriod % 10_000);
        try this.updateLiquidationThresholdPeriodSSV(value) {} catch {}
    }

    function action_update_min_liquidation_collateral(uint256 seed) external trackFeeIndexMonotonicity {
        uint64 value = _boundShrunk(seed, MAX_FEE_UNITS);
        uint256 amount = uint256(value) * ETH_DEDUCTED_DIGITS;
        try this.updateMinimumLiquidationCollateral(amount) {} catch {}
    }

    function action_update_min_liquidation_collateral_ssv(uint256 seed) external trackFeeIndexMonotonicity {
        uint64 value = _boundShrunk(seed, MAX_FEE_UNITS);
        uint256 amount = uint256(value) * DEDUCTED_DIGITS;
        try this.updateMinimumLiquidationCollateralSSV(amount) {} catch {}
    }

    function action_update_max_operator_fee(uint64 maxFee) external trackFeeIndexMonotonicity {
        uint64 value = maxFee;
        try this.updateMaximumOperatorFee(value) {} catch {}
    }

    function action_update_min_operator_eth_fee(uint64 minFee) external trackFeeIndexMonotonicity {
        uint64 value = minFee;
        try this.updateMinimumOperatorEthFee(value) {} catch {}
    }

    function action_set_quorum(uint16 quorum) external trackFeeIndexMonotonicity {
        uint16 value = uint16(uint256(quorum) % (MAX_QUORUM_BPS + 1));
        try this.setQuorumBps(value) {} catch {}
    }

    function action_set_cooldown(uint64 duration) external trackFeeIndexMonotonicity {
        uint64 value = duration;
        try this.setUnstakeCooldownDuration(value) {} catch {}
    }

    function action_replace_oracle(uint8 oracleIdSeed, uint8 newOracleSeed) external trackFeeIndexMonotonicity {
        uint32 oracleId = uint32(oracleIdSeed % 3) + 1;
        address newOracle = _oracleAddressBySeed(newOracleSeed);
        try this.replaceOracle(oracleId, newOracle) {} catch {}
    }

    function action_add_earnings(uint256 seed) external trackFeeIndexMonotonicity {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 currentBalance = PackedSSV.unwrap(sp.daoBalance);
        uint64 maxAdd = type(uint64).max - currentBalance;
        uint64 addUnits = _boundShrunk(seed, maxAdd);
        if (addUnits == 0) return;
        uint256 amount = uint256(addUnits) * DEDUCTED_DIGITS;

        token.mint(address(this), amount);

        sp.daoBalance = PackedSSV.wrap(currentBalance + addUnits);
        sp.daoIndexBlockNumber = uint32(block.number);
    }

    function action_withdraw(uint256 seed, uint8 userSeed) external trackFeeIndexMonotonicity {
        uint64 available = PackedSSV.unwrap(SSVStorageProtocol.load().daoBalance);
        uint64 amountUnits;

        if (seed % 5 == 0) {
            amountUnits = available + 1;
        } else if (available == 0) {
            amountUnits = 0;
        } else {
            amountUnits = uint64(seed % (available + 1));
        }

        uint256 amount = uint256(amountUnits) * DEDUCTED_DIGITS;
        DAOUser caller = _withdrawUser(userSeed);

        uint256 beforeToken = token.balanceOf(address(this));
        uint64 beforeDao = PackedSSV.unwrap(SSVStorageProtocol.load().daoBalance);

        try caller.withdraw(amount) {
            if (amountUnits > available) {
                overWithdrawSucceeded = true;
                return;
            }

            uint256 afterToken = token.balanceOf(address(this));
            uint64 afterDao = PackedSSV.unwrap(SSVStorageProtocol.load().daoBalance);

            if (afterDao != beforeDao - amountUnits) withdrawMismatch = true;
            if (afterToken != beforeToken - amount) withdrawMismatch = true;
        } catch {}
    }

    function action_commit_root(uint256 seed, uint8 oracleSeed) external trackFeeIndexMonotonicity {
        OracleUser oracle = _oracleUser(oracleSeed);
        uint64 blockNum = _validBlock(seed);
        bytes32 root = _makeRoot(seed, oracleSeed);
        _attemptCommit(oracle, root, blockNum);
    }

    function action_commit_root_stale(uint8 oracleSeed) external trackFeeIndexMonotonicity {
        OracleUser oracle = _oracleUser(oracleSeed);
        uint64 blockNum = SSVStorageEB.load().latestCommittedBlock;
        bytes32 root = _makeRoot(uint256(blockNum), oracleSeed);
        _attemptCommit(oracle, root, blockNum);
    }

    function action_commit_root_future(uint256 seed, uint8 oracleSeed) external trackFeeIndexMonotonicity {
        OracleUser oracle = _oracleUser(oracleSeed);
        uint64 blockNum = uint64(block.number) + 1 + uint64(seed % 10);
        bytes32 root = _makeRoot(seed, oracleSeed);
        _attemptCommit(oracle, root, blockNum);
    }

    function action_commit_root_non_oracle(uint256 seed) external trackFeeIndexMonotonicity {
        uint64 blockNum = _validBlock(seed);
        bytes32 root = _makeRoot(seed, 99);
        _attemptCommit(attacker, root, blockNum);
    }

    function action_commit_root_duplicate(uint8) external trackFeeIndexMonotonicity {
        if (lastCommitBlock == 0) return;
        if (address(lastCommitOracle) == address(0)) return;
        _attemptCommit(lastCommitOracle, lastCommitRoot, lastCommitBlock);
    }

    function echidna_network_fee_matches_expected() external view returns (bool) {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        if (feeIndexDecreased) return false;
        if (sp.ethNetworkFeeIndexBlockNumber > block.number) return false;
        uint256 diff = block.number - sp.ethNetworkFeeIndexBlockNumber;
        uint256 currentIndex = uint256(sp.ethNetworkFeeIndex) + diff * uint256(PackedETH.unwrap(sp.ethNetworkFee));
        if (currentIndex < sp.ethNetworkFeeIndex) return false;
        return currentIndex >= prevEthFeeCurrentIndex;
    }

    function echidna_network_fee_ssv_matches_expected() external view returns (bool) {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        if (feeIndexDecreased) return false;
        if (sp.networkFeeIndexBlockNumber > block.number) return false;
        uint256 diff = block.number - sp.networkFeeIndexBlockNumber;
        uint256 currentIndex = uint256(sp.networkFeeIndex) + diff * uint256(PackedSSV.unwrap(sp.networkFee));
        if (currentIndex < sp.networkFeeIndex) return false;
        return currentIndex >= prevSsvFeeCurrentIndex;
    }

    function echidna_liquidation_thresholds_valid() external view returns (bool) {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        if (sp.minimumBlocksBeforeLiquidation != 0 && sp.minimumBlocksBeforeLiquidation < MINIMAL_LIQUIDATION_THRESHOLD) {
            return false;
        }
        if (
            sp.minimumBlocksBeforeLiquidationSSV != 0 &&
            sp.minimumBlocksBeforeLiquidationSSV < MINIMAL_LIQUIDATION_THRESHOLD
        ) {
            return false;
        }
        return true;
    }

    function echidna_quorum_bps_valid() external view returns (bool) {
        return SSVStorageStaking.load().quorumBps <= MAX_QUORUM_BPS;
    }

    function echidna_dao_balance_matches_expected() external view returns (bool) {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        return token.balanceOf(address(this)) == uint256(PackedSSV.unwrap(sp.daoBalance)) * DEDUCTED_DIGITS;
    }

    function echidna_withdraw_limits_enforced() external view returns (bool) {
        return !overWithdrawSucceeded;
    }

    function echidna_withdraw_conserves_balance() external view returns (bool) {
        return !withdrawMismatch;
    }

    function echidna_commit_root_only_oracle() external view returns (bool) {
        return !nonOracleCommitSucceeded;
    }

    function echidna_commit_root_no_duplicate_votes() external view returns (bool) {
        return !duplicateVoteSucceeded;
    }

    function echidna_commit_root_not_future() external view returns (bool) {
        return !futureCommitSucceeded;
    }

    function echidna_commit_root_not_stale() external view returns (bool) {
        return !staleCommitSucceeded;
    }

    function echidna_committed_block_monotonic() external view returns (bool) {
        return SSVStorageEB.load().latestCommittedBlock >= lastCommittedBlock &&
            SSVStorageEB.load().latestCommittedBlock <= block.number;
    }

    function echidna_oracle_mapping_consistent() external view returns (bool) {
        StorageStaking storage s = SSVStorageStaking.load();
        address addr1 = s.oracles[1];
        address addr2 = s.oracles[2];
        address addr3 = s.oracles[3];

        if (addr1 != address(0) && s.oracleIdOf[addr1] != 1) return false;
        if (addr2 != address(0) && s.oracleIdOf[addr2] != 2) return false;
        if (addr3 != address(0) && s.oracleIdOf[addr3] != 3) return false;

        if (addr1 != address(0) && addr1 == addr2) return false;
        if (addr1 != address(0) && addr1 == addr3) return false;
        if (addr2 != address(0) && addr2 == addr3) return false;

        return true;
    }

    function _attemptCommit(OracleUser oracle, bytes32 root, uint64 blockNum) internal {
        StorageStaking storage s = SSVStorageStaking.load();
        uint32 oracleId = s.oracleIdOf[address(oracle)];
        bytes32 commitmentKey = keccak256(abi.encodePacked(blockNum, root));
        bool alreadyVoted = localVotes[commitmentKey][oracleId];

        uint64 latestBefore = SSVStorageEB.load().latestCommittedBlock;

        try oracle.commitRoot(root, blockNum) {
            if (oracleId == 0) nonOracleCommitSucceeded = true;
            if (blockNum > uint64(block.number)) futureCommitSucceeded = true;
            if (blockNum <= latestBefore) staleCommitSucceeded = true;
            if (alreadyVoted) duplicateVoteSucceeded = true;

            localVotes[commitmentKey][oracleId] = true;

            _syncLatestCommittedBlock();
            lastCommitRoot = root;
            lastCommitBlock = blockNum;
            lastCommitOracle = oracle;
        } catch {}
    }

    function _syncLatestCommittedBlock() internal {
        uint64 current = SSVStorageEB.load().latestCommittedBlock;
        if (current >= lastCommittedBlock) {
            lastCommittedBlock = current;
        }
    }

    function _validBlock(uint256 seed) internal view returns (uint64) {
        uint64 current = uint64(block.number);
        uint64 minBlock = SSVStorageEB.load().latestCommittedBlock + 1;
        if (minBlock == 0) minBlock = 1;
        if (current < minBlock) return current;
        uint64 span = current - minBlock + 1;
        return minBlock + uint64(seed % span);
    }

    function _makeRoot(uint256 seed, uint8 oracleSeed) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(seed, oracleSeed));
    }

    function _oracleUser(uint8 seed) internal view returns (OracleUser) {
        uint8 idx = seed % 3;
        if (idx == 0) return oracle1;
        if (idx == 1) return oracle2;
        return oracle3;
    }

    function _oracleAddressBySeed(uint8 seed) internal view returns (address) {
        uint8 idx = seed % 5;
        if (idx == 0) return address(oracle1);
        if (idx == 1) return address(oracle2);
        if (idx == 2) return address(oracle3);
        if (idx == 3) return address(candidate1);
        return address(candidate2);
    }

    function _withdrawUser(uint8 seed) internal view returns (DAOUser) {
        if (seed % 2 == 0) return user1;
        return user2;
    }

    function _boundShrunk(uint256 seed, uint64 maxValue) internal pure returns (uint64) {
        if (maxValue == 0) return 0;
        return uint64(seed % (uint256(maxValue) + 1));
    }

    function _checkpointNetworkFeeIndices() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();

        if (sp.ethNetworkFeeIndexBlockNumber > block.number || sp.networkFeeIndexBlockNumber > block.number) {
            feeIndexDecreased = true;
            return;
        }

        uint256 ethDiff = block.number - sp.ethNetworkFeeIndexBlockNumber;
        uint256 ethCurrent = uint256(sp.ethNetworkFeeIndex) + ethDiff * uint256(PackedETH.unwrap(sp.ethNetworkFee));

        uint256 ssvDiff = block.number - sp.networkFeeIndexBlockNumber;
        uint256 ssvCurrent = uint256(sp.networkFeeIndex) + ssvDiff * uint256(PackedSSV.unwrap(sp.networkFee));

        if (!feeIndexTrackingInitialized) {
            prevEthFeeCurrentIndex = ethCurrent;
            prevSsvFeeCurrentIndex = ssvCurrent;
            feeIndexTrackingInitialized = true;
            return;
        }

        if (ethCurrent < prevEthFeeCurrentIndex || ssvCurrent < prevSsvFeeCurrentIndex) {
            feeIndexDecreased = true;
        }

        prevEthFeeCurrentIndex = ethCurrent;
        prevSsvFeeCurrentIndex = ssvCurrent;
    }

    function _mockSetToken(address tokenAddress) internal {
        SSVStorage.load().token = IERC20(tokenAddress);
    }

    function _mockSetOracle(uint32 oracleId, address oracle) internal {
        StorageStaking storage s = SSVStorageStaking.load();
        s.oracles[oracleId] = oracle;
        if (oracle != address(0)) {
            s.oracleIdOf[oracle] = oracleId;
        }
    }

    function _mockSetQuorumBps(uint16 quorum) internal {
        SSVStorageStaking.load().quorumBps = quorum;
    }
}
