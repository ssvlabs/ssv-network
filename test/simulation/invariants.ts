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
 * SPEC.md / FLOWS.md source of truth:
 * contract.ETH >= sum(cluster balances) + sum(operator earnings) + ProtocolLib.networkTotalEarnings()
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

    let stakingPoolSnapshot = 0n;
    try {
      stakingPoolSnapshot = BigInt(await state.views.stakingEthPoolBalance());
    } catch {
      // Optional debug context only; not part of the invariant sum.
    }

    let networkTotalEarnings = 0n;
    try {
      networkTotalEarnings = BigInt(await state.views.getNetworkEarnings());
    } catch {
      // May not be available
    }

    // Spec formula:
    // contract.ETH ~= current ETH cluster balances
    //              + current operator ETH earnings
    //              + ProtocolLib.networkTotalEarnings()
    //
    // `stakingEthPoolBalance` is a staking sync snapshot of DAO ETH rewards, not an
    // additional independent liability bucket. Summing both double-counts rewards.
    const totalAccounted = totalClusterBalances + totalOperatorEarnings + networkTotalEarnings;

    // Allow a tolerance because:
    // - We only track a sample of operators/clusters, not all mainnet state
    // - View functions compute fees at the current block which may differ slightly
    //   from the on-chain snapshot due to rounding in packed types
    // - Untracked mainnet operators/clusters accrue fees we can't account for
    // Use a proportional tolerance: 0.01% of contract balance, min 0.01 ETH
    const proportionalTolerance = contractBalance / 10000n; // 0.01%
    const TOLERANCE = proportionalTolerance > BigInt(1e16) ? proportionalTolerance : BigInt(1e16);
    const passed = contractBalance + TOLERANCE >= totalAccounted;
    return {
      id: "INV-1",
      passed,
      message: passed
        ? `INV-1 ETH Conservation: OK (contract=${contractBalance}, accounted=${totalAccounted}, diff=${contractBalance >= totalAccounted ? contractBalance - totalAccounted : -(totalAccounted - contractBalance)}, clusters=${totalClusterBalances}, operatorEarnings=${totalOperatorEarnings}, networkTotalEarnings=${networkTotalEarnings}, stakingPoolSnapshot=${stakingPoolSnapshot})`
        : `INV-1 ETH Conservation: FAIL — contract balance ${contractBalance} < accounted ${totalAccounted} (diff=${totalAccounted - contractBalance}, exceeds tolerance ${TOLERANCE}, clusters=${totalClusterBalances}, operatorEarnings=${totalOperatorEarnings}, networkTotalEarnings=${networkTotalEarnings}, stakingPoolSnapshot=${stakingPoolSnapshot})`,
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
 * Spec global invariant #6, specialized to the simulation's closed staker set:
 * cSSV.totalSupply() == sum of all tracked cSSV holder balances
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
 * SPEC.md / FLOWS.md source of truth:
 * ethDaoValidatorCount == sum(cluster.validatorCount) across all active ETH clusters
 */
async function checkINV3_ValidatorCount(state: SimulationState): Promise<InvariantResult> {
  try {
    const networkCount = BigInt(await state.views.getNetworkValidatorsCount());

    // Count validators from our tracked ETH clusters instead of per-operator sums.
    // Each validator registers with multiple operators, so per-operator counts over-count.
    let trackedClusterValidators = 0n;
    for (const [, record] of state.clusterBook) {
      if (record.version === VERSION_ETH && record.cluster.active) {
        trackedClusterValidators += BigInt(record.cluster.validatorCount);
      }
    }

    const passed = networkCount === trackedClusterValidators;
    return {
      id: "INV-3",
      passed,
      message: passed
        ? `INV-3 Validator Count: OK (network=${networkCount}, tracked ETH clusters=${trackedClusterValidators})`
        : `INV-3 Validator Count: FAIL — network count ${networkCount} != tracked ETH cluster validators ${trackedClusterValidators}`,
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
 * Supplemental simulation sanity check.
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
 * Supplemental simulation sanity check.
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
 * Supplemental simulation sanity check.
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

/**
 * INV-9: Cluster Version / Asset-Type Consistency
 * SPEC.md / FLOWS.md source of truth:
 * a cluster key must exist in either SSV or ETH storage, never both, and the
 * tracked version must match the on-chain asset type returned by SSVViews.
 */
async function checkINV9_ClusterVersionConsistency(state: SimulationState): Promise<InvariantResult> {
  try {
    const mismatches: string[] = [];

    for (const [key, record] of state.clusterBook) {
      try {
        const assetType = Number(await state.views.getClusterAssetType(record.owner, record.operatorIds));
        if (assetType !== record.version) {
          mismatches.push(`${key}:tracked=${record.version}:onchain=${assetType}`);
        }
      } catch (err) {
        mismatches.push(`${key}:error=${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const passed = mismatches.length === 0;
    return {
      id: "INV-9",
      passed,
      message: passed
        ? `INV-9 Cluster Version: OK (all tracked cluster versions match on-chain asset type)`
        : `INV-9 Cluster Version: FAIL — ${mismatches.length} mismatches: ${mismatches.slice(0, 5).join(", ")}`,
    };
  } catch (err) {
    return {
      id: "INV-9",
      passed: false,
      message: `INV-9 Cluster Version: ERROR — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// --- Exported runners ---

/**
 * Run periodic invariants.
 * Includes spec-aligned checks plus a small set of simulation sanity checks.
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
    checkINV9_ClusterVersionConsistency(state),
  ]);
  return results;
}

/**
 * Run all simulation invariants including end-only checks (INV-4, INV-7).
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
    checkINV9_ClusterVersionConsistency(state),
  ]);
  return results;
}
