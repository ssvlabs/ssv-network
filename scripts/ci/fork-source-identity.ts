#!/usr/bin/env npx tsx
// Records and checks the identity of an upstream archive RPC before a fork run. Never prints the URL.
//
//   npx tsx scripts/ci/fork-source-identity.ts --rpc-env MAINNET_RPC_URL --expect-chain-id 1 \
//     [--block <n>] [--expect-block-hash <0x..>]
//
// The block (--block or FORK_BLOCK_NUMBER) and its pinned hash (--expect-block-hash or
// FORK_BLOCK_HASH) are both mandatory: chain id plus "some block" is not an identity.
// Upstream identity is Mainnet (1) or Hoodi (560048). A local Anvil/EDR fork intentionally reports
// 31337 and is not checked here.
//
// Provider and server errors are reported by stage and ethers error code only: their messages can
// embed the configured or redirected URL, credentials, or untrusted response payloads.
import { JsonRpcProvider } from 'ethers';

// Errors whose message is built here from validated values only and is safe to print in full.
class IdentityError extends Error {}

const args = process.argv.slice(2);
const KNOWN = new Set(['rpc-env', 'expect-chain-id', 'block', 'expect-block-hash']);
const opts: Record<string, string> = {};
for (let i = 0; i < args.length; i += 2) {
  const name = args[i].startsWith('--') ? args[i].slice(2) : '';
  const value = args[i + 1];
  if (!KNOWN.has(name) || name in opts || value === undefined || value.startsWith('--')) {
    // Name only a recognized flag; never echo argument values, which may carry secrets.
    const what = KNOWN.has(name) ? `--${name}` : `at position ${i + 1}`;
    console.error(`FORK SOURCE IDENTITY FAILED: bad argument ${what}`);
    process.exit(2);
  }
  opts[name] = value;
}
const opt = (name: string): string | undefined => opts[name];

async function main() {
  const rpcEnv = opt('rpc-env') ?? 'MAINNET_RPC_URL';
  const expectChainId = opt('expect-chain-id');
  const blockArg = opt('block') ?? process.env.FORK_BLOCK_NUMBER;
  const expectHash = (opt('expect-block-hash') ?? process.env.FORK_BLOCK_HASH)?.trim();

  if (!/^[A-Z_][A-Z0-9_]*$/.test(rpcEnv)) throw new IdentityError('--rpc-env must name an environment variable');
  const url = process.env[rpcEnv]?.trim();
  if (!url) throw new IdentityError(`${rpcEnv} is not set`);
  if (!expectChainId || !/^\d+$/.test(expectChainId)) {
    throw new IdentityError('--expect-chain-id is required (1 = Mainnet, 560048 = Hoodi)');
  }
  if (!blockArg || !/^\d+$/.test(blockArg.trim())) {
    throw new IdentityError('--block (or FORK_BLOCK_NUMBER) must be a pinned block number');
  }
  if (!expectHash || !/^0x[0-9a-fA-F]{64}$/.test(expectHash)) {
    throw new IdentityError('--expect-block-hash (or FORK_BLOCK_HASH) must be the pinned 32-byte block hash');
  }

  let stage = 'provider';
  let provider: JsonRpcProvider | undefined;
  try {
    provider = new JsonRpcProvider(url);
    stage = 'chainId';
    const { chainId } = await provider.getNetwork();
    stage = 'block';
    const block = await provider.getBlock(Number(blockArg));
    if (!block?.hash) throw new IdentityError(`block ${blockArg} not available from ${rpcEnv} (archive access required)`);

    console.log(`source=${rpcEnv} chainId=${chainId} block=${block.number} hash=${block.hash} timestamp=${block.timestamp}`);
    if (chainId !== BigInt(expectChainId)) {
      throw new IdentityError(`${rpcEnv} chainId ${chainId} != expected ${expectChainId}`);
    }
    if (expectHash.toLowerCase() !== block.hash.toLowerCase()) {
      throw new IdentityError(`block ${block.number} hash ${block.hash} != pinned ${expectHash}`);
    }
  } catch (err: any) {
    if (err instanceof IdentityError) throw err;
    const code = typeof err?.code === 'string' && /^[A-Z_]{1,40}$/.test(err.code) ? err.code : 'UNKNOWN';
    throw new IdentityError(`${rpcEnv} request failed at stage ${stage} (code ${code}); provider details withheld`);
  } finally {
    // Stops the provider's background network-detection retries so a failure cannot keep the process alive.
    provider?.destroy();
  }
}

main().catch((err) => {
  const message = err instanceof IdentityError ? err.message : 'unexpected error; details withheld';
  console.error(`FORK SOURCE IDENTITY FAILED: ${message}`);
  process.exit(1);
});
