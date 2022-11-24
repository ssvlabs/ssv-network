// Declare imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

// Declare globals
let ssvNetworkContract: any, clusterResult: any, minDepositAmount: any;

describe('Register Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 11, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 2) * helpers.CONFIG.minimalOperatorFee * 4;

    // Register a validator
    clusterResult = await helpers.registerValidators(0, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Register new pod emits "PodCreated"', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerPod(helpers.DataGenerator.cluster.new(), minDepositAmount
    )).to.emit(ssvNetworkContract, 'PodCreated');
  });

  it('Register new pod with a new cluster gas limit', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerPod(helpers.DataGenerator.cluster.new(), minDepositAmount), [GasGroup.REGISTER_POD]);
  });

  it('Register new pod in existed cluster gas limit', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerPod(helpers.DataGenerator.cluster.byId(clusterResult.clusterId), minDepositAmount), [GasGroup.REGISTER_POD]);
  });

  it('Register validator emits "ValidatorAdded"', async () => {
    // register validator using cluster Id
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.publicKey(1),
      (await helpers.registerPodAndDeposit(0, helpers.DataGenerator.cluster.new(), minDepositAmount)).clusterId,
      helpers.DataGenerator.shares(0)
    )).to.emit(ssvNetworkContract, 'ValidatorAdded');
  });

  it('Get pod returns a cluster id', async () => {
    expect(await ssvNetworkContract.getPod(helpers.DataGenerator.cluster.byId(clusterResult.clusterId))).to.equal(clusterResult.clusterId);
  });

  it('Register validator with a removed operator in the cluster', async () => {
    await ssvNetworkContract.removeOperator(1);
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation); // TMP IT FAILS WITH PROGRESS BLOCK, CRITICAL ERROR IN INDEX MATH LOGIC
    await helpers.DB.ssvToken.connect(helpers.DB.owners[4]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4])['deposit(bytes32,uint256)'](clusterResult.clusterId, minDepositAmount), [GasGroup.DEPOSIT]);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).registerValidator(helpers.DataGenerator.publicKey(9), clusterResult.clusterId, helpers.DataGenerator.shares(0)), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);
  });

  it('Register a validator into an empty cluster', async () => {
    await helpers.registerValidators(0, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Register two validators in the same pod', async () => {
    await helpers.registerValidators(0, 1, `${minDepositAmount * 2}`, helpers.DataGenerator.cluster.byId(clusterResult.clusterId), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);
  });

  it('Register two validators into an existing cluster', async () => {
    await helpers.registerValidators(1, 1, `${minDepositAmount * 2}`, helpers.DataGenerator.cluster.byId(clusterResult.clusterId), [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER]);
  });

  it('Register an existed pod reverts "PodAlreadyExists"', async () => {
    await expect(ssvNetworkContract.registerPod(helpers.DataGenerator.cluster.byId(clusterResult.clusterId), 0
    )).to.be.revertedWith('PodAlreadyExists');
  });

  it('Get the cluster id of a cluster that does not exists reverts "ClusterNotExists"', async () => {
    await expect(ssvNetworkContract.getClusterId([5, 6, 7, 8]
    )).to.be.revertedWith('ClusterNotExists');
  });

  it('Get the pod address of a pod that does not exists reverts "PodNotExists"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).getPod(helpers.DataGenerator.cluster.byId(clusterResult.clusterId)
    )).to.be.revertedWith('PodNotExists');
  });

  it('Register a pod without any operator in the cluster reverts "OperatorDoesNotExist"', async () => {
    await expect(ssvNetworkContract.registerPod([1, 2, 3, 25], minDepositAmount
    )).to.be.revertedWith('OperatorDoesNotExist');
  });

  it('Register a pod with a list of operators not sorted by asc reverts "The operators list should be in ascending order"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerPod([3, 2, 1, 4], minDepositAmount
    )).to.be.revertedWith('The operators list should be in ascending order');
  });

  it('Invalid operator amount reverts "OperatorIdsStructureInvalid"', async () => {
    // 2 Operators
    await expect(helpers.registerPodAndDeposit(0, [1, 2], minDepositAmount
    )).to.be.revertedWith('OperatorIdsStructureInvalid');

    // 6 Operators
    await expect(helpers.registerPodAndDeposit(0, [1, 2, 3, 4, 5, 6], minDepositAmount
    )).to.be.revertedWith('OperatorIdsStructureInvalid');

    // 14 Operators
    await expect(helpers.registerPodAndDeposit(0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], minDepositAmount
    )).to.be.revertedWith('OperatorIdsStructureInvalid');
  });

  it('Register validator with invalild public key reverts "InvalidPublicKeyLength"', async () => {
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.shares(0),
      (await helpers.registerPodAndDeposit(0, helpers.DataGenerator.cluster.new(), minDepositAmount)).clusterId,
      helpers.DataGenerator.shares(0),
    )).to.be.revertedWith('InvalidPublicKeyLength');
  });

  it('Register validator with not enough balance reverts "NotEnoughBalance', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      (await helpers.registerPodAndDeposit(0, helpers.DataGenerator.cluster.new(), '0')).clusterId,
      helpers.DataGenerator.shares(0),
    )).to.be.revertedWith('NotEnoughBalance');
  });

  it('Register an existed validator reverts "ValidatorAlreadyExists"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(0),
      (await helpers.registerPodAndDeposit(1, [1, 2, 3, 4], minDepositAmount)).clusterId,
      helpers.DataGenerator.shares(0),
    )).to.be.revertedWith('ValidatorAlreadyExists');
  });

  it('Register validator with a cluster that does not exists reverts "ClusterNotExists"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(0),
      clusterResult.clusterId.replace(/.$/, '0'),
      helpers.DataGenerator.shares(0),
    )).to.be.revertedWith('ClusterNotExists');
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








