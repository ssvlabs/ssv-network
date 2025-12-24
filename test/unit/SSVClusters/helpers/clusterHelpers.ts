import { ClusterStruct } from "../types/cluster.js";

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

export function asClusterStruct(cluster: any): ClusterStruct {
  return {
    validatorCount: BigInt(cluster.validatorCount),
    networkFeeIndex: BigInt(cluster.networkFeeIndex),
    index: BigInt(cluster.index),
    balance: BigInt(cluster.balance),
    active: Boolean(cluster.active),
  };
}

export function mustEmitEvent(receipt: any, network: any, eventName: string) {
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = network.interface.parseLog(log);
      if (parsed?.name === eventName) {
        return parsed;
      }
    } catch {
      // skip non-matching logs
    }
  }
  throw new Error(`${eventName} event not found in transaction receipt`);
}

export function mustNotEmitEvent(receipt: any, network: any, eventName: string) {
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = network.interface.parseLog(log);
      if (parsed?.name === eventName) {
        throw new Error(`${eventName} event was unexpectedly emitted in transaction receipt`);
      }
    } catch (error) {
      // If it's our error, rethrow it
      if (error instanceof Error && error.message.includes("unexpectedly emitted")) {
        throw error;
      }
      // skip non-matching logs
    }
  }
}
