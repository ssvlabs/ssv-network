import { ethers, upgrades } from 'hardhat';
import { expect } from 'chai';

let Blox;
let blox;

describe('Blox (proxy)', function() {
  beforeEach(async function () {
    Blox = await ethers.getContractFactory('Blox');
    blox = await upgrades.deployProxy(Blox, [42], { initializer: 'store' });
  });
 
  // Test case
  it('retrieve returns a value previously initialized', async function () {
    // Test if the returned value is the same one
    // Note that we need to use strings to compare the 256 bit integers
    expect((await blox.retrieve()).toString()).to.equal('42');
  });
});
