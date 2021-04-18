import { ethers, upgrades } from 'hardhat';
import { expect } from 'chai';

let Blox;
let blox;
let BloxV2;
let bloxV2;

describe('BloxV2 (proxy)', function() {
  beforeEach(async function () {
    Blox = await ethers.getContractFactory('Blox');
    BloxV2 = await ethers.getContractFactory('BloxV2');

    blox = await upgrades.deployProxy(Blox, [42], { initializer: 'store' });
    bloxV2 = await upgrades.upgradeProxy(blox.address, BloxV2);
  });
 
  // Test case
  it('retrieve returns a value previously incremented', async function () {
    // Increment
    await bloxV2.increment();
 
    // Test if the returned value is the same one
    // Note that we need to use strings to compare the 256 bit integers
    expect((await bloxV2.retrieve()).toString()).to.equal('43');
  });
});
