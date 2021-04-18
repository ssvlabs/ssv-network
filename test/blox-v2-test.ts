import { ethers } from 'hardhat';
import { expect } from 'chai';

let BloxV2;
let bloxV2;

describe('BloxV2', function() {
  beforeEach(async function () {
    BloxV2 = await ethers.getContractFactory('BloxV2');
    bloxV2 = await BloxV2.deploy();
    await bloxV2.deployed();
  });
 
  // Test case
  it('retrieve returns a value previously stored', async function () {
    // Store a value
    await bloxV2.store(42);
 
    // Test if the returned value is the same one
    // Note that we need to use strings to compare the 256 bit integers
    expect((await bloxV2.retrieve()).toString()).to.equal('42');
  });

  // Test case
  it('retrieve returns a value previously incremented', async function () {
    // Increment
    await bloxV2.increment();
 
    // Test if the returned value is the same one
    // Note that we need to use strings to compare the 256 bit integers
    expect((await bloxV2.retrieve()).toString()).to.equal('1');
  });
});
