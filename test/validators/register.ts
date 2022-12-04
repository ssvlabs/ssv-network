import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, clusterResult: any, minDepositAmount: any;

describe('Register Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 11, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 2) * helpers.CONFIG.minimalOperatorFee * 7;

    // Register a validator
    // clusterResult = await helpers.registerValidators(0, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await helpers.DB.ssvToken.connect(helpers.DB.owners[3]).approve(ssvNetworkContract.address, minDepositAmount);
    await ssvNetworkContract.connect(helpers.DB.owners[3]).registerValidator(
      helpers.DataGenerator.publicKey(9),
      helpers.DataGenerator.cluster.new(4),
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    );
  });

  it('Register 1 new validator gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount * 2);
    await ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(0),
      helpers.DataGenerator.cluster.new(4, [1,2,3,4]),
      helpers.DataGenerator.shares(0),
      minDepositAmount * 2,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    );
  });

  it('Register 2 validators in same pod gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const tx = await ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(0),
      helpers.DataGenerator.cluster.new(4, [1,2,3,4]),
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    );
    const receipt = await tx.wait();
    const operatorData = [receipt.events[0].args.operator, receipt.events[1].args.operator, receipt.events[2].args.operator, receipt.events[3].args.operator];

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      operatorData,
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      receipt.events[8].args.pod
    );
  });

  it('Register 2 validators in same pod with one time deposit gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount * 2);
    const tx = await ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(0),
      helpers.DataGenerator.cluster.new(4, [1,2,3,4]),
      helpers.DataGenerator.shares(0),
      minDepositAmount * 2,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    );
    const receipt = await tx.wait();
    const operatorData = [receipt.events[0].args.operator, receipt.events[1].args.operator, receipt.events[2].args.operator, receipt.events[3].args.operator];

    await ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      operatorData,
      helpers.DataGenerator.shares(0),
      0,
      receipt.events[8].args.pod
    );
  });

  /*
    it('Register 2 validators in same pod and 1 validator in new pod gas usage', async () => {
      const cluster = helpers.DataGenerator.cluster.new();
      await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
      const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
        helpers.DataGenerator.publicKey(1),
        cluster,
        helpers.DataGenerator.shares(0),
        minDepositAmount,
        {
          validatorCount: 0,
          networkFee: 0,
          networkFeeIndex: 0,
          index: 0,
          balance: 0,
          disabled: false
        }
      ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);

      const args = eventsByName.PodMetadataUpdated[0].args;

      await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
      await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
        helpers.DataGenerator.publicKey(2),
        cluster,
        helpers.DataGenerator.shares(0),
        minDepositAmount,
        args.pod
      ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);

      await helpers.DB.ssvToken.connect(helpers.DB.owners[2]).approve(ssvNetworkContract.address, minDepositAmount);
      await trackGas(ssvNetworkContract.connect(helpers.DB.owners[2]).registerValidator(
        helpers.DataGenerator.publicKey(4),
        helpers.DataGenerator.cluster.new(),
        helpers.DataGenerator.shares(0),
        minDepositAmount,
        {
          validatorCount: 0,
          networkFee: 0,
          networkFeeIndex: 0,
          index: 0,
          balance: 0,
          disabled: false
        }
      ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    });


    it('Register new pod with new cluster gas limit', async () => {
      await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
      await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerPod(helpers.DataGenerator.cluster.new(), minDepositAmount), [GasGroup.REGISTER_POD]);
    });

    it('Register new pod in existed cluster gas limit', async () => {
      await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
      await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerPod(helpers.DataGenerator.cluster.byId(clusterResult.clusterId), minDepositAmount), [GasGroup.REGISTER_POD]);
    });

    it('Register pod returns an error - PodAlreadyExists', async () => {
      await expect(ssvNetworkContract.registerPod(helpers.DataGenerator.cluster.byId(clusterResult.clusterId), 0)).to.be.revertedWith('PodAlreadyExists');
    });

    it('Get cluster id returns an error - ClusterNotExists', async () => {
      await expect(ssvNetworkContract.getClusterId([5,6,7,8])).to.be.revertedWith('ClusterNotExists');
    });

    it('Get pod returns an error - PoNotExists', async () => {
      await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).getPod(helpers.DataGenerator.cluster.byId(clusterResult.clusterId))).to.be.revertedWith('PodNotExists');
    });

    it('Get pod returns a cluster id', async () => {
      expect(await ssvNetworkContract.getPod(helpers.DataGenerator.cluster.byId(clusterResult.clusterId))).to.equal(clusterResult.clusterId);
    });

    it('Register pod returns an error - OperatorDoesNotExist', async () => {
      await expect(ssvNetworkContract.registerPod([1, 2, 3, 25], minDepositAmount)).to.be.revertedWith('OperatorDoesNotExist');
    });

    it('Register validator emits ValidatorAdded event', async () => {
      // register validator using cluster Id
      await expect(ssvNetworkContract.registerValidator(
        helpers.DataGenerator.publicKey(1),
        (await helpers.registerPodAndDeposit(0, helpers.DataGenerator.cluster.new(), minDepositAmount)).clusterId,
        helpers.DataGenerator.shares(0)
      )).to.emit(ssvNetworkContract, 'ValidatorAdded');
    });

    it('Register validator with removed operator in a cluster', async () => {
      await ssvNetworkContract.removeOperator(1);
      await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation); // TMP IT FAILS WITH PROGRESS BLOCK, CRITICAL ERROR IN INDEX MATH LOGIC
      await helpers.DB.ssvToken.connect(helpers.DB.owners[4]).approve(ssvNetworkContract.address, minDepositAmount);
      await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4])['deposit(bytes32,uint256)'](clusterResult.clusterId, minDepositAmount), [GasGroup.DEPOSIT]);
      await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).registerValidator(helpers.DataGenerator.publicKey(9), clusterResult.clusterId, helpers.DataGenerator.shares(0)), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);
    });

    it('Register one validator into an empty cluster', async () => {
      await helpers.registerValidators(0, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    });

    it('Register two validators in the same pod', async () => {
      await helpers.registerValidators(0, 1, `${minDepositAmount * 2}`, helpers.DataGenerator.cluster.byId(clusterResult.clusterId), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);
    });

    it('Register two validators into an existing cluster', async () => {
      await helpers.registerValidators(1, 1, `${minDepositAmount * 2}`, helpers.DataGenerator.cluster.byId(clusterResult.clusterId), [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER]);
    });

    it('Register pod returns an error - The operators list should be in ascending order', async () => {
      await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerPod([3,2,1,4], minDepositAmount)).to.be.revertedWith('The operators list should be in ascending order');
    });

    it('Invalid operator amount', async () => {
      // 2 Operators
      await expect(helpers.registerPodAndDeposit(0, [1, 2], minDepositAmount)).to.be.revertedWith('OperatorIdsStructureInvalid');

      // 6 Operators
      await expect(helpers.registerPodAndDeposit(0, [1, 2, 3, 4, 5, 6], minDepositAmount)).to.be.revertedWith('OperatorIdsStructureInvalid');

      // 14 Operators
      await expect(helpers.registerPodAndDeposit(0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], minDepositAmount)).to.be.revertedWith('OperatorIdsStructureInvalid');
    });

    it('Register validator returns an error - InvalidPublicKeyLength', async () => {
      await expect(ssvNetworkContract.registerValidator(
        helpers.DataGenerator.shares(0),
        (await helpers.registerPodAndDeposit(0, helpers.DataGenerator.cluster.new(), minDepositAmount)).clusterId,
        helpers.DataGenerator.shares(0),
      )).to.be.revertedWith('InvalidPublicKeyLength');
    });

    it('Register validator returns an error - NotEnoughBalance', async () => {
      await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
        helpers.DataGenerator.publicKey(1),
        (await helpers.registerPodAndDeposit(0, helpers.DataGenerator.cluster.new(), '0')).clusterId,
        helpers.DataGenerator.shares(0),
      )).to.be.revertedWith('NotEnoughBalance');
    });

    it('Register validator returns an error - ValidatorAlreadyExists', async () => {
      await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
        helpers.DataGenerator.publicKey(0),
        (await helpers.registerPodAndDeposit(1, [1, 2, 3, 4], minDepositAmount)).clusterId,
        helpers.DataGenerator.shares(0),
      )).to.be.revertedWith('ValidatorAlreadyExists');
    });

    it('Register validator returns an error - ClusterNotExists', async () => {
      await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
        helpers.DataGenerator.publicKey(0),
        clusterResult.clusterId.replace(/.$/,'0'),
        helpers.DataGenerator.shares(0),
      )).to.be.revertedWith('ClusterNotExists');
    });

    // ABOVE GAS LIMIT
    it('Register with 7 operators', async () => {
      // await helpers.registerValidators(0, 1, '10000', helpers.DataGenerator.cluster.new(7), [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER]);
    });
    */
});
