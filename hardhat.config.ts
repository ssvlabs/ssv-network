import 'dotenv/config';

import { HardhatUserConfig, task } from 'hardhat/config';
import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import '@openzeppelin/hardhat-upgrades';
import 'hardhat-gas-reporter';
import 'hardhat-tracer';
import 'solidity-coverage';
import '@nomiclabs/hardhat-solhint';

const config: HardhatUserConfig = {
  // Your type-safe config goes here
  solidity: {
    compilers: [
      {
        version: '0.8.13',
        settings: {
          optimizer: {
            enabled: true,
            runs: 10000
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
};

if (process.env.GOERLI_ETH_NODE_URL) {
  //@ts-ignore
  config.networks.goerli = {
    url: process.env.GOERLI_ETH_NODE_URL,
    accounts: [`0x${process.env.GOERLI_OWNER_PRIVATE_KEY}`],
    gasPrice: +(process.env.GAS_PRICE || ''),
    gas: +(process.env.GAS || '')
  };
}

if (process.env.MAINNET_ETH_NODE_URL) {
  //@ts-ignore
  config.networks.mainnet = {
    url: process.env.MAINNET_ETH_NODE_URL,
    accounts: [`0x${process.env.MAINNET_OWNER_PRIVATE_KEY}`],
    gasPrice: +(process.env.GAS_PRICE || '')
  };
}

export default config;