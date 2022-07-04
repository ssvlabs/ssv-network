// Validators Unit Tests

// Declare all imports
import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { progressBlocks } from '../helpers/utils'
beforeEach(() => {
  chai.should()
  chai.use(chaiAsPromised)
})
declare var ethers: any
declare var upgrades: any
const { expect } = chai

// Define global variables
const DAY = 86400
const minimumBlocksBeforeLiquidation = 50
const operatorMaxFeeIncrease = 10
const setOperatorFeePeriod = 0
const approveOperatorFeePeriod = DAY
const validatorsPerOperatorLimit = 2000
const registeredOperatorsPerAccountLimit = 10
const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345'
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765'
let ssvToken: any, ssvRegistry: any, ssvNetwork: any
let owner: any, account1: any, account2: any, account3: any, account4: any
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`)
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`)
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1)

describe('Validators', function () {
  beforeEach(async function () {
    [owner, account1, account2, account3] = await ethers.getSigners()
    const ssvTokenFactory = await ethers.getContractFactory('SSVTokenMock')
    const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry')
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork')
    ssvToken = await ssvTokenFactory.deploy()
    ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false })
    await ssvToken.deployed()
    await ssvRegistry.deployed()
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease, setOperatorFeePeriod, approveOperatorFeePeriod, validatorsPerOperatorLimit, registeredOperatorsPerAccountLimit])
    await ssvNetwork.deployed()

    // Mint tokens
    await ssvToken.mint(account1.address, '10000000000')

<<<<<<< HEAD
const minimumBlocksBeforeLiquidation = 50;
const operatorMaxFeeIncrease = 10000;
=======
    // Register operators
    await ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 10000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 20000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 30000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 40000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 4', operatorsPub[4], 50000)
>>>>>>> main

    // Register Validator
    const tokens = '100000000'
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens)
    await expect(
      ssvNetwork.connect(account1)
<<<<<<< HEAD
      .registerValidator(
        validatorsPub[0],
        operatorsIds.slice(0, 4),
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        tokens
      )
    )
    .to.emit(ssvNetwork, 'ValidatorAdded');
=======
        .registerValidator(
          validatorsPub[0],
          operatorsIds.slice(0, 4),
          operatorsPub.slice(0, 4),
          operatorsPub.slice(0, 4),
          tokens
        )).to.emit(ssvRegistry, 'ValidatorAdded')
  })
>>>>>>> main

  it('Get operators by validator', async function () {
    expect((await ssvNetwork.getOperatorsByValidator(validatorsPub[0])).map(String)).to.eql(operatorsIds.slice(0, 4).map(String))
  })

  it('Register validator not enough approved tokens', async function () {
    await ssvNetwork
      .connect(account2)
      .registerValidator(
        validatorsPub[1],
        operatorsIds.slice(0, 4),
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        '10000'
<<<<<<< HEAD
      )
      .should.eventually.be.rejectedWith('insufficient allowance');
=======
      ).should.eventually.be.rejectedWith('transfer amount exceeds balance')
    expect((await ssvRegistry.activeValidatorCount()).toString()).to.equal('1')
  })
>>>>>>> main

  it('Remove validator', async function () {
    await expect(ssvNetwork.connect(account1).removeValidator(validatorsPub[0]))
      .to.emit(ssvRegistry, 'ValidatorRemoved').withArgs(account1.address, validatorsPub[0])
    expect((await ssvRegistry.activeValidatorCount()).toString()).to.equal('0')

<<<<<<< HEAD
  it('update validator', async function() {
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
    await expect(tx).to.emit(ssvNetwork, 'ValidatorRemoved');
    await expect(tx).to.emit(ssvNetwork, 'ValidatorAdded');
  });

  it('revert update validator: not enough approved tokens to pay', async function() {
    await ssvNetwork
      .connect(account1)
      .updateValidator(
        validatorsPub[0],
        operatorsIds.slice(0, 4),
        operatorsPub.slice(0, 4),
        operatorsPub.slice(0, 4),
        '10000'
      )
      .should.eventually.be.rejectedWith('insufficient allowance');
  });
=======
    // Try to remove the validator again
    await ssvNetwork.connect(account1).removeValidator(validatorsPub[0])
      .should.eventually.be.rejectedWith('validator with public key does not exist')
  })

  it('Remove validator non existent key', async function () {
    await ssvNetwork.connect(account2).removeValidator(validatorsPub[1])
      .should.eventually.be.rejectedWith('validator with public key does not exist')
  })
>>>>>>> main

  it('Remove validator sent by non owner', async function () {
    await ssvNetwork.connect(account2).removeValidator(validatorsPub[0])
      .should.eventually.be.rejectedWith('caller is not validator owner')
  })

<<<<<<< HEAD
  it('remove validator', async function () {
    //@ts-ignore
    await progressBlocks(5, async() => {
      await expect(ssvNetwork.connect(account1).removeValidator(validatorsPub[0]))
        .to.emit(ssvNetwork, 'ValidatorRemoved')
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
    await progressBlocks(10000, async() => {
      await ssvNetwork
        .connect(account1)
        .removeValidator(validatorsPub[0])
        .should.eventually.be.rejectedWith('negative balance');
    });
  });
});
=======
  it('Remove validator with not enough SSV', async function () {
    await progressBlocks(10000)
    await ssvNetwork.connect(account1).removeValidator(validatorsPub[0])
      .should.eventually.be.rejectedWith('negative balance')
  })
})
>>>>>>> main
