// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ISSVDAO} from "../interfaces/ISSVDAO.sol";
import {Types64, Types256} from "../libraries/Types.sol";
import "../libraries/ProtocolLib.sol";
import "../libraries/CoreLib.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/SSVStorageProtocol.sol";
import {SSVStorageEB, StorageEB} from "../libraries/SSVStorageEB.sol";
import {ICSSVToken} from "../interfaces/ICSSVToken.sol";
import {SSVStorageStaking, StorageStaking} from "../libraries/SSVStorageStaking.sol";
import {SSVReentrancyGuard} from "../abstract/SSVReentrancyGuard.sol";

contract SSVDAO is ISSVDAO, SSVReentrancyGuard {
    using Types64 for uint64;
    using Types256 for uint256;

    using ProtocolLib for StorageProtocol;

    uint64 private constant MINIMAL_LIQUIDATION_THRESHOLD = 100_800;
    uint256 private constant ROOT_COMMITS_THRESHOLD = 3;

    function updateNetworkFee(uint256 fee) external override {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 previousFee = sp.ethNetworkFee;

        sp.updateNetworkFee(fee);
        emit NetworkFeeUpdated(previousFee.expand(), fee);
    }

    function updateNetworkFeeSSV(uint256 fee) external override {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 previousFee = sp.networkFee;

        sp.updateNetworkFeeSSV(fee);
        emit NetworkFeeUpdatedSSV(previousFee.expand(), fee);
    }

    function withdrawNetworkSSVEarnings(uint256 amount) external override nonReentrant {
        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint64 shrunkAmount = amount.shrink();

        uint64 networkBalance = sp.networkTotalEarningsSSV();

        if (shrunkAmount > networkBalance) {
            revert InsufficientBalance();
        }

        sp.daoBalance = networkBalance - shrunkAmount;
        sp.daoIndexBlockNumber = uint32(block.number);

        CoreLib.transferTokenBalance(msg.sender, amount);

        emit NetworkEarningsWithdrawn(amount, msg.sender);
    }

    function updateOperatorFeeIncreaseLimit(uint64 percentage) external override {
        SSVStorageProtocol.load().operatorMaxFeeIncrease = percentage;
        emit OperatorFeeIncreaseLimitUpdated(percentage);
    }

    function updateDeclareOperatorFeePeriod(uint64 timeInSeconds) external override {
        SSVStorageProtocol.load().declareOperatorFeePeriod = timeInSeconds;
        emit DeclareOperatorFeePeriodUpdated(timeInSeconds);
    }

    function updateExecuteOperatorFeePeriod(uint64 timeInSeconds) external override {
        SSVStorageProtocol.load().executeOperatorFeePeriod = timeInSeconds;
        emit ExecuteOperatorFeePeriodUpdated(timeInSeconds);
    }

    function updateLiquidationThresholdPeriod(uint64 blocks) external override {
        if (blocks < MINIMAL_LIQUIDATION_THRESHOLD) {
            revert NewBlockPeriodIsBelowMinimum();
        }

        SSVStorageProtocol.load().minimumBlocksBeforeLiquidation = blocks;
        emit LiquidationThresholdPeriodUpdated(blocks);
    }

    function updateLiquidationThresholdPeriodSSV(uint64 blocks) external {
        if (blocks < MINIMAL_LIQUIDATION_THRESHOLD) {
            revert NewBlockPeriodIsBelowMinimum();
        }

        SSVStorageProtocol.load().minimumBlocksBeforeLiquidationSSV = blocks;
        emit LiquidationThresholdPeriodSSVUpdated(blocks);
    }

    function updateMinimumLiquidationCollateral(uint256 amount) external override {
        SSVStorageProtocol.load().minimumLiquidationCollateral = amount.shrink();
        emit MinimumLiquidationCollateralUpdated(amount);
    }

    function updateMinimumLiquidationCollateralSSV(uint256 amount) external {
        SSVStorageProtocol.load().minimumLiquidationCollateralSSV = amount.shrink();
        emit MinimumLiquidationCollateralSSVUpdated(amount);
    }

    function updateMaximumOperatorFee(uint64 maxFee) external override {
        SSVStorageProtocol.load().operatorMaxFee = maxFee;
        emit OperatorMaximumFeeUpdated(maxFee);
    }

    function updateMaximumOperatorFeeSSV(uint64 maxFee) external {
        SSVStorageProtocol.load().operatorMaxFeeSSV = maxFee;
        emit OperatorMaximumFeeSSVUpdated(maxFee);
    }

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

        uint256 weight = s.oracleWeights[oracleId];
        seb.rootCommitments[commitmentKey] += weight;

        uint256 accumulatedWeight = seb.rootCommitments[commitmentKey];
        uint256 totalSupply = ICSSVToken(s.cssv).totalSupply();

        uint256 threshold = (totalSupply * s.quorumBps) / 10000;

        if (accumulatedWeight >= threshold) {
            seb.ebRoots[blockNum] = merkleRoot;
            seb.latestCommittedBlock = blockNum;

            delete seb.rootCommitments[commitmentKey];
            // Do not delete hasVoted to prevent re-voting if same key is somehow reused

            emit RootCommitted(merkleRoot, blockNum);
            return;
        }

        emit WeightedRootProposed(merkleRoot, blockNum, accumulatedWeight, threshold, oracleId, msg.sender);
    }

    function replaceOracle(uint32 oracleId, address newOracle) external override {
        StorageStaking storage s = SSVStorageStaking.load();
        if (oracleId == 0) revert ZeroAmount(); // reuse error for invalid id
        if (newOracle == address(0)) revert ZeroAddress();

        address oldOracle = s.oracles[oracleId];
        if (oldOracle == newOracle) {
            emit OracleReplaced(oracleId, oldOracle, newOracle);
            return;
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

    function setQuorumBps(uint16 quorum) external override {
        if (quorum > 10000) revert("Invalid quorum");
        SSVStorageStaking.load().quorumBps = quorum;
        emit QuorumUpdated(quorum);
    }

    function setUnstakeCooldownDuration(uint64 duration) external override {
        SSVStorageStaking.load().cooldownDuration = duration;
        emit CooldownDurationUpdated(duration);
    }
}
