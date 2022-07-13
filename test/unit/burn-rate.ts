// Liquidation Unit Tests

// Declare all imports
import { ethers, upgrades } from 'hardhat'
import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
beforeEach(() => {
  chai.should()
  chai.use(chaiAsPromised)
})
const { expect } = chai


// Define global variables
const minimumBlocksBeforeLiquidation = 7000
const operatorMaxFeeIncrease = 10
const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345'
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765'
let ssvToken: any, ssvRegistry: any, ssvNetwork: any
let owner: any, account1: any, account2: any, account3: any, account4: any, account5: any
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`)
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`)
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1)
const tokens = '93401096400000000'
const operatorFee = 10000
const DAY = 86400
const setOperatorFeePeriod = 0
const approveOperatorFeePeriod = DAY

describe('SSV Network Liquidation', function () {
  beforeEach(async function () {
    // Create accounts
    [owner, account1, account2, account3, account4, account5] = await ethers.getSigners()

    // Deploy Contracts 
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
    await ssvToken.mint(account1.address, '10000000000000000000')

    // Register operators
    await ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], operatorFee)
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], operatorFee)
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], operatorFee)
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], operatorFee)
  })

  it('Check burn rate', async function () {
    await ssvNetwork.connect(owner).updateNetworkFee(20000)
    // Register validator
     await ssvToken.connect(account1).approve(ssvNetwork.address, tokens)
     await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens)
     const currentNetworkFee = await ssvNetwork.getNetworkFee()
     expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal(+currentNetworkFee + (operatorFee * 4))
  })
})
