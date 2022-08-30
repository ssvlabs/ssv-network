import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { runTx } from '../helpers/utils';

const numberOfOperators = 8;
const operatorFee = 4;

let registryContract: any, operatorIDs: any, shares: any, owner: any;

describe('Transfer Validator Tests', () => {
  beforeEach(async () => {
    const contractData = await helpers.initializeContract(numberOfOperators, operatorFee);
    registryContract = contractData.contract;
    operatorIDs = contractData.operatorIDs;
    shares = contractData.shares;
  });

  it('Transfer validator into new pod', async () => {
    const validatorPK = '0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100';
    const validatorBeforeTransfer = await runTx(registryContract.registerValidator(
      `${validatorPK}0`,
      operatorIDs.slice(0, 4),
      shares[0],
      '10000'
    ), 'ValidatorAdded', 'bytes validatorPK, bytes32 podId, bytes shares');

    const transferedValidator = await runTx(registryContract.transferValidator(
      `${validatorPK}0`,
      operatorIDs.slice(4, 8),
      shares[0],
      '10000'
    ), 'ValidatorTransferred', 'bytes publicKey, bytes32 podId, bytes shares');
    expect(transferedValidator.gasUsed).lessThan(410000);

    expect(validatorBeforeTransfer.data.podId).not.equals(transferedValidator.data.podId);
  });

  it('Transfer validator to existed pod', async () => {
    const validatorPK = '0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100';
    const validatorOne = await runTx(registryContract.registerValidator(
      `${validatorPK}0`,
      operatorIDs.slice(0, 4),
      shares[0],
      '10000'
    ), 'ValidatorAdded', 'bytes validatorPK, bytes32 podId, bytes shares');

    const validatorTwo = await runTx(registryContract.registerValidator(
      `${validatorPK}1`,
      operatorIDs.slice(4, 8),
      shares[0],
      '10000'
    ), 'ValidatorAdded', 'bytes validatorPK, bytes32 podId, bytes shares');

    const transferedValidator = await runTx(registryContract.transferValidator(
      `${validatorPK}0`,
      operatorIDs.slice(4, 8),
      shares[0],
      '10000'
    ), 'ValidatorTransferred', 'bytes publicKey, bytes32 podId, bytes shares');
    expect(transferedValidator.gasUsed).lessThan(270000);

    expect(validatorTwo.data.podId).equals(transferedValidator.data.podId);
  });

  it('Transfer Validator gas limits', async () => {

  });

});
