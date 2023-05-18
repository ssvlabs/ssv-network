async function validateUpgradeSSVNetwork() {
  const proxyAddress = process.env.SSVNETWORK_PROXY_ADDRESS;
  const SSVNetwork = await ethers.getContractFactory("SSVNetwork");

  await upgrades.validateUpgrade(proxyAddress, SSVNetwork,
    {
      kind: 'uups',
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