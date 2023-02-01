# SSV Network Project

This repository contains a SSVNetwork smart contacts project.

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
Take a look at `contracts/` folder, you should be able to find `SSVNetwork.sol`.
To compile it, simply run:

```sh
npx hardhat compile
```

## CI/CD Workflow

### Step 1: Test contracts
Take a look at `test/` folder, you should be able to find tests related to specific actions.
It comes with tests that use [Ethers.js](https://github.com/ethers-io/ethers.js/).
To run tests, run:

```sh
npx hardhat test
```

### Step 2: Deploy new contracts
We use [UUPS Proxy Upgrade pattern](https://docs.openzeppelin.com/contracts/4.x/api/proxy) for smart contracts to have an ability to upgrade them later.
To deploy the contract we will use a Hardhat script. Inside `scripts/` you will find `ssv-network-deploy.ts` and `ssv-network-upgrade.ts` files.
As general rule, you can target any network configured in the `hardhat.config.ts`,
specifying the right [network]_ETH_NODE_URL and [network]_OWNER_PRIVATE_KEY in `.env` file.

#### Deploy SSV Network

Before run the cli command, in `.env` need to add the following seetings:

```sh
[NETWORK]_ETH_NODE_URL=# RPC URL of the node
[NETWORK]_OWNER_PRIVATE_KEY=# Private key of the deployer account, without 0x prefix
GAS_PRICE=# example 30000000000
GAS=# example 8000000
ETHERSCAN_KEY=# etherescan API key
SSVTOKEN_ADDRESS=#SSV Token contract address
MINIMUM_BLOCKS_BEFORE_LIQUIDATION=# custom param
OPERATOR_MAX_FEE_INCREASE=# custom param
DECLARE_OPERATOR_FEE_PERIOD=# custom param
EXECUTE_OPERATOR_FEE_PERIOD=# custom param
VALIDATORS_PER_OPERATOR_LIMIT=# custom param
REGISTERED_OPERATORS_PER_ACCOUNT_LIMIT=# custom param
PROXY_ADDRESS=# Proxy address, set it when runnning ssv-network-upgrade.ts script
```

```sh
npx hardhat run --network <your-network> scripts/ssv-network-deploy.ts
```
Output of this action will be smart SSV Network contract proxy address.

### Step 3: Verify implementation contract on etherscan (each time after upgrade)
Open `.openzeppelin/<network>.json` file and find `[impls.<hash>.address]` value which is implementation smart contract address.
We use [UUPS Proxy Upgrade pattern](https://docs.openzeppelin.com/contracts/4.x/api/proxy) for smart contracts to have an ability to upgrade them later.
To deploy the contract we will use a Hardhat script. Inside `scripts/` you will find `ssv-network-deploy.ts` file.
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

### Step 5: Upgrade SSVNetwork contract
Once we have tested our new implementation, for example `contracts/SSVNetwork.sol` we can prepare the upgrade.

In `.env` file, remember to set `PROXY_ADDRESS`.

**Important**
Pay special attention when changing storage layout, for example adding new storage variables
in `SSVNetwork` (base) contract.
There is a state variable `uint256[50] __gap;` that you should reduce the size according to
the size of the new variables added. More info: [Storage Gaps](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#storage-gaps)

To validate the upgrade before running it:
```sh
npx hardhat run --network <your-network> scripts/ssv-network-validate-upgrade.ts
```
To fire the upgrade process:
```sh
npx hardhat run --network <your-network> scripts/ssv-network-upgrade.ts
```

If you get the error:
`
Error: invalid hex string ...
reason: 'invalid hex string',
code: 'INVALID_ARGUMENT',
`
Set or change the parameters `GAS_PRICE` and `GAS` in `.env` file.

#### Version tracking

`SSVNetwork` contract keeps its version number using the state variable `version`, which can be queried at any time but is only updated via the upgrade process. The assignement of the new version number takes place in the initializer function of the new contract, particularly in the `reinitializer` modifier. The new version should be higher than the previous one. More info [here](https://docs.openzeppelin.com/contracts/4.x/api/proxy#Initializable-reinitializer-uint8-)
Example upgrade contract:
```
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "./SSVNetwork.sol";

contract SSVNetwork_v2 is SSVNetwork {
    function initializev2() external reinitializer(version + 1) {
         version = _getInitializedVersion();
    }
}
```
Here the current `version` number incremented by one is passed to the `reinitializer` function. Then, `Initializable._getInitializedVersion()` picks that new number and its assigned to the SSVNetwork's `version` state variable.
So following this method, the SSVNetwork's version number is synced with the `Initializable` logic, making it more easy to follow a solid upgrade process.


### dApp UI to interact with smart contract

```sh
https://eth95.dev/?network=1&address=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
```

UI dApp [direct link](https://eth95.dev/?network=1&address=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0)
