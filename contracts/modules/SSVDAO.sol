// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ISSVDAO} from "../interfaces/ISSVDAO.sol";
import {Types64, Types256} from "../libraries/Types.sol";
import "../libraries/ProtocolLib.sol";
import "../libraries/CoreLib.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/SSVStorageProtocol.sol";
import {SSVStorageEB, StorageEB} from "../libraries/SSVStorageEB.sol";
import {SSVStorageStaking} from "../libraries/SSVStorageStaking.sol";

contract SSVDAO is ISSVDAO {
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
        emit NetworkFeeUpdated(previousFee.expand(), fee);
    }

    function withdrawNetworkSSVEarnings(uint256 amount) external override {
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

    function updateMinimumLiquidationCollateral(uint256 amount) external override {
        SSVStorageProtocol.load().minimumLiquidationCollateral = amount.shrink();
        emit MinimumLiquidationCollateralUpdated(amount);
    }

    function updateMaximumOperatorFee(uint64 maxFee) external override {
        SSVStorageProtocol.load().operatorMaxFee = maxFee;
        emit OperatorMaximumFeeUpdated(maxFee);
    }

    function commitRoot(bytes32 merkleRoot, uint64 blockNum) external override {
        StorageEB storage seb = SSVStorageEB.load();

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
        seb.rootCommitments[commitmentKey]+=1;

        uint256 votes = seb.rootCommitments[commitmentKey];

        if (votes >= ROOT_COMMITS_THRESHOLD) {
            seb.ebRoots[blockNum] = merkleRoot;
            seb.latestCommittedBlock = blockNum;

            delete seb.rootCommitments[commitmentKey];

            emit RootCommitted(merkleRoot, blockNum);
            return;
        }

        emit RootProposed(merkleRoot, blockNum);
    }

    function setOracleTimingConfig(
        uint64 firstStartEpoch,
        uint64 firstInterval,
        uint64 secondStartEpoch,
        uint64 secondInterval
    ) external {
        if (firstInterval == 0 || secondInterval == 0) {
            revert ZeroInterval();
        }

        StorageProtocol storage sp = SSVStorageProtocol.load();

        sp.oracleFirstStartEpoch = firstStartEpoch;
        sp.oracleFirstEpochInterval = firstInterval;
        sp.oracleSecondStartEpoch = secondStartEpoch;
        sp.oracleSecondEpochInterval = secondInterval;
    }

    function setUnstakeCooldownDuration(uint64 duration) external override {
        SSVStorageStaking.load().cooldownDuration = duration;
        emit CooldownDurationUpdated(duration);
    }
}
