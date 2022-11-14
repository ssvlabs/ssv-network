import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';

import { expect } from 'chai';
import { GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, clusterResult1: any, clusterResult2: any, minDepositAmount: any, clusters: any;

describe('Transfer Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 15, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = helpers.CONFIG.minimalBlocksBeforeLiquidation * helpers.CONFIG.minimalOperatorFee * 5;


    clusters = {};
    // Register validators
    clusters.one = helpers.DataGenerator.cluster.new();
    clusterResult1 = await helpers.registerValidators(4, 1, minDepositAmount, clusters.one, [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    clusters.two = helpers.DataGenerator.cluster.new();
    clusterResult2 = await helpers.registerValidators(4, 1, minDepositAmount, clusters.two, [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    clusters.three = helpers.DataGenerator.cluster.new();
  });

  it('Transfer validator emits ValidatorTransferred event', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      clusterResult1.validators[0].publicKey,
      (await helpers.registerPodAndDeposit(4, helpers.DataGenerator.cluster.new(), minDepositAmount)).clusterId,
      helpers.DataGenerator.shares(helpers.DB.validators.length),
    )).to.emit(ssvNetworkContract, 'ValidatorTransferred');
  });

  it('Transfer validator into a new cluster A-Z', async () => {
    await helpers.transferValidator(4, clusterResult2.validators[0].publicKey, clusters.three, minDepositAmount, [GasGroup.TRANSFER_VALIDATOR_NEW_CLUSTER]);
  });

  it('Transfer validator into a new cluster Z-A', async () => {
    const cluster = await helpers.registerValidators(4, 1, minDepositAmount, clusters.three, [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await helpers.transferValidator(4, cluster.validators[0].publicKey, clusters.one, minDepositAmount, [GasGroup.TRANSFER_VALIDATOR_NEW_CLUSTER]);
  });

  it('Transfer validator with an invalid owner', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[5]).transferValidator(
      clusterResult1.validators[0].publicKey,
      (await helpers.registerPodAndDeposit(4, helpers.DataGenerator.cluster.byId(clusterResult2.clusterId), minDepositAmount)).clusterId,
      helpers.DataGenerator.shares(helpers.DB.validators.length),
    )).to.be.revertedWith('ValidatorNotOwned');
  });

  it('transfer with an invalid public key', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      helpers.DataGenerator.shares(0),
      (await helpers.registerPodAndDeposit(4, helpers.DataGenerator.cluster.byId(clusterResult2.clusterId), minDepositAmount)).clusterId,
      helpers.DataGenerator.shares(helpers.DB.validators.length),
    )).to.be.revertedWith('InvalidPublicKeyLength');
  });

  it('Transfer validator to a cluster with 7 operators', async () => {
    // Register validator with 7 operators
    const { clusterId } = await helpers.registerValidators(4, 1, `${minDepositAmount / 4 * 7}`, [1, 2, 3, 4, 5, 6, 7]);

    // Transfer validator to an existing cluster
    await helpers.transferValidator(4, clusterResult1.validators[0].publicKey, helpers.DataGenerator.cluster.byId(clusterId), `${minDepositAmount / 4 * 7 * 2}`, [GasGroup.TRANSFER_VALIDATOR_NON_EXISTING_POD]);
  });

  it('Transfer validator with not enough amount', async () => {
    // Register validator
    const { clusterId } = await helpers.registerValidators(4, 1, minDepositAmount, [1, 2, 3, 9]);

    // Transfer to cluster with not enough amount
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      clusterResult1.validators[0].publicKey,
      (await helpers.registerPodAndDeposit(4, helpers.DataGenerator.cluster.byId(clusterId), helpers.CONFIG.minimalOperatorFee)).clusterId,
      helpers.DataGenerator.shares(helpers.DB.validators.length),
    )).to.be.revertedWith('NotEnoughBalance');
  });

  // GOING ABOVE GAS LIMIT
  it('Transfer validator to an existing pod', async () => {
    await helpers.transferValidator(4, clusterResult1.validators[0].publicKey, helpers.DataGenerator.cluster.byId(clusterResult2.clusterId), `${minDepositAmount * 2}`, [GasGroup.TRANSFER_VALIDATOR]);
  });

  // GOING ABOVE GAS LIMIT
  it('Transfer validator to an existing cluster', async () => {
    // Register validator with different user
    const clusterResult3 = await helpers.registerValidators(5, 1, minDepositAmount, clusters.one, [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);

    // Transfer validator
    await helpers.transferValidator(4, clusterResult1.validators[0].publicKey, helpers.DataGenerator.cluster.byId(clusterResult3.clusterId), `${minDepositAmount * 2}`, [GasGroup.TRANSFER_VALIDATOR_NON_EXISTING_POD]);

    // expect(clusterResult3.clusterId).equals(transfredValidator1.eventsByName.ValidatorTransferred[0].args.podId);
  });

  it('Transfer validator with removed operator in old cluster A-Z', async () => {
    await ssvNetworkContract.removeOperator(helpers.DataGenerator.cluster.byId(clusterResult1.clusterId)[0]);
    await helpers.transferValidator(4, clusterResult1.validators[0].publicKey, helpers.DataGenerator.cluster.byId(clusterResult2.clusterId), `${minDepositAmount * 2}`, [GasGroup.TRANSFER_VALIDATOR]);
  });

  it('Transfer validator with removed operator in new cluster A-Z', async () => {
    await ssvNetworkContract.removeOperator(helpers.DataGenerator.cluster.byId(clusterResult2.clusterId)[0]);
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation); // TMP IT FAILS WITH PROGRESS BLOCK, CRITICAL ERROR IN INDEX MATH LOGIC
    await helpers.transferValidator(4, clusterResult1.validators[0].publicKey, helpers.DataGenerator.cluster.byId(clusterResult2.clusterId), `${minDepositAmount * 2}`, [GasGroup.TRANSFER_VALIDATOR]);
  });

  it('Transfer validator with removed operator in old cluster Z-A', async () => {
    const cluster = await helpers.registerValidators(4, 1, minDepositAmount, clusters.three, [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await ssvNetworkContract.removeOperator(clusters.three[0]);
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation); // TMP IT FAILS WITH PROGRESS BLOCK, CRITICAL ERROR IN INDEX MATH LOGIC
    await helpers.transferValidator(4, cluster.validators[0].publicKey, clusters.one, `${minDepositAmount * 2}`, [GasGroup.TRANSFER_VALIDATOR_NEW_CLUSTER]);
  });

  it('Transfer validator with removed operator in new cluster Z-A', async () => {
    const cluster = await helpers.registerValidators(4, 1, minDepositAmount, clusters.three, [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await ssvNetworkContract.removeOperator(clusters.one[0]);
    await helpers.transferValidator(4, cluster.validators[0].publicKey, clusters.one, minDepositAmount, [GasGroup.TRANSFER_VALIDATOR_NEW_CLUSTER]);
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
