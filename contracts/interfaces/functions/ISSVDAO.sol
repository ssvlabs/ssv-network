// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./../ISSVNetworkCore.sol";

interface ISSVDAO is ISSVNetworkCore {
    function updateNetworkFee(uint256 fee) external;

    function withdrawNetworkEarnings(uint256 amount) external;

    function updateOperatorFeeIncreaseLimit(uint64 percentage) external;

    function updateDeclareOperatorFeePeriod(uint64 timeInSeconds) external;

    function updateExecuteOperatorFeePeriod(uint64 timeInSeconds) external;

    function updateLiquidationThresholdPeriod(uint64 blocks) external;

    function updateMinimumLiquidationCollateral(uint256 amount) external;
}
