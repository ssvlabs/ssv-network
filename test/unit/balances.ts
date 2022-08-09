// Balance Unit Tests

// Declare all imports
import { ethers, upgrades } from 'hardhat'
import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { progressBlocks } from '../helpers/utils'
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
const DAY = 86400
const setOperatorFeePeriod = 0
const approveOperatorFeePeriod = DAY

describe('Balance', function () {
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

    // Mint and approve tokens
    await ssvToken.mint(account1.address, '10000000000000000000')
    await ssvToken.connect(account1).approve(ssvNetwork.address, allowance)
  })

  it('Check balances', async function () {
    await progressBlocks(10)
    await ssvNetwork.connect(owner).updateNetworkFee(20000000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 20000000000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 40000000000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 50000000000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 3', operatorsPub[3], 30000000000)
    expect(await ssvNetwork.getNetworkEarnings()).to.equal(0)
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal(0)
    expect(await ssvNetwork.getAddressBalance(account2.address)).to.equal(0)
    expect(await ssvNetwork.getAddressBalance(account3.address)).to.equal(0)

    await progressBlocks(10)
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens)
    expect(await ssvNetwork.getNetworkEarnings()).to.equal(0)
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal(tokens)
    expect(await ssvNetwork.getAddressBalance(account2.address)).to.equal(0)
    expect(await ssvNetwork.getAddressBalance(account3.address)).to.equal(0)

    await progressBlocks(10)
    await ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 22000000000)
    await ssvNetwork.connect(account2).executeOperatorFee(operatorsIds[0])
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens)
    expect(await ssvNetwork.getNetworkEarnings()).to.equal(260000000)
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal("179998177740000000")
    expect(await ssvNetwork.getAddressBalance(account2.address)).to.equal("1172000000000")
    expect(await ssvNetwork.getAddressBalance(account3.address)).to.equal("650000000000")

    await progressBlocks(10)
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[2], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens)
    expect(await ssvNetwork.getNetworkEarnings()).to.equal("700000000")
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal("269995053300000000")
    expect(await ssvNetwork.getAddressBalance(account2.address)).to.equal("3196000000000")
    expect(await ssvNetwork.getAddressBalance(account3.address)).to.equal("1750000000000")

    await progressBlocks(10)
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[3], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens)
    expect(await ssvNetwork.getNetworkEarnings()).to.equal("1360000000")
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal("359990366640000000")
    expect(await ssvNetwork.getAddressBalance(account2.address)).to.equal("6232000000000")
    expect(await ssvNetwork.getAddressBalance(account3.address)).to.equal("3400000000000")

    await progressBlocks(50)
    expect(await ssvNetwork.getNetworkEarnings()).to.equal("5360000000")
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal("359961962640000000")
    expect(await ssvNetwork.getAddressBalance(account2.address)).to.equal("24632000000000")
    expect(await ssvNetwork.getAddressBalance(account3.address)).to.equal("13400000000000")
  })
})