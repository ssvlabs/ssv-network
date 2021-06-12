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

let dex, oldToken, ssvToken;
let owner, account2, account3;
const RATE = 10;
const ssvBalance = '5000000000';
const oldToExchange = '1000000000';
describe('DEX', function() {
  beforeEach(async function () {
    [owner, account2, account3] = await ethers.getSigners();
    const oldTonenFactory = await ethers.getContractFactory('OldToken');
    const ssvTokenFactory = await ethers.getContractFactory('SSVToken');
    oldToken = await oldTonenFactory.deploy();
    ssvToken = await ssvTokenFactory.deploy();
    await oldToken.deployed();
    await ssvToken.deployed();
    const dexFactory = await ethers.getContractFactory('DEX');
    dex = await upgrades.deployProxy(
      dexFactory,
      [oldToken.address, ssvToken.address, RATE],
      { initializer: 'initialize' }
    );  
    await dex.deployed();
    await ssvToken.transfer(dex.address, ssvBalance);
  });

  it('Exchange CDT to SSV', async function () {
    await oldToken.approve(dex.address, oldToExchange);
    await dex.convertCDTToSSV(oldToExchange);
    expect(await oldToken.balanceOf(dex.address)).to.equal(oldToExchange);
  });

  it('Exchange CDT to SSV and back to CDT', async function () {
    await oldToken.approve(dex.address, oldToExchange);
    await dex.convertCDTToSSV(oldToExchange);

    const ssvToExchange = `${+oldToExchange / RATE}`;
    await ssvToken.approve(dex.address, ssvToExchange);
    await dex.convertSSVToCDT(ssvToExchange);
  });

  it('Exchange SSV to CDT fails with not allowed amount', async function () {
    await oldToken.approve(dex.address, oldToExchange);
    await dex.convertCDTToSSV(oldToExchange);

    const ssvToExchange = oldToExchange;
    await ssvToken.approve(dex.address, ssvToExchange);

    await dex.convertSSVToCDT(ssvToExchange)
      .should.eventually.be.rejectedWith("Exchange SSV to CDT tokens in requested amount not allowed.");
  });
});
