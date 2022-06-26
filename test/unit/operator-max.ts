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
const operatorPublicKeyPrefix2 = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012346'
let ssvToken: any, ssvRegistry: any, ssvNetwork: any
let owner: any, account1: any, account2: any, account3: any
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`)
const operatorsPub2 = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix2}${k}`)
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
    await ssvNetwork.connect(account2).registerOperator('testOperator 2', operatorsPub[2], 30000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 3', operatorsPub[3], 40000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 4', operatorsPub[4], 20000)
  })

  it('Try to register too many operators', async function () {
    await ssvNetwork.connect(account2).registerOperator('testOperator 5', operatorsPub[5], 30000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 6', operatorsPub[6], 40000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 7', operatorsPub[7], 50000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 8', operatorsPub[8], 60000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 9', operatorsPub[9], 70000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 10', operatorsPub2[0], 80000)
      .should.eventually.be.rejectedWith('SSVRegistry: exceed registered operators limit by account')
  })

  it('Change registered operators per account limit', async function () {
    // Check the registered operators per account limit
    expect((await ssvNetwork.getRegisteredOperatorsPerAccountLimit())).to.equal(10)

    // Change the registered operators per account limit
    await ssvNetwork.connect(owner).updateRegisteredOperatorsPerAccountLimit(5)

    // Check the registered operators per account limit
    expect((await ssvNetwork.getRegisteredOperatorsPerAccountLimit())).to.equal(5)

    // Make sure you cannot add another operator
    await ssvNetwork.connect(account2).registerOperator('testOperator 5', operatorsPub[5], 30000)
      .should.eventually.be.rejectedWith('SSVRegistry: exceed registered operators limit by account')

    // Change the registered operators per account limit
    await ssvNetwork.connect(owner).updateRegisteredOperatorsPerAccountLimit(6)

    // Add operator 
    await ssvNetwork.connect(account2).registerOperator('testOperator 6', operatorsPub[6], 40000)

    // Make sure you cannot add another operator
    await ssvNetwork.connect(account2).registerOperator('testOperator 7', operatorsPub[7], 50000)
      .should.eventually.be.rejectedWith('SSVRegistry: exceed registered operators limit by account')

    // Check the registered operators per account limit
    expect((await ssvNetwork.getRegisteredOperatorsPerAccountLimit())).to.equal(6)
  })
})