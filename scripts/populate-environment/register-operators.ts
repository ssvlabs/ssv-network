// Register Operators

// Declare all imports and requires
import { ethers } from 'hardhat'
const accountsJSON = require('./accountData.json')
const operators = require('./operators.json')

// Define global variables
const ssvNetworkAddress = process.env.SSVNETWORK_ADDRESS
let ssvNetwork: any
const operatorFee = 2085020000000

// Build infura provider on the Goerli network
const provider = ethers.getDefaultProvider('goerli', { etherscan: process.env.ETHERSCAN_KEY, infura: { projectId: process.env.INFURA_ID, projectSecret: process.env.INFURA_SECRET } })

//Use infura provider to build accounts that can sign
//@ts-ignore
const accounts = accountsJSON.operators.map(account => new ethers.Wallet(account.privateKey, provider))

async function registerOperators() {
  // Attach SSV Network Contract
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork')
  // @ts-ignore
  ssvNetwork = ssvNetworkFactory.attach(ssvNetworkAddress)
  console.log('Successfully Attached to the SSV Network Contract')

  // Go through operators.json and register them to the contract
  for (let i = 0; i < operators.length; i++) {
    try {
      await ssvNetwork.connect(accounts[i < operators.length / 2 ? 0 : 1]).registerOperator(operators[i].name, operators[i].encodedABI, operatorFee)
      console.log(`Successfully registered operator: ${operators[i].name}`)
    } catch (e) { console.log(e) }

    // Wait 10 seconds
    await new Promise(r => setTimeout(r, 60000))
  }
}

registerOperators()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });