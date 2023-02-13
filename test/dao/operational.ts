// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';

let ssvNetworkContract: any;

// Declare globals
describe('DAO operational Tests', () => {
    beforeEach(async () => {
        // Initialize contract
        ssvNetworkContract = (await helpers.initializeContract()).contract;
    });

    it('Starting the transfer process does not change owner', async () => {
        await ssvNetworkContract.transferOwnership(helpers.DB.owners[4].address);

        expect(await ssvNetworkContract.owner()).equals(helpers.DB.owners[0].address);
    });

    it('Ownership is transferred in a 2-step process', async () => {
        await ssvNetworkContract.transferOwnership(helpers.DB.owners[4].address);
        await ssvNetworkContract.connect(helpers.DB.owners[4]).acceptOwnership();

        expect(await ssvNetworkContract.owner()).equals(helpers.DB.owners[4].address);
    });

});