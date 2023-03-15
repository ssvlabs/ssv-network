async function validateUpgradeSSVNetworkViews() {
  const proxyAddress = process.env.SSVNETWORKVIEWS_PROXY_ADDRESS;
  const SSVNetworkViews = await ethers.getContractFactory("SSVNetworkViews");

  await upgrades.validateUpgrade(proxyAddress, SSVNetworkViews, { kind: 'uups' });
  console.log("Contract validation finished");
}

validateUpgradeSSVNetworkViews()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });