async function upgradeSSVNetwork() {
  const proxyAddress = process.env.SSVNETWORK_PROXY_ADDRESS;
  const [deployer] = await ethers.getSigners();
  console.log("Upgading contract with the account:", deployer.address);

  const SSVNetwork = await ethers.getContractFactory("SSVNetworkUpgrade");

  await upgrades.upgradeProxy(proxyAddress, SSVNetwork,
    {
      kind: 'uups',
      call: {
        fn: 'initializev2',
        args: [1000]
      },
      unsafeAllow: ['state-variable-immutable', 'constructor'],
      constructorArgs: [process.env.REGISTER_AUTH_PROXY_ADDRESS]
    });
  console.log("SSVNetwork upgraded successfully");
}

upgradeSSVNetwork()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });