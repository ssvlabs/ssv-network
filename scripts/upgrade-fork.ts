import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isAddress } from "ethers";
import { deployContract, getEthers, parseArg } from "./common/helpers.ts";
import { SSVModules } from "./common/modules.ts";

type ModuleName = keyof typeof SSVModules;
type ModuleAddresses = Record<ModuleName, string>;
type OracleEntry = { id: number; address: string };
type OraclesConfig = Record<string, string> | OracleEntry[];
type ModuleAddressesConfig = Partial<Record<ModuleName, string>>;

type UpgradeForkDeployments = {
  ssvNetworkImplementation?: string;
  ssvNetworkStakingUpgradeImplementation?: string;
  ssvNetworkViewsImplementation?: string;
  cssvToken?: string;
  modules?: ModuleAddressesConfig;
  targetNetwork?: string;
  forkBlockNumber?: number;
  chainId?: string;
  updatedAt?: string;
};

type UpgradeForkConfig = {
  owner?: string;
  viewsOwner?: string;
  ssvNetworkProxy: string;
  ssvNetworkViews: string;
  ssvToken: string;
  cooldownDuration?: string | number;
  upgradeTimestamp?: string | number;
  defaultOracleIds?: number[];
  networkFeeEth?: string | number;
  networkFeeSSV?: string | number;
  maxOperatorEthFee?: string | number;
  minOperatorEthFee?: string | number;
  operatorFeeIncreaseLimit?: string | number;
  declareOperatorFeePeriod?: string | number;
  executeOperatorFeePeriod?: string | number;
  liquidationThresholdPeriod?: string | number;
  minimumLiquidationCollateralEth?: string | number;
  minimumLiquidationCollateralSSV?: string | number;
  validatorsPerOperatorLimit?: string | number;
  unstakeCooldownDuration?: string | number;
  quorumBps?: number;
  oracles?: OraclesConfig;
  cssvToken?: string;
  forkBlockNumber?: number;
  modules?: ModuleAddressesConfig;
  deployments?: UpgradeForkDeployments;
};

const MODULE_ORDER: ModuleName[] = [
  "SSVOperators",
  "SSVClusters",
  "SSVDAO",
  "SSVViews",
  "SSVOperatorsWhitelist",
  "SSVStaking",
  "SSVValidators",
];

function parseUint(value: unknown, label: string): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid ${label} (must be a non-negative integer)`);
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    if (!/^\d+$/.test(value)) {
      throw new Error(`Invalid ${label} (string must be an integer)`);
    }
    return BigInt(value);
  }
  throw new Error(`Invalid ${label} (expected string or number)`);
}

function parseOptionalArg(argName: string): string | undefined {
  const index = process.argv.indexOf(`--${argName}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`Missing value for --${argName}`);
  return value;
}

function parseOptionalBooleanArg(argName: string, fallback: boolean): boolean {
  const raw = parseOptionalArg(argName);
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`Invalid --${argName} value: ${raw}. Use true|false`);
}

function resolveDeployedConfigPath(initConfigPath: string, outputArg?: string): string {
  if (outputArg) {
    return resolve(outputArg);
  }
  if (initConfigPath.endsWith("-deployed.config.json")) {
    return initConfigPath;
  }
  if (initConfigPath.endsWith(".config.json")) {
    return initConfigPath.replace(/\.config\.json$/, "-deployed.config.json");
  }
  if (initConfigPath.endsWith(".json")) {
    return initConfigPath.replace(/\.json$/, "-deployed.json");
  }
  return `${initConfigPath}-deployed.json`;
}

function parseQuorum(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number") {
    throw new Error("Invalid quorumBps (must be a number)");
  }
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error("Invalid quorumBps (must be 0..10000)");
  }
  return value;
}

function normalizeOracles(oracles: OraclesConfig | undefined): OracleEntry[] {
  if (!oracles) return [];

  const source = Array.isArray(oracles)
    ? oracles
    : Object.entries(oracles).map(([id, address]) => ({ id: Number(id), address }));

  const seen = new Set<number>();
  const normalized = source.map(({ id, address }) => {
    if (!Number.isInteger(id) || id <= 0 || id > 0xffffffff) {
      throw new Error(`Invalid oracle id: ${id}`);
    }
    if (!isAddress(address)) {
      throw new Error(`Invalid oracle address: ${address}`);
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate oracle id: ${id}`);
    }
    seen.add(id);
    return { id, address };
  });

  return normalized.sort((a, b) => a.id - b.id);
}

function normalizeOracleIds(ids: number[]): [number, number, number, number] {
  if (ids.length !== 4) {
    throw new Error("defaultOracleIds must contain exactly 4 ids");
  }

  const validated = ids.map((id) => {
    if (!Number.isInteger(id) || id <= 0 || id > 0xffffffff) {
      throw new Error(`Invalid default oracle id: ${id}`);
    }
    return id;
  });

  return [validated[0], validated[1], validated[2], validated[3]];
}

function resolveDefaultOracleIds(
  config: UpgradeForkConfig,
  oracles: OracleEntry[]
): [number, number, number, number] {
  if (Array.isArray(config.defaultOracleIds) && config.defaultOracleIds.length > 0) {
    return normalizeOracleIds(config.defaultOracleIds);
  }
  if (oracles.length > 0) {
    return normalizeOracleIds(oracles.map((oracle) => oracle.id));
  }
  const env = process.env.DEFAULT_ORACLE_IDS ?? "1,2,3,4";
  const parsed = env
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 0xffffffff);
  return normalizeOracleIds(parsed);
}

function toOracleConfig(oracles: OracleEntry[]): Record<string, string> {
  return Object.fromEntries(oracles.map(({ id, address }) => [String(id), address]));
}

function requireAddress(value: string, label: string): string {
  if (!isAddress(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

function bigintToJsonNumberOrString(value: bigint): number | string {
  if (value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return value.toString();
}

function normalizeComparable(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => normalizeComparable(v));
  return value;
}

function formatValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return `[${value.map((v) => formatValue(v)).join(", ")}]`;
  return String(value);
}

function assertEqual(label: string, expected: unknown, actual: unknown): void {
  const expectedComparable = normalizeComparable(expected);
  const actualComparable = normalizeComparable(actual);
  if (JSON.stringify(expectedComparable) !== JSON.stringify(actualComparable)) {
    throw new Error(
      `[VERIFY] ${label} mismatch. expected=${formatValue(expected)} actual=${formatValue(actual)}`
    );
  }
  console.log(`[VERIFY] ${label} = ${formatValue(actual)}`);
}

function logObserved(label: string, value: unknown): void {
  console.log(`[VERIFY] ${label} = ${formatValue(value)}`);
}

async function trySend(provider: any, method: string, params: unknown[]) {
  try {
    await provider.send(method, params);
    return true;
  } catch {
    return false;
  }
}

async function impersonate(provider: any, address: string) {
  const ok =
    (await trySend(provider, "hardhat_impersonateAccount", [address])) ||
    (await trySend(provider, "anvil_impersonateAccount", [address]));
  if (!ok) {
    throw new Error("Impersonation not supported by the RPC node");
  }
}

async function setBalance(provider: any, address: string, balanceHex: string) {
  const ok =
    (await trySend(provider, "hardhat_setBalance", [address, balanceHex])) ||
    (await trySend(provider, "anvil_setBalance", [address, balanceHex]));
  if (!ok) {
    throw new Error("Setting balance not supported by the RPC node");
  }
}

async function getSignerForAddress(
  ethers: any,
  address: string,
  useGetImpersonatedSigner: boolean
): Promise<{ signer: any; impersonated: boolean }> {
  const signers = await ethers.getSigners();
  for (const signer of signers) {
    if ((await signer.getAddress()).toLowerCase() === address.toLowerCase()) {
      // Best-effort top up to avoid insufficient funds on forks
      await trySend(ethers.provider, "hardhat_setBalance", [address, "0x56bc75e2d63100000"]);
      await trySend(ethers.provider, "anvil_setBalance", [address, "0x56bc75e2d63100000"]);
      return { signer, impersonated: false };
    }
  }

  if (useGetImpersonatedSigner && typeof ethers.getImpersonatedSigner === "function") {
    try {
      const signer = await ethers.getImpersonatedSigner(address);
      await trySend(ethers.provider, "hardhat_setBalance", [address, "0x56bc75e2d63100000"]);
      await trySend(ethers.provider, "anvil_setBalance", [address, "0x56bc75e2d63100000"]);
      return { signer, impersonated: true };
    } catch {
      // Fall back to manual RPC impersonation
    }
  }

  await impersonate(ethers.provider, address);
  await setBalance(ethers.provider, address, "0x56bc75e2d63100000");
  return { signer: await ethers.getSigner(address), impersonated: true };
}

async function main() {
  const targetNetwork = parseArg("network");
  const initConfigPath = resolve(parseArg("config"));
  const useGetImpersonatedSigner = parseOptionalBooleanArg("use-get-impersonated-signer", true);
  const deployedConfigPath = resolveDeployedConfigPath(
    initConfigPath,
    parseOptionalArg("output-config")
  );

  const raw = await readFile(initConfigPath, "utf8");
  const config = JSON.parse(raw) as UpgradeForkConfig;

  const ssvNetworkProxy = requireAddress(config.ssvNetworkProxy, "ssvNetworkProxy");
  const ssvNetworkViews = requireAddress(config.ssvNetworkViews, "ssvNetworkViews");
  const ssvToken = requireAddress(config.ssvToken, "ssvToken");

  const networkFeeEth = parseUint(config.networkFeeEth, "networkFeeEth");
  const networkFeeSSV = parseUint(config.networkFeeSSV, "networkFeeSSV");
  const maxOperatorEthFee = parseUint(config.maxOperatorEthFee, "maxOperatorEthFee");
  const minOperatorEthFee = parseUint(config.minOperatorEthFee, "minOperatorEthFee");
  const operatorFeeIncreaseLimit = parseUint(config.operatorFeeIncreaseLimit, "operatorFeeIncreaseLimit");
  const declareOperatorFeePeriod = parseUint(config.declareOperatorFeePeriod, "declareOperatorFeePeriod");
  const executeOperatorFeePeriod = parseUint(config.executeOperatorFeePeriod, "executeOperatorFeePeriod");
  const liquidationThresholdPeriod = parseUint(config.liquidationThresholdPeriod, "liquidationThresholdPeriod");
  const minimumLiquidationCollateralEth = parseUint(
    config.minimumLiquidationCollateralEth,
    "minimumLiquidationCollateralEth"
  );
  const minimumLiquidationCollateralSSV = parseUint(
    config.minimumLiquidationCollateralSSV,
    "minimumLiquidationCollateralSSV"
  );
  const unstakeCooldownDuration = parseUint(config.unstakeCooldownDuration, "unstakeCooldownDuration");
  const cooldownDuration = parseUint(config.cooldownDuration, "cooldownDuration") ?? 7n * 24n * 60n * 60n;
  const upgradeTimestamp = parseUint(config.upgradeTimestamp, "upgradeTimestamp") ?? 0n;
  const quorumBps = parseQuorum(config.quorumBps);
  const oracles = normalizeOracles(config.oracles);
  const defaultOracleIds = resolveDefaultOracleIds(config, oracles);

  const ethers = await getEthers(targetNetwork);
  const providerNetwork = await ethers.provider.getNetwork();

  const networkCode = await ethers.provider.getCode(ssvNetworkProxy);
  if (networkCode === "0x") {
    throw new Error(
      `No contract code at ssvNetworkProxy ${ssvNetworkProxy} on ${targetNetwork}. ` +
      `Check your fork RPC and fork block number.`
    );
  }
  const viewsCode = await ethers.provider.getCode(ssvNetworkViews);
  if (viewsCode === "0x") {
    throw new Error(
      `No contract code at ssvNetworkViews ${ssvNetworkViews} on ${targetNetwork}. ` +
      `Check your fork RPC and fork block number.`
    );
  }

  const network = await ethers.getContractAt("SSVNetwork", ssvNetworkProxy);
  const viewsProxy = await ethers.getContractAt("SSVNetworkViews", ssvNetworkViews);

  const ownerAddr = config.owner ? requireAddress(config.owner, "owner address") : await network.owner();
  const viewsOwnerAddr = config.viewsOwner
    ? requireAddress(config.viewsOwner, "viewsOwner address")
    : await viewsProxy.owner();

  const { signer: ownerSigner, impersonated: networkOwnerImpersonated } = await getSignerForAddress(
    ethers,
    ownerAddr,
    useGetImpersonatedSigner
  );
  const { signer: viewsOwnerSigner, impersonated: viewsOwnerImpersonated } =
    viewsOwnerAddr.toLowerCase() === ownerAddr.toLowerCase()
      ? { signer: ownerSigner, impersonated: networkOwnerImpersonated }
      : await getSignerForAddress(ethers, viewsOwnerAddr, useGetImpersonatedSigner);

  const networkOwner = network.connect(ownerSigner);
  const viewsOwner = viewsProxy.connect(viewsOwnerSigner);
  const views = viewsProxy.connect(ownerSigner);

  console.log(`Network owner: ${ownerAddr}${networkOwnerImpersonated ? " (impersonated)" : ""}`);
  console.log(`Views owner:   ${viewsOwnerAddr}${viewsOwnerImpersonated ? " (impersonated)" : ""}`);
  console.log(`Impersonation mode: ${useGetImpersonatedSigner ? "getImpersonatedSigner+fallback" : "manual RPC only"}`);
  console.log("[1/6] Deploying implementations (SSVNetwork, staking upgrade, SSVNetworkViews)");
  // const { address: networkImplAddr } = await deployContract(ethers, "SSVNetwork", [], ownerSigner);
  const { address: stakingUpgradeImplAddr } = await deployContract(ethers, "SSVNetworkSSVStakingUpgrade", [], ownerSigner);
  const { address: viewsImplAddr } = await deployContract(ethers, "SSVNetworkViews", [], ownerSigner);

  console.log(`[2/6] Deploying CSSVToken for ${ssvNetworkProxy}`);
  const { address: cssvAddr } = await deployContract(ethers, "CSSVToken", [ssvNetworkProxy], ownerSigner);

  console.log("[3/6] Deploying all module implementations");
  const { address: ssvOperatorsAddr } = await deployContract(ethers, "SSVOperators", [upgradeTimestamp], ownerSigner);
  const { address: ssvClustersAddr } = await deployContract(ethers, "SSVClusters", [], ownerSigner);
  const { address: ssvDaoAddr } = await deployContract(ethers, "SSVDAO", [cssvAddr], ownerSigner);
  const { address: ssvViewsAddr } = await deployContract(ethers, "SSVViews", [cssvAddr], ownerSigner);
  const { address: ssvOperatorsWhitelistAddr } = await deployContract(ethers, "SSVOperatorsWhitelist", [], ownerSigner);
  const { address: ssvStakingAddr } = await deployContract(ethers, "SSVStaking", [cssvAddr], ownerSigner);
  const { address: ssvValidatorsAddr } = await deployContract(ethers, "SSVValidators", [], ownerSigner);

  const modules: ModuleAddresses = {
    SSVOperators: ssvOperatorsAddr,
    SSVClusters: ssvClustersAddr,
    SSVDAO: ssvDaoAddr,
    SSVViews: ssvViewsAddr,
    SSVOperatorsWhitelist: ssvOperatorsWhitelistAddr,
    SSVStaking: ssvStakingAddr,
    SSVValidators: ssvValidatorsAddr,
  };

  console.log("[4/6] Upgrading network proxy and views proxy");
  // Perform staking upgrade first to run reinitializer(3) against the existing proxy.
  // Doing this after upgrading to the latest base implementation may change reinitializer behavior.
  const upgradeFactory = await ethers.getContractFactory("SSVNetworkSSVStakingUpgrade");
  const initData = upgradeFactory.interface.encodeFunctionData(
    "initializeSSVStaking(uint64,uint32[4])",
    [cooldownDuration, defaultOracleIds]
  );
  await (await networkOwner.upgradeToAndCall(stakingUpgradeImplAddr, initData)).wait();
  // await (await networkOwner.upgradeTo(networkImplAddr)).wait();

  await (await viewsOwner.upgradeTo(viewsImplAddr)).wait();

  console.log("[5/6] Attaching all modules");
  for (const mod of MODULE_ORDER) {
    const moduleId = SSVModules[mod];
    const moduleAddress = modules[mod];
    await (await networkOwner.updateModule(moduleId, moduleAddress)).wait();
  }

  console.log("[6/6] Applying configuration from JSON and updating JSON outputs");
  if (networkFeeEth !== undefined) {
    await (await networkOwner.updateNetworkFee(networkFeeEth)).wait();
  }
  if (networkFeeSSV !== undefined) {
    await (await networkOwner.updateNetworkFeeSSV(networkFeeSSV)).wait();
  }
  if (liquidationThresholdPeriod !== undefined) {
    await (await networkOwner.updateLiquidationThresholdPeriod(liquidationThresholdPeriod)).wait();
  }
  if (minimumLiquidationCollateralEth !== undefined) {
    await (await networkOwner.updateMinimumLiquidationCollateral(minimumLiquidationCollateralEth)).wait();
  }
  if (minimumLiquidationCollateralSSV !== undefined) {
    await (await networkOwner.updateMinimumLiquidationCollateralSSV(minimumLiquidationCollateralSSV)).wait();
  }
  if (declareOperatorFeePeriod !== undefined) {
    await (await networkOwner.updateDeclareOperatorFeePeriod(declareOperatorFeePeriod)).wait();
  }
  if (executeOperatorFeePeriod !== undefined) {
    await (await networkOwner.updateExecuteOperatorFeePeriod(executeOperatorFeePeriod)).wait();
  }
  if (operatorFeeIncreaseLimit !== undefined) {
    await (await networkOwner.updateOperatorFeeIncreaseLimit(operatorFeeIncreaseLimit)).wait();
  }
  if (maxOperatorEthFee !== undefined) {
    await (await networkOwner.updateMaximumOperatorFee(maxOperatorEthFee)).wait();
  }
  if (minOperatorEthFee !== undefined) {
    await (await networkOwner.updateMinimumOperatorEthFee(minOperatorEthFee)).wait();
  }
  if (quorumBps !== undefined) {
    await (await networkOwner.setQuorumBps(quorumBps)).wait();
  }
  if (unstakeCooldownDuration !== undefined) {
    await (await networkOwner.setUnstakeCooldownDuration(unstakeCooldownDuration)).wait();
  }
  for (const { id, address } of oracles) {
    await (await networkOwner.replaceOracle(id, address)).wait();
  }

  console.log("[VERIFY] Querying SSVViews for post-upgrade parameters");
  const viewsVersion = await views.getVersion();
  const actualCooldownDuration = await views.cooldownDuration();
  const actualDefaultOracleIds = await views.getActiveOracleIds();
  const actualQuorumBps = await views.getQuorumBps();
  const actualNetworkFeeEth = await views.getNetworkFee();
  const actualNetworkFeeSSV = await views.getNetworkFeeSSV();
  const actualOperatorFeeIncreaseLimit = await views.getOperatorFeeIncreaseLimit();
  const actualOperatorFeePeriods = await views.getOperatorFeePeriods();
  const actualLiquidationThresholdPeriod = await views.getLiquidationThresholdPeriod();
  const actualMinimumLiquidationCollateralEth = await views.getMinimumLiquidationCollateral();
  const actualMinimumLiquidationCollateralSSV = await views.getMinimumLiquidationCollateralSSV();
  const actualMaxOperatorEthFee = await views.getMaximumOperatorFee();
  const actualMinOperatorEthFee = await views.getMinimumOperatorEthFee();
  const actualValidatorsPerOperatorLimit = await views.getValidatorsPerOperatorLimit();
  const expectedCooldownDuration = unstakeCooldownDuration ?? cooldownDuration;

  logObserved("views.version", viewsVersion);
  assertEqual("cooldownDuration", expectedCooldownDuration, actualCooldownDuration);
  assertEqual(
    "defaultOracleIds",
    defaultOracleIds.map((id) => BigInt(id)),
    Array.from(actualDefaultOracleIds)
  );

  if (quorumBps !== undefined) {
    assertEqual("quorumBps", BigInt(quorumBps), actualQuorumBps);
  } else {
    logObserved("quorumBps", actualQuorumBps);
  }
  if (networkFeeEth !== undefined) {
    assertEqual("networkFeeEth", networkFeeEth, actualNetworkFeeEth);
  } else {
    logObserved("networkFeeEth", actualNetworkFeeEth);
  }
  if (networkFeeSSV !== undefined) {
    assertEqual("networkFeeSSV", networkFeeSSV, actualNetworkFeeSSV);
  } else {
    logObserved("networkFeeSSV", actualNetworkFeeSSV);
  }
  if (operatorFeeIncreaseLimit !== undefined) {
    assertEqual("operatorFeeIncreaseLimit", operatorFeeIncreaseLimit, actualOperatorFeeIncreaseLimit);
  } else {
    logObserved("operatorFeeIncreaseLimit", actualOperatorFeeIncreaseLimit);
  }
  if (declareOperatorFeePeriod !== undefined) {
    assertEqual("declareOperatorFeePeriod", declareOperatorFeePeriod, actualOperatorFeePeriods.declarePeriod);
  } else {
    logObserved("declareOperatorFeePeriod", actualOperatorFeePeriods.declarePeriod);
  }
  if (executeOperatorFeePeriod !== undefined) {
    assertEqual("executeOperatorFeePeriod", executeOperatorFeePeriod, actualOperatorFeePeriods.executePeriod);
  } else {
    logObserved("executeOperatorFeePeriod", actualOperatorFeePeriods.executePeriod);
  }
  if (liquidationThresholdPeriod !== undefined) {
    assertEqual("liquidationThresholdPeriod", liquidationThresholdPeriod, actualLiquidationThresholdPeriod);
  } else {
    logObserved("liquidationThresholdPeriod", actualLiquidationThresholdPeriod);
  }
  if (minimumLiquidationCollateralEth !== undefined) {
    assertEqual(
      "minimumLiquidationCollateralEth",
      minimumLiquidationCollateralEth,
      actualMinimumLiquidationCollateralEth
    );
  } else {
    logObserved("minimumLiquidationCollateralEth", actualMinimumLiquidationCollateralEth);
  }
  if (minimumLiquidationCollateralSSV !== undefined) {
    assertEqual(
      "minimumLiquidationCollateralSSV",
      minimumLiquidationCollateralSSV,
      actualMinimumLiquidationCollateralSSV
    );
  } else {
    logObserved("minimumLiquidationCollateralSSV", actualMinimumLiquidationCollateralSSV);
  }
  if (maxOperatorEthFee !== undefined) {
    assertEqual("maxOperatorEthFee", maxOperatorEthFee, actualMaxOperatorEthFee);
  } else {
    logObserved("maxOperatorEthFee", actualMaxOperatorEthFee);
  }
  if (minOperatorEthFee !== undefined) {
    assertEqual("minOperatorEthFee", minOperatorEthFee, actualMinOperatorEthFee);
  } else {
    logObserved("minOperatorEthFee", actualMinOperatorEthFee);
  }

  for (const oracleId of defaultOracleIds) {
    const actualOracleAddress = await views.getOracle(oracleId);
    const expectedOracleAddress = oracles.find((oracle) => oracle.id === oracleId)?.address;
    if (expectedOracleAddress) {
      assertEqual(
        `oracle[${oracleId}]`,
        expectedOracleAddress.toLowerCase(),
        actualOracleAddress.toLowerCase()
      );
    } else {
      logObserved(`oracle[${oracleId}]`, actualOracleAddress);
    }
  }

  const forkBlockNumber = await ethers.provider.getBlockNumber();

  const updatedConfig: UpgradeForkConfig = {
    ...config,
    owner: ownerAddr,
    ssvNetworkProxy,
    ssvNetworkViews,
    ssvToken,
    cssvToken: cssvAddr,
    forkBlockNumber,
    cooldownDuration: bigintToJsonNumberOrString(cooldownDuration),
    modules,
    deployments: {
      ...(config.deployments ?? {}),
      // ssvNetworkImplementation: networkImplAddr,
      ssvNetworkStakingUpgradeImplementation: stakingUpgradeImplAddr,
      ssvNetworkViewsImplementation: viewsImplAddr,
      cssvToken: cssvAddr,
      modules,
      targetNetwork,
      forkBlockNumber,
      chainId: providerNetwork.chainId.toString(),
      updatedAt: new Date().toISOString(),
    },
    networkFeeEth: actualNetworkFeeEth.toString(),
    networkFeeSSV: actualNetworkFeeSSV.toString(),
    maxOperatorEthFee: actualMaxOperatorEthFee.toString(),
    minOperatorEthFee: actualMinOperatorEthFee.toString(),
    operatorFeeIncreaseLimit: actualOperatorFeeIncreaseLimit.toString(),
    declareOperatorFeePeriod: actualOperatorFeePeriods.declarePeriod.toString(),
    executeOperatorFeePeriod: actualOperatorFeePeriods.executePeriod.toString(),
    liquidationThresholdPeriod: actualLiquidationThresholdPeriod.toString(),
    minimumLiquidationCollateralEth: actualMinimumLiquidationCollateralEth.toString(),
    minimumLiquidationCollateralSSV: actualMinimumLiquidationCollateralSSV.toString(),
    validatorsPerOperatorLimit: actualValidatorsPerOperatorLimit.toString(),
    unstakeCooldownDuration: actualCooldownDuration.toString(),
    quorumBps: Number(actualQuorumBps),
    defaultOracleIds: Array.from(actualDefaultOracleIds).map((id) => Number(id)),
  };
  if (oracles.length > 0) {
    updatedConfig.oracles = toOracleConfig(oracles);
  }

  await writeFile(deployedConfigPath, `${JSON.stringify(updatedConfig, null, 2)}\n`, "utf8");

  console.log("Upgrade complete");
  console.log(`Init config: ${initConfigPath}`);
  console.log(`Deployed config written at: ${deployedConfigPath}`);
  console.log(`Fork block pinned at: ${updatedConfig.forkBlockNumber}`);
  // console.log(
  //   `NetworkImpl=${networkImplAddr} ViewsImpl=${viewsImplAddr} CSSV=${cssvAddr}`
  // );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
