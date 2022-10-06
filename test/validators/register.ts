import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, clusterResult: any, minDepositAmount: any;

describe('Register Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 11, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = helpers.CONFIG.minimalBlocksBeforeLiquidation * helpers.CONFIG.minimalOperatorFee * 4;

    // Deposit into accounts
    await helpers.deposit([0], [`${minDepositAmount * 2}`]);
    await helpers.deposit([1], [minDepositAmount]);

    // Register a validator
    clusterResult = await helpers.registerValidators(0, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Register validator emits ValidatorAdded event', async () => {
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.publicKey(1),
      helpers.DataGenerator.cluster.new(),
      helpers.DataGenerator.shares(0),
      minDepositAmount
    )).to.emit(ssvNetworkContract, 'ValidatorAdded');
  });

  it('Register one validator into an empty cluster', async () => {
    await helpers.registerValidators(0, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Register two validators into an existing cluster', async () => {
    await helpers.registerValidators(0, 1, `${minDepositAmount * 2}`, helpers.DataGenerator.cluster.byId(clusterResult.clusterId), [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER]);
  });

  it('Register two validators into an existing cluster', async () => {
    await helpers.registerValidators(1, 1, `${minDepositAmount * 2}`, helpers.DataGenerator.cluster.byId(clusterResult.clusterId), [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER]);
  });

  it('Invalid operator amount', async () => {
    // 2 Operators
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.publicKey(0),
      [1, 2],
      helpers.DataGenerator.shares(0),
      minDepositAmount
    )).to.be.revertedWith('OessDataStructureInvalid');

    // 6 Operators
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.publicKey(0),
      [1, 2, 3, 4, 5, 6],
      helpers.DataGenerator.shares(0),
      minDepositAmount
    )).to.be.revertedWith('OessDataStructureInvalid');
  });

  it('Invalid public key length', async () => {
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.shares(0),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(0),
      minDepositAmount
    )).to.be.revertedWith('InvalidPublicKeyLength');
  });

  it('Not enough amount', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(0),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(0),
      minDepositAmount / 10
    )).to.be.revertedWith('AccountLiquidatable');
  });

  it('Non existent operator', async () => {
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.publicKey(0),
      [1, 2, 3, 25],
      helpers.DataGenerator.shares(0),
      minDepositAmount
    )).to.be.revertedWith('OperatorDoesNotExist');
  });

  it('Register with existing validator', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(0),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(0),
      minDepositAmount
    )).to.be.revertedWith('ValidatorAlreadyExists');
  });

  // ABOVE GAS LIMIT
  it('Register with 7 operators', async () => {
    // await helpers.registerValidators(0, 1, '10000', helpers.DataGenerator.cluster.new(7), [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER]);
  });

  // TODO: fix after connecting the token
  it('Not enough balance', async () => {
    // await expect(ssvNetworkContract.registerValidator(
    //     helpers.DataGenerator.publicKey(0),
    //     [1, 2, 3, 4],
    //     helpers.DataGenerator.shares(0),
    //     '100005'
    // )).to.be.revertedWith('NotEnoughBalance');
  });
});








