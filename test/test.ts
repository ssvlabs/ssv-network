import { ethers } from 'hardhat';
import { expect } from 'chai';

let Contract;
let contract;

describe('SSVNetworkV', function() {
  beforeEach(async function () {
    Contract = await ethers.getContractFactory('SSVNetwork');
    contract = await Contract.deploy();
    await contract.deployed();
  });
 
  // Test case
  it('retrieve returns a value total operators', async function () {
    // Store a value
    await contract.addOperator('stakefish', '0x7d6d6C319b0dE2841bB0E564300D0dE4D8B0f403', '1000', '0xe52350A8335192905359c4c3C2149976dCC3D8bF'); 
    // Note that we need to use strings to compare the 256 bit integers
    expect((await contract.operatorCount()).toString()).to.equal('1');
  });
});
