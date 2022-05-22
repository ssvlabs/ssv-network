// Validator Unit Test

// Declare all imports
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { progressBlocks, snapshot } from '../helpers/utils';

beforeEach(() => {
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

const setOperatorFeePeriod = 0;
const approveOperatorFeePeriod = DAY;
const validatorsPerOperatorLimit = 2000;

const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345';
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765';

//@ts-ignore
let ssvToken: any, ssvRegistry: any, ssvNetwork: any;
//@ts-ignore
let owner: any, account1: any, account2: any, account3: any, account4: any;

const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1);

describe('Validators', function () {
  beforeEach(async function () {
    [owner, account1, account2, account3] = await ethers.getSigners();
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

    // register operators
    await ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 10000);
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 20000);
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 30000);
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 40000);
    await ssvNetwork.connect(account3).registerOperator('testOperator 4', operatorsPub[4], 50000);
  });

  it('register validator', async function () {
    const tokens = '100000000';
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens);
    await expect(
      ssvNetwork.connect(account1)
        .registerValidator(
          validatorsPub[0],
          operatorsIds.slice(0, 4),
          operatorsPub.slice(0, 4),
          operatorsPub.slice(0, 4),
          tokens
        )
    )
      .to.emit(ssvRegistry, 'ValidatorAdded');

    expect((await ssvRegistry.activeValidatorCount()).toString()).to.equal('1');
  });

  it('get operators by validator', async function () {
    //@ts-ignore
    expect((await ssvNetwork.getOperatorsByValidator(validatorsPub[0])).map(v => v.toString())).to.eql(operatorsIds.slice(0, 4).map(v => v.toString()));
  });

  it('revert register validator: not enough approved tokens to pay', async function () {
    await ssvNetwork
      .connect(account2)
      .registerValidator(
        validatorsPub[1],
        operatorsIds.slice(0, 4),
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        '10000'
      )
      .should.eventually.be.rejectedWith('transfer amount exceeds balance');

    expect((await ssvRegistry.activeValidatorCount()).toString()).to.equal('1');
  });

  it('update validator', async function () {
    const tokens = '100';
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens);
    const tx = ssvNetwork
      .connect(account1)
      .updateValidator(
        validatorsPub[0],
        operatorsIds.slice(0, 4),
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        tokens
      );
    await expect(tx).to.emit(ssvRegistry, 'ValidatorRemoved');
    await expect(tx).to.emit(ssvRegistry, 'ValidatorAdded');
  });

  it('revert update validator: not enough approved tokens to pay', async function () {
    await ssvNetwork
      .connect(account1)
      .updateValidator(
        validatorsPub[0],
        operatorsIds.slice(0, 4),
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        '10000'
      )
      .should.eventually.be.rejectedWith('transfer amount exceeds allowance');
  });

  it('revert update validator: tx was sent not by owner', async function () {
    const tokens = '10000';
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens);
    await ssvNetwork
      .connect(account2)
      .updateValidator(
        validatorsPub[0],
        operatorsIds.slice(0, 4),
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        tokens
      )
      .should.eventually.be.rejectedWith('caller is not validator owner');
  });

  it('remove validator', async function () {
    //@ts-ignore
    await progressBlocks(5, async () => {
      await expect(ssvNetwork.connect(account1).removeValidator(validatorsPub[0]))
        .to.emit(ssvRegistry, 'ValidatorRemoved')
        .withArgs(account1.address, validatorsPub[0]);

      expect((await ssvRegistry.activeValidatorCount()).toString()).to.equal('0');
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
    //@ts-ignore
    await progressBlocks(10000, async () => {
      await ssvNetwork
        .connect(account1)
        .removeValidator(validatorsPub[0])
        .should.eventually.be.rejectedWith('negative balance');
    });
  });
});
