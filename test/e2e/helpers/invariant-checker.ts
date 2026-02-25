import { expect } from "chai";

export async function checkETHConservation(
  contractAddress: string,
  provider: any,
  clusterBalances: bigint[],
  operatorEarnings: bigint[],
  stakingPool: bigint,
  daoETHEarnings: bigint,
): Promise<void> {
  const contractBalance = await provider.getBalance(contractAddress);

  const totalClusters = clusterBalances.reduce((sum, b) => sum + b, 0n);
  const totalOperators = operatorEarnings.reduce((sum, b) => sum + b, 0n);
  const totalAccounted = totalClusters + totalOperators + stakingPool + daoETHEarnings;

  expect(contractBalance).to.be.greaterThanOrEqual(
    totalAccounted,
    `INV-1 ETH Conservation: contract balance ${contractBalance} < accounted total ${totalAccounted}`,
  );
}

/**
 * INV-3: Validator Count Consistency.
 * For ETH clusters: ethDaoValidatorCount == sum(operator.ethValidatorCount) for given operators.
 *
 * @param views - SSVNetworkViews contract
 * @param operatorIds - array of operator IDs to check
 */
export async function checkValidatorCountConsistency(
  views: any,
  operatorIds: bigint[],
): Promise<void> {
  let totalFromOperators = 0n;

  for (const opId of operatorIds) {
    const op = await views.getOperatorById(opId);
    // OperatorTuple: [owner, ethFee, ethValidatorCount, whitelistedAddress, isPrivate, isActive]
    totalFromOperators += BigInt(op[2]);
  }

  const daoValidatorCount = await views.getETHDaoValidatorCount();

  expect(BigInt(daoValidatorCount)).to.equal(
    totalFromOperators,
    `INV-3 Validator Count: DAO count ${daoValidatorCount} != sum of operator counts ${totalFromOperators}`,
  );
}

/**
 * INV-6: cSSV Supply == sum of staked SSV (mint/burn correctness).
 *
 * @param cssvToken - CSSVToken contract
 * @param views - SSVNetworkViews contract (for getTotalStakedSSV if available)
 * @param expectedTotalStaked - expected total staked SSV (from test bookkeeping)
 */
export async function checkCSSVSupplyConsistency(
  cssvToken: any,
  expectedTotalStaked: bigint,
): Promise<void> {
  const totalSupply = await cssvToken.totalSupply();

  expect(BigInt(totalSupply)).to.equal(
    expectedTotalStaked,
    `INV-6 cSSV Supply: totalSupply ${totalSupply} != expected staked ${expectedTotalStaked}`,
  );
}

/**
 * INV-7: accEthPerShare monotonically increases.
 *
 * @param previous - previous accEthPerShare value
 * @param current - current accEthPerShare value
 */
export function checkAccumulatorMonotonicity(
  previous: bigint,
  current: bigint,
): void {
  expect(current).to.be.greaterThanOrEqual(
    previous,
    `INV-7 Accumulator Monotonicity: current ${current} < previous ${previous}`,
  );
}

/**
 * INV-8: latestCommittedBlock monotonically increases.
 *
 * @param previous - previous latestCommittedBlock
 * @param current - current latestCommittedBlock
 */
export function checkOracleBlockMonotonicity(
  previous: bigint,
  current: bigint,
): void {
  expect(current).to.be.greaterThan(
    previous,
    `INV-8 Oracle Block Monotonicity: current ${current} <= previous ${previous}`,
  );
}
