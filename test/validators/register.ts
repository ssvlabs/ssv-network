import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any;

describe('Register Validator Tests', () => {
    beforeEach(async () => {
        // Initialize contract
        ssvNetworkContract = (await helpers.initializeContract()).contract;

        // Register operators
        await helpers.registerOperators(0, 1, '10');
        await helpers.registerOperators(1, 1, '10');
        await helpers.registerOperators(2, 1, '10');
        await helpers.registerOperators(3, 5, '10');

        // Deposit into accounts
        await helpers.deposit([0], ['100000']);
        await helpers.deposit([1], ['100000']);
    });

    it('Register validator emits ValidatorAdded event', async () => {
        await expect(ssvNetworkContract.registerValidator(
            helpers.DataGenerator.publicKey(0),
            helpers.DataGenerator.pod.new(),
            helpers.DataGenerator.shares(0),
            '10000'
        )).to.emit(ssvNetworkContract, 'ValidatorAdded');
    });

    it('Register one validator in empty pod with gas tracking', async () => {
        await helpers.registerValidators(0, 1, '10000', helpers.DataGenerator.pod.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    });

    it('Register two validators in existed pod with gas tracking', async () => {
        const result = await helpers.registerValidators(0, 1, '10000', helpers.DataGenerator.pod.new());
        await helpers.registerValidators(0, 1, '10000', helpers.DataGenerator.pod.byId(result.podId), [GasGroup.REGISTER_VALIDATOR_EXISTED_POD]);
    });

    it('Register two validators in existed cluster with gas tracking', async () => {
        const result = await helpers.registerValidators(0, 1, '10000', helpers.DataGenerator.pod.new());
        await helpers.registerValidators(1, 1, '10000', helpers.DataGenerator.pod.byId(result.podId), [GasGroup.REGISTER_VALIDATOR_EXISTED_CLUSTER]);
    });

    it('Register with 7 operators', async () => {
        await expect(ssvNetworkContract.registerValidator(
            helpers.DataGenerator.publicKey(0),
            [1, 2, 3, 4, 5, 6, 7],
            helpers.DataGenerator.shares(0),
            '4000'
        )).to.emit(ssvNetworkContract, 'ValidatorAdded');
    });

    it('Invalid operator amount', async () => {
        // 2 Operators
        await expect(ssvNetworkContract.registerValidator(
            helpers.DataGenerator.publicKey(0),
            [1, 2],
            helpers.DataGenerator.shares(0),
            '10000'
        )).to.be.revertedWith('OessDataStructureInvalid');

        // 6 Operators
        await expect(ssvNetworkContract.registerValidator(
            helpers.DataGenerator.publicKey(0),
            [1, 2, 3, 4, 5, 6],
            helpers.DataGenerator.shares(0),
            '10000'
        )).to.be.revertedWith('OessDataStructureInvalid');
    });

    it('Invalid public key length', async () => {
        await expect(ssvNetworkContract.registerValidator(
            helpers.DataGenerator.shares(0),
            [1, 2, 3, 4],
            helpers.DataGenerator.shares(0),
            '10000'
        )).to.be.revertedWith('InvalidPublicKeyLength');
    });

    it('Not enough amount', async () => {
        await expect(ssvNetworkContract.registerValidator(
            helpers.DataGenerator.publicKey(0),
            [1, 2, 3, 4],
            helpers.DataGenerator.shares(0),
            '1'
        )).to.be.revertedWith('account liquidatable');
    });

    // UPDATE ONCE LOGIC IS IMPLEMENTED
    // it('Invalid share', async () => {
    //     await expect(ssvNetworkContract.registerValidator(
    //         helpers.DataGenerator.publicKey(0),
    //         [1, 2, 3, 4],
    //         helpers.DataGenerator.publicKey(0),
    //         '10000'
    //     )).to.be.revertedWith('InvalidShareLength');
    // });

    // it('Not enough deposited', async () => {
    //     await expect(ssvNetworkContract.registerValidator(
    //         helpers.DataGenerator.publicKey(0),
    //         [1, 2, 3, 4],
    //         helpers.DataGenerator.shares(0),
    //         '100001'
    //     )).to.be.revertedWith('NotEnoungBalance');
    // });

    // it('Non existent operator', async () => {
    //     await expect(ssvNetworkContract.registerValidator(
    //         helpers.DataGenerator.publicKey(0),
    //         [1, 2, 3, 25],
    //         helpers.DataGenerator.shares(0),
    //         '4000'
    //     )).to.be.revertedWith('OperatorDoesntExist');
    // });
});
