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

async function progressBlocks(blocks) {
  for (let i = 0; i < blocks; ++i) {
    await network.provider.send("evm_mine", []);
  }
}

describe('Validators', function() {
  before(async function () {
    [owner, account1, account2, account3] = await ethers.getSigners();
    const ssvTokenFactory = await ethers.getContractFactory('SSVToken');
    const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
    ssvToken = await upgrades.deployProxy(ssvTokenFactory, []);
    ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
    await ssvToken.deployed();
    await ssvRegistry.deployed();
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address]);
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
    const tokens = '100';
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

  it('revert register validator: not enough approved tokens to pay', async function() {
    await ssvNetwork
      .connect(account2)
      .registerValidator(
        validatorsPub[0],
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        '100'
      )
      .should.eventually.be.rejectedWith('Not enough approved tokes to transfer');

    expect((await ssvRegistry.validatorCount()).toString()).to.equal('1');
  });

  it('revert register validator: not enough approved tokens to pay', async function() {
    await ssvNetwork
      .connect(account2)
      .registerValidator(
        validatorsPub[0],
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        '100'
      )
      .should.eventually.be.rejectedWith('Not enough approved tokes to transfer');

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
      .should.eventually.be.rejectedWith('Not enough approved tokes to transfer');
  });

  it('revert update validator: tx was sent not by owner', async function() {
    const tokens = '100';
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
      .should.eventually.be.rejectedWith('Caller is not validator owner');
  });

  it('delete validator', async function () {
    await snapshot(DAY, async() => {
      await expect(ssvNetwork.connect(account1).deleteValidator(validatorsPub[0]))
        .to.emit(ssvRegistry, 'ValidatorDeleted')
        .withArgs(account1.address, validatorsPub[0]);

      expect((await ssvRegistry.validatorCount()).toString()).to.equal('0');
    });
  });

  it('revert delete validator: public key is not exists', async function () {
    await ssvNetwork
      .connect(account2)
      .deleteValidator(validatorsPub[1])
      .should.eventually.be.rejectedWith('Validator with public key is not exists');
  });

  it('revert delete validator: tx was sent not by owner', async function () {
    await ssvNetwork
      .connect(account2)
      .deleteValidator(validatorsPub[0])
      .should.eventually.be.rejectedWith('Caller is not validator owner');
  });

  it('revert delete validator: not enough balance', async function () {
    await snapshot(DAY, async() => {
      await ssvNetwork
        .connect(account1)
        .deleteValidator(validatorsPub[0])
        .should.eventually.be.rejectedWith('Not enough balance');      
    });
  });
});
