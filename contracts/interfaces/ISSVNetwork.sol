// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";
import {ISSVOperators} from "./ISSVOperators.sol";
import {ISSVClusters} from "./ISSVClusters.sol";
import {ISSVDAO} from "./ISSVDAO.sol";
import {ISSVViews} from "./ISSVViews.sol";

import {SSVModules} from "../libraries/SSVStorage.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISSVNetwork {
    function initialize(
        IERC20 token_,
        ISSVOperators ssvOperators_,
        ISSVClusters ssvClusters_,
        ISSVDAO ssvDAO_,
        ISSVViews ssvViews_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint256 minimumLiquidationCollateral_,
        uint32 validatorsPerOperatorLimit_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint64 operatorMaxFeeIncrease_
    ) external;

    function getVersion() external pure returns (string memory version);

    function setFeeRecipientAddress(address feeRecipientAddress) external;

    function updateModule(SSVModules moduleId, address moduleAddress) external;
}
