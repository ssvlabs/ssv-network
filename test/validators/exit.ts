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

import { expect } from 'chai';

// Declare globals
let ssvNetwork: any, ssvToken: any, minDepositAmount: BigInt, firstCluster: any;

describe('Exit Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvToken = metadata.ssvToken;

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

  it('Exiting a validator emits "ValidatorExited"', async () => {
    await assertEvent(
      ssvNetwork.write.exitValidator([DataGenerator.publicKey(1), firstCluster.operatorIds], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'ValidatorExited',
          argNames: ['owner', 'operatorIds', 'publicKey'],
          argValuesList: [[owners[1].account.address, firstCluster.operatorIds, DataGenerator.publicKey(1)]],
        },
      ],
    );
  });

  it('Exiting a validator gas limit', async () => {
    await trackGas(
      ssvNetwork.write.exitValidator([DataGenerator.publicKey(1), firstCluster.operatorIds], {
        account: owners[1].account,
      }),
      [GasGroup.VALIDATOR_EXIT],
    );
  });

  it('Exiting one of the validators in a cluster emits "ValidatorExited"', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], {
      account: owners[1].account,
    });

    await ssvNetwork.write.registerValidator(
      [
        DataGenerator.publicKey(2),
        DEFAULT_OPERATOR_IDS[4],
        await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[4]),
        minDepositAmount,
        firstCluster.cluster,
      ],
      {
        account: owners[1].account,
      },
    );

    await assertEvent(
      ssvNetwork.write.exitValidator([DataGenerator.publicKey(2), firstCluster.operatorIds], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'ValidatorExited',
          argNames: ['owner', 'operatorIds', 'publicKey'],
          argValuesList: [[owners[1].account.address, firstCluster.operatorIds, DataGenerator.publicKey(2)]],
        },
      ],
    );
  });

  it('Exiting a removed validator reverts "IncorrectValidatorStateWithData"', async () => {
    await ssvNetwork.write.removeValidator(
      [DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster],
      {
        account: owners[1].account,
      },
    );

    await expect(
      ssvNetwork.write.exitValidator([DataGenerator.publicKey(1), firstCluster.operatorIds], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('IncorrectValidatorStateWithData', DataGenerator.publicKey(1));
  });

  it('Exiting a non-existing validator reverts "IncorrectValidatorStateWithData"', async () => {
    await expect(
      ssvNetwork.write.exitValidator([DataGenerator.publicKey(12), firstCluster.operatorIds], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('IncorrectValidatorStateWithData', DataGenerator.publicKey(12));
  });

  it('Exiting a validator with empty operator list reverts "IncorrectValidatorStateWithData"', async () => {
    await expect(
      ssvNetwork.write.exitValidator([DataGenerator.publicKey(1), []], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('IncorrectValidatorStateWithData', DataGenerator.publicKey(1));
  });

  it('Exiting a validator with empty public key reverts "IncorrectValidatorStateWithData"', async () => {
    await expect(
      ssvNetwork.write.exitValidator(['0x', firstCluster.operatorIds], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('IncorrectValidatorStateWithData', '0x');
  });

  it('Exiting a validator using the wrong account reverts "IncorrectValidatorStateWithData"', async () => {
    await expect(
      ssvNetwork.write.exitValidator([DataGenerator.publicKey(1), firstCluster.operatorIds], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('IncorrectValidatorStateWithData', DataGenerator.publicKey(1));
  });

  it('Exiting a validator with incorrect operators (unsorted list) reverts with "IncorrectValidatorStateWithData"', async () => {
    await expect(
      ssvNetwork.write.exitValidator([DataGenerator.publicKey(1), [4, 3, 2, 1]], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('IncorrectValidatorStateWithData', DataGenerator.publicKey(1));
  });

  it('Exiting a validator with incorrect operators (too many operators) reverts with "IncorrectValidatorState"', async () => {
    minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 10n) * CONFIG.minimalOperatorFee * 13n;

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], {
      account: owners[2].account,
    });

    const register = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[13],
          await DataGenerator.shares(2, 2, DEFAULT_OPERATOR_IDS[13]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0,
            active: true,
          },
        ],
        {
          account: owners[2].account,
        },
      ),
    );
    const secondCluster = register.eventsByName.ValidatorAdded[0].args;

    await assertEvent(
      ssvNetwork.write.exitValidator([DataGenerator.publicKey(2), secondCluster.operatorIds], {
        account: owners[2].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'ValidatorExited',
          argNames: ['owner', 'operatorIds', 'publicKey'],
          argValuesList: [[owners[2].account.address, secondCluster.operatorIds, DataGenerator.publicKey(2)]],
        },
      ],
    );
  });

  it('Exiting a validator with incorrect operators reverts with "IncorrectValidatorStateWithData"', async () => {
    await expect(
      ssvNetwork.write.exitValidator([DataGenerator.publicKey(1), [1, 2, 3, 5]], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('IncorrectValidatorStateWithData', DataGenerator.publicKey(1));
  });

  it('Bulk exiting a validator emits "ValidatorExited"', async () => {
    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await assertEvent(
      ssvNetwork.write.bulkExitValidator([pks, args.operatorIds], {
        account: owners[2].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'ValidatorExited',
        },
      ],
    );
  });

  it('Bulk exiting 10 validator (4 operators cluster) gas limit', async () => {
    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await trackGas(
      ssvNetwork.write.bulkExitValidator([pks, args.operatorIds], {
        account: owners[2].account,
      }),
      [GasGroup.BULK_EXIT_10_VALIDATOR_4],
    );
  });

  it('Bulk exiting 10 validator (7 operators cluster) gas limit', async () => {
    minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 10n) * CONFIG.minimalOperatorFee * 7n;

    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[7], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await trackGas(
      ssvNetwork.write.bulkExitValidator([pks, args.operatorIds], {
        account: owners[2].account,
      }),
      [GasGroup.BULK_EXIT_10_VALIDATOR_7],
    );
  });

  it('Bulk exiting 10 validator (10 operators cluster) gas limit', async () => {
    minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 10n) * CONFIG.minimalOperatorFee * 10n;

    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[10], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await trackGas(
      ssvNetwork.write.bulkExitValidator([pks, args.operatorIds], {
        account: owners[2].account,
      }),
      [GasGroup.BULK_EXIT_10_VALIDATOR_10],
    );
  });

  it('Bulk exiting 10 validator (13 operators cluster) gas limit', async () => {
    minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 10n) * CONFIG.minimalOperatorFee * 13n;

    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[13], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await trackGas(
      ssvNetwork.write.bulkExitValidator([pks, args.operatorIds], {
        account: owners[2].account,
      }),
      [GasGroup.BULK_EXIT_10_VALIDATOR_13],
    );
  });

  it('Bulk exiting removed validators reverts "IncorrectValidatorStateWithData"', async () => {
    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await trackGas(
      ssvNetwork.write.bulkRemoveValidator([pks.slice(0, 5), args.operatorIds, args.cluster], {
        account: owners[2].account,
      }),
    );

    await expect(
      ssvNetwork.write.bulkExitValidator([pks.slice(0, 5), args.operatorIds], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('IncorrectValidatorStateWithData', pks[0]);
  });

  it('Bulk exiting non-existing validators reverts "IncorrectValidatorStateWithData"', async () => {
    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    pks[4] = '0xabcd1234';

    await expect(
      ssvNetwork.write.bulkExitValidator([pks, args.operatorIds], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('IncorrectValidatorStateWithData', pks[4]);
  });

  it('Bulk exiting validators with empty operator list reverts "IncorrectValidatorStateWithData"', async () => {
    const { pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await expect(
      ssvNetwork.write.bulkExitValidator([pks, []], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('IncorrectValidatorStateWithData', pks[0]);
  });

  it('Bulk exiting validators with empty public key reverts "ValidatorDoesNotExist"', async () => {
    const { args } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await expect(
      ssvNetwork.write.bulkExitValidator([[], args.operatorIds], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('ValidatorDoesNotExist');
  });

  it('Bulk exiting validators using the wrong account reverts "IncorrectValidatorStateWithData"', async () => {
    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await expect(
      ssvNetwork.write.bulkExitValidator([pks, args.operatorIds], {
        account: owners[3].account,
      }),
    ).to.be.rejectedWith('IncorrectValidatorStateWithData', pks[0]);
  });

  it('Bulk exiting validators with incorrect operators (unsorted list) reverts with "IncorrectValidatorStateWithData"', async () => {
    const { args, pks } = await bulkRegisterValidators(2, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await expect(
      ssvNetwork.write.bulkExitValidator([pks, [4, 3, 2, 1]], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith(ssvNetwork, 'IncorrectValidatorStateWithData', pks[0]);
  });
});
