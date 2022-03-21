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
const operatorMaxFeeIncrease = 10;

const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345';
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765';

let ssvToken, ssvRegistry, ssvNetwork;
let owner, account1, account2, account3, account4;
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1);
const tokens = '100000000';

const DAY = 86400;
const YEAR = 365 * DAY;

const setOperatorFeePeriod = 0;
const approveOperatorFeePeriod = DAY;
const validatorsPerOperatorLimit = 2000;

describe('SSV Network Liquidation', function() {
  before(async function () {
    [owner, account1, account2, account3, account4] = await ethers.getSigners();
    const ssvTokenFactory = await ethers.getContractFactory('SSVTokenMock');
    const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
    ssvToken = await ssvTokenFactory.deploy();
    ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
    await ssvToken.deployed();
    await ssvRegistry.deployed();
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease, setOperatorFeePeriod, approveOperatorFeePeriod, validatorsPerOperatorLimit]);
    await ssvNetwork.deployed();
    await ssvToken.mint(account1.address, '10000000000');

    // register operators
    await ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 10000);
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 20000);
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 30000);
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 40000);
    await ssvNetwork.connect(account3).registerOperator('testOperator 4', operatorsPub[4], 50000);

    // register validators
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens);
    await ssvToken.connect(account1).transfer(account2.address, tokens);
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens);
  });

  it('register liquidatable validator', async function() {
    await expect(ssvNetwork.connect(account2).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 0)).to.be.revertedWith("not enough balance");
  });

  it('balances should be correct after 100 blocks', async function() {
    await progressBlocks(99);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(90000000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(3000000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(7000000);
  });

  it('try to liquidate a valid account', async function() {
    await ssvNetwork.connect(account4).liquidate([account1.address]);
    expect(await ssvNetwork.isOwnerValidatorsDisabled(account1.address)).to.equal(false);
  });

  it('burn rate', async function() {
    expect(await ssvNetwork.burnRate(owner.address)).to.equal(0);
    expect(await ssvNetwork.burnRate(account1.address)).to.equal(100000);
    expect(await ssvNetwork.burnRate(account2.address)).to.equal(0);
    expect(await ssvNetwork.burnRate(account3.address)).to.equal(0);
  });

  it ('withdraw and get to liquidation status', async function() {
    await expect(ssvNetwork.connect(account1).withdraw(85000000)).to.be.revertedWith('not enough balance');
  });

  it('update to a liquidating state', async function() {
    await progressBlocks(847, async function () {
      expect(await ssvNetwork.liquidatable(account1.address)).to.equal(false);
      await expect(ssvNetwork.connect(account1).updateValidator(validatorsPub[0], operatorsIds.slice(1, 5), operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), 0)).to.be.revertedWith('not enough balance');
    });
  });

  it('update to a valid state using tokens', async function() {
    await progressBlocks(847, async function () {
      expect(await ssvNetwork.liquidatable(account1.address)).to.equal(false);
      await ssvToken.connect(account1).approve(ssvNetwork.address, tokens);
      const tx = ssvNetwork.connect(account1).updateValidator(validatorsPub[0], operatorsIds.slice(1, 5), operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), tokens);
      await expect(tx).to.emit(ssvRegistry, 'ValidatorRemoved');
      await expect(tx).to.emit(ssvRegistry, 'ValidatorAdded');
    });
  });

  /*
  it('activate validator in liquitable status', async function() {
    await snapshot(async function() {
      await ssvNetwork.connect(account1).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 0);
      // await ssvNetwork.connect(account1).deactivateValidator(validatorsPub[1]);
      await progressBlocks(800);
      expect(await ssvNetwork.liquidatable(account1.address)).to.equal(false);
      // await expect(ssvNetwork.connect(account1).activateValidator(validatorsPub[1], 0)).to.be.revertedWith('not enough balance');
      await ssvToken.connect(account1).approve(ssvNetwork.address, tokens);
      // await ssvNetwork.connect(account1).activateValidator(validatorsPub[1], tokens);
    });
  });
  */

  it('liquidate', async function() {
    await progressBlocks(847, async function () {
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(5100000);
      expect(await ssvNetwork.liquidatable(account1.address)).to.equal(false);
      await ssvNetwork.connect(account4).liquidate([account1.address]);
      expect(await ssvNetwork.isOwnerValidatorsDisabled(account1.address)).to.equal(false);
      await progressBlocks(1);
      expect(await ssvNetwork.liquidatable(account1.address)).to.equal(true);
      expect(await ssvToken.balanceOf(account4.address)).to.equal(0);
      await ssvNetwork.connect(account4).liquidate([account1.address]);
      expect(await ssvNetwork.liquidatable(account1.address)).to.equal(false);
      await ssvNetwork.connect(account4).liquidate([account1.address]);
      expect(await ssvNetwork.isOwnerValidatorsDisabled(account1.address)).to.equal(true);
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(0);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(0);
      expect(await ssvNetwork.totalBalanceOf(account4.address)).to.equal(0);
      expect(await ssvToken.balanceOf(account4.address)).to.equal(4800000);
    });
  });

  it('liquidate multiple accounts', async function() {
    await progressBlocks(847, async function () {
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(5100000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(28470000);
      expect(await ssvNetwork.totalBalanceOf(account4.address)).to.equal(0);
      expect(await ssvToken.balanceOf(account4.address)).to.equal(0);
      await ssvNetwork.connect(account4).liquidate([account1.address, account2.address]);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(5000000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(28500000);
      expect(await ssvNetwork.totalBalanceOf(account4.address)).to.equal(0);
      await ssvNetwork.connect(account4).liquidate([account1.address, account2.address]);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(0);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(28530000);
      expect(await ssvNetwork.totalBalanceOf(account4.address)).to.equal(0);
      expect(await ssvToken.balanceOf(account4.address)).to.equal(4900000);
    });
  });
});
