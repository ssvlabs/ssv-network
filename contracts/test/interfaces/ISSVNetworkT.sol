// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../../interfaces/ISSVNetworkCore.sol";
import "../../interfaces/functions/IFnSSVOperators.sol";
import "../../interfaces/functions/IFnSSVClusters.sol";
import "../../interfaces/functions/IFnSSVDAO.sol";
import "../../interfaces/functions/IFnSSVViews.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../../libraries/RegisterAuth.sol";

interface ISSVNetworkT is ISSVNetworkCore, IFnSSVOperators, IFnSSVClusters, IFnSSVDAO {
    function initialize(
        IERC20 token_,
        IFnSSVOperators ssvOperators_,
        IFnSSVClusters ssvClusters_,
        IFnSSVDAO ssvDAO_,
        IFnSSVViews ssvViews_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint256 minimumLiquidationCollateral_,
        uint32 validatorsPerOperatorLimit_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint64 operatorMaxFeeIncrease_
    ) external;
}
