export async function mineBlocks(provider: any, n: number): Promise<void> {
  await provider.send("hardhat_mine", ["0x" + n.toString(16)]);
}

export async function getBlockNumber(provider: any): Promise<number> {
  return provider.getBlockNumber();
}

export async function mineToBlock(provider: any, target: number): Promise<void> {
  const current = await getBlockNumber(provider);
  if (current < target) {
    await mineBlocks(provider, target - current);
  }
}

export async function getTxBlock(tx: any): Promise<number> {
  const receipt = await tx.wait();
  return receipt.blockNumber;
}

export async function setAccountBalance(provider: any, address: string, amount: bigint): Promise<void> {
  await provider.send("hardhat_setBalance", [address, "0x" + amount.toString(16)]);
}
