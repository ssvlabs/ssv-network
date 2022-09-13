import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, podResult1: any, podResult2: any, podResult3: any;

describe('Bulk Transfer Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 12, '10');

    // Deposit into accounts
    await helpers.deposit([4], ['1000000']);
    await helpers.deposit([5], ['100000']);

    // Register validators
    podResult1 = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    podResult2 = await helpers.registerValidators(4, 9, '10000', helpers.DataGenerator.pod.byId(podResult1.podId), [GasGroup.REGISTER_VALIDATOR_EXISTED_POD]);
    podResult3 = await helpers.registerValidators(4, 1, '90000', helpers.DataGenerator.pod.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Bulk transfer 10 validators emits BulkValidatorTransferred event', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
      [podResult1.validators[0].publicKey, ...podResult2.validators.map((validator: any) => validator.publicKey)],
      podResult1.podId,
      podResult3.podId,
      Array(podResult2.validators.length).fill(helpers.DataGenerator.shares(0))
    )).to.emit(ssvNetworkContract, 'BulkValidatorTransferred');
  });

  it('Bulk transfer validator with an invalid owner', async () => {
    // Transfer validator with an invalid owner
    await expect(ssvNetworkContract.connect(helpers.DB.owners[5]).bulkTransferValidators(
      [podResult1.validators[0].publicKey, ...podResult2.validators.map((validator: any) => validator.publicKey)],
      podResult1.podId,
      podResult3.podId,
      Array(podResult2.validators.length).fill(helpers.DataGenerator.shares(0))
    )).to.be.revertedWith('ValidatorNotOwned');

    // Transfer validator with an unowned validator
    const account5Pod = await helpers.registerValidators(5, 1, '10000', helpers.DataGenerator.pod.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
      [podResult1.validators[0].publicKey, account5Pod.validators[0].publicKey, ...podResult2.validators.map((validator: any) => validator.publicKey)],
      podResult1.podId,
      podResult3.podId,
      Array(podResult2.validators.length + 1).fill(helpers.DataGenerator.shares(0))
    )).to.be.revertedWith('ValidatorNotOwned');

    // Transfer with an invalid public key
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
      [podResult1.validators[0].publicKey, helpers.DataGenerator.shares(0), ...podResult2.validators.map((validator: any) => validator.publicKey)],
      podResult1.podId,
      podResult3.podId,
      Array(podResult2.validators.length + 1).fill(helpers.DataGenerator.shares(0))
    )).to.be.revertedWith('ValidatorNotOwned');
  });

  // NEED TO MAKE NEW GAS GROUP FOR BULK TRANSFER
  it('Bulk transfer 10 validators', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
      [podResult1.validators[0].publicKey, ...podResult2.validators.map((validator: any) => validator.publicKey)],
      podResult1.podId,
      podResult3.podId,
      Array(podResult2.validators.length).fill(helpers.DataGenerator.shares(0))
    ), [GasGroup.TRANSFER_VALIDATOR_EXISTED_POD]);
  });

  // NEED TO MAKE NEW GAS GROUP FOR BULK TRANSFER
  it('Bulk transfer 10 validators to a pod with 7 operators', async () => {
    // Register validator with 7 operators
    const { podId } = await helpers.registerValidators(4, 1, '90000', [1, 2, 3, 4, 5, 6, 7]);

    // Transfer validator to an existing pod
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
      [podResult1.validators[0].publicKey, ...podResult2.validators.map((validator: any) => validator.publicKey)],
      podResult1.podId,
      podId,
      Array(podResult2.validators.length).fill(helpers.DataGenerator.shares(0))
    ), [GasGroup.TRANSFER_VALIDATOR_EXISTED_POD]);
  });

  // SHOULD GIVE ERROR OF MAYBE INVALID TO POD INSTEAD OF ACCOUNT LIQUIDATABLE
  it('Bulk transfer 10 validators to a non owned pod', async () => {
    // Register validator with 7 operators
    const { podId } = await helpers.registerValidators(5, 1, '90000', helpers.DataGenerator.pod.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);

    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
      [podResult1.validators[0].publicKey, ...podResult2.validators.map((validator: any) => validator.publicKey)],
      podResult1.podId,
      podId,
      Array(podResult2.validators.length).fill(helpers.DataGenerator.shares(0))
    )).to.be.revertedWith('InvalidPod');
  });

  // SHOULD GIVE ERROR OF MAYBE INVALID FROM POD
  it('Bulk transfer 10 validators to an invalid pod', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
      [podResult1.validators[0].publicKey, ...podResult2.validators.map((validator: any) => validator.publicKey)],
      podResult1.podId.slice(0, -1) + 'a',
      podResult1.podId,
      Array(podResult2.validators.length).fill(helpers.DataGenerator.shares(0))
    )).to.be.revertedWith('InvalidPod');
  });

  // SHOULD GIVE ERROR OF MAYBE VALIDATOR SHARE MISMATCH
  it('Validator and share length mismatch', async () => {
    // 10 validators and 11 shares
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
      [podResult1.validators[0].publicKey, ...podResult2.validators.map((validator: any) => validator.publicKey)],
      podResult1.podId,
      podResult3.podId,
      Array(podResult2.validators.length + 1).fill(helpers.DataGenerator.shares(0))
    )).to.be.revertedWith('ValidatorShareMismatch');

    // 9 validators and 10 shares
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).bulkTransferValidators(
      podResult2.validators.map((validator: any) => validator.publicKey),
      podResult1.podId,
      podResult3.podId,
      Array(podResult2.validators.length).fill(helpers.DataGenerator.shares(0))
    )).to.be.revertedWith('ValidatorShareMismatch');
  });

  // // NEED TO IMPLEMENT AN AMOUNT
  // it('Transfer validator with not enough amount', async () => {

  // });

  // // NEED TO IMPLEMENT AN AMOUNT
  // it('Transfer validator with not enough balance', async () => {

  // });
});