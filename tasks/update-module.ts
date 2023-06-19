import { task, types } from "hardhat/config";
import { SSVModules } from "./ssvModules";

/**
@title Hardhat task to update a module contract in the SSVNetwork.
This task first deploys a new version of a specified SSV module contract, and then updates the SSVNetwork contract to use this new module version.
The module's name is required and it's expected to match one of the SSVModules enumeration values.
The address of the SSVNetwork Proxy is expected to be set in the environment variable SSVNETWORK_PROXY_ADDRESS.
@param {string} module - The name of the SSV module to be updated.
@example
// Update 'SSVOperators' module contract in the SSVNetwork
npx hardhat --network goerli update:module --module SSVOperators
@remarks
The deployer account used will be the first one returned by ethers.getSigners().
Therefore, it should be appropriately configured in your Hardhat network configuration.
The module's contract specified should be already compiled and exist in the 'artifacts' directory.
*/
task("update:module", "Deploys a new module contract and links it to SSVNetwork")
    .addParam("module", "SSV Module", null, types.string)
    .setAction(async ({ module }, hre) => {
        const proxyAddress = process.env.SSVNETWORK_PROXY_ADDRESS;
        if (!proxyAddress) throw new Error("SSVNETWORK_PROXY_ADDRESS not set.");

        const [deployer] = await ethers.getSigners();
        console.log(`Deploying contracts with the account:${deployer.address}`);

        // Initialize contract
        const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
        const ssvNetwork = await ssvNetworkFactory.attach(proxyAddress);

        const moduleAddress = await hre.run("deploy:module", { module });
 
        await ssvNetwork.upgradeModule(SSVModules[module], moduleAddress);
        console.log(`${module} module attached to SSVNetwork succesfully`);
    });