import {ethers, upgrades} from 'hardhat';
import {fetchOperatorsValidators} from './utilis';

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
    console.log('<<<<<<<<<<<<<<<<here>>>>>>>>>>>>>>>>');
    const operators = await fetchOperatorsValidators();
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
    const ssvNetwork = await ssvNetworkFactory.attach(process.env.CONTRACT_ADDRESS);
    for (const publicKey of Object.keys(operators)) {
        const pubKey = new Web3().eth.abi.encodeParameter('string', operators[publicKey].publicKey);
        const validatorsManaged = operators[publicKey].validatorsManaged;
        if(pubKey === '0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000002644c5330744c5331435255644a54694253553045675546564354456c4449457446575330744c533074436b314a53554a4a616b464f516d64726357687261556335647a424351564646526b464254304e425554684254556c4a516b4e6e53304e4255555642623364464e303946596e643554477432636c6f7756465530616d6f4b6232393153555a34546e5a6e636c6b34526d6f7256334e736556705562486c714f4656455a6b5a7957576731565734796454525a545752425a53746a5547597857457372515339514f5668594e3039434e47356d4d51705062306457516a5a33636b4d76616d684d596e5a50534459314d484a3556566c766347565a6147785457486848626b5130646d4e3256485a6a6355784d516974315a54497661586c546546464d634670534c7a5a57436e4e554d325a47636b5676626e704756484675526b4e33513059794f476c51626b7057516d70594e6c517653474e55536a553153555272596e52766447467956545a6a6433644f543068755347743656334a324e326b4b64486c5161314930523255784d576874566b633555577053543351314e6d566f57475a4763305a764e55317855335a7863466c776246687253533936565535744f476f76624846465a465577556c6856636a517854416f7961486c4c57533977566d707a5a32316c56484e4f4e79396163554644613068355a546c47596d74574f565976566d4a556144646f56315a4d5648464855326733516c6b765244646e643039335a6e564c61584579436c52335355524255554643436930744c5330745255354549464a545153425156554a4d53554d675330565a4c5330744c53304b00000000000000000000000000000000000000000000000000000000') {
            console.log(operators[publicKey].name);
            console.log(validatorsManaged);
        }
        // if(validatorsManaged > 0) {
        //     const tx = await ssvNetwork.setValidatorsPerOperator(
        //         pubKey,
        //         validatorsManaged
        //     );
        //     console.log('<<<<<<<<<<<<<<<<<<<<<<<<<here>>>>>>>>>>>>>>>>>>>>>>>>>');
        //     console.log(tx)
        //     console.log('<<<<<<<<<<<<<<<<<<<<<<<<<here>>>>>>>>>>>>>>>>>>>>>>>>>');
        //     await tx.wait();
        // }
    }
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
