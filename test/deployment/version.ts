// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';
// Declare globals
let ssvNetworkContract: any, ssvNetworkViews: any;

describe('Version upgrade tests', () => {
    beforeEach(async () => {
        const metadata = await helpers.initializeContract();
        ssvNetworkContract = metadata.contract;
        ssvNetworkViews = metadata.ssvViews;
    });

    it('Upgrade contract version number', async () => {
        expect(await ssvNetworkViews.getVersion()).to.equal(helpers.CONFIG.initialVersion);
        const ssvViews = await ethers.getContractFactory('contracts/test/SSVViews.sol:SSVViews');
        const viewsContract = await ssvViews.deploy();
        await viewsContract.deployed();

        await ssvNetworkContract.upgradeModule(helpers.SSV_MODULES.SSV_VIEWS, viewsContract.address)

        expect(await ssvNetworkViews.getVersion()).to.equal("v0.3.2-rc0");
    });

});