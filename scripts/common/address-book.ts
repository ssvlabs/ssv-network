/**
 * @deprecated Use the directory-based config structure in deployments/<env>/
 * with config.json and deploy-result.json instead. This module is kept for
 * backward compatibility with deploy-module.ts and attach-module.ts.
 */
import fs from "fs";
import path from "path";

const deploymentsDir = path.join(process.cwd(), "deployments");

export function load(network: string): any {
  const file = path.join(deploymentsDir, `${network}.json`);
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function saveImplementation(
  network: string,
  contractName: string,
  address: string
) {
  const file = path.join(deploymentsDir, `${network}.json`);
  const data = load(network);

  if (!data[contractName]) {
    data[contractName] = {
      latest: address,
      implementations: [address],
    };
  } else {
    data[contractName].latest = address;

    if (!Array.isArray(data[contractName].implementations)) {
      data[contractName].implementations = [];
    }

    if (!data[contractName].implementations.includes(address)) {
      data[contractName].implementations.push(address);
    }
  }

  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));

  console.log(`Saved address: ${network}.${contractName}.latest = ${address}`);
}

export function getLatest(network: string, name: string): string | undefined {
  return load(network)?.[name]?.latest;
}