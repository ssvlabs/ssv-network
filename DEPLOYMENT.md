# SSV Contracts deployment guide

## Overview

The current structure of the repository branches conforms to the configuration of the target environments as follows:

- `develop`: is the day-to-day working branch, where features are added.
- `stage`: the code here represents a Release Candidate of the next version. Target environment: stage.
- `testnet`: after the stage version is approved, the code is pushed to this branch with the goal of deploying it to the testnet environment
- `main`: once the testnet release is approved, then the contracts are deployed to mainnet.

To generate version numbers, [Sematic Versioning](https://semver.org/) is used, following these rules:

- Tags created using `stage` environment are treated as RCs (i.e `v0.1.0-rc.0` -> `v0.1.0-rc.1` ...)
- Tags created using `testnet` or `main` envs are treated as releases (i.e `v0.1.0-rc.1` becomes `v0.1.0`)
- In both cases, if the user forces an update in the version number (major | minor | patch) via parameter, the rule is overriden (i.e `v0.1.0-rc.2` -> `-t minor` -> `v0.2.0-rc.0`)
- Tags created using develop environment are not tagged

When the target environment is `stage`, `testnet` or `main`, an annotated semantic version tag for current branch is created and the ABI of the contracrs is published to this location in [`contract-abi`](https://github.com/bloxapp/ssv-network/tree/contract-abi) branch:

- `docs/<env>/abi/<tag>` when using `stage`, `testnet` or `main`
- `docs/dev/abi` when using develop

## Deployment guide

First of all, commit all changes in your current and target branch.

To deploy / upgrade contracts, the script `deploy_manger` is used. You can see all options with:
```
sh deploy_manger -h
```

Example of deploying contracts to `stage` environment (Goerli). Previous version: `v0.3.0`

Set all the paramenters in `.env` file:
```bash
[NETWORK]_ETH_NODE_URL=# RPC URL of the node
[NETWORK]_OWNER_PRIVATE_KEY=# Private key of the deployer account, without 0x prefix
GAS_PRICE=# example 30000000000
GAS=# example 500000
ETHERSCAN_KEY=# etherescan API key
SSV_TOKEN_ADDRESS=# etherescan API key
MINIMUM_BLOCKS_BEFORE_LIQUIDATION=# custom param
MINIMUM_LIQUIDATION_COLLATERAL=# custom param
OPERATOR_MAX_FEE_INCREASE=# custom param
DECLARE_OPERATOR_FEE_PERIOD=# custom param
EXECUTE_OPERATOR_FEE_PERIOD=# custom param
SSVNETWORK_PROXY_ADDRESS=# SSVNetwork proxy address, set it when upgrading
SSVNETWORKVIEWS_PROXY_ADDRESS=# SSVNetworkViews proxy address, set it when upgrading
```

```bash
sh deploy_manager -e stage -a deploy
```

The output of this command is composed by some information logs and this ones about the deployment to Goerli network:

```bash
Deploying contracts with the account: 0xf39Fd6...
Deploying SSVNetwork with ssvToken 0x6471F7...
SSVNetwork proxy deployed to: 0x8A7916...
SSVNetwork implementation deployed to: 0x2279B7...
Deploying SSVNetworkViews with SSVNetwork 0x8A7916...
SSVNetworkViews proxy deployed to: 0xB7f8BC...
SSVNetworkViews implementation deployed to: 0x610178...
```

Now, the tag `v0.3.1-rc.0` is created and the ABIs are published to `https://github.com/bloxapp/ssv-network/tree/contract-abi/docs/stage/abi/v0.3.1-rc.0`

**Verify implementation contract on etherscan**

To verify an implementation contract, run this:
```bash 
npx hardhat verify --network <network> <implementation-address>
```
where in this case `network`must be goerli and `implementation-address` is the one showed on the deployment script.

Output of this action will be:
```bash 
Nothing to compile
No need to generate any newer typings.
Successfully submitted source code for contract
contracts/SSVNetwork.sol:SSVNetwork at 0x2279B7...
for verification on the block explorer. Waiting for verification result...

Successfully verified contract SSVNetwork on Etherscan.
https://goerli.etherscan.io/address/0x2279b7dea8ba1bb59a0056f6a5eabd443d47ec78#code
```
After this action, you can go to the proxy contract in Etherscan and start interacting with it.

## Upgrade guide

`deploy_manager` script is used to upgrade `SSVNetwork` and `SSVNetworkViews`.

Pre-requisites:
- Commit all changes in current and target branch.
- Fill `.env` file properly, specially the values for `SSVNETWORK_PROXY_ADDRESS` / `SSVNETWORKVIEWS_PROXY_ADDRESS`
- Update `upgrade-ssvnetwork` / `upgrade-ssvnetworkviews` tasks as needed. 

Example of upgrading `SSVNetwork` contract to `stage` environment (Goerli). Previous version: `v0.3.1-rc0`

```bash
sh deploy_manager -e stage -a upgrade -c ssvnetwork
```

This will generate a new tag version `v0.3.1-rc1` and publish the ABI to `https://github.com/bloxapp/ssv-network/tree/contract-abi/docs/stage/abi/v0.3.1-rc.1`

## Overriding semantic versioning

If a specific upgrade is wanted for the next version, like going from `v0.2.1` to `v1.0.0`, the `-t,--version-type [major|minor|patch]` parameter of `deploy_manager` script can be used. Examples:

- `v0.2.1`: `deploy_manager -t major` -> `v1.0.0`
- `v0.3.0-rc0`: `deploy_manager -t minor` -> `v0.4.0-rc0`
- `v2.0.0`: `deploy_manager -t patch` -> `v2.0.1`


**Important note on upgrades**

Pay special attention when changing storage layout, for example adding new storage variables in `SSVNetwork` and `SSVNetworkViews` (base) contracts.

There is a state variable `uint256[50] __gap;` that you should reduce the size according to the size of the new variables added. More info: [Storage Gaps](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#storage-gaps)