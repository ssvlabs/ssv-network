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
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address]);
    await ssvNetwork.deployed();
    await ssvToken.mint(account1.address, '1000000');
  });

  it('Address Balance', async function() {
    const table = new Table({ head: ["", "Block #", "10", "20", "30", "40", "50", "60", "100"] });
    const balancesByBlocks = [""];
    // await network.provider.send("evm_increaseTime", [3]);
    await snapshot(async () => {
      const chargedAmount = 4000;
      await ssvToken.connect(account1).approve(ssvNetwork.address, `${chargedAmount}`);

      await progressBlocks(1);
      /*
       block #10
      */
      
      // const cx = await ssvNetwork.updateNetworkFee(1);
      //  await cx.wait();
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
      balancesByBlocks.push(`${+await ssvNetwork.totalBalanceOf(account1.address)}`);
      // register validator
      const tx = await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`);
      await tx.wait();

      balancesByBlocks.push(`${1000 - +await ssvNetwork.totalBalanceOf(account1.address)}`);

      await progressBlocks(9);
      /*
       block #30
      */
      // register validator
      const tx2 = await ssvNetwork.connect(account1).registerValidator(validatorsPub[1], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`);
      await tx2.wait();

      balancesByBlocks.push(`${2000 - +await ssvNetwork.totalBalanceOf(account1.address)}`);

      await progressBlocks(9);
      /*
       block #40
      */
      // register validator
      const tx3 = await ssvNetwork.connect(account1).registerValidator(validatorsPub[2], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`);
      await tx3.wait();

      balancesByBlocks.push(`${3000 - +await ssvNetwork.totalBalanceOf(account1.address)}`);

      await progressBlocks(9);
      /*
       block #50
      */
      // register validator
      const tx4 = await ssvNetwork.connect(account1).registerValidator(validatorsPub[3], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`);
      await tx4.wait();

      balancesByBlocks.push(`${4000 - +await ssvNetwork.totalBalanceOf(account1.address)}`);

      await progressBlocks(10);
      /*
       block #60
      */
      balancesByBlocks.push(`${chargedAmount - +await ssvNetwork.totalBalanceOf(account1.address)}`);

      await progressBlocks(40);
      /*
       block #100
      */      
      balancesByBlocks.push(`${chargedAmount - +await ssvNetwork.totalBalanceOf(account1.address)}`);

      table.push(
        { 'Total': balancesByBlocks }
      );

      console.log(table.toString());
      expect(chargedAmount - +await ssvNetwork.totalBalanceOf(account1.address)).to.equal(1820);

    });
    /*
    await progressBlocks(10);
    const chargedAmount = 4000;
    await ssvToken.connect(account1).approve(ssvNetwork.address, `${chargedAmount}`);
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`);
    await progressBlocks(10);
    // console.log("block", await ethers.provider.getBlockNumber());
    console.log("total balance", +await ssvNetwork.totalBalanceOf(account1.address));
    // expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(chargedAmount/4 - 70);
    console.log("=============");
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[1], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`);
    console.log("=============");
    await progressBlocks(10);
    // console.log("block", await ethers.provider.getBlockNumber());
    console.log("total balance", +await ssvNetwork.totalBalanceOf(account1.address));
    // expect(await ssvNetwork.totalBalanceOf(account1.address)).to.equal(chargedAmount/2 - 236);
    console.log("=============");
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[2], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`);
    console.log("=============");
    await progressBlocks(10);
    // console.log("block", await ethers.provider.getBlockNumber());
    console.log("total balance", +await ssvNetwork.totalBalanceOf(account1.address));
    console.log("=============");
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[3], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount/4}`);
    console.log("=============");
    await progressBlocks(10);
    // console.log("block", await ethers.provider.getBlockNumber());
    console.log("total balance", +await ssvNetwork.totalBalanceOf(account1.address));
    console.log("=============");
    await progressBlocks(10);
    // console.log("block", await ethers.provider.getBlockNumber());
    console.log("total balance", +await ssvNetwork.totalBalanceOf(account1.address));
    */
  });
});