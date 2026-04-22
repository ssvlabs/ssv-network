import "dotenv/config";

import { readFile } from "node:fs/promises";
import {
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  ZeroAddress,
  formatEther,
  keccak256,
} from "ethers";

import {
  LOCAL_FORK_RPC_URL,
  loadConfig,
  parseOptionalArg,
  resolveNetworkFromEnv,
} from "./common/config.ts";

type CheckStatus = "PASS" | "FAIL" | "WARN" | "SKIP";

type CheckResult = {
  status: CheckStatus;
  message: string;
};

type OperationName = "stake" | "requestUnstake";

type DecodedStakingCall = {
  kind: "direct" | "safe";
  method: OperationName;
  networkTarget: string;
  logicalCaller: string;
  tokenAmount: bigint;
  outerTo: string | null;
};

type PendingUnstake = {
  amount: bigint;
  unlockTime: bigint;
};

const DEFAULT_FROM_BLOCK = 24_920_727;
const STAKING_STORAGE_SLOT = 0x42a40d4f240cbf0c19443bafd2ba44f8a87081a52700ad1ed0edd76039240dbcn;
const USER_INDEX_SLOT = STAKING_STORAGE_SLOT + 1n;
const ACCRUED_SLOT = STAKING_STORAGE_SLOT + 2n;
const PRECISION = 10n ** 18n;
const SUPPORTED_METHODS = new Set<OperationName>(["stake", "requestUnstake"]);

function usage(): void {
  console.log(
    [
      "Usage: npx tsx scripts/check-mainnet-staking.ts [--env mainnet] [--network <mainnet|local>] [--rpc-url <url>] [--from-block <n>] [--to-block <n>] [txHash ...]",
      "",
      "Current scope:",
      "- stake(uint256)",
      "- requestUnstake(uint256)",
      "",
      "Defaults:",
      `- env: mainnet`,
      `- network: resolved from env, or mainnet`,
      `- rpc-url: MAINNET_RPC_URL or http://127.0.0.1:8545`,
      `- from-block: ${DEFAULT_FROM_BLOCK} (upgrade block)`,
      `- to-block: latest`,
      `- tx hashes: if omitted, discovered by scanning block transactions for supported function calls`,
    ].join("\n")
  );
}

function normalizeAddress(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function formatWei(value: bigint): string {
  return `${value.toString()} wei (${formatEther(value)} ETH)`;
}

function formatToken18(value: bigint, symbol: string): string {
  return `${value.toString()} base-units (${formatEther(value)} ${symbol})`;
}

function toBlockHex(blockNumber: number): string {
  return `0x${blockNumber.toString(16)}`;
}

function toQuantityHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function push(results: CheckResult[], status: CheckStatus, message: string): void {
  results.push({ status, message });
}

function printResults(results: CheckResult[]): void {
  for (const result of results) {
    const prefix =
      result.status === "PASS"
        ? "[PASS]"
        : result.status === "FAIL"
          ? "[FAIL]"
          : result.status === "WARN"
            ? "[WARN]"
            : "[SKIP]";
    console.log(`  ${prefix} ${result.message}`);
  }
}

function shortError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function loadAbi(path: string): Promise<any[]> {
  return JSON.parse(await readFile(path, "utf8")) as any[];
}

async function getRawBlock(provider: JsonRpcProvider, blockNumber: number): Promise<any> {
  return provider.send("eth_getBlockByNumber", [toBlockHex(blockNumber), true]);
}

function getPositionalTxHashes(argv: string[]): string[] {
  const txHashes: string[] = [];
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env" || arg === "--rpc-url" || arg === "--network" || arg === "--from-block" || arg === "--to-block") {
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") continue;
    if (arg.startsWith("--")) continue;
    if (arg.endsWith(".ts")) continue;
    txHashes.push(arg);
  }
  return txHashes;
}

