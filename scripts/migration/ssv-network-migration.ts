import { ethers, upgrades } from 'hardhat';

const _crypto = require('crypto');
const Web3 = require('web3');
const OLD_CONTRACT_ABI = require('./old_abi.json');

function toChunks(items, size) {
  return Array.from(
    new Array(Math.ceil(items.length / size)),
    (_, i) => items.slice(i * size, i * size + size)
  );
}

function convertPublickey(rawValue) {
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
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  const ssvNetwork = await ssvNetworkFactory.attach(process.env.MIGRATION_NEW_CONTRACT_ADDRESS);
  const latestBlock = await web3.eth.getBlockNumber();
  const filters = {
    fromBlock: 0,
    toBlock: latestBlock
  };

  console.log(`fetching operators...`, filters);
  const operatorEvents = await oldContract.getPastEvents('OperatorAdded', filters);
  console.log("total operatorEvents", operatorEvents.length);
  let total = 0;
  let params = [[],[],[],[]];
  for (let index = 3; index < operatorEvents.length; index++) {
    const { returnValues } = operatorEvents[index];
    if (total === 3) {
      const tx = await ssvNetwork.batchRegisterOperator(
        params[0],
        params[1],
        params[2],
        params[3]
      );
      await tx.wait();
      params[0].forEach((value, idx) => console.log('+', params[0][idx], params[1][idx], params[2][idx], params[3][idx]));
      total = 0;
      params = [[],[],[],[]];
    }
    params[0].push(returnValues.name);
    params[1].push(returnValues.ownerAddress);
    params[2].push(returnValues.publicKey);
    params[3].push(0);
    total++;
  }
  if (total > 0) {
    try {
      const tx = await ssvNetwork.batchRegisterOperator(
        params[0],
        params[1],
        params[2],
        params[3]
      );
      await tx.wait();
      params[0].forEach((value, idx) => console.log('+', params[0][idx], params[1][idx], params[2][idx], params[3][idx]));  
    } catch (e) {
      console.log('------', params[0], e.message);
    }
  }
  /*
  console.log(`fetching validators...`, filters);
  const validatorEvents = await oldContract.getPastEvents('ValidatorAdded', filters);
  console.log("total validatorEvents", validatorEvents.length);
  for (let index = 0; index < validatorEvents.length; index++) {
    const { returnValues } = validatorEvents[index];
    try {
      const tx = await ssvNetwork.batchRegisterValidator(
        returnValues.ownerAddress,
        returnValues.publicKey,
        returnValues.operatorPublicKeys,
        returnValues.sharesPublicKeys,
        returnValues.encryptedKeys,
        0
      );
      await tx.wait();
      console.log(`${index}/${validatorEvents.length}`, '+', returnValues.ownerAddress, returnValues.publicKey, returnValues.operatorPublicKeys, returnValues.sharesPublicKeys, returnValues.encryptedKeys);  
    } catch (e) {
      console.log(`${index}/${validatorEvents.length}`, '------', returnValues.publicKey);
    }
  }
  */
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
