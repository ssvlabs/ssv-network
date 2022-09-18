import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, clusterResult1: any, clusterResult2: any;

describe('Transfer Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 12, '10');

    // Register validators
    clusterResult1 = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    clusterResult2 = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Transfer validator emits ValidatorTransferred event', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      clusterResult1.validators[0].publicKey,
      helpers.DataGenerator.cluster.new(),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    )).to.emit(ssvNetworkContract, 'ValidatorTransferred');
  });

  it('Transfer validator into a new cluster', async () => {
    const transferedValidator = await helpers.transferValidator(4, clusterResult1.validators[0].publicKey, helpers.DataGenerator.cluster.new(), '10000', [GasGroup.TRANSFER_VALIDATOR_NEW_CLUSTER]);
    // expect(clusterResult1.clusterId).not.equals(transferedValidator.eventsByName.ValidatorTransferred[0].args.clusterId);
  });

  it('Transfer validator with an invalid owner', async () => {
    // Transfer validator with an invalid owner
    await expect(ssvNetworkContract.connect(helpers.DB.owners[5]).transferValidator(
      clusterResult1.validators[0].publicKey,
      helpers.DataGenerator.cluster.byId(clusterResult2.clusterId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    )).to.be.revertedWith('ValidatorNotOwned');

    // Transfer validator with an invalid public key
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      helpers.DataGenerator.shares(0),
      helpers.DataGenerator.cluster.byId(clusterResult2.clusterId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    )).to.be.revertedWith('ValidatorNotOwned');
  });

  it('Transfer validator to a cluster with 7 operators', async () => {
    // Register validator with 7 operators
    const { clusterId } = await helpers.registerValidators(4, 1, '10000', [1, 2, 3, 4, 5, 6, 7]);

    // Transfer validator to an existing cluster
    await helpers.transferValidator(4, clusterResult1.validators[0].publicKey, helpers.DataGenerator.cluster.byId(clusterId), '10000', [GasGroup.TRANSFER_VALIDATOR_NON_EXISTING_POD]);
  });

  it('Transfer validator with not enough amount', async () => {
    // Register validator
    const { clusterId } = await helpers.registerValidators(4, 1, '3000', [1, 2, 3, 9]);

    // Transfer to cluster with not enough amount
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      clusterResult1.validators[0].publicKey,
      helpers.DataGenerator.cluster.byId(clusterId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '1'
    )).to.be.revertedWith('AccountLiquidatable');
  });

  // GOING ABOVE GAS LIMIT
  it('Transfer validator to an existing pod', async () => {
    await helpers.transferValidator(4, clusterResult1.validators[0].publicKey, helpers.DataGenerator.cluster.byId(clusterResult2.clusterId), '10000', [GasGroup.TRANSFER_VALIDATOR]);
  });

  // GOING ABOVE GAS LIMIT
  it('Transfer validator to an existing cluster', async () => {
    // Register validator with different user
    const clusterResult3 = await helpers.registerValidators(5, 1, '10000', helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);

    // Transfer validator
    const transfredValidator1 = await helpers.transferValidator(4, clusterResult1.validators[0].publicKey, helpers.DataGenerator.cluster.byId(clusterResult3.clusterId), '10000', [GasGroup.TRANSFER_VALIDATOR_NON_EXISTING_POD]);

   // expect(clusterResult3.clusterId).equals(transfredValidator1.eventsByName.ValidatorTransferred[0].args.podId);
  });

  // TODO: fix after connecting the token
  it('Transfer validator with not enough balance', async () => {
    // await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
    //   clusterResult1.validators[0].publicKey,
    //   helpers.DataGenerator.cluster.byId(clusterResult2.clusterId),
    //   helpers.DataGenerator.shares(helpers.DB.validators.length),
    //   '1000001'
    // )).to.be.revertedWith('NotEnoughBalance');
  });
});