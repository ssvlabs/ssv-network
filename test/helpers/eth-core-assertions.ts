import { expect } from "chai";
import type { Cluster } from "../common/types.ts";
import { calcVUnits, defaultVUnits } from "./fee.ts";
import { checkETHConservation } from "./invariants.ts";

export type LiquidationExpectation = "healthy" | "threshold-edge" | "liquidatable" | "liquidated";

export async function getEffectiveVUnits(
  views: any,
  owner: string,
  operatorIds: Array<number | bigint>,
  cluster: Cluster,
): Promise<bigint> {
  const effectiveBalance = BigInt(
    await views.getEffectiveBalance(owner, operatorIds.map((id) => BigInt(id)), cluster),
  );
  if (effectiveBalance === 0n) {
    return defaultVUnits(cluster.validatorCount);
  }
  return calcVUnits(effectiveBalance);
}

export async function assertClusterLiquidationExpectation(
  views: any,
  owner: string,
  operatorIds: Array<number | bigint>,
  cluster: Cluster,
  expected: LiquidationExpectation,
): Promise<void> {
  if (expected === "liquidated") {
    expect(cluster.active).to.equal(false, "cluster should be inactive after liquidation");
    expect(cluster.balance).to.equal(0n, "liquidated cluster should have zero balance");
    return;
  }

  const liquidatable = await views.isLiquidatable(
    owner,
    operatorIds.map((id) => BigInt(id)),
    cluster,
  );
  expect(Boolean(liquidatable)).to.equal(
    expected === "liquidatable",
    `unexpected liquidatability for ${expected}`,
  );
}

export async function assertOperatorEarningsLowerBound(
  views: any,
  operatorId: bigint,
  minimumExpected: bigint,
): Promise<void> {
  const earnings = BigInt(await views.getOperatorEarnings(operatorId));
  expect(earnings).to.be.greaterThanOrEqual(
    minimumExpected,
    `operator ${operatorId} earnings below expected lower bound`,
  );
}

export async function assertFinalClusterETHConservation(params: {
  networkAddress: string;
  provider: any;
  views: any;
  trackedClusters: Array<{
    owner: string;
    operatorIds: bigint[];
    cluster: Cluster;
  }>;
}): Promise<void> {
  const clusterBalances: bigint[] = [];
  const uniqueOperators = new Set<bigint>();

  for (const tracked of params.trackedClusters) {
    if (tracked.cluster.active) {
      const balance = BigInt(
        await params.views.getBalance(tracked.owner, tracked.operatorIds, tracked.cluster),
      );
      clusterBalances.push(balance);
    }
    for (const operatorId of tracked.operatorIds) {
      uniqueOperators.add(operatorId);
    }
  }

  const operatorEarnings: bigint[] = [];
  for (const operatorId of uniqueOperators) {
    operatorEarnings.push(BigInt(await params.views.getOperatorEarnings(operatorId)));
  }

  const networkTotalEarnings = BigInt(await params.views.getNetworkEarnings());
  await checkETHConservation(
    params.networkAddress,
    params.provider,
    clusterBalances,
    operatorEarnings,
    networkTotalEarnings,
  );
}
