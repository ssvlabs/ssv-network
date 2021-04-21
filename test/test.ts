import { ethers } from 'hardhat';
import { expect } from 'chai';

let Contract;
let contract;

describe('SSVNetwork', function() {
  beforeEach(async function () {
    Contract = await ethers.getContractFactory('SSVNetwork');
    contract = await Contract.deploy();
    await contract.deployed();
  });
 
  // Test case
  it('retrieve returns a value previously stored', async function () {
    // Store a value
    await contract.store(42);
 
    // Test if the returned value is the same one
    // Note that we need to use strings to compare the 256 bit integers
    expect((await contract.retrieve()).toString()).to.equal('42');
  });
});
