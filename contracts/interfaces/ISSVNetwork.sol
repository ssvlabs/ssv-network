// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";
import {ISSVOperators} from "./ISSVOperators.sol";
import {ISSVClusters} from "./ISSVClusters.sol";
import {ISSVValidators} from "./ISSVValidators.sol";
import {ISSVDAO} from "./ISSVDAO.sol";
import {ISSVViews} from "./ISSVViews.sol";

import {SSVModules} from "../libraries/SSVStorage.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISSVNetwork {
    struct NetworkInitParams {
        uint64 minimumBlocksBeforeLiquidation;
        uint256 minimumLiquidationCollateral;
        uint32 validatorsPerOperatorLimit;
        uint64 declareOperatorFeePeriod;
        uint64 executeOperatorFeePeriod;
        uint64 operatorMaxFeeIncrease;
        uint32[4] defaultOracleIds;
        uint16 quorumBps;
    }

    function initialize(
        IERC20 token_,
        ISSVOperators ssvOperators_,
        ISSVClusters ssvClusters_,
        ISSVDAO ssvDAO_,
        ISSVViews ssvViews_,
        NetworkInitParams calldata params
    ) external;

    function getVersion() external pure returns (string memory version);

    function setFeeRecipientAddress(address feeRecipientAddress) external;

    function updateModule(SSVModules moduleId, address moduleAddress) external;
}
