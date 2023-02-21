# SSV Network Project


This repository contains a SSVNetwork smart contacts project.

## Quick start

The first things you need to do are cloning this repository and installing its dependencies:


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

Take a look at `contracts/` folder, you should be able to find:
- `SSVNetwork.sol`: Base contract for SSV Network operations.
- `SSVNetworkViews.sol`: Contract with view functions only to retrive information from SSVNetwork contract.
- `libraries`: Folder which contains library contracts that implement operators, clusters and network functionalities.

To compile them, simply run:

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

To deploy the contract we will use a Hardhat script. Inside `scripts/` you will find:
- `deploy-all.ts`: Deploys both `SSVNetwork.sol` and `SSVNetworkViews.sol`.
- `validate-upgrade-ssv-network`: Validates if `SSVNetwork` is upgrade safe.
- `validate-upgrade-ssv-network-views`: Validates if `SSVNetworkViews` is upgrade safe.
- `upgrade-ssv-network`: Upgrades `SSVNetwork` contract.
- `upgrade-ssv-network-views`: Upgrades `SSVNetworkViews` contract.

As general rule, you can target any network configured in the `hardhat.config.ts`, specifying the right [network]_ETH_NODE_URL and [network]_OWNER_PRIVATE_KEY in `.env` file.
  
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
SSVNETWORK_PROXY_ADDRESS=# SSVNetwork proxy address, set it when runnning upgrade-ssv-network.ts script
SSVNETWORKVIEWS_PROXY_ADDRESS=# SSVNetworkViews proxy address, set it when runnning upgrade-ssv-network-views.ts script
INITIAL_VERSION=# SSVNetwork initial version, example: "1.0.0"
```

  Then run:
```sh
npx hardhat run --network <your-network> scripts/deploy-all.ts
```

Output of this action will be:

```sh
Deploying contracts with the account:0xf39Fd6...
Deploying SSVNetwork with ssvToken 0x6471F7...
SSVNetwork proxy deployed to: 0x8A7916...
SSVNetwork implementation deployed to: 0x2279B7...
Deploying SSVNetworkViews with SSVNetwork 0x8A7916...
SSVNetworkViews proxy deployed to: 0xB7f8BC...
SSVNetworkViews implementation deployed to: 0x610178...
```

You can now go to Etherscan and see:
- `SSVNetwork` proxy contract is deployed to the address shown previously in `SSVNetwork proxy deployed to`
- `SSVNetwork` implementation contract is deployed to the address shown previously in `SSVNetwork implementation deployed to`
- `SSVNetworkViews` proxy contract is deployed to the address shown previously in `SSVNetworkViews proxy deployed to`
- `SSVNetworkViews` implementation contract is deployed to the address shown previously in `SSVNetworkViews implementation deployed to`

Example: [https://goerli.etherscan.io/address/0xe2e28fdea8ba1bb59a0056f6a5eabd443d47ec78](https://goerli.etherscan.io/address/0xe2e28fdea8ba1bb59a0056f6a5eabd443d47ec78)

### Step 3: Verify implementation contract on etherscan (each time after upgrade)

Open `.openzeppelin/<network>.json` file and find `[impls.<hash>.address]` value which is implementation smart contract address.
You will find 2 `[impls.<hash>]` entries, one for `SSVNetwork` and another for `SSVNetworkViews`.
Run this verification process for both.

You can take it from the output of the `deploy-all.ts` script.
 

To verify an implementation contract, run this:

```sh
npx hardhat verify --network <network> <implementation-address>
```

Output of this action will be:
```sh
Nothing to compile
No need to generate any newer typings.
Successfully submitted source code for contract
contracts/SSVNetwork.sol:SSVNetwork at 0x2279B7...
for verification on the block explorer. Waiting for verification result...

Successfully verified contract SSVNetwork on Etherscan.
https://goerli.etherscan.io/address/0x2279b7dea8ba1bb59a0056f6a5eabd443d47ec78#code
```

After this action, you can go to the proxy contract in Etherscan and start interacting with it.
  
## Upgrade process
### Upgrade SSVNetwork contract

Once we have tested our new implementation, for example `contracts/SSVNetwork_V2.sol` we can prepare the upgrade.

  
In `.env` file, remember to set `SSVNETWORK_PROXY_ADDRESS` with the address of the `SSVNetwork` proxy contract.

To validate the upgrade before running it:

```sh
npx hardhat run --network <your-network> scripts/validate-upgrade-ssv-network.ts
```

To fire the upgrade process:

```sh
npx hardhat run --network <your-network> scripts/upgrade-ssv-network.ts
```

If you get the error:

`
Error: invalid hex string ...
reason: 'invalid hex string',
code: 'INVALID_ARGUMENT',
`

Set or change the parameters `GAS_PRICE` and `GAS` in `.env` file.

### Upgrade SSVNetworkViews contract

Once we have tested our new implementation, for example `contracts/SSVNetworkViews_V2.sol` we can prepare the upgrade.

In `.env` file, remember to set `SSVNETWORKVIEWS_PROXY_ADDRESS` with the address of the `SSVNetworkViews` proxy .

To validate the upgrade before running it:

```sh
npx hardhat run --network <your-network> scripts/validate-upgrade-ssv-network-views.ts
```

To fire the upgrade process:

```sh
npx hardhat run --network <your-network> scripts/upgrade-ssv-network-views.ts
```

**Important note on upgrades**

Pay special attention when changing storage layout, for example adding new storage variables in `SSVNetwork` and `SSVNetworkViews` (base) contracts.

There is a state variable `uint256[50] __gap;` that you should reduce the size according to the size of the new variables added. More info: [Storage Gaps](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#storage-gaps)


## Modify the limit of validators that an operator can manage
In `SSVNetwork` contract, the state variable `validatorsPerOperatorLimit` is used to represent the máximum number of validators that can be registered per operator. Its default value is `2000`.

To change it, the upgrade process should be fired. The assignement to a new value must be in a new initializer function. Pay special attention to the `reinitializer` modifier where there should be a number higher than the one consumed in previous initialized contracts. More info [here](https://docs.openzeppelin.com/contracts/4.x/api/proxy#Initializable-reinitializer-uint8-)
Example upgrade contract:
```
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "../SSVNetwork.sol";

contract SSVNetwork_v2 is SSVNetwork {
    
    function initializev2(uint32 validatorsPerOperatorLimit_) reinitializer(2) external {
        validatorsPerOperatorLimit = validatorsPerOperatorLimit_;
    }
}
```


## Transfer the ownership of the contract
The process of transferring the ownership of the SSVNetwork contract is implemented using OpenZeppelin's `Ownable2StepUpgradeable` contract, and consists of the following steps:
1. Current owner calls `SSVNetwork`'s `transferOwnership` function with the new owner address as parameter.
2. The new owner calls `SSVNetwork`'s `acceptOwnership` fucntion and the ownership of the contract is transferred.

#### Version tracking

`SSVNetwork` contract keeps its version number using the state variable `version`, which can be queried at any time but is only updated via the upgrade process. The assignement of the new version number takes place in the initializer function of the new contract. We follow [SemVer](https://semver.org/) spec. 

Example upgrade contract:
```
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "./SSVNetwork.sol";

contract SSVNetworkVersionUpgrade is SSVNetwork {
    function initializev2(string calldata _version) external reinitializer(_getInitializedVersion() + 1) {
         version = bytes32(abi.encodePacked((_version)));
    }
}
```
Here a new `_version` is passed to the `initializev2` function that is executed in the upgrade process. The `Initializable._getInitializedVersion()` call picks the latest version of previously initialized contracts and is increased by 1.
