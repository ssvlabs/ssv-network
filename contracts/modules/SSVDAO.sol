// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ISSVDAO} from "../interfaces/ISSVDAO.sol";
import {Types64, Types256} from "../libraries/Types.sol";
import "../libraries/ProtocolLib.sol";
import "../libraries/CoreLib.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/SSVStorageProtocol.sol";

contract SSVDAO is ISSVDAO {
    using Types64 for uint64;
    using Types256 for uint256;

    using ProtocolLib for StorageProtocol;

    uint64 private constant MINIMAL_LIQUIDATION_THRESHOLD = 100_800;

    function updateNetworkFee(uint256 fee) external override {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 previousFee = sp.networkFee;

        sp.updateNetworkFee(fee);
        emit NetworkFeeUpdated(previousFee.expand(), fee);
    }

    function withdrawNetworkEarnings(uint256 amount) external override {
        _withdrawNetworkEarnings(amount, CoreLib.VERSION_SSV);
    }

    function withdrawNetworkEarningsETH(uint256 amount) external override {
        _withdrawNetworkEarnings(amount, CoreLib.VERSION_ETH);
    }

    function _withdrawNetworkEarnings(uint256 amount, uint8 version) private {
        StorageProtocol storage sp = SSVStorageProtocol.load();

        sp.updateDAOEarnings(version);

        uint64 shrunkAmount = amount.shrink();
        uint64 networkBalance;

        if (version == CoreLib.VERSION_ETH) {
            networkBalance = sp.daoEthBalance;
        } else if (version == CoreLib.VERSION_SSV) {
            networkBalance = sp.daoBalance;
        } else {
            revert IncorrectDAOVersion(version);
        }

        if (shrunkAmount > networkBalance) {
            revert InsufficientBalance();
        }

        if (version == CoreLib.VERSION_ETH) {
            sp.daoEthBalance = networkBalance - shrunkAmount;
            CoreLib.transferBalance(payable(msg.sender), amount);
        } else {
            sp.daoBalance = networkBalance - shrunkAmount;
            CoreLib.transferTokenBalance(msg.sender, amount);
        }

        emit NetworkEarningsWithdrawn(amount, msg.sender, version);
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
}
