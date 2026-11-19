import 'dotenv/config';
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig, configVariable } from "hardhat/config";
import '@nomicfoundation/hardhat-ethers-chai-matchers';
import '@nomicfoundation/hardhat-verify';

const isCoverage = process.env.COVERAGE === "true";
const envValue = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
};
const localForkRpcUrl = "http://127.0.0.1:8545";
const localForkChainId = 31337;
const mainnetRpcUrl =
  envValue("MAINNET_RPC_URL") ??
  configVariable("MAINNET_RPC_URL");

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  chainDescriptors: {
    [localForkChainId]: {
      name: "Local Anvil Fork",
      chainType: "l1",
      hardforkHistory: {
        // Local Anvil forks report chainId 31337 with upstream block numbers.
        // EDR needs an explicit history for custom chain IDs to execute historical calls.
        cancun: { blockNumber: 0 },
      },
    },
  },
  paths: {
    tests: {
      mocha: "test",
      // Echidna harnesses are compiled by Echidna/Foundry,
      // not Hardhat's Solidity test runner.
      solidity: "test/solidity",
    },
  },
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
      hardfork: 'cancun',
      allowUnlimitedContractSize: true,
      blockGasLimit: 500_000_000,
    },
    hardhat_forked: {
      type: 'edr-simulated',
      chainType: "l1",
      allowUnlimitedContractSize: true,
      blockGasLimit: 100_000_000,
      forking: {
        url: mainnetRpcUrl,
        blockNumber: process.env.FORK_BLOCK_NUMBER ? Number(process.env.FORK_BLOCK_NUMBER) : undefined,
      }
    },
    local: {
      type: "http",
      chainType: "l1",
      url: localForkRpcUrl,
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
      url: mainnetRpcUrl,
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
