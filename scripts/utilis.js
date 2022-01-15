const got = require('got');

const hashedOperators = {};
const hashedValidators = {};

async function fetchOperators() {
    return new Promise((resolve, reject) => {
        getOperators().then(async (operators) => {
            let counter = 1;
            const operatorsCount = operators.length;
            const batches = new Array(Math.ceil(operators.length / process.env.RATE_LIMIT)).fill().map(_ => operators.splice(0, process.env.RATE_LIMIT))
            for (const batch of batches) {
                for (const subBatch of batch) {
                    await new Promise((resolveOperators) => {
                        console.log(`prepare Operator: ${counter} / ${operatorsCount}`)
                        ++counter
                        hashedOperators[subBatch.address] = {
                            name: subBatch.name,
                            validatorsManaged: 0,
                            publicKey: subBatch.public_key,
                            ownerAddress: subBatch.owner_address,
                            verified: subBatch.type === 'verified_operator' || subBatch.type === 'dapp_node'
                        }
                        resolveOperators()
                    })
                }
            }
            resolve()
        }).catch((e) => {
            console.log('<<<<<<<<<<<error>>>>>>>>>>>');
            reject(e.message);
        })
    });
}

async function getValidators() {
    return new Promise(resolve => {
        got.get(process.env.EXPLORER_URI + '/validators/detailed?perPage=500&page=1').then(async (response) => {
            const data = JSON.parse(response.body)
            const numOfPages = data.pagination.pages - 1;
            const validators = [];
            for (let i in Array(numOfPages).fill(null)) {
                const loadValidators = await getValidatorsRequest(Number(i) + 2)
                validators.push(loadValidators);
            }
            resolve([...validators.flat(), ...data.validators]);
        }).catch(() => {
            resolve(getValidators());
        });
    })
}

async function getOperators() {
    return new Promise(async resolve => {
        got.get(process.env.EXPLORER_URI + '/operators/graph?perPage=200&page=1').then(async (response) => {
            const data = JSON.parse(response.body)
            const numOfPages = data.pagination.pages - 1;
            const operators = [];
            for (let i in Array(numOfPages).fill(null)) {
                const loadOperators = await getOperatorsRequest(Number(i) + 2)
                operators.push(loadOperators);
            }
            resolve([...operators.flat(), ...data.operators]);
        }).catch(() => {
            resolve(getOperators());
        });
    })
}

async function getOperatorsRequest(page) {
    return new Promise(resolve => {
        const start = performance.now();
        got.get(process.env.EXPLORER_URI + `/operators/graph?perPage=200&page=${page}`).then(async (response) => {
            const data = JSON.parse(response.body)
            const duration = performance.now() - start;
            if (duration > 250) {
                setTimeout(() => {
                    resolve(data.operators);
                }, duration - 250)
            } else {
                resolve(data.operators);
            }
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
    return new Promise((resolve, reject) => {
        getValidators().then(async (validators) => {
            let counter = 1;
            const validatorsLength = validators.length;
            const batches = new Array(Math.ceil(validators.length / process.env.RATE_LIMIT)).fill().map(_ => validators.splice(0, process.env.RATE_LIMIT))
            for (const batch of batches) {
                for (const subBatch of batch) {
                    console.log('prepare Validator: ' + counter + ' / ' + validatorsLength);
                    ++counter
                    subBatch.operators.forEach((operator)=>{
                        if(hashedOperators[operator.address]) {
                            hashedOperators[operator.address].validatorsManaged += 1
                        }
                    })
                }
            }
            resolve(true);
        }).catch((e) => {
            console.log('<<<<<<<<<<<error>>>>>>>>>>>');
            reject(e.message);
        })
    })
}

async function fetchOperatorsValidators() {
    return new Promise((resolve => {
        fetchOperators().then(() => {
            fetchValidators().then(() => {
                resolve(hashedOperators);
            });
        })
    }))
}


module.exports = {
    fetchOperatorsValidators
}