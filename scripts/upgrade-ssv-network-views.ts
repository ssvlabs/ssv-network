const { ethers, upgrades } = require("hardhat");

async function upgradeSSVNetworkViews() {
  const ssvNetworkProxy = process.env.SSVNETWORK_PROXY_ADDRESS;
  if (!ssvNetworkProxy) throw new Error("SSVNETWORK_PROXY_ADDRESS not set.");

  const ssvViewsProxy = process.env.SSVNETWORKVIEWS_PROXY_ADDRESS;
  if (!ssvViewsProxy) throw new Error("SSVNETWORK_PROXY_ADDRESS not set.");

  const [deployer] = await ethers.getSigners();
  console.log("Upgading contract with the account:", deployer.address);

  // Initialize contract
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  const ssvViewsModFactory = await ethers.getContractFactory('SSVViews');
  const SSVNetworkViews = await ethers.getContractFactory("SSVNetworkViews");

  const ssvViewsMod = await ssvViewsModFactory.deploy();
  await ssvViewsMod.deployed();
  console.log(`SSVViewsMod module deployed to: ${ssvViewsMod.address}`);

  const ssvNetwork = await ssvNetworkFactory.attach(ssvNetworkProxy);

  await ssvNetwork.upgradeModule(3, ssvViewsMod.address);
  console.log(`SSVViews module attached to SSVNetwork succesfully`);

  await upgrades.upgradeProxy(ssvViewsProxy, SSVNetworkViews, { kind: 'uups' });
  console.log("SSVNetworkViews upgraded successfully");
}

upgradeSSVNetworkViews()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });