// Operator Unit Test

// Declare all imports
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { progressTime } from '../helpers/utils';
beforeEach(() => {
  chai.should();
  chai.use(chaiAsPromised);
});

// Define global variables
declare const ethers: any;
declare const upgrades: any;
const { expect } = chai;
const DAY = 86400;
const minimumBlocksBeforeLiquidation = 50;
const operatorMaxFeeIncrease = 10;
const setOperatorFeePeriod = 0;
const approveOperatorFeePeriod = DAY;
const validatorsPerOperatorLimit = 2000;
const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345';
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765';
let ssvToken: any, ssvRegistry: any, ssvNetwork: any;
let owner: any, account1: any, account2: any, account3: any
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1);

describe('Operators', function () {
  beforeEach(async function () {
    // Create accounts
    [owner, account1, account2, account3] = await ethers.getSigners();

    // Deploy Contracts 
    const ssvTokenFactory = await ethers.getContractFactory('SSVTokenMock');
    const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
    ssvToken = await ssvTokenFactory.deploy();
    ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
    await ssvToken.deployed();
    await ssvRegistry.deployed();
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease, setOperatorFeePeriod, approveOperatorFeePeriod, validatorsPerOperatorLimit]);
    await ssvNetwork.deployed();

    // Mint tokens
    await ssvToken.mint(account1.address, '10000000000');

    // Register operators
    await expect(ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 1000000))
      .to.emit(ssvNetwork, 'OperatorAdded')
      .withArgs(operatorsIds[0], 'testOperator 0', account2.address, operatorsPub[0], 1000000);
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 20000);
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 30000);
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 40000);
  });

  it('Try to register operator with same public key', async function () {
    await ssvNetwork
      .connect(account3)
      .registerOperator('duplicate operator pubkey', operatorsPub[1], 10000)
      .should.eventually.be.rejectedWith('operator with same public key already exists');
  });

  it('Get operator returns correct', async function () {
    // Existing operator
    let [, address, , ,] = await ssvRegistry.operators(operatorsIds[1]);
    expect(address).to.equal(account2.address);

    // Non-existing operator
    [, address, , ,] = await ssvRegistry.operators(operatorsIds[8]);
    expect(address).to.equal('0x0000000000000000000000000000000000000000');
  });

  it('Update operators score', async function () {
    // Update as the owner
    await expect(ssvNetwork.connect(owner).updateOperatorScore(operatorsIds[0], 105))
      .to.emit(ssvRegistry, 'OperatorScoreUpdated');

    // Update as non-owner to get error
    await ssvNetwork
      .connect(account2)
      .updateOperatorScore(operatorsIds[0], 105)
      .should.eventually.be.rejectedWith('caller is not the owner');
  });

  it('Remove operator', async function () {
    // Remove the operator
    await progressTime(DAY)
    await expect(ssvNetwork.connect(account2).removeOperator(operatorsIds[0]))
      .to.emit(ssvRegistry, 'OperatorRemoved')
      .withArgs(operatorsIds[0], account2.address, operatorsPub[0]);

    // Try to remove non-existent operator
    await ssvNetwork
      .connect(account3)
      .removeOperator(operatorsIds[6])
      .should.eventually.be.rejectedWith('operator with public key does not exist');

    // Remove operator: tx was sent as non-owner
    await ssvNetwork
      .connect(account3)
      .removeOperator(operatorsIds[1])
      .should.eventually.be.rejectedWith('caller is not operator owner');
  });

  it('update operators fee', async function () {
    await progressTime(DAY)
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 1050000)
    expect(await ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[0]))
      .to.emit(ssvRegistry, 'OperatorFeeUpdated');
    expect((await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])).toString()).to.equal('1050000');



    // Try to change fee higher than 10%
    // Change operator percentage fee raise to 20
    // Try to raise higher than 20
    // raise 20 and make sure its raised
    // decrease 70%
    // try to raise again
    // revert fee
    // setOperatorFee incorrect user
  });

  it('Get operator Fee', async function () {
    // Get current operator fee
    expect((await ssvRegistry.getOperatorCurrentFee(operatorsIds[1])).toString()).to.equal('20000')

    // Non existent operator
    await expect(ssvRegistry.getOperatorCurrentFee(operatorsIds[4])).to.be.revertedWith('operator not found');
  });









  it('update operators fee less than in 72 hours fail', async function () {
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[1], 105);
    await progressTime(DAY)
    await expect(ssvNetwork.connect(account2).setOperatorFee(operatorsIds[1], 110)).to.be.revertedWith('fee updated in last 72 hours');
    // WHAT IS FEE IS TOO LOW
  });
  it('update operators fee less than in 72 hours fail', async function () {
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 1005000);
    await progressTime(DAY)
    await expect(ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 1005400)).to.be.revertedWith('fee updated in last 72 hours');
    // INCORRET SHOULD BE ALLOWED
  });
});
