import {ethers, upgrades} from 'hardhat';

const _crypto = require('crypto');
const Web3 = require('web3');
const OLD_CONTRACT_ABI = require('./old_abi.json');
const NEW_CONTRACT_ABI = require('./new_abi.json');

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
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
    const ssvNetwork = await ssvNetworkFactory.attach(process.env.CONTRACT);
    for (let index = 0; index < 3; index++) {
        const tx = await ssvNetwork.batchRegisterOperator(
            publicKey,
            validatorsAmount
        );
        await tx.wait();
    }
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
