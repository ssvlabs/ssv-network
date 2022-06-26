// Operator Register Unit Tests

// Declare all imports
import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
beforeEach(() => {
  chai.should()
  chai.use(chaiAsPromised)
})

// Define global variables
declare const ethers: any
declare const upgrades: any
const { expect } = chai
const DAY = 86400
const minimumBlocksBeforeLiquidation = 50
const operatorMaxFeeIncrease = 10
const setOperatorFeePeriod = 0
const approveOperatorFeePeriod = DAY
const validatorsPerOperatorLimit = 2000
const registeredOperatorsPerAccountLimit = 10
const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345'
let ssvToken: any, ssvRegistry: any, ssvNetwork: any
let owner: any, account1: any, account2: any, account3: any
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`)
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1)

describe('Operator Register', function () {
  beforeEach(async function () {
    // Create accounts
    [owner, account1, account2, account3] = await ethers.getSigners()

    // Deploy Contracts 
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

    // Register operators
    await expect(ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 1000000))
      .to.emit(ssvNetwork, 'OperatorAdded')
      .withArgs(operatorsIds[0], 'testOperator 0', account2.address, operatorsPub[0], 1000000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 20000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 30000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 40000)
  })

  it('Get operators by public key', async function () {
    expect((await ssvNetwork.getOperatorByPublicKey(operatorsPub[1]))[0]).to.equal('testOperator 1')
    expect((await ssvNetwork.getOperatorByPublicKey(operatorsPub[1]))[1]).to.equal(account2.address)
    expect((await ssvNetwork.getOperatorByPublicKey(operatorsPub[1]))[2]).to.equal(operatorsPub[1])
    expect((await ssvNetwork.getOperatorByPublicKey(operatorsPub[1]))[3]).to.equal('0')
    expect((await ssvNetwork.getOperatorByPublicKey(operatorsPub[1]))[4]).to.equal(true)

    // Non-existing operator
    expect((await ssvNetwork.getOperatorByPublicKey(operatorsPub[4]))[1]).to.equal('0x0000000000000000000000000000000000000000')
  })

  it('Get operators by ID', async function () {
    expect((await ssvNetwork.getOperatorById(operatorsIds[1]))[0]).to.equal('testOperator 1')
    expect((await ssvNetwork.getOperatorById(operatorsIds[1]))[1]).to.equal(account2.address)
    expect((await ssvNetwork.getOperatorById(operatorsIds[1]))[2]).to.equal(operatorsPub[1])
    expect((await ssvNetwork.getOperatorById(operatorsIds[1]))[3]).to.equal('0')
    expect((await ssvNetwork.getOperatorById(operatorsIds[1]))[4]).to.equal(true)

    // Non-existing operator
    expect((await ssvNetwork.getOperatorById(operatorsIds[4]))[1]).to.equal('0x0000000000000000000000000000000000000000')
  })

  it('Try to register operator with errors', async function () {
    // Try to register operator with same public key
    await ssvNetwork.connect(account3).registerOperator('duplicate operator pubkey', operatorsPub[1], 10000)
      .should.eventually.be.rejectedWith('operator with same public key already exists')

    // Try to register operator SSV amount too small
    await ssvNetwork.connect(account3).registerOperator('invalid pubkey', operatorsPub[4], 1)
      .should.eventually.be.rejectedWith('fee is too low')
  })
})