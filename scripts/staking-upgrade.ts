import hre from "hardhat";
import { parseArg, getEthers, getDeployer, deployContract, attachModule, upgradeProxy } from "./common/helpers.ts";
import { saveImplementation } from "./common/address-book.js";
import { DEFAULT_UNSTAKE_COOLDOWN } from "../test/common/constants.ts";

async function main() {
  const targetNetwork = parseArg("network");
  const ethers = await getEthers(targetNetwork);
  const deployer = await getDeployer(ethers);

  const networkProxyAddr = parseArg("proxy-address");
  if (!networkProxyAddr) {
    throw new Error("Missing --proxy-address argument");
  }

  console.log(`Upgrading existing network on ${targetNetwork} at ${networkProxyAddr}`);

  const { address: upgradeImplAddr } = await deployContract(ethers, "SSVNetworkSSVStakingUpgrade");
  saveImplementation(targetNetwork, "SSVNetworkSSVStakingUpgrade", upgradeImplAddr);

  const cooldown = DEFAULT_UNSTAKE_COOLDOWN;
  const defaultOracles = [1,2,3,4];

  await upgradeProxy(
    ethers,
    deployer,
    networkProxyAddr,
    upgradeImplAddr,
    "SSVNetworkSSVStakingUpgrade",
    "initializeSSVStaking(uint64,uint32[4])",
    [cooldown, defaultOracles]
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
