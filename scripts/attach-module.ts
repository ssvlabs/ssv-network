import { readFile, realpath, writeFile } from "node:fs/promises";
import { attachModule, getEthers, parseArg } from "./common/helpers.ts";
import {
  type ModuleAddressesConfig,
  type ModuleName,
  type UpgradeConfig,
  parseOptionalArg,
  requireAddress,
  resolveConfigPath,
  resolveDeployResultPath,
  resolveNetworkFromEnv,
} from "./common/config.ts";

type AttachModuleDeployResult = {
  modules?: ModuleAddressesConfig;
  updatedAt?: string;
  [key: string]: unknown;
};

async function updateLatestDeployResult(
  env: string,
  moduleName: ModuleName,
  moduleAddress: string
): Promise<string> {
  const latestResultPath = resolveDeployResultPath(env);
  const versionedResultPath = await realpath(latestResultPath).catch(() => latestResultPath);
  const raw = await readFile(versionedResultPath, "utf8");
  const deployResult = JSON.parse(raw) as AttachModuleDeployResult;

  deployResult.modules = {
    ...(deployResult.modules ?? {}),
    [moduleName]: moduleAddress,
  };
  deployResult.updatedAt = new Date().toISOString();

  await writeFile(versionedResultPath, `${JSON.stringify(deployResult, null, 2)}\n`, "utf8");
  return versionedResultPath;
}

async function main() {
  const envFlag = parseArg("env");
  const moduleName = parseArg("module") as ModuleName;
  const moduleAddress = requireAddress(parseArg("module-address"), "module-address");
  const configPath = resolveConfigPath(envFlag);
  const rawConfig = await readFile(configPath, "utf8");
  const config = JSON.parse(rawConfig) as UpgradeConfig;

  const targetNetwork = parseOptionalArg("network") ?? resolveNetworkFromEnv(envFlag) ?? "local";
  const proxyAddress = requireAddress(config.ssvNetworkProxy, "ssvNetworkProxy");

  console.log(`Environment: ${envFlag}`);
  console.log(`Resolved SSVNetwork proxy from config: ${proxyAddress}`);

  const ethers = await getEthers(targetNetwork);
  const proxyCode = await ethers.provider.getCode(proxyAddress);
  if (proxyCode === "0x") {
    throw new Error(`No contract code at proxy ${proxyAddress} on ${targetNetwork}`);
  }

  const moduleCode = await ethers.provider.getCode(moduleAddress);
  if (moduleCode === "0x") {
    throw new Error(`No contract code at module ${moduleAddress} on ${targetNetwork}`);
  }

  await attachModule(ethers, proxyAddress, moduleName, moduleAddress);

  const updatedResultPath = await updateLatestDeployResult(envFlag, moduleName, moduleAddress);
  console.log(`Updated deploy result: ${updatedResultPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
