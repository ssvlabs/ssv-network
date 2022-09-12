import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, podResult: any;

describe('Register Validator Tests', () => {
    beforeEach(async () => {
        // Initialize contract
        ssvNetworkContract = (await helpers.initializeContract()).contract;

        // Register operators
        await helpers.registerOperators(0, 1, '10');
        await helpers.registerOperators(1, 1, '10');
        await helpers.registerOperators(2, 1, '10');
        await helpers.registerOperators(3, 8, '10');

        // Deposit into accounts
        await helpers.deposit([0], ['100000']);
        await helpers.deposit([1], ['100000']);

        // Register a validator
        podResult = await helpers.registerValidators(0, 1, '10000', helpers.DataGenerator.pod.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    });

    it('Register validator emits ValidatorAdded event', async () => {
        await expect(ssvNetworkContract.registerValidator(
            helpers.DataGenerator.publicKey(0),
            helpers.DataGenerator.pod.new(),
            helpers.DataGenerator.shares(0),
            '10000'
        )).to.emit(ssvNetworkContract, 'ValidatorAdded');
    });

    it('Register one validator into an empty pod', async () => {
        await helpers.registerValidators(0, 1, '10000', helpers.DataGenerator.pod.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    });

    it('Register two validators into an existing pod', async () => {
        await helpers.registerValidators(0, 1, '10000', helpers.DataGenerator.pod.byId(podResult.podId), [GasGroup.REGISTER_VALIDATOR_EXISTED_POD]);
    });

    it('Register two validators into an existing cluster', async () => {
        await helpers.registerValidators(1, 1, '10000', helpers.DataGenerator.pod.byId(podResult.podId), [GasGroup.REGISTER_VALIDATOR_EXISTED_CLUSTER]);
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
        await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
            helpers.DataGenerator.publicKey(0),
            [1, 2, 3, 4],
            helpers.DataGenerator.shares(0),
            '1'
        )).to.be.revertedWith('account liquidatable');
    });

    // GAS AMOUNT IS ABOVE EXPECTED
    it('Register with 7 operators', async () => {
        await helpers.registerValidators(0, 1, '10000', helpers.DataGenerator.pod.new(7), [GasGroup.REGISTER_VALIDATOR_EXISTED_POD]);
    });

    // THIS NEEDS VALIDITY
    it('Non existent operator', async () => {
        await expect(ssvNetworkContract.registerValidator(
            helpers.DataGenerator.publicKey(0),
            [1, 2, 3, 25],
            helpers.DataGenerator.shares(0),
            '4000'
        )).to.be.revertedWith('OperatorDoesntExist');
    });

    // THIS NEEDS VALIDITY
    it('Register with existing validator', async () => {
        // Register a validator
        await ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
            helpers.DataGenerator.publicKey(0),
            helpers.DataGenerator.pod.new(),
            helpers.DataGenerator.shares(0),
            '4000'
        )

        // Register the same validator again 
        await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
            helpers.DataGenerator.publicKey(0),
            [1, 2, 3, 25],
            helpers.DataGenerator.shares(0),
            '4000'
        )).to.be.revertedWith('ValidatorExistsAlready');
    });

    // THIS NEEDS SOME PROPER ERROR MESSAGE
    it('Not enough deposited', async () => {
        await expect(ssvNetworkContract.registerValidator(
            helpers.DataGenerator.publicKey(0),
            [1, 2, 3, 4],
            helpers.DataGenerator.shares(0),
            '100001'
        )).to.be.revertedWith('NotEnoughDeposited');
    });

    // MAYBE WE WILL ADD SOME VALIDITY HERE?
    // it('Invalid share', async () => {
    //     await expect(ssvNetworkContract.registerValidator(
    //         helpers.DataGenerator.publicKey(0),
    //         [1, 2, 3, 4],
    //         helpers.DataGenerator.publicKey(0),
    //         '10000'
    //     )).to.be.revertedWith('InvalidShareLength');
    // });
});








