const fs = require('fs');
const hre = require('hardhat');
const ghpages = require('gh-pages');

export async function publishAbi(name: string) {
  const fullNames = await hre.artifacts.getAllFullyQualifiedNames();
  const contract = fullNames.find((item: string) => item.includes(`/${name}.sol`));
  const { abi, contractName } = await hre.artifacts.readArtifact(contract);
  const dir = `${hre.config.paths.root}/dist`;
  await fs.promises.mkdir(`${dir}/abi`, { recursive: true });
  await fs.promises.writeFile(`${dir}/abi/${contractName.toLowerCase()}.json`, `${JSON.stringify(abi, null, 2)}\n`, { flag: 'w' });
  await ghpages.publish(dir);
}