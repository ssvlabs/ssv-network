// Declare imports
import {
  owners,
  initializeContract,
  registerOperators,
  coldRegisterValidator,
  bulkRegisterValidators,
  DataGenerator,
  CONFIG,
  DEFAULT_OPERATOR_IDS,
} from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';
import { trackGas, GasGroup } from '../helpers/gas-usage';

import { mine } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';

// Declare globals
let ssvNetwork: any, minDepositAmount: BigInt, firstCluster: Cluster;

describe('Remove Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;

    minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 10n) * CONFIG.minimalOperatorFee * 4n;

    // Register operators
    await registerOperators(0, 14, CONFIG.minimalOperatorFee);

    // Register a validator
    // cold register
    await coldRegisterValidator();

    firstCluster = (
      await bulkRegisterValidators(1, 1, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      })
    ).args;
  });

  it('Remove validator emits "ValidatorRemoved"', async () => {
    await assertEvent(
      ssvNetwork.write.removeValidator([DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'ValidatorRemoved',
        },
      ],
    );
  });

  it('Bulk remove validator emits "ValidatorRemoved"', async () => {
    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await assertEvent(
      ssvNetwork.write.bulkRemoveValidator([pks, args.operatorIds, args.cluster], {
        account: owners[2].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'ValidatorRemoved',
        },
      ],
    );
  });

  it('Remove validator after cluster liquidation period emits "ValidatorRemoved"', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation + 10);

    await assertEvent(
      ssvNetwork.write.bulkRemoveValidator(
        [[DataGenerator.publicKey(1)], firstCluster.operatorIds, firstCluster.cluster],
        {
          account: owners[1].account,
        },
      ),
      [
        {
          contract: ssvNetwork,
          eventName: 'ValidatorRemoved',
        },
      ],
    );
  });

  it('Remove validator gas limit (4 operators cluster)', async () => {
    await trackGas(
      ssvNetwork.write.removeValidator([DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster], {
        account: owners[1].account,
      }),
      [GasGroup.REMOVE_VALIDATOR],
    );
  });

  it('Bulk remove 10 validator gas limit (4 operators cluster)', async () => {
    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await trackGas(
      ssvNetwork.write.bulkRemoveValidator([pks, args.operatorIds, args.cluster], {
        account: owners[2].account,
      }),
      [GasGroup.BULK_REMOVE_10_VALIDATOR_4],
    );
  });

  it('Remove validator gas limit (7 operators cluster)', async () => {
    const { args } = await bulkRegisterValidators(1, 1, DEFAULT_OPERATOR_IDS[7], minDepositAmount * 2n, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await trackGas(
      ssvNetwork.write.removeValidator([DataGenerator.publicKey(2), args.operatorIds, args.cluster], {
        account: owners[1].account,
      }),
      [GasGroup.REMOVE_VALIDATOR_7],
    );
  });

  it('Bulk remove 10 validator gas limit (7 operators cluster)', async () => {
    minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 10n) * (CONFIG.minimalOperatorFee * 7n);

    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[7], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await trackGas(
      ssvNetwork.write.bulkRemoveValidator([pks, args.operatorIds, args.cluster], {
        account: owners[2].account,
      }),
      [GasGroup.BULK_REMOVE_10_VALIDATOR_7],
    );
  });

  it('Remove validator gas limit (10 operators cluster)', async () => {
    const { args } = await bulkRegisterValidators(1, 2, DEFAULT_OPERATOR_IDS[10], minDepositAmount * 3n, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await trackGas(
      ssvNetwork.write.removeValidator([DataGenerator.publicKey(2), args.operatorIds, args.cluster], {
        account: owners[1].account,
      }),
      [GasGroup.REMOVE_VALIDATOR_10],
    );
  });

  it('Bulk remove 10 validator gas limit (10 operators cluster)', async () => {
    minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 10n) * (CONFIG.minimalOperatorFee * 10n);

    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[10], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await trackGas(
      ssvNetwork.write.bulkRemoveValidator([pks, args.operatorIds, args.cluster], {
        account: owners[2].account,
      }),
      [GasGroup.BULK_REMOVE_10_VALIDATOR_10],
    );
  });

  it('Remove validator gas limit (13 operators cluster)', async () => {
    const { args } = await bulkRegisterValidators(1, 2, DEFAULT_OPERATOR_IDS[13], minDepositAmount * 4n, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await trackGas(
      ssvNetwork.write.removeValidator([DataGenerator.publicKey(2), args.operatorIds, args.cluster], {
        account: owners[1].account,
      }),
      [GasGroup.REMOVE_VALIDATOR_13],
    );
  });

  it('Bulk remove 10 validator gas limit (13 operators cluster)', async () => {
    minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 10n) * (CONFIG.minimalOperatorFee * 13n);

    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[13], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await trackGas(
      ssvNetwork.write.bulkRemoveValidator([pks, args.operatorIds, args.cluster], {
        account: owners[2].account,
      }),
      [GasGroup.BULK_REMOVE_10_VALIDATOR_13],
    );
  });

  it('Remove validator with a removed operator in the cluster', async () => {
    await trackGas(ssvNetwork.write.removeOperator([1]), [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]);
    await trackGas(
      ssvNetwork.write.removeValidator([DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster], {
        account: owners[1].account,
      }),
      [GasGroup.REMOVE_VALIDATOR],
    );
  });

  it('Register a removed validator and remove the same validator again', async () => {
    // Remove validator
    const remove = await trackGas(
      ssvNetwork.write.removeValidator([DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster], {
        account: owners[1].account,
      }),
      [GasGroup.REMOVE_VALIDATOR],
    );
    const updatedCluster = remove.eventsByName.ValidatorRemoved[0].args;

    // Re-register validator
    const newRegister = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          updatedCluster.operatorIds,
          await DataGenerator.shares(1, 1, updatedCluster.operatorIds),
          0,
          updatedCluster.cluster,
        ],
        {
          account: owners[1].account,
        },
      ),
      [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER],
    );
    const afterRegisterCluster = newRegister.eventsByName.ValidatorAdded[0].args;

    // Remove the validator again
    await trackGas(
      ssvNetwork.write.removeValidator(
        [DataGenerator.publicKey(1), afterRegisterCluster.operatorIds, afterRegisterCluster.cluster],
        {
          account: owners[1].account,
        },
      ),
      [GasGroup.REMOVE_VALIDATOR],
    );
  });

  it('Remove validator from a liquidated cluster', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
      [GasGroup.LIQUIDATE_CLUSTER_4],
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    await trackGas(
      ssvNetwork.write.removeValidator(
        [DataGenerator.publicKey(1), updatedCluster.operatorIds, updatedCluster.cluster],
        {
          account: owners[1].account,
        },
      ),
      [GasGroup.REMOVE_VALIDATOR],
    );
  });

  it('Remove validator with an invalid owner reverts "ClusterDoesNotExists"', async () => {
    await expect(
      ssvNetwork.write.removeValidator([DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('ClusterDoesNotExists');
  });

  it('Remove validator with an invalid operator setup reverts "ClusterDoesNotExists"', async () => {
    await expect(
      ssvNetwork.write.removeValidator([DataGenerator.publicKey(1), [1, 2, 3, 5], firstCluster.cluster], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('ClusterDoesNotExists');
  });

  it('Remove the same validator twice reverts "ValidatorDoesNotExist"', async () => {
    // Remove validator
    const result = await trackGas(
      ssvNetwork.write.removeValidator([DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster], {
        account: owners[1].account,
      }),
      [GasGroup.REMOVE_VALIDATOR],
    );

    const removed = result.eventsByName.ValidatorRemoved[0].args;

    // Remove validator again
    await expect(
      ssvNetwork.write.removeValidator([DataGenerator.publicKey(1), removed.operatorIds, removed.cluster], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('ValidatorDoesNotExist');
  });

  it('Remove the same validator with wrong input parameters reverts "IncorrectClusterState"', async () => {
    // Remove validator
    await trackGas(
      ssvNetwork.write.removeValidator([DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster], {
        account: owners[1].account,
      }),
      [GasGroup.REMOVE_VALIDATOR],
    );

    // Remove validator again
    await expect(
      ssvNetwork.write.removeValidator([DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('IncorrectClusterState');
  });

  it('Bulk Remove validator that does not exist in a valid cluster reverts "IncorrectValidatorStateWithData"', async () => {
    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    pks[2] = '0xabcd1234';

    await expect(
      ssvNetwork.write.bulkRemoveValidator([pks, args.operatorIds, args.cluster], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('IncorrectValidatorStateWithData', pks[2]);
  });

  it('Bulk remove validator with an invalid operator setup reverts "ClusterDoesNotExists"', async () => {
    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await expect(
      ssvNetwork.write.bulkRemoveValidator([pks, [1, 2, 3, 5], args.cluster], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('ClusterDoesNotExists');
  });

  it('Bulk Remove the same validator twice reverts "IncorrectValidatorStateWithData"', async () => {
    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    const result = await trackGas(
      ssvNetwork.write.bulkRemoveValidator([pks, args.operatorIds, args.cluster], {
        account: owners[2].account,
      }),
    );

    const removed = result.eventsByName.ValidatorRemoved[0].args;

    // Remove validator again
    await expect(
      ssvNetwork.write.bulkRemoveValidator([pks, removed.operatorIds, removed.cluster], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('IncorrectValidatorStateWithData', pks[0]);
  });

  it('Remove validators from a liquidated cluster', async () => {
    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await mine(CONFIG.minimalBlocksBeforeLiquidation - 2);

    let result = await trackGas(
      ssvNetwork.write.liquidate([args.owner, args.operatorIds, args.cluster], {
        account: owners[1].account,
      }),
    );

    const liquidated = result.eventsByName.ClusterLiquidated[0].args;

    result = await trackGas(
      ssvNetwork.write.bulkRemoveValidator([pks.slice(0, 5), liquidated.operatorIds, liquidated.cluster], {
        account: owners[2].account,
      }),
    );

    const removed = result.eventsByName.ValidatorRemoved[0].args;

    expect(removed.cluster.validatorCount).to.equal(5);
    expect(removed.cluster.networkFeeIndex).to.equal(0);
    expect(removed.cluster.index).to.equal(0);
    expect(removed.cluster.active).to.equal(false);
    expect(removed.cluster.balance).to.equal(0);
  });

  it('Bulk remove 10 validator with duplicated public keys reverts "IncorrectValidatorStateWithData"', async () => {
    minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 10n) * (CONFIG.minimalOperatorFee * 13n);

    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    const keys = [pks[0], pks[1], pks[2], pks[3], pks[2], pks[5], pks[2], pks[7], pks[2], pks[8]];

    await expect(
      ssvNetwork.write.bulkRemoveValidator([keys, args.operatorIds, args.cluster], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('IncorrectValidatorStateWithData', pks[2]);
  });

  it('Bulk remove 10 validator with empty public keys reverts "IncorrectValidatorStateWithData"', async () => {
    await expect(
      ssvNetwork.write.bulkRemoveValidator([[], firstCluster.operatorIds, firstCluster.cluster], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('ValidatorDoesNotExist');
  });
});
