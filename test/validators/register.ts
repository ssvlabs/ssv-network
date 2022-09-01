declare const ethers: any;

import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

const numberOfOperators = 8;
const operatorFee = 4;

let registryContract: any, operatorIDs: any, shares: any, addr1: any, addr2: any;

describe('Register Validator Tests', () => {
  beforeEach(async () => {
    const contractData = await helpers.initializeContract();
    registryContract = contractData.contract;
    await helpers.registerOperators(0, 1, '10');
    await helpers.registerOperators(1, 1, '10');
    await helpers.registerOperators(2, 1, '10');
    await helpers.registerOperators(3, 1, '10');

    await helpers.deposit([4], ['100000']);
    await helpers.deposit([5], ['100000']);
  });

  it('Register validator in empty pod', async () => {
    await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Register two validators same owner in same pod', async () => {
    const result = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.byId(result.podId));
  });

  it('Register two validators with different owners with same cluster', async () => {
    const result = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await helpers.registerValidators(5, 1, '10000', helpers.DataGenerator.pod.byId(result.podId));
  });

  // it('Register two validators same owner in different clusters', async () => {
  //   const validatorPK = '0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100';
  //   const firstValidator = await trackGas(registryContract.registerValidator(
  //     `${validatorPK}0`,
  //     operatorIDs.slice(0, 4),
  //     shares[0],
  //     '10000'
  //   ));
  //   expect(firstValidator.gasUsed).lessThan(400000);

  //   const secondValidator = await trackGas(registryContract.registerValidator(
  //     `${validatorPK}1`,
  //     operatorIDs.slice(4, 8),
  //     shares[0],
  //     '10000'
  //   ));
  //   expect(secondValidator.gasUsed).lessThan(400000);
  // });

  // it('Register two validators different owners in different clusters', async () => {
  //   const validatorPK = '0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100';
  //   const firstValidator = await trackGas(registryContract.connect(addr1).registerValidator(
  //     `${validatorPK}0`,
  //     operatorIDs.slice(0, 4),
  //     shares[0],
  //     '10000'
  //   ));
  //   expect(firstValidator.gasUsed).lessThan(400000);

  //   const secondValidator = await trackGas(registryContract.connect(addr2).registerValidator(
  //     `${validatorPK}1`,
  //     operatorIDs.slice(4, 8),
  //     shares[0],
  //     '10000'
  //   ));
  //   expect(secondValidator.gasUsed).lessThan(400000);
  // });
});
