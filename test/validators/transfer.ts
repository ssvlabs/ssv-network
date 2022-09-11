declare const ethers: any;

import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any;
let minDepositAmount: any;

describe('Transfer Validator Tests', () => {
  beforeEach(async () => {
    ssvNetworkContract = (await helpers.initializeContract()).contract;
    await helpers.registerOperators(0, 1, helpers.CONFIG.minimalOperatorFee);
    await helpers.registerOperators(1, 1, helpers.CONFIG.minimalOperatorFee);
    await helpers.registerOperators(2, 1, helpers.CONFIG.minimalOperatorFee);
    await helpers.registerOperators(3, 1, helpers.CONFIG.minimalOperatorFee);
    await helpers.registerOperators(4, 1, helpers.CONFIG.minimalOperatorFee);
    await helpers.registerOperators(5, 1, helpers.CONFIG.minimalOperatorFee);
    await helpers.registerOperators(6, 1, helpers.CONFIG.minimalOperatorFee);
    await helpers.registerOperators(7, 1, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = helpers.CONFIG.minimalBlocksBeforeLiquidation * helpers.CONFIG.minimalOperatorFee * helpers.CONFIG.minimalOperatorFee * 4;

    await helpers.deposit([4], [`${minDepositAmount*3}`]);
    await helpers.deposit([5], [minDepositAmount]);
  });

  it('Transfer validator emits ValidatorTransferred event', async () => {
    const { validators } = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.pod.new());

    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      validators[0].publicKey,
      helpers.DataGenerator.pod.new(),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      minDepositAmount
    )).to.emit(ssvNetworkContract, 'ValidatorTransferred');
  });

  it('Transfer validator into new pod track gas', async () => {
    const { validators, podId } = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.pod.new());

    const transferedValidator = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      validators[0].publicKey,
      helpers.DataGenerator.pod.new(),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      minDepositAmount
    ), [GasGroup.TRANSFER_VALIDATOR_NEW_POD]);

    expect(podId).not.equals(transferedValidator.eventsByName.ValidatorTransferred[0].args.podId);
  });

  it('Transfer validator to existed pod track gas', async () => {
    const validator1 = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.pod.new());
    const { podId } = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.pod.new());
    const transfredValidator1 = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      validator1.validators[0].publicKey,
      helpers.DataGenerator.pod.byId(podId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      minDepositAmount
    ), [GasGroup.TRANSFER_VALIDATOR_EXISTED_POD]);

    expect(podId).equals(transfredValidator1.eventsByName.ValidatorTransferred[0].args.podId);
  });

  it('Transfer validator to existed cluster track gas', async () => {
    const validator1 = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.pod.new());
    const { podId } = await helpers.registerValidators(5, 1, minDepositAmount, helpers.DataGenerator.pod.new());
    const transfredValidator1 = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      validator1.validators[0].publicKey,
      helpers.DataGenerator.pod.byId(podId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      minDepositAmount
    ), [GasGroup.TRANSFER_VALIDATOR_EXISTED_CLUSTER]);

    expect(podId).equals(transfredValidator1.eventsByName.ValidatorTransferred[0].args.podId);
  });

  it('Fails to transfer validator with no owner', async () => {
    const validator1 = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.pod.new());
    const { podId } = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.pod.new());
    await expect(ssvNetworkContract.connect(helpers.DB.owners[5]).transferValidator(
      validator1.validators[0].publicKey,
      helpers.DataGenerator.pod.byId(podId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      minDepositAmount
    )).to.be.revertedWith('ValidatorNotOwned');
  });
});
