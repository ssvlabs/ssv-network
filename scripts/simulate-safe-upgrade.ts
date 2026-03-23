import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AbiCoder,
  Contract,
  Interface,
  getAddress,
  isAddress,
  keccak256,
  toUtf8Bytes,
  zeroPadValue,
} from "ethers";
import { getDeployer, getEthers, parseArg } from "./common/helpers.ts";
import {
  type ModuleAddresses,
  type UpgradeConfig,
  MODULE_ORDER,
  bigintToJsonNumberOrString,
  normalizeOracles,
  parseOptionalArg,
  parseOptionalBooleanArg,
  parseQuorum,
  parseUint,
  requireAddress,
  resolveConfigPath,
  resolveCooldownDuration,
  resolveDefaultOracleIds,
  resolveEnvDir,
  resolveProtocolParams,
  LOCAL_FORK_RPC_URL,
} from "./common/config.ts";
import { getSignerForAddress, resolveRpcUrl, canImpersonateOnNetwork } from "./common/impersonation.ts";
import { SSVModules } from "./common/modules.ts";
import { readOnChainValues, verifyPostUpgradeState } from "./common/verify.ts";

type SafeTransactionJson = {
  to: string;
  data: string;
  value: string | number;
  operation: string | number;
  baseGas: string | number;
  gasPrice: string | number;
  gasToken: string;
  nonce: string | number;
  refundReceiver: string;
  safeTxGas: string | number;
};

type NormalizedSafeTransaction = {
  to: string;
  data: string;
  value: bigint;
  operation: number;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: string;
  nonce: bigint;
  refundReceiver: string;
  safeTxGas: bigint;
};

type SafeBatchJson = {
  transactions: Array<{
    to: string;
    value: string;
    data: string;
  }>;
};

type ParsedDeployResult = {
  networkImplementation: string;
  viewsImplementation: string;
  cssvToken: string;
  modules: ModuleAddresses;
  chainId?: string;
};

type MultiSendCall = {
  operation: number;
  to: string;
  value: bigint;
  data: string;
};

type SimulationResult = UpgradeConfig & {
  simulation: {
    safeAddress: string;
    safeTxHash: string;
    safeNonce: number | string;
    postExecutionSafeNonce: number | string;
    selectedApprovers: string[];
    executionBlock: number;
    receiptHash: string;
  };
};

const SAFE_IFACE = new Interface([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function approveHash(bytes32 hashToApprove)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool success)",
  "event ExecutionSuccess(bytes32 txHash,uint256 payment)",
  "event ExecutionFailure(bytes32 txHash,uint256 payment)",
]);

const MULTISEND_IFACE = new Interface([
  "function multiSend(bytes transactions)",
]);

