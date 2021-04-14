import { ethers, upgrades } from 'hardhat';
import { expect } from 'chai';

describe('Greeter', function() {
  it('works', async function() {
    const Greeter = await ethers.getContractFactory('Greeter');
    const GreeterV2 = await ethers.getContractFactory('GreeterV2');

    const instance = await upgrades.deployProxy(Greeter, [42]);
    const upgraded = await upgrades.upgradeProxy(instance.address, GreeterV2);
    console.log(upgraded.provider);
    const value = await upgraded.value();
    expect(value.toString()).to.equal('42');
  });
});
