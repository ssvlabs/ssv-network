import fs from "node:fs";
import path from "node:path";
import type { ForkConfigFile } from "../../../scripts/common/fork-test.ts";

const DEFAULT_FORK_CONFIG = {
  SSV_NETWORK_ADDRESS: "0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1",
  SSV_NETWORK_VIEWS: "0xafE830B6Ee262ba11cce5F32fDCd760FFE6a66e4",
  SSV_TOKEN: "0x9D65fF81a3c488d585bBfb0Bfe3c7707c7917f54",
  DAO_ADDRESS: "0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6",
} as const;

function loadForkConfigFile(): ForkConfigFile {
  const configPathFromEnv = process.env.FORK_CONFIG_PATH;
  if (!configPathFromEnv) {
    return {};
  }
  const resolvedPath = path.resolve(configPathFromEnv);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`FORK_CONFIG_PATH does not exist: ${resolvedPath}`);
  }
  const raw = fs.readFileSync(resolvedPath, "utf8");
  return JSON.parse(raw) as ForkConfigFile;
}

const fileConfig = loadForkConfigFile();

export const ForkConfig = {
  SSV_NETWORK_ADDRESS: process.env.FORK_SSV_NETWORK_ADDRESS ??
    fileConfig.ssvNetworkProxy ??
    fileConfig.ssvNetworkAddress ??
    DEFAULT_FORK_CONFIG.SSV_NETWORK_ADDRESS,
  SSV_NETWORK_VIEWS: process.env.FORK_SSV_NETWORK_VIEWS ??
    fileConfig.ssvNetworkViews ??
    DEFAULT_FORK_CONFIG.SSV_NETWORK_VIEWS,
  SSV_TOKEN: process.env.FORK_SSV_TOKEN ??
    fileConfig.ssvToken ??
    DEFAULT_FORK_CONFIG.SSV_TOKEN,
  CSSV_TOKEN: process.env.FORK_CSSV_TOKEN ??
    fileConfig.cssvToken,
  DAO_ADDRESS: process.env.FORK_DAO_ADDRESS ??
    fileConfig.daoAddress ??
    fileConfig.owner ??
    DEFAULT_FORK_CONFIG.DAO_ADDRESS,
  MODULES: fileConfig.modules ?? {},
} as const;
