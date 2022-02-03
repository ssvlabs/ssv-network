const commandLineArgs = require('command-line-args');
const Web3 = require('web3');
const fs = require('fs');
const got = require('got');
const FormData = require('form-data');
const crypto = require('crypto');
const {readFile, stat} = require('fs').promises;
const parse = require('csv-parse');
const stringify = require('csv-stringify');
const {Client} = require('@elastic/elasticsearch');
const {Client: PGClient} = require('pg');
require('dotenv').config();

const web3 = new Web3(process.env.NODE_URL);

const CONTRACT_ABI = require('./abi.json');
const contract = new web3.eth.Contract(CONTRACT_ABI, process.env.CONTRACT_ADDRESS);
const filteredFields = {
    // 'validators': ['oessList']
};
const client = new Client({
    node: process.env.ELASTICSEARCH_URI
});

const pgClient = new PGClient({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB
});

async function pgConnect() {
    pgClient.connect(err => {
        if (err) {
            console.error('postgres connection error', err.stack);
        } else {
            console.log('postgres connected');
        }
    });
}

function convertPublickey(rawValue) {
    try {
        const decoded = web3.eth.abi.decodeParameter('string', rawValue.replace('0x', ''));
        return crypto.createHash('sha256').update(decoded).digest('hex');
    } catch (e) {
        console.error(`convertPublickey err: ${e}`);
        return ""
    }
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
        fs.appendFile(`${__dirname}/${dataType}.csv`, output, () => {
            console.log(`exported ${events.length} ${dataType}`)
        });
    });
}

async function extractOperatorsWithMetrics(operators, validatorsWithMetrics, operatorsDecided, verifiedOperators) {
    let rawData = fs.readFileSync(`${__dirname}/ghost_operators.json`);
    let ghostList = JSON.parse(rawData)['data'];

    return operators.reduce((aggr, operator) => {
        const validators = validatorsWithMetrics.filter((validator) => {
            const operatorsPubkeys = validator.operatorPublicKeys.split(';');
            return !!operatorsPubkeys.find(okey => okey === operator.publicKey);
        });
        const attestationsAvg = (v) => (v.reduce((a, b) => a + +b.attestations, 0) / v.length).toFixed(0);
        operator.active = `${!!operatorsDecided.find(value => value.key === operator.name)}`;
        operator.verified = `${!!verifiedOperators.find(value => value.name === operator.name)}`;
        operator.ghost = `${!!ghostList.find(value => value === operator.name)}`;
        operator.validatorsCount = validators.length;
        operator.effectiveness = (validators.reduce((a, b) => a + +b.effectiveness, 0) / validators.length).toFixed(0);
        operator.attestations = attestationsAvg(validators);
        operator.attestationsWithout0 = attestationsAvg(validators.filter(v => {
            return v.active && v.attestations > 0
        }));
        aggr.push(operator);
        return aggr;
    }, []);
}

