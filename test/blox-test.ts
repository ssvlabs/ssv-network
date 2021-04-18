import { ethers } from 'hardhat';
import { expect } from 'chai';

let Blox;
let blox;

describe('Blox', function() {
  beforeEach(async function () {
    Blox = await ethers.getContractFactory('Blox');
    blox = await Blox.deploy();
    await blox.deployed();
  });
 
  // Test case
  it('retrieve returns a value previously stored', async function () {
    // Store a value
    await blox.store(42);
 
    // Test if the returned value is the same one
    // Note that we need to use strings to compare the 256 bit integers
    expect((await blox.retrieve()).toString()).to.equal('42');
  });
});
