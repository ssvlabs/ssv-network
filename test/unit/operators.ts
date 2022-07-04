// Operator Unit Tests

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
const registeredOperatorsPerAccountLimit = 10
const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345'
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765'
let ssvToken: any, ssvRegistry: any, ssvNetwork: any
let owner: any, account1: any, account2: any, account3: any
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`)
const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`)
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1)

describe('Operators', function () {
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
    await ssvToken.mint(account1.address, '10000000000');
  });

  it('register operator', async function() {
    await expect(ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 1000000))
      .to.emit(ssvNetwork, 'OperatorAdded')
      .withArgs(operatorsIds[0], 'testOperator 0', account2.address, operatorsPub[0], 1000000);
  });

  it('register more operators', async function() {
    await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 20000);
    await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 30000);
    await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 40000);

    await progressTime(4 * DAY);
  });

  it('Get operators by public key', async function () {
   expect((await ssvNetwork.getOperatorByPublicKey(operatorsPub[1]))[0]).to.equal('testOperator 1')
   expect((await ssvNetwork.getOperatorByPublicKey(operatorsPub[1]))[1]).to.equal(account2.address)
   expect((await ssvNetwork.getOperatorByPublicKey(operatorsPub[1]))[2]).to.equal(operatorsPub[1])
   expect((await ssvNetwork.getOperatorByPublicKey(operatorsPub[1]))[3]).to.equal('0')
   expect((await ssvNetwork.getOperatorByPublicKey(operatorsPub[1]))[4]).to.equal('20000')
   expect((await ssvNetwork.getOperatorByPublicKey(operatorsPub[1]))[5]).to.equal('0')
   expect((await ssvNetwork.getOperatorByPublicKey(operatorsPub[1]))[6]).to.equal(true)
  })

  it('Try to register operator with same public key', async function () {
    await ssvNetwork
      .connect(account3)
      .registerOperator('duplicate operator pubkey', operatorsPub[1], 10000)
      .should.eventually.be.rejectedWith('operator with same public key already exists')
  })

  it('Get operator returns correct', async function () {
    // Existing operator
    expect((await ssvRegistry.getOperatorById(operatorsIds[1]))[1]).to.equal(account2.address)

    // Non-existing operator
    expect((await ssvRegistry.getOperatorById(operatorsIds[8]))[1]).to.equal('0x0000000000000000000000000000000000000000')
  })

  it('Remove operator no validators', async function () {
    // Remove an operator with no validators
    await progressTime(DAY)
    await expect(ssvNetwork.connect(account2).removeOperator(operatorsIds[0]))
      .to.emit(ssvRegistry, 'OperatorRemoved')
      .withArgs(operatorsIds[0], account2.address, operatorsPub[0])

<<<<<<< HEAD
  it('update operators fee less than in 72 hours fail', async function () {
    await progressTime(DAY, async() => {
      await ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[0], 105);
      await progressTime(DAY);
      await expect(ssvNetwork.connect(account2).updateOperatorFee(operatorsPub[0], 110)).to.be.revertedWith('fee updated in last 72 hours');
    });
  });
  */

  it('update operators score fails for not owner', async function () {
    await ssvNetwork
      .connect(account2)
      .updateOperatorScore(operatorsIds[0], 105)
      .should.eventually.be.rejectedWith('caller is not the owner');
  });

  it('update operators score', async function () {
    await expect(ssvNetwork.connect(owner).updateOperatorScore(operatorsIds[0], 105))
      .to.emit(ssvNetwork, 'OperatorScoreUpdated');
  });

  it('remove operator', async function () {
    //@ts-ignore
    await progressTime(DAY, async() => {
      await expect(ssvNetwork.connect(account2).removeOperator(operatorsIds[0]))
        .to.emit(ssvNetwork, 'OperatorRemoved')
        .withArgs(operatorsIds[0], account2.address);
    });
  });

  // it('revert remove operator: operator has validators', async function () {
  //   //@ts-ignore
  //   await progressTime(DAY, async() => {
  //     await ssvToken.connect(account1).approve(ssvNetwork.address, '100000000');
  //     await ssvNetwork.connect(account1).registerValidator(
  //       validatorsPub[0],
  //       operatorsIds.slice(0, 4),
  //       operatorsPub.slice(0, 4),
  //       operatorsPub.slice(0, 4),
  //       '100000000'
  //     );

  //     await ssvNetwork
  //       .connect(account2)
  //       .removeOperator(operatorsIds[0])
  //       .should.eventually.be.rejectedWith('operator has validators');
  //   });
  // });

  it('revert remove operator: public key does not exist', async function () {
=======
    // Try to remove non-existent operator
>>>>>>> main
    await ssvNetwork
      .connect(account3)
      .removeOperator(operatorsIds[6])
      .should.eventually.be.rejectedWith('operator with public key does not exist')

    // Remove operator: tx was sent as non-owner
    await ssvNetwork
      .connect(account3)
      .removeOperator(operatorsIds[1])
      .should.eventually.be.rejectedWith('caller is not operator owner')
  })

  it('Remove operator with validators', async function () {
    // Register a validator
    await ssvToken.connect(account1).approve(ssvNetwork.address, 1000000000)
    await ssvNetwork.connect(account1).registerValidator(validatorsPub[0], operatorsIds.slice(0, 4), operatorsPub.slice(0, 4), operatorsPub.slice(0, 4), 100000000)

    // Delete an operator that the validator is using
    await expect(ssvNetwork.connect(account2).removeOperator(operatorsIds[0]))
      .to.emit(ssvRegistry, 'OperatorRemoved')
      .withArgs(operatorsIds[0], account2.address, operatorsPub[0])

    // Check that the operator fee is 0
    expect((await ssvRegistry.getOperatorFee(operatorsIds[0])).toString()).to.equal('0')
  })

  it('Get operator Fee', async function () {
    // Get current operator fee
    expect((await ssvRegistry.getOperatorFee(operatorsIds[1])).toString()).to.equal('20000')

    // Non existent operator
    await expect(ssvRegistry.getOperatorFee(operatorsIds[4])).to.be.revertedWith('operator not found')
  })
})