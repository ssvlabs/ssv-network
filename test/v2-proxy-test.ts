import { ethers, upgrades } from 'hardhat';
import { expect } from 'chai';

let Contract;
let contract;
let ContractV2;
let contractV2;

describe('SSVNetworkV2 (proxy)', function() {
  beforeEach(async function () {
    Contract = await ethers.getContractFactory('SSVNetwork');
    ContractV2 = await ethers.getContractFactory('SSVNetworkV2');

    contract = await upgrades.deployProxy(Contract, [42], { initializer: 'store' });
    contractV2 = await upgrades.upgradeProxy(contract.address, ContractV2);
  });
 
  // Test case
  it('retrieve returns a value previously incremented', async function () {
    // Increment
    await contractV2.increment();
 
    // Test if the returned value is the same one
    // Note that we need to use strings to compare the 256 bit integers
    expect((await contractV2.retrieve()).toString()).to.equal('43');
  });
});
