import { ethers } from 'hardhat';
import { solidity } from 'ethereum-waffle';

import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';

before(() => {
  chai.should();
  chai.use(chaiAsPromised);
});

const { expect } = chai;

let Contract;
let contract;

/*
const hexToString = (hex) => {
  var str = '';
	for (var n = 0; n < hex.length; n += 2) {
		str += String.fromCharCode(parseInt(hex.substr(n, 2), 16));
	}
  return;
}
*/

describe('Operators', function() {
  beforeEach(async function () {
    Contract = await ethers.getContractFactory('SSVNetwork');
    contract = await Contract.deploy();
    await contract.deployed();
  });
 
  // Test case
  it('Add first operator and emit the event', async function () {
    // Store a value
    const [name, pubKey, paymentAddress] = [
      'stakefish',
      'e3c1ad14a84ac273f627e08f961f81211bc2dcce730f40db6e06b6c9adf57598fe1c4b2b7d94bac46b380b67ac9f75dec5e0683bbe063be0bc831c988e48c1a8',
      '0xe52350A8335192905359c4c3C2149976dCC3D8bF'
    ];
    // Add new operator and check if event was emitted
    await expect(contract.addOperator(name, pubKey, paymentAddress))
      .to.emit(contract, 'OperatorAdded')
      .withArgs(name, `0x${Buffer.from(pubKey, 'utf8').toString('hex')}`, paymentAddress);

    // Note that we need to use strings to compare the 256 bit integers
    expect((await contract.operatorCount()).toString()).to.equal('1');    
  });

  // Test case
  it('Revert adding new operator with same pubkey', async function () {
    const pubKey = 'e3c1ad14a84ac273f627e08f961f81211bc2dcce730f40db6e06b6c9adf57598fe1c4b2b7d94bac46b380b67ac9f75dec5e0683bbe063be0bc831c988e48c1a8';
    // Store new
    await contract.addOperator('stakefish', pubKey, '0xe52350A8335192905359c4c3C2149976dCC3D8bF');

    // Try to sttore with duplicated public key
    await contract.addOperator('stakefishRenamed', pubKey, '0x8b3d89d1bdb347e194b220201507c43de971ee1e')
      .should.eventually.be.rejectedWith('Operator with same public key already exists');

    // Note that we need to use strings to compare the 256 bit integers
    expect((await contract.operatorCount()).toString()).to.equal('1');
  });

  // Test case
  it('Get operator by public key', async function () {
    const [name, pubKey, paymentAddress] = [
      'stakefish2',
      'ab53226da4e3ff35eab810b0dea331732d29baf4d93217f14367bc885adfdde30345a94d494c74cf1f7671b6150f15cf',
      '0xe52350A8335192905359c4c3C2149976dCC3D8bF'
    ];
    // Add new operator and check if event was emitted
    await expect(contract.addOperator(name, pubKey, paymentAddress))
      .to.emit(contract, 'OperatorAdded')
      .withArgs(name, `0x${Buffer.from(pubKey, 'utf8').toString('hex')}`, paymentAddress);

    // Add new operator and check if event was emitted
    expect((await contract.getOperator(pubKey))).not.empty;
  });

  it('Get operator fails for not existed public key', async function () {
    const [name, pubKey, paymentAddress] = [
      'stakefish2',
      'ab53226da4e3ff35eab810b0dea331732d29baf4d93217f14367bc885adfdde30345a94d494c74cf1f7671b6150f15cf',
      '0xe52350A8335192905359c4c3C2149976dCC3D8bF'
    ];
    // Add new operator and check if event was emitted
    await expect(contract.addOperator(name, pubKey, paymentAddress))
      .to.emit(contract, 'OperatorAdded')
      .withArgs(name, `0x${Buffer.from(pubKey, 'utf8').toString('hex')}`, paymentAddress);

    // Add new operator and check if event was emitted
    await contract.getOperator('ab53226da4e3ff35eab810b0dea331732d29baf4d93217f14367bc885adfdde30345a94d494c74cf1f7671b6150f15cs')
      .should.eventually.be.rejectedWith('Operator with public key not exists');
  });

});
