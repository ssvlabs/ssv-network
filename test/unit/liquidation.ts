// Liquidation Unit Tests

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
const minimumBlocksBeforeLiquidation = 50
const operatorMaxFeeIncrease = 10
const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345'
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765'
let ssvToken: any, ssvRegistry: any, ssvNetwork: any
let owner: any, account1: any, account2: any, account3: any, account4: any, account5: any
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`)
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`)
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1)
const tokens = '100000000'
const DAY = 86400
const setOperatorFeePeriod = 0
const approveOperatorFeePeriod = DAY
const validatorsPerOperatorLimit = 2000
const registeredOperatorsPerAccountLimit = 10

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
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease, setOperatorFeePeriod, approveOperatorFeePeriod, validatorsPerOperatorLimit, registeredOperatorsPerAccountLimit])
    await ssvNetwork.deployed()

    // Mint tokens
    await ssvToken.mint(account1.address, '10000000000')

    // Register operators
    await ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 10000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 20000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 30000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 40000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 4', operatorsPub[4], 10000)

    // Register validators
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens)
    await ssvToken.connect(account1).transfer(account2.address, tokens)
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens)
  })

  it('Register validator with 0 balance', async function () {
    await expect(ssvNetwork.connect(account2).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 0)).to.be.revertedWith("not enough balance")
  })

  it('Check balance after 100 blocks', async function () {
    await progressBlocks(100)
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal(90000000)
    expect(await ssvNetwork.getAddressBalance(account2.address)).to.equal(3000000)
    expect(await ssvNetwork.getAddressBalance(account3.address)).to.equal(7000000)
  })

  it('Try to liquidate a valid account', async function () {
    await ssvNetwork.connect(account4).liquidate([account1.address])
    expect(await ssvNetwork.isLiquidated(account1.address)).to.equal(false)
  })

  it('Check burn rates', async function (): Promise<void> {
    expect(await ssvNetwork.getAddressBurnRate(owner.address)).to.equal(0)
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal(100000)
    expect(await ssvNetwork.getAddressBurnRate(account2.address)).to.equal(0)
    expect(await ssvNetwork.getAddressBurnRate(account3.address)).to.equal(0)
  })

  it('Try to withdraw to a liquidatable state', async function () {
    await progressBlocks(948)
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal(5200000)
    await expect(ssvNetwork.connect(account1).withdraw(200000)).to.be.revertedWith('not enough balance')
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal(5100000)
  })

  it('Update to a valid state using tokens', async function () {
    // Get to a liquidatable state
    await progressBlocks(951)
    expect(await ssvNetwork.isLiquidatable(account1.address)).to.equal(true)

    // Change operator triggering to put in more SSV
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens)
    const tx = ssvNetwork.connect(account1).updateValidator(validatorsPub[0], operatorsIds.slice(1, 5), operatorsPub.slice(1, 5), operatorsPub.slice(1, 5), tokens)
    await expect(tx).to.emit(ssvNetwork, 'ValidatorRemoved')
    await expect(tx).to.emit(ssvNetwork, 'ValidatorAdded')

    // No longer liquidatable
    expect(await ssvNetwork.isLiquidatable(account1.address)).to.equal(false)
    await ssvNetwork.connect(account4).liquidate([account1.address])
    expect(await ssvNetwork.isLiquidated(account1.address)).to.equal(false)

    // Get to a liquidatable state
    await progressBlocks(1000)
    expect(await ssvNetwork.isLiquidatable(account1.address)).to.equal(true)

    // Deposit more SSV
    await ssvToken.connect(account1).approve(ssvNetwork.address, tokens)
    await ssvNetwork.connect(account1).deposit(account1.address, tokens)

    // No longer liquidatable
    expect(await ssvNetwork.isLiquidatable(account1.address)).to.equal(false)
  })

  it('Liquidate', async function () {
    // Try to liquidate non liquidatable accounts
    await progressBlocks(949)
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal(5100000)
    expect(await ssvNetwork.isLiquidatable(account1.address)).to.equal(false)
    await ssvNetwork.connect(account4).liquidate([account1.address])
    expect(await ssvNetwork.isLiquidated(account1.address)).to.equal(false)

    // Liquidate account1
    await progressBlocks(1)
    expect(await ssvNetwork.isLiquidatable(account1.address)).to.equal(true)
    expect(await ssvToken.balanceOf(account4.address)).to.equal(0)
    await ssvNetwork.connect(account4).liquidate([account1.address])
    expect(await ssvNetwork.isLiquidatable(account1.address)).to.equal(false)
    await ssvNetwork.connect(account4).liquidate([account1.address])
    expect(await ssvNetwork.isLiquidated(account1.address)).to.equal(true)
    expect(await ssvNetwork.getAddressBurnRate(account1.address)).to.equal(0)
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal(0)
    expect(await ssvNetwork.getAddressBalance(account4.address)).to.equal(0)
    expect(await ssvToken.balanceOf(account4.address)).to.equal(4800000)
  })

  it('Liquidate multiple accounts', async function () {
    // Register validator with account5
    await ssvToken.connect(account1).transfer(account5.address, tokens)
    await ssvToken.connect(account5).approve(ssvNetwork.address, tokens)
    await ssvNetwork.connect(account5).registerValidator(validatorsPub[1], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), tokens)
    await progressBlocks(946)
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal(5100000)
    expect(await ssvNetwork.getAddressBalance(account5.address)).to.equal(5400000)
    expect(await ssvNetwork.getAddressBalance(account4.address)).to.equal(0)
    expect(await ssvToken.balanceOf(account4.address)).to.equal(0)

    // Try to liquidate non liquidatable accounts
    await ssvNetwork.connect(account4).liquidate([account1.address, account2.address, account5.address])
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal(5000000)
    expect(await ssvNetwork.getAddressBalance(account2.address)).to.equal(56910000)
    expect(await ssvNetwork.getAddressBalance(account5.address)).to.equal(5300000)
    expect(await ssvNetwork.getAddressBalance(account4.address)).to.equal(0)
    await progressBlocks(3)

    // Liquidate account1 (actually liquidatable), account2 (not liquidatable) and account5 (actually liquidatable)
    await ssvNetwork.connect(account4).liquidate([account1.address, account2.address, account5.address])
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal(0)
    expect(await ssvNetwork.getAddressBalance(account2.address)).to.equal(57150000)
    expect(await ssvNetwork.getAddressBalance(account5.address)).to.equal(0)
    expect(await ssvNetwork.getAddressBalance(account4.address)).to.equal(0)

    // Account4 only got liquidation reward from account1 and account2 only
    expect(await ssvToken.balanceOf(account4.address)).to.equal(9500000)
    expect(await ssvNetwork.isLiquidated(account1.address)).to.equal(true)
  })

  it('Try to enable account to liquitable status', async function () {
    // Expect to not be liquidatable
    await progressBlocks(950)
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal(5000000)
    expect(await ssvNetwork.isLiquidatable(account1.address)).to.equal(false)

    // Liquidate account1
    await ssvNetwork.connect(account2).liquidate([account1.address])
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal(0)
    expect(await ssvNetwork.isLiquidated(account1.address)).to.equal(true)
    expect(await ssvNetwork.isLiquidatable(account1.address)).to.equal(false)

    // Enable account not enough SSV
    await ssvToken.connect(account1).approve(ssvNetwork.address, 5000000)
    await expect(ssvNetwork.connect(account1).reactivateAccount(4900000)).to.be.revertedWith("not enough balance")

    // Enable account
    await ssvNetwork.connect(account1).reactivateAccount(5000000)
    expect(await ssvNetwork.isLiquidated(account1.address)).to.equal(false)
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal(5000000)

    // Liquidate again immediately
    await ssvNetwork.connect(account2).liquidate([account1.address])
    expect(await ssvNetwork.getAddressBalance(account1.address)).to.equal(0)
    expect(await ssvNetwork.isLiquidated(account1.address)).to.equal(true)
  })
})
