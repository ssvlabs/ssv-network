import {ethers, upgrades} from 'hardhat';
import {fetchOperators} from './utilis';

const _crypto = require('crypto');
const Web3 = require('web3');

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
    const ssvNetwork = await ssvNetworkFactory.attach(process.env.CONTRACT_ADDRESS);
    const operators = ['0xe3c1ad14a84ac273f627e08f961f81211bc2dcce730f40db6e06b6c9adf57598fe1c4b2b7d94bac46b380b67ac9f75dec5e0683bbe063be0bc831c988e48c1a3'];
    for (const publicKey of operators) {
        const tx = await ssvNetwork.setValidatorsPerOperator(
            publicKey,
            1
        );
        console.log('<<<<<<<<<<<<<<<<<<<<<<<<<here>>>>>>>>>>>>>>>>>>>>>>>>>');
        console.log(tx)
        console.log('<<<<<<<<<<<<<<<<<<<<<<<<<here>>>>>>>>>>>>>>>>>>>>>>>>>');
        await tx.wait();
    }
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
