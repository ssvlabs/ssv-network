// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISSVOperators} from "./ISSVOperators.sol";
import {ISSVClusters} from "./ISSVClusters.sol";
import {ISSVValidators} from "./ISSVValidators.sol";
import {ISSVDAO} from "./ISSVDAO.sol";
import {ISSVViews} from "./ISSVViews.sol";

import {SSVModules} from "../libraries/storage/SSVStorage.sol";
import {MAX_DELEGATION_SLOTS} from "../libraries/storage/SSVStorageStaking.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SSV Network Interface
 * @author SSV Labs
 * @dev Main interface for the SSV Network contract, providing initialization and configuration functions
 */
interface ISSVNetwork {
    /**
     * @dev Struct containing initialization parameters for the network
     */
    struct NetworkInitParams {
        /// @dev Minimum blocks before a cluster can be liquidated
        uint64 minimumBlocksBeforeLiquidation;
        /// @dev Minimum collateral required to avoid liquidation
        uint256 minimumLiquidationCollateral;
        /// @dev Maximum validators per operator
        uint32 validatorsPerOperatorLimit;
        /// @dev Period for declaring operator fee changes
        uint64 declareOperatorFeePeriod;
        /// @dev Period for executing operator fee changes
        uint64 executeOperatorFeePeriod;
        /// @dev Maximum percentage increase for operator fees
        uint64 operatorMaxFeeIncrease;
        /// @dev Default oracle IDs
        uint32[MAX_DELEGATION_SLOTS] defaultOracleIds;
        /// @dev Quorum percentage needed to commit a root
        uint16 quorumBps;
    }

    /**
     * @notice Emitted when the SSV Network contract is upgraded
     * @param version The version string of the upgrade
     * @param blockNumber The block number at which the upgrade occurred
     */
    event SSVNetworkUpgradeBlock(string version, uint256 blockNumber);

    /**
     * @notice Initializes the SSV Network contract
     * @param token_ The ERC20 (SSV) token used in the network
     * @param ssvOperators_ The SSVOperators module address
     * @param ssvClusters_ The SSVClusters module address
     * @param ssvDAO_ The SSVDAO module address
     * @param ssvViews_ The SSVViews module address
     * @param params The initialization parameters
     */
    function initialize(
        IERC20 token_,
        ISSVOperators ssvOperators_,
        ISSVClusters ssvClusters_,
        ISSVDAO ssvDAO_,
        ISSVViews ssvViews_,
        NetworkInitParams calldata params
    ) external;

    /**
     * @notice Returns the version of the contract
     * @return version The version string
     */
    function getVersion() external pure returns (string memory version);

    /**
     * @notice Sets the fee recipient address
     * @param feeRecipientAddress The new fee recipient address
     */
    function setFeeRecipientAddress(address feeRecipientAddress) external;

    /**
     * @notice Updates a module address
     * @param moduleId The ID of the module to update
     * @param moduleAddress The new address of the module
     */
    function updateModule(SSVModules moduleId, address moduleAddress) external;
}