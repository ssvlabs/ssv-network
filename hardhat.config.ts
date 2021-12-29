import 'dotenv/config';

import { task } from 'hardhat/config';
import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import '@openzeppelin/hardhat-upgrades';
import 'hardhat-gas-reporter';
import 'hardhat-tracer';
import 'solidity-coverage';
import '@nomiclabs/hardhat-solhint';

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task('accounts', 'Prints the list of accounts', async (args, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
const config = {
  solidity: {
    compilers: [
      {
        version: '0.8.2',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    ],
  },
  networks: {},
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: process.env.ETHERSCAN_KEY
  }
}

if (process.env.GANACHE_ETH_NODE_URL) {
  config.networks['ganache'] = {
    url: process.env.GANACHE_ETH_NODE_URL,
    mnemonic: [`0x${process.env.GANACHE_MNEMONIC}`],
    gasPrice: +process.env.GAS_PRICE
  }
}

config.networks['localhost'] = {
  gasPrice: +process.env.GAS_PRICE
}

if (process.env.GOERLI_ETH_NODE_URL) {
  config.networks['goerli'] = {
    url: process.env.GOERLI_ETH_NODE_URL,
    accounts: [`0x${process.env.GOERLI_OWNER_PRIVATE_KEY}`],
    gasPrice: +process.env.GAS_PRICE,
    gas: +process.env.GAS,
  }
}
if (process.env.MAINNET_ETH_NODE_URL) {
    config.networks['mainnet'] = {
        url: process.env.MAINNET_ETH_NODE_URL,
        accounts: [`0x${process.env.MAINNET_OWNER_PRIVATE_KEY}`],
        gasPrice: +process.env.GAS_PRICE
    }
}
module.exports = config;
