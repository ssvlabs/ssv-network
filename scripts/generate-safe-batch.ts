import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Interface } from "ethers";
import {
  type UpgradeConfig,
  MODULE_ORDER,
  parseOptionalArg,
  parseQuorum,
  normalizeOracles,
  resolveDefaultOracleIds,
  resolveProtocolParams,
  resolveCooldownDuration,
  requireAddress,
  resolveConfigPath,
  resolveDeployResultPath,
  resolveEnvDir,
} from "./common/config.ts";
import { SSVModules } from "./common/modules.ts";

type SafeTransaction = {
  to: string;
  value: string;
  data: string;
  contractMethod?: {
    name: string;
    inputs: Array<{ name: string; type: string }>;
  };
  contractInputsValues?: Record<string, string>;
};

type SafeBatchJson = {
  version: string;
  chainId: string;
  createdAt: number;
  meta: {
    name: string;
    description: string;
    createdFromSafeAddress: string;
  };
  transactions: SafeTransaction[];
};

type DeployResultFile = {
  implementations?: {
    SSVNetworkSSVStakingUpgrade?: string;
    SSVNetworkViews?: string;
  };
  cssvToken?: {
    address?: string;
  };
  modules?: Record<string, string>;
  chainId?: string;
};

async function main() {
  const envFlag = parseOptionalArg("env") ?? "mainnet";
  const configPath = resolveConfigPath(envFlag);
  const deployResultPath = resolveDeployResultPath(envFlag);

  const configRaw = await readFile(configPath, "utf8");
  const config = JSON.parse(configRaw) as UpgradeConfig;

  let deployResult: DeployResultFile;
  try {
    const deployRaw = await readFile(deployResultPath, "utf8");
    deployResult = JSON.parse(deployRaw) as DeployResultFile;
  } catch {
    throw new Error(
      `deploy-result.json not found at ${deployResultPath}. ` +
      `Run 'just deploy ${envFlag}' first to deploy implementations and modules.`
    );
  }

  const ssvNetworkProxy = requireAddress(config.ssvNetworkProxy, "ssvNetworkProxy");
  const ssvNetworkViews = requireAddress(config.ssvNetworkViews, "ssvNetworkViews");
  const ownerAddr = config.owner ? requireAddress(config.owner, "owner") : ssvNetworkProxy;

  const stakingUpgradeImpl = deployResult.implementations?.SSVNetworkSSVStakingUpgrade;
  const viewsImpl = deployResult.implementations?.SSVNetworkViews;
  const modules = deployResult.modules ?? {};

  if (!stakingUpgradeImpl) throw new Error("Missing SSVNetworkSSVStakingUpgrade in deploy-result.json");
  if (!viewsImpl) throw new Error("Missing SSVNetworkViews in deploy-result.json");

  const params = resolveProtocolParams(config);
  const cooldownDuration = resolveCooldownDuration(config);
  const quorumBps = parseQuorum(config.quorumBps);
  const oracles = normalizeOracles(config.oracles);
  const defaultOracleIds = resolveDefaultOracleIds(config, oracles);

  const chainId = deployResult.chainId ?? "1";
  const transactions: SafeTransaction[] = [];

  // ── 1. Upgrade SSVNetwork proxy ──
  const ssvNetworkIface = new Interface([
    "function upgradeTo(address newImplementation)",
    "function upgradeToAndCall(address newImplementation, bytes data)",
    "function updateModule(uint8 moduleId, address moduleAddress)",
    "function updateNetworkFee(uint256 fee)",
    "function updateNetworkFeeSSV(uint256 fee)",
    "function updateLiquidationThresholdPeriod(uint64 blocks)",
    "function setMinBlocksBetweenUpdates(uint32 blocks)",
    "function updateMinimumLiquidationCollateral(uint256 amount)",
    "function updateMinimumLiquidationCollateralSSV(uint256 amount)",
    "function updateDeclareOperatorFeePeriod(uint64 blocks)",
    "function updateExecuteOperatorFeePeriod(uint64 blocks)",
    "function updateOperatorFeeIncreaseLimit(uint64 percentage)",
    "function updateMaximumOperatorFee(uint64 maxFee)",
    "function updateMinimumOperatorEthFee(uint256 minFee)",
    "function setQuorumBps(uint16 quorumBps)",
    "function setUnstakeCooldownDuration(uint64 blocks)",
    "function replaceOracle(uint32 oracleId, address oracleAddress)",
  ]);

  const viewsIface = new Interface([
    "function upgradeTo(address newImplementation)",
  ]);

  if (config.skipInitializer) {
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("upgradeTo", [stakingUpgradeImpl]),
    });
  } else {
    if (params.minBlocksBetweenUpdates === undefined) {
      throw new Error("protocolParams.minBlocksBetweenUpdates is required for initializeSSVStaking");
    }
    const stakingUpgradeIface = new Interface([
      "function initializeSSVStaking(uint64 cooldownDuration, uint32[4] defaultOracleIds, uint16 quorumBps, uint32 minBlocksBetweenUpdates)",
    ]);
    const initData = stakingUpgradeIface.encodeFunctionData("initializeSSVStaking", [
      cooldownDuration,
      defaultOracleIds,
      quorumBps,
      params.minBlocksBetweenUpdates,
    ]);
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("upgradeToAndCall", [stakingUpgradeImpl, initData]),
    });
  }

  // ── 2. updateModule for each module ──
  for (const mod of MODULE_ORDER) {
    const moduleAddr = modules[mod];
    if (!moduleAddr) {
      console.warn(`Warning: no address for module ${mod} in deploy-result.json, skipping`);
      continue;
    }
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("updateModule", [SSVModules[mod], moduleAddr]),
    });
  }

  // ── 3. Upgrade SSVNetworkViews ──
  transactions.push({
    to: ssvNetworkViews,
    value: "0",
    data: viewsIface.encodeFunctionData("upgradeTo", [viewsImpl]),
  });

  // ── 4. Protocol parameter setters ──
  if (params.networkFeeEth !== undefined) {
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("updateNetworkFee", [params.networkFeeEth]),
    });
  }
  if (params.networkFeeSSV !== undefined) {
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("updateNetworkFeeSSV", [params.networkFeeSSV]),
    });
  }
  if (params.liquidationThresholdPeriod !== undefined) {
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("updateLiquidationThresholdPeriod", [params.liquidationThresholdPeriod]),
    });
  }
  if (config.skipInitializer && params.minBlocksBetweenUpdates !== undefined) {
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("setMinBlocksBetweenUpdates", [params.minBlocksBetweenUpdates]),
    });
  }
  if (params.minimumLiquidationCollateralEth !== undefined) {
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("updateMinimumLiquidationCollateral", [
        params.minimumLiquidationCollateralEth,
      ]),
    });
  }
  if (params.minimumLiquidationCollateralSSV !== undefined) {
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("updateMinimumLiquidationCollateralSSV", [
        params.minimumLiquidationCollateralSSV,
      ]),
    });
  }
  if (params.declareOperatorFeePeriod !== undefined) {
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("updateDeclareOperatorFeePeriod", [params.declareOperatorFeePeriod]),
    });
  }
  if (params.executeOperatorFeePeriod !== undefined) {
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("updateExecuteOperatorFeePeriod", [params.executeOperatorFeePeriod]),
    });
  }
  if (params.operatorFeeIncreaseLimit !== undefined) {
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("updateOperatorFeeIncreaseLimit", [params.operatorFeeIncreaseLimit]),
    });
  }
  if (params.maxOperatorEthFee !== undefined) {
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("updateMaximumOperatorFee", [params.maxOperatorEthFee]),
    });
  }
  if (params.minOperatorEthFee !== undefined) {
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("updateMinimumOperatorEthFee", [params.minOperatorEthFee]),
    });
  }
  if (quorumBps !== undefined) {
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("setQuorumBps", [quorumBps]),
    });
  }
  if (params.unstakeCooldownDuration !== undefined) {
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("setUnstakeCooldownDuration", [params.unstakeCooldownDuration]),
    });
  }

  // ── 5. Oracle replacements ──
  for (const { id, address } of oracles) {
    transactions.push({
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("replaceOracle", [id, address]),
    });
  }

  // ── Build SAFE Transaction Builder JSON ──
  const batch: SafeBatchJson = {
    version: "1.0",
    chainId,
    createdAt: Date.now(),
    meta: {
      name: `SSV Network ${config.targetVersion ?? "upgrade"} Upgrade (${envFlag})`,
      description: `Upgrade SSVNetwork proxy, attach modules, set protocol parameters, and configure oracles for the ${envFlag} environment.`,
      createdFromSafeAddress: ownerAddr,
    },
    transactions,
  };

  const outputPath = join(resolveEnvDir(envFlag), "multisig-batch.json");
  await writeFile(outputPath, `${JSON.stringify(batch, null, 2)}\n`, "utf8");

  console.log(`SAFE Transaction Builder batch generated: ${outputPath}`);
  console.log(`Total transactions: ${transactions.length}`);
  console.log(`Chain ID: ${chainId}`);
  console.log(`Owner (SAFE address): ${ownerAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
