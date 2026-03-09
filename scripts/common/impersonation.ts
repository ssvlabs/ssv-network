// ── Fork impersonation helpers ──

async function trySend(provider: any, method: string, params: unknown[]) {
  try {
    await provider.send(method, params);
    return true;
  } catch {
    return false;
  }
}

export async function impersonate(provider: any, address: string) {
  const ok =
    (await trySend(provider, "hardhat_impersonateAccount", [address])) ||
    (await trySend(provider, "anvil_impersonateAccount", [address]));
  if (!ok) {
    throw new Error("Impersonation not supported by the RPC node");
  }
}

export async function setBalance(provider: any, address: string, balanceHex: string) {
  const ok =
    (await trySend(provider, "hardhat_setBalance", [address, balanceHex])) ||
    (await trySend(provider, "anvil_setBalance", [address, balanceHex]));
  if (!ok) {
    throw new Error("Setting balance not supported by the RPC node");
  }
}

const TOP_UP_BALANCE = "0x56bc75e2d63100000"; // 100 ETH

export async function getSignerForAddress(
  ethers: any,
  address: string,
  useGetImpersonatedSigner: boolean
): Promise<{ signer: any; impersonated: boolean }> {
  const signers = await ethers.getSigners();
  for (const signer of signers) {
    if ((await signer.getAddress()).toLowerCase() === address.toLowerCase()) {
      // Best-effort top up to avoid insufficient funds on forks
      await trySend(ethers.provider, "hardhat_setBalance", [address, TOP_UP_BALANCE]);
      await trySend(ethers.provider, "anvil_setBalance", [address, TOP_UP_BALANCE]);
      return { signer, impersonated: false };
    }
  }

  if (useGetImpersonatedSigner && typeof ethers.getImpersonatedSigner === "function") {
    try {
      const signer = await ethers.getImpersonatedSigner(address);
      await trySend(ethers.provider, "hardhat_setBalance", [address, TOP_UP_BALANCE]);
      await trySend(ethers.provider, "anvil_setBalance", [address, TOP_UP_BALANCE]);
      return { signer, impersonated: true };
    } catch {
      // Fall back to manual RPC impersonation
    }
  }

  await impersonate(ethers.provider, address);
  await setBalance(ethers.provider, address, TOP_UP_BALANCE);
  return { signer: await ethers.getSigner(address), impersonated: true };
}

/**
 * Determines if the current network supports impersonation (fork mode).
 */
export function canImpersonateOnNetwork(targetNetwork: string, rpcUrl?: string): boolean {
  const usesLocalRpc =
    !!rpcUrl && (rpcUrl.includes("127.0.0.1") || rpcUrl.includes("localhost"));
  return (
    targetNetwork.includes("hardhat") ||
    targetNetwork.includes("local") ||
    targetNetwork === "localhost" ||
    usesLocalRpc
  );
}

/**
 * Resolves the RPC URL for the given target network.
 */
export function resolveRpcUrl(targetNetwork: string): string | undefined {
  const isLocalNetwork = targetNetwork === "local" || targetNetwork.endsWith("_local");
  if (isLocalNetwork) return "http://127.0.0.1:8545";
  if (targetNetwork === "hoodi") return process.env.HOODI_RPC_URL;
  if (targetNetwork === "mainnet") return process.env.MAINNET_ETH_NODE_URL ?? process.env.MAINNET_RPC_URL;
  return undefined;
}
