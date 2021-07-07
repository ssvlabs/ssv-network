import { ethers, upgrades } from 'hardhat';
import { solidity } from 'ethereum-waffle';

import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { rawListeners } from 'process';

declare var network: any;

before(() => {
  chai.should();
  chai.use(chaiAsPromised);
});

const { expect } = chai;

const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345';
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765';

let ssvToken, ssvRegistry, ssvNetwork;
let owner, account1, account2, account3;
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);

const DAY = 86400;
const YEAR = 365 * DAY;

async function snapshot(time, func) {
  const snapshot = await network.provider.send("evm_snapshot");
  await network.provider.send("evm_increaseTime", [time]);
  await network.provider.send("evm_mine", []);
  await func();
  await network.provider.send("evm_revert", [snapshot]);
}

async function progressBlocks(blocks) {
  for (let i = 0; i < blocks; ++i) {
    await network.provider.send("evm_mine", []);
  }
}

describe('SSV Network', function() {
  before(async function () {
    [owner, account1, account2, account3] = await ethers.getSigners();
    const ssvTokenFactory = await ethers.getContractFactory('SSVToken');
    const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
    ssvToken = await upgrades.deployProxy(ssvTokenFactory, []);
    ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
    await ssvToken.deployed();
    await ssvRegistry.deployed();
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address]);
    await ssvNetwork.deployed();
    await ssvToken.mint(account1.address, '1000000');

    // register operators
    await ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 1);
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 2);
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 3);
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 4);
    await ssvNetwork.connect(account3).registerOperator('testOperator 4', operatorsPub[4], 5);

    // register validators
    const tokens = '10000';
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens);
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens);
  });

  it('balances should be correct after 1 day', async function() {
    await progressBlocks(100);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(9000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(300);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(700);
  });

  it('withdraw', async function() {
    await progressBlocks(100);
    await ssvNetwork.connect(account1).withdraw('1000');
  });

  it('revert withdraw: not enough balance', async function() {
    await progressBlocks(100);
    await ssvNetwork.connect(account1)
      .withdraw('10000')
      .should.eventually.be.rejectedWith('not enough balance');;
  });
});
