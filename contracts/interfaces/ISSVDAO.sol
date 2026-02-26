// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";

/**
 * @title SSV DAO Interface
 * @author SSV Labs
 * @dev Interface for DAO operations in the SSV network, including fee updates, period adjustments, and other governance functions
 */
interface ISSVDAO is ISSVNetworkCore {

    /**
     * @dev Emitted when the operator fee increase limit is updated
     * @param value The new limit value
     */
    event OperatorFeeIncreaseLimitUpdated(uint64 value);

    /**
     * @dev Emitted when the declare operator fee period is updated
     * @param value The new period value in seconds
     */
    event DeclareOperatorFeePeriodUpdated(uint64 value);

    /**
     * @dev Emitted when the execute operator fee period is updated
     * @param value The new period value in seconds
     */
    event ExecuteOperatorFeePeriodUpdated(uint64 value);

    /**
     * @dev Emitted when the liquidation threshold period is updated
     * @param value The new threshold in blocks
     */
    event LiquidationThresholdPeriodUpdated(uint64 value);

    /**
     * @dev Emitted when the SSV liquidation threshold period is updated
     * @param value The new threshold in blocks
     */
    event LiquidationThresholdPeriodSSVUpdated(uint64 value);

    /**
     * @dev Emitted when the minimum liquidation collateral is updated
     * @param value The new collateral amount
     */
    event MinimumLiquidationCollateralUpdated(uint256 value);

    /**
     * @dev Emitted when the SSV minimum liquidation collateral is updated
     * @param value The new collateral amount
     */
    event MinimumLiquidationCollateralSSVUpdated(uint256 value);

    /**
     * @dev Emitted when the network fee is updated
     * @param oldFee The previous fee
     * @param newFee The new fee
     */
    event NetworkFeeUpdated(uint256 oldFee, uint256 newFee);

    /**
     * @dev Emitted when the SSV network fee is updated
     * @param oldFee The previous fee
     * @param newFee The new fee
     */
    event NetworkFeeUpdatedSSV(uint256 oldFee, uint256 newFee);

    /**
     * @dev Emitted when network earnings are withdrawn
     * @param value The amount withdrawn
     * @param recipient The address receiving the funds
     */
    event NetworkEarningsWithdrawn(uint256 value, address recipient);

    /**
     * @dev Emitted when the maximum operator fee is updated
     * @param maxFee The new maximum fee
     */
    event OperatorMaximumFeeUpdated(uint256 maxFee);

    /**
     * @dev Emitted when the minimum operator ETH fee is updated
     * @param minFee The new minimum fee
     */
    event MinimumOperatorEthFeeUpdated(uint256 minFee);

    /**
     * @dev Emitted when an EB Merkle root is committed for a given block
     * @param merkleRoot The committed Merkle root
     * @param blockNum The block number the root corresponds to
     */
    event RootCommitted(bytes32 indexed merkleRoot, uint64 indexed blockNum);

    /**
     * @dev Emitted when the unstake cooldown duration is updated
     * @param newCooldownDuration The new duration in seconds
     */
    event CooldownDurationUpdated(uint64 newCooldownDuration);

    /**
     * @dev Emitted when a weighted root is proposed
     * @param merkleRoot The proposed Merkle root
     * @param blockNum The block number
     * @param accumulatedWeight The accumulated weight
     * @param quorum The quorum value
     * @param oracleId The oracle ID
     * @param oracle The oracle address
     */
    event WeightedRootProposed(bytes32 indexed merkleRoot, uint64 indexed blockNum, uint256 accumulatedWeight, uint256 quorum, uint32 oracleId, address oracle);

    /**
     * @dev Emitted when an oracle is replaced
     * @param oracleId The oracle ID
     * @param oldOracle The old oracle address
     * @param newOracle The new oracle address
     */
    event OracleReplaced(uint32 indexed oracleId, address indexed oldOracle, address indexed newOracle);

    /**
     * @dev Emitted when the quorum is updated
     * @param newQuorum The new quorum value
     */
    event QuorumUpdated(uint16 newQuorum);

    /**
     * @notice Updates the network fee (ETH post-migration)
     * @param fee The new network fee (ETH) to be set
     */
    function updateNetworkFee(uint256 fee) external;

    /**
     * @notice Updates the legacy network fee (SSV pre-migration)
     * @param fee The new network fee (SSV) to be set
     */
    function updateNetworkFeeSSV(uint256 fee) external;

    /**
     * @notice Withdraws legacy network earnings (SSV pre-migration)
     * @param amount The amount (SSV) to be withdrawn
     */
    function withdrawNetworkSSVEarnings(uint256 amount) external;

    /**
     * @notice Updates the limit on the percentage increase in operator fees
     * @param percentage The new percentage limit
     */
    function updateOperatorFeeIncreaseLimit(uint64 percentage) external;

    /**
     * @notice Updates the period for declaring operator fees
     * @param timeInSeconds The new period in seconds
     */
    function updateDeclareOperatorFeePeriod(uint64 timeInSeconds) external;

    /**
     * @notice Updates the period for executing operator fees
     * @param timeInSeconds The new period in seconds
     */
    function updateExecuteOperatorFeePeriod(uint64 timeInSeconds) external;

    /**
     * @notice Updates the liquidation threshold period
     * @param blocks The new liquidation threshold in blocks
     */
    function updateLiquidationThresholdPeriod(uint64 blocks) external;

    /**
     * @notice Updates the SSV liquidation threshold period
     * @param blocks The new liquidation threshold in blocks
     */
    function updateLiquidationThresholdPeriodSSV(uint64 blocks) external;

    /**
     * @notice Updates the minimum collateral required to prevent liquidation
     * @param amount The new minimum collateral amount
     */
    function updateMinimumLiquidationCollateral(uint256 amount) external;

    /**
     * @notice Updates the SSV minimum collateral required to prevent liquidation
     * @param amount The new minimum collateral amount (SSV)
     */
    function updateMinimumLiquidationCollateralSSV(uint256 amount) external;

    /**
     * @notice Updates the maximum fee an operator that uses SSV token can set
     * @param maxFee The new maximum fee
     */
    function updateMaximumOperatorFee(uint256 maxFee) external;

    /**
     * @notice Updates the minimum operator ETH fee
     * @param minFee The new minimum fee (ETH)
     */
    function updateMinimumOperatorEthFee(uint256 minFee) external;

    /**
     * @notice Commit Merkle root of all cluster EBs
     * @param merkleRoot Root of Merkle tree containing all cluster EBs
     * @param blockNum Block number when oracle computed this data (must be finalized and strictly increasing)
     */
    function commitRoot(bytes32 merkleRoot, uint64 blockNum) external;

    /**
     * @notice Sets the unstake cooldown duration
     * @param duration The new duration in seconds
     */
    function setUnstakeCooldownDuration(uint64 duration) external;

    /**
     * @notice Replace oracle address at a stable oracle ID
     * @param oracleId Stable oracle ID to update
     * @param newOracle New oracle address
     */
    function replaceOracle(uint32 oracleId, address newOracle) external;

    /**
     * @notice Sets the quorum BPS
     * @param quorum The new quorum value
     */
    function setQuorumBps(uint16 quorum) external;
}
