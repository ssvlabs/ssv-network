import { ethers, upgrades } from 'hardhat';
import { solidity } from 'ethereum-waffle';

import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { rawListeners } from 'process';

import { progress, progressBlocks, progressTime, snapshot, mine } from './utils';

//@ts-ignore
import * as Table from 'cli-table';

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
let ssvToken: any, ssvRegistry: any, ssvNetwork: any;
//@ts-ignore
let owner: any, account1: any, account2: any, account3: any, account4: any;
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1);

const DAY = 86400;
const YEAR = 365 * DAY;
const operatorIndexes: any = [];

const setOperatorFeePeriod = 0;
const approveOperatorFeePeriod = DAY;
const validatorsPerOperatorLimit = 2000;

//@ts-ignore
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
//@ts-ignore
const operatorIndexOf = async(idx) => {
  const currentBlockNumber = await ethers.provider.getBlockNumber();
  const value = operatorIndexes[idx].index +
    (currentBlockNumber - operatorIndexes[idx].blockNumber) *
    operatorIndexes[idx].fee;
  return value;
}

//@ts-ignore
const getContractOperatorIndexes = async(ids) => {
  const result = [];
  for (const id of ids) {
    result.push(+(await ssvNetwork.operatorIndexOf(operatorsPub[id])));
  }
  return result;
}

//@ts-ignore
const operatorExpenseOf = async(idx) => {
  return operatorIndexes[idx].used +
        ((await operatorIndexOf(idx)) - operatorIndexes[idx].index) * operatorIndexes[idx].validatorsCount;
}

//@ts-ignore
const updateOperatorIndexes = async(ids) => {
  let total = 0;
  for (const id of ids) {
    operatorIndexes[id].index += +(await operatorIndexOf(id));
    operatorIndexes[id].blockNumber = await ethers.provider.getBlockNumber()
  }
  return total;
}

//@ts-ignore
const updateOperatorExpense = async(ids) => {
  for (const idx of ids) {
    operatorIndexes[idx].used = await operatorExpenseOf(idx);
  }
}

//@ts-ignore
const incOperatorValidators = async(ids) => {
  for (const id of ids) {
    operatorIndexes[id].validatorsCount++;
  }
}

describe('SSV Network Balances Calculation', function() {
  before(async function () {
    [owner, account1, account2, account3] = await ethers.getSigners();
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
  });

  it('Address Balance', async function() {
    const table = new Table({ head: ["", "Block #", "10", "20", "30", "40", "50", "60", "100"] });
    const balancesByBlocks = [""];
    const networkAddFeeByBlocks = [""];
    // await network.provider.send("evm_increaseTime", [3]);
    await snapshot(async () => {
      const chargedAmount = 10000000;
      await ssvToken.connect(account1).approve(ssvNetwork.address, `${chargedAmount * 4}`);

      (await ssvNetwork.updateNetworkFee(1000)).wait();
      // register operators
      await network.provider.send("evm_setAutomine", [false]);
      await registerOperator(account2, 0, 20000);
      await registerOperator(account2, 1, 10000);
      await registerOperator(account2, 2, 10000);
      await registerOperator(account2, 3, 30000);

      await progressBlocks(1);

      /*
       block #10
      */
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);
      balancesByBlocks.push(`${+await ssvNetwork.totalBalanceOf(account1.address)}`);
      await progressBlocks(10);

      /*
       block #20
      */
      await network.provider.send("evm_setAutomine", [true]);

      balancesByBlocks.push(`${+await ssvNetwork.totalBalanceOf(account1.address)}`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

      // register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount}`)).wait();

      await progress(4 * DAY, 9);

      /*
       block #30
      */
      balancesByBlocks.push(`${chargedAmount - +await ssvNetwork.totalBalanceOf(account1.address)}`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

      await network.provider.send("evm_setAutomine", [false]);
      (await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 22000)).wait();
      (await ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[0])).wait();

      // register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount}`)).wait();
      await network.provider.send("evm_setAutomine", [true]);

      await progressBlocks(10);

      /*
       block #40
      */
      balancesByBlocks.push(`${2 * chargedAmount - +await ssvNetwork.totalBalanceOf(account1.address)}`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

       // register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[2], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount}`)).wait();

      await progress(4 * DAY, 9);

      /*
       block #50
      */
      balancesByBlocks.push(`${3 * chargedAmount - +await ssvNetwork.totalBalanceOf(account1.address)} (${await ssvNetwork.totalBalanceOf(account1.address)})`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);
      await network.provider.send("evm_setAutomine", [false]);
      (await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 18000)).wait();
      (await ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[0])).wait();
      (await ssvNetwork.updateNetworkFee(2000)).wait();
      // register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[3], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount}`)).wait();
      await network.provider.send("evm_setAutomine", [true]);

      await progressBlocks(10);

      /*
       block #60
      */
      balancesByBlocks.push(`${4 * chargedAmount - +await ssvNetwork.totalBalanceOf(account1.address)} (${await ssvNetwork.totalBalanceOf(account1.address)})`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

      await progressBlocks(40);

      /*
       block #100
      */
      balancesByBlocks.push(`${4 * chargedAmount - +await ssvNetwork.totalBalanceOf(account1.address)} (${await ssvNetwork.totalBalanceOf(account1.address)})`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

      table.push(
        { 'Acc. Payments': balancesByBlocks },
        { 'Network Fee': networkAddFeeByBlocks }
      );

      console.log(table.toString());
      expect(4 * chargedAmount - +await ssvNetwork.totalBalanceOf(account1.address)).to.equal(18080000);

    });
  });

  it('Revenue', async function() {
    return;
    const table = new Table({ head: ["", "Block #", "10", "20", "30", "40", "50", "60", "100"] });
    const operatorEarnings = [[""],[""],[""],[""]];
    const operatorFees = [[""],[""],[""],[""]];

    const networkAddFeeByBlocks = [""];
    // await network.provider.send("evm_increaseTime", [3]);
    await snapshot(async () => {
      const chargedAmount = 100000000;
      await ssvToken.connect(account1).approve(ssvNetwork.address, `${chargedAmount * 4}`);

      await progressBlocks(1);
      /*
       block #10
      */
      
      (await ssvNetwork.updateNetworkFee(10000)).wait();
      // register operators
      await network.provider.send("evm_setAutomine", [false]);
      await registerOperator(account2, 0, 20000);
      await registerOperator(account2, 1, 10000);
      await registerOperator(account2, 2, 10000);
      await registerOperator(account2, 3, 30000);

      await progressBlocks(9);
      /*
       block #20
      */
      await network.provider.send("evm_setAutomine", [true]);
      operatorEarnings[0].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[0])}`);
      operatorEarnings[1].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[1])}`);
      operatorEarnings[2].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[2])}`);
      operatorEarnings[3].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[3])}`);
      operatorFees[0].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])}`);
      operatorFees[1].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[1])}`);
      operatorFees[2].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[2])}`);
      operatorFees[3].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[3])}`);

      // register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount}`)).wait();

      operatorEarnings[0].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[0])}`);
      operatorEarnings[1].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[1])}`);
      operatorEarnings[2].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[2])}`);
      operatorEarnings[3].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[3])}`);
      operatorFees[0].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])}`);
      operatorFees[1].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[1])}`);
      operatorFees[2].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[2])}`);
      operatorFees[3].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[3])}`);

      await progressBlocks(9);
      /*
       block #30
      */
      // register validator
      await progressTime(4 * DAY);
      await network.provider.send("evm_setAutomine", [false]);
      (await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 190000)).wait();
      (await ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[0])).wait();
      await network.provider.send("evm_setAutomine", [true]);
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount}`)).wait();
      
      operatorEarnings[0].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[0])}`);
      operatorEarnings[1].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[1])}`);
      operatorEarnings[2].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[2])}`);
      operatorEarnings[3].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[3])}`);
      operatorFees[0].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])}`);
      operatorFees[1].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[1])}`);
      operatorFees[2].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[2])}`);
      operatorFees[3].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[3])}`);


      await progressBlocks(9);
      /*
       block #40
      */
      // register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[2], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount}`)).wait();

      operatorEarnings[0].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[0])}`);
      operatorEarnings[1].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[1])}`);
      operatorEarnings[2].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[2])}`);
      operatorEarnings[3].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[3])}`);
      operatorFees[0].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])}`);
      operatorFees[1].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[1])}`);
      operatorFees[2].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[2])}`);
      operatorFees[3].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[3])}`);

      await progressBlocks(9);
      /*
       block #50
      */
      await progressTime(4 * DAY);
      await network.provider.send("evm_setAutomine", [false]);
      (await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 20000)).wait();
      (await ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[0])).wait();
      await network.provider.send("evm_setAutomine", [true]);
      // register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[3], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount}`)).wait();

      operatorEarnings[0].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[0])}`);
      operatorEarnings[1].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[1])}`);
      operatorEarnings[2].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[2])}`);
      operatorEarnings[3].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[3])}`);
      operatorFees[0].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])}`);
      operatorFees[1].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[1])}`);
      operatorFees[2].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[2])}`);
      operatorFees[3].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[3])}`);

      await progressBlocks(10);
      /*
       block #60
      */
      operatorEarnings[0].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[0])}`);
      operatorEarnings[1].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[1])}`);
      operatorEarnings[2].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[2])}`);
      operatorEarnings[3].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[3])}`);
      operatorFees[0].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])}`);
      operatorFees[1].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[1])}`);
      operatorFees[2].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[2])}`);
      operatorFees[3].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[3])}`);

      await progressBlocks(40);
      /*
       block #100
      */
      operatorEarnings[0].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[0])}`);
      operatorEarnings[1].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[1])}`);
      operatorEarnings[2].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[2])}`);
      operatorEarnings[3].push(`${+await ssvNetwork.operatorEarningsOf(operatorsIds[3])}`);
      operatorFees[0].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])}`);
      operatorFees[1].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[1])}`);
      operatorFees[2].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[2])}`);
      operatorFees[3].push(`${+await ssvRegistry.getOperatorCurrentFee(operatorsIds[3])}`);

      table.push(
        { 'Operator #1 earnings': operatorEarnings[0] },
        { 'Operator #1 fee': operatorFees[0] },
        { 'Operator #2 earnings': operatorEarnings[1] },
        { 'Operator #2 fee': operatorFees[1] },
        { 'Operator #3 earnings': operatorEarnings[2] },
        { 'Operator #3 fee': operatorFees[2] },
        { 'Operator #4 earnings': operatorEarnings[3] },
        { 'Operator #4 fee': operatorFees[3] },
      );

      console.log(table.toString());
      expect(+await ssvNetwork.operatorEarningsOf(operatorsIds[0])).to.equal(5280000);
      expect(+await ssvNetwork.operatorEarningsOf(operatorsIds[1])).to.equal(2640000);
      expect(+await ssvNetwork.operatorEarningsOf(operatorsIds[2])).to.equal(2640000);
      expect(+await ssvNetwork.operatorEarningsOf(operatorsIds[3])).to.equal(7920000);
    });
  });
});