function resolveRpcUrl(network: string | undefined, explicitRpcUrl: string | undefined): string {
  if (explicitRpcUrl) return explicitRpcUrl;

  if (!network || network === "mainnet") {
    return process.env.MAINNET_RPC_URL ?? LOCAL_FORK_RPC_URL;
  }
  if (network === "local") {
    return LOCAL_FORK_RPC_URL;
  }

  throw new Error(`Unsupported network '${network}'. Use --network mainnet|local or pass --rpc-url.`);
}

function parseBlockArg(value: string | undefined, label: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${label}: '${value}'`);
  }
  return Number(value);
}

function parsePendingUnstakes(items: readonly any[]): PendingUnstake[] {
  return items.map((item) => ({
    amount: BigInt(item.amount),
    unlockTime: BigInt(item.unlockTime),
  }));
}

function pendingKey(item: PendingUnstake): string {
  return `${item.amount}:${item.unlockTime}`;
}

function diffPending(post: readonly PendingUnstake[], pre: readonly PendingUnstake[]): PendingUnstake[] {
  const counts = new Map<string, number>();
  for (const item of pre) {
    const key = pendingKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const added: PendingUnstake[] = [];
  for (const item of post) {
    const key = pendingKey(item);
    const count = counts.get(key) ?? 0;
    if (count > 0) {
      counts.set(key, count - 1);
    } else {
      added.push(item);
    }
  }
  return added;
}

function decodeSupportedMethod(parsed: ReturnType<Interface["parseTransaction"]> | null): OperationName | null {
  if (!parsed) return null;
  if (parsed.name === "stake" || parsed.name === "requestUnstake") {
    return parsed.name;
  }
  return null;
}

function tryDecodeAnyNetworkCall(
  rawTx: any,
  networkAddress: string,
  networkInterface: Interface,
  safeInterface: Interface,
): { name: string; kind: "direct" | "safe" } | null {
  if (normalizeAddress(rawTx.to) === normalizeAddress(networkAddress)) {
    try {
      const parsed = networkInterface.parseTransaction({ data: rawTx.input ?? rawTx.data, value: rawTx.value });
      if (parsed) return { name: parsed.name, kind: "direct" };
    } catch {
      // Ignore unknown selectors.
    }
  }

  try {
    const wrapped = safeInterface.parseTransaction({ data: rawTx.input ?? rawTx.data, value: rawTx.value });
    if (!wrapped || wrapped.name !== "execTransaction") return null;
    if (normalizeAddress(String(wrapped.args.to)) !== normalizeAddress(networkAddress)) return null;
    const nested = networkInterface.parseTransaction({
      data: wrapped.args.data,
      value: wrapped.args.value,
    });
    if (!nested) return null;
    return { name: nested.name, kind: "safe" };
  } catch {
    return null;
  }
}

function decodeStakingCall(
  tx: any,
  networkAddress: string,
  networkInterface: Interface,
  safeInterface: Interface,
): DecodedStakingCall {
  if (normalizeAddress(tx.to) === normalizeAddress(networkAddress)) {
    const direct = networkInterface.parseTransaction({ data: tx.data, value: tx.value });
    const method = decodeSupportedMethod(direct);
    if (method) {
      return {
        kind: "direct",
        method,
        networkTarget: String(tx.to),
        logicalCaller: String(tx.from),
        tokenAmount: BigInt(direct!.args[0]),
        outerTo: tx.to ? String(tx.to) : null,
      };
    }
  }

  const wrapped = safeInterface.parseTransaction({ data: tx.data, value: tx.value });
  if (!wrapped || wrapped.name !== "execTransaction") {
    throw new Error(`Failed to decode tx input: ${tx.hash}`);
  }
  const nestedTarget = String(wrapped.args.to);
  if (normalizeAddress(nestedTarget) !== normalizeAddress(networkAddress)) {
    throw new Error(`Unsupported wrapped call target ${nestedTarget} for tx ${tx.hash}`);
  }
  const nested = networkInterface.parseTransaction({
    data: wrapped.args.data,
    value: wrapped.args.value,
  });
  const method = decodeSupportedMethod(nested);
  if (!method) {
    throw new Error(`Wrapped tx does not contain a supported staking function: ${tx.hash}`);
  }

  return {
    kind: "safe",
    method,
    networkTarget: nestedTarget,
    logicalCaller: String(tx.to),
    tokenAmount: BigInt(nested!.args[0]),
    outerTo: tx.to ? String(tx.to) : null,
  };
}

async function discoverStakingTxHashes(
  provider: JsonRpcProvider,
  networkAddress: string,
  networkInterface: Interface,
  safeInterface: Interface,
  fromBlock: number,
  toBlock: number,
): Promise<string[]> {
  const txHashes: string[] = [];
  const seen = new Set<string>();

  for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += 1) {
    const block = await getRawBlock(provider, blockNumber);
    const transactions = Array.isArray(block?.transactions) ? block.transactions : [];
    for (const tx of transactions) {
      const decoded = tryDecodeAnyNetworkCall(tx, networkAddress, networkInterface, safeInterface);
      if (!decoded || !SUPPORTED_METHODS.has(decoded.name as OperationName)) continue;
      const txHash = String(tx.hash);
      if (seen.has(txHash)) continue;
      seen.add(txHash);
      txHashes.push(txHash);
    }
  }

  return txHashes;
}

async function getTokenTransferAmountFromReceipt(
  tokenInterface: Interface,
  logs: readonly any[],
  tokenAddress: string,
  from: string,
  to: string,
): Promise<bigint> {
  let total = 0n;
  const tokenAddressNorm = normalizeAddress(tokenAddress);
  const fromNorm = normalizeAddress(from);
  const toNorm = normalizeAddress(to);

  for (const log of logs) {
    if (normalizeAddress(log.address) !== tokenAddressNorm) continue;
    try {
      const parsed = tokenInterface.parseLog(log);
      if (!parsed || parsed.name !== "Transfer") continue;
      if (normalizeAddress(parsed.args.from) !== fromNorm) continue;
      if (normalizeAddress(parsed.args.to) !== toNorm) continue;
      total += BigInt(parsed.args.value);
    } catch {
      // Ignore non-ERC20 logs.
    }
  }

  return total;
}

async function readUint256StorageAt(
  provider: JsonRpcProvider,
  address: string,
  slot: bigint,
  blockTag: number,
): Promise<bigint> {
  const raw = await provider.send("eth_getStorageAt", [address, toQuantityHex(slot), toBlockHex(blockTag)]);
  return BigInt(raw);
}

function mappingSlot(addressKey: string, slot: bigint): bigint {
  const encoded = AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [addressKey, slot]);
  return BigInt(keccak256(encoded));
}

async function getUserIndexAt(
  provider: JsonRpcProvider,
  networkAddress: string,
  user: string,
  blockTag: number,
): Promise<bigint> {
  return readUint256StorageAt(provider, networkAddress, mappingSlot(user, USER_INDEX_SLOT), blockTag);
}

async function getAccruedAt(
  provider: JsonRpcProvider,
  networkAddress: string,
  user: string,
  blockTag: number,
): Promise<bigint> {
  return readUint256StorageAt(provider, networkAddress, mappingSlot(user, ACCRUED_SLOT), blockTag);
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }

  const env = parseOptionalArg("env") ?? "mainnet";
  const network = parseOptionalArg("network") ?? resolveNetworkFromEnv(env) ?? "mainnet";
  const rpcUrl = resolveRpcUrl(network, parseOptionalArg("rpc-url"));
  const fromBlock = parseBlockArg(parseOptionalArg("from-block"), "from-block", DEFAULT_FROM_BLOCK);
  const positional = getPositionalTxHashes(process.argv);

  const config = await loadConfig(env);
  const networkAddress = config.ssvNetworkProxy;
  const viewsAddress = config.ssvNetworkViews;
  const tokenAddress = config.ssvToken;
  const cssvAddress = config.cssvToken;

  if (!networkAddress || !viewsAddress || !tokenAddress || !cssvAddress) {
    throw new Error(`Missing one of ssvNetworkProxy/ssvNetworkViews/ssvToken/cssvToken in deployments/${env}/config.json`);
  }

  const [networkAbi, viewsAbi] = await Promise.all([
    loadAbi("abis/SSVNetwork.json"),
    loadAbi("abis/SSVNetworkViews.json"),
  ]);

  const provider = new JsonRpcProvider(rpcUrl);
  const [networkCode, viewsCode] = await Promise.all([
    provider.getCode(networkAddress),
    provider.getCode(viewsAddress),
  ]);
  if (networkCode === "0x") throw new Error(`No code at SSVNetwork proxy ${networkAddress} via ${rpcUrl}`);
  if (viewsCode === "0x") throw new Error(`No code at SSVNetworkViews ${viewsAddress} via ${rpcUrl}`);

  const views = new Contract(viewsAddress, viewsAbi, provider);
  const networkInterface = new Interface(networkAbi);
  const safeInterface = new Interface([
    "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures)",
  ]);
  const erc20Interface = new Interface([
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  ]);

  const latestBlock = await provider.getBlockNumber();
  const toBlock = parseBlockArg(parseOptionalArg("to-block"), "to-block", latestBlock);
  if (fromBlock > toBlock) {
    throw new Error(`Invalid block range: from-block ${fromBlock} is greater than to-block ${toBlock}`);
  }

  const txHashes = positional.length > 0
    ? positional
    : await discoverStakingTxHashes(provider, networkAddress, networkInterface, safeInterface, fromBlock, toBlock);

  let failed = false;

  console.log(`RPC: ${rpcUrl}`);
  console.log(`Config: deployments/${env}/config.json`);
  console.log(`Provider network: ${network}`);
  console.log(`Block range: ${fromBlock}..${toBlock}`);
  console.log(`Network: ${networkAddress}`);
  console.log(`Views:   ${viewsAddress}`);
  console.log(`SSV:     ${tokenAddress}`);
  console.log(`cSSV:    ${cssvAddress}`);
  console.log(`Supported ops: stake, requestUnstake`);
  console.log(`Transactions found: ${txHashes.length}`);
  console.log("");

  if (txHashes.length === 0) {
    console.log("No supported staking transactions found in the selected block range.");
    return;
  }

  for (const txHash of txHashes) {
    const tx = await provider.getTransaction(txHash);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!tx || !receipt) {
      throw new Error(`Transaction not found: ${txHash}`);
    }

    const results: CheckResult[] = [];
    const blockNumber = receipt.blockNumber;
    const block = await getRawBlock(provider, blockNumber);
    const blockTransactions = Array.isArray(block?.transactions) ? block.transactions : [];
    const targetIndex = blockTransactions.findIndex((item: any) => normalizeAddress(item.hash) === normalizeAddress(txHash));
    if (targetIndex === -1) {
      throw new Error(`Target tx ${txHash} not found inside raw block payload ${blockNumber}`);
    }
    const targetTxIndex = Number(blockTransactions[targetIndex].transactionIndex);
    const networkBlockTxs = blockTransactions
      .map((item: any) => ({
        item,
        decoded: tryDecodeAnyNetworkCall(item, networkAddress, networkInterface, safeInterface),
      }))
      .filter((entry) => entry.decoded !== null);
    const earlierNetworkTxs = networkBlockTxs.filter(
      ({ item }) => Number(item.transactionIndex) < targetTxIndex,
    );
    const laterNetworkTxs = networkBlockTxs.filter(
      ({ item }) => Number(item.transactionIndex) > targetTxIndex,
    );
    const isolatedNetworkTx = networkBlockTxs.length === 1;

    console.log(txHash);
    console.log(`  block=${blockNumber} txIndex=${targetTxIndex} from=${tx.from} value=${formatWei(tx.value)}`);

    const decoded = decodeStakingCall(tx, networkAddress, networkInterface, safeInterface);
    const owner = decoded.logicalCaller;
    const preBlock = blockNumber - 1;

    push(
      results,
      normalizeAddress(decoded.networkTarget) === normalizeAddress(networkAddress) ? "PASS" : "FAIL",
      `call target ${decoded.networkTarget} ${normalizeAddress(decoded.networkTarget) === normalizeAddress(networkAddress) ? "matches" : "does not match"} configured SSVNetwork proxy`,
    );
    push(
      results,
      "PASS",
      `decoded function is ${decoded.method}${decoded.kind === "safe" ? " via Safe.execTransaction" : ""}`,
    );
    if (decoded.kind === "safe") {
      push(
        results,
        "WARN",
        `wrapped call: outer tx target ${decoded.outerTo}, effective caller ${decoded.logicalCaller}`,
      );
    }
    if (networkBlockTxs.length > 1) {
      push(
        results,
        "WARN",
        `block contains ${networkBlockTxs.length} SSVNetwork txs; exact pre/post staking state checks are limited`,
      );
    }

    const parsedLogs = receipt.logs.flatMap((log) => {
      try {
        const parsed = networkInterface.parseLog(log);
        return parsed ? [parsed] : [];
      } catch {
        return [];
      }
    });
    const primaryEventName = decoded.method === "stake" ? "Staked" : "UnstakeRequested";
    const primaryEvents = parsedLogs.filter((log) => log.name === primaryEventName);
    const rewardEvents = parsedLogs.filter((log) => log.name === "RewardsSettled");
    const feeEvents = parsedLogs.filter((log) => log.name === "FeesSynced");

    if (primaryEvents.length !== 1) {
      push(results, "FAIL", `expected exactly one ${primaryEventName} event, found ${primaryEvents.length}`);
      printResults(results);
      console.log("");
      failed = true;
      continue;
    }

    const primary = primaryEvents[0];
    const eventUser = String(primary.args.user);
    const eventAmount = BigInt(primary.args.amount);

    push(
      results,
      normalizeAddress(eventUser) === normalizeAddress(owner) ? "PASS" : "FAIL",
      `event user ${eventUser} ${normalizeAddress(eventUser) === normalizeAddress(owner) ? "matches" : "does not match"} effective caller`,
    );
    push(
      results,
      eventAmount === decoded.tokenAmount ? "PASS" : "FAIL",
      `event amount=${formatToken18(eventAmount, "token")} expected input=${formatToken18(decoded.tokenAmount, "token")}`,
    );

    const [ssvIn, ssvOut, cssvMint, cssvBurn] = await Promise.all([
      getTokenTransferAmountFromReceipt(erc20Interface, receipt.logs, tokenAddress, owner, networkAddress),
      getTokenTransferAmountFromReceipt(erc20Interface, receipt.logs, tokenAddress, networkAddress, owner),
      getTokenTransferAmountFromReceipt(erc20Interface, receipt.logs, cssvAddress, ZeroAddress, owner),
      getTokenTransferAmountFromReceipt(erc20Interface, receipt.logs, cssvAddress, owner, ZeroAddress),
    ]);

    if (decoded.method === "stake") {
      push(
        results,
        ssvIn === decoded.tokenAmount ? "PASS" : "FAIL",
        `SSV Transfer(${owner} -> network)=${formatToken18(ssvIn, "SSV")} expected=${formatToken18(decoded.tokenAmount, "SSV")}`,
      );
      push(
        results,
        cssvMint === decoded.tokenAmount ? "PASS" : "FAIL",
        `cSSV mint(0x0 -> ${owner})=${formatToken18(cssvMint, "cSSV")} expected=${formatToken18(decoded.tokenAmount, "cSSV")}`,
      );
      push(results, ssvOut === 0n ? "PASS" : "FAIL", `unexpected SSV outflow to caller=${formatToken18(ssvOut, "SSV")}`);
      push(results, cssvBurn === 0n ? "PASS" : "FAIL", `unexpected cSSV burn=${formatToken18(cssvBurn, "cSSV")}`);
    } else {
      push(
        results,
        cssvBurn === decoded.tokenAmount ? "PASS" : "FAIL",
        `cSSV burn(${owner} -> 0x0)=${formatToken18(cssvBurn, "cSSV")} expected=${formatToken18(decoded.tokenAmount, "cSSV")}`,
      );
      push(results, ssvIn === 0n ? "PASS" : "FAIL", `unexpected immediate SSV inflow to network=${formatToken18(ssvIn, "SSV")}`);
      push(results, ssvOut === 0n ? "PASS" : "FAIL", `unexpected immediate SSV outflow to caller=${formatToken18(ssvOut, "SSV")}`);
      push(results, cssvMint === 0n ? "PASS" : "FAIL", `unexpected cSSV mint=${formatToken18(cssvMint, "cSSV")}`);
    }

    push(
      results,
      rewardEvents.length === 1 ? "PASS" : "FAIL",
      `RewardsSettled events=${rewardEvents.length} expected=1`,
    );
    push(
      results,
      feeEvents.length <= 1 ? "PASS" : "FAIL",
      `FeesSynced events=${feeEvents.length} expected<=1`,
    );

    const rewardsEvent = rewardEvents[0];
    const feesEvent = feeEvents[0];
    if (rewardsEvent && feesEvent) {
      const rewardUserIndex = BigInt(rewardsEvent.args.userIndex);
      const feeAcc = BigInt(feesEvent.args.accEthPerShare);
      push(
        results,
        rewardUserIndex === feeAcc ? "PASS" : "FAIL",
        `RewardsSettled.userIndex=${rewardUserIndex} FeesSynced.accEthPerShare=${feeAcc}`,
      );
    }

    if (!isolatedNetworkTx || preBlock < 0) {
      push(results, "SKIP", "exact fee/reward formula checks skipped because the block is not isolated to this SSVNetwork tx");
      push(results, "SKIP", "exact post-state staking balance checks skipped because the block is not isolated to this SSVNetwork tx");
      printResults(results);
      console.log("");
      if (results.some((item) => item.status === "FAIL")) failed = true;
      continue;
    }

    try {
      const [
        preTotalStaked,
        postTotalStaked,
        preUserStaked,
        postUserStaked,
        prePendingClaimable,
        postPendingClaimable,
        preAccEthPerShare,
        postAccEthPerShare,
        preStakingEthPoolBalance,
        postStakingEthPoolBalance,
        postNetworkEarnings,
        preUserIndex,
        postUserIndex,
        preAccrued,
        postAccrued,
      ] = await Promise.all([
        views.totalStaked({ blockTag: preBlock }),
        views.totalStaked({ blockTag: blockNumber }),
        views.stakedBalanceOf(owner, { blockTag: preBlock }),
        views.stakedBalanceOf(owner, { blockTag: blockNumber }),
        views.previewClaimableEth(owner, { blockTag: preBlock }),
        views.previewClaimableEth(owner, { blockTag: blockNumber }),
        views.accEthPerShare({ blockTag: preBlock }),
        views.accEthPerShare({ blockTag: blockNumber }),
        views.stakingEthPoolBalance({ blockTag: preBlock }),
        views.stakingEthPoolBalance({ blockTag: blockNumber }),
        views.getNetworkEarnings({ blockTag: blockNumber }),
        getUserIndexAt(provider, networkAddress, owner, preBlock),
        getUserIndexAt(provider, networkAddress, owner, blockNumber),
        getAccruedAt(provider, networkAddress, owner, preBlock),
        getAccruedAt(provider, networkAddress, owner, blockNumber),
      ]);

      const preTotalStakedBn = BigInt(preTotalStaked);
      const postTotalStakedBn = BigInt(postTotalStaked);
      const preUserStakedBn = BigInt(preUserStaked);
      const postUserStakedBn = BigInt(postUserStaked);
      const prePendingClaimableBn = BigInt(prePendingClaimable);
      const postPendingClaimableBn = BigInt(postPendingClaimable);
      const preAccEthPerShareBn = BigInt(preAccEthPerShare);
      const postAccEthPerShareBn = BigInt(postAccEthPerShare);
      const preStakingEthPoolBalanceBn = BigInt(preStakingEthPoolBalance);
      const postStakingEthPoolBalanceBn = BigInt(postStakingEthPoolBalance);
      const postNetworkEarningsBn = BigInt(postNetworkEarnings);

      const expectedRawNewFees = postNetworkEarningsBn > preStakingEthPoolBalanceBn
        ? postNetworkEarningsBn - preStakingEthPoolBalanceBn
        : 0n;
      const expectedEventNewFees = preTotalStakedBn === 0n ? 0n : expectedRawNewFees;
      const expectedAccEthPerShare = preAccEthPerShareBn + (
        preTotalStakedBn === 0n ? 0n : (expectedRawNewFees * PRECISION) / preTotalStakedBn
      );
      const expectedPending = preUserStakedBn === 0n || expectedAccEthPerShare <= preUserIndex
        ? 0n
        : (preUserStakedBn * (expectedAccEthPerShare - preUserIndex)) / PRECISION;
      const expectedAccrued = preAccrued + expectedPending;

      const expectedFeesEventCount = expectedRawNewFees > 0n ? 1 : 0;
      push(
        results,
        feeEvents.length === expectedFeesEventCount ? "PASS" : "FAIL",
        `FeesSynced emitted=${feeEvents.length} expected=${expectedFeesEventCount}`,
      );
      if (feesEvent) {
        const feeNewFeesWei = BigInt(feesEvent.args.newFeesWei);
        const feeAcc = BigInt(feesEvent.args.accEthPerShare);
        push(
          results,
          feeNewFeesWei === expectedEventNewFees ? "PASS" : "FAIL",
          `FeesSynced.newFeesWei=${formatWei(feeNewFeesWei)} expected=${formatWei(expectedEventNewFees)}`,
        );
        push(
          results,
          feeAcc === expectedAccEthPerShare ? "PASS" : "FAIL",
          `FeesSynced.accEthPerShare=${feeAcc} expected=${expectedAccEthPerShare}`,
        );
      }

      if (rewardsEvent) {
        const eventPending = BigInt(rewardsEvent.args.pending);
        const eventAccrued = BigInt(rewardsEvent.args.accrued);
        const eventUserIndex = BigInt(rewardsEvent.args.userIndex);
        push(
          results,
          eventPending === expectedPending ? "PASS" : "FAIL",
          `RewardsSettled.pending=${formatWei(eventPending)} expected=${formatWei(expectedPending)}`,
        );
        push(
          results,
          eventAccrued === expectedAccrued ? "PASS" : "FAIL",
          `RewardsSettled.accrued=${formatWei(eventAccrued)} expected=${formatWei(expectedAccrued)}`,
        );
        push(
          results,
          eventUserIndex === expectedAccEthPerShare ? "PASS" : "FAIL",
          `RewardsSettled.userIndex=${eventUserIndex} expected=${expectedAccEthPerShare}`,
        );
      }

      push(
        results,
        postAccEthPerShareBn === expectedAccEthPerShare ? "PASS" : "FAIL",
        `post-state accEthPerShare=${postAccEthPerShareBn} expected=${expectedAccEthPerShare}`,
      );
      push(
        results,
        postUserIndex === expectedAccEthPerShare ? "PASS" : "FAIL",
        `post-state userIndex=${postUserIndex} expected=${expectedAccEthPerShare}`,
      );
      push(
        results,
        postAccrued === expectedAccrued ? "PASS" : "FAIL",
        `post-state accrued=${formatWei(postAccrued)} expected=${formatWei(expectedAccrued)}`,
      );
      push(
        results,
        postPendingClaimableBn === expectedAccrued ? "PASS" : "FAIL",
        `post-state previewClaimableEth=${formatWei(postPendingClaimableBn)} expected=${formatWei(expectedAccrued)}`,
      );
      push(
        results,
        prePendingClaimableBn >= preAccrued ? "PASS" : "FAIL",
        `pre-state previewClaimableEth=${formatWei(prePendingClaimableBn)} accrued=${formatWei(preAccrued)}`,
      );
      push(
        results,
        postStakingEthPoolBalanceBn === postNetworkEarningsBn ? "PASS" : "FAIL",
        `post-state stakingEthPoolBalance=${formatWei(postStakingEthPoolBalanceBn)} expected current network earnings=${formatWei(postNetworkEarningsBn)}`,
      );

      if (decoded.method === "stake") {
        push(
          results,
          postTotalStakedBn === preTotalStakedBn + decoded.tokenAmount ? "PASS" : "FAIL",
          `totalStaked pre=${formatToken18(preTotalStakedBn, "cSSV")} post=${formatToken18(postTotalStakedBn, "cSSV")} expected delta=+${formatToken18(decoded.tokenAmount, "cSSV")}`,
        );
        push(
          results,
          postUserStakedBn === preUserStakedBn + decoded.tokenAmount ? "PASS" : "FAIL",
          `stakedBalanceOf(${owner}) pre=${formatToken18(preUserStakedBn, "cSSV")} post=${formatToken18(postUserStakedBn, "cSSV")} expected delta=+${formatToken18(decoded.tokenAmount, "cSSV")}`,
        );
      } else {
        push(
          results,
          postTotalStakedBn === preTotalStakedBn - decoded.tokenAmount ? "PASS" : "FAIL",
          `totalStaked pre=${formatToken18(preTotalStakedBn, "cSSV")} post=${formatToken18(postTotalStakedBn, "cSSV")} expected delta=-${formatToken18(decoded.tokenAmount, "cSSV")}`,
        );
        push(
          results,
          postUserStakedBn === preUserStakedBn - decoded.tokenAmount ? "PASS" : "FAIL",
          `stakedBalanceOf(${owner}) pre=${formatToken18(preUserStakedBn, "cSSV")} post=${formatToken18(postUserStakedBn, "cSSV")} expected delta=-${formatToken18(decoded.tokenAmount, "cSSV")}`,
        );

        const [cooldownDuration, prePendingRaw, postPendingRaw] = await Promise.all([
          views.cooldownDuration({ blockTag: blockNumber }),
          views.pendingUnstake(owner, { blockTag: preBlock }),
          views.pendingUnstake(owner, { blockTag: blockNumber }),
        ]);
        const cooldown = BigInt(cooldownDuration);
        const prePending = parsePendingUnstakes(prePendingRaw);
        const postPending = parsePendingUnstakes(postPendingRaw);
        const added = diffPending(postPending, prePending);
        const expectedUnlockTime = BigInt(primary.args.unlockTime);

        push(
          results,
          postPending.length === prePending.length + 1 ? "PASS" : "FAIL",
          `pendingUnstake length pre=${prePending.length} post=${postPending.length} expected delta=+1`,
        );
        push(
          results,
          added.length === 1 ? "PASS" : "FAIL",
          `new pendingUnstake entries=${added.length} expected=1`,
        );
        if (added.length === 1) {
          push(
            results,
            added[0].amount === decoded.tokenAmount ? "PASS" : "FAIL",
            `new pendingUnstake amount=${formatToken18(added[0].amount, "SSV")} expected=${formatToken18(decoded.tokenAmount, "SSV")}`,
          );
          push(
            results,
            added[0].unlockTime === expectedUnlockTime ? "PASS" : "FAIL",
            `new pendingUnstake unlockTime=${added[0].unlockTime} expected=${expectedUnlockTime}`,
          );
        }
        push(
          results,
          expectedUnlockTime === BigInt(block.timestamp) + cooldown ? "PASS" : "FAIL",
          `event unlockTime=${expectedUnlockTime} expected block.timestamp + cooldown=${BigInt(block.timestamp) + cooldown}`,
        );
      }
    } catch (error) {
      push(results, "WARN", `exact staking state checks skipped: ${shortError(error)}`);
    }

    printResults(results);
    console.log("");
    if (results.some((item) => item.status === "FAIL")) {
      failed = true;
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
