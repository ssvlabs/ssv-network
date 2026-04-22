import "dotenv/config";

import { readFile } from "node:fs/promises";
import { Contract, Interface, JsonRpcProvider, formatEther } from "ethers";

import {
  LOCAL_FORK_RPC_URL,
  loadConfig,
  parseOptionalArg,
  resolveNetworkFromEnv,
  resolveProtocolParams,
} from "./common/config.ts";

type Cluster = {
  validatorCount: bigint;
  networkFeeIndex: bigint;
  index: bigint;
  active: boolean;
  balance: bigint;
};

type OperatorData = {
  owner: string;
  fee: bigint;
  validatorCount: bigint;
  whitelistedAddress: string;
  isPrivate: boolean;
  isActive: boolean;
};

type CheckStatus = "PASS" | "FAIL" | "WARN" | "SKIP";

type CheckResult = {
  status: CheckStatus;
  message: string;
};

type DecodedMigrationCall = {
  kind: "direct" | "safe";
  networkTarget: string;
  logicalCaller: string;
  ethValue: bigint;
  operatorIds: bigint[];
  inputCluster: Cluster;
  outerTo: string | null;
};

const VERSION_SSV = 0n;
const VERSION_ETH = 1n;
const DEFAULT_FROM_BLOCK = 24_920_727;
const LOG_CHUNK_SIZE = 20_000;

function usage(): void {
  console.log(
    [
      "Usage: npx tsx scripts/check-mainnet-migrate-clusters.ts [--env mainnet] [--network <mainnet|local>] [--rpc-url <url>] [--from-block <n>] [--to-block <n>] [txHash ...]",
      "",
      "Defaults:",
      `- env: mainnet`,
      `- network: resolved from env, or mainnet`,
      `- rpc-url: MAINNET_RPC_URL or http://127.0.0.1:8545`,
      `- from-block: ${DEFAULT_FROM_BLOCK} (upgrade block)`,
      `- to-block: latest`,
      `- tx hashes: if omitted, discovered from ClusterMigratedToETH logs in the selected block range`,
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

function boolWord(value: boolean): string {
  return value ? "true" : "false";
}

function toBlockHex(blockNumber: number): string {
  return `0x${blockNumber.toString(16)}`;
}

function normalizeCluster(cluster: any): Cluster {
  return {
    validatorCount: BigInt(cluster.validatorCount),
    networkFeeIndex: BigInt(cluster.networkFeeIndex),
    index: BigInt(cluster.index),
    active: Boolean(cluster.active),
    balance: BigInt(cluster.balance),
  };
}

function normalizeOperatorData(data: any): OperatorData {
  return {
    owner: String(data.owner),
    fee: BigInt(data.fee),
    validatorCount: BigInt(data.validatorCount),
    whitelistedAddress: String(data.whitelistedAddress),
    isPrivate: Boolean(data.isPrivate),
    isActive: Boolean(data.isActive),
  };
}

function formatOperatorIds(operatorIds: readonly bigint[]): string {
  return operatorIds.map((id) => id.toString()).join(",");
}

function equalBigintArrays(a: readonly bigint[], b: readonly bigint[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function equalClusters(a: Cluster, b: Cluster): boolean {
  return (
    a.validatorCount === b.validatorCount &&
    a.networkFeeIndex === b.networkFeeIndex &&
    a.index === b.index &&
    a.active === b.active &&
    a.balance === b.balance
  );
}

function hasOtherBlockTxTouching(
  blockTransactions: readonly any[],
  targetTxHash: string,
  address: string | null | undefined,
): boolean {
  if (!address) return false;
  const target = normalizeAddress(address);
  const targetHash = normalizeAddress(targetTxHash);
  return blockTransactions.some((item: any) => {
    if (normalizeAddress(item.hash) === targetHash) return false;
    return normalizeAddress(item.from) === target || normalizeAddress(item.to) === target;
  });
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

async function loadAbi(path: string): Promise<any[]> {
  return JSON.parse(await readFile(path, "utf8")) as any[];
}

async function getRawBlock(provider: JsonRpcProvider, blockNumber: number): Promise<any> {
  return provider.send("eth_getBlockByNumber", [toBlockHex(blockNumber), true]);
}

async function getAssetTypeAt(
  views: Contract,
  owner: string,
  operatorIds: readonly bigint[],
  blockTag: number,
): Promise<bigint> {
  return BigInt(await views.getClusterAssetType(owner, operatorIds, { blockTag }));
}

function shortError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function decodeMigrationCall(
  tx: any,
  networkAddress: string,
  networkInterface: Interface,
  safeInterface: Interface,
): DecodedMigrationCall {
  const direct = networkInterface.parseTransaction({ data: tx.data, value: tx.value });
  if (direct && direct.name === "migrateClusterToETH") {
    return {
      kind: "direct",
      networkTarget: String(tx.to),
      logicalCaller: String(tx.from),
      ethValue: BigInt(tx.value),
      operatorIds: [...direct.args[0]].map((value: any) => BigInt(value)),
      inputCluster: normalizeCluster(direct.args[1]),
      outerTo: tx.to ? String(tx.to) : null,
    };
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
  if (!nested || nested.name !== "migrateClusterToETH") {
    throw new Error(`Wrapped tx does not contain migrateClusterToETH: ${tx.hash}`);
  }

  return {
    kind: "safe",
    networkTarget: nestedTarget,
    logicalCaller: String(tx.to),
    ethValue: BigInt(wrapped.args.value),
    operatorIds: [...nested.args[0]].map((value: any) => BigInt(value)),
    inputCluster: normalizeCluster(nested.args[1]),
    outerTo: tx.to ? String(tx.to) : null,
  };
}

async function getOperatorStateAt(
  views: Contract,
  operatorId: bigint,
  blockTag: number,
): Promise<{ eth: OperatorData; ssv: OperatorData }> {
  const [eth, ssv] = await Promise.all([
    views.getOperatorById(operatorId, { blockTag }),
    views.getOperatorByIdSSV(operatorId, { blockTag }),
  ]);
  return {
    eth: normalizeOperatorData(eth),
    ssv: normalizeOperatorData(ssv),
  };
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

async function discoverMigrationTxHashes(
  provider: JsonRpcProvider,
  networkAddress: string,
  networkInterface: Interface,
  fromBlock: number,
  toBlock: number,
): Promise<string[]> {
  const topic0 = networkInterface.getEvent("ClusterMigratedToETH").topicHash;
  const txHashes: string[] = [];
  const seen = new Set<string>();

  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK_SIZE) {
    const end = Math.min(start + LOG_CHUNK_SIZE - 1, toBlock);
    const logs = await provider.getLogs({
      address: networkAddress,
      fromBlock: start,
      toBlock: end,
      topics: [topic0],
    });

    for (const log of logs) {
      const txHash = String(log.transactionHash);
      if (seen.has(txHash)) continue;
      seen.add(txHash);
      txHashes.push(txHash);
    }
  }

  return txHashes;
}

async function getNetworkActivityForBlock(
  provider: JsonRpcProvider,
  networkAddress: string,
  blockNumber: number,
): Promise<Array<{ txHash: string; transactionIndex: number }>> {
  const logs = await provider.getLogs({
    address: networkAddress,
    fromBlock: blockNumber,
    toBlock: blockNumber,
  });

  const byTxHash = new Map<string, number>();
  for (const log of logs) {
    const txHash = String(log.transactionHash);
    const txIndex = Number(log.transactionIndex);
    const previous = byTxHash.get(txHash);
    if (previous === undefined || txIndex < previous) {
      byTxHash.set(txHash, txIndex);
    }
  }

  return [...byTxHash.entries()]
    .map(([txHash, transactionIndex]) => ({ txHash, transactionIndex }))
    .sort((a, b) => a.transactionIndex - b.transactionIndex);
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
  const protocolParams = resolveProtocolParams(config);
  const networkAddress = config.ssvNetworkProxy;
  const viewsAddress = config.ssvNetworkViews;
  const tokenAddress = config.ssvToken;

  if (!networkAddress || !viewsAddress || !tokenAddress) {
    throw new Error(`Missing one of ssvNetworkProxy/ssvNetworkViews/ssvToken in deployments/${env}/config.json`);
  }
  if (protocolParams.liquidationThresholdPeriod === undefined) {
    throw new Error(`Missing liquidationThresholdPeriod in deployments/${env}/config.json`);
  }
  if (protocolParams.minimumLiquidationCollateralEth === undefined) {
    throw new Error(`Missing minimumLiquidationCollateralEth in deployments/${env}/config.json`);
  }

  const [networkAbi, viewsAbi] = await Promise.all([
    loadAbi("abis/SSVNetwork.json"),
    loadAbi("abis/SSVNetworkViews.json"),
  ]);

  const provider = new JsonRpcProvider(rpcUrl);
  const networkCode = await provider.getCode(networkAddress);
  const viewsCode = await provider.getCode(viewsAddress);
  if (networkCode === "0x") {
    throw new Error(`No code at SSVNetwork proxy ${networkAddress} via ${rpcUrl}`);
  }
  if (viewsCode === "0x") {
    throw new Error(`No code at SSVNetworkViews ${viewsAddress} via ${rpcUrl}`);
  }

  const views = new Contract(viewsAddress, viewsAbi, provider);
  const token = new Contract(tokenAddress, ["function balanceOf(address) view returns (uint256)"], provider);
  const networkInterface = new Interface(networkAbi);
  const safeInterface = new Interface([
    "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures)",
  ]);
  const tokenInterface = new Interface([
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  ]);
  const latestBlock = await provider.getBlockNumber();
  const toBlock = parseBlockArg(parseOptionalArg("to-block"), "to-block", latestBlock);
  if (fromBlock > toBlock) {
    throw new Error(`Invalid block range: from-block ${fromBlock} is greater than to-block ${toBlock}`);
  }
  const txHashes = positional.length > 0
    ? positional
    : await discoverMigrationTxHashes(provider, networkAddress, networkInterface, fromBlock, toBlock);

  let failed = false;

  console.log(`RPC: ${rpcUrl}`);
  console.log(`Config: deployments/${env}/config.json`);
  console.log(`Provider network: ${network}`);
  console.log(`Block range: ${fromBlock}..${toBlock}`);
  console.log(`Network: ${networkAddress}`);
  console.log(`Views:   ${viewsAddress}`);
  console.log(`SSV:     ${tokenAddress}`);
  console.log(`Migrations found: ${txHashes.length}`);
  console.log("");

  if (txHashes.length === 0) {
    console.log("No migrateClusterToETH calls found in the selected block range.");
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
    const targetBlockTx = blockTransactions[targetIndex];
    const targetTxIndex = Number(targetBlockTx.transactionIndex);
    const proxyBlockTxs = await getNetworkActivityForBlock(provider, networkAddress, blockNumber);
    const earlierProxyTxs = proxyBlockTxs.filter(
      (item) => item.transactionIndex < targetTxIndex,
    );
    const laterProxyTxs = proxyBlockTxs.filter(
      (item) => item.transactionIndex > targetTxIndex,
    );
    const isolatedProxyTx = proxyBlockTxs.length === 1;
    const exactRefundReplay = earlierProxyTxs.length === 0;
    const exactPostState = laterProxyTxs.length === 0;

    console.log(txHash);
    console.log(`  block=${blockNumber} txIndex=${targetTxIndex} from=${tx.from} value=${formatWei(tx.value)}`);

    const decoded = decodeMigrationCall(tx, networkAddress, networkInterface, safeInterface);
    const operatorIds = decoded.operatorIds;
    const inputCluster = decoded.inputCluster;
    const owner = decoded.logicalCaller;
    const gasPriceForAccounting = BigInt(receipt.gasPrice ?? tx.gasPrice ?? 0n);
    const gasPaid = BigInt(receipt.gasUsed) * gasPriceForAccounting;
    const ownerTouchedByOtherBlockTx = hasOtherBlockTxTouching(blockTransactions, txHash, owner);
    const outerSenderTouchedByOtherBlockTx = hasOtherBlockTxTouching(blockTransactions, txHash, tx.from);

    push(
      results,
      normalizeAddress(decoded.networkTarget) === normalizeAddress(networkAddress) ? "PASS" : "FAIL",
      `call target ${decoded.networkTarget} ${normalizeAddress(decoded.networkTarget) === normalizeAddress(networkAddress) ? "matches" : "does not match"} configured SSVNetwork proxy`,
    );
    push(
      results,
      "PASS",
      `decoded function is migrateClusterToETH${decoded.kind === "safe" ? " via Safe.execTransaction" : ""}`,
    );
    if (decoded.kind === "safe") {
      push(
        results,
        "WARN",
        `wrapped call: outer tx target ${decoded.outerTo}, effective caller ${decoded.logicalCaller}, nested value ${formatWei(decoded.ethValue)}`,
      );
    }

    if (proxyBlockTxs.length > 1) {
      push(
        results,
        "WARN",
        `block contains ${proxyBlockTxs.length} SSVNetwork txs; pre/post state checks use only block-level history`,
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

    const migratedEvents = parsedLogs.filter((log) => log.name === "ClusterMigratedToETH");
    const reactivatedEvents = parsedLogs.filter((log) => log.name === "ClusterReactivated");

    if (migratedEvents.length !== 1) {
      push(results, "FAIL", `expected exactly one ClusterMigratedToETH event, found ${migratedEvents.length}`);
      printResults(results);
      console.log("");
      failed = true;
      continue;
    }

    const migratedEvent = migratedEvents[0];
    const eventOperatorIds = [...migratedEvent.args.operatorIds].map((value: any) => BigInt(value));
    const migratedCluster = normalizeCluster(migratedEvent.args.cluster);
    const eventOwner = String(migratedEvent.args.owner);
    const eventEthDeposited = BigInt(migratedEvent.args.ethDeposited);
    const eventSsvRefunded = BigInt(migratedEvent.args.ssvRefunded);
    const eventEffectiveBalance = BigInt(migratedEvent.args.effectiveBalance);

    push(
      results,
      normalizeAddress(eventOwner) === normalizeAddress(owner) ? "PASS" : "FAIL",
      `event owner ${eventOwner} ${normalizeAddress(eventOwner) === normalizeAddress(owner) ? "matches" : "does not match"} effective caller`,
    );
    push(
      results,
      equalBigintArrays(eventOperatorIds, operatorIds) ? "PASS" : "FAIL",
      `event operatorIds [${formatOperatorIds(eventOperatorIds)}] ${equalBigintArrays(eventOperatorIds, operatorIds) ? "match" : "do not match"} tx input`,
    );
    push(
      results,
      eventEthDeposited === decoded.ethValue ? "PASS" : "FAIL",
      `event ethDeposited=${formatWei(eventEthDeposited)} expected call value=${formatWei(decoded.ethValue)}`,
    );
    push(
      results,
      migratedCluster.balance === decoded.ethValue ? "PASS" : "FAIL",
      `migrated cluster balance=${formatWei(migratedCluster.balance)} expected call value`,
    );
    push(
      results,
      migratedCluster.active ? "PASS" : "FAIL",
      `migrated cluster active=${boolWord(migratedCluster.active)}`,
    );
    push(
      results,
      migratedCluster.validatorCount === inputCluster.validatorCount ? "PASS" : "FAIL",
      `validatorCount input=${inputCluster.validatorCount} event=${migratedCluster.validatorCount}`,
    );

    const expectedReactivatedEvents = inputCluster.active ? 0 : 1;
    push(
      results,
      reactivatedEvents.length === expectedReactivatedEvents ? "PASS" : "FAIL",
      `ClusterReactivated events=${reactivatedEvents.length} expected=${expectedReactivatedEvents}`,
    );
    if (reactivatedEvents.length === 1) {
      const reactivatedCluster = normalizeCluster(reactivatedEvents[0].args.cluster);
      push(
        results,
        equalClusters(reactivatedCluster, migratedCluster) ? "PASS" : "FAIL",
        "ClusterReactivated cluster matches ClusterMigratedToETH cluster",
      );
    }

    const preBlock = blockNumber - 1;
    try {
      const preAssetType = await getAssetTypeAt(views, owner, operatorIds, preBlock);
      push(
        results,
        preAssetType === VERSION_SSV ? "PASS" : "FAIL",
        `cluster asset type before tx=${preAssetType} expected=${VERSION_SSV}`,
      );
    } catch (error) {
      push(
        results,
        "SKIP",
        `pre-migration asset-type check unavailable at block ${preBlock}: ${shortError(error)}`,
      );
    }

    if (exactPostState) {
      try {
        const postAssetType = await getAssetTypeAt(views, owner, operatorIds, blockNumber);
        push(
          results,
          postAssetType === VERSION_ETH ? "PASS" : "FAIL",
          `cluster asset type after tx=${postAssetType} expected=${VERSION_ETH}`,
        );
      } catch (error) {
        push(
          results,
          "SKIP",
          `post-migration asset-type check unavailable at block ${blockNumber}: ${shortError(error)}`,
        );
      }
    } else {
      push(results, "SKIP", "post-migration asset-type check skipped because later SSVNetwork txs exist in the same block");
    }

    const refundTransfer = await getTokenTransferAmountFromReceipt(
      tokenInterface,
      receipt.logs,
      tokenAddress,
      networkAddress,
      owner,
    );
    const refundProxyOutflow = await getTokenTransferAmountFromReceipt(
      tokenInterface,
      receipt.logs,
      tokenAddress,
      networkAddress,
      owner,
    );
    push(
      results,
      refundTransfer === eventSsvRefunded ? "PASS" : "FAIL",
      refundTransfer === eventSsvRefunded
        ? `SSV owner inflow from receipt=${formatToken18(refundTransfer, "SSV")}`
        : `SSV owner inflow from receipt=${formatToken18(refundTransfer, "SSV")} expected ${formatToken18(eventSsvRefunded, "SSV")}`,
    );
    push(
      results,
      refundProxyOutflow === eventSsvRefunded ? "PASS" : "FAIL",
      refundProxyOutflow === eventSsvRefunded
        ? `SSV proxy outflow from receipt=${formatToken18(refundProxyOutflow, "SSV")}`
        : `SSV proxy outflow from receipt=${formatToken18(refundProxyOutflow, "SSV")} expected ${formatToken18(eventSsvRefunded, "SSV")}`,
    );

    if (!inputCluster.active) {
      push(
        results,
        eventSsvRefunded === 0n ? "PASS" : "FAIL",
        `liquidated input cluster emitted ssvRefunded=${eventSsvRefunded}`,
      );
    } else if (exactRefundReplay) {
      const [balanceAtPrevBlock, burnRateAtPrevBlock] = await Promise.all([
        views.getBalanceSSV(owner, operatorIds, inputCluster, { blockTag: preBlock }),
        views.getBurnRateSSV(owner, operatorIds, inputCluster, { blockTag: preBlock }),
      ]);
      const expectedRefund = BigInt(balanceAtPrevBlock) > BigInt(burnRateAtPrevBlock)
        ? BigInt(balanceAtPrevBlock) - BigInt(burnRateAtPrevBlock)
        : 0n;
      push(
        results,
        expectedRefund === eventSsvRefunded ? "PASS" : "FAIL",
        `refund replay from block ${preBlock}: expected=${expectedRefund} actual=${eventSsvRefunded}`,
      );
    } else {
      push(results, "SKIP", "exact SSV refund replay skipped because earlier SSVNetwork txs exist in the same block");
    }

    if (isolatedProxyTx) {
      const [preNetworkValidators, postNetworkValidators] = await Promise.all([
        views.getNetworkValidatorsCount({ blockTag: preBlock }),
        views.getNetworkValidatorsCount({ blockTag: blockNumber }),
      ]);

      push(
        results,
        BigInt(postNetworkValidators) === BigInt(preNetworkValidators) + inputCluster.validatorCount ? "PASS" : "FAIL",
        `ethDaoValidatorCount pre=${preNetworkValidators} post=${postNetworkValidators} expected delta=${inputCluster.validatorCount}`,
      );

      const operatorStates = await Promise.all(
        operatorIds.map(async (operatorId) => ({
          operatorId,
          pre: await getOperatorStateAt(views, operatorId, preBlock),
          post: await getOperatorStateAt(views, operatorId, blockNumber),
        })),
      );

      for (const { operatorId, pre, post } of operatorStates) {
        const removedBeforeMigration = !pre.eth.isActive && !pre.ssv.isActive;
        const expectedEthDelta = removedBeforeMigration ? 0n : inputCluster.validatorCount;
        const expectedSsvDelta = inputCluster.active && pre.ssv.validatorCount > 0n ? -inputCluster.validatorCount : 0n;
        const actualEthDelta = post.eth.validatorCount - pre.eth.validatorCount;
        const actualSsvDelta = post.ssv.validatorCount - pre.ssv.validatorCount;

        push(
          results,
          actualEthDelta === expectedEthDelta ? "PASS" : "FAIL",
          `operator ${operatorId} ETH validatorCount delta=${actualEthDelta} expected=${expectedEthDelta}`,
        );
        push(
          results,
          actualSsvDelta === expectedSsvDelta ? "PASS" : "FAIL",
          `operator ${operatorId} SSV validatorCount delta=${actualSsvDelta} expected=${expectedSsvDelta}`,
        );
      }

      const [proxyEthBefore, proxyEthAfter] = await Promise.all([
        provider.getBalance(networkAddress, preBlock),
        provider.getBalance(networkAddress, blockNumber),
      ]);
      push(
        results,
        proxyEthAfter - proxyEthBefore === decoded.ethValue ? "PASS" : "FAIL",
        `proxy ETH delta=${formatWei(proxyEthAfter - proxyEthBefore)} expected=${formatWei(decoded.ethValue)}`,
      );

      if (!ownerTouchedByOtherBlockTx) {
        const [ownerEthBefore, ownerEthAfter] = await Promise.all([
          provider.getBalance(owner, preBlock),
          provider.getBalance(owner, blockNumber),
        ]);
        const expectedOwnerDelta = decoded.kind === "safe"
          ? -decoded.ethValue
          : -(decoded.ethValue + gasPaid);
        const actualOwnerDelta = ownerEthAfter - ownerEthBefore;
        push(
          results,
          actualOwnerDelta === expectedOwnerDelta ? "PASS" : "FAIL",
          `effective caller ETH delta=${formatWei(actualOwnerDelta)} expected=${formatWei(expectedOwnerDelta)}`,
        );

        const [ownerSsvBefore, ownerSsvAfter] = await Promise.all([
          token.balanceOf(owner, { blockTag: preBlock }),
          token.balanceOf(owner, { blockTag: blockNumber }),
        ]);
        const ownerSsvDelta = BigInt(ownerSsvAfter) - BigInt(ownerSsvBefore);
        push(
          results,
          ownerSsvDelta === eventSsvRefunded ? "PASS" : "FAIL",
          `effective caller SSV delta=${formatToken18(ownerSsvDelta, "SSV")} expected=${formatToken18(eventSsvRefunded, "SSV")}`,
        );
      } else {
        push(results, "SKIP", "effective caller ETH/SSV before-after balance checks skipped because another block tx touches that address");
      }

      if (decoded.kind === "safe") {
        if (!outerSenderTouchedByOtherBlockTx) {
          const [outerEthBefore, outerEthAfter] = await Promise.all([
            provider.getBalance(tx.from, preBlock),
            provider.getBalance(tx.from, blockNumber),
          ]);
          const outerEthDelta = outerEthAfter - outerEthBefore;
          push(
            results,
            outerEthDelta === -gasPaid ? "PASS" : "FAIL",
            `Safe relayer ETH delta=${formatWei(outerEthDelta)} expected=${formatWei(-gasPaid)}`,
          );
        } else {
          push(results, "SKIP", "Safe relayer ETH before-after balance check skipped because another block tx touches that address");
        }
      }
    } else {
      push(results, "SKIP", "operator/DAO count delta checks skipped because the block is not isolated to this SSVNetwork tx");
      push(results, "SKIP", "proxy ETH balance delta check skipped because the block is not isolated to this SSVNetwork tx");
      push(results, "SKIP", "effective caller ETH/SSV before-after balance checks skipped because the block is not isolated to this SSVNetwork tx");
      if (decoded.kind === "safe") {
        push(results, "SKIP", "Safe relayer ETH before-after balance check skipped because the block is not isolated to this SSVNetwork tx");
      }
    }

    if (exactPostState) {
      const [postBalance, postBurnRate, postLiquidatable, postEffectiveBalance, postNetworkFee] = await Promise.all([
        views.getBalance(owner, operatorIds, migratedCluster, { blockTag: blockNumber }),
        views.getBurnRate(owner, operatorIds, migratedCluster, { blockTag: blockNumber }),
        views.isLiquidatable(owner, operatorIds, migratedCluster, { blockTag: blockNumber }),
        views.getEffectiveBalance(owner, operatorIds, migratedCluster, { blockTag: blockNumber }),
        views.getNetworkFee({ blockTag: blockNumber }),
      ]);

      push(
        results,
        BigInt(postBalance) === migratedCluster.balance ? "PASS" : "FAIL",
        `post-state getBalance=${postBalance} event.cluster.balance=${migratedCluster.balance}`,
      );
      push(
        results,
        !postLiquidatable ? "PASS" : "FAIL",
        `post-state isLiquidatable=${boolWord(Boolean(postLiquidatable))}`,
      );
      push(
        results,
        BigInt(postEffectiveBalance) === eventEffectiveBalance ? "PASS" : "FAIL",
        `effectiveBalance view=${postEffectiveBalance} event=${eventEffectiveBalance}`,
      );

      const thresholdFromBurnRate = BigInt(postBurnRate) * protocolParams.liquidationThresholdPeriod;
      const minimumRequiredEth = migratedCluster.validatorCount === 0n
        ? 0n
        : thresholdFromBurnRate > protocolParams.minimumLiquidationCollateralEth
          ? thresholdFromBurnRate
          : protocolParams.minimumLiquidationCollateralEth;
      push(
        results,
        migratedCluster.balance >= minimumRequiredEth ? "PASS" : "FAIL",
        `min ETH required=${formatWei(minimumRequiredEth)} burnRate=${formatWei(BigInt(postBurnRate))} networkFee=${postNetworkFee} deposited=${formatWei(migratedCluster.balance)}`,
      );
    } else {
      push(results, "SKIP", "post-migration ETH accounting checks skipped because later SSVNetwork txs exist in the same block");
    }

    printResults(results);
    console.log("");

    if (results.some((result) => result.status === "FAIL")) {
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
