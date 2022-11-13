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
  // mocha: {
  //   timeout: 4000000000000
  // },
  solidity: {
    compilers: [
      {
        version: '0.8.13',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      }
    ],
  },
  networks: {
    // hardhat: {
    //   allowUnlimitedContractSize: true
    // },
    goerli: {
      allowUnlimitedContractSize: true,
      url: process.env.GOERLI_ETH_NODE_URL,
      accounts: [`0x${process.env.GOERLI_OWNER_PRIVATE_KEY}`],
      gas: 'auto',
      gasPrice: 'auto'
    }
  },
  // etherscan: {
  //   // Your API key for Etherscan
  //   // Obtain one at https://etherscan.io/
  //   apiKey: process.env.ETHERSCAN_KEY
  // },
  // gasReporter: {
  //   currency: 'USD',
  //   gasPrice: 0.3
  // }
};

// if (process.env.GOERLI_ETH_NODE_URL) {
//   //@ts-ignore
//   config.networks.goerli = {
//       allowUnlimitedContractSize: true,
//       url: process.env.GOERLI_ETH_NODE_URL,
//       accounts: [`0x${process.env.GOERLI_OWNER_PRIVATE_KEY}`],
//       gasPrice: "auto",
//       gas: "auto"
//   };
// }

// if (process.env.MAINNET_ETH_NODE_URL) {
//   //@ts-ignore
//   config.networks.mainnet = {
//     url: process.env.MAINNET_ETH_NODE_URL,
//     accounts: [`0x${process.env.MAINNET_OWNER_PRIVATE_KEY}`],
//     gasPrice: +(process.env.GAS_PRICE || '')
//   };
// }

export default config;
