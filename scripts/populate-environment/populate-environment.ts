// Populate environment: 12 Operators - 100 Validators

// Declare all imports
import { ethers } from 'hardhat'
import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
before(() => {
  chai.should()
  chai.use(chaiAsPromised)
})

// Import all JSON data
const operators = require('./operatorData.json')
const operatorKeyShares = require('./operatorDataKeyShares.json')
const validators = require('./validatorData.json')
const accountsJSON = require('./accountData.json')

// Define global variables
const ssvTokenContract = '0x3651c03a8546da82affaef8c644d4e3efdd37718'
const ssvRegistryContract = '0x6ee5588718A94a8B6215B5d84042a5D3c344ED0e'
const ssvNetworkContract = '0xe702E04728d68cc084362665AAc32610e7b88e3D'
let ssvToken: any, ssvRegistry: any, ssvNetwork: any

// Make accounts
let provider = ethers.getDefaultProvider('goerli')
//@ts-ignore
let accounts = accountsJSON.map(account => new ethers.Wallet(account.privateKey, provider))

describe('Populate Environment', function () {
  before(async function () {
    this.timeout(50000000000)
    // Deploy Contracts 
    const ssvTokenFactory = await ethers.getContractFactory('SSVTokenMock')
    const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry')
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork')
    ssvToken = await ssvTokenFactory.attach(ssvTokenContract)
    console.log('Successfully Attached to the SSV Token Contract')
    ssvRegistry = await ssvRegistryFactory.attach(ssvRegistryContract)
    console.log('Successfully Attached to the SSV Registry Contract')
    ssvNetwork = await ssvNetworkFactory.attach(ssvNetworkContract)
    console.log('Successfully Attached to the SSV Network Contract')
  })

  it('Register Operators', async function () {
    this.timeout(50000000000)
    for (let i = 0; i < (operators.length / 2); i++) {
      await ssvNetwork.connect(accounts[i < operators.length / 2 ? 0 : 1]).registerOperator(operators[i].name, operators[i].shaKey, operators[i].fee)
      await new Promise(r => setTimeout(r, 5000))
      console.log(`Successfully registered operator: ${operators[i].name}`)
    }
  })

  it('Register Validators', async function () {
    this.timeout(50000000000)
    // Approve accounts to the contract
    for (let i = 2; i < accounts.length; i++) {
      await ssvToken.connect(accounts[i]).approve(ssvNetwork.address, '2000000000000000000000')
      console.log(`Successfully Approved ${accountsJSON[i].name}`)
      await new Promise(r => setTimeout(r, 5000))
    }

    for (let i = 0; i < validators.length; i++) {
      await ssvNetwork.connect(accounts[validators[i].batch + 2]).registerValidator(
        validators[i].publicKey,
        operatorKeyShares[validators[i].batch].operatorIds,
        operatorKeyShares[validators[i].batch].sharesPublicKeys,
        operatorKeyShares[validators[i].batch].encryptedKeys,
        validators[i].tokenAmount
      )
      console.log(`Successfully Registered Validator #${i}`)
      await new Promise(r => setTimeout(r, 5000))
    }
  })

})