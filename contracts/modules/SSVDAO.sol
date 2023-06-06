// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/functions/IFnSSVDAO.sol";
import "../interfaces/events/IEvSSVDAO.sol";
import "../libraries/Types.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/SystemLib.sol";
import "../libraries/CoreLib.sol";
import "../libraries/SSVStorage.sol";

contract SSVDAO is IFnSSVDAO, IEvSSVDAO {
    using Types64 for uint64;
    using Types256 for uint256;

    using SystemLib for StorageNetwork;
    
    uint64 private constant MINIMAL_LIQUIDATION_THRESHOLD = 100_800;

    function updateNetworkFee(uint256 fee) external override {
        uint64 previousFee = SSVStorageNetwork.load().networkFee;

        SSVStorageNetwork.load().updateNetworkFee(fee);

        emit NetworkFeeUpdated(previousFee, fee);
    }

    function withdrawNetworkEarnings(uint256 amount) external override {
        StorageNetwork storage sn = SSVStorageNetwork.load();

        uint64 shrunkAmount = amount.shrink();

        uint64 networkBalance = sn.networkTotalEarnings();

        if (shrunkAmount > networkBalance) {
            revert InsufficientBalance();
        }

        sn.daoBalance = networkBalance - shrunkAmount;

        CoreLib.transferBalance(msg.sender, amount);

        emit NetworkEarningsWithdrawn(amount, msg.sender);
    }

    function updateOperatorFeeIncreaseLimit(uint64 percentage) external override {
        SSVStorageNetwork.load().operatorMaxFeeIncrease = percentage;
        emit OperatorFeeIncreaseLimitUpdated(percentage);
    }

    function updateDeclareOperatorFeePeriod(uint64 timeInSeconds) external override {
        SSVStorageNetwork.load().declareOperatorFeePeriod = timeInSeconds;
        emit DeclareOperatorFeePeriodUpdated(timeInSeconds);
    }

    function updateExecuteOperatorFeePeriod(uint64 timeInSeconds) external override {
        SSVStorageNetwork.load().executeOperatorFeePeriod = timeInSeconds;
        emit ExecuteOperatorFeePeriodUpdated(timeInSeconds);
    }

    function updateLiquidationThresholdPeriod(uint64 blocks) external override {
        if (blocks < MINIMAL_LIQUIDATION_THRESHOLD) {
            revert NewBlockPeriodIsBelowMinimum();
        }

        SSVStorageNetwork.load().minimumBlocksBeforeLiquidation = blocks;
        emit LiquidationThresholdPeriodUpdated(blocks);
    }

    function updateMinimumLiquidationCollateral(uint256 amount) external override {
        SSVStorageNetwork.load().minimumLiquidationCollateral = amount.shrink();
        emit MinimumLiquidationCollateralUpdated(amount);
    }
}
