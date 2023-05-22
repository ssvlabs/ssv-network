async function validateUpgradeSSVNetwork() {
  const proxyAddress = process.env.SSVNETWORK_PROXY_ADDRESS;
  const SSVNetwork = await ethers.getContractFactory("SSVNetworkUpgrade");

  await upgrades.validateUpgrade(proxyAddress, SSVNetwork,
    {
      kind: 'uups',
      call: {
        fn: 'initializeV2',
        args: [1000]
      },
      unsafeAllow: ['state-variable-immutable', 'constructor'],
      constructorArgs: [process.env.REGISTER_AUTH_PROXY_ADDRESS]
    });
  console.log("Contract validation finished");
}

validateUpgradeSSVNetwork()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });