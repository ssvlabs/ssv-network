import { task } from "hardhat/config";

task("validate:upgrade", "Validate SSVNetwork or SSVNetworkViews contract upgrade")
    .addParam("type", "Contract type [ssvnetwork | ssvnetworkviews]")
    .addParam("name", "Contract name to validate")
    .setAction(async ({ type, name }) => {
        try {
            let proxyAddress;
            if(type === 'ssvnetwork') {
                proxyAddress = process.env.SSVNETWORK_PROXY_ADDRESS;
            } else if(type === 'ssvnetworkviews') {
                proxyAddress = process.env.SSVNETWORKVIEWS_PROXY_ADDRESS;
            } else {
                throw new Error(`Wrong contract type ${type}`);
            }

            const contract = await ethers.getContractFactory(name);

            await upgrades.validateUpgrade(proxyAddress, contract, { kind: 'uups' });
            console.log("Contract validation finished");
        } catch (error) {
            console.error(error);
            process.exitCode = 1;
        }
    });