# SSV Network Project

This repository contains a sample project that you can use as the starting point
for Ethereum project. It's also a great fit for learning the basics of
smart contract development.

This project is intended to be used with the
[Hardhat Beginners Tutorial](https://hardhat.org/tutorial), but you should be
able to follow it by yourself by reading the README and exploring its
`contracts`, `test`, `scripts`  directories.

Decision to use Hardhat was based on research best practices to develop smart contracts.
One of the topic about it is [here](https://rahulsethuram.medium.com/the-new-solidity-dev-stack-buidler-ethers-waffle-typescript-tutorial-f07917de48ae).

## Quick start

The first things you need to do are cloning this repository and installing its
dependencies:

```sh
git clone git@github.com:bloxapp/ssv-network.git
cd ssv-network
npm install
```

### Run locally HardHat TestNetwork node 
Once installed, to run Hardhat's testing network:

```sh
npx hardhat node
```

For more details about it and how to use MainNet forking you can find [here](https://hardhat.org/hardhat-network/).

### Compile contracts
Take a look at `contracts/` folder, you should be able to find `SSVNetwork.sol`, `SSVNetworkV2.sol` as simple contract example.
To compile it, simply run:

```sh
npx hardhat compile
```

## CI/CD Workflow

### Step 1: Test contracts
Take a look at `test/` folder, you should be able to find tests related to specific actions.
It comes with tests that use [Waffle](https://getwaffle.io/) and [Ethers.js](https://github.com/ethers-io/ethers.js/).
To run tests, run:

```sh
npx hardhat test
```

### Step 2: Deploy new contracts
We use [Proxy Upgrade pattern](https://docs.openzeppelin.com/upgrades-plugins/1.x/proxies) for smart contracts to have an ability to upgrade them later.
To deploy the contract we will use a Hardhat script. Inside `scripts/` you will find `ssv-registry-deploy.ts` and `ssv-network-deploy.ts` files.
As general rule, you can target any network configured in the `hardhat.config.ts`

#### Deploy SSV Registry

```sh
npx hardhat run --network <your-network> scripts/ssv-registry-deploy.ts
```
Output of this action will be smart SSV Registry contract proxy address.

#### Deploy SSV Network
Before run the cli command, in `.env` need to add the following seetings:

```sh
SSVREGISTRY_ADDRESS=#SSV Registry contract address
SSVTOKEN_ADDRESS=#SSV Token contract address
```

After that:

```sh
npx hardhat run --network <your-network> scripts/ssv-network-deploy.ts
```
Output of this action will be smart SSV Network contract proxy address.

### Step 3: Verify implementation contract on etherscan (each time after upgrade)
Open `.openzeppelin/<network>.json` file and find `[impls.<hash>.address]` value which is implementation smart contract address.
We use [Proxy Upgrade pattern](https://docs.openzeppelin.com/upgrades-plugins/1.x/proxies) for smart contracts to have an ability to upgrade them later.
To deploy the contract we will use a Hardhat script. Inside `scripts/` you will find `deploy.ts` file.
Run this:
```sh
npx hardhat  verify --network <network> <implementation-address>
```

### Step 4: Link proxy contract with implementation on etherscan (each time after upgrade)
Go to `https://<network>.etherscan.io/address/<proxy-address>` and click on `Contract` tab.
On a right side click `More Options` dropbox and select `Is this a proxy?`. On a verification page enter proxy address inside field and click `Verify` button. As result you will see the message:
```sh
The proxy contract verification completed with the message:
The proxy\'s (<proxy-address) implementation contract is found at: <implementation-address>
```
To be sure that values are correct and click `Save` button. As result on etherscan proxy address page in `Contract` tab you will find two new buttons:
`Write as Proxy` and `Read as Proxy` which will represent implementation smart contract functions interface and the actual state.

### Step 5: Upgrade contract
Once we have tested our new implementation, for example `contracts/SSVNetwork.sol` we can prepare the upgrade.
This will validate and deploy our new implementation contract.
#### Upgrade SSV Registry contract:
```sh
PROXY_ADDRESS=0x... npx hardhat run --network <network> scripts/ssv-registry-upgrade.ts
```

#### Upgrade SSV Network contract:
```sh
PROXY_ADDRESS=0x... npx hardhat run --network <network> scripts/ssv-network-upgrade.ts
```
### dApp UI to interact with smart contract

```sh
https://eth95.dev/?network=1&address=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
```

UI dApp [direct link](https://eth95.dev/?network=1&address=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0)

## User Guide

You can find detailed instructions on using this repository and many tips in [its documentation](https://hardhat.org/tutorial).
For a complete introduction to Hardhat, refer to [this guide](https://hardhat.org/getting-started/#overview).

## What’s Included?

Your environment will have everything you need to build a Dapp powered by Hardhat and React.

- [Hardhat](https://hardhat.org/): An Ethereum development task runner and testing network.
- [Mocha](https://mochajs.org/): A JavaScript test runner.
- [Chai](https://www.chaijs.com/): A JavaScript assertion library.
- [ethers.js](https://docs.ethers.io/ethers.js/html/): A JavaScript library for interacting with Ethereum.
- [Waffle](https://github.com/EthWorks/Waffle/): To have Ethereum-specific Chai assertions/mathers.

## Security Audit [OLD Version]

Full audit report [CoinFabrik Report](./docs/SSV_Token_Dex&Vesting_audit.pdf)

## Troubleshooting

- `Invalid nonce` errors: if you are seeing this error on the `npx hardhat node`
  console, try resetting your Metamask account. This will reset the account's
  transaction history and also the nonce. Open Metamask, click on your account
  followed by `Settings > Advanced > Reset Account`.
