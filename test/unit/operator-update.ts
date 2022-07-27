// Operator Update Unit Tests

// Declare all imports
import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { progressBlocks, progressTime } from '../helpers/utils'
beforeEach(() => {
  chai.should()
  chai.use(chaiAsPromised)
})

// Define global variables
declare const ethers: any
declare const upgrades: any
const { expect } = chai
const DAY = 86400
const minimumBlocksBeforeLiquidation = 7000
const operatorMaxFeeIncrease = 1000
const setOperatorFeePeriod = 0
const approveOperatorFeePeriod = DAY
const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345'
let ssvToken: any, ssvRegistry: any, ssvNetwork: any, utils: any
let owner: any, account1: any, account2: any, account3: any
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`)
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1)

describe('Operator Update', function () {
  beforeEach(async function () {
    // Create accounts
    [owner, account1, account2, account3] = await ethers.getSigners()

    // Deploy Contracts 
    const ssvTokenFactory = await ethers.getContractFactory('SSVTokenMock')
    const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry')
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork')
    const utilsFactory = await ethers.getContractFactory('Utils');
    ssvToken = await ssvTokenFactory.deploy()
    ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false })
    await ssvToken.deployed()
    await ssvRegistry.deployed()
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease, setOperatorFeePeriod, approveOperatorFeePeriod])
    await ssvNetwork.deployed()
    utils = await utilsFactory.deploy();

    // Mint tokens
    await ssvToken.mint(account1.address, '10000000000')

    // Register operators
    await ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 100000000000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 200000000000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 300000000000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 400000000000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 4', operatorsPub[4], 100000000000)
  })

  it('Update operators score', async function () {
    await ssvNetwork.connect(owner).updateOperatorScore(operatorsIds[0], 105)

    // Update as non-owner to get error
    await ssvNetwork
      .connect(account2)
      .updateOperatorScore(operatorsIds[0], 110)
      .should.eventually.be.rejectedWith('caller is not the owner')
  })

  it('Update operators fee', async function () {
    // Set new operator fee 
    await progressTime(DAY)
    await ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 105000000000)
    expect(await ssvNetwork.connect(account2).executeOperatorFee(operatorsIds[0]))
      .to.emit(ssvNetwork, 'OperatorFeeUpdated').withArgs(account2.address, operatorsIds[0], +await utils.blockNumber(), '105000000000')
    expect((await ssvNetwork.getOperatorFee(operatorsIds[0])).toString()).to.equal('105000000000')

    // Set new operator fee too high
    await expect(ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 11560000000000)).to.be.revertedWith('FeeExceedsIncreaseLimit')

    // declareOperatorFee incorrect user
    await expect(ssvNetwork.connect(account1).declareOperatorFee(operatorsIds[0], 105000100000)).to.be.revertedWith('CallerNotOperatorOwner')
  })

  it('Update operators fee incorrect precision', async function () {
    await ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 101000000000)
    await expect(ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 101220000)).to.be.revertedWith('Precision is over the maximum defined')
    await expect(ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 100000000 * 1.0122)).to.be.revertedWith('Precision is over the maximum defined')
  })

  it('Update operators max fee increase percentage', async function () {
    // Change the max fee increase percentage
    expect(await ssvNetwork.getOperatorFeeIncreaseLimit()).to.equal('1000')
    await ssvNetwork.connect(owner).updateOperatorFeeIncreaseLimit(2000)
    expect(await ssvNetwork.getOperatorFeeIncreaseLimit()).to.equal('2000')

    // Change the max fee increase percentage not owner
    await expect(ssvNetwork.connect(account2).updateOperatorFeeIncreaseLimit(20)).to.be.revertedWith('Ownable: caller is not the owner')

    // Set operator fee too high
    await expect(ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 1200000000000)).to.be.revertedWith('FeeExceedsIncreaseLimit')

    // Set operator fee at 20% higher
    await ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 120000000000)
    await ssvNetwork.connect(account2).executeOperatorFee(operatorsIds[0])
    expect((await ssvNetwork.getOperatorFee(operatorsIds[0])).toString()).to.equal('120000000000')

    // Try to lower fee too low
    await expect(ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[1], 105)).to.be.revertedWith('Precision is over the maximum defined')
  })

  it('Update operators fee less than approval time', async function () {
    await ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 105000000000)
    await ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 106000000000)
    await ssvNetwork.connect(account2).executeOperatorFee(operatorsIds[0])
    expect((await ssvNetwork.getOperatorFee(operatorsIds[0])).toString()).to.equal('106000000000')
  })

  it('Update operator fee expired', async function () {
    await ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 110000000000)
    await progressTime(DAY * 7)
    await expect(ssvNetwork.connect(account2).executeOperatorFee(operatorsIds[0])).to.be.revertedWith('ApprovalNotWithinTimeframe')
  })

  it('Cant update operator fee (fee too small)', async function () {
    await expect(ssvNetwork.connect(account3).declareOperatorFee(operatorsIds[4], 11000000)).to.be.revertedWith('Precision is over the maximum defined')
    await expect(ssvNetwork.connect(account3).declareOperatorFee(operatorsIds[4], 10100000)).to.be.revertedWith('Precision is over the maximum defined')
  })

  it('Cancel update operator fee', async function () {
    // Cancel update operator fee before approval time
    await ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 105000000000)
    await ssvNetwork.connect(account2).cancelDeclaredOperatorFee(operatorsIds[0])
    await progressTime(DAY * 7)
    expect((await ssvNetwork.getOperatorFee(operatorsIds[0])).toString()).to.equal('100000000000')

    // Cancel update operator fee incorrect account
    await ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 105000000000)
    await expect(ssvNetwork.connect(account1).cancelDeclaredOperatorFee(operatorsIds[0])).to.be.revertedWith('CallerNotOperatorOwner')
    expect((await ssvNetwork.getOperatorFee(operatorsIds[0])).toString()).to.equal('100000000000')
  })

  it('Change expiry time / Cancel update operator fee before expiry time', async function () {
    // Get fee periods
    expect((await ssvNetwork.getDeclaredOperatorFeePeriod()).toString()).to.equal('0')
    expect((await ssvNetwork.getExecuteOperatorFeePeriod()).toString()).to.equal('86400')

    // Change fee periods
    await ssvNetwork.connect(owner).updateDeclareOperatorFeePeriod(5)
    await ssvNetwork.connect(owner).updateExecuteOperatorFeePeriod(10)

    // Get fee periods
    expect((await ssvNetwork.getDeclaredOperatorFeePeriod()).toString()).to.equal('5')
    expect((await ssvNetwork.getExecuteOperatorFeePeriod()).toString()).to.equal('10')

    // Cancel update operator fee before expiry time
    await ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 105000000000)
    await progressBlocks(6)
    await ssvNetwork.connect(account2).cancelDeclaredOperatorFee(operatorsIds[0])
    await expect(ssvNetwork.connect(account2).executeOperatorFee(operatorsIds[0])).to.be.revertedWith('NoPendingFeeChangeRequest')
    expect((await ssvNetwork.getOperatorFee(operatorsIds[0])).toString()).to.equal('100000000000')
  })

  it('Update set operator fee period', async function () {
    // Change set operator fee period not owner
    await expect(ssvNetwork.connect(account2).updateDeclareOperatorFeePeriod(5)).to.be.revertedWith('Ownable: caller is not the owner')

    // Change set operator fee
    await ssvNetwork.connect(owner).updateDeclareOperatorFeePeriod(5)
    await ssvNetwork.connect(account2).declareOperatorFee(operatorsIds[0], 105000000000)
    await progressBlocks(3)
    await expect(ssvNetwork.connect(account2).executeOperatorFee(operatorsIds[0])).to.be.revertedWith('ApprovalNotWithinTimeframe')
    await ssvNetwork.connect(account2).executeOperatorFee(operatorsIds[0])
    expect((await ssvNetwork.getOperatorFee(operatorsIds[0])).toString()).to.equal('105000000000')
  })
})
