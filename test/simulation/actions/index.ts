/**
 * Action registry for Monte Carlo simulation.
 *
 * Maps action names (from weight-schedule.ts) to their implementations.
 * Also provides a WeightedActionSelector that integrates the weight
 * schedule with action dispatch.
 */

import type { SimulationState, ActionResult, ActionWeights } from "../types.ts";
import { getActionWeights, selectAction } from "../weight-schedule.ts";

// -- Operator actions --
import {
  actionRegisterOperator,
  actionRemoveOperator,
  actionDeclareOperatorFee,
  actionExecuteOperatorFee,
  actionWithdrawOperatorEarnings,
} from "./operators.ts";

// -- ETH cluster actions --
import {
  actionRegisterValidator,
  actionRemoveValidator,
  actionDepositEth,
  actionWithdrawEth,
  actionLiquidateEth,
  actionReactivateEth,
} from "./cluster-eth.ts";

// -- SSV cluster actions --
import {
  actionDepositSsv,
  actionLiquidateSsv,
  actionReactivateSsv,
} from "./cluster-ssv.ts";

// -- Migration --
import { actionMigrateCluster } from "./migration.ts";

// -- Staking --
import {
  actionStakeSSV,
  actionRequestUnstake,
  actionWithdrawUnlocked,
  actionClaimEthRewards,
} from "./staking.ts";

// -- Oracle --
import { actionCommitEBRoot, actionAdvanceBlocks } from "./oracle.ts";

// ---------- Types ----------

/** A simulation action takes state and returns a result. */
export type SimAction = (state: SimulationState) => Promise<ActionResult>;

// ---------- Action registry ----------

/**
 * Map of action name → implementation function.
 * Keys match the names used in weight-schedule.ts.
 */
export const ACTION_REGISTRY: Record<string, SimAction> = {
  // SSV cluster operations
  ssvDeposit: actionDepositSsv,
  ssvLiquidate: actionLiquidateSsv,
  ssvRegisterValidator: actionRegisterValidator, // reuses ETH register (will create ETH cluster)

  // Migration
  migrateClusterToETH: actionMigrateCluster,

  // ETH cluster operations
  ethDeposit: actionDepositEth,
  ethWithdraw: actionWithdrawEth,
  ethRegisterValidator: actionRegisterValidator,
  ethRemoveValidator: actionRemoveValidator,
  ethLiquidate: actionLiquidateEth,
  ethReactivate: actionReactivateEth,

  // Oracle
  commitRoot: actionCommitEBRoot,
  updateClusterBalance: actionCommitEBRoot, // commitRoot also handles updateClusterBalance

  // Staking
  stake: actionStakeSSV,
  requestUnstake: actionRequestUnstake,
  claimEthRewards: actionClaimEthRewards,
  syncFees: actionClaimEthRewards, // syncFees is implicitly called during claim

  // Time advancement
  mineBlocks: actionAdvanceBlocks,

  // Operator management (not in weight-schedule but available for direct use)
  registerOperator: actionRegisterOperator,
  removeOperator: actionRemoveOperator,
  declareOperatorFee: actionDeclareOperatorFee,
  executeOperatorFee: actionExecuteOperatorFee,
  withdrawOperatorEarnings: actionWithdrawOperatorEarnings,
  withdrawUnlocked: actionWithdrawUnlocked,
  ssvReactivate: actionReactivateSsv,
};

// ---------- Selector class ----------

/**
 * Integrates the weight schedule with the action registry.
 * Selects an action weighted-randomly based on simulation progress
 * and dispatches to the matching implementation.
 */
export class WeightedActionSelector {
  /**
   * Select and return an action using the canonical weight schedule.
   *
   * @param state - Current simulation state
   * @param currentBlock - Current block number
   * @param startBlock - Simulation start block
   * @returns The action name and function to execute
   */
  selectAction(
    state: SimulationState,
    currentBlock: number,
    startBlock: number,
  ): { name: string; action: SimAction } {
    const weights = getActionWeights(currentBlock, startBlock);
    const actionName = selectAction(weights, state.rng.nextFloat());

    const action = ACTION_REGISTRY[actionName];
    if (!action) {
      // Fallback if action name not found in registry
      return { name: "mineBlocks", action: actionAdvanceBlocks };
    }

    return { name: actionName, action };
  }

  /** Get the action names from the current weight schedule. */
  get names(): string[] {
    return Object.keys(ACTION_REGISTRY);
  }

  /** Get the registered action count. */
  get count(): number {
    return Object.keys(ACTION_REGISTRY).length;
  }
}

// ---------- Re-exports ----------

export {
  actionRegisterOperator,
  actionRemoveOperator,
  actionDeclareOperatorFee,
  actionExecuteOperatorFee,
  actionWithdrawOperatorEarnings,
} from "./operators.ts";

export {
  actionRegisterValidator,
  actionRemoveValidator,
  actionDepositEth,
  actionWithdrawEth,
  actionLiquidateEth,
  actionReactivateEth,
} from "./cluster-eth.ts";

export {
  actionDepositSsv,
  actionLiquidateSsv,
  actionReactivateSsv,
} from "./cluster-ssv.ts";

export { actionMigrateCluster } from "./migration.ts";

export {
  actionStakeSSV,
  actionRequestUnstake,
  actionWithdrawUnlocked,
  actionClaimEthRewards,
} from "./staking.ts";

export { actionCommitEBRoot, actionAdvanceBlocks } from "./oracle.ts";
