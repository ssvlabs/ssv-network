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
  actionLiquidateSsv,
  actionReactivateSsv,
} from "./cluster-ssv.ts";
import { VERSION_ETH, VERSION_SSV } from "../types.ts";

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
  ssvWithdraw: async () => ({ name: "ssvWithdraw", success: true }), // SSV withdraw not implemented on fork
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

function dampenWeightsForState(
  state: SimulationState,
  baseWeights: ActionWeights,
): ActionWeights {
  const weights: ActionWeights = { ...baseWeights };
  const clusters = [...state.clusterBook.values()];

  const activeSsv = clusters.filter((c) => c.version === VERSION_SSV && c.cluster.active);
  const liquidatedSsv = clusters.filter((c) => c.version === VERSION_SSV && !c.cluster.active);
  const activeEthWithValidators = clusters.filter(
    (c) => c.version === VERSION_ETH && c.cluster.active && c.cluster.validatorCount > 0n,
  );
  const liquidatedEth = clusters.filter((c) => c.version === VERSION_ETH && !c.cluster.active);
  const ethWithTrackedKeys = activeEthWithValidators.filter((c) => c.validatorKeys.length > 0);
  const terminalEthRemovals = ethWithTrackedKeys.filter(
    (c) => c.validatorKeys.length === 1 || c.cluster.validatorCount === 1n,
  );
  const operatorsWithValidators = new Set<bigint>();
  for (const cluster of clusters) {
    if (cluster.cluster.validatorCount > 0n) {
      for (const operatorId of cluster.operatorIds) {
        operatorsWithValidators.add(operatorId);
      }
    }
  }
  const removableOperators = [...state.operatorPool.values()].filter(
    (op) => op.isActive && !operatorsWithValidators.has(op.id),
  );
  const operatorsEligibleForFeeDeclaration = [...state.operatorPool.values()].filter(
    (op) => op.isActive && operatorsWithValidators.has(op.id) && op.pendingDeclaredFee === undefined,
  );
  const operatorsWithPendingDeclarations = [...state.operatorPool.values()].filter(
    (op) => op.isActive && op.pendingDeclaredFee !== undefined,
  );
  const hasCssvBalance = state.stakerPool.some((staker) => staker.cssvBalance > 0n);

  if (activeSsv.length === 0) {
    weights.migrateClusterToETH = 0;
    weights.ssvWithdraw = 0;
    weights.ssvLiquidate = 0;
    weights.ssvRegisterValidator = 0;
  }

  if (liquidatedSsv.length === 0) {
    weights.ssvReactivate = 0;
  }

  if (activeEthWithValidators.length === 0) {
    weights.ethDeposit = 0;
    weights.ethWithdraw = 0;
    weights.ethLiquidate = 0;
    weights.commitRoot = 0;
    weights.updateClusterBalance = 0;
  }

  if (liquidatedEth.length === 0) {
    weights.ethReactivate = 0;
  }

  if (ethWithTrackedKeys.length === 0) {
    weights.ethRemoveValidator = 0;
  } else {
    weights.ethRemoveValidator = Math.max(weights.ethRemoveValidator ?? 0, 3);
    if (terminalEthRemovals.length > 0) {
      weights.ethRemoveValidator *= 2;
    }
  }

  if (state.oracleSigners.length < 3) {
    weights.commitRoot = 0;
    weights.updateClusterBalance = 0;
  }

  if (!hasCssvBalance) {
    weights.requestUnstake = 0;
  }

  if (removableOperators.length === 0) {
    weights.removeOperator = 0;
  } else {
    weights.removeOperator = Math.max(weights.removeOperator ?? 0, 4);
  }

  if (operatorsEligibleForFeeDeclaration.length === 0) {
    weights.declareOperatorFee = 0;
  }

  if (operatorsWithPendingDeclarations.length === 0) {
    weights.executeOperatorFee = 0;
  }

  return weights;
}

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
    const weights = dampenWeightsForState(
      state,
      getActionWeights(currentBlock, startBlock),
    );
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
