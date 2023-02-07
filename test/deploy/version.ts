// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';
// Declare globals
let ssvNetworkContract: any;
describe.only('Version upgrade tests', () => {
    beforeEach(async () => {
        ssvNetworkContract = (await helpers.initializeContract()).contract;
    });

    it('Upgrade contract version number', async () => {
        const version = await ssvNetworkContract.version();
        expect(version).to.equal(1);

        const SSVNetwork_version = await ethers.getContractFactory("SSVNetwork_version");
        const ssvNetwork_version = await upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetwork_version, {
            kind: 'uups',
            call: 'initializev2'
        });
        await ssvNetwork_version.deployed();

        expect((await ssvNetwork_version.version())).to.equal(2);
    });

});