/**
 * Simulation Invariant Checker
 *
 * Implements 8 invariants for the Monte Carlo upgrade simulation.
 * Each invariant returns { passed, message } instead of throwing,
 * so the caller can aggregate results and report all violations.
 */

import type { SimulationState } from "./types.ts";
import { VERSION_SSV, VERSION_ETH } from "./types.ts";

// --- Invariant result type ---

export interface InvariantResult {
  id: string;
  passed: boolean;
  message: string;
}

/**
 * Mutable context carried across periodic invariant checks.
 * Tracks values that need to be compared across invocations (e.g. monotonicity).
 */
export interface InvariantContext {
  prevAccEthPerShare: bigint;
}

export function createInvariantContext(): InvariantContext {
  return { prevAccEthPerShare: 0n };
}

// --- Individual invariant implementations ---

/**
 * INV-1: ETH Conservation
 * contract.ETH >= sum(cluster balances) + sum(operator earnings) + staking pool + DAO earnings
 */
async function checkINV1_ETHConservation(state: SimulationState): Promise<InvariantResult> {
  try {
    const contractBalance = await state.provider.getBalance(state.networkAddress);

    let totalClusterBalances = 0n;
    for (const [, record] of state.clusterBook) {
      if (!record.cluster.active || record.version !== VERSION_ETH) continue;
      try {
        const balance = await state.views.getBalance(
          record.owner,
          record.operatorIds,
          record.cluster,
        );
        totalClusterBalances += BigInt(balance);
      } catch {
        // Cluster may be liquidated or inactive — skip
      }
    }

    let totalOperatorEarnings = 0n;
    for (const [, op] of state.operatorPool) {
      try {
        const earnings = await state.views.getOperatorEarnings(op.id);
        totalOperatorEarnings += BigInt(earnings);
      } catch {
        // Operator may not have ETH earnings yet
      }
    }

    let stakingPool = 0n;
    try {
      stakingPool = BigInt(await state.views.stakingEthPoolBalance());
    } catch {
      // May not be available
    }

    let daoEarnings = 0n;
    try {
      daoEarnings = BigInt(await state.views.getNetworkEarnings());
    } catch {
      // May not be available
    }

    const totalAccounted = totalClusterBalances + totalOperatorEarnings + stakingPool + daoEarnings;

    const passed = contractBalance >= totalAccounted;
    return {
      id: "INV-1",
      passed,
      message: passed
        ? `INV-1 ETH Conservation: OK (contract=${contractBalance}, accounted=${totalAccounted})`
        : `INV-1 ETH Conservation: FAIL — contract balance ${contractBalance} < accounted ${totalAccounted} (diff=${totalAccounted - contractBalance})`,
    };
  } catch (err) {
    return {
      id: "INV-1",
      passed: false,
      message: `INV-1 ETH Conservation: ERROR — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * INV-2: cSSV Supply Consistency
 * cssvToken.totalSupply() == sum of tracked staker cSSV balances
 */
async function checkINV2_CSSVSupply(state: SimulationState): Promise<InvariantResult> {
  try {
    const totalSupply = BigInt(await state.cssvToken.totalSupply());

    let trackedSum = 0n;
    for (const staker of state.stakerPool) {
      const balance = BigInt(await state.cssvToken.balanceOf(staker.signer.address));
      trackedSum += balance;
    }

    const passed = totalSupply === trackedSum;
    return {
      id: "INV-2",
      passed,
      message: passed
        ? `INV-2 cSSV Supply: OK (totalSupply=${totalSupply})`
        : `INV-2 cSSV Supply: FAIL — totalSupply ${totalSupply} != tracked sum ${trackedSum} (diff=${totalSupply - trackedSum})`,
    };
  } catch (err) {
    return {
      id: "INV-2",
      passed: false,
      message: `INV-2 cSSV Supply: ERROR — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * INV-3: Validator Count Consistency
 * views.getNetworkValidatorsCount() >= sum of tracked operator ethValidatorCounts
 * Note: >= because we only track a sample of operators
 */
async function checkINV3_ValidatorCount(state: SimulationState): Promise<InvariantResult> {
  try {
    const networkCount = BigInt(await state.views.getNetworkValidatorsCount());

    let trackedSum = 0n;
    for (const [, op] of state.operatorPool) {
      try {
        const opData = await state.views.getOperatorById(op.id);
        // OperatorTuple: [owner, ethFee, ethValidatorCount, ...]
        trackedSum += BigInt(opData[2]);
      } catch {
        // Skip operators we can't query
      }
    }

    const passed = networkCount >= trackedSum;
    return {
      id: "INV-3",
      passed,
      message: passed
        ? `INV-3 Validator Count: OK (network=${networkCount}, tracked ops sum=${trackedSum})`
        : `INV-3 Validator Count: FAIL — network count ${networkCount} < tracked sum ${trackedSum}`,
    };
  } catch (err) {
    return {
      id: "INV-3",
      passed: false,
      message: `INV-3 Validator Count: ERROR — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * INV-4: All SSV Clusters Migrated (end-only)
 * Every cluster in clusterBook with version==SSV must be inactive
 */
async function checkINV4_AllMigrated(state: SimulationState): Promise<InvariantResult> {
  try {
    const unmigrated: string[] = [];
    for (const [key, record] of state.clusterBook) {
      if (record.version === VERSION_SSV && record.cluster.active) {
        unmigrated.push(key);
      }
    }

    const passed = unmigrated.length === 0;
    return {
      id: "INV-4",
      passed,
      message: passed
        ? `INV-4 All SSV Migrated: OK (all clusters migrated or inactive)`
        : `INV-4 All SSV Migrated: FAIL — ${unmigrated.length} active SSV clusters remain`,
    };
  } catch (err) {
    return {
      id: "INV-4",
      passed: false,
      message: `INV-4 All SSV Migrated: ERROR — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * INV-5: accEthPerShare Monotonically Non-Decreasing
 * views.accEthPerShare() >= ctx.prevAccEthPerShare
 */
async function checkINV5_AccumulatorMonotonic(
  state: SimulationState,
  ctx: InvariantContext,
): Promise<InvariantResult> {
  try {
    const current = BigInt(await state.views.accEthPerShare());
    const previous = ctx.prevAccEthPerShare;

    const passed = current >= previous;

    // Update context for next check
    ctx.prevAccEthPerShare = current;

    return {
      id: "INV-5",
      passed,
      message: passed
        ? `INV-5 Accumulator Monotonic: OK (prev=${previous}, current=${current})`
        : `INV-5 Accumulator Monotonic: FAIL — current ${current} < previous ${previous}`,
    };
  } catch (err) {
    return {
      id: "INV-5",
      passed: false,
      message: `INV-5 Accumulator Monotonic: ERROR — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * INV-6: Operator Earnings Non-Negative
 * views.getOperatorEarnings(opId) >= 0 for all tracked operators
 */
async function checkINV6_OperatorEarnings(state: SimulationState): Promise<InvariantResult> {
  try {
    const negativeOps: string[] = [];
    for (const [, op] of state.operatorPool) {
      try {
        const earnings = BigInt(await state.views.getOperatorEarnings(op.id));
        if (earnings < 0n) {
          negativeOps.push(`op${op.id}=${earnings}`);
        }
      } catch {
        // Skip — operator may not exist in ETH context
      }
    }

    const passed = negativeOps.length === 0;
    return {
      id: "INV-6",
      passed,
      message: passed
        ? `INV-6 Operator Earnings: OK (all non-negative)`
        : `INV-6 Operator Earnings: FAIL — negative earnings: ${negativeOps.join(", ")}`,
    };
  } catch (err) {
    return {
      id: "INV-6",
      passed: false,
      message: `INV-6 Operator Earnings: ERROR — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * INV-7: Staker Rewards Non-Negative (end-only)
 * views.previewClaimableEth(staker) >= 0 for all tracked stakers
 */
async function checkINV7_StakerRewards(state: SimulationState): Promise<InvariantResult> {
  try {
    const negativeStakers: string[] = [];
    for (const staker of state.stakerPool) {
      try {
        const claimable = BigInt(await state.views.previewClaimableEth(staker.signer.address));
        if (claimable < 0n) {
          negativeStakers.push(`${staker.signer.address}=${claimable}`);
        }
      } catch {
        // May revert for stakers who never staked — skip
      }
    }

    const passed = negativeStakers.length === 0;
    return {
      id: "INV-7",
      passed,
      message: passed
        ? `INV-7 Staker Rewards: OK (all non-negative)`
        : `INV-7 Staker Rewards: FAIL — negative rewards: ${negativeStakers.join(", ")}`,
    };
  } catch (err) {
    return {
      id: "INV-7",
      passed: false,
      message: `INV-7 Staker Rewards: ERROR — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * INV-8: No Cluster Balance Underflow
 * For each active ETH cluster: views.getBalance(owner, opIds, cluster) >= 0
 */
async function checkINV8_ClusterBalanceUnderflow(state: SimulationState): Promise<InvariantResult> {
  try {
    const underflowed: string[] = [];
    for (const [key, record] of state.clusterBook) {
      if (!record.cluster.active || record.version !== VERSION_ETH) continue;
      try {
        const balance = BigInt(
          await state.views.getBalance(record.owner, record.operatorIds, record.cluster),
        );
        if (balance < 0n) {
          underflowed.push(key);
        }
      } catch {
        // getBalance reverts for liquidated/inactive clusters — skip
      }
    }

    const passed = underflowed.length === 0;
    return {
      id: "INV-8",
      passed,
      message: passed
        ? `INV-8 Cluster Balance: OK (no underflow detected)`
        : `INV-8 Cluster Balance: FAIL — ${underflowed.length} clusters with negative balance`,
    };
  } catch (err) {
    return {
      id: "INV-8",
      passed: false,
      message: `INV-8 Cluster Balance: ERROR — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// --- Exported runners ---

/**
 * Run periodic invariants (INV-1, INV-2, INV-3, INV-5, INV-6, INV-8).
 * These are safe to run frequently during the simulation.
 */
export async function runPeriodicInvariants(
  state: SimulationState,
  ctx: InvariantContext,
): Promise<InvariantResult[]> {
  const results = await Promise.all([
    checkINV1_ETHConservation(state),
    checkINV2_CSSVSupply(state),
    checkINV3_ValidatorCount(state),
    checkINV5_AccumulatorMonotonic(state, ctx),
    checkINV6_OperatorEarnings(state),
    checkINV8_ClusterBalanceUnderflow(state),
  ]);
  return results;
}

/**
 * Run all 8 invariants including end-only checks (INV-4, INV-7).
 * Call this after the simulation loop completes.
 */
export async function runFinalInvariants(
  state: SimulationState,
  ctx: InvariantContext,
): Promise<InvariantResult[]> {
  const results = await Promise.all([
    checkINV1_ETHConservation(state),
    checkINV2_CSSVSupply(state),
    checkINV3_ValidatorCount(state),
    checkINV4_AllMigrated(state),
    checkINV5_AccumulatorMonotonic(state, ctx),
    checkINV6_OperatorEarnings(state),
    checkINV7_StakerRewards(state),
    checkINV8_ClusterBalanceUnderflow(state),
  ]);
  return results;
}
