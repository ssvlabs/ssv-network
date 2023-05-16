// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';
// Declare globals
let ssvNetworkContract: any, ssvNetworkViews: any, registerAuth: any;
describe('Version upgrade tests', () => {
    beforeEach(async () => {
        const metadata = await helpers.initializeContract();
        ssvNetworkContract = metadata.contract;
        ssvNetworkViews = metadata.ssvViews;
        registerAuth = metadata.registerAuth;
    });

    it('Upgrade contract version number', async () => {
        expect(await ssvNetworkViews.getVersion()).to.equal(helpers.CONFIG.initialVersion);

        const SSVNetworkVersionUpgrade = await ethers.getContractFactory("SSVNetworkVersionUpgrade");
        const ssvNetwork = await upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetworkVersionUpgrade, {
            kind: 'uups',
            call: {
                fn: 'initializev2',
                args: ["0.0.2"]
            },
            unsafeAllow: ['constructor'],
            constructorArgs: [registerAuth.address],
        });
        await ssvNetwork.deployed();

        expect(await ssvNetworkViews.getVersion()).to.equal("0.0.2");
    });

});