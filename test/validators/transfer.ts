import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, podResult1: any, podResult2: any;

describe('Transfer Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 12, '10');

    // Deposit into accounts
    await helpers.deposit([4], ['100000']);
    await helpers.deposit([5], ['100000']);

    // Register validators
    podResult1 = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    podResult2 = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Transfer validator emits ValidatorTransferred event', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      podResult1.validators[0].publicKey,
      helpers.DataGenerator.pod.new(),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    )).to.emit(ssvNetworkContract, 'ValidatorTransferred');
  });

  it('Transfer validator into a new pod', async () => {
    const transferedValidator = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      podResult1.validators[0].publicKey,
      helpers.DataGenerator.pod.new(),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    ), [GasGroup.TRANSFER_VALIDATOR_NEW_POD]);

    expect(podResult1.podId).not.equals(transferedValidator.eventsByName.ValidatorTransferred[0].args.podId);
  });

  it('Transfer validator to an existing pod', async () => {
    const transfredValidator1 = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      podResult1.validators[0].publicKey,
      helpers.DataGenerator.pod.byId(podResult2.podId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    ), [GasGroup.TRANSFER_VALIDATOR_EXISTED_POD]);
    expect(podResult2.podId).equals(transfredValidator1.eventsByName.ValidatorTransferred[0].args.podId);
  });

  it('Transfer validator to an existing cluster', async () => {
    const transfredValidator1 = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      podResult1.validators[0].publicKey,
      helpers.DataGenerator.pod.byId(podResult2.podId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    ), [GasGroup.TRANSFER_VALIDATOR_EXISTED_CLUSTER]);
    expect(podResult2.podId).equals(transfredValidator1.eventsByName.ValidatorTransferred[0].args.podId);
  });

  it('Transfer validator with an invalid owner', async () => {
    // Transfer validator with an invalid owner
    await expect(ssvNetworkContract.connect(helpers.DB.owners[5]).transferValidator(
      podResult1.validators[0].publicKey,
      helpers.DataGenerator.pod.byId(podResult2.podId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    )).to.be.revertedWith('ValidatorNotOwned');

    // Transfer validator with an invalid public key
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      helpers.DataGenerator.shares(0),
      helpers.DataGenerator.pod.byId(podResult2.podId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    )).to.be.revertedWith('ValidatorNotOwned');
  });

  it('Transfer validator to a pod with 7 operators', async () => {
    // Register validator with 7 operators
    const { podId } = await helpers.registerValidators(4, 1, '10000', [1, 2, 3, 4, 5, 6, 7]);

    // Transfer validator to an existing pod
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      podResult1.validators[0].publicKey,
      helpers.DataGenerator.pod.byId(podId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    )).to.emit(ssvNetworkContract, 'ValidatorTransferred');
  });

  // THIS NEEDS SOME PROPER ERROR MESSAGE
  it('Transfer validator with not enough amount', async () => {
    // Register validator
    const { podId } = await helpers.registerValidators(4, 1, '10000', [1, 2, 3, 9]);

    // Increase operator fee
    await ssvNetworkContract.connect(helpers.DB.owners[7]).updateOperatorFee(9, '100000')

    // Transfer to pod with not enough amount
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      podResult1.validators[0].publicKey,
      helpers.DataGenerator.pod.byId(podId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '1'
    )).to.be.revertedWith('account liquidatable');
  });

  // THIS NEEDS SOME PROPER ERROR MESSAGE
  it('Transfer validator with an invalid pod', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      podResult1.validators[0].publicKey,
      podResult2.validators[0].publicKey,
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '10000'
    )).to.be.revertedWith('InvalidPod');
  });

  // THIS NEEDS SOME PROPER ERROR MESSAGE
  it('Transfer validator with not enough balance', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).transferValidator(
      podResult1.validators[0].publicKey,
      helpers.DataGenerator.pod.byId(podResult2.podId),
      helpers.DataGenerator.shares(helpers.DB.validators.length),
      '100001'
    )).to.be.revertedWith('NotEnoughBalance');
  });

  // MAYBE WE WILL ADD SOME VALIDITY HERE?
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