import { ethers, upgrades } from 'hardhat';
import { solidity } from 'ethereum-waffle';

import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { rawListeners } from 'process';

import { progressBlocks, progressTime, snapshot } from './utils';

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
let owner, account1, account2, account3;
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);
const tokens = '100000';

const DAY = 86400;
const YEAR = 365 * DAY;

describe('SSV Network', function() {
  before(async function () {
    [owner, account1, account2, account3] = await ethers.getSigners();
    const ssvTokenFactory = await ethers.getContractFactory('SSVToken');
    const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
    ssvToken = await ssvTokenFactory.deploy();
    ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
    await ssvToken.deployed();
    await ssvRegistry.deployed();
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease]);
    await ssvNetwork.deployed();
    await ssvToken.mint(account1.address, '1000000');

    // register operators
    await ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 10);
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 20);
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 30);
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 40);
    await ssvNetwork.connect(account3).registerOperator('testOperator 4', operatorsPub[4], 50);

    // register validators
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens);
    await ssvToken.connect(account1).transfer(account2.address, tokens);
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens);
  });

  it('operators getter', async function() {
    expect((await ssvNetwork.operators(operatorsPub[0])).map(v => v.toString())).to.eql(['testOperator 0', account2.address, operatorsPub[0], '0', 'true', '0']);
    expect((await ssvNetwork.operators(operatorsPub[1])).map(v => v.toString())).to.eql(['testOperator 1', account2.address, operatorsPub[1], '0', 'true', '1']);
    expect((await ssvNetwork.operators(operatorsPub[2])).map(v => v.toString())).to.eql(['testOperator 2', account3.address, operatorsPub[2], '0', 'true', '0']);
  });

  it('get operator current fee', async function() {
    expect(await ssvNetwork.getOperatorCurrentFee(operatorsPub[0])).to.equal(10);
    expect(await ssvNetwork.getOperatorCurrentFee(operatorsPub[1])).to.equal(20);
    expect(await ssvNetwork.getOperatorCurrentFee(operatorsPub[2])).to.equal(30);
  });

  it('balances should be correct after 100 blocks', async function() {
    await progressBlocks(100);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(90000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(3000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(7000);
  });

  it('withdraw', async function() {
    await progressBlocks(100);
    await ssvNetwork.connect(account1).withdraw('10000');
    await ssvNetwork.connect(account2).withdraw('1000');
    await ssvNetwork.connect(account3).withdraw('1000');
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(69700);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(5090);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(13210);
  });

  it('revert withdraw: not enough balance', async function() {
    await progressBlocks(100, async() => {
      await expect(ssvNetwork.connect(account1)
        .withdraw('80000'))
        .to.be.revertedWith('not enough balance');
      await expect(ssvNetwork.connect(account2)
        .withdraw('9000'))
        .to.be.revertedWith('not enough balance');
      await expect(ssvNetwork.connect(account3)
        .withdraw('25000'))
        .to.be.revertedWith('not enough balance');
    });
  });

  it('register same validator', async function() {
    await expect(ssvNetwork.connect(account2).registerValidator(validatorsPub[0], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens)).to.be.revertedWith('validator with same public key already exists');
  });

  it('register another validator', async function() {
    await progressBlocks(94);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(60200);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(7940);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(19860);
    await ssvToken.connect(account2).approve(ssvNetwork.address, tokens);
    await ssvNetwork.connect(account2).registerValidator(validatorsPub[1], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens);
    await progressBlocks(100);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(50000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(34000);
  });

  it('get operators by owner address', async function() {
    expect(await ssvNetwork.getOperatorsByOwnerAddress(account2.address)).to.eql([operatorsPub[0], operatorsPub[1]]);
  });

  it('get validators by owner address', async function() {
    expect(await ssvNetwork.getValidatorsByOwnerAddress(account1.address)).to.eql([validatorsPub[0]]);
  });

  it('withdraw all when burn rate is positive', async function() {
    await snapshot(async () => {
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(100);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(40);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(50000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104000);
      await expect(ssvNetwork.connect(account1).withdrawAll()).to.emit(ssvToken, 'Transfer').withArgs(ssvNetwork.address, account1.address, 49900);
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(0);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(70);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(0);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(103960);

      expect(await ssvNetwork.isOwnerValidatorsDisabled(account1.address)).to.equal(true);
      expect(await ssvToken.balanceOf(account1.address)).to.equal(859900);
      await ssvNetwork.connect(account1).registerValidator(validatorsPub[2], operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), 0);
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(0);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(70);
      await ssvNetwork.connect(account1).deleteValidator(validatorsPub[2]);
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(0);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(70);
      await ssvNetwork.connect(account1).registerValidator(validatorsPub[2], operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), 0);
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(0);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(70);
      await ssvNetwork.connect(account1).deactivateValidator(validatorsPub[2]);
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(0);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(70);
      await ssvNetwork.connect(account1).activateValidator(validatorsPub[2], 0);
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(0);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(70);
      await ssvNetwork.connect(account1).updateValidator(validatorsPub[2], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 0);
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(0);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(70);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(0);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(103540);

      await progressBlocks(100, async function() {
        expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(96540);

        await expect(ssvNetwork.connect(account1).enableAccount(0)).to.be.revertedWith('not enough balance');
        await ssvToken.connect(account1).approve(ssvNetwork.address, 50000);
        await ssvNetwork.connect(account1).enableAccount(50000);
        await expect(ssvNetwork.connect(account1).enableAccount(0)).to.be.revertedWith('account already enabled');

        expect(await ssvNetwork.burnRate(account1.address)).to.equal(200);
        expect(await ssvNetwork.burnRate(account2.address)).to.equal(10);

        await progressBlocks(50, async function() {
          expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(39800);
          expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(95820);
        });
      })
    });
  });

  it('withdraw all when burn rate is non-positive', async function() {
    await snapshot(async () => {
      await ssvNetwork.connect(account3).registerValidator(validatorsPub[2], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 0);
      expect(await ssvNetwork.burnRate(account3.address)).to.equal(0);
      await expect(ssvNetwork.connect(account3).withdrawAll()).to.emit(ssvToken, 'Transfer').withArgs(ssvNetwork.address, account3.address, 34250);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(0);
      expect(await ssvNetwork.isOwnerValidatorsDisabled(account3.address)).to.equal(false);
      expect(await ssvToken.balanceOf(account3.address)).to.equal(35250);
    });
  });

  it('delete a validator', async function() {
    await snapshot(async () => {
      await ssvNetwork.connect(account2).deleteValidator(validatorsPub[1]);
      await progressBlocks(99);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(40000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(106930);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(41070);
    });
  });

  it('update operator fee', async function() {
    await snapshot(async () => {
      await progressTime(4 * DAY);
      await ssvNetwork.connect(account3).updateOperatorFee(operatorsPub[3], "41");
      await progressBlocks(99);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(39801);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(99861);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(48338);
    });
  });

  it('deactivate a validator', async function() {
    await ssvNetwork.connect(account2).deactivateValidator(validatorsPub[1]);
    await progressBlocks(99);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(40000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(106930);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(41070);
  });

  it('activate a validator with deposit', async function() {
    await snapshot(async () => {
      await ssvToken.connect(account2).approve(ssvNetwork.address, 1000);
      await ssvNetwork.connect(account2).activateValidator(validatorsPub[1], 1000);
      await progressBlocks(10);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(38800);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(107590);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(42610);
    });
  });

  it('activate a validator', async function() {
    await ssvNetwork.connect(account2).activateValidator(validatorsPub[1], 0);
    await progressBlocks(10);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(38900);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(106560);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(42540);
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

    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(38200);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(106280);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(43520);
    await progressBlocks(10, async () => {
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(37200);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104680);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(46120);
      await ssvNetwork.connect(account2).deleteValidator(validatorsPub[2]);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(37100);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104520);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(46380);
      await progressBlocks(10);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(36100);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104120);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(47780);
      await ssvNetwork.connect(account3).deleteOperator(operatorsPub[4]);
      await progressBlocks(9);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(35100);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(103720);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(49180);
      expect((await ssvRegistry.operators(operatorsPub[4]))[1]).to.equal("0x0000000000000000000000000000000000000000");
    });
  });

  it('deactivate an operator', async function() {
    await progressBlocks(10, async () => {
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(37200);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104680);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(46120);
      await ssvNetwork.connect(account2).deactivateValidator(validatorsPub[2]);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(37100);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104520);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(46380);
      await progressBlocks(10);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(36100);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104120);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(47780);
      await ssvNetwork.connect(account3).deactivateOperator(operatorsPub[4]);
      await progressBlocks(9);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(35100);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(103720);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(49180);
      expect((await ssvRegistry.operators(operatorsPub[4]))[1]).to.equal(account3.address);
      expect((await ssvRegistry.operators(operatorsPub[4]))[4]).to.equal(false);
    });
  });

  it('operator max fee increase', async function() {
    await progressTime(4 * DAY);
    expect(await ssvNetwork.operatorMaxFeeIncrease()).to.equal(10);
    await expect(ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[0], 12)).to.be.revertedWith('fee exceeds increase limit');
    await expect(ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[1], 24)).to.be.revertedWith('fee exceeds increase limit');
    await ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[0], 11);
    expect(await ssvRegistry.getOperatorCurrentFee(operatorsPub[0])).to.equal(11);
    await ssvNetwork.updateOperatorMaxFeeIncrease(20);
    expect(await ssvNetwork.operatorMaxFeeIncrease()).to.equal(20);
    await expect(ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[1], 25)).to.be.revertedWith('fee exceeds increase limit');
    await ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[1], 24);
  });

  it('minimum blocks before liquidation', async function() {
    expect(await ssvNetwork.minimumBlocksBeforeLiquidation()).to.equal(50);
    await ssvNetwork.updateMinimumBlocksBeforeLiquidation(30);
    expect(await ssvNetwork.minimumBlocksBeforeLiquidation()).to.equal(30);
  });

  it('set network fee', async function() {
    expect(await ssvNetwork.networkFee()).to.equal('0');
    await expect(ssvNetwork.updateNetworkFee(1)).to.emit(ssvNetwork, 'NetworkFeeUpdated').withArgs('0', '1');
    expect(await ssvNetwork.networkFee()).to.equal('1');
    await progressBlocks(20);
    expect(await ssvNetwork.getNetworkTreasury()).to.equal(60);
  });

  it('withdraw network fees', async function() {
    await expect(ssvNetwork.connect(account2).withdrawNetworkFees(60)).to.be.revertedWith('Ownable: caller is not the owner');
    await expect(ssvNetwork.withdrawNetworkFees(80)).to.be.revertedWith('not enough balance');
    await expect(ssvNetwork.withdrawNetworkFees(60)).to.emit(ssvToken, 'Transfer').withArgs(ssvNetwork.address, owner.address, '60');
    expect(await ssvNetwork.getNetworkTreasury()).to.equal(9);
    await expect(ssvNetwork.withdrawNetworkFees(60)).to.be.revertedWith('not enough balance');
  });
});
