import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isAddress } from "ethers";
import { deployContract, getDeployer, getEthers, parseArg } from "./common/helpers.ts";
import { SSVModules } from "./common/modules.ts";

type ModuleName = keyof typeof SSVModules;
type ModuleAddresses = Record<ModuleName, string>;
type ModuleAddressesConfig = Partial<Record<ModuleName, string>>;

type DeployResult = {
  cssvToken?: string;
  modules?: ModuleAddressesConfig;
  targetNetwork?: string;
  deployBlockNumber?: number;
  chainId?: string;
  deployer?: string;
  updatedAt?: string;
};

type DeployConfig = {
  ssvNetworkProxy: string;
  upgradeTimestamp?: string | number;
  cssvToken?: string;
  modules?: ModuleAddressesConfig;
  deployments?: DeployResult;
};

function parseOptionalArg(argName: string): string | undefined {
  const index = process.argv.indexOf(`--${argName}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`Missing value for --${argName}`);
  return value;
}

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

function requireAddress(value: string, label: string): string {
  if (!isAddress(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

function resolveOutputPath(configPath: string, outputArg?: string): string {
  if (outputArg) {
    return resolve(outputArg);
  }
  if (configPath.endsWith(".config.json")) {
    return configPath.replace(/\.config\.json$/, ".result.json");
  }
  if (configPath.endsWith(".json")) {
    return configPath.replace(/\.json$/, ".result.json");
  }
  return `${configPath}.result.json`;
}

async function main() {
  const targetNetwork = parseArg("network");
  const configPath = resolve(parseArg("config"));
  const outputPath = resolveOutputPath(configPath, parseOptionalArg("output-config"));

  const raw = await readFile(configPath, "utf8");
  const config = JSON.parse(raw) as DeployConfig;
  const ssvNetworkProxy = requireAddress(config.ssvNetworkProxy, "ssvNetworkProxy");
  const upgradeTimestamp = parseUint(config.upgradeTimestamp, "upgradeTimestamp") ?? 0n;

  const ethers = await getEthers(targetNetwork);
  const deployer = await getDeployer(ethers);
  const deployerAddress = await deployer.getAddress();
  const providerNetwork = await ethers.provider.getNetwork();

  const proxyCode = await ethers.provider.getCode(ssvNetworkProxy);
  if (proxyCode === "0x") {
    throw new Error(
      `No contract code at ssvNetworkProxy ${ssvNetworkProxy} on ${targetNetwork}. ` +
      `Check your RPC URL and network selection.`
    );
  }

  console.log(`Deploying modules and CSSVToken on ${targetNetwork}`);
  console.log(`Deployer: ${deployerAddress}`);
  console.log(`SSVNetwork proxy: ${ssvNetworkProxy}`);

  const { address: cssvAddr } = await deployContract(ethers, "CSSVToken", [ssvNetworkProxy], deployer);
  const { address: ssvOperatorsAddr } = await deployContract(ethers, "SSVOperators", [upgradeTimestamp], deployer);
  const { address: ssvClustersAddr } = await deployContract(ethers, "SSVClusters", [], deployer);
  const { address: ssvDaoAddr } = await deployContract(ethers, "SSVDAO", [cssvAddr], deployer);
  const { address: ssvViewsAddr } = await deployContract(ethers, "SSVViews", [cssvAddr], deployer);
  const { address: ssvOperatorsWhitelistAddr } = await deployContract(
    ethers,
    "SSVOperatorsWhitelist",
    [],
    deployer
  );
  const { address: ssvStakingAddr } = await deployContract(ethers, "SSVStaking", [cssvAddr], deployer);
  const { address: ssvValidatorsAddr } = await deployContract(ethers, "SSVValidators", [], deployer);

  const modules: ModuleAddresses = {
    SSVOperators: ssvOperatorsAddr,
    SSVClusters: ssvClustersAddr,
    SSVDAO: ssvDaoAddr,
    SSVViews: ssvViewsAddr,
    SSVOperatorsWhitelist: ssvOperatorsWhitelistAddr,
    SSVStaking: ssvStakingAddr,
    SSVValidators: ssvValidatorsAddr,
  };

  const deployBlockNumber = await ethers.provider.getBlockNumber();

  const result: DeployConfig = {
    ...config,
    ssvNetworkProxy,
    cssvToken: cssvAddr,
    modules,
    deployments: {
      ...(config.deployments ?? {}),
      cssvToken: cssvAddr,
      modules,
      targetNetwork,
      deployBlockNumber,
      chainId: providerNetwork.chainId.toString(),
      deployer: deployerAddress,
      updatedAt: new Date().toISOString(),
    },
  };

  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log("Deployment complete");
  console.log(`Config: ${configPath}`);
  console.log(`Result: ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
