import 'dotenv/config';
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig, configVariable } from "hardhat/config";
import '@nomicfoundation/hardhat-ethers-chai-matchers';
import '@nomicfoundation/hardhat-verify';

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
            runs: 1000,
          },
          evmVersion: 'cancun',
        },
      },
    ],
  },
  networks: {
    hardhat: {
      type: 'edr-simulated',
      allowUnlimitedContractSize: true
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
  }
});

declare module "hardhat/types/config" {
  interface HttpNetworkUserConfig {
    ssvToken?: string | undefined;
  }

  interface HttpNetworkConfig {
    ssvToken?: string | undefined;
  }
}
