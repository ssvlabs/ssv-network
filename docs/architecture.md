# SSV Network

### [Intro](../README.md) | Architecture | [Setup](setup.md) | [Tasks](tasks.md) |  [Local development](local-dev.md)

## Contract Architecture

The architecture of the contracts is based on [EIP-2535 Diamond MultiFacet Proxy](https://eips.ethereum.org/EIPS/eip-2535) with some changes mainly to be compatible with regular block explorers like Etherscan. Main goals:

* **Modularity** - As the system evolves, we need to be able to move fast incorporating or changing functionalities without facing limitations like the contract size or disturbing existing architecture.
* **Upgradeability** - Allowing the DAO to evolve the system or solve issues. The process can be deactivated if such a decision is made.
* **Resilient innovation** - To encourage developer adoption, we designed a system easy to integrate and use.

### Main components
#### SSVNetwork
It's the main entry point for users, used for operations and management. It acts as a proxy for the _module_ contracts, where all functions that contains logic reside. All events are fired from SSVNetwork conctract.

It's an [UUPS](https://eips.ethereum.org/EIPS/eip-1822) upgradeable contract. Apart from the state variables inherithed by the UUPS Openzeppelin implementation, the contract storage is managed by the [Diamond storage pattern](https://eip2535diamonds.substack.com/i/65777640/diamond-storage) using a specific library.

Fallback function is implemented to delegate all calls to SSVViews module.
Any module interface can be used with this contract, so then you can access only the functions and events related to the specific interface of the module. This is helpful when you want to provide access to a restricted set of functionalities that belong to Operators, Clusters, etc.

#### SSVNetworkViews
It's the main contract for reading information about the network and its participants.

#### Modules
Non upgradeable, stateless contracts that containt the logic to support Clusters, Operators and Protocol (DAO / Network) functionalities.

#### Libraries
Libraries are a fundamental part in the architecture to suppport reusable pieces in an efficient way. Also, `SSVStorage`  and `SSVStorageProtocol` implement the Diamond storage pattern.

#### SSV Token
The native SSV token is used to facilitate payments between stakers and SSV node operators to maintain their validators.

