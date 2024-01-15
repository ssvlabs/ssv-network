// Decalre imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

// Declare globals
let ssvNetworkContract: any, minDepositAmount: any, firstCluster: any;

describe('Remove Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await helpers.initializeContract();
    ssvNetworkContract = metadata.contract;

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 10) * helpers.CONFIG.minimalOperatorFee * 4;

    // Register operators
    await helpers.registerOperators(0, 14, helpers.CONFIG.minimalOperatorFee);

    // Register a validator
    // cold register
    await helpers.coldRegisterValidator();

    // first validator
    const cluster = await helpers.registerValidators(
      1,
      minDepositAmount,
      [1],
      helpers.DEFAULT_OPERATOR_IDS[4],
      helpers.getClusterForValidator(0, 0, 0, 0, true),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE],
    );

    firstCluster = cluster.args;
  });

  it('Remove validator emits "ValidatorRemoved"', async () => {
    await expect(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .removeValidator(helpers.DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster),
    ).to.emit(ssvNetworkContract, 'ValidatorRemoved');
  });

  it('Bulk remove validator emits "ValidatorRemoved"', async () => {
    const { args, pks } = await helpers.bulkRegisterValidators(
      2,
      10,
      helpers.DEFAULT_OPERATOR_IDS[4],
      minDepositAmount,
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        active: true,
      },
    );

    await expect(
      ssvNetworkContract
        .connect(helpers.DB.owners[2])
        .bulkRemoveValidator(pks, args.operatorIds, args.cluster),
    ).to.emit(ssvNetworkContract, 'ValidatorRemoved');
  });

  it('Remove validator after cluster liquidation period emits "ValidatorRemoved"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation + 10);

    await expect(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .removeValidator(helpers.DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster),
    ).to.emit(ssvNetworkContract, 'ValidatorRemoved');
  });

  it('Remove validator gas limit (4 operators cluster)', async () => {
    await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .removeValidator(helpers.DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster),
      [GasGroup.REMOVE_VALIDATOR],
    );
  });

  it('Bulk remove 10 validator gas limit (4 operators cluster)', async () => {
    const { args, pks } = await helpers.bulkRegisterValidators(
      2,
      10,
      helpers.DEFAULT_OPERATOR_IDS[4],
      minDepositAmount,
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        active: true,
      },
    );

    await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[2])
        .bulkRemoveValidator(pks, args.operatorIds, args.cluster),
      [GasGroup.BULK_REMOVE_10_VALIDATOR_4],
    );
  });

  it('Remove validator gas limit (7 operators cluster)', async () => {
    const cluster = await helpers.registerValidators(
      1,
      (minDepositAmount * 2).toString(),
      [2],
      helpers.DEFAULT_OPERATOR_IDS[7],
      helpers.getClusterForValidator(0, 0, 0, 0, true),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7],
    );
    firstCluster = cluster.args;

    await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .removeValidator(helpers.DataGenerator.publicKey(2), firstCluster.operatorIds, firstCluster.cluster),
      [GasGroup.REMOVE_VALIDATOR_7],
    );
  });

  it('Bulk remove 10 validator gas limit (7 operators cluster)', async () => {
    const { args, pks } = await helpers.bulkRegisterValidators(
      2,
      10,
      helpers.DEFAULT_OPERATOR_IDS[7],
      minDepositAmount,
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        active: true,
      },
    );

    await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[2])
        .bulkRemoveValidator(pks, args.operatorIds, args.cluster),
      [GasGroup.BULK_REMOVE_10_VALIDATOR_7],
    );
  });

  it('Remove validator gas limit (10 operators cluster)', async () => {
    const cluster = await helpers.registerValidators(
      1,
      (minDepositAmount * 3).toString(),
      [2],
      helpers.DEFAULT_OPERATOR_IDS[10],
      helpers.getClusterForValidator(0, 0, 0, 0, true),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_10],
    );
    firstCluster = cluster.args;

    await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .removeValidator(helpers.DataGenerator.publicKey(2), firstCluster.operatorIds, firstCluster.cluster),
      [GasGroup.REMOVE_VALIDATOR_10],
    );
  });

  it('Bulk remove 10 validator gas limit (10 operators cluster)', async () => {
    const { args, pks } = await helpers.bulkRegisterValidators(
      2,
      10,
      helpers.DEFAULT_OPERATOR_IDS[10],
      minDepositAmount,
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        active: true,
      },
    );

    await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[2])
        .bulkRemoveValidator(pks, args.operatorIds, args.cluster),
      [GasGroup.BULK_REMOVE_10_VALIDATOR_10],
    );
  });

  it('Remove validator gas limit (13 operators cluster)', async () => {
    const cluster = await helpers.registerValidators(
      1,
      (minDepositAmount * 4).toString(),
      [2],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
      helpers.getClusterForValidator(0, 0, 0, 0, true),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13],
    );
    firstCluster = cluster.args;

    await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .removeValidator(helpers.DataGenerator.publicKey(2), firstCluster.operatorIds, firstCluster.cluster),
      [GasGroup.REMOVE_VALIDATOR_13],
    );
  });

  it('Bulk remove 10 validator gas limit (13 operators cluster)', async () => {
    const { args, pks } = await helpers.bulkRegisterValidators(
      2,
      10,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
      minDepositAmount,
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        active: true,
      },
    );

    await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[2])
        .bulkRemoveValidator(pks, args.operatorIds, args.cluster),
      [GasGroup.BULK_REMOVE_10_VALIDATOR_13],
    );
  });

  it('Remove validator with a removed operator in the cluster', async () => {
    await trackGas(ssvNetworkContract.removeOperator(1), [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]);
    await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .removeValidator(helpers.DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster),
      [GasGroup.REMOVE_VALIDATOR],
    );
  });

  it('Register a removed validator and remove the same validator again', async () => {
    // Remove validator
    const remove = await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .removeValidator(helpers.DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster),
      [GasGroup.REMOVE_VALIDATOR],
    );
    const updatedCluster = remove.eventsByName.ValidatorRemoved[0].args;

    // Re-register validator
    const newRegister = await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .registerValidator(
          helpers.DataGenerator.publicKey(1),
          updatedCluster.operatorIds,
          helpers.DataGenerator.shares(1, 1, 4),
          0,
          updatedCluster.cluster,
        ),
      [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER],
    );
    const afterRegisterCluster = newRegister.eventsByName.ValidatorAdded[0].args;

    // Remove the validator again
    await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .removeValidator(
          helpers.DataGenerator.publicKey(1),
          afterRegisterCluster.operatorIds,
          afterRegisterCluster.cluster,
        ),
      [GasGroup.REMOVE_VALIDATOR],
    );
  });

  it('Remove validator from a liquidated cluster', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetworkContract.liquidate(firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster),
      [GasGroup.LIQUIDATE_CLUSTER_4],
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .removeValidator(helpers.DataGenerator.publicKey(1), updatedCluster.operatorIds, updatedCluster.cluster),
      [GasGroup.REMOVE_VALIDATOR],
    );
  });

  it('Remove validator with an invalid owner reverts "ValidatorDoesNotExist"', async () => {
    await expect(
      ssvNetworkContract
        .connect(helpers.DB.owners[2])
        .removeValidator(helpers.DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster),
    ).to.be.revertedWithCustomError(ssvNetworkContract, 'ValidatorDoesNotExist');
  });

  it('Remove validator with an invalid operator setup reverts "IncorrectValidatorState"', async () => {
    await expect(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .removeValidator(helpers.DataGenerator.publicKey(1), [1, 2, 3, 5], firstCluster.cluster),
    ).to.be.revertedWithCustomError(ssvNetworkContract, 'IncorrectValidatorState');
  });

  it('Remove the same validator twice reverts "ValidatorDoesNotExist"', async () => {
    // Remove validator
    await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .removeValidator(helpers.DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster),
      [GasGroup.REMOVE_VALIDATOR],
    );

    // Remove validator again
    await expect(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .removeValidator(helpers.DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster),
    ).to.be.revertedWithCustomError(ssvNetworkContract, 'ValidatorDoesNotExist');
  });
});