async function extractValidatorsWithMetrics(records, operators, operatorsDecided, fromEpoch, toEpoch) {
    const totalEpochs = toEpoch - fromEpoch;
    const MAX_EPOCHS_PER_REQUEST = +process.env.MAX_EPOCHS_PER_REQUEST || 100;
    let epochsPerRequest = 0;
    let lastEpoch = fromEpoch;
    while (lastEpoch + epochsPerRequest <= toEpoch) {
        if (epochsPerRequest === MAX_EPOCHS_PER_REQUEST || (lastEpoch + epochsPerRequest >= toEpoch)) {
            console.log(`fetching metrics for ${lastEpoch}-${lastEpoch + epochsPerRequest} epochs`, epochsPerRequest, fromEpoch, toEpoch);
            const form = new FormData();
            form.append('from', lastEpoch);
            form.append('to', lastEpoch + epochsPerRequest);
            form.append('keys', records.map(item => item.publicKey.replace('0x', '')).join(','));
            form.append('types', 'attest');
            let response;
            try {
                const {body} = await got.post(`http://${process.env.BACKEND_URI}/api/validators/details`, {
                    body: form,
                    responseType: 'json'
                });
                response = body;
            } catch (e) {
                throw new Error(JSON.stringify(e.response.body));
            }

            records.forEach((item) => {
                item.active = `${!!response.find(value => value.PubKey === item.publicKey.replace('0x', ''))}`;
                item.shouldAttest = `${item.operatorPublicKeys.split(';').filter(itemOp => {
                    const opObj = operators.find(op => op.publicKey === itemOp);
                    return opObj !== undefined && !!operatorsDecided.find(decidedOp => decidedOp.key === opObj.name);
                }).length > 2}`;
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
            if (epochsPerRequest + 1 < toEpoch) {
                lastEpoch += epochsPerRequest + 1
            } else {
                lastEpoch = toEpoch;
            }
            epochsPerRequest = 0;
        } else {
            epochsPerRequest++;
        }
    }

    records.forEach(item => {
        if (Array.isArray(item.effectiveness)) {
            item.effectiveness = (item.effectiveness.reduce((a, b) => a + b, 0) / item.effectiveness.length * 100).toFixed(0);
        } else {
            item.effectiveness = 0;
        }

        if (Array.isArray(item.attestations)) {
            item.attestations = (item.attestations.reduce((a, b) => a + b, 0) / item.attestations.length * 100).toFixed(0);
        } else {
            item.attestations = 0;
        }
    });

    return records;
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
}

function buildReport(operatorsWithMetrics, validatorsWithMetrics, fromEpoch, toEpoch) {
    const attrAvg = (v, prop = 'attestations') => (v.reduce((a, b) => a + +b[prop], 0) / v.length);

    const operatorsActive = operatorsWithMetrics.filter((operator) => {
        return operator.active === "true"
    });
    const operatorsActiveNotNaN = operatorsActive.filter((operator) => {
        return operator.attestationsWithout0 !== "NaN"
    });
    const operatorsActiveGte90 = operatorsActiveNotNaN.filter((validator) => {
        return +validator.attestationsWithout0 >= 90
    });
    const validators = validatorsWithMetrics.filter((validator) => {
        return validator.active === "true"
    });
    const validatorsShouldAttest = validators.filter((validator) => {
        return validator.shouldAttest === "true"
    });
    const validatorsShouldAttest0 = validatorsShouldAttest.filter((validator) => {
        return +validator.attestations === 0
    });
    const validatorsShouldAttestNon0 = validatorsShouldAttest.filter((validator) => {
        return +validator.attestations !== 0
    });
    const validatorsShouldAttestGte90 = validatorsShouldAttest.filter((validator) => {
        return +validator.attestations >= 90
    });

    // todo: handle divide by 0
    let metrics = {
        operator: {
            total: operatorsWithMetrics.length,
            active: operatorsActive.length,
            active_per: operatorsActive.length / operatorsWithMetrics.length * 100,
            attr_avg: attrAvg(operatorsActiveNotNaN, 'attestationsWithout0'),
            active_gte_90: operatorsActiveGte90.length,
            active_gte_90_per: operatorsActiveGte90.length / operatorsActive.length * 100,
            attr_avg_gte_90: attrAvg(operatorsActiveGte90, 'attestationsWithout0'),
        },
        validator: {
            active: validators.length,
            should_attest: validatorsShouldAttest.length,
            should_attest_per: validatorsShouldAttest.length / validators.length * 100,
            should_attest_0: validatorsShouldAttest0.length,
            should_attest_0_per: validatorsShouldAttest0.length / validatorsShouldAttest.length * 100,
            attr_avg: attrAvg(validatorsShouldAttestNon0),
            should_attest_gte_90: validatorsShouldAttestGte90.length,
            should_attest_gte_90_per: validatorsShouldAttestGte90.length / validatorsShouldAttest.length * 100,
            attr_avg_gte_90: attrAvg(validatorsShouldAttestGte90)
        }
    }

    let latestMetrics
    const latestMetricsFile = `${__dirname}/latest_metrics.json`;
    try {
        const latestMetricsFs = fs.readFileSync(latestMetricsFile);
        latestMetrics = JSON.parse(latestMetricsFs.toString());
    } catch {
        console.log(`${latestMetricsFile} file not found`)
    }

    if (latestMetrics) {
        metrics.operator.total_chg = changeValueWithSign(metrics.operator.total - latestMetrics.operator.total);
        metrics.operator.active_chg = changeValueWithSign(metrics.operator.active - latestMetrics.operator.active);
        metrics.operator.attr_avg_chg = changeValueWithSign(metrics.operator.attr_avg - latestMetrics.operator.attr_avg, 2);
        metrics.operator.active_gte_90_chg = changeValueWithSign(metrics.operator.active_gte_90 - latestMetrics.operator.active_gte_90);
        metrics = buildMetricsChgValues(metrics, latestMetrics, "validator");
    }
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
    console.log(`daily ssv.network stats (prater: ${fromEpoch}-${toEpoch})`)
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
    console.log("")
    console.log(`Operator Stats (Total: ${metrics.operator.total}${latestMetrics ? "[".concat(metrics.operator.total_chg, "]") : ""})`);
    console.log(` - ${metrics.operator.active_per.toFixed()}% (${metrics.operator.active}${latestMetrics ? "[".concat(metrics.operator.active_chg, "]") : ""}) of operators are active (decided in the last 100 epochs)`);
    console.log(` - ${metrics.operator.attr_avg.toFixed(2)}% ${latestMetrics ? "[".concat(metrics.operator.attr_avg_chg, "%]") : ""} attr.avg (active operators excluding 0 attr.avg)`);
    console.log(` - ${metrics.operator.active_gte_90_per.toFixed()}% (${metrics.operator.active_gte_90}${latestMetrics ? "[".concat(metrics.operator.active_gte_90_chg, "]") : ""}) from the active are >=90% attr.avg with ${metrics.operator.attr_avg_gte_90.toFixed(2)}% attr.avg`);
    printValidatorsStats("Validator Stats", metrics, "validator", latestMetrics)

    const customOperatorPublicKey = process.env.CUSTOM_OPERATOR_PUBLIC_KEY;
    if (customOperatorPublicKey) {
        const customFiltered = (v) => v.filter((val) => {
            return val.operatorPublicKeys.includes(customOperatorPublicKey)
        });

        const customValidators = customFiltered(validators);
        const customValidatorsShouldAttest = customFiltered(validatorsShouldAttest);
        const customValidatorsShouldAttest0 = customFiltered(validatorsShouldAttest0);
        const customValidatorsShouldAttestNon0 = customFiltered(validatorsShouldAttestNon0);
        const customValidatorsShouldAttestGte90 = customFiltered(validatorsShouldAttestGte90);

        if (customValidators.length > 0) {
            metrics.custom = {
                public_key: customOperatorPublicKey,
                active: customValidators.length,
                should_attest: customValidatorsShouldAttest.length,
                should_attest_per: customValidatorsShouldAttest.length / customValidators.length * 100,
                should_attest_0: customValidatorsShouldAttest0.length,
                should_attest_0_per: customValidatorsShouldAttest0.length / customValidatorsShouldAttest.length * 100,
                attr_avg: attrAvg(customValidatorsShouldAttestNon0),
                should_attest_gte_90: customValidatorsShouldAttestGte90.length,
                should_attest_gte_90_per: customValidatorsShouldAttestGte90.length / customValidatorsShouldAttest.length * 100,
                attr_avg_gte_90: attrAvg(customValidatorsShouldAttestGte90)
            }
            if (latestMetrics) {
                //todo handle different custom operators
                metrics = buildMetricsChgValues(metrics, latestMetrics, "custom");
            }
            const customOperatorName = operatorsWithMetrics.find(obj => {
                return obj.publicKey === process.env.CUSTOM_OPERATOR_PUBLIC_KEY
            }).name;
            printValidatorsStats(`${customOperatorName} Operator's Validator Stats`, metrics, "custom", latestMetrics)
        }
    }
    fs.writeFile(latestMetricsFile, JSON.stringify(metrics, null, 4), function (err) {
        if (err) {
            console.log(err);
        }
    });
}

function changeValueWithSign(change, toFix = 0) {
    return `${change >= 0 ? "+" : ""}${change.toFixed(toFix)}`
}

function buildMetricsChgValues(metrics, latestMetrics, type) {
    metrics[type].active_chg = changeValueWithSign(metrics[type].active - latestMetrics[type].active);
    metrics[type].should_attest_chg = changeValueWithSign(metrics[type].should_attest - latestMetrics[type].should_attest);
    metrics[type].should_attest_0_chg = changeValueWithSign(metrics[type].should_attest_0 - latestMetrics[type].should_attest_0);
    metrics[type].attr_avg_chg = changeValueWithSign(metrics[type].attr_avg - latestMetrics[type].attr_avg, 2);
    metrics[type].should_attest_gte_90_chg = changeValueWithSign(metrics[type].should_attest_gte_90 - latestMetrics[type].should_attest_gte_90);
    return metrics
}

function printValidatorsStats(title, metrics, type, latestMetrics) {
    console.log("")
    console.log(`---------------------------------------------------------------------------`);
    console.log(`${title} (Total: ${metrics[type].active}${latestMetrics ? "[".concat(metrics[type].active_chg, "]") : ""})`);
    console.log(` - ${metrics[type].should_attest_per.toFixed()}% (${metrics[type].should_attest}${latestMetrics ? "[".concat(metrics[type].should_attest_chg, "]") : ""}) "should attest" (3 active operators at least)`);
    console.log(` - ${metrics[type].should_attest_0_per.toFixed()}% (${metrics[type].should_attest_0}${latestMetrics ? "[".concat(metrics[type].should_attest_0_chg, "]") : ""}) of the "should attest" validators are not attesting (0 attr.avg)`);
    console.log(` - ${metrics[type].attr_avg.toFixed(2)}% ${latestMetrics ? "[".concat(metrics[type].attr_avg_chg, "%]") : ""} attr.avg ("should attest" excluding 0 attr.avg)`);
    console.log(` - ${metrics[type].should_attest_gte_90_per.toFixed()}% (${metrics[type].should_attest_gte_90}${latestMetrics ? "[".concat(metrics[type].should_attest_gte_90_chg, "]") : ""}) from the "should attest" are >=90% attr.avg with ${metrics[type].attr_avg_gte_90.toFixed(2)}% attr.avg`);
}

async function fetch() {
    const cacheFile = `${__dirname}/.process.cache`;
    fs.stat(cacheFile, async (err, stat) => {
        let blockFromCache;
        if (err == null) {
            blockFromCache = +(await readFile(cacheFile, 'utf8'));
        }
        const latestBlock = await web3.eth.getBlockNumber();
        await exportEventsData('operators', blockFromCache, latestBlock);
        await exportEventsData('validators', blockFromCache, latestBlock);
        fs.writeFile(cacheFile, `${latestBlock}`, () => {
        });
    });
}

async function fetchValidatorMetrics(fromEpoch, toEpoch, from_file) {
    await pgConnect();
    const fromFileSuffix = from_file ? `_extra_${fromEpoch}-${toEpoch}` : "";
    const operatorsFile = `${__dirname}/operators${fromFileSuffix}.csv`;
    const validatorsFile = `${__dirname}/validators${fromFileSuffix}.csv`;
    await stat(validatorsFile);
    await stat(operatorsFile);

    const validators = [];
    const valdatorParser = fs
        .createReadStream(validatorsFile)
        .pipe(parse({
            columns: true
        }));

    for await (const record of valdatorParser) {
        validators.push(record);
    }

    const operators = [];
    const operatorParser = fs
        .createReadStream(operatorsFile)
        .pipe(parse({
            columns: true
        }));

    for await (const record of operatorParser) {
        operators.push(record);
    }

    let verifiedOperators, operatorsDecided, validatorsWithMetrics, operatorsWithMetrics;
    if (from_file) {
        validatorsWithMetrics = validators;
        operatorsWithMetrics = operators;
    } else {
        verifiedOperators = await extractVerifiedOperators();
        operatorsDecided = await extractOperatorsDecided(fromEpoch, toEpoch);
        validatorsWithMetrics = await extractValidatorsWithMetrics(validators, operators, operatorsDecided, fromEpoch, toEpoch);
        operatorsWithMetrics = await extractOperatorsWithMetrics(operators, validatorsWithMetrics, operatorsDecided, verifiedOperators);
    }
    buildReport(operatorsWithMetrics, validatorsWithMetrics, fromEpoch, toEpoch)

    stringify(validatorsWithMetrics, {
        header: true
    }, (err, output) => {
        fs.writeFile(`${__dirname}/validators_extra_${fromEpoch}-${toEpoch}.csv`, output, () => {
            console.log(`exported ${validatorsWithMetrics.length} validator metrics records`)
        });
    });

    stringify(operatorsWithMetrics, {
        header: true
    }, (err, output) => {
        fs.writeFile(`${__dirname}/operators_extra_${fromEpoch}-${toEpoch}.csv`, output, () => {
            console.log(`exported ${operatorsWithMetrics.length} operators metrics records`)
        });
    });
}

function extractOperatorsDecided(fromEpoch, toEpoch) {
    const res = client.search({
        index: 'decided_search_v2_71600',
        body: {
            query: {
                range: {
                    "message.value.Attestation.data.source.epoch": {
                        "gte": fromEpoch,
                        "lte": toEpoch
                    }
                }
            },
            aggs: {
                op: {
                    terms: {
                        field: "signer_ids.name.keyword",
                        size: 10000
                    }
                }
            },
            size: 0
        }
    });
    return res.catch(err => {
        throw new Error(JSON.stringify(err));
    }).then(res => {
        return res.body.aggregations.op.buckets
    })
}

function extractVerifiedOperators() {
    const query = {
        // give the query a unique name
        name: 'fetch-user',
        text: 'SELECT name FROM operators_operator WHERE type = $1',
        values: ['verified_operator'],
    };
    const res = pgClient.query(query);
    return res.catch(err => {
        throw new Error(JSON.stringify(err));
    }).then(res => {
        return res.rows
    })
}

const argsDefinitions = [
    {name: 'command', type: String},
    {name: 'epochs', type: Number, multiple: true},
    {name: 'from_file', alias: 'f', type: Boolean, defaultOption: false},
];

const {command, epochs, from_file} = commandLineArgs(argsDefinitions);

if (command === 'fetch') {
    fetch();
} else if (command === 'metrics') {
    return fetchValidatorMetrics(epochs[0], epochs[1], from_file).then(() =>
        console.log("done with metrics!")
    );
}
