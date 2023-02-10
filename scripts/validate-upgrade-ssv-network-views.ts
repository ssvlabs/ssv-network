import { ethers, upgrades } from 'hardhat';

async function validateUpgradeSSVNetworkViews() {
  const proxyAddress: any = process.env.SSVNETWORKVIEWS_PROXY_ADDRESS;
  const SSVNetworkViews = await ethers.getContractFactory("SSVNetworkViews_V2");

  await upgrades.validateUpgrade(proxyAddress, SSVNetworkViews, { kind: 'uups' });
  console.log("Contract validation finished");
}

validateUpgradeSSVNetworkViews()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });