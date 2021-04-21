import { ethers } from 'hardhat';
import { expect } from 'chai';

let ContractV2;
let contractV2;

describe('SSVNetworkV2', function() {
  beforeEach(async function () {
    ContractV2 = await ethers.getContractFactory('SSVNetworkV2');
    contractV2 = await ContractV2.deploy();
    await contractV2.deployed();
  });
 
  // Test case
  it('retrieve returns a value previously stored', async function () {
    // Store a value
    await contractV2.store(42);
 
    // Test if the returned value is the same one
    // Note that we need to use strings to compare the 256 bit integers
    expect((await contractV2.retrieve()).toString()).to.equal('42');
  });

  // Test case
  it('retrieve returns a value previously incremented', async function () {
    // Increment
    await contractV2.increment();
 
    // Test if the returned value is the same one
    // Note that we need to use strings to compare the 256 bit integers
    expect((await contractV2.retrieve()).toString()).to.equal('1');
  });
});
