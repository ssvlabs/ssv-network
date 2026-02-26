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

  expect(contractBalance).to.be.greaterThanOrEqual(totalAccounted);
}

export async function checkValidatorCountConsistency(
  views: any,
  operatorIds: bigint[],
): Promise<void> {
  let totalFromOperators = 0n;

  for (const opId of operatorIds) {
    const op = await views.getOperatorById(opId);
    totalFromOperators += BigInt(op[2]);
  }

  const daoValidatorCount = await views.getETHDaoValidatorCount();

  expect(BigInt(daoValidatorCount)).to.equal(totalFromOperators,);
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
