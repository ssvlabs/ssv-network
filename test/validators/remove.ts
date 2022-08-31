declare const ethers: any;

import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas } from '../helpers/gas-usage';

const numberOfOperators = 4;
const operatorFee = 4;

let registryContract: any, operatorIDs: any, shares: any, addr1: any, addr2: any;

describe('Remove Validator Tests', () => {
  beforeEach(async () => {
    [addr1, addr2] = await ethers.getSigners();

    const contractData = await helpers.initializeContract(numberOfOperators, operatorFee);
    registryContract = contractData.contract;
    operatorIDs = contractData.operatorIDs;
    shares = contractData.shares;
  });

  it('Remove validator', async () => {
    const validatorPK = '0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100';
    await trackGas(registryContract.registerValidator(
      `${validatorPK}0`,
      operatorIDs.slice(0, 4),
      shares[0],
      '10000'
    ));

    const { gasUsed } = await trackGas(registryContract.removeValidator(`${validatorPK}0`));
    expect(gasUsed).lessThan(150000);
  });

  it('Fails to transfer validator with no owner', async () => {
    const validatorPK = '0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100';
    await trackGas(registryContract.registerValidator(
      `${validatorPK}0`,
      operatorIDs.slice(0, 4),
      shares[0],
      '10000'
    ));

    await expect(trackGas(registryContract.connect(addr2).removeValidator(`${validatorPK}0`))).to.be.revertedWith('ValidatorNotOwned');
  });
});
