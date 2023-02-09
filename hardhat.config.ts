import 'dotenv/config';

import { HardhatUserConfig, task } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import 'hardhat-tracer';
import '@nomiclabs/hardhat-solhint';
import 'hardhat-contract-sizer';
import 'hardhat-storage-layout-changes';

const config: HardhatUserConfig = {
  // Your type-safe config goes here
  mocha: {
    timeout: 40000000000000000
  },
  solidity: {
    compilers: [
      {
        version: '0.8.16',
        settings: {
          optimizer: {
            enabled: true,
            runs: 2000
          }
        }
      }
    ],
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true
    }
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: process.env.ETHERSCAN_KEY
  },
  gasReporter: {
    enabled: true,
    currency: 'USD',
    gasPrice: 0.3
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
