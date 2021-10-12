const Web3 = require('web3');
const fs = require('fs');
const crypto = require('crypto');
const { readFile } = require('fs').promises;
const stringify = require('csv-stringify');
require('dotenv').config();

const web3 = new Web3(process.env.NODE_URL);

const CONTRACT_ADDRESS = "0x687fb596f3892904f879118e2113e1eee8746c2e";
const CONTRACT_ABI = require('./abi.json');
const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
const filteredFields = {
  // 'validators': ['oessList']
};

function convertPublickey(rawValue) {
  const decoded = web3.eth.abi.decodeParameter('string', rawValue.replace('0x', ''));
  return crypto.createHash('sha256').update(decoded).digest('hex');
}

async function getEvents(dataType, fromBlock, latestBlock) {
  const eventName = dataType === 'operators' ? 'OperatorAdded' : 'ValidatorAdded';
  const filters = {
    fromBlock: fromBlock ? fromBlock + 1 : 0,
    toBlock: latestBlock
  };
  console.log(`fetching ${dataType}`, filters);
  const events = await contract.getPastEvents(eventName, filters);
  stringify(await getEventDetails(events, dataType), {
    header: !!!fromBlock
  }, (err, output) => {
    fs.appendFile(`${__dirname}/${dataType}.csv`, output, () => { console.log(`exported ${events.length} ${dataType}`) });
  });
};

async function getEventDetails(events, dataType) {
  return events.map(row => Object.keys(row.returnValues)
    .filter(key => isNaN(key))
    .filter(key => !(filteredFields[dataType] && filteredFields[dataType].indexOf(key) !== -1))
    .reduce((aggr, key) => {
      if (dataType === 'operators' && key === 'publicKey') {
        aggr[key] = convertPublickey(row.returnValues[key]);
      } else if (dataType === 'validators' && key === 'oessList') {
        aggr['operatorPublicKeys'] = row.returnValues[key]
          .reduce((aggr, value) => {
            aggr.push(convertPublickey(value.operatorPublicKey));
            return aggr;
          }, [])
          .join(';');
      } else {
        aggr[key] = row.returnValues[key];
      }
      return aggr;
    }, {})
  );
};

const cacheFile = `${__dirname}/.process.cache`;
fs.stat(cacheFile, async(err, stat) => {
  let blockFromCache;
  if (err == null) {
    blockFromCache = +(await readFile(cacheFile, 'utf8'));
  }
  const latestBlock = await web3.eth.getBlockNumber();
  await getEvents('operators', blockFromCache, latestBlock);
  await getEvents('validators', blockFromCache, latestBlock);
  fs.writeFile(cacheFile, `${latestBlock}`, () => {});
});
