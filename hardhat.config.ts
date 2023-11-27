import 'dotenv/config';

import { HardhatUserConfig } from 'hardhat/config';
import { NetworkUserConfig } from "hardhat/types";
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import 'hardhat-tracer';
import '@nomiclabs/hardhat-solhint';
import 'hardhat-contract-sizer';
import 'hardhat-storage-layout-changes';
import './tasks/deploy';
import './tasks/update-module';
import './tasks/upgrade';

type SSVNetworkConfig = NetworkUserConfig & {
  ssvToken: string;
}


const config: HardhatUserConfig = {
  // Your type-safe config goes here
  mocha: {
    timeout: 40000000000000000
  },
  solidity: {
    compilers: [
      {
        version: "0.8.4",
      },
      {
        version: '0.8.18',
        settings: {
          optimizer: {
            enabled: true,
            runs: 10000
          }
        }
      }
    ],
  },
  networks: {
    devnet: {
      url: "http://geth:8545",
      accounts: [`0x2e0834786285daccd064ca17f1654f67b4aef298acbb82cef9ec422fb4975622`],
      gasPrice: +(process.env.GAS_PRICE || ''),
      gas: +(process.env.GAS || ''),
    } as SSVNetworkConfig
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: process.env.ETHERSCAN_KEY,
    customChains: [
      {
        network: "holesky",
        chainId: 17000,
        urls: {
          apiURL: "https://api-holesky.etherscan.io/api",
          browserURL: "https://holesky.etherscan.io"
        }
      }
    ]
  },
  gasReporter: {
    enabled: true,
    currency: 'USD',
    gasPrice: 0.3
  }
};

export default config;
