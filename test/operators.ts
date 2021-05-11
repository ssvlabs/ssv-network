import { ethers } from 'hardhat';
import { solidity } from 'ethereum-waffle';

import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';

before(() => {
  chai.should();
  chai.use(chaiAsPromised);
});

const { expect } = chai;

const [name1, name2] = ["stakefish", "stakefish2"];
const publicKey = '0xe3c1ad14a84ac273f627e08f961f81211bc2dcce730f40db6e06b6c9adf57598fe1c4b2b7d94bac46b380b67ac9f75dec5e0683bbe063be0bc831c988e48c1a8';
const publicKey2 = '0xab53226da4e3ff35eab810b0dea331732d29baf4d93217f14367bc885adfdde30345a94d494c74cf1f7671b6150f15cf';
let contract;
let account1, account2, account3;

describe('Operators', function() {
  beforeEach(async function () {
    [account1, account2, account3] = await ethers.getSigners();
    const contractFactory = await ethers.getContractFactory('SSVNetwork');
    contract = await contractFactory.deploy();
    await contract.deployed();
  });

  it('Add first operator and emit the event', async function () {
    // Add new operator and check if event was emitted
    await expect(contract.addOperator(name1, account1.address, publicKey))
      .to.emit(contract, 'OperatorAdded')
      .withArgs(name1, account1.address, publicKey);

    // Note that we need to use strings to compare the 256 bit integers
    expect((await contract.operatorCount()).toString()).to.equal('1');
  });

  // Test case
  it('Revert adding new operator with same public key', async function () {
    // Add new operator
    await contract.addOperator(name1, account1.address, publicKey);

    // Try to sttore with duplicated public key
    await contract.addOperator(name2, account2.address, publicKey)
      .should.eventually.be.rejectedWith('Operator with same public key already exists');

    // Note that we need to use strings to compare the 256 bit integers
    expect((await contract.operatorCount()).toString()).to.equal('1');
  });

  // Test case
  it('Get operator by public key', async function () {
    // Add new operator and check if event was emitted
    await expect(contract.addOperator(name2, account2.address, publicKey2 ))
      .to.emit(contract, 'OperatorAdded')
      .withArgs(name2, account2.address, publicKey2);

    // Add new operator and check if event was emitted
    expect((await contract.operators(publicKey2))).not.empty;
  });

  it('Get operator fails for not existed public key', async function () {
    // Add new operator and check if event was emitted
    await expect(contract.addOperator(name2, account2.address, publicKey2))
      .to.emit(contract, 'OperatorAdded')
      .withArgs(name2, account2.address, publicKey2);

    // Add new operator and check if event was emitted
    const [,address,,] = await contract.operators(publicKey);

    expect(address).to.equal('0x0000000000000000000000000000000000000000');
  });

});
