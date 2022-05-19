import { ethers, upgrades } from 'hardhat';
import { solidity } from 'ethereum-waffle';

import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { rawListeners } from 'process';

import { progressBlocks, snapshot } from '../helpers/utils';

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
    await ssvToken.mint(account2.address, '10000000000');
  });

  it('register liquidatable validator', async function() {
    // register operators
    await ssvNetwork.updateNetworkFee(0)
    await ssvNetwork.connect(account1).registerOperator('testOperator 0', operatorsPub[0], 10000);
    await ssvNetwork.connect(account1).registerOperator('testOperator 1', operatorsPub[1], 20000);
    await ssvNetwork.connect(account1).registerOperator('testOperator 2', operatorsPub[2], 30000);
    await ssvNetwork.connect(account2).registerOperator('testOperator 3', operatorsPub[3], 40000);
    await progressBlocks(100);

    // register validators
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens);
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens);
    await ssvToken.connect(account2).approve(ssvNetwork.address, tokens);
    await ssvNetwork.connect(account2).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens);
    await progressBlocks(10);

    console.log(+await ssvNetwork.operatorEarningsOf(operatorsIds[0]))
    console.log(+await ssvNetwork.operatorEarningsOf(operatorsIds[1]))
    console.log(+await ssvNetwork.operatorEarningsOf(operatorsIds[2]))
    console.log(+await ssvNetwork.operatorEarningsOf(operatorsIds[3]))
  });
});
