import { expect } from "chai";

export interface BalanceSnapshot {
  eth: bigint;
  ssv: bigint;
  blockNumber: number;
}

export async function snapshotBalance(
  provider: any,
  ssvToken: any,
  address: string,
): Promise<BalanceSnapshot> {
  const [eth, ssv, blockNumber] = await Promise.all([
    provider.getBalance(address),
    ssvToken.balanceOf(address),
    provider.getBlockNumber(),
  ]);

  return {
    eth: BigInt(eth),
    ssv: BigInt(ssv),
    blockNumber,
  };
}

export function assertBalanceDelta(
  before: BalanceSnapshot,
  after: BalanceSnapshot,
  expectedEthDelta: bigint,
  expectedSsvDelta: bigint,
  tolerance: bigint = 0n,
): void {
  const ethDelta = after.eth - before.eth;
  const ssvDelta = after.ssv - before.ssv;

  if (tolerance === 0n) {
    expect(ethDelta).to.equal(expectedEthDelta);
    expect(ssvDelta).to.equal(expectedSsvDelta);
  } else {
    const ethDiff = ethDelta - expectedEthDelta;
    expect(ethDiff >= -tolerance && ethDiff <= tolerance).to.be.true;

    const ssvDiff = ssvDelta - expectedSsvDelta;
    expect(ssvDiff >= -tolerance && ssvDiff <= tolerance).to.be.true;
  }
}

export async function snapshotContractBalance(
  provider: any,
  contractAddress: string,
): Promise<bigint> {
  return BigInt(await provider.getBalance(contractAddress));
}
