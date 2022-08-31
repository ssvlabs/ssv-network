declare const ethers: any;

import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas } from '../helpers/gas-usage';

const numberOfOperators = 8;
const operatorFee = 4;

let registryContract: any, operatorIDs: any, shares: any, addr1: any, addr2: any;

describe('Register Validator Tests', () => {
  beforeEach(async () => {
    [addr1, addr2] = await ethers.getSigners();

    const contractData = await helpers.initializeContract(numberOfOperators, operatorFee);
    registryContract = contractData.contract;
    operatorIDs = contractData.operatorIDs;
    shares = contractData.shares;
  });

  it('Register validator in empty pod', async () => {
    const validatorPK = '0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100';
    const { gasUsed } = await trackGas(registryContract.registerValidator(
      `${validatorPK}0`,
      operatorIDs.slice(0, 4),
      shares[0],
      '10000'
    ));
    expect(gasUsed).lessThan(400000);
  });

  it('Register two validators with one owner in same pod', async () => {
    const validatorPK = '0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100';
    const firstValidator = await trackGas(registryContract.registerValidator(
      `${validatorPK}0`,
      operatorIDs.slice(0, 4),
      shares[0],
      '10000'
    ));
    expect(firstValidator.gasUsed).lessThan(400000);

    const secondValidator = await trackGas(registryContract.registerValidator(
      `${validatorPK}1`,
      operatorIDs.slice(0, 4),
      shares[0],
      '10000'
    ));
    expect(secondValidator.gasUsed).lessThan(220000);

  });

  it('Register two validators with different owners in same pod', async () => {
    const validatorPK = '0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100';
    const firstValidator = await trackGas(registryContract.connect(addr1).registerValidator(
      `${validatorPK}0`,
      operatorIDs.slice(0, 4),
      shares[0],
      '10000'
    ));
    expect(firstValidator.gasUsed).lessThan(400000);
    const secondValidator = await trackGas(registryContract.connect(addr2).registerValidator(
      `${validatorPK}1`,
      operatorIDs.slice(0, 4),
      shares[0],
      '10000'
    ));
    expect(secondValidator.gasUsed).lessThan(250000);
  });

  it('Register two validators in different pods', async () => {
    const validatorPK = '0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100';
    const firstValidator = await trackGas(registryContract.registerValidator(
      `${validatorPK}0`,
      operatorIDs.slice(0, 4),
      shares[0],
      '10000'
    ));
    expect(firstValidator.gasUsed).lessThan(400000);

    const secondValidator = await trackGas(registryContract.registerValidator(
      `${validatorPK}1`,
      operatorIDs.slice(4, 8),
      shares[0],
      '10000'
    ));
    expect(secondValidator.gasUsed).lessThan(400000);
  });
});
