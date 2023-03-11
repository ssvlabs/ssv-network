import { task } from "hardhat/config";
import { generateABI } from "./utils";

task("upgrade:ssvnetworkviews", "Upgrade SSVNetworkViews contract")
    .addParam("tag", "Version of the contract")
    .setAction(async ({ tag: version }, hre) => {
        try {
            const proxyAddress = process.env.SSVNETWORKVIEWS_PROXY_ADDRESS;
            const [deployer] = await ethers.getSigners();
            console.log("Upgading contract with the account:", deployer.address);

            const SSVNetworkViews = await ethers.getContractFactory("SSVNetworkViews_V2");

            await upgrades.upgradeProxy(proxyAddress, SSVNetworkViews, {
                kind: 'uups',
                call: {
                    fn: 'initializev2',
                    args: [version]
                }
            });
            console.log("SSVNetworkViews upgraded successfully");
            await generateABI(hre, ["SSVNetworkViews"], [proxyAddress as string]);
        } catch (error) {
            console.error(error);
            process.exitCode = 1;
        }
    });