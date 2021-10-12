import { ethers, upgrades } from 'hardhat';
import { solidity } from 'ethereum-waffle';

import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { rawListeners } from 'process';

import { progressBlocks, snapshot } from './utils';

declare var network: any;

before(() => {
  chai.should();
  chai.use(chaiAsPromised);
});

const { expect } = chai;

const minimumBlocksBeforeLiquidation = 50;

const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345';
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765';

let ssvToken, ssvRegistry, ssvNetwork;
let owner, account1, account2, account3, account4;
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);
const tokens = '10000';

const DAY = 86400;
const YEAR = 365 * DAY;

describe('SSV Network Liquidation', function() {
  before(async function () {
    [owner, account1, account2, account3, account4] = await ethers.getSigners();
    const ssvTokenFactory = await ethers.getContractFactory('SSVToken');
    const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
    ssvToken = await ssvTokenFactory.deploy();
    ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
    await ssvToken.deployed();
    await ssvRegistry.deployed();
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation]);
    await ssvNetwork.deployed();
    await ssvToken.mint(account1.address, '1000000');

    // register operators
    await ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 1);
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 2);
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 3);
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 4);
    await ssvNetwork.connect(account3).registerOperator('testOperator 4', operatorsPub[4], 5);

    // register validators
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens);
    await ssvToken.connect(account1).transfer(account2.address, tokens);
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens);
  });

  it('balances should be correct after 100 blocks', async function() {
    await progressBlocks(100);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(9000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(300);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(700);
  });

  it('try to liquidate a valid account', async function() {
    await expect(ssvNetwork.connect(account4).liquidate(account1.address)).to.be.revertedWith('owner is not liquidatable');
  });

  it('burn rate', async function() {
    expect(await ssvNetwork.burnRate(owner.address)).to.equal(0);
    expect(await ssvNetwork.burnRate(account1.address)).to.equal(10);
    expect(await ssvNetwork.burnRate(account2.address)).to.equal(0);
    expect(await ssvNetwork.burnRate(account3.address)).to.equal(0);
  });

  it('liquidate', async function() {
    await progressBlocks(848);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(510);
    await expect(ssvNetwork.connect(account4).liquidate(account1.address)).to.be.revertedWith('owner is not liquidatable');
    await ssvNetwork.connect(account4).liquidate(account1.address);
    await expect(ssvNetwork.connect(account4).liquidate(account1.address)).to.be.revertedWith('owner is not liquidatable');
    expect(await ssvNetwork.burnRate(account1.address)).to.equal(0);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(0);
    expect(await ssvNetwork.totalBalanceOf(account4.address)).to.equal(490);
  });
});
