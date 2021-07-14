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

const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345';
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765';

let ssvToken, ssvRegistry, ssvNetwork;
let owner, account1, account2, account3;
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);
const tokens = '10000';

const DAY = 86400;
const YEAR = 365 * DAY;

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

  it('withdraw', async function() {
    await progressBlocks(100);
    await ssvNetwork.connect(account1).withdraw('1000');
    await ssvNetwork.connect(account2).withdraw('100');
    await ssvNetwork.connect(account3).withdraw('100');
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(6970);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(509);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(1321);
  });

  it('revert withdraw: not enough balance', async function() {
    await progressBlocks(100, async() => {
      await expect(ssvNetwork.connect(account1)
        .withdraw('8000'))
        .to.be.revertedWith('not enough balance');
      await expect(ssvNetwork.connect(account2)
        .withdraw('900'))
        .to.be.revertedWith('not enough balance');
      await expect(ssvNetwork.connect(account3)
        .withdraw('2500'))
        .to.be.revertedWith('not enough balance');
    });
  });

  it('register another validator', async function() {
    await progressBlocks(95);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(6020);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(794);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(1986);
    await ssvToken.connect(account2).approve(ssvNetwork.address, tokens);
    await ssvNetwork.connect(account2).registerValidator(validatorsPub[1], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens);
    await progressBlocks(100);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(5000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(10400);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(3400);
  });

  it('delete a validator', async function() {
    await snapshot(async () => {
      await ssvNetwork.connect(account2).deleteValidator(validatorsPub[1]);
      await progressBlocks(99);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(4000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(10693);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(4107);
    });
  });

  it('update operator fee', async function() {
    await snapshot(async () => {
      await ssvNetwork.connect(account3).updateOperatorFee(operatorsPub[3], "1");
      await progressBlocks(99);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(4297);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(10297);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(4206);
    });
  });

  it('deactivate a validator', async function() {
    await ssvNetwork.connect(account2).deactivateValidator(validatorsPub[1]);
    await progressBlocks(99);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(4000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(10693);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(4107);
  });

  it('activate a validator', async function() {
    await ssvNetwork.connect(account2).activateValidator(validatorsPub[1]);
    await progressBlocks(10);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(3890);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(10656);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(4254);
  });

  it('delete a validator when overdue', async function() {
    await snapshot(async () => {
      await progressBlocks(1000);
      await expect(ssvNetwork.connect(account1).deleteValidator(validatorsPub[0])).to.be.revertedWith('negative balance');
    });
  });

  it('balance when overdue',  async function() {
    await snapshot(async () => {
      await progressBlocks(1000);
      await expect(ssvNetwork.totalBalanceOf(account1.address)).to.be.revertedWith('negative balance');
    });
  });

  it('update operator fee not from owner', async function() {
    await expect(ssvNetwork.connect(account1).updateOperatorFee(operatorsPub[3], 6)).to.be.revertedWith('caller is not operator owner');
  });

  it('deactivate an operator when has validators', async function() {
    await expect(ssvNetwork.connect(account3).deactivateOperator(operatorsPub[3])).to.be.revertedWith('operator has validators');
  });

  it('deactivate an operator', async function() {
    await ssvNetwork.connect(account3).deactivateOperator(operatorsPub[4]);
    expect((await ssvRegistry.operators(operatorsPub[4]))[4]).to.equal(false);
  });

  it('activate an operator', async function() {
    await ssvNetwork.connect(account3).activateOperator(operatorsPub[4]);
    expect((await ssvRegistry.operators(operatorsPub[4]))[4]).to.equal(true);
  });

  it('delete an operator not from owner', async function() {
    await expect(ssvNetwork.connect(account1).deleteOperator(operatorsPub[4])).to.be.revertedWith('caller is not operator owner');
  });

  it('delete an operator with validators', async function() {
    await expect(ssvNetwork.connect(account3).deleteOperator(operatorsPub[3])).to.be.revertedWith('operator has validators');
  });

  it('delete an operator', async function() {
    await ssvNetwork.connect(account2).registerValidator(validatorsPub[2], operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), 0);

    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(3820);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(10628);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(4352);
    await progressBlocks(10, async () => {
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(3720);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(10468);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(4612);
      await ssvNetwork.connect(account2).deleteValidator(validatorsPub[2]);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(3710);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(10452);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(4638);
      await progressBlocks(10);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(3610);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(10412);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(4778);
      await ssvNetwork.connect(account3).deleteOperator(operatorsPub[4]);
      await progressBlocks(9);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(3510);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(10372);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(4918);
      expect((await ssvRegistry.operators(operatorsPub[4]))[1]).to.equal("0x0000000000000000000000000000000000000000");
    });
  });

  it('deactive an operator', async function() {
    await progressBlocks(10, async () => {
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(3720);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(10468);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(4612);
      await ssvNetwork.connect(account2).deactivateValidator(validatorsPub[2]);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(3710);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(10452);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(4638);
      await progressBlocks(10);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(3610);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(10412);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(4778);
      await ssvNetwork.connect(account3).deactivateOperator(operatorsPub[4]);
      await progressBlocks(9);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(3510);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(10372);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(4918);
      expect((await ssvRegistry.operators(operatorsPub[4]))[1]).to.equal(account3.address);
      expect((await ssvRegistry.operators(operatorsPub[4]))[4]).to.equal(false);
    });
  });
});
