import { HardhatUserConfig } from 'hardhat/config';
import { NetworkUserConfig } from 'hardhat/types';

import 'dotenv/config';

import '@nomicfoundation/hardhat-toolbox-viem';
import '@nomicfoundation/hardhat-chai-matchers';
import '@openzeppelin/hardhat-upgrades';

import 'hardhat-abi-exporter';
import 'hardhat-contract-sizer';
import 'solidity-coverage'

import './tasks/deploy';
import './tasks/update-module';
import './tasks/upgrade';

type SSVNetworkConfig = NetworkUserConfig & {
  ssvToken: string;
};

const config: HardhatUserConfig = {
  mocha: {
    timeout: 40000000000000000,
  },
  solidity: {
    compilers: [
      {
        version: '0.8.4',
      },
      {
        version: '0.8.24',
        settings: {
          optimizer: {
            enabled: true,
            runs: 10000,
          },
        },
      },
    ],
  },
  networks: {
    ganache: {
      chainId: 1337,
      url: 'http://127.0.0.1:8585',
      ssvToken: process.env.SSVTOKEN_ADDRESS, // if empty, deploy SSV mock token
    } as SSVNetworkConfig,
    hardhat: {
      allowUnlimitedContractSize: true,
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_KEY,
    customChains: [
      {
        network: 'holesky',
        chainId: 17000,
        urls: {
          apiURL: 'https://api-holesky.etherscan.io/api',
          browserURL: 'https://holesky.etherscan.io',
        },
      },
    ],
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: false,
    strict: false,
  },
  abiExporter: {
    path: './abis',
    runOnCompile: true,
    clear: true,
    flat: true,
    spacing: 2,
    pretty: false,
    only: ['contracts/SSVNetwork.sol', 'contracts/SSVNetworkViews.sol'],
  },
};

if (process.env.GOERLI_ETH_NODE_URL) {
  const sharedConfig = {
    url: process.env.GOERLI_ETH_NODE_URL,
    accounts: [`0x${process.env.GOERLI_OWNER_PRIVATE_KEY}`],
    gasPrice: +(process.env.GAS_PRICE || ''),
    gas: +(process.env.GAS || ''),
  };
  //@ts-ignore
  config.networks = {
    ...config.networks,
    goerli_development: {
      ...sharedConfig,
      ssvToken: '0x6471F70b932390f527c6403773D082A0Db8e8A9F',
    } as SSVNetworkConfig,
    goerli_testnet: {
      ...sharedConfig,
      ssvToken: '0x3a9f01091C446bdE031E39ea8354647AFef091E7',
    } as SSVNetworkConfig,
  };
}

if (process.env.HOLESKY_ETH_NODE_URL) {
  const sharedConfig = {
    url: process.env.HOLESKY_ETH_NODE_URL,
    accounts: [`0x${process.env.HOLESKY_OWNER_PRIVATE_KEY}`],
    gasPrice: +(process.env.GAS_PRICE || ''),
    gas: +(process.env.GAS || ''),
  };
  //@ts-ignore
  config.networks = {
    ...config.networks,
    holesky_development: {
      ...sharedConfig,
      ssvToken: '0x68A8DDD7a59A900E0657e9f8bbE02B70c947f25F',
    } as SSVNetworkConfig,
    holesky_testnet: {
      ...sharedConfig,
      ssvToken: '0xad45A78180961079BFaeEe349704F411dfF947C6',
    } as SSVNetworkConfig,
  };
}

if (process.env.MAINNET_ETH_NODE_URL) {
  //@ts-ignore
  config.networks = {
    ...config.networks,
    mainnet: {
      url: process.env.MAINNET_ETH_NODE_URL,
      accounts: [`0x${process.env.MAINNET_OWNER_PRIVATE_KEY}`],
      gasPrice: +(process.env.GAS_PRICE || ''),
      gas: +(process.env.GAS || ''),
      ssvToken: '0x9D65fF81a3c488d585bBfb0Bfe3c7707c7917f54',
    } as SSVNetworkConfig,
  };
}

export default config;
