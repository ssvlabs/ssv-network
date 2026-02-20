import { parseArg, getEthers, attachModule } from "./common/helpers.ts";

async function main() {
  const targetNetwork = parseArg("network");
  const ethers = await getEthers(targetNetwork);

  const moduleName = parseArg("module");
  const moduleAddress = parseArg("module-address");
  const proxyAddress = parseArg("proxy-address");

  await attachModule(ethers, proxyAddress, moduleName, moduleAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
