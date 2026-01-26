// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";

interface ISSVDAO is ISSVNetworkCore {
    /// @notice Updates the network fee (ETH post-migration)
    /// @param fee The new network fee (ETH) to be set
    function updateNetworkFee(uint256 fee) external;

    /// @notice Updates the legacy network fee (SSV pre-migration)
    /// @param fee The new network fee (SSV) to be set
    function updateNetworkFeeSSV(uint256 fee) external;

    /// @notice Withdraws legacy network earnings (SSV pre-migration)
    /// @param amount The amount (SSV) to be withdrawn
    function withdrawNetworkSSVEarnings(uint256 amount) external;

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

    /// @notice Updates the maximum fee an operator that uses SSV token can set
    /// @param maxFee The new maximum fee (SSV)
    function updateMaximumOperatorFee(uint64 maxFee) external;

    /// @notice Commit Merkle root of all cluster EBs
    /// @param merkleRoot Root of Merkle tree containing all cluster EBs
    /// @param blockNum Block number when oracle computed this data (must be finalized and strictly increasing)
    function commitRoot(bytes32 merkleRoot, uint64 blockNum) external;

    function setUnstakeCooldownDuration(uint64 duration) external;

    /// @notice Replace oracle address at a stable oracle ID
    /// @param oracleId Stable oracle ID to update
    /// @param newOracle New oracle address
    function replaceOracle(uint32 oracleId, address newOracle) external;
    
    function setQuorumBps(uint16 quorum) external;
    
    event OperatorFeeIncreaseLimitUpdated(uint64 value);

    event DeclareOperatorFeePeriodUpdated(uint64 value);

    event ExecuteOperatorFeePeriodUpdated(uint64 value);

    event LiquidationThresholdPeriodUpdated(uint64 value);
    event LiquidationThresholdPeriodSSVUpdated(uint64 value);

    event MinimumLiquidationCollateralUpdated(uint256 value);
    event MinimumLiquidationCollateralSSVUpdated(uint256 value);

    /**
     * @dev Emitted when the network fee is updated.
     * @param oldFee The old fee
     * @param newFee The new fee
     */
    event NetworkFeeUpdated(uint256 oldFee, uint256 newFee);
    event NetworkFeeUpdatedSSV(uint256 oldFee, uint256 newFee);

    /**
     * @dev Emitted when transfer fees are withdrawn.
     * @param value The amount of tokens withdrawn.
     * @param recipient The recipient address.
     */
    event NetworkEarningsWithdrawn(uint256 value, address recipient);

    event OperatorMaximumFeeUpdated(uint64 maxFee);
    event OperatorMaximumFeeSSVUpdated(uint64 maxFee);

    /// @notice Emitted when an EB Merkle root is committed for a given block
    /// @param merkleRoot The committed Merkle root
    /// @param blockNum The block number the root corresponds to
    event RootCommitted(bytes32 indexed merkleRoot, uint64 indexed blockNum);

    event RootProposed(bytes32 indexed merkleRoot, uint64 indexed blockNum);

    event CooldownDurationUpdated(uint64 newCooldownDuration);

    event WeightedRootProposed(bytes32 indexed merkleRoot, uint64 indexed blockNum, uint256 accumulatedWeight, uint256 quorum, uint32 oracleId, address oracle);

    event OracleReplaced(uint32 indexed oracleId, address indexed oldOracle, address indexed newOracle);
    event QuorumUpdated(uint16 newQuorum);
}
