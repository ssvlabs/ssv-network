const Web3 = require('web3');
const fs = require('fs');
const { readFile } = require('fs').promises;
const stringify = require('csv-stringify');
require('dotenv').config();

const web3 = new Web3(process.env.NODE_URL);

const CONTRACT_ADDRESS = "0x687fb596f3892904f879118e2113e1eee8746c2e";
const CONTRACT_ABI = require('./abi.json');
const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
const filteredFields = {
  'validators': ['oess']
};

async function getEvents(dataType, fromBlock) {
  const latestBlock = await web3.eth.getBlockNumber();
  const eventName = dataType === 'operators' ? 'OperatorAdded' : 'ValidatorAdded';
  const filters = {
    fromBlock: fromBlock && fromBlock + 1,
    toBlock: latestBlock
  };
  const events = await contract.getPastEvents(eventName, filters);
  stringify(await getEventDetails(events, dataType), {
    header: !!!fromBlock
  }, (err, output) => {
    fs.appendFile(`${__dirname}/${dataType}.csv`, output, () => { console.log('saved!') });
  });
  return latestBlock;
};

async function getEventDetails(events, dataType) {
  return events.map(row => Object.keys(row.returnValues)
    .filter(key => isNaN(key))
    .filter(key => !(filteredFields[dataType] && filteredFields[dataType].indexOf(key) !== -1))
    .reduce((aggr, key) => {
      aggr[key] = row.returnValues[key];
      return aggr;
    }, {})
  );
};

const cacheFile = `${__dirname}/.process.cache`;
const args = process.argv.slice(2);
const dataType = args.indexOf('operators') !== -1 ? 'operators' : 'validators';

fs.stat(cacheFile, async(err, stat) => {
  let blockFromCache;
  if (err == null) {
    blockFromCache = +(await readFile(cacheFile, 'utf8'));
  }
  fs.writeFile(cacheFile, `${await getEvents(dataType, blockFromCache)}`, () => {});
});
