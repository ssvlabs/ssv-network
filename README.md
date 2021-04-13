# SSV Network Project

This repository contains a sample project that you can use as the starting point
for Ethereum project. It's also a great fit for learning the basics of
smart contract development.

This project is intended to be used with the
[Hardhat Beginners Tutorial](https://hardhat.org/tutorial), but you should be
able to follow it by yourself by reading the README and exploring its
`contracts`, `test`, `scripts`  directories.

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
Take a look at `contracts/` folder, you should be able to find `Greeter.sol` as simple contract example.
To compile it, simply run:

```sh
npx hardhat compile
```

### Testing contracts
Take a look at `test/` folder, you should be able to find `sample-test.ts` file.
It comes with tests that use [Waffle](https://getwaffle.io/) and [Ethers.js](https://github.com/ethers-io/ethers.js/).
To run tests, run:

### Deploying contracts
To deploy the contract we will use a Hardhat script. Inside `scripts/` you will find `deploy.ts` file.
Run this to deploy the contract:

```sh
npx hardhat run scripts/deploy.ts --network localhost
```

As general rule, you can target any network configured in the `hardhat.config.ts`

```sh
npx hardhat run --network <your-network> scripts/deploy.ts
```

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