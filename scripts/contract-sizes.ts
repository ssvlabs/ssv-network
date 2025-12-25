import hre from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const artifactsPath = hre.config.paths.artifacts;
  const buildInfoDir = path.join(artifactsPath, "build-info");

  const results: { name: string; size: number }[] = [];

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

        const bytecode = c?.evm?.deployedBytecode?.object;
        if (!bytecode || bytecode.length === 0) continue;

        const size = bytecode.length / 2;

        results.push({
          name: contractName,
          size,
        });
      }
    }
  }

  results.sort((a, b) => b.size - a.size);

  for (const { name, size } of results) {
    const kb = (size / 1024).toFixed(2);
    const warn = size > 24576 ? "exceeds 24KB limit!" : "";
    console.log(`${name.padEnd(32)} ${kb} KB (${size} bytes)${warn}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});