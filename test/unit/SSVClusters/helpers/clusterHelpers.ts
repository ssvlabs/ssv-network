export function makePublicKey(seed: number) {
  return `0x${seed.toString(16).padStart(96, "0")}`;
}

export function makeOperatorKey(seed: number) {
  return `0x${(seed + 1000).toString(16).padStart(96, "0")}`;
}

export async function registerOperators(network: any, owner: any, count: number) {
  const operatorIds: number[] = [];

  for (let i = 0; i < count; i += 1) {
    const tx = await network
      .connect(owner)
      .registerOperator(makeOperatorKey(i + 1), 0, false);
    await tx.wait();
    operatorIds.push(i + 1);
  }

  return operatorIds;
}
