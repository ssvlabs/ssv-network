// Validator Remove Unit Tests

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
const minimumBlocksBeforeLiquidation = 7000
const operatorMaxFeeIncrease = 10
const setOperatorFeePeriod = 0
const approveOperatorFeePeriod = DAY
const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345'
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765'
let ssvToken: any, ssvRegistry: any, ssvNetwork: any
let owner: any, account1: any, account2: any, account3: any
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`)
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`)
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1)

describe('Validator Removal', function () {
  beforeEach(async function () {
    [owner, account1, account2, account3] = await ethers.getSigners()
    const ssvTokenFactory = await ethers.getContractFactory('SSVTokenMock')
    const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry')
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork')
    ssvToken = await ssvTokenFactory.deploy()
    ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false })
    await ssvToken.deployed()
    await ssvRegistry.deployed()
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease, setOperatorFeePeriod, approveOperatorFeePeriod])
    await ssvNetwork.deployed()

    // Mint tokens
    const tokens = '10501500000000000'
    await ssvToken.mint(account1.address, tokens)

    // Register operators
    await ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 100000000000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 200000000000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 300000000000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 400000000000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 4', operatorsPub[4], 500000000000)

    // Register Validator
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens)
    await expect(ssvNetwork.connect(account1).registerValidator(
      validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens))
      .to.emit(ssvNetwork, 'ValidatorRegistration')
  })

  it('Remove validator', async function () {
    await expect(ssvNetwork.connect(account1).removeValidator(validatorsPub[0]))
      .to.emit(ssvNetwork, 'ValidatorRemoval').withArgs(account1.address, validatorsPub[0])
    expect((await ssvRegistry.activeValidatorCount()).toString()).to.equal('0')

    // Try to remove the validator again
    await ssvNetwork.connect(account1).removeValidator(validatorsPub[0])
      .should.eventually.be.rejectedWith('ValidatorWithPublicKeyNotExist')
  })

  it('Remove validator non existent key', async function () {
    await ssvNetwork.connect(account2).removeValidator(validatorsPub[1])
      .should.eventually.be.rejectedWith('ValidatorWithPublicKeyNotExist')
  })

  it('Remove validator sent by non owner', async function () {
    await ssvNetwork.connect(account2).removeValidator(validatorsPub[0])
      .should.eventually.be.rejectedWith('CallerNotValidatorOwner')
  })

  it('Remove validator with not enough SSV', async function () {
    await ssvNetwork.connect(account1).withdraw('2501500000000000');
    await progressBlocks(8000);
    await ssvNetwork.connect(account1).removeValidator(validatorsPub[0])
      .should.eventually.be.rejectedWith('NegativeBalance')
  })

  // Need to update once functionality added
  // it('Remove validator as DAO', async function () {
  //   await expect(ssvNetwork.connect(owner).removeValidator(validatorsPub[0]))
  //     .to.emit(ssvRegistry, 'ValidatorRemoved').withArgs(account1.address, validatorsPub[0])
  //   expect((await ssvRegistry.activeValidatorCount()).toString()).to.equal('0')
  // })
})
