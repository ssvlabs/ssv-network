# Deployment steps

This project uses just recipes and hardhat scripts to perform the deployment and upgrade of the main contracts and modules.

### Deploy all contracts

Runs the deployment of the main SSVNetwork and SSVNetworkViews contracts, along with their associated modules:

```bash
just deploy-all <NETWORK_NAME>
```

#### Example:

```bash
just deploy-all hoodi
```

When deploying to live networks like Holesky or Mainnet, please double check the environment variables:

- MINIMUM_BLOCKS_BEFORE_LIQUIDATION
- MINIMUM_LIQUIDATION_COLLATERAL
- VALIDATORS_PER_OPERATOR_LIMIT
- DECLARE_OPERATOR_FEE_PERIOD
- EXECUTE_OPERATOR_FEE_PERIOD
- OPERATOR_MAX_FEE_INCREASE
- QUORUM_BPS
- DEFAULT_ORACLE_IDS

## Upgrade process

We use [UUPS Proxy Upgrade pattern](https://docs.openzeppelin.com/contracts/4.x/api/proxy) for `SSVNetwork` and `SSVNetworkViews` contracts to have an ability to upgrade them later.

**Important**: It's critical to not add any state variable to `SSVNetwork` nor `SSVNetworkViews` when upgrading. All the state variables are managed by [SSVStorage](../contracts/libraries/storage/SSVStorage.sol) and [SSVStorageProtocol](../contracts/libraries/storage/SSVStorageProtocol.sol). Only modify the logic part of the main contracts or the modules.

### Upgrade SSVNetwork / SSVNetworkViews

#### Upgrade contract logic

In this case, the upgrade add / delete / modify a function, but no other piece in the system is changed (libraries or modules).

Run the upgrade recipe:

```bash
just upgrade-contract <CONTRACT_NAME> <PROXY_ADDDRESS> <NETWORK_NAME>
```

#### Example:

```bash
just upgrade-contract SSVNetwork 0x12345678901234567890123456789 hoodi
```

It is crucial to verify the upgraded contract using its proxy address.
This ensures that users can interact with the correct, upgraded implementation on Etherscan.

### Update a module

Sometimes you only need to perform changes in the logic of a function of a module, add a private function or do something that doesn't affect other components in the architecture. Then you can use the recipe to update a module.

This recipe first deploys a new version of a specified SSV module contract and then updates the SSVNetwork contract to use this new module version.

```bash
just update-module <MODULE_NAME> <PROXY_ADDRESS> <NETWORK_NAME> <CONSTRUCTOR_ARGS>
```

#### Example:

```bash
just update-module SSVOperatots 0x12345678901234567890123456789 hoodi 12345
```

### Upgrade a library

When you change a library that `SSVNetwork` uses, you need to also update all modules where that library is used.

Set `SSVNETWORK_PROXY_ADDRESS` in `.env` file to the right value.

Run the recipe to upgrade SSVNetwork proxy contract as described in [Upgrade SSVNetwork / SSVNetworkViews](#upgrade-contract-logic)

Run the right recipe to update the module affected by the library change, as described in [Update a module](#update-a-module) section.

### Manual upgrade of SSVNetwork / SSVNetworkViews

Deploys a new implementation contract. Use this recipe to prepare an upgrade to be run from an owner address you do not control directly or cannot use from Hardhat.

```bash
just deploy-implementation <CONTRACT_NAME> <NETWORK_NAME>
```

#### Example:

```bash
just deploy-implementation SSVNetworkViews hoodi
```

The recipe will return the new implementation address. After that, you can run `upgradeTo` or `upgradeToAndCall` in SSVNetwork / SSVNetworkViews proxy address, providing it as a parameter or use a recipe to do it in a CLI.

### Manual upgrade of a module

Deploys a new module contract. Use this recipe to prepare a module update to be run from an owner address you do not control directly or cannot use from Hardhat.

```bash
just deploy-module <MODULE_NAME> <NETWORK_NAME> <CONSTRUCTOR_ARGS>
```

#### Example: 

```bash
just deploy-module SSVOperators hoodi 12345
```

The recipe will return the new module address. After that, you can run `updateModule` in SSVNetwork proxy address, providing it as a parameter or use a recipe to do it in a CLI.

### Manual upgrade of SSVNetwork / SSVNetworkViews with predeployed implementation

Calls `upgradeTo` on a selected proxy address using a selected implementation address as a parameter

```bash
just upgrade-implementation <CONTRACT_NAME> <PROXY_ADDRESS> <IMPLEMENTATION_ADDRESS> <NETWORK_NAME>
```

#### Example:

```bash
just upgrade-implementation SSVNetwork 0x12345678901234567890123456789 0xBEEFBEEFBEEFBEEFBEEFBEEFBEEF hoodi
```

### Manual upgrade of a module with predeployed implementation

Calls `updateModule` on a selected proxy address using a selected implementation address as a parameter

### Manual upgrade of a module with predeployed implementation

Calls `updateModule` on a selected proxy address using a selected implementation address as a parameter

```bash
just attach-module <CONTRACT_ANME> <MODULE_ADDRESS> <PROXY_ADDRESS> <NETWORK_NAME>
```

#### Example:

```bash
just attach-module SSVClusters 0x12345678901234567890123456789 0xBEEFBEEFBEEFBEEFBEEFBEEFBEEF hoodi
```


