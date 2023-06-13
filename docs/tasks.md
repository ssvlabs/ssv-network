# SSV Network

### [Intro](../README.md) | [Architecture](architecture.md) | [Setup](setup.md) | Tasks | [Local development](local-dev.md)

## Development tasks
All tasks can be executed using `package.json` scripts.

 ### Build the contracts
This creates the build artifacts for deployment or testing

```npm run build```

### Test the contracts
This builds the contracts and runs the unit tests. It also runs the gas reporter and it outputs the report at the end of the tests.

```npm run test```

### Run the code coverage
This builds the contracts and runs the code coverage. This is slower than testing since it makes sure that every line of our contracts is tested. It outputs the report in folder `coverage`.

```npm run solidity-coverage```

### Deploy to a local node
Runs the deployment agains a local hardhat node:
```npm run deploy-localhost```

### Deploy to a public testnet (Goerli)
Runs the deployment using Goerli network. Double check `.env` parameters before the execution.
```npm run deploy-testnet```

### Slither
Runs the static analyzer [Slither](https://github.com/crytic/slither), to search for common solidity vulnerabilities. By default it analyzes all contracts.
```npm run slither```

### Size contracts
Compiles the contracts and report the size of each one. Useful to check to not surpass the 24k limit.
```npm run size-contracts```

## Upgrade process
We use [UUPS Proxy Upgrade pattern](https://docs.openzeppelin.com/contracts/4.x/api/proxy) for `SSVNetwork` and `SSVNetworkViews` contracts to have an ability to upgrade them later.

**Important**: It's critical to not add any state variable to `SSVNetwork` nor `SSVNetworkViews` when upgrading. All the state variables are managed by [SSVStorage](../contracts/libraries/SSVStorage.sol) and [SSVStorageProtocol](../contracts/libraries/SSVStorageProtocol.sol). Only modify the logic part of the contracts.

### Upgrade SSVNetwork
##### Upgrade contract logic
In this case, the upgrade add / delete / modify a function, but no other piece in the system is changed (libraries or modules).

Set `SSVNETWORK_PROXY_ADDRESS` in `.env` file to the right value.

Run the upgrade script to use local node:
```npm run upgrade-ssv-network-localhost```

Or public testnet:
```npm run upgrade-ssv-network-testnet```

##### Upgrade a library
When you change a library that `SSVNetwork` uses, you need to also update all modules where that library is used.

Set `SSVNETWORK_PROXY_ADDRESS` in `.env` file to the right value.

Run the upgrade script to use local node:
```npm run upgrade-ssv-network-localhost```

Or public testnet:
```npm run upgrade-ssv-network-testnet```

Run the right script to update the module affected by the library change, as described in [Update a module](#update-a-module) section.

### Upgrade SSVNetworkViews
##### Upgrade contract logic
Same procedure as described for [SSVNetwork](#upgrade-ssvnetworkviews):
Set `SSVNETWORKVIEWS_PROXY_ADDRESS` in `.env` file to the Views contract proxy address.

Run the upgrade script to use local node:
```npm run upgrade-ssv-network-views-localhost```

Or public testnet:
```npm run upgrade-ssv-network-views-testnet```

### Update a module
Sometimes you only need to perform changes in the logic of a function of a module, add a private function or do something that don't affect other components in the architecture. Then you can use the scripts to update modules:
```
npm run update-clusters-mod-localhost # update Clusters module using local node
or
npm run update-clusters-mod-testnet # update Clusters module using goerli
```
```
npm run update-operators-mod-localhost # update Operators module using local node
or
npm run update-operators-mod-testnet # update Operators module using goerli
```
```
npm run update-dao-mod-localhost # update DAO module using local node
or
npm run update-dao-mod-testnet # update DAO module using goerli
```
```
npm run update-views-mod-localhost # update Views module using local node
or
npm run update-views-mod-testnet # update Views module using goerli
```


