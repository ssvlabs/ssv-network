const commandLineArgs = require('command-line-args')
const Web3 = require('web3');
const fs = require('fs');
const got = require('got');
const FormData = require('form-data');
const crypto = require('crypto');
const { readFile } = require('fs').promises;
const parse = require('csv-parse');
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

async function exportEventsData(dataType, fromBlock, latestBlock) {
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

async function exportValidatorMetrics(records, fromEpoc, toEpoc) {  
  const totalEpocs = toEpoc - fromEpoc;
  const MAX_EPOCS_PER_REQUEST = 2;
  let epocsAmount = 0;
  let lastEpoc = fromEpoc;
  while (lastEpoc + epocsAmount <= toEpoc) {
    if (epocsAmount === MAX_EPOCS_PER_REQUEST - 1 || (lastEpoc + epocsAmount >= toEpoc)) {
      console.log(`fetching metrics for ${lastEpoc}-${lastEpoc + epocsAmount} epocs`, epocsAmount, fromEpoc, toEpoc);
      const form = new FormData();
      form.append('from', lastEpoc);
      form.append('to', lastEpoc + epocsAmount);
      form.append('keys', records.map(item => item.publicKey.replace('0x', '')).join(','));
      let response;
      try {
        const { body } = await got.post('http://e2m-prater.stage.bloxinfra.com/api/validators/details', {
          body: form,
          responseType: 'json'
        });
        response = body;
      } catch (e) {
        console.log(e.response.body);
        throw new Error(e.response.body);
      }
      records.forEach((item) => {
        const eff = response.find(value => value.PubKey === item.publicKey.replace('0x', ''))?.Effectiveness || 0;
        const att = response.find(value => value.PubKey === item.publicKey.replace('0x', ''))?.Attestations?.Rate || 0;
        if (eff) {
          item.effectiveness = item.effectiveness || [];
          eff && item.effectiveness.push(eff);
        }
        if (att) {
          item.attestations = item.attestations || [];
          att && item.attestations.push(att);  
        }
      });
      lastEpoc += epocsAmount;
      epocsAmount = 0;
    }
    epocsAmount++;
  }
  
  records.forEach(item => {
    if (Array.isArray(item.effectiveness)) {
      item.effectiveness = item.effectiveness.reduce((a, b) => a + b, 0) / item.effectiveness.length;
    }
    if (Array.isArray(item.attestations)) {
      item.attestations = item.attestations.reduce((a, b) => a + b, 0) / item.attestations.length;
    }
  });

  stringify(records, {
    header: true
  }, (err, output) => {
    fs.writeFile(`${__dirname}/validators_extra.csv`, output, () => { console.log(`exported ${records.length} validator metricks records`) });
  });
}

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

async function fetch() {
  const cacheFile = `${__dirname}/.process.cache`;
  fs.stat(cacheFile, async(err, stat) => {
    let blockFromCache;
    if (err == null) {
      blockFromCache = +(await readFile(cacheFile, 'utf8'));
    }
    const latestBlock = await web3.eth.getBlockNumber();
    await exportEventsData('operators', blockFromCache, latestBlock);
    await exportEventsData('validators', blockFromCache, latestBlock);
    fs.writeFile(cacheFile, `${latestBlock}`, () => {});
  });
}

async function fetchValidatorMetrics(fromEpoc, toEpoc) {
  const validatorsFile = `${__dirname}/validators.csv`;
  fs.stat(validatorsFile, async(err, stat) => {
    if (err == null) {
      const records = [];
      const parser = fs
        .createReadStream(validatorsFile)
        .pipe(parse({
          columns: true
        }));
    
      for await (const record of parser) {
        records.push(record);
      }
      await exportValidatorMetrics(records, fromEpoc, toEpoc);
    } else {
      console.error('validators.csv not found');
    }
  });
}

// fetch();
const fromEpoc = 45889;
const toEpoc = 45893;
const argsDefinitions = [
  { name: 'command', type: String },
  { name: 'epocs', type: Number, multiple: true },
];

const { command, epocs } = commandLineArgs(argsDefinitions);

if (command === 'fetch') {
  fetch();
} else if (command === 'metrics') {
  fetchValidatorMetrics(epocs[0], epocs[1]);
}
