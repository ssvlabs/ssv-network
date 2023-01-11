const { ethers, upgrades } = require("hardhat");

async function main() {
    const proxyAddress = process.env.PROXY_ADDRESS;
    const SSVNetworkV2 = await ethers.getContractFactory("SSVNetworkV2");
    console.log("Upgrading SSVNetworkV2...");
    await upgrades.upgradeProxy(proxyAddress, SSVNetworkV2);
    console.log("SSVNetworkV2 upgraded successfully");
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });