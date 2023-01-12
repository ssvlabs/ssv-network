const { ethers, upgrades } = require("hardhat");

async function main() {
  const proxyAddress = process.env.PROXY_ADDRESS;
  const SSVNetwork = await ethers.getContractFactory("SSVNetwork");

  await upgrades.validateUpgrade(proxyAddress, SSVNetwork, { kind: 'uups' });
  console.log("Contract validation finished");
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });