import { expect } from "chai";

/**
 * Tracks a cluster for validator count consistency checks
 */
export interface TrackedCluster {
  owner: string;
  operatorIds: bigint[];
  validatorCount: bigint;
  active: boolean;
}

/**
 * Checks the ETH conservation invariant (see SPEC.md §11.1):
 *
 * contract.ETH_balance ≈ Σ(current ETH cluster balances)
 *                      + Σ(current operator ETH earnings)
 *                      + ProtocolLib.networkTotalEarnings()
 *
 * Where networkTotalEarnings() = ethDaoBalance + pending network fees.
 *
 */
export async function checkETHConservation(
  contractAddress: string,
  provider: any,
  clusterBalances: bigint[],
  operatorEarnings: bigint[],
  networkTotalEarnings: bigint,
): Promise<void> {
  const contractBalance = await provider.getBalance(contractAddress);

  const totalClusters = clusterBalances.reduce((sum, b) => sum + b, 0n);
  const totalOperators = operatorEarnings.reduce((sum, b) => sum + b, 0n);
  const totalAccounted = totalClusters + totalOperators + networkTotalEarnings;

  expect(contractBalance).to.be.greaterThanOrEqual(totalAccounted);
}

/**
 * Checks the validator count invariant: ethDaoValidatorCount == Σ(active cluster.validatorCount)
 *
 * IMPORTANT: This requires test-side tracking of all clusters because the contract
 * does not expose an iterator over clusters. Pass all clusters created during the test.
 *
 * NOTE: Σ(operator.ethValidatorCount) is NOT equivalent because operators are shared
 * across clusters and would overcount validators (see SPEC.md §11.3).
 */
export async function checkValidatorCountConsistency(
  views: any,
  trackedClusters: TrackedCluster[],
): Promise<void> {
  // Sum validators from active clusters only
  let expectedValidatorCount = 0n;
  for (const cluster of trackedClusters) {
    if (cluster.active) {
      expectedValidatorCount += cluster.validatorCount;
    }
  }

  const daoValidatorCount = await views.getNetworkValidatorsCount();

  expect(BigInt(daoValidatorCount)).to.equal(
    expectedValidatorCount,
    "ethDaoValidatorCount must equal sum of active cluster validator counts"
  );
}

export async function checkCSSVSupplyConsistency(
  cssvToken: any,
  expectedTotalStaked: bigint,
): Promise<void> {
  const totalSupply = await cssvToken.totalSupply();

  expect(BigInt(totalSupply)).to.equal(expectedTotalStaked);
}

export function checkAccumulatorMonotonicity(
  previous: bigint,
  current: bigint,
): void {
  expect(current).to.be.greaterThanOrEqual(previous);
}

export function checkOracleBlockMonotonicity(
  previous: bigint,
  current: bigint,
): void {
  expect(current).to.be.greaterThan(previous);
}
