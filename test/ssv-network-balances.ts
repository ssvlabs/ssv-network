import { ethers, upgrades } from 'hardhat';
import { solidity } from 'ethereum-waffle';

import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { rawListeners } from 'process';

import { progressBlocks, snapshot, mine } from './utils';

import * as Table from 'cli-table';

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
let owner, account1, account2, account3;
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);
const tokens = '10000';

const DAY = 86400;
const YEAR = 365 * DAY;
const operatorIndexes = [];

const registerOperator = async (account, idx, fee) => {
  await ssvNetwork.connect(account).registerOperator(`testOperator ${idx}`, operatorsPub[idx], fee);
  operatorIndexes.push({
    fee,
    blockNumber: await ethers.provider.getBlockNumber(),
    index: 0,
    validatorsCount: 0,
    used: 0
  });
}

// register validators
const operatorIndexOf = async(idx) => {
  const currentBlockNumber = await ethers.provider.getBlockNumber();
  const value = operatorIndexes[idx].index +
    (currentBlockNumber - operatorIndexes[idx].blockNumber) *
    operatorIndexes[idx].fee;
  return value;
}

const getContractOperatorIndexes = async(ids) => {
  const result = [];
  for (const id of ids) {
    result.push(+(await ssvNetwork.operatorIndexOf(operatorsPub[id])));
  }
  return result;
}

const operatorExpenseOf = async(idx) => {
  return operatorIndexes[idx].used +
        ((await operatorIndexOf(idx)) - operatorIndexes[idx].index) * operatorIndexes[idx].validatorsCount;
}

const updateOperatorIndexes = async(ids) => {
  let total = 0;
  for (const id of ids) {
    operatorIndexes[id].index += +(await operatorIndexOf(id));
    operatorIndexes[id].blockNumber = await ethers.provider.getBlockNumber()
  }
  return total;
}

const updateOperatorExpense = async(ids) => {
  for (const idx of ids) {
    operatorIndexes[idx].used = await operatorExpenseOf(idx);
  }
}

const incOperatorValidators = async(ids) => {
  for (const id of ids) {
    operatorIndexes[id].validatorsCount++;
  }
}

describe('SSV Network Balances Calculation', function() {
  before(async function () {
    [owner, account1, account2, account3] = await ethers.getSigners();
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
  });

  it('Address Balance', async function() {
    const table = new Table({ head: ["", "Block #", "10", "20", "30", "40", "50", "60", "100"] });
    const balancesByBlocks = [""];
    const networkAddFeeByBlocks = [""];
    // await network.provider.send("evm_increaseTime", [3]);
    await snapshot(async () => {
      const chargedAmount = 4000;
      await ssvToken.connect(account1).approve(ssvNetwork.address, `${chargedAmount}`);

      await progressBlocks(1);
      /*
       block #10
      */
      
      (await ssvNetwork.updateNetworkFee(1)).wait();
      // register operators
      await network.provider.send("evm_setAutomine", [false]);
      await registerOperator(account2, 0, 2);
      await registerOperator(account2, 1, 1);
      await registerOperator(account2, 2, 1);
      await registerOperator(account2, 3, 3);
      await progressBlocks(9);
      /*
       block #20
      */
      await network.provider.send("evm_setAutomine", [true]);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);
      balancesByBlocks.push(`${+await ssvNetwork.totalBalanceOf(account1.address)}`);
      // register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`)).wait();

      balancesByBlocks.push(`${1000 - +await ssvNetwork.totalBalanceOf(account1.address)}`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

      await progressBlocks(9);
      /*
       block #30
      */
      await network.provider.send("evm_setAutomine", [false]);
      (await ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[0], 3)).wait();
      await network.provider.send("evm_setAutomine", [true]);
      // register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[1], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`)).wait();

      balancesByBlocks.push(`${2000 - +await ssvNetwork.totalBalanceOf(account1.address)}`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

      await progressBlocks(9);
      /*
       block #40
      */
       // register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[2], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`)).wait();

      balancesByBlocks.push(`${3000 - +await ssvNetwork.totalBalanceOf(account1.address)}`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

      await progressBlocks(9);
      /*
       block #50
      */
      await network.provider.send("evm_setAutomine", [false]);
      (await ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[0], 1)).wait();
      (await ssvNetwork.updateNetworkFee(2)).wait();
      await network.provider.send("evm_setAutomine", [false]);
      // register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[3], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`)).wait();

      await progressBlocks(1);
      balancesByBlocks.push(`${4000 - +await ssvNetwork.totalBalanceOf(account1.address)}`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

      await progressBlocks(10);
      /*
       block #60
      */
      balancesByBlocks.push(`${chargedAmount - +await ssvNetwork.totalBalanceOf(account1.address)}`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

      await progressBlocks(40);
      /*
       block #100
      */      
      balancesByBlocks.push(`${chargedAmount - +await ssvNetwork.totalBalanceOf(account1.address)}`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

      table.push(
        { 'Acc. Payments': balancesByBlocks },
        { 'Network Fee': networkAddFeeByBlocks }
      );

      console.log(table.toString());
      expect(chargedAmount - +await ssvNetwork.totalBalanceOf(account1.address)).to.equal(1670);

    });
  });

  it('Revenue', async function() {
    const table = new Table({ head: ["", "Block #", "10", "20", "30", "40", "50", "60", "100"] });
    const operator0Balances = [""];
    const operator1Balances = [""];
    const operator2Balances = [""];
    const operator3Balances = [""];
    const operator0Fees = [""];
    const operator1Fees = [""];
    const operator2Fees = [""];
    const operator3Fees = [""];

    const networkAddFeeByBlocks = [""];
    // await network.provider.send("evm_increaseTime", [3]);
    await snapshot(async () => {
      const chargedAmount = 4000;
      await ssvToken.connect(account1).approve(ssvNetwork.address, `${chargedAmount}`);

      await progressBlocks(1);
      /*
       block #10
      */
      
      (await ssvNetwork.updateNetworkFee(1)).wait();
      // register operators
      await network.provider.send("evm_setAutomine", [false]);
      await registerOperator(account2, 0, 2);
      await registerOperator(account2, 1, 1);
      await registerOperator(account2, 2, 1);
      await registerOperator(account2, 3, 3);

      await progressBlocks(9);
      /*
       block #20
      */
      await network.provider.send("evm_setAutomine", [true]);
      operator0Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[0])}`);
      operator1Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[1])}`);
      operator2Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[2])}`);
      operator3Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[3])}`);
      operator0Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[0])}`);
      operator1Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[1])}`);
      operator2Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[2])}`);
      operator3Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[3])}`);

      // register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`)).wait();

      operator0Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[0])}`);
      operator1Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[1])}`);
      operator2Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[2])}`);
      operator3Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[3])}`);
      operator0Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[0])}`);
      operator1Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[1])}`);
      operator2Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[2])}`);
      operator3Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[3])}`);

      await progressBlocks(9);
      /*
       block #30
      */
      // register validator
      await network.provider.send("evm_setAutomine", [false]);
      (await ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[0], 3)).wait();
      await network.provider.send("evm_setAutomine", [true]);
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[1], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`)).wait();
      
      operator0Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[0])}`);
      operator1Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[1])}`);
      operator2Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[2])}`);
      operator3Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[3])}`);
      operator0Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[0])}`);
      operator1Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[1])}`);
      operator2Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[2])}`);
      operator3Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[3])}`);


      await progressBlocks(9);
      /*
       block #40
      */
      // register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[2], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`)).wait();

      operator0Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[0])}`);
      operator1Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[1])}`);
      operator2Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[2])}`);
      operator3Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[3])}`);
      operator0Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[0])}`);
      operator1Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[1])}`);
      operator2Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[2])}`);
      operator3Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[3])}`);

      await progressBlocks(9);
      /*
       block #50
      */
      await network.provider.send("evm_setAutomine", [false]);
      (await ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[0], 1)).wait();
      await network.provider.send("evm_setAutomine", [true]);
      // register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[3], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`)).wait();

      operator0Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[0])}`);
      operator1Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[1])}`);
      operator2Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[2])}`);
      operator3Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[3])}`);
      operator0Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[0])}`);
      operator1Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[1])}`);
      operator2Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[2])}`);
      operator3Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[3])}`);

      await progressBlocks(10);
      /*
       block #60
      */
      operator0Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[0])}`);
      operator1Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[1])}`);
      operator2Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[2])}`);
      operator3Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[3])}`);
      operator0Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[0])}`);
      operator1Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[1])}`);
      operator2Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[2])}`);
      operator3Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[3])}`);

      await progressBlocks(40);
      /*
       block #100
      */      
      operator0Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[0])}`);
      operator1Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[1])}`);
      operator2Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[2])}`);
      operator3Balances.push(`${+await ssvNetwork.operatorBalanceOf(operatorsPub[3])}`);
      operator0Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[0])}`);
      operator1Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[1])}`);
      operator2Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[2])}`);
      operator3Fees.push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsPub[3])}`);

      table.push(
        { 'Operator #1 earnings': operator0Balances },
        { 'Operator #1 fee': operator0Fees },
        { 'Operator #2 earnings': operator1Balances },
        { 'Operator #2 fee': operator1Fees },
        { 'Operator #3 earnings': operator2Balances },
        { 'Operator #3 fee': operator2Fees },
        { 'Operator #4 earnings': operator3Balances },
        { 'Operator #4 fee': operator3Fees },
      );

      console.log(table.toString());
      expect(+await ssvNetwork.operatorBalanceOf(operatorsPub[0])).to.equal(370);
      expect(+await ssvNetwork.operatorBalanceOf(operatorsPub[1])).to.equal(260);
      expect(+await ssvNetwork.operatorBalanceOf(operatorsPub[2])).to.equal(260);
      expect(+await ssvNetwork.operatorBalanceOf(operatorsPub[3])).to.equal(780);

    });
  });
});