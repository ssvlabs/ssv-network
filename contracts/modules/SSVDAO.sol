// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ISSVDAO} from "../interfaces/ISSVDAO.sol";
import {ProtocolLib} from "../libraries/ProtocolLib.sol";
import {CoreLib} from "../libraries/CoreLib.sol";
import {PackedSSV, PackedETH, BPS_DENOMINATOR} from "../libraries/SSVCoreTypes.sol";
import {PackedSSVLib, PackedETHLib} from "../libraries/SSVPackedLib.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/storage/SSVStorageProtocol.sol";
import {SSVStorageEB, StorageEB} from "../libraries/storage/SSVStorageEB.sol";
import {ICSSVToken} from "../interfaces/ICSSVToken.sol";
import {SSVStorageStaking, StorageStaking, MAX_DELEGATION_SLOTS} from "../libraries/storage/SSVStorageStaking.sol";
import {SSVReentrancyGuard} from "../abstract/SSVReentrancyGuard.sol";

contract SSVDAO is ISSVDAO, SSVReentrancyGuard {
    using ProtocolLib for StorageProtocol;
    using PackedSSVLib for PackedSSV;

    uint64 private constant MINIMAL_LIQUIDATION_THRESHOLD = 21_480;
    address public immutable CSSV_ADDRESS;

    constructor(address _cssv) {
        CSSV_ADDRESS = _cssv;
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function updateNetworkFee(uint256 fee) external override {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        PackedETH previousFee = sp.ethNetworkFee;

        sp.updateNetworkFee(fee);
        emit NetworkFeeUpdated(PackedETHLib.unpack(previousFee), fee);
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function updateNetworkFeeSSV(uint256 fee) external override {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        PackedSSV previousFee = sp.networkFee;

        sp.updateNetworkFeeSSV(fee);
        emit NetworkFeeUpdatedSSV(PackedSSVLib.unpack(previousFee), fee);
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function withdrawNetworkSSVEarnings(uint256 amount) external override nonReentrant {
        StorageProtocol storage sp = SSVStorageProtocol.load();

        PackedSSV shrunkAmount = PackedSSVLib.pack(amount);

        PackedSSV networkBalance = sp.networkTotalEarningsSSV();

        if (shrunkAmount.gt(networkBalance)) {
            revert InsufficientBalance();
        }

        sp.daoBalance = networkBalance.sub(shrunkAmount);
        sp.daoIndexBlockNumber = uint32(block.number);

        CoreLib.transferTokenBalance(msg.sender, amount);

        emit NetworkEarningsWithdrawn(amount, msg.sender);
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function updateOperatorFeeIncreaseLimit(uint64 percentage) external override {
        if (percentage > BPS_DENOMINATOR) {
            revert InvalidOperatorFeeIncreaseLimit();
        }

        SSVStorageProtocol.load().operatorMaxFeeIncrease = percentage;
        emit OperatorFeeIncreaseLimitUpdated(percentage);
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function updateDeclareOperatorFeePeriod(uint64 timeInSeconds) external override {
        SSVStorageProtocol.load().declareOperatorFeePeriod = timeInSeconds;
        emit DeclareOperatorFeePeriodUpdated(timeInSeconds);
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function updateExecuteOperatorFeePeriod(uint64 timeInSeconds) external override {
        SSVStorageProtocol.load().executeOperatorFeePeriod = timeInSeconds;
        emit ExecuteOperatorFeePeriodUpdated(timeInSeconds);
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function updateLiquidationThresholdPeriod(uint64 blocks) external override {
        if (blocks < MINIMAL_LIQUIDATION_THRESHOLD) {
            revert NewBlockPeriodIsBelowMinimum();
        }

        SSVStorageProtocol.load().minimumBlocksBeforeLiquidation = blocks;
        emit LiquidationThresholdPeriodUpdated(blocks);
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function updateLiquidationThresholdPeriodSSV(uint64 blocks) external {
        if (blocks < MINIMAL_LIQUIDATION_THRESHOLD) {
            revert NewBlockPeriodIsBelowMinimum();
        }

        SSVStorageProtocol.load().minimumBlocksBeforeLiquidationSSV = blocks;
        emit LiquidationThresholdPeriodSSVUpdated(blocks);
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function updateMinimumLiquidationCollateral(uint256 amount) external override {
        SSVStorageProtocol.load().minimumLiquidationCollateral = PackedETHLib.pack(amount);
        emit MinimumLiquidationCollateralUpdated(amount);
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function updateMinimumLiquidationCollateralSSV(uint256 amount) external {
        SSVStorageProtocol.load().minimumLiquidationCollateralSSV = PackedSSVLib.pack(amount);
        emit MinimumLiquidationCollateralSSVUpdated(amount);
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function updateMaximumOperatorFee(uint256 maxFee) external override {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        if (maxFee < PackedETHLib.unpack(sp.minimumOperatorEthFee)) {
            revert InvalidOperatorFeeRange();
        }

        sp.operatorMaxFee = PackedETHLib.pack(maxFee);
        emit OperatorMaximumFeeUpdated(maxFee);
    }


    /**
     * @inheritdoc ISSVDAO
     */
    function updateMinimumOperatorEthFee(uint256 minFee) external override {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        if (minFee > PackedETHLib.unpack(sp.operatorMaxFee)) {
            revert InvalidOperatorFeeRange();
        }

        sp.minimumOperatorEthFee = PackedETHLib.pack(minFee);
        emit MinimumOperatorEthFeeUpdated(minFee);
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function commitRoot(bytes32 merkleRoot, uint64 blockNum) external override {
        StorageEB storage seb = SSVStorageEB.load();
        StorageStaking storage s = SSVStorageStaking.load();

        uint32 oracleId = s.oracleIdOf[msg.sender];
        if (oracleId == 0) revert NotOracle();

        // Enforce monotonicity - new block must be greater than last
        if (blockNum <= seb.latestCommittedBlock) {
            revert StaleBlockNumber();
        }

        // Ensure block is not in the future
        if (blockNum > block.number) {
            revert FutureBlockNumber();
        }

        // block and root combined to keep block-root proposal tied together
        bytes32 commitmentKey = keccak256(abi.encodePacked(blockNum, merkleRoot));

        if (seb.hasVoted[commitmentKey][oracleId]) revert AlreadyVoted();
        seb.hasVoted[commitmentKey][oracleId] = true;

        uint256 oracleCount = s.defaultOracleIds.length;
        uint256 totalStaked = seb.roundFrozenSupply[commitmentKey];
        if (totalStaked == 0) {
            uint256 rawSupply = ICSSVToken(CSSV_ADDRESS).totalSupply();
            if (rawSupply == 0) revert ZeroCSSVSupply();

            totalStaked = rawSupply - (rawSupply % oracleCount);
            if (totalStaked == 0) revert InsufficientCSSVSupply();
            seb.roundFrozenSupply[commitmentKey] = totalStaked;
        }

        uint256 weight = totalStaked / oracleCount;
        seb.rootCommitments[commitmentKey] += weight;

        uint256 accumulatedWeight = seb.rootCommitments[commitmentKey];

        uint256 threshold = (totalStaked * s.quorumBps) / BPS_DENOMINATOR;

        emit WeightedRootProposed(merkleRoot, blockNum, accumulatedWeight, threshold, oracleId, msg.sender);

        if (accumulatedWeight >= threshold) {
            seb.ebRoots[blockNum] = merkleRoot;
            seb.latestCommittedBlock = blockNum;

            delete seb.rootCommitments[commitmentKey];
            delete seb.roundFrozenSupply[commitmentKey];
            // Do not delete hasVoted to prevent re-voting if same key is somehow reused

            emit RootCommitted(merkleRoot, blockNum);
        }
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function replaceOracle(uint32 oracleId, address newOracle) external override {
        StorageStaking storage s = SSVStorageStaking.load();
        if (oracleId == 0 || oracleId > MAX_DELEGATION_SLOTS) revert InvalidOracleId();
        if (newOracle == address(0)) revert ZeroAddress();

        address oldOracle = s.oracles[oracleId];
        if (oldOracle == newOracle) {
            revert SameOracleAddressNotAllowed();
        }

        // Clear reverse mapping for old oracle if existed
        if (oldOracle != address(0)) {
            s.oracleIdOf[oldOracle] = 0;
        }

        // Ensure newOracle is not already assigned to another ID
        uint32 existing = s.oracleIdOf[newOracle];
        if (existing != 0 && existing != oracleId) revert OracleAlreadyAssigned();

        s.oracles[oracleId] = newOracle;
        s.oracleIdOf[newOracle] = oracleId;

        emit OracleReplaced(oracleId, oldOracle, newOracle);
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function updateQuorumBps(uint16 quorum) external override {
        if (quorum == 0 || quorum > BPS_DENOMINATOR) {
            revert InvalidQuorum();
        }
        SSVStorageStaking.load().quorumBps = quorum;
        emit QuorumUpdated(quorum);
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function updateUnstakeCooldownDuration(uint64 duration) external override {
        SSVStorageStaking.load().cooldownDuration = duration;
        emit CooldownDurationUpdated(duration);
    }

    /**
     * @inheritdoc ISSVDAO
     */
    function updateMinBlocksBetweenUpdates(uint32 blocks) external override {
        SSVStorageEB.load().minBlocksBetweenUpdates = blocks;
        emit MinBlocksBetweenUpdatesUpdated(blocks);
    }
}
