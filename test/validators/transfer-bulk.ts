import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, clusterResult1: any, clusterResult2: any, clusterResult3: any;

describe('Bulk Transfer Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 12, '10');
    await helpers.registerOperators(0, 1, '1000000');

    // Deposit into accounts
    await helpers.deposit([4], ['1000000']);
    await helpers.deposit([5], ['100000']);

    // Register validators
    clusterResult1 = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    clusterResult2 = await helpers.registerValidators(4, 9, '10000', helpers.DataGenerator.cluster.byId(clusterResult1.clusterId), [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER]);
    clusterResult3 = await helpers.registerValidators(4, 1, '90000', helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Bulk transfer 10 validators emits BulkValidatorTransferred event', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
      [clusterResult1.validators[0].publicKey, ...clusterResult2.validators.map((validator: any) => validator.publicKey)],
      clusterResult1.clusterId,
      clusterResult3.clusterId,
      Array(clusterResult2.validators.length + 1).fill(helpers.DataGenerator.shares(0)),
      '10000'
    )).to.emit(ssvNetworkContract, 'BulkValidatorTransferred');
  });

  it('Bulk transfer validator with an invalid owner', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[5]).bulkTransferValidators(
      [clusterResult1.validators[0].publicKey, ...clusterResult2.validators.map((validator: any) => validator.publicKey)],
      clusterResult1.clusterId,
      clusterResult3.clusterId,
      Array(clusterResult2.validators.length + 1).fill(helpers.DataGenerator.shares(0)),
      '10000'
    )).to.be.revertedWith('ValidatorNotOwned');
  });

  it('Bulk transfer validator with an unowned validator', async () => {
    const account5cluster = await helpers.registerValidators(5, 1, '10000', helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
      [clusterResult1.validators[0].publicKey, account5cluster.validators[0].publicKey, ...clusterResult2.validators.map((validator: any) => validator.publicKey)],
      clusterResult1.clusterId,
      clusterResult3.clusterId,
      Array(clusterResult2.validators.length + 2).fill(helpers.DataGenerator.shares(0)),
      '10000'
    )).to.be.revertedWith('ValidatorNotOwned');
  });

    it('Bulk transfer with an invalid public key', async () => {
      await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
        [clusterResult1.validators[0].publicKey, helpers.DataGenerator.shares(0), ...clusterResult2.validators.map((validator: any) => validator.publicKey)],
        clusterResult1.clusterId,
        clusterResult3.clusterId,
        Array(clusterResult2.validators.length + 2).fill(helpers.DataGenerator.shares(0)),
        '10000'
      )).to.be.revertedWith('ValidatorNotOwned');
    });

    it('Bulk transfer 10 validators', async () => {
      await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
        [clusterResult1.validators[0].publicKey, ...clusterResult2.validators.map((validator: any) => validator.publicKey)],
        clusterResult1.clusterId,
        clusterResult3.clusterId,
        Array(clusterResult2.validators.length + 1).fill(helpers.DataGenerator.shares(0)),
        '10000'
      ), [GasGroup.BULK_TRANSFER_VALIDATOR]);
    });

    it('Bulk transfer 10 validators to a cluster with 7 operators', async () => {
      // Register validator with 7 operators
      const { clusterId } = await helpers.registerValidators(4, 1, '90000', [1, 2, 3, 4, 5, 6, 7]);

      // Transfer validator to an existing cluster
      await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
        [clusterResult1.validators[0].publicKey, ...clusterResult2.validators.map((validator: any) => validator.publicKey)],
        clusterResult1.clusterId,
        clusterId,
        Array(clusterResult2.validators.length + 1).fill(helpers.DataGenerator.shares(0)),
        '10000'
      ), [GasGroup.BULK_TRANSFER_VALIDATOR_NON_EXISTING_POD]);
    });

    it('Bulk transfer 10 validators to cluster created by other owner', async () => {
      // Register validator with 7 operators
      const { clusterId } = await helpers.registerValidators(5, 1, '90000', helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);

      await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
        [clusterResult1.validators[0].publicKey, ...clusterResult2.validators.map((validator: any) => validator.publicKey)],
        clusterResult1.clusterId,
        clusterId,
        Array(clusterResult2.validators.length + 1).fill(helpers.DataGenerator.shares(0)),
        '100000'
      ), [GasGroup.BULK_TRANSFER_VALIDATOR_NON_EXISTING_POD]);
    });

    it('Bulk transfer 10 validators to an invalid cluster', async () => {
      await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
        [clusterResult1.validators[0].publicKey, ...clusterResult2.validators.map((validator: any) => validator.publicKey)],
        clusterResult1.clusterId.slice(0, -1) + 'a',
        clusterResult1.clusterId,
        Array(clusterResult2.validators.length + 1).fill(helpers.DataGenerator.shares(0)),
        '10000'
      )).to.be.revertedWith('InvalidCluster');
    });

    it('Validator and share length mismatch', async () => {
      // 10 validators and 11 shares
      await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
        [clusterResult1.validators[0].publicKey, ...clusterResult2.validators.map((validator: any) => validator.publicKey)],
        clusterResult1.clusterId,
        clusterResult3.clusterId,
        Array(clusterResult2.validators.length).fill(helpers.DataGenerator.shares(0)),
        '10000'
      )).to.be.revertedWith('ParametersMismatch');

      // 9 validators and 8 shares
      await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
        clusterResult2.validators.map((validator: any) => validator.publicKey),
        clusterResult1.clusterId,
        clusterResult3.clusterId,
        Array(clusterResult2.validators.length - 1).fill(helpers.DataGenerator.shares(0)),
        '10000'
      )).to.be.revertedWith('ParametersMismatch');
    });

  it('Bulk transfer validator with not enough amount', async () => {
    const { clusterId } = await helpers.registerValidators(5, 1, '90000', [10, 11, 12, 13], [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
      [clusterResult1.validators[0].publicKey, ...clusterResult2.validators.map((validator: any) => validator.publicKey)],
      clusterResult1.clusterId,
      clusterId,
      Array(clusterResult2.validators.length + 1).fill(helpers.DataGenerator.shares(0)),
      '1'
    )).to.be.revertedWith('AccountLiquidatable');
  });

  it('Bulk transfer validator with not enough balance', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
      [clusterResult1.validators[0].publicKey, ...clusterResult2.validators.map((validator: any) => validator.publicKey)],
      clusterResult1.clusterId,
      clusterResult3.clusterId,
      Array(clusterResult2.validators.length + 1).fill(helpers.DataGenerator.shares(0)),
      '10000000'
    )).to.be.revertedWith('NotEnoughDeposited');
  });
});