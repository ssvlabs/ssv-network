import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Interface, isAddress, keccak256 } from "ethers";
import {
  type UpgradeConfig,
  parseOptionalArg,
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
  contractMethod: {
    name: string;
    inputs: Array<{ name: string; type: string }>;
  };
  contractInputsValues: Record<string, string>;
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

function parseRequiredAddress(argName: string): string {
  const value = parseOptionalArg(argName);
  if (!value) throw new Error(`Missing --${argName}`);
  if (!isAddress(value)) throw new Error(`Invalid --${argName}: ${value}`);
  return value;
}

async function resolveChainId(envFlag: string): Promise<string> {
  const explicit = parseOptionalArg("chain-id");
  if (explicit) return explicit;

  try {
    const deployResult = JSON.parse(await readFile(resolveDeployResultPath(envFlag), "utf8")) as { chainId?: string };
    if (deployResult.chainId) return deployResult.chainId;
  } catch {
    // Fall back to known env mappings when no deploy-result exists.
  }

  if (envFlag === "mainnet") return "1";
  if (envFlag.startsWith("hoodi")) return "560048";
  if (envFlag === "local") return "31337";
  throw new Error(`Could not resolve chain ID for env '${envFlag}'. Pass --chain-id explicitly.`);
}

async function main() {
  const envFlag = parseOptionalArg("env") ?? "mainnet";
  const chainId = await resolveChainId(envFlag);
  const name = parseOptionalArg("name") ?? `SSV Network Module Hotfix (${envFlag})`;

  const clusters = parseRequiredAddress("clusters");
  const validators = parseRequiredAddress("validators");

  const config = JSON.parse(await readFile(resolveConfigPath(envFlag), "utf8")) as UpgradeConfig;
  const ssvNetworkProxy = requireAddress(config.ssvNetworkProxy, "ssvNetworkProxy");
  if (!config.owner) {
    throw new Error(`Missing owner in deployments/${envFlag}/config.json; required for SAFE batch metadata.`);
  }
  const ownerAddr = requireAddress(config.owner, "owner");

  const ssvNetworkIface = new Interface([
    "function updateModule(uint8 moduleId, address moduleAddress)",
  ]);

  const inputs = [
    { name: "moduleId", type: "uint8" },
    { name: "moduleAddress", type: "address" },
  ];
  const transactions: SafeTransaction[] = [
    {
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("updateModule", [SSVModules.SSVClusters, clusters]),
      contractMethod: { name: "updateModule", inputs },
      contractInputsValues: {
        moduleId: String(SSVModules.SSVClusters),
        moduleAddress: clusters,
      },
    },
    {
      to: ssvNetworkProxy,
      value: "0",
      data: ssvNetworkIface.encodeFunctionData("updateModule", [SSVModules.SSVValidators, validators]),
      contractMethod: { name: "updateModule", inputs },
      contractInputsValues: {
        moduleId: String(SSVModules.SSVValidators),
        moduleAddress: validators,
      },
    },
  ];

  const batch: SafeBatchJson = {
    version: "1.0",
    chainId,
    createdAt: Date.now(),
    meta: {
      name,
      description:
        "Hotfix batch for SSVNetwork.updateModule on SSVClusters and SSVValidators only. No proxy upgrade or parameter changes.",
      createdFromSafeAddress: ownerAddr,
    },
    transactions,
  };

  const outputPath = join(resolveEnvDir(envFlag), "hotfix-multisig-batch.json");
  const content = `${JSON.stringify(batch, null, 2)}\n`;
  await writeFile(outputPath, content, "utf8");

  console.log(`Hotfix SAFE Transaction Builder batch generated: ${outputPath}`);
  console.log(`Total transactions: ${transactions.length}`);
  console.log(`Chain ID: ${chainId}`);
  console.log(`Owner (SAFE address): ${ownerAddr}`);
  console.log(`SSVNetwork proxy: ${ssvNetworkProxy}`);
  console.log(`SSVClusters module: ${clusters}`);
  console.log(`SSVValidators module: ${validators}`);
  console.log(`hotfix-multisig-batch.json keccak256: ${keccak256(new TextEncoder().encode(content))}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
