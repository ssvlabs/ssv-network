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

let ssvNetwork, ssvRegister;
let owner, account2, account3;

describe('SSVNetwork', function() {
  beforeEach(async function () {
    [owner, account2, account3] = await ethers.getSigners();
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
    const ssvRegisterFactory = await ethers.getContractFactory('SSVRegister');
    ssvNetwork = await ssvNetworkFactory.deploy();
    ssvRegister = await ssvRegisterFactory.deploy();
    await ssvNetwork.deployed();
    await ssvRegister.deployed();
  });
});