const ERC20_IFACE = new Interface([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

const SSV_VIEWS_MODULE_IFACE = new Interface([
  "function CSSV_ADDRESS() view returns (address)",
]);

const NETWORK_VIEWS_PROXY_IFACE = new Interface([
  "function ssvNetwork() view returns (address)",
]);

const PROXY_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const SSV_STORAGE_POSITION = BigInt(keccak256(toUtf8Bytes("ssv.network.storage.main"))) - 1n;
const SSV_CONTRACTS_MAPPING_SLOT = SSV_STORAGE_POSITION + 3n;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function normalizeSafeTransaction(input: SafeTransactionJson): NormalizedSafeTransaction {
  const to = requireAddress(input.to, "safe tx to");
  const gasToken = requireAddress(input.gasToken, "safe tx gasToken");
  const refundReceiver = requireAddress(input.refundReceiver, "safe tx refundReceiver");
  const value = parseUint(input.value, "safe tx value");
  const baseGas = parseUint(input.baseGas, "safe tx baseGas");
  const gasPrice = parseUint(input.gasPrice, "safe tx gasPrice");
  const nonce = parseUint(input.nonce, "safe tx nonce");
  const safeTxGas = parseUint(input.safeTxGas, "safe tx safeTxGas");

  assert(value !== undefined, "safe tx value is required");
  assert(baseGas !== undefined, "safe tx baseGas is required");
  assert(gasPrice !== undefined, "safe tx gasPrice is required");
  assert(nonce !== undefined, "safe tx nonce is required");
  assert(safeTxGas !== undefined, "safe tx safeTxGas is required");
  assert(typeof input.data === "string" && input.data.startsWith("0x"), "safe tx data must be a hex string");

  const operation = Number.parseInt(String(input.operation), 10);
  assert(Number.isInteger(operation) && operation >= 0 && operation <= 255, `Invalid safe tx operation: ${input.operation}`);
  assert(operation === 1, `Expected Safe tx operation=1 (delegatecall), got ${operation}`);

  return {
    to,
    data: input.data,
    value,
    operation,
    baseGas,
    gasPrice,
    gasToken,
    nonce,
    refundReceiver,
    safeTxGas,
  };
}

function resolveDeployResult(raw: any): ParsedDeployResult {
  const networkImplementation =
    raw?.implementations?.SSVNetworkSSVStakingUpgrade ??
    raw?.ssvNetworkStakingUpgradeImplementation ??
    raw?.deployments?.ssvNetworkStakingUpgradeImplementation;
  const viewsImplementation =
    raw?.implementations?.SSVNetworkViews ??
    raw?.ssvNetworkViewsImplementation ??
    raw?.deployments?.ssvNetworkViewsImplementation;
  const cssvToken =
    raw?.cssvToken?.address ??
    raw?.cssvToken ??
    raw?.deployments?.cssvToken;
  const modulesSource =
    raw?.modules ??
    raw?.deployments?.modules;

  assert(isAddress(networkImplementation), "deploy-result is missing SSVNetworkSSVStakingUpgrade implementation");
  assert(isAddress(viewsImplementation), "deploy-result is missing SSVNetworkViews implementation");
  assert(isAddress(cssvToken), "deploy-result is missing cssvToken");
  assert(modulesSource && typeof modulesSource === "object", "deploy-result is missing modules");

  const moduleRecord = modulesSource as Record<string, unknown>;
  const modules = {} as ModuleAddresses;
  for (const moduleName of MODULE_ORDER) {
    const moduleAddress = moduleRecord[moduleName];
    assert(isAddress(moduleAddress), `deploy-result is missing module address for ${moduleName}`);
    modules[moduleName] = getAddress(moduleAddress);
  }

  return {
    networkImplementation: getAddress(networkImplementation),
    viewsImplementation: getAddress(viewsImplementation),
    cssvToken: getAddress(cssvToken),
    modules,
    chainId: raw?.chainId?.toString?.() ?? raw?.deployments?.chainId?.toString?.(),
  };
}

function parseMultiSendCalls(data: string): MultiSendCall[] {
  const parsed = MULTISEND_IFACE.parseTransaction({ data });
  assert(parsed?.name === "multiSend", "safe tx data is not a multiSend(bytes) call");

  const encodedTransactions = String(parsed.args[0]);
  const bytes = encodedTransactions.slice(2);
  const calls: MultiSendCall[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    assert(offset + 2 + 40 + 64 + 64 <= bytes.length, "multiSend payload is truncated");
    const operation = Number.parseInt(bytes.slice(offset, offset + 2), 16);
    offset += 2;

    const to = getAddress(`0x${bytes.slice(offset, offset + 40)}`);
    offset += 40;

    const value = BigInt(`0x${bytes.slice(offset, offset + 64)}`);
    offset += 64;

    const dataLength = Number(BigInt(`0x${bytes.slice(offset, offset + 64)}`));
    offset += 64;

    assert(offset + dataLength * 2 <= bytes.length, "multiSend inner calldata exceeds encoded payload length");
    const innerData = `0x${bytes.slice(offset, offset + dataLength * 2)}`;
    offset += dataLength * 2;

    calls.push({ operation, to, value, data: innerData });
  }

  return calls;
}

function assertBatchMatches(innerCalls: MultiSendCall[], batch: SafeBatchJson): void {
  assert(
    innerCalls.length === batch.transactions.length,
    `multiSend inner call count mismatch: safe tx has ${innerCalls.length}, batch has ${batch.transactions.length}`
  );

  for (const [index, innerCall] of innerCalls.entries()) {
    const batchTx = batch.transactions[index];
    const expectedTo = requireAddress(batchTx.to, `batch transaction ${index + 1} to`);
    const expectedValue = BigInt(batchTx.value);
    const expectedData = batchTx.data.toLowerCase();

    assert(innerCall.operation === 0, `inner call ${index + 1} must be CALL (0), got ${innerCall.operation}`);
    assert(
      innerCall.to.toLowerCase() === expectedTo.toLowerCase(),
      `inner call ${index + 1} target mismatch: expected ${expectedTo}, got ${innerCall.to}`
    );
    assert(
      innerCall.value === expectedValue,
      `inner call ${index + 1} value mismatch: expected ${expectedValue}, got ${innerCall.value}`
    );
    assert(
      innerCall.data.toLowerCase() === expectedData,
      `inner call ${index + 1} calldata mismatch`
    );
  }
}

function sortAddresses(addresses: string[]): string[] {
  return [...addresses].sort((left, right) => {
    const a = left.toLowerCase().slice(2);
    const b = right.toLowerCase().slice(2);
    return a.localeCompare(b);
  });
}

function buildPrevalidatedSignatures(owners: string[]): string {
  const sortedOwners = sortAddresses(owners);
  const encoded = sortedOwners.map((owner) => {
    const validator = zeroPadValue(owner, 32).slice(2);
    const ignored = "0".repeat(64);
    return `${validator}${ignored}01`;
  });
  return `0x${encoded.join("")}`;
}

async function readStorage(provider: any, address: string, slot: string): Promise<string> {
  return provider.send("eth_getStorageAt", [address, slot, "latest"]);
}

function decodeAddressFromStorage(storageValue: string): string {
  assert(storageValue.startsWith("0x") && storageValue.length === 66, `Unexpected storage word: ${storageValue}`);
  return getAddress(`0x${storageValue.slice(-40)}`);
}

async function readImplementationAddress(provider: any, proxyAddress: string): Promise<string> {
  const raw = await readStorage(provider, proxyAddress, PROXY_IMPLEMENTATION_SLOT);
  return decodeAddressFromStorage(raw);
}

async function readModuleAddress(provider: any, networkProxy: string, moduleId: number): Promise<string> {
  const slot = keccak256(
    AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [BigInt(moduleId), SSV_CONTRACTS_MAPPING_SLOT])
  );
  const raw = await readStorage(provider, networkProxy, slot);
  return decodeAddressFromStorage(raw);
}

async function runForkedTests(configPath: string, testPath: string | undefined): Promise<void> {
  const args = [
    "tsx",
    "scripts/run-forked-tests.ts",
    "--config",
    configPath,
    "--fork-network",
    "hardhat_forked",
    "--use-deployed-state",
    "true",
    "--strict-deployed-state",
    "true",
    "--allow-deployed-fallback",
    "false",
    "--no-gas-enforce",
    "true",
  ];

  if (testPath) {
    args.push("--test", testPath);
  }

  console.log(`[TEST] Running forked tests with MAINNET_RPC_URL=${LOCAL_FORK_RPC_URL}`);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("npx", args, {
      stdio: "inherit",
      env: {
        ...process.env,
        MAINNET_RPC_URL: LOCAL_FORK_RPC_URL,
      },
    });

    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`Forked tests failed with exit code ${code}`));
    });
  });
}

export async function main() {
  const envFlag = parseOptionalArg("env") ?? "mainnet";
  const txFilePath = resolve(parseArg("tx-file"));
  const targetNetwork = parseOptionalArg("network") ?? "local";
  const skipForkTests = parseOptionalBooleanArg("skip-fork-tests", false);
  const testPath = parseOptionalArg("test");

  const configPath = resolveConfigPath(envFlag);
  const deployResultPath = join(resolveEnvDir(envFlag), "deploy-result.json");
  const batchPath = join(resolveEnvDir(envFlag), "multisig-batch.json");

  const config = await readJsonFile<UpgradeConfig>(configPath);
  const deployResult = resolveDeployResult(await readJsonFile<any>(deployResultPath));
  const safeTx = normalizeSafeTransaction(await readJsonFile<SafeTransactionJson>(txFilePath));
  const safeBatch = await readJsonFile<SafeBatchJson>(batchPath);
  const outputPath = resolve(
    parseOptionalArg("output") ?? join(resolveEnvDir(envFlag), `safe-simulation-result.nonce-${safeTx.nonce.toString()}.json`)
  );

  const ssvNetworkProxy = requireAddress(config.ssvNetworkProxy, "ssvNetworkProxy");
  const ssvNetworkViews = requireAddress(config.ssvNetworkViews, "ssvNetworkViews");
  const ssvTokenAddress = requireAddress(config.ssvToken, "ssvToken");
  const safeAddress = requireAddress(config.owner ?? "", "config.owner (Safe address)");
  const targetRpcUrl = resolveRpcUrl(targetNetwork);

  assert(
    canImpersonateOnNetwork(targetNetwork, targetRpcUrl),
    `Target network ${targetNetwork} must support impersonation; use --network local against a local fork`
  );

  const ethers = await getEthers(targetNetwork);
  const providerNetwork = await ethers.provider.getNetwork();

  for (const [label, address] of [
    ["safe", safeAddress],
    ["SSVNetwork proxy", ssvNetworkProxy],
    ["SSVNetworkViews proxy", ssvNetworkViews],
    ["multiSend target", safeTx.to],
  ] as const) {
    const code = await ethers.provider.getCode(address);
    assert(code !== "0x", `No contract code at ${label} ${address} on ${targetNetwork}`);
  }

  const innerCalls = parseMultiSendCalls(safeTx.data);
  assertBatchMatches(innerCalls, safeBatch);
  console.log(`[PRE-FLIGHT] multiSend inner calls match ${batchPath} (${innerCalls.length} calls)`);

  const network = await ethers.getContractAt("SSVNetwork", ssvNetworkProxy);
  const viewsProxy = await ethers.getContractAt("SSVNetworkViews", ssvNetworkViews);
  const safe: any = new Contract(safeAddress, SAFE_IFACE, ethers.provider);

  const preUpgradeNetworkVersion = await network.getVersion();
  const onChainNetworkOwner = await network.owner();
  const onChainViewsOwner = await viewsProxy.owner();
  const currentSafeNonce = await safe.nonce();
  const safeOwners = (await safe.getOwners()).map((owner: string) => getAddress(owner));
  const safeThreshold = BigInt(await safe.getThreshold());

  assert(
    preUpgradeNetworkVersion === config.currentVersion,
    `Pre-upgrade version mismatch: config.currentVersion=${config.currentVersion}, on-chain=${preUpgradeNetworkVersion}`
  );
  assert(
    onChainNetworkOwner.toLowerCase() === safeAddress.toLowerCase(),
    `SSVNetwork owner mismatch: expected ${safeAddress}, got ${onChainNetworkOwner}`
  );
  assert(
    onChainViewsOwner.toLowerCase() === safeAddress.toLowerCase(),
    `SSVNetworkViews owner mismatch: expected ${safeAddress}, got ${onChainViewsOwner}`
  );
  assert(
    currentSafeNonce === safeTx.nonce,
    `Safe nonce mismatch: expected ${safeTx.nonce}, got ${currentSafeNonce}`
  );
  assert(safeThreshold > 0n, "Safe threshold must be greater than 0");
  assert(
    safeOwners.length >= Number(safeThreshold),
    `Safe has ${safeOwners.length} owners but threshold is ${safeThreshold}`
  );

  console.log(`[PRE-FLIGHT] network version before execution = ${preUpgradeNetworkVersion}`);
  console.log(`[PRE-FLIGHT] Safe threshold = ${safeThreshold}, owners = ${safeOwners.length}, nonce = ${currentSafeNonce}`);

  const selectedApprovers = safeOwners.slice(0, Number(safeThreshold));
  console.log(`[SAFE] Selected approvers: ${selectedApprovers.join(", ")}`);

  const safeTxHash = await safe.getTransactionHash(
    safeTx.to,
    safeTx.value,
    safeTx.data,
    safeTx.operation,
    safeTx.safeTxGas,
    safeTx.baseGas,
    safeTx.gasPrice,
    safeTx.gasToken,
    safeTx.refundReceiver,
    safeTx.nonce
  );
  console.log(`[SAFE] safeTxHash = ${safeTxHash}`);

  for (const ownerAddress of selectedApprovers) {
    const { signer, impersonated } = await getSignerForAddress(ethers, ownerAddress, true);
    const ownerSafe = safe.connect(signer);
    const approvalReceipt = await (await ownerSafe.approveHash(safeTxHash)).wait();
    console.log(`[SAFE] approveHash by ${ownerAddress}${impersonated ? " (impersonated)" : ""} in tx ${approvalReceipt?.hash ?? "unknown"}`);
  }

  const signatures = buildPrevalidatedSignatures(selectedApprovers);
  const executor = await getDeployer(ethers);
  const executorAddress = await executor.getAddress();
  const executorSafe = safe.connect(executor);

  console.log(`[SAFE] Executor = ${executorAddress}`);
  const staticOk = await executorSafe.execTransaction.staticCall(
    safeTx.to,
    safeTx.value,
    safeTx.data,
    safeTx.operation,
    safeTx.safeTxGas,
    safeTx.baseGas,
    safeTx.gasPrice,
    safeTx.gasToken,
    safeTx.refundReceiver,
    signatures
  );
  assert(staticOk === true, "Safe execTransaction.staticCall returned false");
  console.log("[SAFE] execTransaction.staticCall returned true");

  const executionTx = await executorSafe.execTransaction(
    safeTx.to,
    safeTx.value,
    safeTx.data,
    safeTx.operation,
    safeTx.safeTxGas,
    safeTx.baseGas,
    safeTx.gasPrice,
    safeTx.gasToken,
    safeTx.refundReceiver,
    signatures
  );
  const executionReceipt = await executionTx.wait();
  assert(executionReceipt, "Missing transaction receipt for Safe execution");

  let sawExecutionSuccess = false;
  let sawExecutionFailure = false;
  for (const log of executionReceipt.logs) {
    try {
      const parsed = SAFE_IFACE.parseLog(log);
      if (parsed?.name === "ExecutionSuccess") {
        sawExecutionSuccess = true;
        assert(parsed.args.txHash === safeTxHash, `ExecutionSuccess txHash mismatch: expected ${safeTxHash}, got ${parsed.args.txHash}`);
      }
      if (parsed?.name === "ExecutionFailure") {
        sawExecutionFailure = true;
      }
    } catch {
      // ignore unrelated logs
    }
  }

  assert(!sawExecutionFailure, "Safe emitted ExecutionFailure");
  assert(sawExecutionSuccess, "Safe did not emit ExecutionSuccess");

  const postExecutionSafeNonce = await safe.nonce();
  assert(
    postExecutionSafeNonce === safeTx.nonce + 1n,
    `Safe nonce did not increment correctly: expected ${safeTx.nonce + 1n}, got ${postExecutionSafeNonce}`
  );
  console.log(`[SAFE] Execution succeeded in tx ${executionReceipt.hash}`);

  const postUpgradeVersion = await network.getVersion();
  const postUpgradeViewsVersion = await viewsProxy.getVersion();
  assert(
    postUpgradeVersion === config.targetVersion,
    `SSVNetwork version mismatch after execution: expected ${config.targetVersion}, got ${postUpgradeVersion}`
  );
  assert(
    typeof postUpgradeViewsVersion === "string" && postUpgradeViewsVersion.length > 0,
    "SSVNetworkViews version is unreadable after execution"
  );
  console.log(`[POST] network version = ${postUpgradeVersion}`);
  console.log(`[POST] views version = ${postUpgradeViewsVersion}`);

  const actualNetworkImplementation = await readImplementationAddress(ethers.provider, ssvNetworkProxy);
  const actualViewsImplementation = await readImplementationAddress(ethers.provider, ssvNetworkViews);
  assert(
    actualNetworkImplementation.toLowerCase() === deployResult.networkImplementation.toLowerCase(),
    `SSVNetwork implementation mismatch: expected ${deployResult.networkImplementation}, got ${actualNetworkImplementation}`
  );
  assert(
    actualViewsImplementation.toLowerCase() === deployResult.viewsImplementation.toLowerCase(),
    `SSVNetworkViews implementation mismatch: expected ${deployResult.viewsImplementation}, got ${actualViewsImplementation}`
  );

  const actualModules = {} as ModuleAddresses;
  for (const moduleName of MODULE_ORDER) {
    const actualModuleAddress = await readModuleAddress(
      ethers.provider,
      ssvNetworkProxy,
      Number(SSVModules[moduleName as keyof typeof SSVModules])
    );
    const expectedModuleAddress = deployResult.modules[moduleName];
    assert(
      actualModuleAddress.toLowerCase() === expectedModuleAddress.toLowerCase(),
      `${moduleName} module mismatch: expected ${expectedModuleAddress}, got ${actualModuleAddress}`
    );
    actualModules[moduleName] = actualModuleAddress;
  }
  console.log("[POST] module pointers match deploy-result.json");

  const viewsModule: any = new Contract(actualModules.SSVViews, SSV_VIEWS_MODULE_IFACE, ethers.provider);
  const actualCssvToken = getAddress(await viewsModule.CSSV_ADDRESS());
  assert(
    actualCssvToken.toLowerCase() === deployResult.cssvToken.toLowerCase(),
    `CSSV token mismatch: expected ${deployResult.cssvToken}, got ${actualCssvToken}`
  );

  const viewsProxyConfig: any = new Contract(ssvNetworkViews, NETWORK_VIEWS_PROXY_IFACE, ethers.provider);
  const proxiedNetworkAddress = getAddress(await viewsProxyConfig.ssvNetwork());
  assert(
    proxiedNetworkAddress.toLowerCase() === ssvNetworkProxy.toLowerCase(),
    `SSVNetworkViews.ssvNetwork mismatch: expected ${ssvNetworkProxy}, got ${proxiedNetworkAddress}`
  );

  const params = resolveProtocolParams(config);
  const cooldownDuration = resolveCooldownDuration(config);
  const quorumBps = parseQuorum(config.quorumBps);
  const oracles = normalizeOracles(config.oracles);
  const defaultOracleIds = resolveDefaultOracleIds(config, oracles);

  console.log("[VERIFY] Running shared post-upgrade verifier");
  await verifyPostUpgradeState({
    views: viewsProxy,
    params,
    cooldownDuration,
    defaultOracleIds,
    quorumBps,
    oracles,
  });

  const onChainValues = await readOnChainValues(viewsProxy);
  const actualOracleEntries = await Promise.all(
    onChainValues.defaultOracleIds.map(async (oracleId) => ({
      id: oracleId,
      address: getAddress(await viewsProxy.getOracle(oracleId)),
    }))
  );

  const cssvToken: any = new Contract(actualCssvToken, ERC20_IFACE, ethers.provider);
  const totalStaked = BigInt(await viewsProxy.totalStaked());
  const cssvTotalSupply = BigInt(await cssvToken.totalSupply());
  const safeCssvBalance = BigInt(await cssvToken.balanceOf(safeAddress));
  const initialStakeAmount = parseUint(config.initialStakeAmount, "initialStakeAmount");

  assert(
    totalStaked === cssvTotalSupply,
    `totalStaked/CSSV totalSupply mismatch: totalStaked=${totalStaked} cssvTotalSupply=${cssvTotalSupply}`
  );
  if (initialStakeAmount !== undefined && initialStakeAmount > 0n) {
    assert(
      totalStaked === initialStakeAmount,
      `totalStaked mismatch after initial stake: expected ${initialStakeAmount}, got ${totalStaked}`
    );
    assert(
      safeCssvBalance === initialStakeAmount,
      `Safe cSSV balance mismatch after initial stake: expected ${initialStakeAmount}, got ${safeCssvBalance}`
    );
  }

  const result: SimulationResult = {
    ...config,
    currentVersion: postUpgradeVersion,
    owner: safeAddress,
    viewsOwner: onChainViewsOwner,
    ssvNetworkProxy,
    ssvNetworkViews,
    ssvToken: ssvTokenAddress,
    cssvToken: actualCssvToken,
    deployBlockNumber: executionReceipt.blockNumber,
    cooldownDuration: onChainValues.unstakeCooldownDuration,
    defaultOracleIds: onChainValues.defaultOracleIds,
    quorumBps: onChainValues.quorumBps,
    oracles: Object.fromEntries(actualOracleEntries.map(({ id, address }) => [String(id), address])),
    modules: actualModules,
    protocolParams: {
      ...config.protocolParams,
      networkFeeEth: onChainValues.networkFeeEth,
      networkFeeSSV: onChainValues.networkFeeSSV,
      maxOperatorEthFee: onChainValues.maxOperatorEthFee,
      minOperatorEthFee: onChainValues.minOperatorEthFee,
      operatorFeeIncreaseLimit: onChainValues.operatorFeeIncreaseLimit,
      declareOperatorFeePeriod: onChainValues.declareOperatorFeePeriod,
      executeOperatorFeePeriod: onChainValues.executeOperatorFeePeriod,
      liquidationThresholdPeriod: onChainValues.liquidationThresholdPeriod,
      liquidationThresholdPeriodSSV: onChainValues.liquidationThresholdPeriodSSV,
      ...(params.minBlocksBetweenUpdates !== undefined
        ? { minBlocksBetweenUpdates: bigintToJsonNumberOrString(params.minBlocksBetweenUpdates) }
        : {}),
      minimumLiquidationCollateralEth: onChainValues.minimumLiquidationCollateralEth,
      minimumLiquidationCollateralSSV: onChainValues.minimumLiquidationCollateralSSV,
      validatorsPerOperatorLimit: onChainValues.validatorsPerOperatorLimit,
      unstakeCooldownDuration: onChainValues.unstakeCooldownDuration,
    },
    deployments: {
      ...(config.deployments ?? {}),
      ssvNetworkStakingUpgradeImplementation: actualNetworkImplementation,
      ssvNetworkViewsImplementation: actualViewsImplementation,
      cssvToken: actualCssvToken,
      modules: actualModules,
      targetNetwork: targetNetwork,
      deployBlockNumber: executionReceipt.blockNumber,
      chainId: providerNetwork.chainId.toString(),
      updatedAt: new Date().toISOString(),
    },
    simulation: {
      safeAddress,
      safeTxHash,
      safeNonce: bigintToJsonNumberOrString(safeTx.nonce),
      postExecutionSafeNonce: bigintToJsonNumberOrString(postExecutionSafeNonce),
      selectedApprovers,
      executionBlock: executionReceipt.blockNumber,
      receiptHash: executionReceipt.hash,
    },
  };

  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`[OUTPUT] wrote simulation result to ${outputPath}`);

  if (skipForkTests) {
    console.log("[TEST] Skipping forked tests (--skip-fork-tests)");
    return;
  }

  await runForkedTests(outputPath, testPath);
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
