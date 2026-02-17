/**
 * Lightweight snapshot-and-diff utility for ETH and SSV balances.
 */

import { expect } from "chai";

export interface BalanceSnapshot {
  eth: bigint;
  ssv: bigint;
  blockNumber: number;
}

/** Take a snapshot of an address's ETH and SSV balances. */
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

/**
 * Assert the delta between two snapshots matches expected values.
 *
 * @param before - snapshot before the operation
 * @param after - snapshot after the operation
 * @param expectedEthDelta - expected ETH change (positive = increase, negative = decrease)
 * @param expectedSsvDelta - expected SSV change
 * @param tolerance - default 0n for exact match, or small value for gas cost tolerance
 */
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
    expect(ethDelta).to.equal(
      expectedEthDelta,
      `ETH delta mismatch: got ${ethDelta}, expected ${expectedEthDelta}`,
    );
    expect(ssvDelta).to.equal(
      expectedSsvDelta,
      `SSV delta mismatch: got ${ssvDelta}, expected ${expectedSsvDelta}`,
    );
  } else {
    const ethDiff = ethDelta - expectedEthDelta;
    expect(ethDiff >= -tolerance && ethDiff <= tolerance).to.be.true;

    const ssvDiff = ssvDelta - expectedSsvDelta;
    expect(ssvDiff >= -tolerance && ssvDiff <= tolerance).to.be.true;
  }
}

/** Snapshot the contract's ETH balance. */
export async function snapshotContractBalance(
  provider: any,
  contractAddress: string,
): Promise<bigint> {
  return BigInt(await provider.getBalance(contractAddress));
}
