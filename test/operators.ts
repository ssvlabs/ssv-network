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
    const pubKey = 'b2ccdebe84ff181bcb07f5d9a14bd5153bccee494cd4af587a7e3e814a8a6c9e7ede5efa493e47c9fe6491ed79ed2a6a';
    await contract.addOperator('stakefish', pubKey, '0xe52350A8335192905359c4c3C2149976dCC3D8bF'); 
    // Note that we need to use strings to compare the 256 bit integers
    expect((await contract.operatorCount()).toString()).to.equal('1');
  });

  // Test case
  it('Revert adding new operator with same pubkey', async function () {
    const pubKey = 'b2ccdebe84ff181bcb07f5d9a14bd5153bccee494cd4af587a7e3e814a8a6c9e7ede5efa493e47c9fe6491ed79ed2a6a';
    // Store new
    await contract.addOperator('stakefish', pubKey, '0xe52350A8335192905359c4c3C2149976dCC3D8bF');
    // Try to sttore with duplicated public key
    await expect(contract.addOperator('stakefishRenamed', pubKey, '0x8b3d89d1bdb347e194b220201507c43de971ee1e')).to.be.throw;
    // Note that we need to use strings to compare the 256 bit integers
    expect((await contract.operatorCount()).toString()).to.equal('1');
  });
});
