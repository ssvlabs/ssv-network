import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { progressTime } from './utils';

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

const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345';
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765';

let ssvToken, ssvRegistry, ssvNetwork;
let owner, account1, account2, account3;
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);

describe('Operators', function() {
  before(async function () {
    [owner, account1, account2, account3] = await ethers.getSigners();
    const ssvTokenFactory = await ethers.getContractFactory('SSVToken');
    const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
    ssvToken = await ssvTokenFactory.deploy();
    ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
    await ssvToken.deployed();
    await ssvRegistry.deployed();
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation]);
    await ssvNetwork.deployed();
    await ssvToken.mint(account1.address, '1000000');
  });

  it('register operator', async function() {
    await expect(ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 100))
      .to.emit(ssvRegistry, 'OperatorAdded')
      .withArgs('testOperator 0', account2.address, operatorsPub[0]);
    expect((await ssvRegistry.operatorCount()).toString()).to.equal('1');
  });

  it('register more operators', async function() {
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 2);
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 3);
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 4);

    await progressTime(4 * DAY);

    expect((await ssvRegistry.operatorCount()).toString()).to.equal('4');
  });

  it('revert registry new operator with same public key', async function () {
    await ssvNetwork
      .connect(account3)
      .registerOperator('duplicate operator pubkey', operatorsPub[1], 1)
      .should.eventually.be.rejectedWith('operator with same public key already exists');

    expect((await ssvRegistry.operatorCount()).toString()).to.equal('4');
  });

  it('get operator returns zero address for not existed public key', async function () {
    const [,address,,] = await ssvRegistry.operators(operatorsPub[8]);
    expect(address).to.equal('0x0000000000000000000000000000000000000000');
  });

  it('update operators fee', async function () {
    await progressTime(DAY, async() => {
      await expect(ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[0], 105))
        .to.emit(ssvRegistry, 'OperatorFeeUpdated');
        expect((await ssvRegistry.getOperatorCurrentFee(operatorsPub[0])).toString()).to.equal('105');
    });
  });

  /*
  it('update operators fee in 72 hours for 10% more', async function () {
    await progressTime(DAY, async() => {
      await ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[0], 105);
      await progressTime(4 * DAY);
      await ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[0], 110);
      expect((await ssvRegistry.getOperatorCurrentFee(operatorsPub[0])).toString()).to.equal('110');
    });
  });

  it('update operators fee less than in 72 hours fail', async function () {
    await progressTime(DAY, async() => {
      await ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[0], 105);
      await progressTime(DAY);
      await expect(ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[0], 110)).to.be.revertedWith('fee updated in last 72 hours');
    });
  });
  */

  it('update operators score fails for not owner', async function () {
    await ssvNetwork
      .connect(account2)
      .updateOperatorScore(operatorsPub[0], 105)
      .should.eventually.be.rejectedWith('caller is not the owner');
  });

  it('update operators score', async function () {
    await expect(ssvNetwork.connect(owner).updateOperatorScore(operatorsPub[0], 105))
      .to.emit(ssvRegistry, 'OperatorScoreUpdated');
  });

  it('delete operator', async function () {
    await progressTime(DAY, async() => {
      await expect(ssvNetwork.connect(account2).deleteOperator(operatorsPub[0]))
        .to.emit(ssvRegistry, 'OperatorDeleted')
        .withArgs(account2.address, operatorsPub[0]);

      expect((await ssvRegistry.operatorCount()).toString()).to.equal('3');
    });
  });

  it('revert delete operator: operator has validators', async function () {
    await progressTime(DAY, async() => {
      await ssvToken.connect(account1).approve(ssvNetwork.address, '10000');
      await ssvNetwork.connect(account1).registerValidator(
        validatorsPub[0],
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        '10000'
      );

      await ssvNetwork
        .connect(account2)
        .deleteOperator(operatorsPub[0])
        .should.eventually.be.rejectedWith('operator has validators');

      expect((await ssvRegistry.operatorCount()).toString()).to.equal('4');
    });
  });

  it('revert delete operator: public key does not exist', async function () {
    await ssvNetwork
      .connect(account3)
      .deleteOperator(operatorsPub[6])
      .should.eventually.be.rejectedWith('operator with public key does not exist');
  });

  it('revert delete operator: tx was sent not by owner', async function () {
    await ssvNetwork
      .connect(account3)
      .deleteOperator(operatorsPub[0])
      .should.eventually.be.rejectedWith('caller is not operator owner');
  });

  it('revert get fee: operator does not exist', async function() {
    await expect(ssvRegistry.getOperatorCurrentFee(operatorsPub[4])).to.be.revertedWith('operator not found');
  });
});
