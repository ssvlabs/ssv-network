declare const ethers: any;

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

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 2) * helpers.CONFIG.minimalOperatorFee * 4;

    // Deposit into accounts
    // await helpers.deposit([0], [`${minDepositAmount * 2}`]);
    // await helpers.deposit([1], [minDepositAmount]);

    // Register a validator
    clusterResult = await helpers.registerValidators(0, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Register validator emits ValidatorAdded event', async () => {
    // initialize cluster by operatorIds and deposit a pod
    const tx = await (await ssvNetworkContract.initializeCluster(helpers.DataGenerator.cluster.new(), minDepositAmount)).wait();

    // register validator using cluster Id
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.publicKey(1),
      tx.events[0].args.clusterId,
      helpers.DataGenerator.shares(0)
    )).to.emit(ssvNetworkContract, 'ValidatorAdded');
  });

  it('Register one validator into an empty cluster', async () => {
    await helpers.registerValidators(0, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Register two validators in the same pod', async () => {
    await helpers.registerValidators(0, 1, minDepositAmount, helpers.DataGenerator.cluster.byId(clusterResult.clusterId), [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER]);
  });

  it('Register two validators into an existing cluster', async () => {
    await helpers.registerValidators(1, 1, minDepositAmount, helpers.DataGenerator.cluster.byId(clusterResult.clusterId), [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER]);
  });

  it('Invalid operator amount', async () => {
    // 2 Operators
    await expect(ssvNetworkContract.initializeCluster([1, 2], minDepositAmount)).to.be.revertedWith('OessDataStructureInvalid');

    // 6 Operators
    await expect(ssvNetworkContract.initializeCluster([1, 2, 3, 4, 5, 6], minDepositAmount)).to.be.revertedWith('OessDataStructureInvalid');
  });

  it('Invalid public key length', async () => {
    // initialize cluster by operatorIds and deposit a pod
    const tx = await (await ssvNetworkContract.initializeCluster(helpers.DataGenerator.cluster.new(), minDepositAmount)).wait();

    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.shares(0),
      tx.events[0].args.clusterId,
      helpers.DataGenerator.shares(0),
    )).to.be.revertedWith('InvalidPublicKeyLength');
  });

  it('Not enough amount', async () => {
    // initialize cluster by operatorIds and deposit a pod
    const tx = await (await ssvNetworkContract.initializeCluster(helpers.DataGenerator.cluster.new(), 0)).wait();

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(0),
      tx.events[0].args.clusterId,
      helpers.DataGenerator.shares(0),
    )).to.be.revertedWith('AccountLiquidatable');
  });

  it('Non existent operator', async () => {
    // initialize cluster by operatorIds and deposit a pod
    const tx = await (await ssvNetworkContract.initializeCluster([1, 2, 3, 25], minDepositAmount)).wait();

    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.publicKey(0),
      tx.events[0].args.clusterId,
      helpers.DataGenerator.shares(0),
    )).to.be.revertedWith('OperatorDoesNotExist');
  });

  it('Register with existing validator', async () => {
    // initialize cluster by operatorIds and deposit a pod
    const tx = await (await ssvNetworkContract.connect(helpers.DB.owners[1]).initializeCluster([1, 2, 3, 4], minDepositAmount)).wait();

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(0),
      tx.events[0].args.clusterId,
      helpers.DataGenerator.shares(0),
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








