import hre from "hardhat";

type ForkParams = {
  fork: {
    url: string;
    blockNumber?: number;
  };
};

export async function connectFork(blockNumber?: number) {
  return hre.network.connect({
    fork: {
      url: process.env.MAINNET_RPC_URL!,
      blockNumber,
    },
  } as ForkParams as any);
}