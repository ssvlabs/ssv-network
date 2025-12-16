import hre from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

async function main() {
  const artifactsPath = hre.config.paths.artifacts;
  const buildInfoDir = path.join(artifactsPath, "build-info");
  const abisDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "abis");

  if (fs.existsSync(abisDir)) {
    fs.rmSync(abisDir, { recursive: true });
  }
  fs.mkdirSync(abisDir);

  for (const file of fs.readdirSync(buildInfoDir)) {
    const fullPath = path.join(buildInfoDir, file);
    const buildInfo = JSON.parse(fs.readFileSync(fullPath, "utf8"));

    if (
      !buildInfo ||
      !buildInfo.output ||
      !buildInfo.output.contracts ||
      typeof buildInfo.output.contracts !== "object"
    ) {
      continue;
    }

    const contracts = buildInfo.output.contracts;

    for (const fileName of Object.keys(contracts)) {
      for (const contractName of Object.keys(contracts[fileName])) {
        const c = contracts[fileName][contractName];

        const abi = c?.abi;
        if (!abi || abi.length === 0) continue;

        const abiPath = path.join(abisDir, `${contractName}.json`);
        fs.writeFileSync(abiPath, JSON.stringify(abi, null, 2));
      }
    }
  }

  console.log("ABIs saved to Abis folder.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});