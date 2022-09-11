import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any;

describe('Remove Validator Tests', () => {
    beforeEach(async () => {
        // Initialize contract
        ssvNetworkContract = (await helpers.initializeContract()).contract;

        // Register operators
        await helpers.registerOperators(0, 1, '10');
        await helpers.registerOperators(1, 1, '10');
        await helpers.registerOperators(2, 1, '10');
        await helpers.registerOperators(3, 1, '10');

        // Deposit into accounts
        await helpers.deposit([4], ['100000']);
    });

    it('Remove validator emits ValidatorRemoved event', async () => {
        // Register validator
        const { validators } = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());

        // Remove validator
        await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(
            validators[0].publicKey,
        )).to.emit(ssvNetworkContract, 'ValidatorRemoved');
    });

    it('Remove validator with gas tracking', async () => {
        // Register validator
        const { validators } = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());

        // Remove validator
        await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(validators[0].publicKey), [GasGroup.REMOVE_VALIDATOR]);
    });

    it('Fail to remove validator with an invalid owner', async () => {
        // Register validator
        const { validators } = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());

        // Remove validator
        await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).removeValidator(validators[0].publicKey)).to.be.revertedWith('ValidatorNotOwned');
    });

    // UPDATE ONCE LIQUIDATE FUNCTION IS IMPLEMENTED
    // it('Remove validator from a liquidated pod', async () => {
    //     // Register validator
    //     const { validators } = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());

    //     // Liquidate pod
    //     // Progress blocks to liquidatable state
    //     // Liquidate pod

    //     // Remove validator
    //     await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(
    //         validators[0].publicKey,
    //     )).to.emit(ssvNetworkContract, 'ValidatorRemoved');
    // });
});