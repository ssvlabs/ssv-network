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

### Running test network node
Once installed, to run Hardhat's testing network:

```sh
npx hardhat node
```

### Compiling contracts
Take a look at `contracts/` folder, you should be able to find `Blox.sol` as simple contract example.
To compile it, simply run:

```sh
npx hardhat compile
```

### Testing contracts
Take a look at `test/` folder, you should be able to find tests rlated to specific actions.
It comes with tests that use [Waffle](https://getwaffle.io/) and [Ethers.js](https://github.com/ethers-io/ethers.js/).
To run tests, run:

```sh
npx hardhat test
```

### Deploying contracts
We use [Proxy Upgrade pattern](https://docs.openzeppelin.com/upgrades-plugins/1.x/proxies) for smart contracts to have an ability to upgrade them later.
To deploy the contract we will use a Hardhat script. Inside `scripts/` you will find `deploy.ts` file.
Run this to deploy the contract:

```sh
npx hardhat run scripts/deploy.ts --network localhost
```

As general rule, you can target any network configured in the `hardhat.config.ts`

```sh
npx hardhat run --network <your-network> scripts/deploy.ts
```

### Transfer control of upgrades
The admin (who can perform upgrades) for our proxy is a ProxyAdmin contract. Only the owner of the ProxyAdmin can upgrade our proxy.
Warning: Ensure to only transfer ownership of the ProxyAdmin to an address we control.

As example, we will use [Gnosis Safe](https://help.gnosis-safe.io/en/articles/3876461-create-a-safe-multisig) to control upgrades of our contracts.

To transfer ownership run:

```sh
GNOSIS_SAFE_ADDRESS=0x..... npx hardhat run scripts/transfer-ownership.ts --network <your-network/localhost>
```

### Create a new contract version
After a period of time, we decide that we want to add functionality to our contract which are described in `contracts/BloxV2.sol`.

Note: We cannot change the storage layout of our implementation contract, see [Upgrading](https://docs.openzeppelin.com/learn/upgrading-smart-contracts#upgrading) for more details on the technical limitations.

### Local Testing Network deploy the new implementation
Once we have tested our new implementation, we can upgrade it.

To upgrade in HardHat Testing Network:

```sh
PROXY_ADDRESS=0x... npx hardhat run --network localhost scripts/prepare-upgrade.ts
```

### Upgrade the contract in TestNet or MainNet
Once we have tested our new implementation, we can prepare the upgrade. This will validate and deploy our new implementation contract.
Note: For mainnet we are only preparing the upgrade. We will use our Gnosis Safe to perform the actual upgrade.

To prepare for upgrade:

```sh
PROXY_ADDRESS=0x... npx hardhat run --network localhost scripts/upgrade.ts
```

To manage our upgrade in Gnosis Safe we use the OpenZeppelin app.
In the Apps tab, select the OpenZeppelin application and paste the address of the proxy in the Contract address field, and paste the address of the new implementation in the New implementation address field.
The app should show that the contract is EIP1967-compatible.

Double check the addresses, and then press the Upgrade button.
We will be shown a confirmation dialog to Submit the transaction.

We then need to sign the transaction in MetaMask (or the wallet that you are using).

We can also manage the upgrade using [OpenZeppelin Defender Admin](https://defender.openzeppelin.com/)
More details in [documentation](https://docs.openzeppelin.com/defender/admin#upgrades)

### dApp UI to interact with smart contract

```sh
https://eth95.dev/?network=1&address=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
```

UI dApp [direct link](https://eth95.dev/?network=1&address=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0)

### Running tasks
Hardhat Runner, the CLI command to interact with Hardhat, is an extensible task runner.
It's designed around the concepts of tasks and plugins. Every time you're running Hardhat from the CLI you're running a task.
E.g. `npx hardhat compile` is running the built-in `compile` task

To first get a quick sense of what's available and what's going on, run `npx hardhat` in folder project.
If you take a look at the `hardhat.config.ts` file, you will find the definition of the task `accounts`.
To run it, try:

```sh
npx hardhat accounts
```

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

## Troubleshooting

- `Invalid nonce` errors: if you are seeing this error on the `npx hardhat node`
  console, try resetting your Metamask account. This will reset the account's
  transaction history and also the nonce. Open Metamask, click on your account
  followed by `Settings > Advanced > Reset Account`.

**Happy _buidling_!**