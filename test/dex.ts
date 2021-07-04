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
    const oldTokenFactory = await ethers.getContractFactory('OldTokenMock');
    const ssvTokenFactory = await ethers.getContractFactory('SSVTokenMock');
    oldToken = await upgrades.deployProxy(oldTokenFactory);
    ssvToken = await upgrades.deployProxy(ssvTokenFactory);
    await oldToken.deployed();
    await ssvToken.deployed();
    const dexFactory = await ethers.getContractFactory('DEX');
    dex = await upgrades.deployProxy(
      dexFactory,
      [oldToken.address, ssvToken.address, RATE]
    );
    await dex.deployed();
    await ssvToken.transfer(dex.address, ssvBalance);
  });

  it('Exchange CDT to SSV', async function () {
    await oldToken.approve(dex.address, oldToExchange);
    await dex.convertCDTToSSV(oldToExchange);
    expect(await oldToken.balanceOf(dex.address)).to.equal(oldToExchange);
  });
});
