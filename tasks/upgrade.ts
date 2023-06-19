import { task, types } from "hardhat/config";

/**
@title Hardhat task to upgrade a UUPS proxy contract.
This task upgrades a UUPS proxy contract deployed in a network to a new version.
It uses the OpenZeppelin Upgrades plugin for Hardhat to safely perform the upgrade operation.
@param {string} proxyAddress - The address of the existing UUPS proxy contract: SSVNetwork or SSVNetworkViews.
@param {string} contract - The name of the new contract that will replace the old one.
The contract should already be compiled and exist in the artifacts directory.
@param {string} [initFunction] - An optional function to be executed after the upgrade.
This function should be a method of the new contract and will be invoked as part of the upgrade transaction.
If not provided, no function will be called.
@param {Array} [params] - An optional array of parameters to the 'initFunction'.
The parameters should be ordered as expected by the 'initFunction'.
If 'initFunction' is not provided, this parameter has no effect.
@returns {void} This function doesn't return anything. After successfully upgrading, it prints the new implementation address to the console.
@example
// Upgrade the SSVNetwork contract to a new version 'SSVNetworkV2', and call a function 'initializev2' with parameters after upgrade:
npx hardhat --network goerli upgrade:proxy --proxyAddress 0x1234... --contract SSVNetworkV2 --initFunction initializev2 --params param1 param2
*/
task("upgrade:proxy", "Upgrade SSVNetwork / SSVNetworkViews proxy via hardhat upgrades plugin")
    .addParam("proxyAddress", "Proxy address of SSVNetwork / SSVNetworkViews", null, types.string)
    .addParam("contract", "New contract upgrade", null, types.string)
    .addOptionalParam("initFunction", "Function to be executed after upgrading")
    .addOptionalVariadicPositionalParam("params", "Function parameters")
    .setAction(async ({ proxyAddress, contract, initFunction, params }) => {
        const [deployer] = await ethers.getSigners();
        console.log(`Upgading ${proxyAddress} with the account: ${deployer.address}`);

        const SSVUpgradeFactory = await ethers.getContractFactory(contract);

        const ssvUpgrade = await upgrades.upgradeProxy(proxyAddress, SSVUpgradeFactory,
            {
                kind: 'uups',
                call: initFunction
                    ? {
                        fn: initFunction,
                        args: params ? params : ''
                    } :
                    ''
            });
        console.log(`${proxyAddress} upgraded successfully`);

        const implAddress = await upgrades.erc1967.getImplementationAddress(ssvUpgrade.address);
        console.log(`Implementation deployed to: ${implAddress}`);
    });

