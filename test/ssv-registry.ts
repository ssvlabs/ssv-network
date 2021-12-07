import { ethers, upgrades } from 'hardhat';
import { solidity } from 'ethereum-waffle';

import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { rawListeners } from 'process';

import { progressBlocks, progressTime, snapshot } from './utils';

declare var network: any;

before(() => {
  chai.should();
  chai.use(chaiAsPromised);
});

const { expect } = chai;

const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345';
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765';

let ssvRegistry;
let owner, account1, account2, account3;
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);

describe('SSV Registry', function() {
  before(async function () {
    [owner, account1, account2, account3] = await ethers.getSigners();
    const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
    ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory);
    await ssvRegistry.deployed();
    await ssvRegistry.registerOperator('testOperator 0', account1.address, operatorsPub[0], 10);
    await ssvRegistry.registerOperator('testOperator 1', account1.address, operatorsPub[1], 20);
    await ssvRegistry.registerOperator('testOperator 2', account1.address, operatorsPub[2], 30);
    await ssvRegistry.registerOperator('testOperator 3', account2.address, operatorsPub[3], 40);
    await ssvRegistry.registerOperator('testOperator 4', account2.address, operatorsPub[4], 50);
    await ssvRegistry.registerValidator(account1.address, validatorsPub[0], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4));
    await ssvRegistry.registerValidator(account1.address, validatorsPub[1], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4));
    await ssvRegistry.registerValidator(account2.address, validatorsPub[2], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4));
  });

  it('register 0x0 validator', async () => {
    await expect(ssvRegistry.registerValidator("0x0000000000000000000000000000000000000000", validatorsPub[3], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4))).to.be.revertedWith('owner address invalid');
  });

  it('register validators with errors', async () => {
    await expect(ssvRegistry.registerValidator(account3.address, "0x12345678", operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4))).to.be.revertedWith('invalid public key length');
    await expect(ssvRegistry.registerValidator(account3.address, validatorsPub[3], operatorsPub.slice(0, 3), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4))).to.be.revertedWith('OESS data structure is not valid');
    await expect(ssvRegistry.registerValidator(account3.address, validatorsPub[3], operatorsPub.slice(0, 4), operatorsPub.slice(0, 3), operatorsPub.slice(0, 4))).to.be.revertedWith('OESS data structure is not valid');
    await expect(ssvRegistry.registerValidator(account3.address, validatorsPub[3], operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 3))).to.be.revertedWith('OESS data structure is not valid');
    await expect(ssvRegistry.registerValidator(account3.address, validatorsPub[3], operatorsPub.slice(0, 1), operatorsPub.slice(0, 1), operatorsPub.slice(0, 1))).to.be.revertedWith('OESS data structure is not valid');
    await expect(ssvRegistry.registerValidator(account3.address, validatorsPub[3], operatorsPub.slice(0, 3), operatorsPub.slice(0, 3), operatorsPub.slice(0, 3))).to.be.revertedWith('OESS data structure is not valid');
    await ssvRegistry.registerValidator(account3.address, validatorsPub[3], operatorsPub.slice(0, 7), operatorsPub.slice(0, 7), operatorsPub.slice(0, 7));
  });

  it('deactivate an operator', async () => {
    await expect(ssvRegistry.activateOperator(operatorsPub[0])).to.be.revertedWith('already active');
    await ssvRegistry.deactivateOperator(operatorsPub[0]);
    await expect(ssvRegistry.deactivateOperator(operatorsPub[0])).to.be.revertedWith('already inactive');
    await ssvRegistry.activateOperator(operatorsPub[0]);
    await expect(ssvRegistry.activateOperator(operatorsPub[0])).to.be.revertedWith('already active');
  });

  it('deactivate an operator', async () => {
    await expect(ssvRegistry.activateValidator(validatorsPub[0])).to.be.revertedWith('already active');
    await ssvRegistry.deactivateValidator(validatorsPub[0]);
    await expect(ssvRegistry.deactivateValidator(validatorsPub[0])).to.be.revertedWith('already inactive');
    await ssvRegistry.activateValidator(validatorsPub[0]);
    await expect(ssvRegistry.activateValidator(validatorsPub[0])).to.be.revertedWith('already active');
  });

  it('validators getter', async () => {
    expect((await ssvRegistry.validators(validatorsPub[0])).map(v => v.toString())).to.eql([account1.address, validatorsPub[0], 'true', '0']);
    expect((await ssvRegistry.validators(validatorsPub[1])).map(v => v.toString())).to.eql([account1.address, validatorsPub[1], 'true', '1']);
    expect((await ssvRegistry.validators(validatorsPub[2])).map(v => v.toString())).to.eql([account2.address, validatorsPub[2], 'true', '0']);
  });

  it('get validators by address', async () => {
    expect(await ssvRegistry.getValidatorsByAddress(account1.address)).to.eql([validatorsPub[0], validatorsPub[1]]);
    expect(await ssvRegistry.getValidatorsByAddress(account2.address)).to.eql([validatorsPub[2]]);
  });

  it('get validator owner', async () => {
    expect(await ssvRegistry.getValidatorOwner(validatorsPub[0])).to.equal(account1.address);
    expect(await ssvRegistry.getValidatorOwner(validatorsPub[2])).to.equal(account2.address);
  });

  it('disable owner validators', async () => {
    expect(await ssvRegistry.isOwnerValidatorsDisabled(account1.address)).to.equal(false);
    await ssvRegistry.disableOwnerValidators(account1.address);
    expect(await ssvRegistry.isOwnerValidatorsDisabled(account1.address)).to.equal(true);
  })

  it('enable owner validators', async () => {
    expect(await ssvRegistry.isOwnerValidatorsDisabled(account1.address)).to.equal(true);
    await ssvRegistry.enableOwnerValidators(account1.address);
    expect(await ssvRegistry.isOwnerValidatorsDisabled(account1.address)).to.equal(false);
  })
});