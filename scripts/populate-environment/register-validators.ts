// Register 100 Validators

// Declare all imports and requires
import { ethers } from 'hardhat'
import Web3 from 'web3'
import { encode } from 'js-base64'
import { EthereumKeyStore, Encryption, Threshold } from 'ssv-keys'
import { EncryptShare } from 'ssv-keys/src/lib/Encryption/Encryption'
const operatorBatches = require('./operatorBatches.json')
const accountsJSON = require('./accountData.json')
const fs = require('fs')

// *** UPDATE BEFORE RUNNING ***
const keystoresPath = '/Users/andrew/Downloads/staking_deposit-cli-ce8cbb6-darwin-amd64/validator_keys_Stage/Done/'
const keystorePassword = '123123123'
const tokenAmount = "25000000000000000000"
const env = 'stage' // 'prod'
const ssvTokenAddress = process.env.STAGE_TOKEN_ADDRESS //process.env.PROD_TOKEN_ADDRESS
const ssvNetworkAddress = process.env.STAGE_NETWORK_ADDRESS //process.env.PROD_NETWORK_ADDRESS

// Define global variables
let ssvToken: any, ssvNetwork: any
let result = {}

// Build infura provider on the Goerli network
const provider = ethers.getDefaultProvider('goerli', { etherscan: process.env.ETHERSCAN_KEY, infura: { projectId: process.env.INFURA_ID, projectSecret: process.env.INFURA_SECRET } })

//Use infura provider to build accounts that can sign
//@ts-ignore
let accounts = accountsJSON.validators.map(account => new ethers.Wallet(account.privateKey, provider))

async function registerValidators() {
  // Attach SSV Network and Token Contracts
  const ssvTokenFactory = await ethers.getContractFactory('SSVTokenMock')
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork')
  // @ts-ignore
  ssvToken = ssvTokenFactory.attach(ssvTokenAddress)
  console.log('Successfully Attached to the SSV Token Contract')
  // @ts-ignore
  ssvNetwork = ssvNetworkFactory.attach(ssvNetworkAddress)
  console.log('Successfully Attached to the SSV Network Contract')

  // // Approve accounts to the contract
  // for (let i = 0; i < accounts.length; i++) {
  //   await ssvToken.connect(accounts[i]).approve(ssvNetwork.address, '20000000000000000000000')
  //   console.log(`Successfully Approved ${accountsJSON.validators[i].name}`)
  //   await new Promise(r => setTimeout(r, 1500))
  // }

  // Build connection to the path of the keystores
  const dir = await fs.promises.opendir(keystoresPath)

  // Loop through all the keystores and build there payloads
  for await (const keystoreFile of dir) {
    if (keystoreFile.name === '.DS_Store') continue

    const keystorePath = require(keystoresPath + keystoreFile.name)
    const keyStore = new EthereumKeyStore(JSON.stringify(keystorePath))

    // Get private key from the keystore using the keystore password
    const privateKey = await keyStore.getPrivateKey(keystorePassword)
    const publicKey = await keyStore.getPublicKey()

    // Check if validator is already on the contract
    if (await ssvNetwork.getOperatorsByValidator(`0x${publicKey}`) === undefined) continue

      // Assign batch based on modulus of first 8 integers of validators public key
      const batchNumber = parseInt(publicKey.substring(0, 8), 16) % operatorBatches.IDs.length
      const batchNumberAccounts = parseInt(publicKey.substring(0, 8), 16) % accounts.length

      // Build the shares
      const thresholdInstance = new Threshold()
      const threshold = await thresholdInstance.create(privateKey, operatorBatches.IDs[batchNumber])
      let shares = new Encryption(operatorBatches.publicKeys[batchNumber], threshold.shares).encrypt()
      shares = shares.map((share: EncryptShare) => {
        share.operatorPublicKey = encode(share.operatorPublicKey)
        return share
      })

      // Build the transaction payload
      const web3 = new Web3()
      const sharePublicKeys = shares.map((share: EncryptShare) => share.publicKey)
      const sharePrivateKeys = shares.map((share: EncryptShare) => web3.eth.abi.encodeParameter('string', share.privateKey))

      // Send transaction to the contract
      await ssvNetwork.connect(accounts[batchNumberAccounts]).registerValidator(
        `0x${publicKey}`,
        operatorBatches.IDs[batchNumber],
        sharePublicKeys,
        sharePrivateKeys,
        tokenAmount
      ).then(() => {
        console.log(`Successfully Registered Validator ${publicKey} to batch number ${batchNumber}`)
        // Populate the result object with public key to batch number
        const batchNumberText = `${batchNumber}-${operatorBatches.IDs[batchNumber]}`
        if (!result.hasOwnProperty(batchNumberText)) {
          //@ts-ignore
          result[batchNumberText] = []
        }
        //@ts-ignore
        result[batchNumberText].push({ validatorPublicKey: publicKey, accountName: accountsJSON.validators[batchNumberAccounts].name, accountKey: accountsJSON.validators[batchNumberAccounts].publicKey })

        //@ts-ignore
      }).catch((e) => { console.log(e) })
  }
  // Log and save json file of all the validators public key and batches
  console.log(result)
  // @ts-ignore
  fs.writeFileSync(`${env}_ValidatorBatches.json`, JSON.stringify(result), function (err) { if (err) console.log(err) })
}

registerValidators()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });