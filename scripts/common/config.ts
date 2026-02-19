import { readFile, symlink, unlink } from "node:fs/promises";
import { resolve, join, basename, dirname } from "node:path";
import { isAddress } from "ethers";
import { SSVModules } from "./modules.ts";

// ── Types ──

export type ModuleName = keyof typeof SSVModules;
export type ModuleAddresses = Record<ModuleName, string>;
export type OracleEntry = { id: number; address: string };
export type OraclesConfig = Record<string, string> | OracleEntry[];
export type ModuleAddressesConfig = Partial<Record<ModuleName, string>>;

export type DeployResultJson = {
  ssvNetworkStakingUpgradeImplementation?: string;
  ssvNetworkViewsImplementation?: string;
  cssvToken?: string;
  modules?: ModuleAddressesConfig;
  targetNetwork?: string;
  forkBlockNumber?: number;
  deployBlockNumber?: number;
  chainId?: string;
  deployer?: string;
  updatedAt?: string;
};

export type UpgradeConfig = {
  currentVersion: string;
  targetVersion: string;
  skipInitializer?: boolean;
  owner?: string;
  viewsOwner?: string;
  ssvNetworkProxy: string;
  ssvNetworkViews: string;
  ssvToken: string;
  cooldownDuration?: string | number;
  upgradeTimestamp?: string | number;
  defaultOracleIds?: number[];
  quorumBps?: number;
  oracles?: OraclesConfig;
  cssvToken?: string;
  deployBlockNumber?: number;
  modules?: ModuleAddressesConfig;
  deployments?: DeployResultJson;
  protocolParams?: ProtocolParams;
  // Legacy flat fields (supported for backward compat, prefer protocolParams)
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
};

export type ProtocolParams = {
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
};

/** Resolved protocol params — merges nested protocolParams over legacy flat fields. */
export type ResolvedProtocolParams = {
  networkFeeEth?: bigint;
  networkFeeSSV?: bigint;
  maxOperatorEthFee?: bigint;
  minOperatorEthFee?: bigint;
  operatorFeeIncreaseLimit?: bigint;
  declareOperatorFeePeriod?: bigint;
  executeOperatorFeePeriod?: bigint;
  liquidationThresholdPeriod?: bigint;
  minimumLiquidationCollateralEth?: bigint;
  minimumLiquidationCollateralSSV?: bigint;
  validatorsPerOperatorLimit?: bigint;
  unstakeCooldownDuration?: bigint;
};

// ── Constants ──

export const MODULE_ORDER: ModuleName[] = [
  "SSVOperators",
  "SSVClusters",
  "SSVDAO",
  "SSVViews",
  "SSVOperatorsWhitelist",
  "SSVStaking",
  "SSVValidators",
];

export const LOCAL_FORK_RPC_URL = "http://127.0.0.1:8545";
export const DEPLOYMENTS_DIR = resolve(process.cwd(), "deployments");

// Default cooldown: 7 days in seconds
const DEFAULT_COOLDOWN = 7n * 24n * 60n * 60n;

/**
 * Resolves the Hardhat network name from an --env flag.
 * Returns undefined if the env doesn't map to a known network.
 */
export function resolveNetworkFromEnv(env: string | undefined): string | undefined {
  if (!env) return undefined;
  if (env === "mainnet") return "mainnet";
  if (env === "local") return "local";
  if (env.startsWith("hoodi")) return "hoodi";
  return undefined;
}

// ── Parsing helpers ──

export function parseUint(value: unknown, label: string): bigint | undefined {
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

export function parseQuorum(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number") {
    throw new Error("Invalid quorumBps (must be a number)");
  }
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error("Invalid quorumBps (must be 0..10000)");
  }
  return value;
}

export function requireAddress(value: string, label: string): string {
  if (!isAddress(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

export function bigintToJsonNumberOrString(value: bigint): number | string {
  if (value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return value.toString();
}

// ── CLI arg helpers ──

export function parseOptionalArg(argName: string): string | undefined {
  const index = process.argv.indexOf(`--${argName}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`Missing value for --${argName}`);
  return value;
}

export function parseOptionalBooleanArg(argName: string, fallback: boolean): boolean {
  const index = process.argv.indexOf(`--${argName}`);
  if (index === -1) return fallback;
  const next = process.argv[index + 1];
  if (!next || next.startsWith("--")) return true;
  if (next === "true") return true;
  if (next === "false") return false;
  throw new Error(`Invalid --${argName} value: ${next}. Use true|false`);
}

// ── Oracle helpers ──

export function normalizeOracles(oracles: OraclesConfig | undefined): OracleEntry[] {
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

export function normalizeOracleIds(ids: number[]): [number, number, number, number] {
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

export function resolveDefaultOracleIds(
  config: UpgradeConfig,
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

export function toOracleConfig(oracles: OracleEntry[]): Record<string, string> {
  return Object.fromEntries(oracles.map(({ id, address }) => [String(id), address]));
}

// ── Config loading ──

/**
 * Resolves the config directory path from --env flag.
 * --env mainnet  -> deployments/mainnet/
 * --env hoodi-stage -> deployments/hoodi-stage/
 */
export function resolveEnvDir(env: string): string {
  return join(DEPLOYMENTS_DIR, env);
}

export function resolveConfigPath(env: string): string {
  return join(resolveEnvDir(env), "config.json");
}

export function resolveDeployResultPath(env: string): string {
  return join(resolveEnvDir(env), "deploy-result.json");
}

export function resolveUpgradeResultPath(env: string): string {
  return join(resolveEnvDir(env), "upgrade-result.json");
}

export function resolveVersionedDeployResultPath(env: string, version: string): string {
  return join(resolveEnvDir(env), `deploy-result.${version}.json`);
}

export function resolveVersionedUpgradeResultPath(env: string, version: string): string {
  return join(resolveEnvDir(env), `upgrade-result.${version}.json`);
}

/**
 * Writes `versionedPath` as the target and updates the fixed-name symlink to point to it.
 * The symlink uses a relative target so it stays valid if the directory is moved.
 * Falls back to overwriting the fixed file directly if symlinks are unavailable.
 */
export async function updateLatestSymlink(versionedPath: string, fixedPath: string): Promise<void> {
  const relTarget = basename(versionedPath);
  try {
    await unlink(fixedPath);
  } catch {
    // ignore ENOENT — symlink/file didn't exist yet
  }
  try {
    await symlink(relTarget, fixedPath);
  } catch {
    // symlinks unavailable (e.g. some CI environments) — leave the fixed file as-is
    // The versioned file is the canonical record; the fixed name is convenience only
  }
}

/**
 * Loads and parses config.json from the given env directory.
 */
export async function loadConfig(env: string): Promise<UpgradeConfig> {
  const configPath = resolveConfigPath(env);
  const raw = await readFile(configPath, "utf8");
  return JSON.parse(raw) as UpgradeConfig;
}

/**
 * Tries to load deploy-result.json. Returns undefined if not found.
 */
export async function loadDeployResult(env: string): Promise<DeployResultJson | undefined> {
  try {
    const resultPath = resolveDeployResultPath(env);
    const raw = await readFile(resultPath, "utf8");
    return JSON.parse(raw) as DeployResultJson;
  } catch {
    return undefined;
  }
}

/**
 * Resolves protocol parameters, merging nested protocolParams over legacy flat fields.
 * protocolParams takes precedence over flat fields when both exist.
 */
export function resolveProtocolParams(config: UpgradeConfig): ResolvedProtocolParams {
  const pp = config.protocolParams ?? {};
  return {
    networkFeeEth: parseUint(pp.networkFeeEth ?? config.networkFeeEth, "networkFeeEth"),
    networkFeeSSV: parseUint(pp.networkFeeSSV ?? config.networkFeeSSV, "networkFeeSSV"),
    maxOperatorEthFee: parseUint(pp.maxOperatorEthFee ?? config.maxOperatorEthFee, "maxOperatorEthFee"),
    minOperatorEthFee: parseUint(pp.minOperatorEthFee ?? config.minOperatorEthFee, "minOperatorEthFee"),
    operatorFeeIncreaseLimit: parseUint(
      pp.operatorFeeIncreaseLimit ?? config.operatorFeeIncreaseLimit,
      "operatorFeeIncreaseLimit"
    ),
    declareOperatorFeePeriod: parseUint(
      pp.declareOperatorFeePeriod ?? config.declareOperatorFeePeriod,
      "declareOperatorFeePeriod"
    ),
    executeOperatorFeePeriod: parseUint(
      pp.executeOperatorFeePeriod ?? config.executeOperatorFeePeriod,
      "executeOperatorFeePeriod"
    ),
    liquidationThresholdPeriod: parseUint(
      pp.liquidationThresholdPeriod ?? config.liquidationThresholdPeriod,
      "liquidationThresholdPeriod"
    ),
    minimumLiquidationCollateralEth: parseUint(
      pp.minimumLiquidationCollateralEth ?? config.minimumLiquidationCollateralEth,
      "minimumLiquidationCollateralEth"
    ),
    minimumLiquidationCollateralSSV: parseUint(
      pp.minimumLiquidationCollateralSSV ?? config.minimumLiquidationCollateralSSV,
      "minimumLiquidationCollateralSSV"
    ),
    validatorsPerOperatorLimit: parseUint(
      pp.validatorsPerOperatorLimit ?? config.validatorsPerOperatorLimit,
      "validatorsPerOperatorLimit"
    ),
    unstakeCooldownDuration: parseUint(
      pp.unstakeCooldownDuration ?? config.unstakeCooldownDuration,
      "unstakeCooldownDuration"
    ),
  };
}

/**
 * Resolves the cooldown duration from config, falling back to the default 7 days.
 */
export function resolveCooldownDuration(config: UpgradeConfig): bigint {
  return parseUint(config.cooldownDuration, "cooldownDuration") ?? DEFAULT_COOLDOWN;
}

/**
 * Resolves the upgrade timestamp from config, defaulting to 0.
 */
export function resolveUpgradeTimestamp(config: UpgradeConfig): bigint {
  return parseUint(config.upgradeTimestamp, "upgradeTimestamp") ?? 0n;
}

// ── Legacy config path resolution (for backward compat with --config flag) ──

export function resolveDeployedConfigPath(initConfigPath: string, outputArg?: string): string {
  if (outputArg) {
    return resolve(outputArg);
  }
  if (initConfigPath.endsWith("-upgrade.config.json")) {
    return initConfigPath.replace(/-upgrade\.config\.json$/, "-upgrade.result.json");
  }
  if (initConfigPath.endsWith("-deploy.config.json")) {
    return initConfigPath.replace(/-deploy\.config\.json$/, "-deploy.result.json");
  }
  if (initConfigPath.endsWith(".result.json")) {
    return initConfigPath;
  }
  if (initConfigPath.endsWith("-deployed.config.json")) {
    return initConfigPath;
  }
  if (initConfigPath.endsWith(".config.json")) {
    return initConfigPath.replace(/\.config\.json$/, ".result.json");
  }
  if (initConfigPath.endsWith(".json")) {
    return initConfigPath.replace(/\.json$/, ".result.json");
  }
  return `${initConfigPath}.result.json`;
}
