// Decalre imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { GasGroup } from '../helpers/gas-usage';

// Declare globals 
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

  it('Transfer validator emits "ValidatorTransferred"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      clusterResult1.validators[0].publicKey,
      (await helpers.registerPodAndDeposit(4, helpers.DataGenerator.cluster.new(), minDepositAmount)).clusterId,
      helpers.DataGenerator.shares(helpers.DB.validators.length),
    )).to.emit(ssvNetworkContract, 'ValidatorTransferred');
  });

  it('Transfer validator from pod with one validator into an empty pod', async () => {
    await helpers.transferValidator(4, clusterResult2.validators[0].publicKey, clusters.three, minDepositAmount, [GasGroup.TRANSFER_VALIDATOR_NEW_CLUSTER]);
  });

  it('Transfer validator from pod with two validators into an empty pod', async () => {
    const cluster = await helpers.registerValidators(4, 1, minDepositAmount, clusters.three, [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await helpers.transferValidator(4, cluster.validators[0].publicKey, clusters.one, minDepositAmount, [GasGroup.TRANSFER_VALIDATOR_NEW_CLUSTER]);
  });

  it('Transfer validator to a cluster with 7 operators', async () => {
    // Register validator with 7 operators
    const { clusterId } = await helpers.registerValidators(4, 1, `${minDepositAmount / 4 * 7}`, [1, 2, 3, 4, 5, 6, 7]);

    // Transfer validator to an existing cluster
    await helpers.transferValidator(4, clusterResult1.validators[0].publicKey, helpers.DataGenerator.cluster.byId(clusterId), `${minDepositAmount / 4 * 7 * 2}`, [GasGroup.TRANSFER_VALIDATOR_NON_EXISTING_POD]);
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

  it('Transfer validator in a pod with one validator and a removed operator into an existing pod', async () => {
    await ssvNetworkContract.removeOperator(helpers.DataGenerator.cluster.byId(clusterResult1.clusterId)[0]);
    await helpers.transferValidator(4, clusterResult1.validators[0].publicKey, helpers.DataGenerator.cluster.byId(clusterResult2.clusterId), `${minDepositAmount * 2}`, [GasGroup.TRANSFER_VALIDATOR]);
  });

  it('Transfer validator in a pod with one validator and a removed operator into an empty pod', async () => {
    await ssvNetworkContract.removeOperator(helpers.DataGenerator.cluster.byId(clusterResult2.clusterId)[0]);
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation); // TMP IT FAILS WITH PROGRESS BLOCK, CRITICAL ERROR IN INDEX MATH LOGIC
    await helpers.transferValidator(4, clusterResult1.validators[0].publicKey, helpers.DataGenerator.cluster.byId(clusterResult2.clusterId), `${minDepositAmount * 2}`, [GasGroup.TRANSFER_VALIDATOR]);
  });

  it('Transfer validator in a pod with two validators and a removed operator into an existing pod', async () => {
    const cluster = await helpers.registerValidators(4, 1, minDepositAmount, clusters.three, [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await ssvNetworkContract.removeOperator(clusters.three[0]);
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation); // TMP IT FAILS WITH PROGRESS BLOCK, CRITICAL ERROR IN INDEX MATH LOGIC
    await helpers.transferValidator(4, cluster.validators[0].publicKey, clusters.one, `${minDepositAmount * 2}`, [GasGroup.TRANSFER_VALIDATOR_NEW_CLUSTER]);
  });

  it('Transfer validator in a pod with two validators and a removed operator into an empty pod', async () => {
    const cluster = await helpers.registerValidators(4, 1, minDepositAmount, clusters.three, [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await ssvNetworkContract.removeOperator(clusters.one[0]);
    await helpers.transferValidator(4, cluster.validators[0].publicKey, clusters.one, minDepositAmount, [GasGroup.TRANSFER_VALIDATOR_NEW_CLUSTER]);
  });

  it('Transfer validator I do not own reverts "ValidatorNotOwned"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[5]).transferValidator(
      clusterResult1.validators[0].publicKey,
      (await helpers.registerPodAndDeposit(4, helpers.DataGenerator.cluster.byId(clusterResult2.clusterId), minDepositAmount)).clusterId,
      helpers.DataGenerator.shares(helpers.DB.validators.length),
    )).to.be.revertedWith('ValidatorNotOwned');
  });

  it('Transfer validator with an invalid public key reverts "InvalidPublicKeyLength"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      helpers.DataGenerator.shares(0),
      (await helpers.registerPodAndDeposit(4, helpers.DataGenerator.cluster.byId(clusterResult2.clusterId), minDepositAmount)).clusterId,
      helpers.DataGenerator.shares(helpers.DB.validators.length),
    )).to.be.revertedWith('InvalidPublicKeyLength');
  });

  it('Transfer validator to a pod with not enough amount reverts "NotEnoughBalance"', async () => {
    // Register validator
    const { clusterId } = await helpers.registerValidators(4, 1, minDepositAmount, [1, 2, 3, 9]);

    // Transfer to cluster with not enough amount
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      clusterResult1.validators[0].publicKey,
      (await helpers.registerPodAndDeposit(4, helpers.DataGenerator.cluster.byId(clusterId), helpers.CONFIG.minimalOperatorFee)).clusterId,
      helpers.DataGenerator.shares(helpers.DB.validators.length),
    )).to.be.revertedWith('NotEnoughBalance');
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