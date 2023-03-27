import { task } from "hardhat/config";
import { generateABI } from "./utils";

task("upgrade:ssvnetwork", "Upgrade SSVNetwork contract")
    .addParam("tag", "Version of the contract")
    .setAction(async ({ tag: version }, hre) => {
        try {
            const proxyAddress = process.env.SSVNETWORK_PROXY_ADDRESS;
            const [deployer] = await ethers.getSigners();
            console.log("Upgading contract with the account:", deployer.address);

            const SSVNetwork = await ethers.getContractFactory("SSVNetwork_V2");

            await upgrades.upgradeProxy(proxyAddress, SSVNetwork, {
                kind: 'uups',
                call: {
                    fn: 'initializev2',
                    args: [version]
                }
            });
            console.log("SSVNetwork upgraded successfully");
            await generateABI(hre, ["SSVNetwork"], [proxyAddress as string]);
        } catch (error) {
            console.error(error);
            process.exitCode = 1;
        }
    });