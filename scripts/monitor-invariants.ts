import "dotenv/config";

import { readFile } from "node:fs/promises";
import { Contract, Interface, JsonRpcProvider, formatEther } from "ethers";

import {
  LOCAL_FORK_RPC_URL,
  loadConfig,
  parseOptionalArg,
  resolveNetworkFromEnv,
} from "./common/config.ts";

type Cluster = {
  validatorCount: bigint;
  networkFeeIndex: bigint;
  index: bigint;
  active: boolean;
  balance: bigint;
};

type CheckStatus = "PASS" | "FAIL" | "WARN" | "SKIP" | "CRITICAL";

type CheckResult = {
  status: CheckStatus;
  message: string;
};

type DecodedWithdrawCall = {
  kind: "direct" | "safe";
  networkTarget: string;
  logicalCaller: string;
  operatorIds: bigint[];
  amount: bigint;
  inputCluster: Cluster;
  outerTo: string | null;
};

type DecodedOperatorWithdrawCall = {
  kind: "direct" | "safe";
  networkTarget: string;
  logicalCaller: string;
  operatorId: bigint;
  outerTo: string | null;
};

interface ClusterWithdrawnEvent {
  id: string;
  owner: string;
  operatorIds: string[];
  value: string;
  cluster_validatorCount: string;
  cluster_networkFeeIndex: string;
  cluster_index: string;
  cluster_active: boolean;
  cluster_balance: string;
  blockNumber: string;
  transactionHash: string;
}

interface OperatorWithdrawnEvent {
  id: string;
  owner: string;
  operatorId: string;
  value: string;
  blockNumber: string;
  transactionHash: string;
}

const DEFAULT_FROM_BLOCK = 24_920_727;
const POLL_INTERVAL_MS = 15_000;

const CLUSTER_WITHDRAWN_QUERY = `
query GetClusterWithdrawns($lastBlock: BigInt!) {
  clusterWithdrawns(
    first: 100
    orderBy: blockNumber
    orderDirection: asc
    where: { blockNumber_gt: $lastBlock }
  ) {
    id
    owner
    operatorIds
    value
    cluster_validatorCount
    cluster_networkFeeIndex
    cluster_index
    cluster_active
    cluster_balance
    blockNumber
    transactionHash
  }
}
`;

const OPERATOR_WITHDRAWN_QUERY = `
query GetOperatorWithdrawns($lastBlock: BigInt!) {
  operatorWithdrawns(
    first: 100
    orderBy: blockNumber
    orderDirection: asc
    where: { blockNumber_gt: $lastBlock }
  ) {
    id
    owner
    operatorId
    value
    blockNumber
    transactionHash
  }
}
`;

const OPERATOR_WITHDRAWN_SSV_QUERY = `
query GetOperatorWithdrawnSSVs($lastBlock: BigInt!) {
  operatorWithdrawnSSVs(
    first: 100
    orderBy: blockNumber
    orderDirection: asc
    where: { blockNumber_gt: $lastBlock }
  ) {
    id
    owner
    operatorId
    value
    blockNumber
    transactionHash
  }
}
`;

function usage(): void {
  console.log(
    [
      "Usage: npx tsx scripts/monitor-invariants.ts [--env mainnet] [--network <mainnet|local>] [--rpc-url <url>] [--subgraph-url <url>] [--from-block <n>]",
      "",
      "Defaults:",
      `  env: mainnet`,
      `  network: resolved from env, or mainnet`,
      `  rpc-url: MAINNET_RPC_URL or http://127.0.0.1:8545`,
      `  subgraph-url: SUBGRAPH_URL env var`,
      `  from-block: ${DEFAULT_FROM_BLOCK} (upgrade block)`,
    ].join("\n")
  );
}

function normalizeAddress(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function formatWei(value: bigint): string {
  return `${value.toString()} wei (${formatEther(value)} ETH)`;
}

function shortError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function loadAbi(path: string): Promise<any[]> {
  return JSON.parse(await readFile(path, "utf8")) as any[];
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

function normalizeCluster(cluster: any): Cluster {
  return {
    validatorCount: BigInt(cluster.validatorCount),
    networkFeeIndex: BigInt(cluster.networkFeeIndex),
    index: BigInt(cluster.index),
    active: Boolean(cluster.active),
    balance: BigInt(cluster.balance),
  };
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
            : result.status === "CRITICAL"
              ? "[CRITICAL]"
              : "[SKIP]";
    console.log(`  ${prefix} ${result.message}`);
  }
}

async function getRawBlock(provider: JsonRpcProvider, blockNumber: number): Promise<any> {
  return provider.send("eth_getBlockByNumber", [`0x${blockNumber.toString(16)}`, true]);
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

function decodeWithdrawCall(
  tx: any,
  networkAddress: string,
  networkInterface: Interface,
  safeInterface: Interface,
): DecodedWithdrawCall {
  const direct = networkInterface.parseTransaction({ data: tx.data, value: tx.value });
  if (direct && direct.name === "withdraw") {
    return {
      kind: "direct",
      networkTarget: String(tx.to),
      logicalCaller: String(tx.from),
      operatorIds: [...direct.args[0]].map((v: any) => BigInt(v)),
      amount: BigInt(direct.args[1]),
      inputCluster: normalizeCluster(direct.args[2]),
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
  if (!nested || nested.name !== "withdraw") {
    throw new Error(`Wrapped tx does not contain withdraw: ${tx.hash}`);
  }

  return {
    kind: "safe",
    networkTarget: nestedTarget,
    logicalCaller: String(tx.to),
    operatorIds: [...nested.args[0]].map((v: any) => BigInt(v)),
    amount: BigInt(nested.args[1]),
    inputCluster: normalizeCluster(nested.args[2]),
    outerTo: tx.to ? String(tx.to) : null,
  };
}

function decodeOperatorWithdrawCall(
  tx: any,
  networkAddress: string,
  networkInterface: Interface,
  safeInterface: Interface,
): DecodedOperatorWithdrawCall {
  const direct = networkInterface.parseTransaction({ data: tx.data, value: tx.value });
  if (direct && (direct.name === "withdrawOperatorEarnings" || direct.name === "withdrawOperatorEarningsSSV")) {
    return {
      kind: "direct",
      networkTarget: String(tx.to),
      logicalCaller: String(tx.from),
      operatorId: BigInt(direct.args[0]),
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
  if (!nested || (nested.name !== "withdrawOperatorEarnings" && nested.name !== "withdrawOperatorEarningsSSV")) {
    throw new Error(`Wrapped tx does not contain operator earnings withdrawal: ${tx.hash}`);
  }

  return {
    kind: "safe",
    networkTarget: nestedTarget,
    logicalCaller: String(tx.to),
    operatorId: BigInt(nested.args[0]),
    outerTo: tx.to ? String(tx.to) : null,
  };
}

async function querySubgraph<T>(
  subgraphUrl: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(subgraphUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Subgraph HTTP ${res.status}: ${res.statusText}`);
  }
  const json = (await res.json()) as any;
  if (json.errors) {
    throw new Error(`Subgraph errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

async function checkClusterWithdrawn(
  event: ClusterWithdrawnEvent,
  provider: JsonRpcProvider,
  views: Contract,
  networkAddress: string,
  networkInterface: Interface,
  safeInterface: Interface,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const blockNumber = Number(event.blockNumber);
  const txHash = event.transactionHash;

  const tx = await provider.getTransaction(txHash);
  if (!tx) {
    return [{ status: "SKIP", message: `tx ${txHash} not available from RPC` }];
  }

  let decoded: DecodedWithdrawCall;
  try {
    decoded = decodeWithdrawCall(tx, networkAddress, networkInterface, safeInterface);
  } catch (err) {
    return [{ status: "FAIL", message: `decode error: ${shortError(err)}` }];
  }

  const eventValue = BigInt(event.value);
  push(
    results,
    eventValue === decoded.amount ? "PASS" : "FAIL",
    `event.value=${formatWei(eventValue)} decoded amount=${formatWei(decoded.amount)}`,
  );

  const eventOperatorIds = event.operatorIds.map((id) => BigInt(id));
  const idsMatch =
    eventOperatorIds.length === decoded.operatorIds.length &&
    eventOperatorIds.every((v, i) => v === decoded.operatorIds[i]);
  push(results, idsMatch ? "PASS" : "FAIL", `event operatorIds match tx input`);

  const owner = event.owner;
  const preBlock = blockNumber - 1;

  // Core invariant: withdrawn amount must not exceed available balance before the tx.
  try {
    const preBalance = await views.getBalance(owner, eventOperatorIds, decoded.inputCluster, { blockTag: preBlock });
    const preBalanceBn = BigInt(preBalance);
    push(
      results,
      eventValue <= preBalanceBn ? "PASS" : "CRITICAL",
      `withdrawn=${formatWei(eventValue)} <= preBalance=${formatWei(preBalanceBn)}`,
    );
  } catch (err) {
    push(results, "WARN", `preBalance check failed: ${shortError(err)}`);
  }

  // Post-state consistency (only meaningful if this is the sole SSVNetwork tx in the block).
  try {
    const block = await getRawBlock(provider, blockNumber);
    const blockTransactions = Array.isArray(block?.transactions) ? block.transactions : [];
    const networkTxs = blockTransactions
      .map((item: any) => tryDecodeAnyNetworkCall(item, networkAddress, networkInterface, safeInterface))
      .filter((x: any): x is { name: string; kind: "direct" | "safe" } => x !== null);

    if (networkTxs.length === 1) {
      const eventCluster = normalizeCluster({
        validatorCount: event.cluster_validatorCount,
        networkFeeIndex: event.cluster_networkFeeIndex,
        index: event.cluster_index,
        active: event.cluster_active,
        balance: event.cluster_balance,
      });
      const postBalance = await views.getBalance(owner, eventOperatorIds, eventCluster, { blockTag: blockNumber });
      const postBalanceBn = BigInt(postBalance);
      const eventBalanceBn = BigInt(event.cluster_balance);
      push(
        results,
        postBalanceBn === eventBalanceBn ? "PASS" : "FAIL",
        `postBalance=${formatWei(postBalanceBn)} event.cluster.balance=${formatWei(eventBalanceBn)}`,
      );
    } else {
      push(
        results,
        "SKIP",
        `post-state check skipped: ${networkTxs.length} SSVNetwork txs in block ${blockNumber}`,
      );
    }
  } catch (err) {
    push(results, "WARN", `post-state consistency check failed: ${shortError(err)}`);
  }

  return results;
}

async function checkOperatorWithdrawn(
  event: OperatorWithdrawnEvent,
  provider: JsonRpcProvider,
  views: Contract,
  networkAddress: string,
  networkInterface: Interface,
  safeInterface: Interface,
  isSSV: boolean,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const blockNumber = Number(event.blockNumber);
  const txHash = event.transactionHash;

  const tx = await provider.getTransaction(txHash);
  if (!tx) {
    return [{ status: "SKIP", message: `tx ${txHash} not available from RPC` }];
  }

  let decoded: DecodedOperatorWithdrawCall;
  try {
    decoded = decodeOperatorWithdrawCall(tx, networkAddress, networkInterface, safeInterface);
  } catch (err) {
    return [{ status: "FAIL", message: `decode error: ${shortError(err)}` }];
  }

  const eventOperatorId = BigInt(event.operatorId);
  push(
    results,
    eventOperatorId === decoded.operatorId ? "PASS" : "FAIL",
    `event operatorId=${eventOperatorId} decoded=${decoded.operatorId}`,
  );

  const viewFn = isSSV ? "getOperatorEarningsSSV" : "getOperatorEarnings";
  const preBlock = blockNumber - 1;

  try {
    const preEarnings = await views[viewFn](eventOperatorId, { blockTag: preBlock });
    const preEarningsBn = BigInt(preEarnings);
    const withdrawnBn = BigInt(event.value);
    push(
      results,
      withdrawnBn <= preEarningsBn ? "PASS" : "CRITICAL",
      `withdrawn=${formatWei(withdrawnBn)} <= preEarnings=${formatWei(preEarningsBn)}`,
    );
  } catch (err) {
    push(results, "WARN", `preEarnings check failed: ${shortError(err)}`);
  }

  return results;
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }

  const env = parseOptionalArg("env") ?? "mainnet";
  const network = parseOptionalArg("network") ?? resolveNetworkFromEnv(env) ?? "mainnet";
  const rpcUrl = resolveRpcUrl(network, parseOptionalArg("rpc-url"));
  const subgraphUrl = parseOptionalArg("subgraph-url") ?? process.env.SUBGRAPH_URL;
  const fromBlock = parseBlockArg(parseOptionalArg("from-block"), "from-block", DEFAULT_FROM_BLOCK);

  if (!subgraphUrl) {
    throw new Error("Missing --subgraph-url or SUBGRAPH_URL env var");
  }

  const config = await loadConfig(env);
  const networkAddress = config.ssvNetworkProxy;
  const viewsAddress = config.ssvNetworkViews;

  if (!networkAddress || !viewsAddress) {
    throw new Error("Missing ssvNetworkProxy or ssvNetworkViews in deployments config");
  }

  const [networkAbi, viewsAbi] = await Promise.all([
    loadAbi("abis/SSVNetwork.json"),
    loadAbi("abis/SSVNetworkViews.json"),
  ]);

  const provider = new JsonRpcProvider(rpcUrl);
  const views = new Contract(viewsAddress, viewsAbi, provider);
  const networkInterface = new Interface(networkAbi);
  const safeInterface = new Interface([
    "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures)",
  ]);

  let lastCheckedBlock = fromBlock;

  console.log(`RPC:          ${rpcUrl}`);
  console.log(`Subgraph:     ${subgraphUrl}`);
  console.log(`Network:      ${networkAddress}`);
  console.log(`Views:        ${viewsAddress}`);
  console.log(`From block:   ${lastCheckedBlock}`);
  console.log("Monitoring... Press Ctrl+C to stop.\n");

  while (true) {
    try {
      const [clusterData, operatorEthData, operatorSsvData] = await Promise.all([
        querySubgraph<{ clusterWithdrawns: ClusterWithdrawnEvent[] }>(
          subgraphUrl,
          CLUSTER_WITHDRAWN_QUERY,
          { lastBlock: lastCheckedBlock },
        ),
        querySubgraph<{ operatorWithdrawns: OperatorWithdrawnEvent[] }>(
          subgraphUrl,
          OPERATOR_WITHDRAWN_QUERY,
          { lastBlock: lastCheckedBlock },
        ),
        querySubgraph<{ operatorWithdrawnSSVs: OperatorWithdrawnEvent[] }>(
          subgraphUrl,
          OPERATOR_WITHDRAWN_SSV_QUERY,
          { lastBlock: lastCheckedBlock },
        ),
      ]);

      const clusterEvents = clusterData.clusterWithdrawns;
      const operatorEthEvents = operatorEthData.operatorWithdrawns;
      const operatorSsvEvents = operatorSsvData.operatorWithdrawnSSVs;

      if (clusterEvents.length >= 100) {
        console.warn(`[WARN] clusterWithdrawns returned 100 events; may be truncated`);
      }
      if (operatorEthEvents.length >= 100) {
        console.warn(`[WARN] operatorWithdrawns returned 100 events; may be truncated`);
      }
      if (operatorSsvEvents.length >= 100) {
        console.warn(`[WARN] operatorWithdrawnSSVs returned 100 events; may be truncated`);
      }

      const allEvents = [
        ...clusterEvents.map((e) => ({ type: "cluster" as const, event: e })),
        ...operatorEthEvents.map((e) => ({ type: "opEth" as const, event: e })),
        ...operatorSsvEvents.map((e) => ({ type: "opSsv" as const, event: e })),
      ].sort((a, b) => Number(a.event.blockNumber) - Number(b.event.blockNumber));

      for (const item of allEvents) {
        const blockNumber = Number(item.event.blockNumber);
        const txHash = item.event.transactionHash;
        let results: CheckResult[] = [];

        if (item.type === "cluster") {
          console.log(`[BLOCK ${blockNumber}] ClusterWithdrawn ${txHash}`);
          results = await checkClusterWithdrawn(
            item.event,
            provider,
            views,
            networkAddress,
            networkInterface,
            safeInterface,
          );
        } else {
          const suffix = item.type === "opSsv" ? "SSV" : "";
          console.log(`[BLOCK ${blockNumber}] OperatorWithdrawn${suffix} ${txHash}`);
          results = await checkOperatorWithdrawn(
            item.event,
            provider,
            views,
            networkAddress,
            networkInterface,
            safeInterface,
            item.type === "opSsv",
          );
        }

        printResults(results);

        const hasAlert = results.some((r) => r.status === "FAIL" || r.status === "CRITICAL");
        if (hasAlert) {
          console.error(`\n*** ALERT: Invariant violation in ${txHash} ***\n`);
        }

        if (blockNumber > lastCheckedBlock) {
          lastCheckedBlock = blockNumber;
        }
      }

      if (allEvents.length === 0) {
        // Advance lastCheckedBlock to latest - 1 so we do not re-query the same empty window forever.
        const latest = await provider.getBlockNumber();
        if (latest > lastCheckedBlock) {
          lastCheckedBlock = latest - 1;
        }
      }
    } catch (err) {
      console.error(`[ERROR] Poll cycle failed: ${shortError(err)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
