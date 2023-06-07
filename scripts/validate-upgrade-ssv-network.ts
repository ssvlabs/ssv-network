async function validateUpgradeSSVNetwork() {
  const proxyAddress = process.env.SSVNETWORK_PROXY_ADDRESS;
  const SSVNetwork = await ethers.getContractFactory("SSVNetwork");
  console.log("Contract validation finishedSS");
  await upgrades.validateUpgrade(proxyAddress, SSVNetwork,
    {
      kind: 'uups',
      unsafeAllow: ['state-variable-immutable', 'constructor'],
      constructorArgs: []
    });
  console.log("Contract validation finished");
}

validateUpgradeSSVNetwork()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
