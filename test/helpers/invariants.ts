import { expect } from "chai";

export interface TrackedCluster {
  owner: string;
  operatorIds: bigint[];
  validatorCount: bigint;
  active: boolean;
}

export async function checkETHConservation(contractAddress: string, provider: any, clusterBalances: bigint[], operatorEarnings: bigint[], networkTotalEarnings: bigint): Promise<void> {
  const contractBalance = await provider.getBalance(contractAddress);
  const totalClusters = clusterBalances.reduce((sum, b) => sum + b, 0n);
  const totalOperators = operatorEarnings.reduce((sum, b) => sum + b, 0n);
  const totalAccounted = totalClusters + totalOperators + networkTotalEarnings;
  expect(contractBalance).to.be.greaterThanOrEqual(totalAccounted);
}

export async function checkValidatorCountConsistency(views: any, trackedClusters: TrackedCluster[]): Promise<void> {
  let expectedValidatorCount = 0n;
  for (const cluster of trackedClusters) {
    if (cluster.active) {
      expectedValidatorCount += cluster.validatorCount;
    }
  }
  const daoValidatorCount = await views.getNetworkValidatorsCount();
  expect(BigInt(daoValidatorCount)).to.equal(expectedValidatorCount, "ethDaoValidatorCount must equal sum of active cluster validator counts");
}

export async function checkCSSVSupplyConsistency(cssvToken: any, expectedTotalStaked: bigint): Promise<void> {
  const totalSupply = await cssvToken.totalSupply();
  expect(BigInt(totalSupply)).to.equal(expectedTotalStaked);
}

export function checkAccumulatorMonotonicity(previous: bigint, current: bigint): void {
  expect(current).to.be.greaterThanOrEqual(previous);
}

export function checkOracleBlockMonotonicity(previous: bigint, current: bigint): void {
  expect(current).to.be.greaterThan(previous);
}

export async function assertOperatorVUnits(contract: any, operatorIds: bigint[], deviation: bigint, effective?: bigint): Promise<void> {
  for (const operatorId of operatorIds) {
    expect(await contract.getOperatorEthVUnits(operatorId)).to.equal(deviation);
    if (effective !== undefined) {
      expect(await contract.getEffectiveOperatorVUnits(operatorId)).to.equal(effective);
    }
  }
}
