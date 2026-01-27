import 'dotenv/config';
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig, configVariable } from "hardhat/config";
import '@nomicfoundation/hardhat-ethers-chai-matchers';
import '@nomicfoundation/hardhat-verify';

const isCoverage = process.env.COVERAGE === "true";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    npmFilesToBuild: ["@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol"],
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
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: isCoverage ? 200 : 10000,
          },
          evmVersion: 'cancun',
        },
      },
    ],
  },
  networks: {
    hardhat: {
      type: 'edr-simulated',
      allowUnlimitedContractSize: true,
      blockGasLimit: 500_000_000,
    },
    hardhat_forked: {
      type: 'edr-simulated',
      allowUnlimitedContractSize: true,
      blockGasLimit: 100_000_000,
      forking: {
        url: configVariable("MAINNET_RPC_URL"),
        blockNumber: process.env.FORK_BLOCK_NUMBER ? Number(process.env.FORK_BLOCK_NUMBER) : undefined,
      }
    },
    hoodi: {
      type: "http",
      chainType: "l1",
      url: configVariable("HOODI_RPC_URL"),
      accounts: [configVariable("HOODI_PRIVATE_KEY")],
      ssvToken: process.env.HOODI_SSVTOKEN_ADDRESS
    },
    mainnet: {
      type: "http",
      chainType: "l1",
      url: configVariable("MAINNET_RPC_URL"),
      accounts: [configVariable("MAINNET_PRIVATE_KEY")],
      ssvToken: process.env.MAINNET_SSVTOKEN_ADDRESS
    }
  },
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_KEY"),
    },
  },
  test: {
    mocha: {
      timeout: 300_000,
    },
  },
});

declare module "hardhat/types/config" {
  interface HttpNetworkUserConfig {
    ssvToken?: string | undefined;
  }

  interface HttpNetworkConfig {
    ssvToken?: string | undefined;
  }
}
