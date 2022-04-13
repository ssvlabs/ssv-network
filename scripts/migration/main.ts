import { ethers, upgrades } from 'hardhat';

const _crypto = require('crypto');
const Web3 = require('web3');
const OLD_CONTRACT_ABI = require('./old_abi.json');
const NEW_CONTRACT_ABI = require('./new_abi.json');

function toChunks(items: any, size: number) {
  return Array.from(
    new Array(Math.ceil(items.length / size)),
    (_, i) => items.slice(i * size, i * size + size)
  );
}

function convertPublickey(rawValue: string) {
  try {
    const decoded = (new Web3()).eth.abi.decodeParameter('string', rawValue.replace('0x', ''));
    return _crypto.createHash('sha256').update(decoded).digest('hex');
  } catch (e) {
    console.warn('PUBKEY WAS NOT CONVERTED DUE TO ', e);
    return rawValue;
  }
}

async function main() {
  const web3 = new Web3(process.env.MIGRATION_NODE_URL);
  const oldContract = new web3.eth.Contract(OLD_CONTRACT_ABI, process.env.MIGRATION_OLD_CONTRACT_ADDRESS);
  const newContract = new web3.eth.Contract(NEW_CONTRACT_ABI, process.env.MIGRATION_NEW_CONTRACT_ADDRESS);

  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  const ssvNetwork = await ssvNetworkFactory.attach(process.env.MIGRATION_NEW_CONTRACT_ADDRESS || '');
  const latestBlock = await web3.eth.getBlockNumber();
  const filters = {
    fromBlock: 0,
    toBlock: latestBlock
  };
  /*
  console.log(`fetching operators...`, filters);
  const operatorEvents = await oldContract.getPastEvents('OperatorAdded', filters);
  console.log("total operatorEvents", operatorEvents.length);

  for (let index = 0; index < operatorEvents.length; index++) {
    const { returnValues } = operatorEvents[index];
    console.log('+', returnValues.name, returnValues.ownerAddress, returnValues.ownerAddress, returnValues.publicKey);
    const tx = await ssvNetwork.batchRegisterOperator(
      returnValues.name,
      returnValues.ownerAddress,
      returnValues.publicKey,
      0
    );
    await tx.wait();
  }
  */
  const newOperatorEvents = await newContract.getPastEvents('OperatorAdded', filters);
  console.log("total new operatorEvents", newOperatorEvents.length);
  const operatorIds: any = {};
  for (let index = 0; index < newOperatorEvents.length; index++) {
    const { returnValues } = newOperatorEvents[index];
    operatorIds[returnValues.publicKey] = returnValues.id;
  }

  console.log(`fetching validators...`, filters);
  const validatorEvents = await oldContract.getPastEvents('ValidatorAdded', filters);
  console.log("total validatorEvents", validatorEvents.length);
  for (let index = 0; index < validatorEvents.length; index++) {
    const { returnValues } = validatorEvents[index];
    const operatorPubKeys = returnValues.operatorPublicKeys.map((key: any) => operatorIds[key]);
    try {
      const tx = await ssvNetwork.batchRegisterValidator(
        returnValues.ownerAddress,
        returnValues.publicKey,
        operatorPubKeys,
        returnValues.sharesPublicKeys,
        returnValues.encryptedKeys,
        0
      );
      await tx.wait();
      console.log(`${index}/${validatorEvents.length}`, '+', returnValues.ownerAddress, returnValues.publicKey, operatorPubKeys);  
    } catch (e) {
      console.log(`${index}/${validatorEvents.length}`, '------', returnValues.publicKey);
    }
  }

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });