import { ethers, upgrades } from 'hardhat';
import { expect } from 'chai';

let Contract;
let contract;

const validatorsPerOperatorLimit = 2000;

describe('SSVRegistry (proxy)', function() {
  beforeEach(async function () {
    Contract = await ethers.getContractFactory('SSVRegistry');
    contract = await upgrades.deployProxy(Contract, [validatorsPerOperatorLimit]);
  });
 
  // Test case
  it('retrieve returns a value previously initialized', async function () {
    // Note that we need to use strings to compare the 256 bit integers
    expect((await contract.activeValidatorCount).toString());
  });
});
