// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/interfaces/ISSVDAO.sol";
import "../../contracts/libraries/storage/SSVStorage.sol";
import "../../contracts/libraries/storage/SSVStorageEB.sol";
import "../../contracts/libraries/storage/SSVStorageProtocol.sol";
import "../../contracts/libraries/storage/SSVStorageStaking.sol";
import "../../contracts/libraries/ProtocolLib.sol";
import "../../contracts/modules/SSVDAO.sol";
import "../../contracts/interfaces/ICSSVToken.sol";
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
    using ProtocolLib for StorageProtocol;

    uint64 private constant MINIMAL_LIQUIDATION_THRESHOLD = 21_480;
    uint64 private constant MAX_FEE_UNITS = 1_000_000;
    uint64 private constant MAX_PERIOD = 1_000_000;
    uint16 private constant MAX_QUORUM_BPS = 10_000;
    uint16 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant DUSTY_RAW_SUPPLY = 1_000_000_002;
    uint256 private constant DUSTY_TRUNCATED_SUPPLY = 1_000_000_000;
    uint16 private constant DUSTY_QUORUM_BPS = 7_500;

    MockToken private token;

    DAOUser private user1;
    DAOUser private user2;

    OracleUser private oracle1;
    OracleUser private oracle2;
    OracleUser private oracle3;
    OracleUser private oracle4;
    OracleUser private candidate1;
    OracleUser private candidate2;
    OracleUser private attacker;

    uint64 private lastCommittedBlock;

    bytes32 private lastCommitRoot;
    uint64 private lastCommitBlock;
    OracleUser private lastCommitOracle;

    bytes32 private dustyRoot;
    uint64 private dustyBlock;
    uint8 private dustyVoteCount;
    bool private dustyRoundSeeded;
    bool private dustyPrematureCommit;
    uint256 private dustySeedNonce;
    bool private belowOracleCountCommitSucceeded;
    bytes32 private failedQuorumKey;
    uint64 private failedQuorumBlock;
    bytes32 private failedQuorumRoot;
    uint32 private failedQuorumOracleId;
    bool private failedQuorumTracked;
    bool private failedQuorumPersistenceViolation;
    bool private revoteDifferentRootFailed;
    bytes32 private generalizedDustRoot;
    uint64 private generalizedDustBlock;
    uint256 private generalizedDustSupply;
    bool private generalizedDustRoundSeeded;
    bool private generalizedDustTruncationViolation;
    bytes32[] private generalizedDustCommitmentKeys;
    mapping(bytes32 => bool) private generalizedDustCommitmentTracked;
    mapping(bytes32 => uint256) private generalizedDustExpectedFrozen;

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

    bytes32[] private touchedCommitmentKeys;
    mapping(bytes32 => bool) private touchedCommitmentKeyExists;
    mapping(bytes32 => uint64) private commitmentBlockByKey;
    mapping(bytes32 => bytes32) private commitmentRootByKey;

    bool private finalizedWeightNotCleared;
    bool private commitmentWeightOverSupply;
    bool private finalizationWithoutQuorum;

    uint256 private prevEthDaoEarningsUnits;
    uint256 private prevSsvDaoEarningsUnits;
    uint256 private totalDaoSsvMintedUnits;
    bool private daoEarningsTrackingInitialized;
    bool private daoEarningsDecreased;
    bool private daoIndexBlockInFuture;

    modifier trackFeeIndexMonotonicity() {
        _checkpointNetworkFeeIndices();
        _checkpointDaoEarningsAndIndices();
        _;
        _checkpointNetworkFeeIndices();
        _checkpointDaoEarningsAndIndices();
    }

    constructor() SSVDAO(address(new CSSVTokenMock(address(this)))) {
        token = new MockToken();

        ISSVDAO self = ISSVDAO(address(this));
        user1 = new DAOUser(self);
        user2 = new DAOUser(self);

        oracle1 = new OracleUser(self);
        oracle2 = new OracleUser(self);
        oracle3 = new OracleUser(self);
        oracle4 = new OracleUser(self);
        candidate1 = new OracleUser(self);
        candidate2 = new OracleUser(self);
        attacker = new OracleUser(self);

        _mockSetToken(address(token));

        token.mint(address(user1), 1000 ether);

        _mockSetOracle(1, address(oracle1));
        _mockSetOracle(2, address(oracle2));
        _mockSetOracle(3, address(oracle3));
        _mockSetOracle(4, address(oracle4));

        _mockupdateQuorumBps(DUSTY_QUORUM_BPS);
        _checkpointNetworkFeeIndices();
        _checkpointDaoEarningsAndIndices();
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
        try this.updateQuorumBps(value) {} catch {}
    }

    function action_set_cooldown(uint64 duration) external trackFeeIndexMonotonicity {
        uint64 value = duration;
        try this.updateUnstakeCooldownDuration(value) {} catch {}
    }

    function action_replace_oracle(uint8 oracleIdSeed, uint8 newOracleSeed) external trackFeeIndexMonotonicity {
        uint32 oracleId = uint32(uint256(oracleIdSeed) % MAX_DELEGATION_SLOTS) + 1;
        address newOracle = _oracleAddressBySeed(newOracleSeed);
        try this.replaceOracle(oracleId, newOracle) {} catch {}
    }

    function action_set_eth_vunits(uint64 vUnitsSeed) external trackFeeIndexMonotonicity {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.updateDAOEarnings();
        sp.daoTotalEthVUnits = vUnitsSeed % 100_001;
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
        totalDaoSsvMintedUnits += addUnits;
    }

    function action_mint_cssv_supply(uint256 seed, uint8 userSeed) external trackFeeIndexMonotonicity {
        uint256 units = (seed % 1_000_000) + 1;
        uint256 amount = units * 1 ether;
        CSSVTokenMock(CSSV_ADDRESS).mint(_cssvRecipient(userSeed), amount);
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

    function action_seed_dusty_commit_round(uint256 seed) external trackFeeIndexMonotonicity {
        _mockupdateQuorumBps(DUSTY_QUORUM_BPS);
        _setCssvSupply(DUSTY_RAW_SUPPLY);

        dustySeedNonce++;
        dustyRoot = keccak256(abi.encodePacked("dusty-root", seed, dustySeedNonce));
        dustyBlock = _validBlock(seed);
        dustyVoteCount = 0;
        dustyRoundSeeded = true;
        dustyPrematureCommit = false;
    }

    function action_commit_root_dusty_shared(uint8 oracleSeed) external trackFeeIndexMonotonicity {
        if (!dustyRoundSeeded) return;

        _mockupdateQuorumBps(DUSTY_QUORUM_BPS);
        _setCssvSupply(DUSTY_RAW_SUPPLY);

        OracleUser oracle = _oracleUser(oracleSeed);
        StorageStaking storage s = SSVStorageStaking.load();
        uint32 oracleId = s.oracleIdOf[address(oracle)];
        bytes32 commitmentKey = keccak256(abi.encodePacked(dustyBlock, dustyRoot));
        bool alreadyVoted = localVotes[commitmentKey][oracleId];

        _attemptCommit(oracle, dustyRoot, dustyBlock);

        if (!alreadyVoted && localVotes[commitmentKey][oracleId]) {
            unchecked {
                dustyVoteCount += 1;
            }
        }

        if (SSVStorageEB.load().ebRoots[dustyBlock] == dustyRoot && dustyVoteCount < 3) {
            dustyPrematureCommit = true;
        }
    }

    function action_commit_root_below_oracle_count(uint8 oracleSeed, uint8 rawSupplySeed, uint256 seed)
        external
        trackFeeIndexMonotonicity
    {
        _mockupdateQuorumBps(DUSTY_QUORUM_BPS);

        uint256 rawSupply = (uint256(rawSupplySeed) % (MAX_DELEGATION_SLOTS - 1)) + 1;
        _setCssvSupply(rawSupply);

        OracleUser oracle = _oracleUser(oracleSeed);
        uint64 blockNum = _validBlock(seed);
        bytes32 root = keccak256(abi.encodePacked("below-oracle-count", seed, rawSupplySeed));
        StorageStaking storage s = SSVStorageStaking.load();
        uint32 oracleId = s.oracleIdOf[address(oracle)];
        bytes32 commitmentKey = keccak256(abi.encodePacked(blockNum, root));
        bool votedBefore = localVotes[commitmentKey][oracleId];

        _attemptCommit(oracle, root, blockNum);

        if (!votedBefore && localVotes[commitmentKey][oracleId]) {
            belowOracleCountCommitSucceeded = true;
        }
    }

    function action_seed_failed_quorum_round(uint256 seed, uint8 oracleSeed) external trackFeeIndexMonotonicity {
        _mockupdateQuorumBps(DUSTY_QUORUM_BPS);
        _setCssvSupply(DUSTY_RAW_SUPPLY);

        OracleUser oracle = _oracleUser(oracleSeed);
        StorageStaking storage s = SSVStorageStaking.load();
        StorageEB storage seb = SSVStorageEB.load();
        uint32 oracleId = s.oracleIdOf[address(oracle)];
        if (oracleId == 0) return;

        dustySeedNonce++;
        bytes32 root = keccak256(abi.encodePacked("failed-quorum-root", seed, dustySeedNonce));
        uint64 blockNum = _validBlock(seed);
        bytes32 commitmentKey = keccak256(abi.encodePacked(blockNum, root));
        bool votedBefore = localVotes[commitmentKey][oracleId];

        _attemptCommit(oracle, root, blockNum);

        if (!votedBefore && localVotes[commitmentKey][oracleId]) {
            if (seb.ebRoots[blockNum] == root) {
                return;
            }

            failedQuorumTracked = true;
            failedQuorumKey = commitmentKey;
            failedQuorumBlock = blockNum;
            failedQuorumRoot = root;
            failedQuorumOracleId = oracleId;

            if (seb.rootCommitments[commitmentKey] == 0 || seb.roundFrozenSupply[commitmentKey] == 0) {
                failedQuorumPersistenceViolation = true;
            }
        }
    }

    function action_revote_different_root_same_block(uint256 seed, uint8 firstOracleSeed, uint8 secondOracleSeed)
        external
        trackFeeIndexMonotonicity
    {
        _mockupdateQuorumBps(DUSTY_QUORUM_BPS);
        _setCssvSupply(DUSTY_RAW_SUPPLY);

        OracleUser firstOracle = _oracleUser(firstOracleSeed);
        OracleUser secondOracle = _oracleUser(secondOracleSeed);
        if (address(firstOracle) == address(secondOracle)) {
            secondOracle = _oracleUser(secondOracleSeed + 1);
        }
        if (address(firstOracle) == address(secondOracle)) return;

        StorageStaking storage s = SSVStorageStaking.load();
        uint32 firstOracleId = s.oracleIdOf[address(firstOracle)];
        uint32 secondOracleId = s.oracleIdOf[address(secondOracle)];
        if (firstOracleId == 0 || secondOracleId == 0) return;

        dustySeedNonce++;
        bytes32 rootA = keccak256(abi.encodePacked("revote-root-a", seed, dustySeedNonce));
        bytes32 rootB = keccak256(abi.encodePacked("revote-root-b", seed, dustySeedNonce));
        uint64 blockNum = _validBlock(seed);

        _attemptCommit(firstOracle, rootA, blockNum);

        bytes32 commitmentKeyB = keccak256(abi.encodePacked(blockNum, rootB));
        bool votedBefore = localVotes[commitmentKeyB][secondOracleId];
        _attemptCommit(secondOracle, rootB, blockNum);

        if (!votedBefore && !localVotes[commitmentKeyB][secondOracleId]) {
            revoteDifferentRootFailed = true;
        }
    }

    function action_seed_general_dust_round(uint256 rawSupplySeed, uint256 seed) external trackFeeIndexMonotonicity {
        StorageStaking storage s = SSVStorageStaking.load();
        uint256 oracleCount = s.defaultOracleIds.length;
        if (oracleCount == 0) return;

        _mockupdateQuorumBps(DUSTY_QUORUM_BPS);

        uint256 rawSupply = (rawSupplySeed % 1_000_000_000) + oracleCount;
        _setCssvSupply(rawSupply);

        dustySeedNonce++;
        generalizedDustRoot = keccak256(abi.encodePacked("general-dust-root", seed, dustySeedNonce));
        generalizedDustBlock = _validBlock(seed);
        generalizedDustSupply = rawSupply;
        generalizedDustRoundSeeded = true;

        bytes32 commitmentKey = keccak256(abi.encodePacked(generalizedDustBlock, generalizedDustRoot));
        uint256 expectedFrozen = rawSupply - (rawSupply % oracleCount);
        generalizedDustExpectedFrozen[commitmentKey] = expectedFrozen;

        if (!generalizedDustCommitmentTracked[commitmentKey]) {
            generalizedDustCommitmentTracked[commitmentKey] = true;
            generalizedDustCommitmentKeys.push(commitmentKey);
        }
    }

    function action_commit_root_general_dust_shared(uint8 oracleSeed) external trackFeeIndexMonotonicity {
        if (!generalizedDustRoundSeeded) return;

        _mockupdateQuorumBps(DUSTY_QUORUM_BPS);
        _setCssvSupply(generalizedDustSupply);

        bytes32 commitmentKey = keccak256(abi.encodePacked(generalizedDustBlock, generalizedDustRoot));
        OracleUser oracle = _oracleUser(oracleSeed);
        _attemptCommit(oracle, generalizedDustRoot, generalizedDustBlock);

        StorageEB storage seb = SSVStorageEB.load();
        if (
            seb.rootCommitments[commitmentKey] != 0 &&
            seb.roundFrozenSupply[commitmentKey] != generalizedDustExpectedFrozen[commitmentKey]
        ) {
            generalizedDustTruncationViolation = true;
        }
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

    function echidna_commit_root_dust_round_reaches_quorum() external view returns (bool) {
        if (!dustyRoundSeeded || dustyVoteCount < 3) return true;

        StorageEB storage seb = SSVStorageEB.load();
        return seb.ebRoots[dustyBlock] == dustyRoot && seb.latestCommittedBlock >= dustyBlock;
    }

    function echidna_commit_root_dust_round_not_before_threshold() external view returns (bool) {
        return !dustyPrematureCommit;
    }

    function echidna_commit_root_dust_round_uses_truncated_supply() external view returns (bool) {
        if (!dustyRoundSeeded) return true;

        bytes32 commitmentKey = keccak256(abi.encodePacked(dustyBlock, dustyRoot));
        StorageEB storage seb = SSVStorageEB.load();
        if (seb.rootCommitments[commitmentKey] == 0) return true;

        return seb.roundFrozenSupply[commitmentKey] == DUSTY_TRUNCATED_SUPPLY;
    }

    function echidna_failed_quorum_persists() external view returns (bool) {
        if (!failedQuorumTracked) return true;
        if (failedQuorumPersistenceViolation) return false;

        StorageEB storage seb = SSVStorageEB.load();
        if (seb.ebRoots[failedQuorumBlock] == failedQuorumRoot) {
            return true;
        }

        return seb.hasVoted[failedQuorumKey][failedQuorumOracleId] &&
            seb.rootCommitments[failedQuorumKey] != 0 &&
            seb.roundFrozenSupply[failedQuorumKey] != 0;
    }

    function echidna_revote_different_root_succeeds() external view returns (bool) {
        return !revoteDifferentRootFailed;
    }

    function echidna_commit_root_dust_round_uses_truncated_supply_generalized() external view returns (bool) {
        if (generalizedDustTruncationViolation) return false;

        StorageEB storage seb = SSVStorageEB.load();
        uint256 count = generalizedDustCommitmentKeys.length;
        for (uint256 i; i < count; ++i) {
            bytes32 commitmentKey = generalizedDustCommitmentKeys[i];
            if (seb.rootCommitments[commitmentKey] == 0) continue;
            if (seb.roundFrozenSupply[commitmentKey] != generalizedDustExpectedFrozen[commitmentKey]) {
                return false;
            }
        }

        return true;
    }

    function echidna_commit_root_below_oracle_count_reverts() external view returns (bool) {
        return !belowOracleCountCommitSucceeded;
    }

    function echidna_oracle_mapping_consistent() external view returns (bool) {
        StorageStaking storage s = SSVStorageStaking.load();
        address addr1 = s.oracles[1];
        address addr2 = s.oracles[2];
        address addr3 = s.oracles[3];
        address addr4 = s.oracles[4];

        if (addr1 != address(0) && s.oracleIdOf[addr1] != 1) return false;
        if (addr2 != address(0) && s.oracleIdOf[addr2] != 2) return false;
        if (addr3 != address(0) && s.oracleIdOf[addr3] != 3) return false;
        if (addr4 != address(0) && s.oracleIdOf[addr4] != 4) return false;

        if (addr1 != address(0) && addr1 == addr2) return false;
        if (addr1 != address(0) && addr1 == addr3) return false;
        if (addr1 != address(0) && addr1 == addr4) return false;
        if (addr2 != address(0) && addr2 == addr3) return false;
        if (addr2 != address(0) && addr2 == addr4) return false;
        if (addr3 != address(0) && addr3 == addr4) return false;

        return true;
    }

    function echidna_finalized_weight_cleared() external view returns (bool) {
        if (finalizedWeightNotCleared) return false;

        StorageEB storage seb = SSVStorageEB.load();
        uint256 count = touchedCommitmentKeys.length;
        for (uint256 i; i < count; ++i) {
            bytes32 key = touchedCommitmentKeys[i];
            uint64 blockNum = commitmentBlockByKey[key];
            bytes32 root = commitmentRootByKey[key];
            if (root == bytes32(0)) continue;
            if (seb.ebRoots[blockNum] == root && seb.rootCommitments[key] != 0) return false;
        }
        return true;
    }

    function echidna_commitment_weight_lte_supply() external view returns (bool) {
        if (commitmentWeightOverSupply) return false;

        StorageEB storage seb = SSVStorageEB.load();
        uint256 count = touchedCommitmentKeys.length;
        for (uint256 i; i < count; ++i) {
            bytes32 key = touchedCommitmentKeys[i];
            uint256 committedWeight = seb.rootCommitments[key];
            if (committedWeight == 0) continue;

            uint256 frozenSupply = seb.roundFrozenSupply[key];
            if (frozenSupply == 0 || committedWeight > frozenSupply) return false;
        }
        return true;
    }

    function echidna_finalization_implies_quorum() external view returns (bool) {
        return !finalizationWithoutQuorum;
    }

    function echidna_dao_earnings_monotonic() external view returns (bool) {
        return !daoEarningsDecreased;
    }

    function echidna_dao_index_block_lte_current() external view returns (bool) {
        if (daoIndexBlockInFuture) return false;

        StorageProtocol storage sp = SSVStorageProtocol.load();
        return sp.ethDaoIndexBlockNumber <= block.number && sp.daoIndexBlockNumber <= block.number;
    }
    
    function echidna_dao_earnings_matches_formula() external view returns (bool) {
        StorageProtocol storage sp = SSVStorageProtocol.load();

        if (sp.ethDaoIndexBlockNumber > block.number) return false;

        uint128 blockDelta = uint64(block.number) - sp.ethDaoIndexBlockNumber;
        uint128 rawFee = PackedETH.unwrap(sp.ethNetworkFee);
        uint128 vUnits = sp.daoTotalEthVUnits;
        uint128 rawBalance = PackedETH.unwrap(sp.ethDaoBalance);

        uint128 earningsUnits = (blockDelta * rawFee * vUnits) / BPS_DENOMINATOR;

        if (earningsUnits > type(uint64).max) return true;
        if (rawBalance + earningsUnits > type(uint64).max) return true;

        uint64 expectedRaw = uint64(rawBalance + earningsUnits);
        PackedETH libResult = ProtocolLib.networkTotalEarnings(sp);

        return PackedETH.unwrap(libResult) == expectedRaw;
    }

    function _attemptCommit(OracleUser oracle, bytes32 root, uint64 blockNum) internal {
        StorageStaking storage s = SSVStorageStaking.load();
        StorageEB storage seb = SSVStorageEB.load();
        uint32 oracleId = s.oracleIdOf[address(oracle)];
        bytes32 commitmentKey = keccak256(abi.encodePacked(blockNum, root));
        bool alreadyVoted = localVotes[commitmentKey][oracleId];

        uint64 latestBefore = seb.latestCommittedBlock;
        uint256 currentSupply = IERC20(CSSV_ADDRESS).totalSupply();
        uint256 oracleCount = s.defaultOracleIds.length;
        uint256 frozenSupply = seb.roundFrozenSupply[commitmentKey];
        if (frozenSupply == 0) {
            frozenSupply = currentSupply - (currentSupply % oracleCount);
        }
        uint256 threshold = (frozenSupply * s.quorumBps) / BPS_DENOMINATOR;
        uint256 weight = frozenSupply / oracleCount;
        uint256 beforeWeight = seb.rootCommitments[commitmentKey];

        if (!touchedCommitmentKeyExists[commitmentKey]) {
            touchedCommitmentKeyExists[commitmentKey] = true;
            touchedCommitmentKeys.push(commitmentKey);
        }
        commitmentBlockByKey[commitmentKey] = blockNum;
        commitmentRootByKey[commitmentKey] = root;

        try oracle.commitRoot(root, blockNum) {
            if (oracleId == 0) nonOracleCommitSucceeded = true;
            if (blockNum > uint64(block.number)) futureCommitSucceeded = true;
            if (blockNum <= latestBefore) staleCommitSucceeded = true;
            if (alreadyVoted) duplicateVoteSucceeded = true;

            localVotes[commitmentKey][oracleId] = true;

            uint256 committedWeight = seb.rootCommitments[commitmentKey];
            uint256 frozenSupplyAfter = seb.roundFrozenSupply[commitmentKey];

            if (committedWeight != 0 && (frozenSupplyAfter == 0 || committedWeight > frozenSupplyAfter)) {
                commitmentWeightOverSupply = true;
            }

            if (seb.ebRoots[blockNum] == root && root != bytes32(0)) {
                if (committedWeight != 0) {
                    finalizedWeightNotCleared = true;
                }
                if (beforeWeight + weight < threshold) {
                    finalizationWithoutQuorum = true;
                }
            }

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
        uint8 idx = uint8(uint256(seed) % MAX_DELEGATION_SLOTS);
        if (idx == 0) return oracle1;
        if (idx == 1) return oracle2;
        if (idx == 2) return oracle3;
        return oracle4;
    }

    function _oracleAddressBySeed(uint8 seed) internal view returns (address) {
        uint8 idx = seed % 6;
        if (idx == 0) return address(oracle1);
        if (idx == 1) return address(oracle2);
        if (idx == 2) return address(oracle3);
        if (idx == 3) return address(oracle4);
        if (idx == 4) return address(candidate1);
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

    function _cssvRecipient(uint8 seed) internal view returns (address) {
        uint8 idx = seed % 4;
        if (idx == 0) return address(user1);
        if (idx == 1) return address(user2);
        if (idx == 2) return address(oracle1);
        return address(oracle2);
    }
    
    function _setCssvSupply(uint256 targetSupply) internal {
        ICSSVToken cssv = ICSSVToken(CSSV_ADDRESS);
        uint256 currentSupply = cssv.totalSupply();
        if (currentSupply < targetSupply) {
            cssv.mint(address(this), targetSupply - currentSupply);
            return;
        }

        if (currentSupply > targetSupply) {
            uint256 remaining = currentSupply - targetSupply;
            remaining = _burnCssv(cssv, address(this), remaining);
            remaining = _burnCssv(cssv, address(user1), remaining);
            remaining = _burnCssv(cssv, address(user2), remaining);
            remaining = _burnCssv(cssv, address(oracle1), remaining);
            remaining = _burnCssv(cssv, address(oracle2), remaining);
            remaining = _burnCssv(cssv, address(oracle3), remaining);
            remaining = _burnCssv(cssv, address(oracle4), remaining);

            if (remaining != 0) {
                revert("cssv supply rebalance incomplete");
            }
        }
    }

    function _burnCssv(ICSSVToken cssv, address holder, uint256 remaining) internal returns (uint256) {
        if (remaining == 0) return 0;

        uint256 balance = IERC20(CSSV_ADDRESS).balanceOf(holder);
        if (balance == 0) return remaining;

        uint256 burnAmount = balance < remaining ? balance : remaining;
        cssv.burn(holder, burnAmount);
        return remaining - burnAmount;
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

    function _checkpointDaoEarningsAndIndices() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();

        if (sp.ethDaoIndexBlockNumber > block.number || sp.daoIndexBlockNumber > block.number) {
            daoIndexBlockInFuture = true;
            return;
        }

        uint256 ethEarningsUnits = PackedETH.unwrap(sp.networkTotalEarnings());
        uint256 daoBalanceUnits = PackedSSV.unwrap(sp.daoBalance);
        uint256 withdrawnUnits = totalDaoSsvMintedUnits >= daoBalanceUnits ? totalDaoSsvMintedUnits - daoBalanceUnits : 0;
        uint256 ssvEarningsUnits = PackedSSV.unwrap(sp.networkTotalEarningsSSV()) + withdrawnUnits;

        if (!daoEarningsTrackingInitialized) {
            prevEthDaoEarningsUnits = ethEarningsUnits;
            prevSsvDaoEarningsUnits = ssvEarningsUnits;
            daoEarningsTrackingInitialized = true;
            return;
        }

        if (ethEarningsUnits < prevEthDaoEarningsUnits || ssvEarningsUnits < prevSsvDaoEarningsUnits) {
            daoEarningsDecreased = true;
        }

        prevEthDaoEarningsUnits = ethEarningsUnits;
        prevSsvDaoEarningsUnits = ssvEarningsUnits;
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

    function _mockupdateQuorumBps(uint16 quorum) internal {
        SSVStorageStaking.load().quorumBps = quorum;
    }
}
