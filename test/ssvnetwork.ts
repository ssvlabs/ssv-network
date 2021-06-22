import { ethers, upgrades } from 'hardhat';
import { solidity } from 'ethereum-waffle';

import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { rawListeners } from 'process';

before(() => {
  chai.should();
  chai.use(chaiAsPromised);
});

const { expect } = chai;

let ssvNetwork, ssvRegister;
let account2;

describe('SSVNetwork', function() {
  beforeEach(async function () {
    [account2] = await ethers.getSigners();
    const ssvRegisterFactory = await ethers.getContractFactory('SSVRegister');
    ssvRegister = await ssvRegisterFactory.deploy();
    await ssvRegister.deployed();

    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
    ssvNetwork = await upgrades.deployProxy(
      ssvNetworkFactory,
      [ssvRegister.address],
      { initializer: 'initialize' }
    );
    await ssvNetwork.deployed();
  });

  it('Update operator fee', async function () {
    const fee = '10';
    await ssvNetwork.updateOperatorFee(account2.address, fee);
    const blockNumber = await ethers.provider.getBlockNumber();
    expect((await ssvRegister.getOperatorFee(account2.address, `${blockNumber}`)).toString()).to.equal(fee);
  });

  it('Update operator balance', async function () {
    // set fee for operator
    await ssvNetwork.updateOperatorFee(account2.address, '10');

    await ssvNetwork.updateBalance(account2.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [Date.now() + 86400]);
    await ethers.provider.send('evm_mine', []);
    await ssvNetwork.updateBalance(account2.address);

    await ethers.provider.send('evm_setNextBlockTimestamp', [Date.now() + 86400]);
    await ethers.provider.send('evm_mine', []);
    await ssvNetwork.updateBalance(account2.address);

    await ethers.provider.send('evm_setNextBlockTimestamp', [Date.now() + 86400]);
    await ethers.provider.send('evm_mine', []);
    await ssvNetwork.updateBalance(account2.address);
  });

});