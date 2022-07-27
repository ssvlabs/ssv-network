// Validators Registration Unit Tests

// Declare all imports
import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
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
const tokens = '8000000000000000'

describe('Validator Registration', function () {
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
    await ssvToken.mint(account1.address, '80000000000000000')

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

  it('Get operators by validator', async function () {
    expect((await ssvNetwork.getOperatorsByValidator(validatorsPub[0])).map(String)).to.eql(operatorsIds.slice(0, 4).map(String))
  })

  it('Register validator errors', async function () {
    // Register validator not enough approved tokens
    await ssvToken.connect(account1).transfer(account2.address, tokens);
    await ssvNetwork.connect(account2).registerValidator(
      validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), '10000')
      .should.eventually.be.rejectedWith('ERC20: insufficient allowance')

    // Register validator not enough tokens
    await ssvToken.connect(account1).approve(ssvNetwork.address, 1);
    await ssvNetwork.connect(account2).registerValidator(
      validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), '10000')
      .should.eventually.be.rejectedWith('ERC20: insufficient allowance')

    // Register validator invalid public key
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens);
    await ssvNetwork.connect(account2).registerValidator(
      '0x894350h3498345h', operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), '10000')
      .should.eventually.be.rejectedWith('invalid arrayify value')

    // Register validator invalid operator ids
    await ssvNetwork.connect(account2).registerValidator(
      validatorsPub[1], operatorsIds.slice(3, 7), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), '10000')
      .should.eventually.be.rejectedWith('OperatorDeleted')

    // Register validator invalid shares
    await ssvNetwork.connect(account2).registerValidator(
      validatorsPub[1], operatorsIds.slice(0, 4), ['0x89435h3498345h', '0x89435h3398345h', '0x89435h3441345h', '0x89435h3498d45h'], operatorsPub.slice(0, 4), '10000')
      .should.eventually.be.rejectedWith('invalid arrayify value')

    // Register validator invalid enrypted keys
    await ssvNetwork.connect(account2).registerValidator(
      validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), ['0x89435h3498345h', '0x89435h3398345h', '0x89435h3441345h', '0x89435h3498d45h'], '10000')
      .should.eventually.be.rejectedWith('invalid arrayify value')

    // Register validator invalid amount
    await ssvNetwork.connect(account2).registerValidator(
      validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), ['0x89435h3498345h', '0x89435h3398345h', '0x89435h3441345h', '0x89435h3498d45h'], 1)
      .should.eventually.be.rejectedWith('invalid arrayify value')

    expect((await ssvRegistry.activeValidatorCount()).toString()).to.equal('1')
  })
})
