import { ethers, upgrades } from 'hardhat';
import { solidity } from 'ethereum-waffle';

import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { rawListeners } from 'process';

import { progressBlocks, progressTime, snapshot } from '../helpers/utils';

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

//@ts-ignore
let ssvToken: any, ssvRegistry: any, ssvNetwork: any, utils: any;
//@ts-ignore
let owner: any, account1: any, account2: any, account3: any, account4: any;

const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1);
const tokens = '100000000';

const DAY = 86400;
const YEAR = 365 * DAY;

const setOperatorFeePeriod = 0;
const approveOperatorFeePeriod = DAY;
const validatorsPerOperatorLimit = 2000;

describe('SSV Network', function() {
  before(async function () {
    [owner, account1, account2, account3] = await ethers.getSigners();
    const utilsFactory = await ethers.getContractFactory('Utils');
    const ssvTokenFactory = await ethers.getContractFactory('SSVTokenMock');
    const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');

    utils = await utilsFactory.deploy();
    ssvToken = await ssvTokenFactory.deploy();
    ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
    await ssvToken.deployed();
    await ssvRegistry.deployed();
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease, setOperatorFeePeriod, approveOperatorFeePeriod, validatorsPerOperatorLimit]);
    await ssvNetwork.deployed();
    await ssvToken.mint(account1.address, '1000000000');

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

  it('operator limit', async function() {
    await snapshot(async () => {
      expect(await ssvNetwork.validatorsPerOperatorCount(operatorsIds[0])).to.equal(1);
      expect(await ssvNetwork.getValidatorsPerOperatorLimit()).to.equal(2000);
      await ssvNetwork.connect(account1).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 0);
      await ssvNetwork.setValidatorsPerOperatorLimit(1);
      expect(await ssvNetwork.getValidatorsPerOperatorLimit()).to.equal(1);
      await expect(ssvNetwork.connect(account1).registerValidator(validatorsPub[2], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 0)).to.be.revertedWith('exceed validator limit');
      await expect(ssvNetwork.connect(account1).updateValidator(validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 0)).to.be.revertedWith('exceed validator limit');
    });
  });

  it('operators getter', async function() {
    expect((await ssvNetwork.operators(operatorsIds[0])).map((v: any) => v.toString())).to.eql(['testOperator 0', account2.address, operatorsPub[0], '0', 'true']);
    expect((await ssvNetwork.operators(operatorsIds[1])).map((v: any) => v.toString())).to.eql(['testOperator 1', account2.address, operatorsPub[1], '0', 'true']);
    expect((await ssvNetwork.operators(operatorsIds[2])).map((v: any) => v.toString())).to.eql(['testOperator 2', account3.address, operatorsPub[2], '0', 'true']);
  });

  it('get operator current fee', async function() {
    expect(await ssvNetwork.getOperatorCurrentFee(operatorsIds[0])).to.equal(10000);
    expect(await ssvNetwork.getOperatorCurrentFee(operatorsIds[1])).to.equal(20000);
    expect(await ssvNetwork.getOperatorCurrentFee(operatorsIds[2])).to.equal(30000);
  });

  it('balances should be correct after 100 blocks', async function() {
    await progressBlocks(100);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(90000000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(3000000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(7000000);
  });

  it('withdraw', async function() {
    await progressBlocks(100);
    await ssvNetwork.connect(account1).withdraw('10000000');
    await ssvNetwork.connect(account2).withdraw('1000000');
    await ssvNetwork.connect(account3).withdraw('1000000');
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(69700000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(5090000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(13210000);
  });

  it('revert withdraw: not enough balance', async function() {
    //@ts-ignore
    await progressBlocks(100, async() => {
      await expect(ssvNetwork.connect(account1)
        .withdraw('80000000'))
        .to.be.revertedWith('not enough balance');
      await expect(ssvNetwork.connect(account2)
        .withdraw('9000000'))
        .to.be.revertedWith('not enough balance');
      await expect(ssvNetwork.connect(account3)
        .withdraw('25000000'))
        .to.be.revertedWith('not enough balance');
    });
  });

  it('register same validator', async function() {
    await expect(ssvNetwork.connect(account2).registerValidator(validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens)).to.be.revertedWith('validator with same public key already exists');
  });

  it('register another validator', async function() {
    await progressBlocks(94);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(60200000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(7940000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(19860000);
    await ssvToken.connect(account2).approve(ssvNetwork.address, tokens);
    await ssvNetwork.connect(account2).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens);
    await progressBlocks(100);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(50000000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104000000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(34000000);
  });

  it('get operators by owner address', async function() {
    expect((await ssvNetwork.getOperatorsByOwnerAddress(account2.address)).map((v: any) => v.toString())).to.eql(operatorsIds.slice(0, 2).map(v => v.toString()));
  });

  it('get validators by owner address', async function() {
    expect(await ssvNetwork.getValidatorsByOwnerAddress(account1.address)).to.eql([validatorsPub[0]]);
  });

  it('withdraw all when burn rate is positive', async function() {
    await snapshot(async () => {
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(100000);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(40000);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(50000000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104000000);
      await expect(ssvNetwork.connect(account1).withdrawAll()).to.be.revertedWith("burn rate positive");
    });
  });

  it('liquidate when burn rate is positive', async function() {
    await snapshot(async () => {
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(100000);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(40000);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(50000000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104000000);
      await expect(ssvNetwork.connect(account1).liquidate([account1.address])).to.emit(ssvToken, 'Transfer').withArgs(ssvNetwork.address, account1.address, 49900000);
      expect(await ssvToken.balanceOf(account1.address)).to.equal(859900000);
      await ssvNetwork.connect(account1).registerValidator(validatorsPub[2], operatorsIds.slice(1, 5), operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), 0);
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(0);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(70000);
      await ssvNetwork.connect(account1).removeValidator(validatorsPub[2]);
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(0);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(70000);
      await ssvNetwork.connect(account1).registerValidator(validatorsPub[2], operatorsIds.slice(1, 5), operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), 0);
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(0);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(70000);
      await ssvNetwork.connect(account1).removeValidator(validatorsPub[2]);
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(0);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(70000);
      await ssvNetwork.connect(account1).registerValidator(validatorsPub[2], operatorsIds.slice(1, 5), operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), 0);
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(0);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(70000);
      await ssvNetwork.connect(account1).updateValidator(validatorsPub[2], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 0);
      expect(await ssvNetwork.burnRate(account1.address)).to.equal(0);
      expect(await ssvNetwork.burnRate(account2.address)).to.equal(70000);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(0);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(103540000);

      //@ts-ignore
      await progressBlocks(100, async function() {
        expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(96540000);

        await expect(ssvNetwork.connect(account1).enableAccount(0)).to.be.revertedWith('not enough balance');
        await ssvToken.connect(account1).approve(ssvNetwork.address, 50000000);
        await ssvNetwork.connect(account1).enableAccount(50000000);
        await expect(ssvNetwork.connect(account1).enableAccount(0)).to.be.revertedWith('account already enabled');

        expect(await ssvNetwork.burnRate(account1.address)).to.equal(200000);
        expect(await ssvNetwork.burnRate(account2.address)).to.equal(10000);
        //@ts-ignore
        await progressBlocks(50, async function() {
          expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(39800000);
          expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(95820000);
        });
      })
    });
  });

  it('withdraw all when burn rate is non-positive', async function() {
    await snapshot(async () => {
      await ssvNetwork.connect(account3).registerValidator(validatorsPub[2], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 0);
      expect(await ssvNetwork.burnRate(account3.address)).to.equal(0);
      await expect(ssvNetwork.connect(account3).withdrawAll()).to.emit(ssvToken, 'Transfer').withArgs(ssvNetwork.address, account3.address, 34250000);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(0);
      expect(await ssvNetwork.isOwnerValidatorsDisabled(account3.address)).to.equal(false);
      expect(await ssvToken.balanceOf(account3.address)).to.equal(35250000);
    });
  });

  it('remove a validator', async function() {
    await snapshot(async () => {
      await ssvNetwork.connect(account2).removeValidator(validatorsPub[1]);
      await progressBlocks(99);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(40000000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(106930000);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(41070000);
    });
  });

  it('try to approve when no pending fee', async function() {
    await snapshot(async () => {
      await expect(ssvNetwork.connect(account3).approveOperatorFee(operatorsIds[3])).to.be.revertedWith('no pending fee change request');
    });
  });

  it('update operator fee', async function() {
    await snapshot(async () => {
      await ssvNetwork.connect(account3).setOperatorFee(operatorsIds[3], "41000");
      await ssvNetwork.connect(account3).approveOperatorFee(operatorsIds[3]);
      await progressBlocks(99);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(39801000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(99861000);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(48338000);
    });
  });

  it('remove a validator', async function() {
    await ssvNetwork.connect(account2).removeValidator(validatorsPub[1]);
    await progressBlocks(99);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(40000000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(106930000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(41070000);
  });

  it('register a validator with deposit', async function() {
    await snapshot(async () => {
      await ssvToken.connect(account2).approve(ssvNetwork.address, 1000000);
      await ssvNetwork.connect(account2).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 1000000);
      await progressBlocks(10);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(38800000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(107590000);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(42610000);
    });
  });

  it('activate a validator', async function() {
    await ssvNetwork.connect(account2).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 0);
    await progressBlocks(10);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(38900000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(106560000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(42540000);
  });

  it('remove a validator when overdue', async function() {
    await snapshot(async () => {
      await progressBlocks(1000);
      await expect(ssvNetwork.connect(account1).removeValidator(validatorsPub[0])).to.be.revertedWith('negative balance');
    });
  });

  it('balance when overdue',  async function() {
    await snapshot(async () => {
      await progressBlocks(1000);
      await expect(ssvNetwork.totalBalanceOf(account1.address)).to.be.revertedWith('negative balance');
    });
  });

  it('update operator fee not from owner', async function() {
    await expect(ssvNetwork.connect(account1).setOperatorFee(operatorsIds[3], 6)).to.be.revertedWith('caller is not operator owner');
  });

  it('remove an operator not from owner', async function() {
    await expect(ssvNetwork.connect(account1).removeOperator(operatorsIds[4])).to.be.revertedWith('caller is not operator owner');
  });

  // it('remove an operator with validators', async function() {
  //   await expect(ssvNetwork.connect(account3).removeOperator(operatorsIds[3])).to.be.revertedWith('operator has validators');
  // });

  it('remove an operator', async function() {
    await progressBlocks(4);
    await ssvNetwork.connect(account2).registerValidator(validatorsPub[2], operatorsIds.slice(1, 5), operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), 0);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(38200000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(106280000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(43520000);
    //@ts-ignore
    await progressBlocks(10, async () => {
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(37200000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104680000);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(46120000);
      await ssvNetwork.connect(account2).removeValidator(validatorsPub[2]);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(37100000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104520000);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(46380000);
      await progressBlocks(10);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(36100000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104120000);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(47780000);
      await ssvNetwork.connect(account3).removeOperator(operatorsIds[4]);
      await progressBlocks(9);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(35100000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(103720000);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(49180000);
      expect((await ssvRegistry.operators(operatorsIds[4]))[4]).to.equal(false);
    });
  });

  it('remove an operator', async function() {
    //@ts-ignore
    await progressBlocks(10, async () => {
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(37200000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104680000);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(46120000);
      await ssvNetwork.connect(account2).removeValidator(validatorsPub[2]);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(37100000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104520000);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(46380000);
      await progressBlocks(10);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(36100000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(104120000);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(47780000);
      await ssvNetwork.connect(account3).removeOperator(operatorsIds[4]);
      await progressBlocks(9);
      expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(35100000);
      expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(103720000);
      expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(49180000);
      expect((await ssvRegistry.operators(operatorsIds[4]))[1]).to.equal(account3.address);
      expect((await ssvRegistry.operators(operatorsIds[4]))[4]).to.equal(false);
    });
  });

  it('operator max fee increase', async function() {
    await progressBlocks(9);
    expect(await ssvNetwork.operatorMaxFeeIncrease()).to.equal(10);
    await expect(ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 12000)).to.be.revertedWith('fee exceeds increase limit');
    await expect(ssvNetwork.connect(account2).setOperatorFee(operatorsIds[1], 24000)).to.be.revertedWith('fee exceeds increase limit');
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 11000);
    await ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[0]);
    expect(await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])).to.equal(11000);
    await ssvNetwork.updateOperatorMaxFeeIncrease(20);
    expect(await ssvNetwork.operatorMaxFeeIncrease()).to.equal(20);
    await expect(ssvNetwork.connect(account2).setOperatorFee(operatorsIds[1], 25000)).to.be.revertedWith('fee exceeds increase limit');
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[1], 24000);
    await ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[1]);
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

  it('update set operator fee period', async function() {
    await expect(ssvNetwork.updateSetOperatorFeePeriod(DAY)).to.emit(ssvNetwork, 'SetOperatorFeePeriodUpdated').withArgs(DAY);
    expect(await ssvNetwork.getSetOperatorFeePeriod()).to.equal(DAY);
  });

  it('update approve operator fee period', async function() {
    await expect(ssvNetwork.updateApproveOperatorFeePeriod(DAY)).to.emit(ssvNetwork, 'ApproveOperatorFeePeriodUpdated').withArgs(DAY);
    expect(await ssvNetwork.getApproveOperatorFeePeriod()).to.equal(DAY);
  });

  it('create an operator with low fee', async function() {
    await expect(ssvNetwork.connect(account3).registerOperator('testOperator 5', operatorsIds[5], 1000)).to.be.revertedWith('fee is too low');
  });

  it('create fee change request', async function() {
      await ssvNetwork.connect(account3).setOperatorFee(operatorsIds[3], '41000');
      expect(await ssvNetwork.getOperatorCurrentFee(operatorsIds[3])).to.equal(40000);
      const currentBlockTime = await utils.blockTimestamp();
      expect((await ssvNetwork.getOperatorFeeChangeRequest(operatorsIds[3])).map((v: any) => v.toString())).to.eql(['41000', (+currentBlockTime + DAY).toString(), (+currentBlockTime + 2 * DAY).toString()]);
  });

  it('approve fee too soon', async function() {
    await expect(ssvNetwork.connect(account3).approveOperatorFee(operatorsIds[3])).to.be.revertedWith('approval not within timeframe');
  });

  it('approve too late', async function() {
    //@ts-ignore
    progressTime(3 * DAY, async function() {
      await expect(ssvNetwork.connect(account3).approveOperatorFee(operatorsIds[3])).to.be.revertedWith('approval not within timeframe');
    });
  });

  it('cancel set operator fee', async function() {
    snapshot(async function () {
      await ssvNetwork.connect(account3).cancelSetOperatorFee(operatorsIds[3]);
      expect(await ssvNetwork.getOperatorCurrentFee(operatorsIds[3])).to.equal(40000);
      expect((await ssvNetwork.getOperatorFeeChangeRequest(operatorsIds[3])).map((v: any) => v.toString())).to.eql(['0', '0', '0']);
    });
  });

  it('approve fee on time', async function() {
    //@ts-ignore
    progressTime(DAY * 15 / 10, async function() {
      await expect(ssvNetwork.connect(account3).approveOperatorFee(operatorsIds[3])).to.emit(ssvNetwork, 'OperatorFeeApproved');
      expect(await ssvNetwork.getOperatorCurrentFee(operatorsIds[3])).to.equal(41000);
      expect((await ssvNetwork.getOperatorFeeChangeRequest(operatorsIds[3])).map((v: any) => v.toString())).to.eql(['0', '0', '0']);
    });
  });

  it('update fee with low fee', async function() {
    await expect(ssvNetwork.connect(account3).setOperatorFee(operatorsIds[3], 1000)).to.be.revertedWith('fee is too low');
  });
});
