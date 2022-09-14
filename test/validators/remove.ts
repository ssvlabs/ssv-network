import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, podResult: any;

describe('Remove Validator Tests', () => {
    beforeEach(async () => {
        // Initialize contract
        ssvNetworkContract = (await helpers.initializeContract()).contract;

        // Register operators
        await helpers.registerOperators(0, 4, '10');

        // Deposit into accounts
        await helpers.deposit([4], ['100000']);

        // Register a validator
        podResult = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    });

    it('Remove validator emits ValidatorRemoved event', async () => {
        await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(
            podResult.validators[0].publicKey,
        )).to.emit(ssvNetworkContract, 'ValidatorRemoved');
    });

    it('Remove validator', async () => {
        await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(podResult.validators[0].publicKey), [GasGroup.REMOVE_VALIDATOR]);
    });

    it('Remove validator with an invalid owner', async () => {
        await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).removeValidator(podResult.validators[0].publicKey)).to.be.revertedWith('ValidatorNotOwned');
    });

    // THIS SHOULD PASS
    it('Remove validator twice', async () => {
        // Remove validator
        await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(podResult.validators[0].publicKey), [GasGroup.REMOVE_VALIDATOR]);

        // Remove validator again
        await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(podResult.validators[0].publicKey)).to.be.revertedWith('ValidatorNotOwned');
    });

    // THIS SHOULD PASS
    it('Register / remove validator twice', async () => {
        // Remove validator
        await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(podResult.validators[0].publicKey), [GasGroup.REMOVE_VALIDATOR]);

        // Re-register validator
        await ssvNetworkContract.connect(helpers.DB.owners[4]).registerValidator(
            helpers.DataGenerator.publicKey(0),
            [1, 2, 3, 4],
            helpers.DataGenerator.shares(0),
            '1000'
        );

        // Remove the validator again
        await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(helpers.DataGenerator.publicKey(0)), [GasGroup.REMOVE_VALIDATOR]);
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