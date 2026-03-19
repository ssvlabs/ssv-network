import { expect } from "chai";

export interface BalanceSnapshot {
  eth: bigint;
  ssv: bigint;
  blockNumber: number;
}

export async function snapshotBalance(provider: any, ssvToken: any, address: string): Promise<BalanceSnapshot> {
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

export function assertBalanceDelta(before: BalanceSnapshot, after: BalanceSnapshot, expectedEthDelta: bigint, expectedSsvDelta: bigint, tolerance: bigint = 0n): void {
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

export async function snapshotContractBalance(provider: any, contractAddress: string): Promise<bigint> {
  return BigInt(await provider.getBalance(contractAddress));
}

export interface ETHDeltaCheck {
  address: string;
  expectedDelta: bigint;
  accountForGas?: boolean;
}

export interface ETHDeltaResult {
  receipt: any;
  deltas: Map<string, bigint>;
}

export async function expectETHDelta(
  provider: any,
  address: string,
  action: () => Promise<any>,
  expectedDelta: bigint,
  options?: { accountForGas?: boolean },
): Promise<any> {
  const result = await expectETHDeltas(provider, action, [
    { address, expectedDelta, accountForGas: options?.accountForGas },
  ]);
  return result.receipt;
}

export async function expectContractETHDelta(
  provider: any,
  contractAddress: string,
  action: () => Promise<any>,
  expectedDelta: bigint,
): Promise<any> {
  return expectETHDelta(provider, contractAddress, action, expectedDelta);
}

export async function expectETHDeltas(
  provider: any,
  action: () => Promise<any>,
  checks: ETHDeltaCheck[],
): Promise<ETHDeltaResult> {
  const balancesBefore = await Promise.all(
    checks.map(c => provider.getBalance(c.address).then((b: any) => BigInt(b))),
  );

  const result = await action();
  const receipt = result?.wait ? await result.wait() : result;

  const balancesAfter = await Promise.all(
    checks.map(c => provider.getBalance(c.address).then((b: any) => BigInt(b))),
  );

  let gasCost = 0n;
  if (receipt) {
    const gasPrice = BigInt(receipt.effectiveGasPrice ?? receipt.gasPrice);
    gasCost = BigInt(receipt.gasUsed) * gasPrice;
  }

  const deltas = new Map<string, bigint>();
  for (let i = 0; i < checks.length; i++) {
    let actual = balancesAfter[i] - balancesBefore[i];
    if (checks[i].accountForGas) {
      actual += gasCost;
    }
    deltas.set(checks[i].address, actual);
    expect(actual).to.equal(checks[i].expectedDelta);
  }

  return { receipt, deltas };
}
