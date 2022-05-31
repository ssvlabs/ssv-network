// Update Operator Unit Tests

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
const minimumBlocksBeforeLiquidation = 50
const operatorMaxFeeIncrease = 10
const setOperatorFeePeriod = 0
const approveOperatorFeePeriod = DAY
const validatorsPerOperatorLimit = 2000
const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345'
let ssvToken: any, ssvRegistry: any, ssvNetwork: any
let owner: any, account1: any, account2: any, account3: any
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`)
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1)

describe('Update Operators', function () {
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
    ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease, setOperatorFeePeriod, approveOperatorFeePeriod, validatorsPerOperatorLimit])
    await ssvNetwork.deployed()

    // Mint tokens
    await ssvToken.mint(account1.address, '10000000000')

    // Register operators
    await ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 1000000)
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 20000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 30000)
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 40000)
  })

  it('Update operators score', async function () {
    // Update as the owner
    await expect(ssvNetwork.connect(owner).updateOperatorScore(operatorsIds[0], 105))
      .to.emit(ssvRegistry, 'OperatorScoreUpdated')

    // Update as non-owner to get error
    await ssvNetwork
      .connect(account2)
      .updateOperatorScore(operatorsIds[0], 110)
      .should.eventually.be.rejectedWith('caller is not the owner')
  })

  it('Update operators fee', async function () {
    // Set new operator fee 
    await progressTime(DAY)
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 1050000)
    expect(await ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[0]))
      .to.emit(ssvRegistry, 'OperatorFeeUpdated')
    expect((await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])).toString()).to.equal('1050000')

    // Set new operator fee too high
    await expect(ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 1156050)).to.be.revertedWith('fee exceeds increase limit')

    // setOperatorFee incorrect user
    await expect(ssvNetwork.connect(account1).setOperatorFee(operatorsIds[0], 1050001)).to.be.revertedWith('caller is not operator owner')
  })

  it('Update operators max fee increase percentage', async function () {
    // Change the max fee increase percentage
    expect(await ssvNetwork.operatorMaxFeeIncrease()).to.equal('10')
    await ssvNetwork.connect(owner).updateOperatorMaxFeeIncrease(20)
    expect(await ssvNetwork.operatorMaxFeeIncrease()).to.equal('20')

    // Change the max fee increase percentage not owner
    await expect(ssvNetwork.connect(account2).updateOperatorMaxFeeIncrease(20)).to.be.revertedWith('Ownable: caller is not the owner')

    // Set operator fee too high
    await expect(ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 1200001)).to.be.revertedWith('fee exceeds increase limit')

    // Set operator fee at 20% higher
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 1200000)
    await ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[0])
    expect((await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])).toString()).to.equal('1200000')

    // Try to lower fee too low
    await expect(ssvNetwork.connect(account2).setOperatorFee(operatorsIds[1], 105)).to.be.revertedWith('fee is too low')
  })

  it('Revert fee', async function () {
    // Decrease operator fee by 70%
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 378000)
    await ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[0])
    expect((await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])).toString()).to.equal('378000')

    // Try to raise by more than 10%
    await expect(ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 415801)).to.be.revertedWith('fee exceeds increase limit')
    expect((await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])).toString()).to.equal('378000')

    // Revert fee
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 1000000)
    await ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[0])
    expect((await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])).toString()).to.equal('1000000')
  })

  it('Update operators fee less than approval time', async function () {
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 1005000)
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 1005401)
    await ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[0])
    expect((await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])).toString()).to.equal('1005401')
  })

  it('Update operator fee expired', async function () {
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 1005000)
    await progressTime(DAY * 7)
    await expect(ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[0])).to.be.revertedWith('approval not within timeframe')
  })

  it('Cancel update operator fee', async function () {
    // Cancel update operator fee before approval time
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 1005000)
    await ssvNetwork.connect(account2).cancelSetOperatorFee(operatorsIds[0])
    await progressTime(DAY * 7)
    expect((await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])).toString()).to.equal('1000000')

    // Cancel update operator fee incorrect account
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 1005000)
    await expect(ssvNetwork.connect(account1).cancelSetOperatorFee(operatorsIds[0])).to.be.revertedWith('caller is not operator owner')
    expect((await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])).toString()).to.equal('1000000')
  })

  it('Change expiry time / Cancel update operator fee before expiry time', async function () {
    // Get fee periods
    expect((await ssvNetwork.getSetOperatorFeePeriod()).toString()).to.equal('0')
    expect((await ssvNetwork.getApproveOperatorFeePeriod()).toString()).to.equal('86400')

    // Change fee periods
    await ssvNetwork.connect(owner).updateSetOperatorFeePeriod(5)
    await ssvNetwork.connect(owner).updateApproveOperatorFeePeriod(10)

    // Get fee periods
    expect((await ssvNetwork.getSetOperatorFeePeriod()).toString()).to.equal('5')
    expect((await ssvNetwork.getApproveOperatorFeePeriod()).toString()).to.equal('10')

    // Cancel update operator fee before expiry time
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 1005000)
    await progressBlocks(6)
    await ssvNetwork.connect(account2).cancelSetOperatorFee(operatorsIds[0])
    await expect(ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[0])).to.be.revertedWith('no pending fee change request')
    expect((await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])).toString()).to.equal('1000000')
  })

  it('Update set operator fee period', async function () {
    // Change set operator fee period not owner
    await expect(ssvNetwork.connect(account2).updateSetOperatorFeePeriod(5)).to.be.revertedWith('Ownable: caller is not the owner')

    // Change set operator fee
    await ssvNetwork.connect(owner).updateSetOperatorFeePeriod(5)
    await ssvNetwork.connect(account2).setOperatorFee(operatorsIds[0], 1005000)
    await progressBlocks(3)
    await expect(ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[0])).to.be.revertedWith('approval not within timeframe')
    await ssvNetwork.connect(account2).approveOperatorFee(operatorsIds[0])
    expect((await ssvRegistry.getOperatorCurrentFee(operatorsIds[0])).toString()).to.equal('1005000')
  })
})
