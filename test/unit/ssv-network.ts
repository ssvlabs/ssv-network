// Network Contract Unit Tests

// Declare all imports
import { ethers, upgrades } from 'hardhat';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { progressBlocks, progressTime } from '../helpers/utils';
before(() => {
  chai.should();
  chai.use(chaiAsPromised);
});
const { expect } = chai;

// Define global variables
const minimumBlocksBeforeLiquidation = 50;
const operatorMaxFeeIncrease = 10;
const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345';
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765';
let ssvToken: any, ssvRegistry: any, ssvNetwork: any, utils: any;
let owner: any, account1: any, account2: any, account3: any, account4: any;
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1);
const tokens = '100000000';
const DAY = 86400;
const setOperatorFeePeriod = 0;
const approveOperatorFeePeriod = DAY;
const validatorsPerOperatorLimit = 2000;

describe('SSV Network', function () {
  beforeEach(async function () {
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

    // Register operators
    await ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 10000);
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 20000);
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 30000);
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 40000);
    await ssvNetwork.connect(account3).registerOperator('testOperator 4', operatorsPub[4], 50000);

    // Register validators
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens);
    await ssvToken.connect(account1).transfer(account2.address, tokens);
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens);
  });

  it('Operator limit', async function () {
    expect(await ssvNetwork.validatorsPerOperatorCount(operatorsIds[0])).to.equal(1);
    expect(await ssvNetwork.getValidatorsPerOperatorLimit()).to.equal(2000);
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 0);
    await ssvNetwork.setValidatorsPerOperatorLimit(1);
    expect(await ssvNetwork.getValidatorsPerOperatorLimit()).to.equal(1);
    await expect(ssvNetwork.connect(account1).registerValidator(validatorsPub[2], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 0)).to.be.revertedWith('exceed validator limit');
    await expect(ssvNetwork.connect(account1).updateValidator(validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 0)).to.be.revertedWith('exceed validator limit');
  });

  it('Operators getter', async function () {
    expect((await ssvNetwork.operators(operatorsIds[0])).map((v: any) => v.toString())).to.eql(['testOperator 0', account2.address, operatorsPub[0], '0', 'true']);
    expect((await ssvNetwork.operators(operatorsIds[1])).map((v: any) => v.toString())).to.eql(['testOperator 1', account2.address, operatorsPub[1], '0', 'true']);
    expect((await ssvNetwork.operators(operatorsIds[2])).map((v: any) => v.toString())).to.eql(['testOperator 2', account3.address, operatorsPub[2], '0', 'true']);
  });

  it('Get operator current fee', async function () {
    expect(await ssvNetwork.getOperatorCurrentFee(operatorsIds[0])).to.equal(10000);
    expect(await ssvNetwork.getOperatorCurrentFee(operatorsIds[1])).to.equal(20000);
    expect(await ssvNetwork.getOperatorCurrentFee(operatorsIds[2])).to.equal(30000);
  });

  it('Balances should be correct after 100 blocks', async function () {
    await progressBlocks(100);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(90000000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(3000000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(7000000);
  });

  it('Withdraw', async function () {
    await progressBlocks(200);
    await ssvNetwork.connect(account1).withdraw('10000000');
    await ssvNetwork.connect(account2).withdraw('1000000');
    await ssvNetwork.connect(account3).withdraw('1000000');
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(69700000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(5090000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(13210000);
  });

  it('Revert withdraw: not enough balance', async function () {
    await progressBlocks(350)
    await expect(ssvNetwork.connect(account1)
      .withdraw('800000000'))
      .to.be.revertedWith('not enough balance');
    await expect(ssvNetwork.connect(account2)
      .withdraw('90000000'))
      .to.be.revertedWith('not enough balance');
    await expect(ssvNetwork.connect(account3)
      .withdraw('250000000'))
      .to.be.revertedWith('not enough balance');
  });

  it('Register same validator', async function () {
    await expect(ssvNetwork.connect(account2).registerValidator(validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens)).to.be.revertedWith('validator with same public key already exists');
  });

  it('Register another validator', async function () {
    await progressBlocks(600);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(40000000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(18000000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(42000000);
    await ssvToken.connect(account2).approve(ssvNetwork.address, tokens);
    await ssvNetwork.connect(account2).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens);
    await progressBlocks(100);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(29800000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(114060000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(56140000);
  });

  it('Get operators by owner address', async function () {
    expect((await ssvNetwork.getOperatorsByOwnerAddress(account2.address)).map((v: any) => v.toString())).to.eql(operatorsIds.slice(0, 2).map(v => v.toString()));
  });

  it('Get validators by owner address', async function () {
    expect(await ssvNetwork.getValidatorsByOwnerAddress(account1.address)).to.eql([validatorsPub[0]]);
  });

  it('Withdraw all when burn rate is positive', async function () {
    await ssvToken.connect(account2).approve(ssvNetwork.address, tokens);
    await ssvNetwork.connect(account2).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens);
    expect(await ssvNetwork.burnRate(account1.address)).to.equal(100000);
    expect(await ssvNetwork.burnRate(account2.address)).to.equal(40000);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(99800000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(100060000);
    await expect(ssvNetwork.connect(account1).withdrawAll()).to.be.revertedWith("burn rate positive");
  });

  it('Liquidate when burn rate is positive', async function () {
    await ssvToken.connect(account2).approve(ssvNetwork.address, tokens);
    await ssvNetwork.connect(account2).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens);
    expect(await ssvNetwork.burnRate(account1.address)).to.equal(100000);
    expect(await ssvNetwork.burnRate(account2.address)).to.equal(40000);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(99800000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(100060000);
    await expect(ssvNetwork.connect(account1).liquidate([account1.address])).to.emit(ssvToken, 'Transfer').withArgs(ssvNetwork.address, account1.address, 99700000);
    expect(await ssvToken.balanceOf(account1.address)).to.equal(899700000);
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
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(99600000);

    await progressBlocks(100)
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(92600000);

    await expect(ssvNetwork.connect(account1).enableAccount(0)).to.be.revertedWith('not enough balance');
    await ssvToken.connect(account1).approve(ssvNetwork.address, 50000000);
    await ssvNetwork.connect(account1).enableAccount(50000000);
    await expect(ssvNetwork.connect(account1).enableAccount(0)).to.be.revertedWith('account already enabled');

    expect(await ssvNetwork.burnRate(account1.address)).to.equal(200000);
    expect(await ssvNetwork.burnRate(account2.address)).to.equal(10000);

    await progressBlocks(50)
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(39800000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(91880000);
  });

  it('Withdraw all when burn rate is non-positive', async function () {
    await ssvNetwork.connect(account3).registerValidator(validatorsPub[2], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 0);
    expect(await ssvNetwork.burnRate(account3.address)).to.equal(0);
    await expect(ssvNetwork.connect(account3).withdrawAll()).to.emit(ssvToken, 'Transfer').withArgs(ssvNetwork.address, account3.address, 110000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(0);
    expect(await ssvNetwork.isOwnerValidatorsDisabled(account3.address)).to.equal(false);
    expect(await ssvToken.balanceOf(account3.address)).to.equal(110000);
  });

  it('Remove a validator', async function () {
    await ssvNetwork.connect(account1).removeValidator(validatorsPub[0]);
    await progressBlocks(99);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(99900000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(30000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(70000);
  });

  it('Try to approve when no pending fee', async function () {
    await expect(ssvNetwork.connect(account3).approveOperatorFee(operatorsIds[3])).to.be.revertedWith('no pending fee change request');
  });

  it('Update operator fee', async function () {
    await ssvNetwork.connect(account3).setOperatorFee(operatorsIds[3], "41000");
    await ssvNetwork.connect(account3).approveOperatorFee(operatorsIds[3]);
    await progressBlocks(99);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(89801000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(3030000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(7169000);
  });

  it('Register a validator with deposit', async function () {
    await ssvToken.connect(account2).approve(ssvNetwork.address, tokens);
    await ssvNetwork.connect(account2).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens);
    await progressBlocks(10);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(98800000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(99660000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(1540000);
  });

  it('Activate a validator', async function () {
    await ssvToken.connect(account2).approve(ssvNetwork.address, tokens);
    await ssvNetwork.connect(account2).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens);
    await progressBlocks(10);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(98800000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(99660000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(1540000);
  });

  it('Remove a validator when overdue', async function () {
    await progressBlocks(1000);
    await expect(ssvNetwork.connect(account1).removeValidator(validatorsPub[0])).to.be.revertedWith('negative balance');
  });

  it('Balance when overdue', async function () {
    await progressBlocks(10000);
    await expect(ssvNetwork.totalBalanceOf(account1.address)).to.be.revertedWith('negative balance');
  });

  it('Update operator fee not from owner', async function () {
    await expect(ssvNetwork.connect(account1).setOperatorFee(operatorsIds[3], 6)).to.be.revertedWith('caller is not operator owner');
  });

  it('Remove an operator not from owner', async function () {
    await expect(ssvNetwork.connect(account1).removeOperator(operatorsIds[4])).to.be.revertedWith('caller is not operator owner');
  });

  it('Remove an operator', async function () {
    await ssvToken.connect(account2).approve(ssvNetwork.address, tokens);
    await ssvNetwork.connect(account2).registerValidator(validatorsPub[2], operatorsIds.slice(1, 5), operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), tokens);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(99800000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(100060000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(140000);
    await progressBlocks(10)
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(98800000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(99160000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(2040000);
    await ssvNetwork.connect(account2).removeValidator(validatorsPub[2]);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(98700000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(99070000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(2230000);
    await progressBlocks(10);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(97700000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(99370000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(2930000);
    await ssvNetwork.connect(account3).removeOperator(operatorsIds[4]);
    await progressBlocks(9);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(96700000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(99670000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(3630000);
  });

  it('Deactivate an operator', async function () {
    await progressBlocks(10)
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(99000000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(300000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(700000);
    await ssvNetwork.connect(account1).removeValidator(validatorsPub[0]);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(98900000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(330000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(770000);
    await progressBlocks(10);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(98900000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(330000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(770000);
    await ssvNetwork.connect(account3).removeOperator(operatorsIds[4]);
    await progressBlocks(9);
    expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(98900000);
    expect(await ssvNetwork.totalBalanceOf(account2.address)).to.equal(330000);
    expect(await ssvNetwork.totalBalanceOf(account3.address)).to.equal(770000);
    expect((await ssvRegistry.operators(operatorsIds[4]))[1]).to.equal(account3.address);
    expect((await ssvRegistry.operators(operatorsIds[4]))[4]).to.equal(false);
  });

  it('Operator max fee increase', async function () {
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

  it('Minimum blocks before liquidation', async function () {
    expect(await ssvNetwork.minimumBlocksBeforeLiquidation()).to.equal(50);
    await ssvNetwork.updateMinimumBlocksBeforeLiquidation(30);
    expect(await ssvNetwork.minimumBlocksBeforeLiquidation()).to.equal(30);
  });

  it('Set network fee', async function () {
    expect(await ssvNetwork.networkFee()).to.equal('0');
    await expect(ssvNetwork.updateNetworkFee(1)).to.emit(ssvNetwork, 'NetworkFeeUpdated').withArgs('0', '1');
    expect(await ssvNetwork.networkFee()).to.equal('1');
    await progressBlocks(20);
    expect(await ssvNetwork.getNetworkTreasury()).to.equal(20);
  });

  it('Withdraw network fees', async function () {
    await expect(ssvNetwork.updateNetworkFee(1)).to.emit(ssvNetwork, 'NetworkFeeUpdated').withArgs('0', '1');
    await progressBlocks(20);
    await expect(ssvNetwork.connect(account2).withdrawNetworkFees(60)).to.be.revertedWith('Ownable: caller is not the owner');
    await expect(ssvNetwork.withdrawNetworkFees(80)).to.be.revertedWith('not enough balance');
    await expect(ssvNetwork.withdrawNetworkFees(20)).to.emit(ssvToken, 'Transfer').withArgs(ssvNetwork.address, owner.address, '20');
    expect(await ssvNetwork.getNetworkTreasury()).to.equal(3);
    await expect(ssvNetwork.withdrawNetworkFees(60)).to.be.revertedWith('not enough balance');
  });

  it('Update set operator fee period', async function () {
    await expect(ssvNetwork.updateSetOperatorFeePeriod(DAY)).to.emit(ssvNetwork, 'SetOperatorFeePeriodUpdated').withArgs(DAY);
    expect(await ssvNetwork.getSetOperatorFeePeriod()).to.equal(DAY);
  });

  it('Update approve operator fee period', async function () {
    await expect(ssvNetwork.updateApproveOperatorFeePeriod(DAY)).to.emit(ssvNetwork, 'ApproveOperatorFeePeriodUpdated').withArgs(DAY);
    expect(await ssvNetwork.getApproveOperatorFeePeriod()).to.equal(DAY);
  });

  it('Create an operator with low fee', async function () {
    await expect(ssvNetwork.connect(account3).registerOperator('testOperator 5', operatorsIds[5], 1000)).to.be.revertedWith('fee is too low');
  });

  it('Fee change request', async function () {
    await expect(ssvNetwork.updateSetOperatorFeePeriod(DAY)).to.emit(ssvNetwork, 'SetOperatorFeePeriodUpdated').withArgs(DAY);
    await expect(ssvNetwork.updateApproveOperatorFeePeriod(DAY)).to.emit(ssvNetwork, 'ApproveOperatorFeePeriodUpdated').withArgs(DAY);
    await ssvNetwork.connect(account3).setOperatorFee(operatorsIds[3], '41000');
    expect(await ssvNetwork.getOperatorCurrentFee(operatorsIds[3])).to.equal(40000);
    const currentBlockTime = await utils.blockTimestamp();
    expect((await ssvNetwork.getOperatorFeeChangeRequest(operatorsIds[3])).map((v: any) => v.toString())).to.eql(['41000', (+currentBlockTime + DAY).toString(), (+currentBlockTime + 2 * DAY).toString()]);

    //approve fee too soon
    await expect(ssvNetwork.connect(account3).approveOperatorFee(operatorsIds[3])).to.be.revertedWith('approval not within timeframe');

    // Approve too late
    await progressTime(3 * DAY)
    await expect(ssvNetwork.connect(account3).approveOperatorFee(operatorsIds[3])).to.be.revertedWith('approval not within timeframe');

    // Cancel set operator fee
    await ssvNetwork.connect(account3).setOperatorFee(operatorsIds[3], '41000');
    await ssvNetwork.connect(account3).cancelSetOperatorFee(operatorsIds[3]);
    expect(await ssvNetwork.getOperatorCurrentFee(operatorsIds[3])).to.equal(40000);
    expect((await ssvNetwork.getOperatorFeeChangeRequest(operatorsIds[3])).map((v: any) => v.toString())).to.eql(['0', '0', '0']);

    // Approve fee on time
    await ssvNetwork.connect(account3).setOperatorFee(operatorsIds[3], '41000');
    await progressTime(DAY * 15 / 10)
    await expect(ssvNetwork.connect(account3).approveOperatorFee(operatorsIds[3])).to.emit(ssvNetwork, 'OperatorFeeApproved');
    expect(await ssvNetwork.getOperatorCurrentFee(operatorsIds[3])).to.equal(41000);
    expect((await ssvNetwork.getOperatorFeeChangeRequest(operatorsIds[3])).map((v: any) => v.toString())).to.eql(['0', '0', '0']);

    // update fee with low fee
    await expect(ssvNetwork.connect(account3).setOperatorFee(operatorsIds[3], 1000)).to.be.revertedWith('fee is too low');
  });
});