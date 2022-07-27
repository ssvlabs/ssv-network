// Burn Rate Unit Tests

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
const operatorMaxFeeIncrease = 99999999999999
const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345'
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765'
let ssvToken: any, ssvRegistry: any, ssvNetwork: any
let owner: any, account1: any, account2: any, account3: any, account4: any, account5: any
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`)
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`)
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1)
const tokens = '90000000000000000'
const allowance = '99999999999999999999'
const operatorFee = 10010000000
const DAY = 86400
const setOperatorFeePeriod = 0
const approveOperatorFeePeriod = DAY

describe('Burn Rate', function () {
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
    await ssvToken.mint(account2.address, '10000000000000000000')

    // Register operators
    await ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], operatorFee)
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], operatorFee)
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], operatorFee)
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], operatorFee)
  })

  it('Check burn rate', async function () {
    await ssvNetwork.connect(owner).updateNetworkFee(10020000000)
    // Register validator to non owned operators
    await ssvToken.connect(account1).approve(ssvNetwork.address, allowance)
    await ssvToken.connect(account2).approve(ssvNetwork.address, allowance)
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens)
    let currentNetworkFee = await ssvNetwork.getNetworkFee()
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal(+currentNetworkFee + (operatorFee * 4))

    // Register another validator to same non owned operators
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens)
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 2) + ((operatorFee * 4) * 2))

    // Register an operator
    await ssvNetwork.connect(account1).registerOperator('testOperator 4', operatorsPub[4], operatorFee * 4)
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 2) + ((operatorFee * 4) * 2))

    // Register a validator from another account to my operator
    await ssvNetwork.connect(account2).registerValidator(validatorsPub[2], operatorsIds.slice(1, 5), operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), tokens)
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 2) + (operatorFee * 4))

    // Register a validator 3 operators i dont own and 1 i do own
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[3], operatorsIds.slice(1, 5), operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), tokens)
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 3) + (operatorFee * 7))

    // Register another operator
    await ssvNetwork.connect(account1).registerOperator('testOperator 5', operatorsPub[5], operatorFee)
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 3) + (operatorFee * 7))

    // Register a validator from another account to both of my operators
    await ssvNetwork.connect(account2).registerValidator(validatorsPub[4], operatorsIds.slice(2, 6), operatorsPub.slice(2, 6), operatorsPub.slice(2, 6), tokens)
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 3) + (operatorFee * 2))

    // Remove an operator i own
    await ssvNetwork.connect(account1).removeOperator(operatorsIds[4])
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 3) + (operatorFee * 10))

    // Update the network fee
    await ssvNetwork.connect(owner).updateNetworkFee(9000000000)
    currentNetworkFee = await ssvNetwork.getNetworkFee()
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 3) + (operatorFee * 10))

    // Remove operator i down own
    await ssvNetwork.connect(account2).removeOperator(operatorsIds[1])
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 3) + (operatorFee * 7))

    // Remove a validator i own
    await ssvNetwork.connect(account1).removeValidator(validatorsPub[1])
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 2) + (operatorFee * 4))

    // Remove a validator i dont own
    await ssvNetwork.connect(account2).removeValidator(validatorsPub[4])
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 2) + (operatorFee * 5))

    // Operator i dont own change fee
    await ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], operatorFee * 2)
    expect(await ssvNetwork.connect(account2).executeOperatorFee(operatorsIds[0]))
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 2) + (operatorFee * 6))

    // Operator i do own change fee
    await ssvNetwork.connect(account1).declareOperatorFee(operatorsIds[5], operatorFee * 2)
    expect(await ssvNetwork.connect(account1).executeOperatorFee(operatorsIds[5]))
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 2) + (operatorFee * 6))

    // Register another 3 operators
    await ssvNetwork.connect(account1).registerOperator('testOperator 6', operatorsPub[6], operatorFee)
    await ssvNetwork.connect(account1).registerOperator('testOperator 7', operatorsPub[7], operatorFee)
    await ssvNetwork.connect(account1).registerOperator('testOperator 8', operatorsPub[8], operatorFee)
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 2) + (operatorFee * 6))

    // Update validator i dont own
    await ssvNetwork.connect(account2).updateValidator(validatorsPub[2], operatorsIds.slice(5, 9), operatorsPub.slice(5, 9), operatorsPub.slice(5, 9), tokens)
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 2) + (operatorFee * 1))

    // Update validator i do own
    await ssvNetwork.connect(account1).updateValidator(validatorsPub[3], operatorsIds.slice(5, 9), operatorsPub.slice(5, 9), operatorsPub.slice(5, 9), tokens)
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal((+currentNetworkFee * 2) - (operatorFee * 1))

    // other account gets liquidated that has validators to my own operators

  })
})
