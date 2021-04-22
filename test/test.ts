import { ethers } from 'hardhat';
import { expect } from 'chai';
import * as chaiAsPromised from "chai-as-promised";

let Contract;
let contract;

describe('Operators', function() {
  beforeEach(async function () {
    Contract = await ethers.getContractFactory('SSVNetwork');
    contract = await Contract.deploy();
    await contract.deployed();
  });
 
  // Test case
  it('Add first operator', async function () {
    // Store a value
    await contract.addOperator('stakefish', '0x7d6d6C319b0dE2841bB0E564300D0dE4D8B0f403', '1000', '0xe52350A8335192905359c4c3C2149976dCC3D8bF'); 
    // Note that we need to use strings to compare the 256 bit integers
    expect((await contract.operatorCount()).toString()).to.equal('1');
  });

  // Test case
  it('Revert adding new operator with same pubkey', async function () {
    // Store new
    await contract.addOperator('stakefish', '0x7d6d6C319b0dE2841bB0E564300D0dE4D8B0f403', '1000', '0xe52350A8335192905359c4c3C2149976dCC3D8bF');
    // Try to sttore with duplicated public key
    await expect(contract.addOperator('stakefish', '0x7d6d6C319b0dE2841bB0E564300D0dE4D8B0f403', '10', '0x8b3d89d1bdb347e194b220201507c43de971ee1e')).to.be.throw;
    // Note that we need to use strings to compare the 256 bit integers
    expect((await contract.operatorCount()).toString()).to.equal('1');
  });
});
