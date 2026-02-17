/**
 * Block advancement utilities for e2e tests.
 */

/** Advance exactly N blocks using hardhat_mine. */
export async function mineBlocks(provider: any, n: number): Promise<void> {
  await provider.send("hardhat_mine", ["0x" + n.toString(16)]);
}

/** Get current block number. */
export async function getBlockNumber(provider: any): Promise<number> {
  return provider.getBlockNumber();
}

/** Mine to a specific target block. Does nothing if already at or past target. */
export async function mineToBlock(provider: any, target: number): Promise<void> {
  const current = await getBlockNumber(provider);
  if (current < target) {
    await mineBlocks(provider, target - current);
  }
}

/** Get the block number a transaction was included in. */
export async function getTxBlock(tx: any): Promise<number> {
  const receipt = await tx.wait();
  return receipt.blockNumber;
}
