declare const ethers: any;

import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas } from '../helpers/gas-usage';

const numberOfOperators = 8;
const operatorFee = 4;

let registryContract: any, operatorIDs: any, shares: any, addr1: any, addr2: any;

describe('Transfer Validator Tests', () => {
  beforeEach(async () => {
    [addr1, addr2] = await ethers.getSigners();

    const contractData = await helpers.initializeContract(numberOfOperators, operatorFee);
    registryContract = contractData.contract;
    operatorIDs = contractData.operatorIDs;
    shares = contractData.shares;
  });

  it('Transfer validator into new pod', async () => {
    const validatorPK = '0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100';
    const validatorBeforeTransfer = await trackGas(registryContract.registerValidator(
      `${validatorPK}0`,
      operatorIDs.slice(0, 4),
      shares[0],
      '10000'
    ));

    const transferedValidator = await trackGas(registryContract.transferValidator(
      `${validatorPK}0`,
      operatorIDs.slice(4, 8),
      shares[0],
      '10000'
    ));
    expect(transferedValidator.gasUsed).lessThan(410000);

    expect(validatorBeforeTransfer.eventsByName.ValidatorAdded[0].args.podId).not.equals(transferedValidator.eventsByName.ValidatorTransferred[0].args.podId);
  });

  it('Transfer validator to existed pod', async () => {
    const validatorPK = '0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100';
    const validatorOne = await trackGas(registryContract.registerValidator(
      `${validatorPK}0`,
      operatorIDs.slice(0, 4),
      shares[0],
      '10000'
    ));

    const validatorTwo = await trackGas(registryContract.registerValidator(
      `${validatorPK}1`,
      operatorIDs.slice(4, 8),
      shares[0],
      '10000'
    ));

    const transferedValidator = await trackGas(registryContract.transferValidator(
      `${validatorPK}0`,
      operatorIDs.slice(4, 8),
      shares[0],
      '10000'
    ));
    expect(transferedValidator.gasUsed).lessThan(270000);

    expect(validatorTwo.eventsByName.ValidatorAdded[0].args.podId).equals(transferedValidator.eventsByName.ValidatorTransferred[0].args.podId);
  });

  it('Fails to transfer validator with no owner', async () => {
    const validatorPK = '0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100';
    await trackGas(registryContract.registerValidator(
      `${validatorPK}0`,
      operatorIDs.slice(0, 4),
      shares[0],
      '10000'
    ));

    await expect(trackGas(registryContract.connect(addr2).transferValidator(
      `${validatorPK}0`,
      operatorIDs.slice(4, 8),
      shares[0],
      '10000'
    ))).to.be.revertedWith('ValidatorNotOwned');
  });
});
