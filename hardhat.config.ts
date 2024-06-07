import { HardhatUserConfig } from 'hardhat/config';
import { NetworkUserConfig } from 'hardhat/types';

import 'dotenv/config';

import '@nomicfoundation/hardhat-toolbox-viem';
import '@nomicfoundation/hardhat-chai-matchers';
import '@openzeppelin/hardhat-upgrades';

import 'hardhat-abi-exporter';
import 'hardhat-contract-sizer';
import 'solidity-coverage';

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
        version: '0.8.18',
      },
      {
        version: '0.8.24',
        settings: {
          optimizer: {
            enabled: true,
            runs: 10000,
          },
          evmVersion: 'cancun',
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
  sourcify: {
    enabled: false
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

if (process.env.HOLESKY_ETH_NODE_URL && process.env.HOLESKY_OWNER_PRIVATE_KEY) {
  const sharedConfig = {
    url: `${process.env.HOLESKY_ETH_NODE_URL}${process.env.NODE_PROVIDER_KEY}`,
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

if (process.env.MAINNET_ETH_NODE_URL && process.env.MAINNET_OWNER_PRIVATE_KEY) {
  //@ts-ignore
  config.networks = {
    ...config.networks,
    mainnet: {
      url: `${process.env.MAINNET_ETH_NODE_URL}${process.env.NODE_PROVIDER_KEY}`,
      accounts: [`0x${process.env.MAINNET_OWNER_PRIVATE_KEY}`],
      gasPrice: +(process.env.GAS_PRICE || ''),
      gas: +(process.env.GAS || ''),
      ssvToken: '0x9D65fF81a3c488d585bBfb0Bfe3c7707c7917f54',
    } as SSVNetworkConfig,
  };
}

if (process.env.FORK_TESTING_ENABLED) {
  config.networks = {
    ...config.networks,
    hardhat: {
      ...config.networks?.hardhat,
      forking: {
        enabled: process.env.FORK_TESTING_ENABLED === 'true',
        url: `${process.env.MAINNET_ETH_NODE_URL}${process.env.NODE_PROVIDER_KEY}`,
        blockNumber: 19621100,
      },
    },
  };
}

export default config;
