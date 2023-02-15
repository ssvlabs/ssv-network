import { ethers, upgrades } from 'hardhat';
import { getEnvVar } from './utils';

async function validateUpgradeSSVNetwork() {
  const proxyAddress = getEnvVar('SSVNETWORK_PROXY_ADDRESS');
  const SSVNetwork = await ethers.getContractFactory("SSVNetwork");

  await upgrades.validateUpgrade(proxyAddress, SSVNetwork, { kind: 'uups' });
  console.log("Contract validation finished");
}

validateUpgradeSSVNetwork()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });