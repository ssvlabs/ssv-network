// Liquidation Unit Tests

// Declare all imports
import { ethers, upgrades } from 'hardhat'
import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

before(() => {
  chai.should()
  chai.use(chaiAsPromised)
})

const operators = require('./operatorData.json')
const operatorKeyShares = require('./operatorDataKeyShares.json')
const validators = require('./validatorData.json')
const accountsJSON = require('./accountData.json')

// Define global variables
const minimumBlocksBeforeLiquidation = 50
const operatorMaxFeeIncrease = 10
let ssvToken: any, ssvRegistry: any, ssvNetwork: any
const setOperatorFeePeriod = 0
const approveOperatorFeePeriod = 86400
const validatorsPerOperatorLimit = 2000
const registeredOperatorsPerAccountLimit = 10

//let provider = ethers.getDefaultProvider('goerli')
//@ts-ignore
//const accounts = accountsJSON.map(account => new ethers.Wallet(account.privateKey))
let owner: any, account0: any, account1: any, account2: any, account3: any, account4: any

describe('Build Environment', function () {
  before(async function () {
    [owner, account0, account1, account2, account3, account4] = await ethers.getSigners()
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
    await ssvToken.mint(account2.address, '2000000000000000000000')
    await ssvToken.mint(account3.address, '2000000000000000000000')
    await ssvToken.mint(account4.address, '2000000000000000000000')
  })

  it('Register Operators', async function () {
    for (let i = 0; i < (operators.length / 2); i++) await ssvNetwork.connect(account0).registerOperator(operators[i].name, operators[i].shaKey, operators[i].fee)
    for (let i = (operators.length / 2); i < operators.length; i++) await ssvNetwork.connect(account1).registerOperator(operators[i].name, operators[i].shaKey, operators[i].fee)
  })

  it('Register Validators', async function () {
    await ssvToken.connect(account2).approve(ssvNetwork.address, '2000000000000000000000')
    await ssvToken.connect(account3).approve(ssvNetwork.address, '2000000000000000000000')
    await ssvToken.connect(account4).approve(ssvNetwork.address, '2000000000000000000000')

    for (let i = 0; i < validators.length; i++) {
      await ssvNetwork.connect(account2).registerValidator(
        validators[i].publicKey,
        operatorKeyShares[validators[i].batch].operatorIds,
        operatorKeyShares[validators[i].batch].sharesPublicKeys,
        operatorKeyShares[validators[i].batch].encryptedKeys,
        validators[i].tokenAmount
      )
    }
  })

})
