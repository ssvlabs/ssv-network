import { parseArg, getEthers, attachModule } from "./common/helpers.ts";
import { saveImplementation } from "./common/address-book.js";

async function main() {
  const targetNetwork = parseArg("network");
  const ethers = await getEthers(targetNetwork);

  const moduleName = parseArg("module");
  const moduleAddress = parseArg("module-address");
  const proxyAddress = parseArg("proxy-address");

  await attachModule(ethers, proxyAddress, moduleName, moduleAddress);

  saveImplementation(targetNetwork, moduleName, moduleAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});