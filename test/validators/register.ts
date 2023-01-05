// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';

import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, minDepositAmount: any;

describe('Register Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 14, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 2) * helpers.CONFIG.minimalOperatorFee * 13;

    // cold register
    await helpers.DB.ssvToken.connect(helpers.DB.owners[6]).approve(helpers.DB.ssvNetwork.contract.address, '1000000000000000');
    await ssvNetworkContract.connect(helpers.DB.owners[6]).registerValidator(
      '0x221111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111119',
      [1,2,3,4],
      helpers.DataGenerator.shares(0),
      '1000000000000000',
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

  it('4 operators: Register 1 new validator gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
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

  it('4 operators: Register 2 validators in same cluster gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4],
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

    const args = eventsByName.ValidatorAdded[0].args;

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      args.cluster
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);
  });

  it('4 operators: Register 2 validators in same cluster and 1 validator in new cluster gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4],
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

    const args = eventsByName.ValidatorAdded[0].args;

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      args.cluster
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);

    await helpers.DB.ssvToken.connect(helpers.DB.owners[2]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[2]).registerValidator(
      helpers.DataGenerator.publicKey(4),
      [2,3,4,5],
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

  it('4 operators: Register 2 validators in same cluster with one time deposit gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, `${minDepositAmount*2}`);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4],
      helpers.DataGenerator.shares(0),
      `${minDepositAmount*2}`,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);

    const args = eventsByName.ValidatorAdded[0].args;
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4],
      helpers.DataGenerator.shares(0),
      0,
      args.cluster
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_WITHOUT_DEPOSIT]);
  });

  // 7 operators

  it('7 operators: Register 1 new validator gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      helpers.DataGenerator.cluster.new(7),
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
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]);
  });

  it('7 operators: Register 2 validators in same cluster gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4,5,6,7],
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
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]);

    const args = eventsByName.ValidatorAdded[0].args;

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4,5,6,7],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      args.cluster
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD_7]);
  });

  it('7 operators: Register 2 validators in same cluster and 1 validator in new cluster gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4,5,6,7],
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
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]);

    const args = eventsByName.ValidatorAdded[0].args;

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4,5,6,7],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      args.cluster
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD_7]);

    await helpers.DB.ssvToken.connect(helpers.DB.owners[2]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[2]).registerValidator(
      helpers.DataGenerator.publicKey(4),
      [2,3,4,5,6,7,8],
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
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]);
  });

  it('7 operators: Register 2 validators in same cluster with one time deposit gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, `${minDepositAmount*2}`);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4,5,6,7],
      helpers.DataGenerator.shares(0),
      `${minDepositAmount*2}`,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]);

    const args = eventsByName.ValidatorAdded[0].args;
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4,5,6,7],
      helpers.DataGenerator.shares(0),
      0,
      args.cluster
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_WITHOUT_DEPOSIT_7]);
  });

  // 13 operators

  it('13 operators: Register 1 new validator gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      helpers.DataGenerator.cluster.new(13),
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
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]);
  });

  it('13 operators: Register 2 validators in same cluster gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4,5,6,7,8,9,10,11,12,13],
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
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]);

    const args = eventsByName.ValidatorAdded[0].args;

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4,5,6,7,8,9,10,11,12,13],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      args.cluster
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD_13]);
  });

  it('13 operators: Register 2 validators in same cluster and 1 validator in new cluster gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4,5,6,7,8,9,10,11,12,13],
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
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]);

    const args = eventsByName.ValidatorAdded[0].args;

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4,5,6,7,8,9,10,11,12,13],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      args.cluster
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD_13]);

    await helpers.DB.ssvToken.connect(helpers.DB.owners[2]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[2]).registerValidator(
      helpers.DataGenerator.publicKey(4),
      [2,3,4,5,6,7,8,9,10,11,12,13,14],
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
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]);
  });

  it('13 operators: Register 2 validators in same cluster with one time deposit gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, `${minDepositAmount*2}`);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4,5,6,7,8,9,10,11,12,13],
      helpers.DataGenerator.shares(0),
      `${minDepositAmount*2}`,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]);

    const args = eventsByName.ValidatorAdded[0].args;
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4,5,6,7,8,9,10,11,12,13],
      helpers.DataGenerator.shares(0),
      0,
      args.cluster
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_WITHOUT_DEPOSIT_13]);
  });

  it('Register validator returns an error - IncorrectClusterState', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, `${minDepositAmount*2}`);
    await ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1, 2, 3, 4],
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

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(3),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 2,
        networkFee: 10,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    )).to.be.revertedWith('IncorrectClusterState');
  });

  it('Register validator returns an error - OperatorDoesNotExist', async () => {
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1, 2, 3, 25],
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
    )).to.be.revertedWith('OperatorDoesNotExist');
  });

  it('Register validator with removed operator returns an error - OperatorDoesNotExist', async () => {
    await ssvNetworkContract.removeOperator(1);
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1, 2, 3, 4],
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
    )).to.be.revertedWith('OperatorDoesNotExist');
  });

  it('Register validator emits ValidatorAdded event', async () => {
    await helpers.DB.ssvToken.approve(ssvNetworkContract.address, minDepositAmount);
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1, 2, 3, 4],
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
    )).to.emit(ssvNetworkContract, 'ValidatorAdded');
  });

  it('Register cluster returns an error - The operators list should be in ascending order', async () => {
    await expect(helpers.registerValidators(2, 1, minDepositAmount, [3, 2, 1, 4])).to.be.revertedWith('UnsortedOperatorsList');
  });

  it('Invalid operator amount reverts "InvalidOperatorIdsLengthuctureInvalid"', async () => {
    // 2 Operators
    await expect(helpers.registerValidators(2, 1, minDepositAmount, [1, 2])).to.be.revertedWith('InvalidOperatorIdsLengthuctureInvalid');

    // 6 Operators
    await expect(helpers.registerValidators(2, 1, minDepositAmount,  [1, 2, 3, 4, 5, 6])).to.be.revertedWith('InvalidOperatorIdsLengthuctureInvalid');

    // 14 Operators
    await expect(helpers.registerValidators(2, 1, minDepositAmount,  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])).to.be.revertedWith('InvalidOperatorIdsLengthuctureInvalid');
  });

  it('Register validator with an invalild public key reverts "InvalidPublicKeyLength"', async () => {
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.shares(0),
      [1, 2, 3, 4],
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
    )).to.be.revertedWith('InvalidPublicKeyLength');
  });

  it('Register validator returns an error - InsufficientBalance', async () => {
    await helpers.DB.ssvToken.approve(ssvNetworkContract.address, helpers.CONFIG.minimalOperatorFee);
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(0),
      helpers.CONFIG.minimalOperatorFee,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    )).to.be.revertedWith('InsufficientBalance');
  });

  it('Register validator returns an error - ValidatorAlreadyExists', async () => {
    await helpers.DB.ssvToken.approve(ssvNetworkContract.address, helpers.CONFIG.minimalOperatorFee);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[6]).registerValidator(
      '0x221111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111119',
      [1,2,3,4],
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
    )).to.be.revertedWith('ValidatorAlreadyExists');
  });

  it('Get cluster burn rate', async () => {
    expect(await ssvNetworkContract.getClusterBurnRate([1,2,3,4])).to.equal(helpers.CONFIG.minimalOperatorFee * 4);
  });

  it('Get cluster burn rate by not existed operator in the list', async () => {
    expect(await ssvNetworkContract.getClusterBurnRate([1,2,3,41])).to.equal(helpers.CONFIG.minimalOperatorFee * 3);
  });
});
