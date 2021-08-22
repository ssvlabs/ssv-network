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

    // register operators
    await registerOperator(account2, 0, 2);
    await registerOperator(account2, 1, 1);
    await registerOperator(account2, 2, 1);
    await registerOperator(account2, 3, 3);
  });

  it('block +10: balances', async function() {
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
  });
});
