import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';

before(() => {
  chai.should();
  chai.use(chaiAsPromised);
});

declare var network: any;
declare var ethers: any;
declare var upgrades: any;

const { expect } = chai;

const DAY = 86400;
const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345';
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765';

let ssvToken, ssvRegistry, ssvNetwork;
let owner, account1, account2, account3;
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);

async function snapshot(time, func) {
  const snapshot = await network.provider.send("evm_snapshot");
  await network.provider.send("evm_increaseTime", [time]);
  await network.provider.send("evm_mine", []);
  await func();
  await network.provider.send("evm_revert", [snapshot]);
}

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
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address]);
    await ssvNetwork.deployed();
    await ssvToken.mint(account1.address, '1000000');
  });

  it('register operator', async function() {
    await expect(ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 1))
      .to.emit(ssvRegistry, 'OperatorAdded')
      .withArgs('testOperator 0', account2.address, operatorsPub[0]);
    expect((await ssvRegistry.operatorCount()).toString()).to.equal('1');
  });

  it('register more operators', async function() {
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 2);
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 3);
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 4);

    expect((await ssvRegistry.operatorCount()).toString()).to.equal('4');
  });

  it('revert registry new operator with same public key', async function () {
    await ssvNetwork
      .connect(account3)
      .registerOperator('duplicate operator pubkey', operatorsPub[1], 1)
      .should.eventually.be.rejectedWith('operator with same public key already exists');

    expect((await ssvRegistry.operatorCount()).toString()).to.equal('4');
  });

  it('get operator by public key', async function () {
    expect((await ssvRegistry.operators(operatorsPub[1]))).not.empty;
  });

  it('get operator returns zero address for not existed public key', async function () {
    const [,address,,] = await ssvRegistry.operators(operatorsPub[8]);
    expect(address).to.equal('0x0000000000000000000000000000000000000000');
  });

  it('update operators fee', async function () {
    await expect(ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[0], 5))
      .to.emit(ssvRegistry, 'OperatorFeeUpdated');
    expect((await ssvRegistry.getOperatorCurrentFee(operatorsPub[0])).toString()).to.equal('5');
  });

  it('delete operator', async function () {
    await snapshot(DAY, async() => {
      await expect(ssvNetwork.connect(account2).deleteOperator(operatorsPub[0]))
        .to.emit(ssvRegistry, 'OperatorDeleted')
        .withArgs('testOperator 0', operatorsPub[0]);

      expect((await ssvRegistry.operatorCount()).toString()).to.equal('3');
    });
  });

  it('revert delete operator: operator has validators', async function () {
    await snapshot(DAY, async() => {
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
