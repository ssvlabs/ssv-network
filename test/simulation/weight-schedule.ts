/**
 * Dynamic action weight schedule for the simulation.
 *
 * Action weights change over time to model realistic upgrade dynamics:
 * - Early days: mostly SSV operations, few migrations
 * - Mid transition: increasing migration + ETH ops
 * - Late: mostly ETH operations, SSV operations taper to zero
 *
 * Based on SIMULATION-DESIGN.md action distribution table.
 */

import type { ActionWeights } from "./types.ts";

/** Blocks per day on Ethereum (~12s block time) */
const DEFAULT_BLOCKS_PER_DAY = 7200;

/** Transition period in days (SSV→ETH migration window) */
const TRANSITION_DAYS = 25;

/**
 * Linearly interpolate between two values over the transition period.
 *
 * @param dayIndex - current day (0-based, clamped to [0, TRANSITION_DAYS])
 * @param startValue - value at day 0
 * @param endValue - value at TRANSITION_DAYS
 */
function lerp(dayIndex: number, startValue: number, endValue: number): number {
  const t = Math.max(0, Math.min(1, dayIndex / TRANSITION_DAYS));
  return startValue + (endValue - startValue) * t;
}

/**
 * Get action weights for the current block in the simulation.
 *
 * The migration weight ramps up from 5% to 95% over 25 simulated days.
 * SSV operations ramp down from 50% to 0% over the same period.
 * ETH operations, staking, and oracle weights remain constant.
 *
 * @param currentBlock - current block number
 * @param startBlock - block when simulation started
 * @param blocksPerDay - blocks per simulated day (default 7200)
 * @returns weight map keyed by action name
 */
export function getActionWeights(
  currentBlock: number,
  startBlock: number,
  blocksPerDay: number = DEFAULT_BLOCKS_PER_DAY,
): ActionWeights {
  const elapsed = Math.max(0, currentBlock - startBlock);
  const dayIndex = elapsed / blocksPerDay;

  // Dynamic weights (change over transition period)
  const migrateWeight = lerp(dayIndex, 5, 70);
  const ssvOpsWeight = lerp(dayIndex, 60, 0);

  // Constant weights
  const ethOpsWeight = 15;
  const stakingWeight = 10;
  const oracleWeight = 10;

  return {
    // SSV cluster operations (deposit, withdraw SSV clusters)
    ssvDeposit: ssvOpsWeight * 0.4,
    ssvWithdraw: ssvOpsWeight * 0.3,
    ssvLiquidate: ssvOpsWeight * 0.15,
    ssvRegisterValidator: ssvOpsWeight * 0.15,

    // Migration
    migrateClusterToETH: migrateWeight,

    // ETH cluster operations
    ethDeposit: ethOpsWeight * 0.3,
    ethWithdraw: ethOpsWeight * 0.2,
    ethRegisterValidator: ethOpsWeight * 0.2,
    ethRemoveValidator: ethOpsWeight * 0.1,
    ethLiquidate: ethOpsWeight * 0.1,
    ethReactivate: ethOpsWeight * 0.1,

    // Oracle (EB updates)
    commitRoot: oracleWeight * 0.5,
    updateClusterBalance: oracleWeight * 0.5,

    // Staking
    stake: stakingWeight * 0.35,
    requestUnstake: stakingWeight * 0.25,
    claimEthRewards: stakingWeight * 0.25,
    syncFees: stakingWeight * 0.15,

    // Time advancement (no-op blocks)
    mineBlocks: 5,
  };
}

/**
 * Select an action from the weight map using a random float in [0, 1).
 *
 * @param weights - action weight map
 * @param randomFloat - uniform random in [0, 1)
 * @returns selected action name
 */
export function selectAction(weights: ActionWeights, randomFloat: number): string {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return "mineBlocks";

  let r = randomFloat * total;
  for (const [name, weight] of entries) {
    r -= weight;
    if (r <= 0) return name;
  }
  return entries[entries.length - 1][0];
}

/**
 * Get a human-readable summary of current weights as percentages.
 */
export function weightsSummary(weights: ActionWeights): Record<string, string> {
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  const result: Record<string, string> = {};
  for (const [name, weight] of Object.entries(weights)) {
    if (weight > 0) {
      result[name] = `${((weight / total) * 100).toFixed(1)}%`;
    }
  }
  return result;
}
