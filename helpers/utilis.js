const got = require('got');

function uniq(a) {
    return [...new Set(a)];
}

const hashedOperators = {};
const hashedValidators = {};

async function fetchOperators() {
    return new Promise(resolve => {
        got.get(process.env.EXPLORER_URI + '/operators/graph/').then(async (response) => {
            let counter = 1;
            const data = JSON.parse(response.body)
            const operators = data.operators;
            const operatorsCount = operators.length;
            const batches = new Array(Math.ceil(operators.length / process.env.RATE_LIMIT)).fill().map(_ => operators.splice(0, process.env.RATE_LIMIT))
            for (const batch of batches) {
                const batchOperators = await Promise.all(batch.map(cell => {
                    return new Promise((resolveOperators) => {
                        console.log(`prepare Operator: ${counter} / ${operatorsCount}`)
                        ++counter
                        resolveOperators(
                            {
                                name: cell.name,
                                validatorsManaged: 0,
                                publicKey: cell.address,
                                ownerAddress: cell.owner_address,
                                verified: cell.type === 'verified_operator' || cell.type === 'dapp_node'
                            }
                        )
                    })
                }))
                batchOperators.forEach(operator => hashedOperators[operator.publicKey] = operator)
            }
            resolve()
        }).catch(() => {
            resolve(fetchOperators());
        })
    });
}

async function getValidators() {
    return new Promise(resolve => {
        got.get(process.env.EXPLORER_URI + '/validators/detailed?perPage=500&page=1').then(async (response) => {
            const data = JSON.parse(response.body)
            const numOfPages = data.pagination.pages;
            const validators = await Promise.all(Array(numOfPages).fill(null).map((_, i) => getValidatorsRequest(i + 2)));
            resolve([...validators.flat(), ...data.validators]);
        }).catch(() => {
            resolve(getValidators());
        });
    })
}

async function getValidatorsRequest(page) {
    return new Promise(resolve => {
        got.get(process.env.EXPLORER_URI + `/validators/detailed?perPage=500&page=${page}`).then(async (response) => {
            const data = JSON.parse(response.body)
            resolve(data.validators);
        });
    })
}

async function fetchValidators() {
    return new Promise(resolve => {
        getValidators().then(async (validators) => {
            let counter = 1;
            const validatorsLength = validators.length;
            const batches = new Array(Math.ceil(validators.length / process.env.RATE_LIMIT)).fill().map(_ => validators.splice(0, process.env.RATE_LIMIT))
            for (const batch of batches) {
                const batchValidators = await Promise.all(batch.map(cell => {
                    return new Promise((resolveValidators) => {
                        const validatorPublicKey = cell.publicKey.startsWith('0x') ? cell.publicKey : `0x${cell.publicKey}`;
                        console.log('prepare Validator: ' + counter + ' / ' + validatorsLength)
                        cell.operators.forEach(operator => {
                            if (hashedOperators[operator.address]) hashedOperators[operator.address].validatorsManaged += 1
                        })
                        ++counter
                        resolveValidators({
                            publicKey: validatorPublicKey,
                            operators: cell.operators
                        })
                    })
                }))
                batchValidators.forEach(validator => hashedValidators[validator.publicKey] = validator)
            }
            resolve();
        })
    })
}

async function fetchOperators(fromEpoch, toEpoch) {
    return new Promise(async (resolve => {
        fetchOperators(fromEpoch, toEpoch).then(() => {
            fetchValidators(fromEpoch, toEpoch).then(() => {
                resolve(hashedOperators);
            });
        })
    }))
}


module.exports = {
    fetchOperators
}