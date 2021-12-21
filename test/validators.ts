import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { progressBlocks, snapshot } from './utils';

before(() => {
  chai.should();
  chai.use(chaiAsPromised);
});

declare var network: any;
declare var ethers: any;
declare var upgrades: any;

const { expect } = chai;

const DAY = 86400;

const minimumBlocksBeforeLiquidation = 50;
const operatorMaxFeeIncrease = 10;

const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345';
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765';

let ssvToken, ssvRegistry, ssvNetwork;
let owner, account1, account2, account3;
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);

describe('Validators', function() {
  before(async function () {
    [owner, account1, account2, account3] = await ethers.getSigners();
    const ssvTokenFactory = await ethers.getContractFactory('SSVToken');
    const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
    ssvToken = await ssvTokenFactory.deploy();
    ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
    await ssvToken.deployed();
    await ssvRegistry.deployed();
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease]);
    await ssvNetwork.deployed();
    await ssvToken.mint(account1.address, '1000000');

    // register operators
    await ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 1);
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 2);
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 3);
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 4);
    await ssvNetwork.connect(account3).registerOperator('testOperator 4', operatorsPub[4], 5);
  });

  it('register validator', async function() {
    const tokens = '10000';
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens);
    await expect(
      ssvNetwork.connect(account1)
      .registerValidator(
        validatorsPub[0],
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        tokens
      )
    )
    .to.emit(ssvRegistry, 'ValidatorAdded');

    expect((await ssvRegistry.validatorCount()).toString()).to.equal('1');
  });

  it('get operators by validator', async function() {
    expect(await ssvNetwork.getOperatorsByValidator(validatorsPub[0])).to.eql(operatorsPub.slice(0, 4));
  });

  it('revert register validator: not enough approved tokens to pay', async function() {
    await ssvNetwork
      .connect(account2)
      .registerValidator(
        validatorsPub[1],
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        '10000'
      )
      .should.eventually.be.rejectedWith('transfer amount exceeds balance');

    expect((await ssvRegistry.validatorCount()).toString()).to.equal('1');
  });

  it('update validator', async function() {
    const tokens = '100';
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens);
    await expect(
      ssvNetwork
        .connect(account1)
        .updateValidator(
          validatorsPub[0],
          operatorsPub.slice(0, 4),
          operatorsPub.slice(0, 4),
          operatorsPub.slice(0, 4),
          tokens
        )
    )
    .to.emit(ssvRegistry, 'ValidatorUpdated');
  });

  it('revert update validator: not enough approved tokens to pay', async function() {
    await ssvNetwork
      .connect(account1)
      .updateValidator(
        validatorsPub[0],
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        '10000'
      )
      .should.eventually.be.rejectedWith('transfer amount exceeds allowance');
  });

  it('revert update validator: tx was sent not by owner', async function() {
    const tokens = '10000';
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens);
    await ssvNetwork
      .connect(account2)
      .updateValidator(
        validatorsPub[0],
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        tokens
      )
      .should.eventually.be.rejectedWith('caller is not validator owner');
  });

  it('remove validator', async function () {
    await progressBlocks(5, async() => {
      await expect(ssvNetwork.connect(account1).removeValidator(validatorsPub[0]))
        .to.emit(ssvRegistry, 'ValidatorRemoved')
        .withArgs(account1.address, validatorsPub[0]);

      expect((await ssvRegistry.validatorCount()).toString()).to.equal('0');
    });
  });

  it('revert remove validator: public key does not exist', async function () {
    await ssvNetwork
      .connect(account2)
      .removeValidator(validatorsPub[1])
      .should.eventually.be.rejectedWith('validator with public key does not exist');
  });

  it('revert remove validator: tx was sent not by owner', async function () {
    await ssvNetwork
      .connect(account2)
      .removeValidator(validatorsPub[0])
      .should.eventually.be.rejectedWith('caller is not validator owner');
  });

  it('revert remove validator: not enough balance', async function () {
    await progressBlocks(10000, async() => {
      await ssvNetwork
        .connect(account1)
        .removeValidator(validatorsPub[0])
        .should.eventually.be.rejectedWith('negative balance');
    });
  });
});
