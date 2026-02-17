# SSV Network

### [Intro](../README.md) | [Architecture](architecture.md) | [Setup](setup.md) | [Tasks](tasks.md) | [Local development](local-dev.md) | [Roles](roles.md) | [Publish](publish.md) | Operator owners

## Registering an operator
The function `SSVNetwork.registerOperator()` is used to register a validator.
Input parameters:
`publicKey`: The public key of the operator
`fee`: Should be `0` or greater than `100000000` and less than the value returned by `SSVNetworkViews.getMaximumOperatorFee()`
`setPrivate`: Flag to set the privacy status of the operator. Public means anyone can use the operator for registering validators. Private means only the operator's whitelisted addresses can.

After the operator is registered, the caller becomes the `owner`, the `fee` is set and the `whitelisted` status is set to `false`.
The `whitelisted` flag of the operator indicates if the operator is private (when set to `true`) or public (`false`),

## Whitelisted operators
An operator owner can restrict the usage of it to specific EOAs, generic contracts and whitelisting contracts. 
A whitelisting contract is the one that implements the [ISSVWhitelistingContract](../contracts/interfaces/external/ISSVWhitelistingContract.sol) interface.

The restriction is only effective when the operator owner sets the privacy status of the operator to *private*.

To manage the whitelisted addresses, these 2 data structures are used:

`mapping(uint64 => address) operatorsWhitelist`: Keeps the relation between an operator and a whitelisting contract.
`mapping(address => mapping(uint256 => uint256)) addressWhitelistedForOperators`: Links an address (EOA/generic contract) to a list of operators identified by its `operatorId` using bitmaps.

### What is a Whitelisting Contract?
The operators can choose to whitelist an external contract with custom logic to manage authorized addresses externally. To be used in SSV contracts, it needs to implement the [ISSVWhitelistingContract](../contracts/interfaces/external/ISSVWhitelistingContract.sol) interface, that requires to implement the `isWhitelisted(address account, uint256 operatorId)` function. This function is called in the register validator process, that must return `true/false` to indicate if the caller (`msg.sender`) is whitelisted for the operator.

It's up to the implementation of the whitelisting contract to use the `operatorId` parameter in the `isWhitelisted` function.

To check if a contact is a valid whitelisting contract, use the function `SSVNetworkViews.isWhitelistingContract(address contractAddress)`.

To check if an account is whitelisted in a whitelisting contract, use the function `SSVNetworkViews.isAddressWhitelistedInWhitelistingContract(address account, uint256 operatorId, address whitelistingContract)`.

### Legacy whitelisted addresses transition process
Up until v1.1.1, operators use the `operatorsWhitelist` mapping to save EOAs and generic contracts. Now in v1.2.0, those type of addresses are stored in `addressWhitelistedForOperators`, leaving `operatorsWhitelist` to save only whitelisting contracts.
When whitelisting a new whitelisting contract, the current address stored in `operatorsWhitelist` will be moved to `addressWhitelistedForOperators`, and the new address stored in `operatorsWhitelist`.
When whitelisting a new EOA/generic contract, it will be saved in `addressWhitelistedForOperators`, leaving the previous address in `operatorsWhitelist` intact.

### Operator whitelist states
The following table shows all possible combinations of whitelisted addresses for a given operator.
| Use legacy EOA/generic contract  | Use whitelisting contract  | Use EOAs/generic contracts |
|---|---|---|
| Y  |   |   |
| Y  |   | Y  |
|   | Y  |   |
|   |   | Y  |
|   | Y  | Y  |

The operarator status changes to private (`Operator.whitelisted == true`), so only the whitelisted addresses can use the operator's services when the operator owner explicitly sets the *private* status calling `SSVNetwork.setOperatorsPrivateUnchecked()`, no matter if it has whitelisted addresses.

The operarator status changes to public (`Operator.whitelisted == false`), so anyone can use the operator's services when the operator owner explicitly sets the public status calling `SSVNetwork.setOperatorsPublicUnchecked()`, no matter if it still has whitelisted addresses.

### Registering whitelist addresses
Functions related to whitelisting contracts:
- Register: `SSVNetwork.setOperatorsWhitelistingContract(uint64[] calldata operatorIds, ISSVWhitelistingContract whitelistingContract)`
- Remove: `SSVNetwork.removeOperatorsWhitelistingContract(uint64[] calldata operatorIds)`

Functions related to EOAs/generic contracts:
- Register multiple addresses to multiple operators: `SSVNetwork.setOperatorsWhitelists(uint64[] calldata operatorIds, address[] calldata whitelistAddresses)`
- Remove multiple addresses for multiple operators: `SSVNetwork.removeOperatorsWhitelists(uint64[] calldata operatorIds, address[] calldata whitelistAddresses)`

### Registering validators using whitelisted operators
When registering validators using `SSVNetwork.registerValidator` or `SSVNetwork.registerValidator`, the flow to check if the caller is authorized to use a whitelisted operator is the following:
1. Check if the operator is whitelisted via the SSV whitelisting module, using `addressWhitelistedForOperators`.
2. Check if the operator has a whitelisted address in `operatorsWhitelist`.
    1. Check if the caller is the whitelisted address. In this step we keep the whitelisting system backward compatible with previous whitelisted EOAs/generic contracts.
    2. Check if the address is a whitelisting contract. Then call its `isWhitelisted()` function.

If the caller is not authorized for any of the whitelisted operators, the transaction will revert with the `CallerNotWhitelistedWithData(<operatorId>)` error.

**Important**: Changes to an operator's whitelist will not impact existing validators registered with that operator. Only new validator registrations will adhere to the updated whitelist rules.



