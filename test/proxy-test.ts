import { ethers, upgrades } from 'hardhat';
import { expect } from 'chai';

let Contract;
let contract;

describe('SSVNetwork (proxy)', function() {
  beforeEach(async function () {
    Contract = await ethers.getContractFactory('SSVNetwork');
    contract = await upgrades.deployProxy(Contract, [42], { initializer: 'store' });
  });
 
  // Test case
  it('retrieve returns a value previously initialized', async function () {
    // Test if the returned value is the same one
    // Note that we need to use strings to compare the 256 bit integers
    expect((await contract.retrieve()).toString()).to.equal('42');
  });
});
