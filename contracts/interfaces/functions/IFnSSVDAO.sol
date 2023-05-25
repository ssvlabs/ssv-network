// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./../ISSVNetworkCore.sol";

interface IFnSSVDAO is ISSVNetworkCore {
    /// @notice Updates the network fee
    /// @param fee The new network fee (SSV) to be set
    function updateNetworkFee(uint256 fee) external;

    /// @notice Withdraws network earnings
    /// @param amount The amount (SSV) to be withdrawn
    function withdrawNetworkEarnings(uint256 amount) external;

    /// @notice Updates the limit on the percentage increase in operator fees
    /// @param percentage The new percentage limit
    function updateOperatorFeeIncreaseLimit(uint64 percentage) external;

    /// @notice Updates the period for declaring operator fees
    /// @param timeInSeconds The new period in seconds
    function updateDeclareOperatorFeePeriod(uint64 timeInSeconds) external;

    /// @notice Updates the period for executing operator fees
    /// @param timeInSeconds The new period in seconds
    function updateExecuteOperatorFeePeriod(uint64 timeInSeconds) external;

    /// @notice Updates the liquidation threshold period
    /// @param blocks The new liquidation threshold in blocks
    function updateLiquidationThresholdPeriod(uint64 blocks) external;

    /// @notice Updates the minimum collateral required to prevent liquidation
    /// @param amount The new minimum collateral amount (SSV)
    function updateMinimumLiquidationCollateral(uint256 amount) external;
}
