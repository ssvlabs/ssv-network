// Network Balances Unit Tests

// Declare all imports
import { ethers, upgrades } from 'hardhat';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { progress, progressBlocks, snapshot } from '../helpers/utils';
import Table from 'cli-table';
declare var network: any;
beforeEach(() => {
  chai.should();
  chai.use(chaiAsPromised);
});

// Define global variables
const { expect } = chai;
const minimumBlocksBeforeLiquidation = 7000;
const operatorMaxFeeIncrease = 1000;
const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345';
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765';
let ssvToken: any, ssvRegistry: any, ssvNetwork: any;
let owner: any, account1: any, account2: any, account3: any, account4: any;
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1);
const DAY = 86400;
const operatorIndexes: any = [];
const setOperatorFeePeriod = 0;
const approveOperatorFeePeriod = DAY;

const registerOperator = async (account: string, idx: number, fee: number) => {
  await ssvNetwork.connect(account).registerOperator(`testOperator ${idx}`, operatorsPub[idx], fee);
  operatorIndexes.push({
    fee,
    blockNumber: await ethers.provider.getBlockNumber(),
    index: 0,
    validatorsCount: 0,
    used: 0
  });
}

describe('SSV Network Balances', function () {
  beforeEach(async function () {
    [owner, account1, account2, account3] = await ethers.getSigners();
    const ssvTokenFactory = await ethers.getContractFactory('SSVTokenMock');
    const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
    ssvToken = await ssvTokenFactory.deploy();
    ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
    await ssvToken.deployed();
    await ssvRegistry.deployed();
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease, setOperatorFeePeriod, approveOperatorFeePeriod]);
    await ssvNetwork.deployed();
    await ssvToken.mint(account1.address, '80000000000000000');
  });

  it('Address Balance', async function () {
    const table = new Table({ head: ["", "Block #", "10", "20", "30", "40", "50", "60", "100"] });
    const balancesByBlocks = [""];
    const networkAddFeeByBlocks = [""];
    await snapshot(async () => {
      const chargedAmount = 10000000000000000;
      await ssvToken.connect(account1).approve(ssvNetwork.address, '80000000000000000');
      (await ssvNetwork.updateNetworkFee(100000000000)).wait();
      // Register operators
      await network.provider.send("evm_setAutomine", [false]);
      await registerOperator(account2, 0, 200000000000);
      await registerOperator(account2, 1, 100000000000);
      await registerOperator(account2, 2, 100000000000);
      await registerOperator(account2, 3, 300000000000);

      await progressBlocks(1);

      /*
       block #10
      */
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);
      balancesByBlocks.push(`${+await ssvNetwork.getAddressBalance(account1.address)}`);
      await progressBlocks(10);

      /*
       block #20
      */
      await network.provider.send("evm_setAutomine", [true]);

      balancesByBlocks.push(`${+await ssvNetwork.getAddressBalance(account1.address)}`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

      // Register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount}`)).wait();

      // await progress(4 * DAY, 9);
      await progressBlocks(10);

      /*
       block #30
      */
      balancesByBlocks.push(`${chargedAmount - +await ssvNetwork.getAddressBalance(account1.address)}`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

      await network.provider.send("evm_setAutomine", [false]);
      (await ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 220000000000)).wait();
      (await ssvNetwork.connect(account2).executeOperatorFee(operatorsIds[0])).wait();

      // Register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount}`)).wait();
      await network.provider.send("evm_setAutomine", [true]);

      await progressBlocks(10);

      /*
       block #40
      */
      balancesByBlocks.push(`${2 * chargedAmount - +await ssvNetwork.getAddressBalance(account1.address)}`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

      // Register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[2], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount}`)).wait();

      // await progress(4 * DAY, 9);
      await progressBlocks(9);

      /*
       block #50
      */
      balancesByBlocks.push(`${3 * chargedAmount - +await ssvNetwork.getAddressBalance(account1.address)} (${await ssvNetwork.getAddressBalance(account1.address)})`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);
      await network.provider.send("evm_setAutomine", [false]);
      (await ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 180000000000)).wait();
      (await ssvNetwork.connect(account2).executeOperatorFee(operatorsIds[0])).wait();
      (await ssvNetwork.updateNetworkFee(200000000000)).wait();
      // register validator
      (await ssvNetwork.connect(account1).registerValidator(validatorsPub[3], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), `${chargedAmount}`)).wait();
      await network.provider.send("evm_setAutomine", [true]);

      await progressBlocks(10);

      /*
       block #60
      */
      balancesByBlocks.push(`${4 * chargedAmount - +await ssvNetwork.getAddressBalance(account1.address)} (${await ssvNetwork.getAddressBalance(account1.address)})`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

      await progressBlocks(40);

      /*
       block #100
      */
      balancesByBlocks.push(`${4 * chargedAmount - +await ssvNetwork.getAddressBalance(account1.address)} (${await ssvNetwork.getAddressBalance(account1.address)})`);
      networkAddFeeByBlocks.push(`${+await ssvNetwork.addressNetworkFee(account1.address)}`);

      table.push(
        { 'Acc. Payments': balancesByBlocks },
        { 'Network Fee': networkAddFeeByBlocks }
      );

      console.log(table.toString());
      expect(4 * chargedAmount - +await ssvNetwork.getAddressBalance(account1.address)).to.equal(222280000000000);

    });
  });
});