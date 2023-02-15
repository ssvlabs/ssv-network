import { ethers, upgrades } from 'hardhat';
import { getEnvVar } from './utils';

async function upgradeSSVNetworkViews() {
  const proxyAddress = getEnvVar('SSVNETWORKVIEWS_PROXY_ADDRESS');
  const [deployer] = await ethers.getSigners();
  console.log("Upgading contract with the account:", deployer.address);

  const SSVNetworkViews = await ethers.getContractFactory("SSVNetworkViews_V2");

  await upgrades.upgradeProxy(proxyAddress, SSVNetworkViews, { kind: 'uups' });
  console.log("SSVNetworkViews upgraded successfully");
}

upgradeSSVNetworkViews()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });