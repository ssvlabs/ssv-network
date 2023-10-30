// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { trackGas } from '../helpers/gas-usage';
import { progressBlocks } from '../helpers/utils';

import { expect } from 'chai';

let ssvNetworkContract: any, ssvNetworkViews: any, firstCluster: any;

// Declare globals
describe('DAO operational Tests', () => {
    beforeEach(async () => {
        // Initialize contract
        const metadata = (await helpers.initializeContract());
        ssvNetworkContract = metadata.contract;
        ssvNetworkViews = metadata.ssvViews;
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

    it('Get the network validators count (add/remove validaotor)', async () => {
        await helpers.registerOperators(0, 4, helpers.CONFIG.minimalOperatorFee);

        const deposit = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 2) * helpers.CONFIG.minimalOperatorFee * 13;

        await helpers.DB.ssvToken.connect(helpers.DB.owners[4]).approve(ssvNetworkContract.address, deposit);

        const register = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).registerValidator(
            helpers.DataGenerator.publicKey(1),
            [1, 2, 3, 4],
            helpers.DataGenerator.shares(4),
            deposit,
            {
                validatorCount: 0,
                networkFeeIndex: 0,
                index: 0,
                balance: 0,
                active: true
            }
        ));

        firstCluster = register.eventsByName.ValidatorAdded[0].args;

        expect((await ssvNetworkViews.getNetworkValidatorsCount())).to.equal(1);

        await ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(
            helpers.DataGenerator.publicKey(1),
            firstCluster.operatorIds,
            firstCluster.cluster
        );
        expect((await ssvNetworkViews.getNetworkValidatorsCount())).to.equal(0);
    });

    it('Get the network validators count (add/remove validaotor)', async () => {
        await helpers.registerOperators(0, 4, helpers.CONFIG.minimalOperatorFee);

        const deposit = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 2) * helpers.CONFIG.minimalOperatorFee * 13;
        firstCluster = await helpers.registerValidators(4, 1, deposit.toString(), helpers.DataGenerator.cluster.new());
       
        expect((await ssvNetworkViews.getNetworkValidatorsCount())).to.equal(1);
        
        await progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);

        await ssvNetworkContract.connect(helpers.DB.owners[4]).liquidate(
            firstCluster.args.owner,
            firstCluster.args.operatorIds,
            firstCluster.args.cluster
        );

        expect((await ssvNetworkViews.getNetworkValidatorsCount())).to.equal(0);
    });

});