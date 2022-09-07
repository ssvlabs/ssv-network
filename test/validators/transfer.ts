import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any;

describe('Transfer Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 1, '10');
    await helpers.registerOperators(1, 1, '10');
    await helpers.registerOperators(2, 1, '10');
    await helpers.registerOperators(3, 1, '10');
    await helpers.registerOperators(4, 1, '10');
    await helpers.registerOperators(5, 1, '10');
    await helpers.registerOperators(6, 1, '10');
    await helpers.registerOperators(7, 1, '10');

    // Deposit into accounts
    await helpers.deposit([4], ['100000']);
    await helpers.deposit([5], ['100000']);
  });

  it('Transfer validator emits ValidatorTransferred event', async () => {
    // Register validator
    const { validators } = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());

    // Transfer validator to new pod
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      validators[0].publicKey,
      helpers.DataGenerator.pod.new(),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    )).to.emit(ssvNetworkContract, 'ValidatorTransferred');
  });

  it('Transfer validator into a new pod with gas tracking', async () => {
    // Register validator
    const { validators, podId } = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());

    // Transfer validator to new pod
    const transferedValidator = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      validators[0].publicKey,
      helpers.DataGenerator.pod.new(),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    ), [GasGroup.TRANSFER_VALIDATOR_NEW_POD]);

    expect(podId).not.equals(transferedValidator.eventsByName.ValidatorTransferred[0].args.podId);
  });

  it('Transfer validator to an existing pod with gas tracking', async () => {
    // Register validators
    const validator1 = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());
    const { podId } = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());

    // Transfer validator to an existing pod
    const transfredValidator1 = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      validator1.validators[0].publicKey,
      helpers.DataGenerator.pod.byId(podId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    ), [GasGroup.TRANSFER_VALIDATOR_EXISTED_POD]);

    expect(podId).equals(transfredValidator1.eventsByName.ValidatorTransferred[0].args.podId);
  });

  it('Transfer validator to an existing cluster with gas tracking', async () => {
    // Register validators
    const validator1 = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());
    const { podId } = await helpers.registerValidators(5, 1, '10000', helpers.DataGenerator.pod.new());

    // Transfer validator to an existing pod
    const transfredValidator1 = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      validator1.validators[0].publicKey,
      helpers.DataGenerator.pod.byId(podId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    ), [GasGroup.TRANSFER_VALIDATOR_EXISTED_CLUSTER]);

    expect(podId).equals(transfredValidator1.eventsByName.ValidatorTransferred[0].args.podId);
  });

  it('Transfer validator with an invalid owner', async () => {
    // Register validators
    const validator1 = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());
    const { podId } = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());

    // Transfer validator with an invalid owner
    await expect(ssvNetworkContract.connect(helpers.DB.owners[5]).transferValidator(
      validator1.validators[0].publicKey,
      helpers.DataGenerator.pod.byId(podId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    )).to.be.revertedWith('ValidatorNotOwned');

    // Transfer validator with an invalid public key
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      helpers.DataGenerator.shares(0),
      helpers.DataGenerator.pod.byId(podId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    )).to.be.revertedWith('ValidatorNotOwned');
  });

  it('Transfer validator to pod with 7 operators', async () => {
    // Register validators
    const { validators } = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());
    const { podId } = await helpers.registerValidators(4, 1, '10000', [1, 2, 3, 4, 5, 6, 7]);

    // Transfer validator to an existing pod
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      validators[0].publicKey,
      helpers.DataGenerator.pod.byId(podId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    )).to.emit(ssvNetworkContract, 'ValidatorTransferred');
  });

  // UPDATE ONCE LOGIC IS IMPLEMENTED
  // it('Transfer validator with not enough amount', async () => {
  //   // Register validators
  //   const validator1 = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());
  //   const { podId } = await helpers.registerValidators(4, 1, '10000', [1, 2, 3, 9]);

  //   // Increase operator fee
  //   await ssvNetworkContract.connect(helpers.DB.owners[8]).updateOperatorFee(9, '100000')

  //   // Transfer to pod with not enough amount
  //   await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
  //     validator1.validators[0].publicKey,
  //     helpers.DataGenerator.pod.byId(podId),
  //     helpers.DataGenerator.shares(helpers.DB.validators.length),
  //     '1'
  //   )).to.be.revertedWith('account liquidatable');
  // });

  // it('Transfer validator with an invalid pod', async () => {
  //   const validator1 = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());
  //   await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
  //     validator1.validators[0].publicKey,
  //     validator1.validators[0].publicKey,
  //     helpers.DataGenerator.shares(helpers.DB.validators.length),
  //     '10000'
  //   )).to.be.revertedWith('InvalidPod');
  // });

  // it('Transfer validator with not enough balance', async () => {
  //   const validator1 = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());
  //   const { podId } = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());
  //   await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
  //     validator1.validators[0].publicKey,
  //     helpers.DataGenerator.pod.byId(podId),
  //     helpers.DataGenerator.shares(helpers.DB.validators.length),
  //     '100001'
  //   )).to.be.revertedWith('NotEnoughBalance');
  // });

  // it('Transfer validator with an invalid share', async () => {
  //   await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());
  //   const { podId } = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());
  //   await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
  //     helpers.DataGenerator.publicKey(0),
  //     helpers.DataGenerator.pod.byId(podId),
  //     helpers.DataGenerator.shares(helpers.DB.validators.length),
  //     '10000'
  //   )).to.be.revertedWith('InvalidShares');
  // });
});
