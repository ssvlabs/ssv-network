const { ethers, upgrades } = require("hardhat");

async function upgradeSSVNetworkViews() {
  const proxyAddress = process.env.SSVNETWORKVIEWS_PROXY_ADDRESS;
  const [deployer] = await ethers.getSigners();
  console.log("Upgading contract with the account:", deployer.address);

  const SSVNetworkViews = await ethers.getContractFactory("SSVNetworkViews_V2");

  const ssvNetworkViews = await upgrades.upgradeProxy(proxyAddress, SSVNetworkViews, { kind: 'uups' });
  console.log("SSVNetworkViews upgraded successfully");

  const implAddress = await upgrades.erc1967.getImplementationAddress(ssvNetworkViews.address);
  console.log(`SSVNetwork implementation deployed to: ${implAddress}`);
}

upgradeSSVNetworkViews()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });