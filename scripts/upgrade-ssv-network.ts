async function upgradeSSVNetwork() {
  const proxyAddress = process.env.SSVNETWORK_PROXY_ADDRESS;
  const [deployer] = await ethers.getSigners();
  console.log("Upgading contract with the account:", deployer.address);

  const SSVNetwork = await ethers.getContractFactory("SSVNetwork");

  const ssvNetwork = await upgrades.upgradeProxy(proxyAddress, SSVNetwork, { kind: 'uups' });
  console.log("SSVNetwork upgraded successfully");

  const implAddress = await upgrades.erc1967.getImplementationAddress(ssvNetwork.address);
  console.log(`SSVNetwork implementation deployed to: ${implAddress}`);
}

upgradeSSVNetwork()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
