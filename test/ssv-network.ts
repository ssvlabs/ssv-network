import { ethers, upgrades } from 'hardhat';
import { solidity } from 'ethereum-waffle';

import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { rawListeners } from 'process';

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
  });

  it('register operator', async function() {
    await ssvNetwork.connect(account2).registerOperator("testOperator 0", operatorsPub[0], 1);
  });
  it('register more operators', async function() {
    for (let index = 1; index < 4; ++index) {
      await ssvNetwork.connect(account2).registerOperator(`testOperator ${index}`, operatorsPub[index], index + 1);
    }
  });
  it('register validator', async function() {
    await ssvToken.connect(account1).approve(ssvNetwork.address, '10000');
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), '10000');
  });
});
