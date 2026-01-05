import hre from "hardhat";
import { parseArg, getEthers, getDeployer, deployContract, attachModule, upgradeProxy } from "./common/helpers.ts";
import { saveImplementation } from "./common/address-book.js";

async function main() {
  const targetNetwork = parseArg("network");
  const ethers = await getEthers(targetNetwork);
  const deployer = await getDeployer(ethers);

  const networkProxyAddr = process.env.NETWORK_PROXY;
  if (!networkProxyAddr) {
    throw new Error("Missing NETWORK_PROXY env variable");
  }

  console.log(`Upgrading existing network on ${targetNetwork} at ${networkProxyAddr}`);

  const { address: ssvStakingAddr } = await deployContract(ethers, "SSVStaking");
  saveImplementation(targetNetwork, "SSVStaking", ssvStakingAddr);

  await attachModule(ethers, networkProxyAddr, "SSVStaking", ssvStakingAddr);

  const { address: cssvTokenAddr } = await deployContract(ethers, "CSSVToken", [networkProxyAddr]);
  saveImplementation(targetNetwork, "CSSVToken", cssvTokenAddr);

  const { address: upgradeImplAddr } = await deployContract(ethers, "SSVNetworkSSVStakingUpgrade");
  saveImplementation(targetNetwork, "SSVNetworkSSVStakingUpgrade", upgradeImplAddr);

  const cooldown = 7n * 24n * 60n * 60n;

  await upgradeProxy(
    ethers,
    deployer,
    networkProxyAddr,
    upgradeImplAddr,
    "SSVNetworkSSVStakingUpgrade",
    "initializeSSVStaking(address,uint64)",
    [cssvTokenAddr, cooldown]
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});